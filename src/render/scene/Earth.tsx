/**
 * The primary — the body this moon orbits, hanging fixed in its sky — and a
 * small companion further out.
 *
 * Called `Earth` because on Mare Noctis it is Earth. On Thule it is a gas giant
 * two and a half times the size, and on Ashfall a close, angry one; a moon that
 * is tidally locked always shows the same face to its primary, so the thing in
 * the sky never moves and is the strongest single cue for *where you are*.
 *
 * ## What changed
 *
 * It was a flat-coloured sphere with `emissiveIntensity: 0.7` and a uniformly
 * additive shell around it. The emissive term meant the *night side glowed as
 * brightly as the day side*, which erases the terminator — and the terminator is
 * the one feature that makes a planet read as a sphere lit by the same sun the
 * player is flying under, rather than as a circle pasted on the sky.
 *
 * Now:
 *
 *  - The emissive is dropped to a trace, so the real directional light produces
 *    a real terminator, matching the one across the moon's own surface.
 *  - A procedural surface map — banded, blotched, generated on a 256×128 canvas
 *    in-process — gives it a face. Uniform albedo is why the old one looked flat
 *    even when correctly lit.
 *  - The atmosphere shell is `BackSide` additive as before, but faint, so it
 *    reads as a rim rather than as a second, larger planet.
 *  - A **companion** — a small, cratered, phase-lit moon on the other side of
 *    the sky. Two bodies at different distances is what gives a sky depth; one
 *    body is a backdrop.
 */
import { useMemo } from 'react'
import * as THREE from 'three'
import { registry } from '../disposal.ts'
import { Random } from '../../game/core/Random.ts'
import type { WorldPalette } from '../../game/data/worlds.ts'
import { planetVertexShader, planetFragmentShader, atmosphereVertexShader, atmosphereFragmentShader, ringVertexShader, ringFragmentShader } from '../shaders/earthShaders.ts'

/**
 * A banded, mottled surface map on a 256×128 canvas.
 *
 * Latitude bands plus soft blobs — enough structure that the eye finds features
 * to track as the craft orbits, which is what tells it the sky is fixed and the
 * player is the thing that is moving. Deliberately low resolution: it is seen
 * across hundreds of units and never at a grazing angle.
 */
function makeSurfaceTexture(base: THREE.Color, accent: THREE.Color, seed: number): THREE.Texture {
  const width = 256
  const height = 128
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')

  if (context !== null) {
    const rng = new Random(seed)
    context.fillStyle = `#${base.getHexString()}`
    context.fillRect(0, 0, width, height)

    // Latitude banding — the giveaway that a body has weather or a mantle.
    for (let y = 0; y < height; y++) {
      const t = y / height
      const band = Math.sin(t * Math.PI * 7 + rng.next() * 0.02) * 0.5 + 0.5
      context.fillStyle = `rgba(${String(Math.round(accent.r * 255))},${String(Math.round(accent.g * 255))},${String(Math.round(accent.b * 255))},${String(band * 0.22)})`
      context.fillRect(0, y, width, 1)
    }

    // Blotches, drawn as soft radial gradients so nothing has a hard edge.
    for (let i = 0; i < 46; i++) {
      const x = rng.range(0, width)
      const y = rng.range(0, height)
      const radius = rng.range(6, 30)
      const light = rng.next() > 0.5
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius)
      const tint = light ? '255,255,255' : '0,0,0'
      gradient.addColorStop(0, `rgba(${tint},${String(rng.range(0.05, 0.20))})`)
      gradient.addColorStop(1, `rgba(${tint},0)`)
      context.fillStyle = gradient
      context.beginPath()
      context.arc(x, y, radius, 0, Math.PI * 2)
      context.fill()
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  registry.track(texture)
  return texture
}

export function Earth({ palette }: { palette: WorldPalette }) {
  const sunDir = useMemo(() => new THREE.Vector3(400, 220, 260).normalize(), [])
  
  // Custom fields from brief
  const extPalette = palette as unknown as { hasAtmosphere?: boolean, hasRings?: boolean }
  const hasAtmosphere = extPalette.hasAtmosphere ?? true
  const hasRings = extPalette.hasRings ?? false

  const primary = useMemo(() => {
    const radius = 42 * palette.primarySize
    const geometry = new THREE.SphereGeometry(radius, 48, 48)
    const base = new THREE.Color(palette.primary)
    const accent = new THREE.Color(palette.earthshine)

    const material = new THREE.ShaderMaterial({
      vertexShader: planetVertexShader,
      fragmentShader: planetFragmentShader,
      uniforms: {
        tSurface: { value: makeSurfaceTexture(base, accent, 0x5eed) },
        uSunDir: { value: sunDir },
        uCityLightColor: { value: new THREE.Color(0xffaa55) },
        uHasAtmosphere: { value: hasAtmosphere ? 1.0 : 0.0 },
        uHasRings: { value: hasRings ? 1.0 : 0.0 },
        uRingNormal: { value: new THREE.Vector3(0, -Math.sin(Math.PI / 3), Math.cos(Math.PI / 3)).normalize() },
        uRingInnerRadius: { value: radius * 1.5 },
        uRingOuterRadius: { value: radius * 2.8 },
        uPlanetPos: { value: new THREE.Vector3(-600, 260, -700) }
      }
    })
    
    registry.track(geometry)
    registry.track(material)
    return { geometry, material, radius }
  }, [palette.primary, palette.earthshine, palette.primarySize, sunDir, hasAtmosphere, hasRings])

  const atmosphere = useMemo(() => {
    if (!hasAtmosphere) return null
    const geometry = new THREE.SphereGeometry(46 * palette.primarySize, 32, 32)
    const material = new THREE.ShaderMaterial({
      vertexShader: atmosphereVertexShader,
      fragmentShader: atmosphereFragmentShader,
      uniforms: {
        uRimColor: { value: new THREE.Color(palette.rim) },
        uSunDir: { value: sunDir }
      },
      transparent: true,
      side: THREE.FrontSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    registry.track(geometry)
    registry.track(material)
    return { geometry, material }
  }, [palette.rim, palette.primarySize, sunDir, hasAtmosphere])

  const rings = useMemo(() => {
    if (!hasRings) return null
    const innerRadius = primary.radius * 1.5
    const outerRadius = primary.radius * 2.8
    const geometry = new THREE.RingGeometry(innerRadius, outerRadius, 64)
    const material = new THREE.ShaderMaterial({
      vertexShader: ringVertexShader,
      fragmentShader: ringFragmentShader,
      uniforms: {
        uRingColor: { value: new THREE.Color(palette.earthshine) },
        uSunDir: { value: sunDir },
        uPlanetPos: { value: new THREE.Vector3(-600, 260, -700) },
        uPlanetRadius: { value: primary.radius }
      },
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    registry.track(geometry)
    registry.track(material)
    return { geometry, material }
  }, [palette.earthshine, primary.radius, sunDir, hasRings])

  const companion = useMemo(() => {
    const geometry = new THREE.SphereGeometry(11, 24, 24)
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: makeSurfaceTexture(new THREE.Color(0x8d8f96), new THREE.Color(0x53565e), 0xc0de),
      roughness: 1,
      metalness: 0,
    })
    registry.track(geometry)
    registry.track(material)
    return { geometry, material }
  }, [])

  return (
    <group>
      <group position={[-600, 260, -700]}>
        <mesh geometry={primary.geometry} material={primary.material} />
        {atmosphere && <mesh geometry={atmosphere.geometry} material={atmosphere.material} />}
        {rings && <mesh geometry={rings.geometry} material={rings.material} rotation={[-Math.PI / 3, 0, 0]} />}
      </group>
      <mesh
        position={[520, -300, -620]}
        geometry={companion.geometry}
        material={companion.material}
      />
    </group>
  )
}
