import { useMemo, useEffect } from 'react'
import * as THREE from 'three'
import { registry } from '../disposal.ts'
import type { WorldPalette } from '../../game/data/worlds.ts'

/** Sun-direction offset, world units. Shared with the shadow-follow in RenderBridge. */
export const SUN_OFFSET = new THREE.Vector3(400, 220, 260)

export function Lighting({
  tier,
  palette,
  sunRef,
}: {
  tier: 'High' | 'Medium' | 'Low'
  palette: WorldPalette
  sunRef?: React.Ref<THREE.DirectionalLight>
}) {
  const { sunLight, earthshine, ambient, rimLight } = useMemo(() => {
    // 1. Sun (key, sharp shadows, slightly warm)
    const sun = new THREE.DirectionalLight(palette.sun, 4.5)
    sun.position.copy(SUN_OFFSET)

    if (tier !== 'Low') {
      sun.castShadow = true
      sun.shadow.mapSize.set(tier === 'High' ? 2048 : 1024, tier === 'High' ? 2048 : 1024)
      sun.shadow.bias = -0.0004

      // Tight orthographic frustum. RenderBridge recentres it on the craft
      // each frame so the 180 u coverage sits where the player actually is
      // rather than on the moon's origin.
      const cam = sun.shadow.camera
      cam.left = -90
      cam.right = 90
      cam.top = 90
      cam.bottom = -90
      cam.near = 100
      cam.far = 800
    }
    registry.track(sun)

    // 2. Earthshine (night-side fill, cool blue)
    const hemi = new THREE.HemisphereLight(palette.earthshine, palette.shadow, 0.45)
    registry.track(hemi)

    // 3. Ambient (prevents pure black crush only)
    const amb = new THREE.AmbientLight(0xffffff, 0.04)
    registry.track(amb)

    // 4. Rim light — the one that makes the night side readable (§16.2).
    const rim = new THREE.DirectionalLight(palette.rim, 1.15)
    rim.position.set(-380, -140, -300)
    registry.track(rim)

    return { sunLight: sun, earthshine: hemi, ambient: amb, rimLight: rim }
  }, [tier, palette])

  useEffect(() => {
    return () => {
      registry.release(sunLight)
      registry.release(earthshine)
      registry.release(ambient)
      registry.release(rimLight)
    }
  }, [sunLight, earthshine, ambient, rimLight])

  return (
    <group>
      <primitive object={sunLight} ref={sunRef ?? null} />
      <primitive object={sunLight.target} />
      <primitive object={earthshine} />
      <primitive object={ambient} />
      <primitive object={rimLight} />
    </group>
  )
}
