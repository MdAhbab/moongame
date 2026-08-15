/**
 * The sun, as an object rather than a light source.
 *
 * `Lighting` already puts a directional light in from this bearing; this is the
 * thing you can see. It was a flat-coloured 30 u sphere with one glow sprite,
 * which in a scene with bloom reads as a bright ball — accurate to nothing, and
 * the only cue in the sky besides the primary.
 *
 * Three layers now, none of them expensive:
 *
 *  1. **Photosphere** — small and pure white. Being *white* rather than the
 *     palette's warm tint matters: the sun's colour belongs to the light it
 *     casts and the corona around it, and a coloured disc reads as a lamp.
 *  2. **Corona** — a backside shell sphere mesh with custom shader, using 3D simplex noise
 *     and radial falloff to create a natural, irregular glowing shape that responds to time.
 *  3. **Spikes** — a faint four-point diffraction cross. Every camera and every
 *     eye produces one on a source this bright, and its absence is one of the
 *     specific things that makes a rendered sun look like a sphere.
 *
 * All three are on `depthWrite: false` so nothing in the sky occludes anything
 * else in the sky, and the whole group sits well outside the play shell.
 */
import { useMemo } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { registry } from '../disposal.ts'
import type { WorldPalette } from '../../game/data/worlds.ts'
import {
  sunVertexShader,
  sunFragmentShader,
  sunCoronaVertexShader,
  sunCoronaFragmentShader,
} from '../shaders/sunShaders.ts'

/** One shared radial gradient, generated in-process — no asset, no network. */
function makeGlowTexture(stops: [number, number][]): THREE.Texture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (context !== null) {
    const half = size / 2
    const gradient = context.createRadialGradient(half, half, 0, half, half, half)
    for (const [offset, alpha] of stops) {
      gradient.addColorStop(offset, `rgba(255,255,255,${String(alpha)})`)
    }
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)
  }
  const texture = new THREE.CanvasTexture(canvas)
  registry.track(texture)
  return texture
}

interface SunProps {
  palette: WorldPalette
  meshRef?: React.Ref<THREE.Mesh>
  materialRef?: React.Ref<THREE.ShaderMaterial>
  coronaMaterialRef?: React.Ref<THREE.ShaderMaterial>
}

export function Sun({ palette, meshRef, materialRef, coronaMaterialRef }: SunProps) {
  const parts = useMemo(() => {
    // The visible disc. White, small, and bright enough that the bloom pass
    // does the flare for us rather than us faking one.
    const discGeometry = new THREE.SphereGeometry(16, 24, 24)
    const discMaterial = new THREE.ShaderMaterial({
      vertexShader: sunVertexShader,
      fragmentShader: sunFragmentShader,
      uniforms: {
        uColor: { value: new THREE.Color(palette.sun) },
        uTime: { value: 0 },
      },
      toneMapped: false,
      fog: false,
    })
    registry.track(discGeometry)
    registry.track(discMaterial)

    // Backside Shell Corona: radial falloff with 3D noise variation.
    const coronaGeometry = new THREE.SphereGeometry(24, 24, 24)
    const coronaMaterial = new THREE.ShaderMaterial({
      vertexShader: sunCoronaVertexShader,
      fragmentShader: sunCoronaFragmentShader,
      uniforms: {
        uColor: { value: new THREE.Color(palette.sun) },
        uTime: { value: 0 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    })
    registry.track(coronaGeometry)
    registry.track(coronaMaterial)

    // The diffraction cross. Sprites rather than quads, because a quad in the
    // sky has an orientation and would foreshorten to a line as the craft
    // orbits past it — a spike is a property of looking, not of the object.
    const spike = new THREE.SpriteMaterial({
      map: makeGlowTexture([[0, 1], [0.3, 0.2], [0.7, 0.03], [1, 0]]),
      color: palette.sun,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    })
    registry.track(spike)

    return { discGeometry, discMaterial, coronaGeometry, coronaMaterial, spike }
  }, [palette.sun])

  useFrame(({ clock }) => {
    const elapsed = clock.getElapsedTime()
    if (parts.discMaterial.uniforms['uTime']) {
      parts.discMaterial.uniforms['uTime'].value = elapsed
    }
    if (parts.coronaMaterial.uniforms['uTime']) {
      parts.coronaMaterial.uniforms['uTime'].value = elapsed
    }
  })

  return (
    <group position={[700, 380, 460]}>
      <mesh geometry={parts.coronaGeometry}>
        <primitive object={parts.coronaMaterial} attach="material" {...(coronaMaterialRef ? { ref: coronaMaterialRef } : {})} />
      </mesh>
      <sprite material={parts.spike} scale={[300, 9, 1]} />
      <sprite material={parts.spike} scale={[9, 300, 1]} />
      {/* We name this mesh so PostProcessing can find it for Godrays */}
      <mesh name="sunMesh" geometry={parts.discGeometry} {...(meshRef ? { ref: meshRef } : {})}>
        <primitive object={parts.discMaterial} attach="material" {...(materialRef ? { ref: materialRef } : {})} />
      </mesh>
    </group>
  )
}
