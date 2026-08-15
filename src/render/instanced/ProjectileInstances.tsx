import { useMemo, forwardRef } from 'react'
import * as THREE from 'three'
import { Materials } from '../materials/registry.ts'
import { registry } from '../disposal.ts'
import { TRACER_RADIUS } from '../tuning.ts'
import { MAX_PLAYER_PROJECTILES, MAX_ENEMY_PROJECTILES } from '../../game/data/constants.ts'

export interface ProjectileRefs {
  player: THREE.InstancedMesh
  enemy: THREE.InstancedMesh
}

/**
 * Tracers, as streaks rather than dots.
 *
 * ## Why the old ones looked like toys
 *
 * They were 1.4 u camera-facing quads of flat opaque cyan. Two things follow
 * from that and both are wrong. A round travelling 170 u/s crosses 1.4 u in
 * 8 ms, so at any real frame rate the *actual* photographic object is a streak
 * several units long — a round dot is what a bullet looks like only if it is
 * standing still. And an opaque unlit quad cannot read as something hot: light
 * adds to what is behind it, paint covers it.
 *
 * So: a thin capsule, drawn along the direction of travel and stretched to the
 * distance the round covers in a frame, in additive blend. The same geometry
 * serves both sides, at different colours, because the physics is the same.
 */
export const ProjectileInstances = forwardRef<ProjectileRefs, object>((_, ref) => {
  const meshes = useMemo(() => {
    // A unit-length capsule along +Z. The frame loop scales Z to the streak
    // length and X/Y to the calibre, so one geometry serves every round.
    const geo = new THREE.CapsuleGeometry(TRACER_RADIUS, 1, 3, 6)
    geo.rotateX(Math.PI / 2)
    registry.track(geo)

    const p = new THREE.InstancedMesh(geo, Materials.projectile, MAX_PLAYER_PROJECTILES)
    p.count = 0
    p.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    p.frustumCulled = false
    // Drawn after the opaque scene so the additive blend has something to add to.
    p.renderOrder = 4

    const e = new THREE.InstancedMesh(geo, Materials.enemyTracer, MAX_ENEMY_PROJECTILES)
    e.count = 0
    e.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    e.frustumCulled = false
    e.renderOrder = 4

    registry.track(p)
    registry.track(e)

    return { player: p, enemy: e }
  }, [])

  if (ref) {
    if (typeof ref === 'function') {
      ref(meshes)
    } else {
      ref.current = meshes
    }
  }

  return (
    <group>
      <primitive object={meshes.player} />
      <primitive object={meshes.enemy} />
    </group>
  )
})
