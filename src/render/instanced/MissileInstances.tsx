import { useMemo, forwardRef } from 'react'
import * as THREE from 'three'
import { Materials } from '../materials/registry.ts'
import { registry } from '../disposal.ts'
import { merge } from '../geometry/shapes.ts'
import { MAX_MISSILES } from '../../game/data/constants.ts'

export interface MissileRefs {
  mesh: THREE.InstancedMesh
  /** The motor plume, a second instanced pass behind each body. */
  flame: THREE.InstancedMesh
}

/**
 * Where the plume's mouth sits behind the missile's centre, u.
 *
 * Follows from the motor bell below — a 0.24 u cylinder centred on z = -0.86,
 * so its rear face is at -0.98 — and parks the cone's mouth just inside it, so
 * the flame emerges from the bell rather than starting in free space behind it.
 */
export const MISSILE_FLAME_ANCHOR = 0.95

/**
 * A missile that looks like a missile.
 *
 * It was a plain 8-sided cylinder in flat unlit orange: a lozenge, with no
 * nose, no fins, no motor, and nothing to tell you which end was which or how
 * fast it was going. Silhouette is what makes a small fast object legible at
 * distance, so the body is now an ogive nose, a tapered airframe and four
 * cruciform fins, in *lit metal* — and the heat is a separate additive cone at
 * the tail, which is the only part that should glow.
 */
export const MissileInstances = forwardRef<MissileRefs, object>((_, ref) => {
  const built = useMemo(() => {
    const parts: THREE.BufferGeometry[] = []

    // Nose cone: a shallow ogive, pointing +Z.
    const nose = new THREE.ConeGeometry(0.34, 1.05, 12)
    nose.rotateX(Math.PI / 2)
    nose.translate(0, 0, 1.28)
    parts.push(nose)

    // Airframe, slightly tapered toward the tail.
    const body = new THREE.CylinderGeometry(0.34, 0.3, 1.55, 12)
    body.rotateX(Math.PI / 2)
    body.translate(0, 0, 0.0)
    parts.push(body)

    // Four cruciform fins. Thin boxes are enough at this size and cost far less
    // than an extruded aerofoil nobody will ever see the section of.
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.BoxGeometry(0.06, 0.46, 0.44)
      fin.translate(0, 0.34, -0.62)
      fin.rotateZ((i * Math.PI) / 2)
      parts.push(fin)
    }

    // Motor bell.
    const bell = new THREE.CylinderGeometry(0.22, 0.3, 0.24, 12)
    bell.rotateX(Math.PI / 2)
    bell.translate(0, 0, -0.86)
    parts.push(bell)

    // Through `shapes.merge`, not `mergeGeometries` directly. The primitives
    // here disagree about indexing — three's polyhedra are non-indexed while its
    // lathed and boxed shapes are not — and the raw call signals that by
    // returning **null**, which then fails deep inside three with a message
    // naming neither the geometry nor the caller. Normalising first, and
    // throwing on failure, is exactly what that helper exists for.
    const geo = merge(parts, 'missile')
    for (const part of parts) part.dispose()
    registry.track(geo)

    const mesh = new THREE.InstancedMesh(geo, Materials.missile, MAX_MISSILES)
    mesh.count = 0
    mesh.castShadow = true
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.frustumCulled = false
    registry.track(mesh)

    // The plume: a cone pointing backwards from the bell, additive, scaled per
    // frame so it flickers rather than sitting there as a fixed cardboard flame.
    //
    // Anchored with its mouth on the origin rather than translated back to the
    // bell, because the frame loop scales this in Z and a baked offset would be
    // scaled with it. It was: the mouth swung between z = -0.87 and -1.14 while
    // the bell stayed at -0.98, so at every bright frame the plume unstuck from
    // the nozzle and trailed 0.16 u behind the missile — a detach/reattach
    // strobe at `MISSILE_FLAME_RATE`. With the mouth at zero, Z scale can only
    // stretch the plume *backwards*, which is what a throttling motor does.
    const flameGeo = new THREE.ConeGeometry(0.26, 1.5, 10, 1, true)
    flameGeo.rotateX(-Math.PI / 2)
    flameGeo.translate(0, 0, -0.75)
    registry.track(flameGeo)

    const flame = new THREE.InstancedMesh(flameGeo, Materials.thrustFlame, MAX_MISSILES)
    flame.count = 0
    flame.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    flame.frustumCulled = false
    flame.renderOrder = 4
    registry.track(flame)

    return { mesh, flame }
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
      <primitive object={built.flame} />
    </group>
  )
})
