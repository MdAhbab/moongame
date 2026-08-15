import { useMemo, forwardRef } from 'react'
import * as THREE from 'three'
import { Materials } from '../materials/registry.ts'
import { registry } from '../disposal.ts'
import { merge } from '../geometry/shapes.ts'
import { MAX_BOMBS } from '../../game/core/World.ts'

export interface BombRefs {
  mesh: THREE.InstancedMesh
}

/**
 * A heavy bomb: ogive nose, fat body, boxed tail fins.
 *
 * The silhouette is doing a specific job. A bomb is the one thing in the game
 * that falls on a ballistic arc the player has to read, and reading an arc means
 * seeing the object's *attitude* — a symmetric capsule tells you nothing about
 * which way it is going or that it is tumbling nose-down under gravity. The
 * fins also give the eye something to see rotate, which is what sells the fall
 * as weight rather than as a dropped marble.
 */
export const BombInstances = forwardRef<BombRefs, object>((_, ref) => {
  const built = useMemo(() => {
    const parts: THREE.BufferGeometry[] = []

    const nose = new THREE.SphereGeometry(0.62, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)
    nose.rotateX(Math.PI / 2)
    nose.translate(0, 0, 0.95)
    parts.push(nose)

    const body = new THREE.CylinderGeometry(0.62, 0.5, 1.9, 14)
    body.rotateX(Math.PI / 2)
    parts.push(body)

    // A banded collar, so the casing catches a highlight and reads as machined.
    const collar = new THREE.CylinderGeometry(0.66, 0.66, 0.16, 14)
    collar.rotateX(Math.PI / 2)
    collar.translate(0, 0, 0.15)
    parts.push(collar)

    for (let i = 0; i < 4; i++) {
      const fin = new THREE.BoxGeometry(0.07, 0.62, 0.7)
      fin.translate(0, 0.46, -1.05)
      fin.rotateZ((i * Math.PI) / 2 + Math.PI / 4)
      parts.push(fin)
    }

    // Through `shapes.merge`, not `mergeGeometries` directly. The primitives
    // here disagree about indexing — three's polyhedra are non-indexed while its
    // lathed and boxed shapes are not — and the raw call signals that by
    // returning **null**, which then fails deep inside three with a message
    // naming neither the geometry nor the caller. Normalising first, and
    // throwing on failure, is exactly what that helper exists for.
    const geo = merge(parts, 'bomb')
    for (const part of parts) part.dispose()
    registry.track(geo)

    const mesh = new THREE.InstancedMesh(geo, Materials.bomb, MAX_BOMBS)
    mesh.count = 0
    mesh.castShadow = true
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.frustumCulled = false
    registry.track(mesh)

    return { mesh }
  }, [])

  if (ref) {
    if (typeof ref === 'function') {
      ref(built)
    } else {
      ref.current = built
    }
  }

  return <primitive object={built.mesh} />
})
