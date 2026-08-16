/**
 * The sky (gameplan §16.2, §25).
 *
 * ## Why the previous version read as "random white dots"
 *
 * It was 8000 points drawn from a uniform distribution, at one size, in one
 * narrow hue band, with brightness assigned by `rng.next()`. Three things were
 * wrong with that, and none of them was the point count:
 *
 *  - **Uniform is the one distribution a real sky never has.** Every night sky
 *    anyone has ever seen is dominated by the plane of its own galaxy. Without a
 *    band, the eye reads the field as noise — which is exactly what it was.
 *  - **`θ = range(0, π)` is not a uniform sphere.** It bunches points at the
 *    poles, so the "random" field had two visible clumps in it. The correct
 *    sampling is `cos θ` uniform in [−1, 1].
 *  - **One size and one hue is not a star field, it is a texture.** Real stars
 *    span roughly six magnitudes of visible brightness and run from blue-white
 *    O-type through to deep orange M-type, and that variation is most of what
 *    makes a sky look like a sky.
 *
 * ## What it is now
 *
 * Four `Points` layers — four draw calls, no textures for the stars themselves:
 *
 *  1. **Field** — stars everywhere, sampled correctly, coloured by black-body
 *     temperature and distributed by magnitude so most are faint.
 *  2. **Galactic band** — the same stars again but concentrated around a great
 *     circle with a Gaussian falloff, which is what the Milky Way physically is:
 *     the disc of the galaxy seen edge-on from inside it.
 *  3. **Bright stars** — a few dozen at larger size, the ones the eye uses to
 *     recognise that a sky is fixed rather than scrolling.
 *  4. **Nebulae** — soft additive clouds along the band, from one shared
 *     32×32 radial-gradient texture generated in-process. No asset, no network,
 *     nothing for the CSP to object to.
 *
 * `density` is the *world's*, not a quality setting: Ashfall's ash genuinely
 * hides its sky, and its near-bare star field is that fact rendered.
 */
import { useMemo, useEffect } from 'react'
import * as THREE from 'three'
import { Random } from '../../game/core/Random.ts'
import { registry } from '../disposal.ts'

/** Where the sky sits. Inside the camera's far plane, outside everything else. */
const SKY_RADIUS_MIN = 900
const SKY_RADIUS_MAX = 1300

/**
 * Angular half-thickness of the galactic band, radians.
 *
 * 0.16 rad ≈ 9°, which is close to the real Milky Way's naked-eye width and,
 * more usefully, wide enough to read as a band from a moving camera rather than
 * as a line.
 */
const BAND_SIGMA = 0.16

/**
 * Star colour from black-body temperature, as an approximation good enough for
 * points a few pixels across.
 *
 * Real stellar colour is overwhelmingly desaturated — the eye sees white with a
 * tint, never the saturated blues and reds that a naive HSL ramp produces — so
 * saturation is held low deliberately. `t` runs 0 (coolest, orange) to 1
 * (hottest, blue-white).
 */
function starColour(out: THREE.Color, t: number): THREE.Color {
  // Hue from 0.09 (warm orange) through white to 0.60 (cold blue).
  const hue = 0.09 + t * 0.51
  // Mid-range stars are the whitest; the extremes carry the tint.
  const saturation = 0.05 + Math.abs(t - 0.55) * 0.42
  return out.setHSL(hue, saturation, 0.72)
}

/**
 * Interstellar dust, which is not the same colour as the stars behind it.
 *
 * Real galactic dust reddens what it sits in front of and scatters blue where it
 * is lit from behind, so the band runs warm through its core and cool at its
 * edges. Colouring it like a star — which the first version did, by reusing
 * `starColour` — produced uniform grey clouds, and grey is the one colour a sky
 * never contains.
 */
function dustColour(out: THREE.Color, u: number): THREE.Color {
  // Two-thirds cool scatter, one-third warm core.
  return u > 0.66
    ? out.setHSL(0.07, 0.42, 0.42)
    : out.setHSL(0.60, 0.35, 0.40)
}

/**
 * Magnitude → brightness, as a heavy power curve.
 *
 * Star counts grow roughly geometrically as magnitude falls, so a linear
 * brightness distribution gives a sky where most stars are mid-grey — which
 * looks like static. The cube leaves the great majority near the noise floor and
 * a handful genuinely bright, which is the contrast the eye reads as depth.
 */
function magnitude(u: number): number {
  return 0.10 + 0.90 * u * u * u
}

interface Layer {
  geometry: THREE.BufferGeometry
  material: THREE.PointsMaterial
}

export function Starfield({
  seed,
  density = 1,
  tier = 'High',
}: {
  seed: number
  density?: number
  tier?: 'High' | 'Medium' | 'Low'
}) {
  const layers = useMemo(() => {
    const rng = new Random(seed)

    /**
     * The galactic plane, chosen from the seed so different runs get a sky at a
     * different angle. Two orthonormal vectors spanning the plane, plus its
     * normal; a point at angular offset `phi` from the plane is
     * `cos φ · (in-plane direction) + sin φ · normal`.
     */
    const normal = new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize()
    const inPlaneA = new THREE.Vector3(0, 0, 1).cross(normal)
    if (inPlaneA.lengthSq() < 1e-6) inPlaneA.set(1, 0, 0)
    inPlaneA.normalize()
    const inPlaneB = new THREE.Vector3().crossVectors(normal, inPlaneA).normalize()

    const scratch = new THREE.Vector3()
    const colour = new THREE.Color()

    /** Uniform over the sphere. `cos θ` uniform, *not* `θ` uniform. */
    const uniformDirection = (out: THREE.Vector3): void => {
      const cosTheta = rng.range(-1, 1)
      const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta))
      const phi = rng.range(0, Math.PI * 2)
      out.set(sinTheta * Math.cos(phi), sinTheta * Math.sin(phi), cosTheta)
    }

    /**
     * A direction near the galactic plane. The offset is an approximately
     * Gaussian deviate built from the average of three uniforms — cheap, and
     * indistinguishable from the real thing at this scale.
     */
    const bandDirection = (out: THREE.Vector3, spread: number): void => {
      const along = rng.range(0, Math.PI * 2)
      const gaussian = (rng.range(-1, 1) + rng.range(-1, 1) + rng.range(-1, 1)) / 3
      const offset = gaussian * spread * 3
      out.copy(inPlaneA).multiplyScalar(Math.cos(along))
        .addScaledVector(inPlaneB, Math.sin(along))
        .multiplyScalar(Math.cos(offset))
        .addScaledVector(normal, Math.sin(offset))
        .normalize()
    }

    const make = (
      count: number,
      size: number,
      opacity: number,
      direction: (out: THREE.Vector3) => void,
      brightness: () => number,
      texture?: THREE.Texture,
      tint?: (out: THREE.Color, u: number) => THREE.Color,
    ): Layer => {
      const positions = new Float32Array(count * 3)
      const colours = new Float32Array(count * 3)

      for (let i = 0; i < count; i++) {
        direction(scratch)
        const distance = rng.range(SKY_RADIUS_MIN, SKY_RADIUS_MAX)
        positions[i * 3] = scratch.x * distance
        positions[i * 3 + 1] = scratch.y * distance
        positions[i * 3 + 2] = scratch.z * distance

        ;(tint ?? starColour)(colour, rng.next())
        const level = brightness()
        colours[i * 3] = colour.r * level
        colours[i * 3 + 1] = colour.g * level
        colours[i * 3 + 2] = colour.b * level
      }

      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))

      const material = new THREE.PointsMaterial({
        size,
        // Fixed pixel size: these are meant to read as point sources at infinity,
        // and attenuating them by distance would make the near edge of the shell
        // visibly brighter than the far one — a sphere the player can see.
        sizeAttenuation: texture !== undefined,
        vertexColors: true,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        ...(texture === undefined ? {} : { map: texture }),
      })

      registry.track(geometry)
      registry.track(material)
      return { geometry, material }
    }

    /**
     * One 32×32 radial gradient, shared by every nebula point.
     *
     * Generated here rather than shipped, which keeps §39's `default-src 'self'`
     * honest without a single byte of asset — and at 32×32 the cost is beneath
     * measurement.
     */
    const nebulaTexture = ((): THREE.Texture => {
      const canvas = document.createElement('canvas')
      canvas.width = 32
      canvas.height = 32
      const context = canvas.getContext('2d')
      if (context !== null) {
        const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16)
        gradient.addColorStop(0, 'rgba(255,255,255,0.55)')
        gradient.addColorStop(0.4, 'rgba(255,255,255,0.16)')
        gradient.addColorStop(1, 'rgba(255,255,255,0)')
        context.fillStyle = gradient
        context.fillRect(0, 0, 32, 32)
      }
      const texture = new THREE.CanvasTexture(canvas)
      registry.track(texture)
      return texture
    })()

    const scale = Math.max(0.08, density)
    const nebulaCount =
      tier === 'Low' ? 0 : tier === 'Medium'
        ? Math.max(40, Math.round(120 * scale))
        : Math.max(80, Math.round(300 * scale))

    return {
      // Everywhere, faint. The floor keeps even Ashfall's sky from being empty.
      field: make(
        Math.max(700, Math.round(5200 * scale)),
        1.5,
        0.85,
        uniformDirection,
        () => magnitude(rng.next()) * 0.8,
      ),
      // The Milky Way: the same stars, packed into the disc plane. Small and
      // dim individually — the band is a *density*, and stars bright enough to
      // resolve individually would read as a scattering rather than a glow.
      band: make(
        Math.max(900, Math.round(11000 * scale)),
        1.2,
        0.8,
        (out) => { bandDirection(out, BAND_SIGMA) },
        () => magnitude(rng.next()) * 0.55,
      ),
      // The named ones. Few, large, and the reason the sky reads as fixed.
      bright: make(
        Math.max(14, Math.round(70 * scale)),
        3.4,
        1,
        uniformDirection,
        () => 0.85 + rng.next() * 0.15,
      ),
      // Diffuse dust along the band. Capped by quality tier: 900 additive
      // sprites at 70 px is a fill-rate tax the Low tier cannot afford, and
      // the sky still reads as a sky without them.
      nebulae: nebulaCount === 0
        ? null
        : make(
          nebulaCount,
          70,
          0.15,
          (out) => { bandDirection(out, BAND_SIGMA * 1.15) },
          () => 0.11 + rng.next() * 0.16,
          nebulaTexture,
          dustColour,
        ),
      nebulaTexture,
    }
  }, [seed, density, tier])

  useEffect(() => {
    return () => {
      const disposeLayer = (layer: Layer): void => {
        registry.release(layer.geometry)
        registry.release(layer.material)
      }
      disposeLayer(layers.field)
      disposeLayer(layers.band)
      disposeLayer(layers.bright)
      if (layers.nebulae !== null) disposeLayer(layers.nebulae)
      registry.release(layers.nebulaTexture)
    }
  }, [layers])

  return (
    <group>
      {layers.nebulae !== null && (
        <points geometry={layers.nebulae.geometry} material={layers.nebulae.material} renderOrder={-2} />
      )}
      <points geometry={layers.band.geometry} material={layers.band.material} renderOrder={-1} />
      <points geometry={layers.field.geometry} material={layers.field.material} renderOrder={-1} />
      <points geometry={layers.bright.geometry} material={layers.bright.material} renderOrder={-1} />
    </group>
  )
}
