import { useMemo, forwardRef } from 'react'
import * as THREE from 'three'
import { registry } from '../disposal.ts'

export interface BombTargetRefs {
  /** The footprint ring, laid flat on the surface at the predicted impact. */
  ring: THREE.Mesh
  /** A thin post at the exact point, so the mark survives a grazing view. */
  stake: THREE.Mesh
}

/**
 * The bomb's predicted footprint, drawn **in the world** rather than on the HUD.
 *
 * A blast radius is a fact about the ground, and the ground is at an angle. The
 * first version of this marker was a circle in screen space, which meant a 20 u
 * radius drew as a 20 u *circle* however obliquely the surface was being viewed
 * — a ring that claimed to cover ground it did not, and at cruise altitude it
 * filled a third of the display and sat directly on top of the Threat Ring,
 * where it read as another piece of chrome.
 *
 * A ring lying on the surface solves both at once: perspective makes it an
 * ellipse for free and exactly the right one, it shrinks with distance the way
 * everything else in the scene does, and it is unmistakably *part of the moon*
 * rather than part of the interface. The HUD keeps only the cross and the time
 * of fall, which are the two things that are genuinely about the weapon rather
 * than about the terrain.
 *
 * Additively blended and depth-tested off, so it stays visible against dark
 * regolith and inside a crater without z-fighting the surface it is lying on.
 */
export const BombTarget = forwardRef<BombTargetRefs, object>((_, ref) => {
  const built = useMemo(() => {
    // Unit radius, so the per-frame update is a single `scale.setScalar` to the
    // live blast radius — which changes with the Orbital Ordnance perk.
    const ringGeometry = new THREE.RingGeometry(0.955, 1, 72)
    registry.track(ringGeometry)

    // Dim on purpose. This is a *standing* mark — the bay is ready most of the
    // time, so the ring is on screen most of the time, and anything brighter
    // would compete with the threats it is drawn among. Additive so it reads
    // against black regolith without needing to be opaque.
    const material = new THREE.MeshBasicMaterial({
      color: 0xff8a3d,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
      // Depth testing off because the ring's whole job is to be findable: a
      // marker swallowed by the crater rim you are trying to bomb is a marker
      // that fails exactly when it is needed.
      depthTest: false,
      blending: THREE.AdditiveBlending,
    })
    registry.track(material)

    // The meshes themselves hold no GPU resource of their own — the geometry
    // and the material above are the tracked pair — so they are not registered.
    const ring = new THREE.Mesh(ringGeometry, material)
    ring.visible = false
    ring.frustumCulled = false
    // Drawn after the scene so it is never hidden by the terrain it lies on.
    ring.renderOrder = 10

    const stakeGeometry = new THREE.CylinderGeometry(0.12, 0.12, 6, 6)
    // The cylinder's axis is +Y; the marker stands along the surface normal, and
    // the update code orients the whole mesh so +Y is that normal.
    registry.track(stakeGeometry)

    const stake = new THREE.Mesh(stakeGeometry, material)
    stake.visible = false
    stake.frustumCulled = false
    stake.renderOrder = 10

    return { ring, stake }
  }, [])

  if (ref) {
    if (typeof ref === 'function') ref(built)
    else ref.current = built
  }

  return (
    <>
      <primitive object={built.ring} />
      <primitive object={built.stake} />
    </>
  )
})
