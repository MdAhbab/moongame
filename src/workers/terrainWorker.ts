import { createNoise3D } from 'simplex-noise'
import { Random } from '../game/core/Random.ts'
import type { WorldPalette, WorldTerrain } from '../game/data/worlds.ts'

export type TerrainProgress =
  | { type: 'progress'; stage: 'albedo' | 'normal' | 'ao'; fraction: number }
  | { type: 'done'; albedo: ImageBitmap; normal: ImageBitmap; ao: ImageBitmap }
  | { type: 'error'; message: string }

interface BakeMessage {
  seed: number
  tier: 'High' | 'Medium' | 'Low'
  terrain: WorldTerrain
  palette: WorldPalette
}

function postProgress(stage: 'albedo' | 'normal' | 'ao', fraction: number) {
  self.postMessage({ type: 'progress', stage, fraction } satisfies TerrainProgress)
}

function postDone(albedo: ImageBitmap, normal: ImageBitmap, ao: ImageBitmap) {
  self.postMessage(
    { type: 'done', albedo, normal, ao } satisfies TerrainProgress,
    // Transfer ownership of the bitmaps
    [albedo, normal, ao] satisfies Transferable[]
  )
}

function postError(message: string) {
  self.postMessage({ type: 'error', message } satisfies TerrainProgress)
}

/**
 * Real fractal Brownian motion, replacing three summed sines.
 *
 * The old version was `0.5·sin(3.1x + 1.7y)·cos(2.3z) + …`, which is periodic
 * in every axis and reads as a regular quilted pattern the moment you fly over
 * enough of it — the eye finds the repeat long before the player finishes a
 * wave. Simplex noise has no such period, and stacking octaves at doubling
 * frequency and halving amplitude gives detail at every scale the camera can
 * get to.
 *
 * `ridged` is the second term and is what separates the three worlds visually.
 * Folding the noise about zero — `1 − |n|` — turns smooth dunes into sharp
 * crests, so a body with a high ridged weight reads as fractured ice or
 * volcanic rock rather than as settled dust.
 */
function makeTerrainNoise(seed: number, terrain: WorldTerrain) {
  // Seeded from the run seed, so a shared seed reproduces the same ground.
  const rng = new Random(seed ^ 0x5eed)
  const noise = createNoise3D(() => rng.next())

  const OCTAVES = 5

  return (x: number, y: number, z: number): number => {
    let amplitude = 1
    let frequency = terrain.frequency * 1.6
    let smooth = 0
    let ridge = 0
    let total = 0

    for (let octave = 0; octave < OCTAVES; octave++) {
      const n = noise(x * frequency, y * frequency, z * frequency)
      smooth += n * amplitude
      // `1 − |n|`, recentred, then squared to sharpen the crest.
      const folded = 1 - Math.abs(n)
      ridge += (folded * folded - 0.5) * amplitude
      total += amplitude
      amplitude *= 0.5
      frequency *= 2.03 // Not exactly 2: octaves that share harmonics band.
    }

    smooth /= total
    ridge /= total
    return (smooth * (1 - terrain.ridged) + ridge * terrain.ridged) * terrain.amplitude
  }
}

self.onmessage = async (e: MessageEvent) => {
  try {
    const { seed, tier, terrain, palette } = e.data as BakeMessage
    const fbm = makeTerrainNoise(seed, terrain)
    const width = tier === 'Low' ? 512 : 1024
    const height = tier === 'Low' ? 256 : 512

    const rng = new Random(seed)

    // Generate explicit crater list
    const craters: { x: number; y: number; z: number; r: number; depth: number }[] = []
    const craterCount = Math.round(42 * terrain.craterDensity)
    for (let i = 0; i < craterCount; i++) {
      const theta = rng.range(0, Math.PI)
      const phi = rng.range(0, Math.PI * 2)
      craters.push({
        x: Math.sin(theta) * Math.cos(phi),
        y: Math.cos(theta),
        z: Math.sin(theta) * Math.sin(phi),
        r: 0.1 + rng.next() * 0.26,
        depth: 2.5 + rng.next() * 8,
      })
    }

    const maria: { x: number; y: number; z: number; r: number }[] = []
    for (let i = 0; i < 6; i++) {
      const theta = rng.range(0, Math.PI)
      const phi = rng.range(0, Math.PI * 2)
      maria.push({
        x: Math.sin(theta) * Math.cos(phi),
        y: Math.cos(theta),
        z: Math.sin(theta) * Math.sin(phi),
        r: 0.35 + rng.next() * 0.3,
      })
    }

    const albedoData = new Uint8ClampedArray(width * height * 4)
    const normalData = new Uint8ClampedArray(width * height * 4)
    const aoData = new Uint8ClampedArray(width * height * 4)

    const CHUNK_SIZE = 32

    // Helper to get unit sphere coordinates from u, v
    const getSphereCoords = (u: number, v: number) => {
      const phi = u * 2 * Math.PI
      const theta = v * Math.PI
      return {
        x: Math.sin(theta) * Math.cos(phi),
        y: Math.cos(theta),
        z: Math.sin(theta) * Math.sin(phi)
      }
    }
    
    // Evaluate height at point x,y,z (unit vector)
    const evaluateHeight = (x: number, y: number, z: number) => {
      let disp = fbm(x, y, z) * 2.2
      for (const c of craters) {
        const dot = x * c.x + y * c.y + z * c.z
        const ang = Math.acos(Math.max(-1, Math.min(1, dot)))
        if (ang < c.r) {
          const t = ang / c.r
          disp -= c.depth * (1 - t * t)
        } else if (ang < c.r * 1.22) {
          disp += c.depth * 0.16
        }
      }
      return disp
    }

    // Pass 1: Albedo
    for (let y = 0; y < height; y += CHUNK_SIZE) {
      for (let yy = y; yy < Math.min(y + CHUNK_SIZE, height); yy++) {
        const v = 1 - yy / (height - 1)
        for (let x = 0; x < width; x++) {
          const u = x / (width - 1)
          const p = getSphereCoords(u, v)

          let mare = 0
          for (const m of maria) {
            const dot = p.x * m.x + p.y * m.y + p.z * m.z
            const ang = Math.acos(Math.max(-1, Math.min(1, dot)))
            if (ang < m.r) {
              mare = Math.max(mare, 1 - ang / m.r)
            }
          }

          const disp = fbm(p.x, p.y, p.z) * 2.2
          const shade = Math.max(0.45, Math.min(1, 0.72 + fbm(p.x * 3, p.y * 3, p.z * 3) * 0.12 + (disp < 0 ? -0.1 : 0.02)))
          
          // Lit and shadowed regolith come from the world's palette rather than
          // being hardcoded to Luna's grey, which is most of what makes Thule
          // read as ice and Ashfall as basalt.
          const baseColor = [
            (palette.regolith >> 16) & 0xff,
            (palette.regolith >> 8) & 0xff,
            palette.regolith & 0xff,
          ] as const
          const darkColor = [
            Math.round((((palette.regolith >> 16) & 0xff) * 0.42) + (((palette.shadow >> 16) & 0xff) * 0.58)),
            Math.round((((palette.regolith >> 8) & 0xff) * 0.42) + (((palette.shadow >> 8) & 0xff) * 0.58)),
            Math.round(((palette.regolith & 0xff) * 0.42) + ((palette.shadow & 0xff) * 0.58)),
          ] as const

          const r = (baseColor[0] + (darkColor[0] - baseColor[0]) * mare * 0.8) * shade
          const g = (baseColor[1] + (darkColor[1] - baseColor[1]) * mare * 0.8) * shade
          const b = (baseColor[2] + (darkColor[2] - baseColor[2]) * mare * 0.8) * shade

          const idx = (yy * width + x) * 4
          albedoData[idx] = r
          albedoData[idx + 1] = g
          albedoData[idx + 2] = b
          albedoData[idx + 3] = 255
        }
      }
      postProgress('albedo', y / height)
      await new Promise((r) => setTimeout(r, 0))
    }
    postProgress('albedo', 1.0)

    // Pass 2: Normal
    for (let y = 0; y < height; y += CHUNK_SIZE) {
      for (let yy = y; yy < Math.min(y + CHUNK_SIZE, height); yy++) {
        const v = 1 - yy / (height - 1)
        for (let x = 0; x < width; x++) {
          const u = x / (width - 1)
          const p = getSphereCoords(u, v)

          // Approximate normal via central differences
          const eps = 0.01
          const pu1 = getSphereCoords(u + eps, v)
          const pv1 = getSphereCoords(u, v + eps)
          
          const h = evaluateHeight(p.x, p.y, p.z)
          const hu = evaluateHeight(pu1.x, pu1.y, pu1.z)
          const hv = evaluateHeight(pv1.x, pv1.y, pv1.z)

          const du = (hu - h) / eps
          const dv = (hv - h) / eps

          // Convert tangent space normal to tangent space map representation
          const normalVector = { x: -du * 0.1, y: -dv * 0.1, z: 1.0 }
          const len = Math.sqrt(normalVector.x ** 2 + normalVector.y ** 2 + normalVector.z ** 2)

          const idx = (yy * width + x) * 4
          normalData[idx] = ((normalVector.x / len) * 0.5 + 0.5) * 255
          normalData[idx + 1] = ((normalVector.y / len) * 0.5 + 0.5) * 255
          normalData[idx + 2] = ((normalVector.z / len) * 0.5 + 0.5) * 255
          normalData[idx + 3] = 255
        }
      }
      postProgress('normal', y / height)
      await new Promise((r) => setTimeout(r, 0))
    }
    postProgress('normal', 1.0)

    // Pass 3: AO
    for (let y = 0; y < height; y += CHUNK_SIZE) {
      for (let yy = y; yy < Math.min(y + CHUNK_SIZE, height); yy++) {
        const v = 1 - yy / (height - 1)
        for (let x = 0; x < width; x++) {
          const u = x / (width - 1)
          const p = getSphereCoords(u, v)
          
          let ao = 1.0
          for (const c of craters) {
            const dot = p.x * c.x + p.y * c.y + p.z * c.z
            const ang = Math.acos(Math.max(-1, Math.min(1, dot)))
            if (ang < c.r) {
              const t = ang / c.r
              ao *= (0.3 + 0.7 * t) // Darken crater bottoms
            }
          }
          
          const idx = (yy * width + x) * 4
          aoData[idx] = ao * 255
          aoData[idx + 1] = ao * 255
          aoData[idx + 2] = ao * 255
          aoData[idx + 3] = 255
        }
      }
      postProgress('ao', y / height)
      await new Promise((r) => setTimeout(r, 0))
    }
    postProgress('ao', 1.0)

    const albedoImg = new ImageData(albedoData, width, height)
    const normalImg = new ImageData(normalData, width, height)
    const aoImg = new ImageData(aoData, width, height)

    const [albedo, normal, ao] = await Promise.all([
      createImageBitmap(albedoImg),
      createImageBitmap(normalImg),
      createImageBitmap(aoImg),
    ])

    postDone(albedo, normal, ao)

  } catch (error) {
    postError(error instanceof Error ? error.message : String(error))
  }
}
