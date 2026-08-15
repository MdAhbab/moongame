import { useMemo, forwardRef } from 'react'
import * as THREE from 'three'
import { Materials } from '../materials/registry.ts'
import { registry } from '../disposal.ts'
import { merge } from '../geometry/shapes.ts'
import { MAX_DRONES } from '../../game/core/World.ts'

export interface DroneRefs {
  mesh: THREE.InstancedMesh
  /** Station-keeping thruster glow, pulsed per frame. */
  glow: THREE.InstancedMesh
}

/**
 * How far behind the drone's centre the thruster glow sits, u.
 *
 * Follows from the hull below rather than from taste — the flattened
 * octahedron core reaches z = -0.46, so this parks the sphere at the tail with
 * its far edge just clear of the skin. It lives here, beside the geometry that
 * explains it, for the reason `render/tuning.ts` gives for *not* collecting
 * every number into one file.
 */
export const DRONE_GLOW_OFFSET = 0.42

/**
 * The escort drone (§7.4).
 *
 * Deliberately *not* a small copy of the player's craft. It has to be readable
 * at a glance as friendly, small, and not-you — three facts the eye should get
 * from the silhouette before the colour, because in a fight the player is
 * tracking a lot of moving things at once. So: a stubby faceted core with a
 * sensor ring and two stub pylons, an eighth the size of the craft, holding
 * formation off the wing.
 */
export const DroneInstances = forwardRef<DroneRefs, object>((_, ref) => {
  const built = useMemo(() => {
    const parts: THREE.BufferGeometry[] = []

    // Core: an octahedron, flattened. Distinct from every hostile silhouette,
    // which are hexagonal (Harvester), darts (Interceptor) and discs (Sentinel).
    const core = new THREE.OctahedronGeometry(0.4, 0)
    core.scale(1, 0.62, 1.15)
    parts.push(core)

    // Sensor ring around the waist, so it reads as instrumentation.
    const ring = new THREE.TorusGeometry(0.44, 0.05, 6, 14)
    ring.rotateX(Math.PI / 2)
    parts.push(ring)

    // Two stub pylons — the guns.
    for (const side of [-1, 1]) {
      const pylon = new THREE.BoxGeometry(0.1, 0.1, 0.55)
      pylon.translate(side * 0.36, 0, 0.24)
      parts.push(pylon)
    }

    // Through `shapes.merge`, not `mergeGeometries` directly. The primitives
    // here disagree about indexing — three's polyhedra are non-indexed while its
    // lathed and boxed shapes are not — and the raw call signals that by
    // returning **null**, which then fails deep inside three with a message
    // naming neither the geometry nor the caller. Normalising first, and
    // throwing on failure, is exactly what that helper exists for.
    const geo = merge(parts, 'drone')
    for (const part of parts) part.dispose()
    registry.track(geo)

    const mesh = new THREE.InstancedMesh(geo, Materials.droneHull, MAX_DRONES)
    mesh.count = 0
    mesh.castShadow = true
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.frustumCulled = false
    registry.track(mesh)

    // Centred on the origin, *not* translated back to the tail. Baking the
    // offset into the geometry means any per-instance scale multiplies the
    // offset too, so pulsing the glow walked it up and down the drone's axis
    // instead of pulsing it in place — at the bottom of the pulse the whole
    // sphere sat inside the hull and vanished. `DRONE_GLOW_OFFSET` moves it to
    // the tail per instance, after the scale, where the scale cannot reach it.
    const glowGeo = new THREE.SphereGeometry(0.17, 8, 6)
    registry.track(glowGeo)

    const glow = new THREE.InstancedMesh(glowGeo, Materials.exhaust, MAX_DRONES)
    glow.count = 0
    glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    glow.frustumCulled = false
    glow.renderOrder = 4
    registry.track(glow)

    return { mesh, glow }
  }, [])

  if (ref) {
    if (typeof ref === 'function') {
      ref(built)
    } else {
      ref.current = built
    }
  }

  return (
    <group>
      <primitive object={built.mesh} />
      <primitive object={built.glow} />
    </group>
  )
})
