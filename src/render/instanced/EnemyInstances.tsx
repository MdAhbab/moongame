/**
 * The three hostile archetypes, one `InstancedMesh` each.
 *
 * These were briefly loaded from `public/models/*.glb`. Those files were not
 * art: `tools/generate-enemy-models.mjs` built them out of the same Three.js
 * primitives used here and exported the result, so the pipeline round-tripped
 * code through an asset for no gain — and cost three HTTP requests, 42 KB, a
 * loader on the hot path, and a hand-tuned `scale(6, 6, 6)` sitting next to the
 * comment "Scale adjustment" that made every hostile 8 to 18 times larger than
 * the sphere the collision system tests. Building in place lets the scale come
 * from `RADIUS_*` directly (see `fitToReach`), which is the only version of
 * this that cannot drift.
 *
 * Two materials per archetype, indexed by the geometry's groups: hull first,
 * then the lit parts. Six draw calls total, against a budget of 120.
 */
import { useMemo, forwardRef } from 'react'
import * as THREE from 'three'
import { Geometries } from '../geometry/shapes.ts'
import { Materials } from '../materials/registry.ts'
import { registry } from '../disposal.ts'

export interface EnemyRefs {
  harvester: THREE.InstancedMesh
  interceptor: THREE.InstancedMesh
  sentinel: THREE.InstancedMesh
}

/** Matches `MAX_ENEMIES`; every archetype can in principle be the whole field. */
const MAX_PER_ARCHETYPE = 48

function build(
  geometry: THREE.BufferGeometry,
  hull: THREE.Material,
): THREE.InstancedMesh {
  registry.track(geometry)

  const mesh = new THREE.InstancedMesh(geometry, [hull, Materials.enemyGlow], MAX_PER_ARCHETYPE)
  mesh.count = 0
  // Per-instance colour, so one Interceptor can flare white through its attack
  // run while its wingmen stay dark. Without this the tell would have to be a
  // separate mesh or a separate material per state, and both cost a draw call
  // to say something a single vertex attribute can say.
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_ARCHETYPE * 3).fill(1), 3)
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  // Instances are written straight into `instanceMatrix`, so the mesh's own
  // bounding volume never moves off the origin and three would cull the lot.
  mesh.frustumCulled = false
  registry.track(mesh)

  return mesh
}

export const EnemyInstances = forwardRef<EnemyRefs, object>((_, ref) => {
  const meshes = useMemo(
    () => ({
      harvester: build(Geometries.Harvester, Materials.harvesterHull),
      interceptor: build(Geometries.Interceptor, Materials.interceptorHull),
      sentinel: build(Geometries.Sentinel, Materials.sentinelHull),
    }),
    [],
  )

  if (ref) {
    if (typeof ref === 'function') {
      ref(meshes)
    } else {
      ref.current = meshes
    }
  }

  return (
    <group>
      <primitive object={meshes.harvester} />
      <primitive object={meshes.interceptor} />
      <primitive object={meshes.sentinel} />
    </group>
  )
})
