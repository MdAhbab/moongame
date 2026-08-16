/**
 * Presentation-facing reads of the world (gameplan §30.2).
 *
 * The render layer may import `core/`, `data/` and `math/` — never `systems/`
 * or `entities/`. Anything the glass needs that is *derived from* simulation
 * state, rather than a system stepping it, lives here so that boundary is a
 * real import rather than a comment.
 *
 * `Aim` is written by `WeaponSystem` each step and read by the renderer the
 * same frame. One object, two consumers, no possible disagreement between the
 * mark on the glass and the round that leaves.
 */
import type { World } from './World.ts'
import { type Vec3, create, cross, length, normalize } from '../math/vec3.ts'

/** World-space aim solutions published for the HUD and the bomb marker. */
export const Aim = {
  /** Magnetised crosshair point. `fire()` aims the round here. */
  reticle: create(),
  reticleMagnetised: false,
  /** Where a bullet fired now would intercept the tracked target. */
  lead: create(),
  leadValid: false,
  /** Where a bomb released this instant would strike the surface. */
  bombImpact: create(),
  bombImpactValid: false,
  /** Seconds of fall between release and impact. */
  bombImpactTime: 0,
}

/** The enemy slot the lock is working on or holding, or -1. Used by the HUD. */
export function trackedTarget(world: Readonly<World>): number {
  const lock = world.craft.lock
  return lock.kind === 'Idle' ? -1 : lock.target
}

const shieldRadial: Vec3 = create()
const shieldTangentA: Vec3 = create()
const shieldTangentB: Vec3 = create()
const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 }
const WORLD_FORWARD: Vec3 = { x: 0, y: 0, z: 1 }

/**
 * Computes a Sentinel's shield outward normal into `out`.
 *
 * The plate lies in the local tangent plane at the Sentinel's position and
 * rotates within it, so the shield is always "sideways" relative to the moon —
 * which is the plane the player actually approaches through.
 * @hot-path
 */
export function sentinelShieldNormal(out: Vec3, world: Readonly<World>, slot: number): Vec3 {
  const enemies = world.enemies
  shieldRadial.x = enemies.body.x[slot] as number
  shieldRadial.y = enemies.body.y[slot] as number
  shieldRadial.z = enemies.body.z[slot] as number
  normalize(shieldRadial)

  cross(shieldTangentA, shieldRadial, WORLD_UP)
  if (length(shieldTangentA) < 1e-6) cross(shieldTangentA, shieldRadial, WORLD_FORWARD)
  normalize(shieldTangentA)
  cross(shieldTangentB, shieldRadial, shieldTangentA)
  normalize(shieldTangentB)

  const angle = enemies.shieldAngle[slot] as number
  out.x = shieldTangentA.x * Math.cos(angle) + shieldTangentB.x * Math.sin(angle)
  out.y = shieldTangentA.y * Math.cos(angle) + shieldTangentB.y * Math.sin(angle)
  out.z = shieldTangentA.z * Math.cos(angle) + shieldTangentB.z * Math.sin(angle)
  return normalize(out)
}
