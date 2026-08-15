import { useMemo } from 'react'
import * as THREE from 'three'
import { registry } from '../disposal.ts'
import type { WorldPalette } from '../../game/data/worlds.ts'

export function Lighting({ tier, palette }: { tier: 'High' | 'Medium' | 'Low'; palette: WorldPalette }) {
  const { sunLight, earthshine, ambient, rimLight } = useMemo(() => {
    // 1. Sun (key, sharp shadows, slightly warm)
    const sun = new THREE.DirectionalLight(palette.sun, 4.5)
    sun.position.set(400, 220, 260) // High up and away
    
    if (tier !== 'Low') {
      sun.castShadow = true
      sun.shadow.mapSize.set(tier === 'High' ? 2048 : 1024, tier === 'High' ? 2048 : 1024)
      sun.shadow.bias = -0.0004
      
      // Tight orthographic frustum that follows the player (~180u coverage)
      // We will update the shadow camera position in useFrame, but set up the camera here.
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
    // 0x4a6a92 sky (from earth), 0x0b1220 ground (space)
    const hemi = new THREE.HemisphereLight(palette.earthshine, palette.shadow, 0.45)
    registry.track(hemi)

    // 3. Ambient (prevents pure black crush only)
    const amb = new THREE.AmbientLight(0xffffff, 0.04)
    registry.track(amb)

    // 4. Rim light — the one that makes the night side readable (§16.2).
    //
    // Opposite the sun and deliberately cold, so a craft or an outpost crossing
    // into shadow keeps a lit edge instead of dissolving into the background.
    // On a sphere half the playfield is always unlit, and the drain clock does
    // not stop when the player crosses the terminator, so "you cannot see the
    // thing you are supposed to be shooting" is a gameplay failure and not an
    // aesthetic one. Kept dim and blue enough to read as reflected Earthlight
    // rather than as a second sun.
    const rim = new THREE.DirectionalLight(palette.rim, 1.15)
    rim.position.set(-380, -140, -300)
    registry.track(rim)

    return { sunLight: sun, earthshine: hemi, ambient: amb, rimLight: rim }
  }, [tier, palette])

  return (
    <group>
      <primitive object={sunLight} />
      <primitive object={earthshine} />
      <primitive object={ambient} />
      <primitive object={rimLight} />
    </group>
  )
}
