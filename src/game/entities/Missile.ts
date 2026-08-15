/**
 * Lock missile with proportional-navigation guidance (gameplan §7.4, §20.6).
 *
 * Real guided munitions use proportional navigation, and it reads dramatically
 * better than lerping toward the target because the missile *leads* rather than
 * chases:
 *
 *   LOS   = p_target − p_missile
 *   λ̇     = (LOS × (v_target − v_missile)) / (LOS · LOS)     LOS rotation rate
 *   a_cmd = N · ‖v_closing‖ · λ̇                              N = 3.5
 *
 * The cross product yields the line-of-sight rotation rate; the missile
 * accelerates to null it. The result is an interception arc rather than a
 * tail-chase, which is what makes lock-on feel like a real weapon instead of a
 * homing sprite.
 *
 * One missile per lock, not V1's pair — V1 fired two at a single target, the
 * first killed it, and the second was *always* wasted.
 */
import type { MissileStore, World } from '../core/World.ts'
import { type Vec3, create, cross, dot, lengthSq, normalize, scale, sub, addScaled, length } from '../math/vec3.ts'
import { ALT_CRASH, MISSILE_LIFE, MISSILE_SPEED, MISSILE_TURN_ACCEL, PRONAV_N, R } from '../data/constants.ts'

const los: Vec3 = create()
const relativeVelocity: Vec3 = create()
const omega: Vec3 = create()
const command: Vec3 = create()
const velocity: Vec3 = create()
const targetPosition: Vec3 = create()
const targetVelocity: Vec3 = create()

/** @hot-path */
export function spawnMissile(
  store: MissileStore,
  origin: Readonly<Vec3>,
  direction: Readonly<Vec3>,
  targetSlot: number,
  damage: number,
): number {
  const slot = store.pool.alloc()
  if (slot < 0) return -1
  store.body.spawnAt(
    slot,
    origin.x,
    origin.y,
    origin.z,
    direction.x * MISSILE_SPEED,
    direction.y * MISSILE_SPEED,
    direction.z * MISSILE_SPEED,
  )
  store.life[slot] = MISSILE_LIFE
  store.target[slot] = targetSlot
  store.damage[slot] = damage
  return slot
}

const surfaceRadiusSq = (R + ALT_CRASH) * (R + ALT_CRASH)

/**
 * Guides and integrates every live missile.
 *
 * A missile whose target dies mid-flight keeps its last heading and burns out
 * rather than vanishing — the player watches their commitment miss, which is
 * information about the decision they made.
 * @hot-path
 */
export function stepMissiles(world: World, dt: number): void {
  const store = world.missiles
  const { pool, body, life, target } = store
  const enemies = world.enemies

  for (let i = pool.count - 1; i >= 0; i--) {
    const slot = pool.dense[i] as number
    body.savePrevious(slot)

    const targetSlot = target[slot] as number
    const tracking = targetSlot >= 0 && enemies.pool.active[targetSlot] === 1

    body.readVelocity(slot, velocity)

    if (tracking) {
      targetPosition.x = enemies.body.x[targetSlot] as number
      targetPosition.y = enemies.body.y[targetSlot] as number
      targetPosition.z = enemies.body.z[targetSlot] as number
      targetVelocity.x = enemies.body.vx[targetSlot] as number
      targetVelocity.y = enemies.body.vy[targetSlot] as number
      targetVelocity.z = enemies.body.vz[targetSlot] as number

      los.x = targetPosition.x - (body.x[slot] as number)
      los.y = targetPosition.y - (body.y[slot] as number)
      los.z = targetPosition.z - (body.z[slot] as number)

      const rangeSq = lengthSq(los)
      if (rangeSq > 1e-6) {
        sub(relativeVelocity, targetVelocity, velocity)

        // λ̇ — the line-of-sight rotation rate.
        cross(omega, los, relativeVelocity)
        scale(omega, omega, 1 / rangeSq)

        // Closing speed: the component of relative velocity along the LOS,
        // negated because a closing target has a negative range rate.
        const closing = -dot(relativeVelocity, los) / Math.sqrt(rangeSq)

        // a_cmd = N · |v_closing| · (ω × LOS_unit). Crossing ω back with the
        // sightline turns the rotation rate into a lateral acceleration.
        normalize(los)
        cross(command, omega, los)
        scale(command, command, PRONAV_N * Math.abs(closing))

        const magnitude = length(command)
        if (magnitude > MISSILE_TURN_ACCEL) scale(command, command, MISSILE_TURN_ACCEL / magnitude)

        addScaled(velocity, command, dt)

        // Proportional navigation commands direction, not speed; renormalising
        // keeps the motor thrust constant so the missile does not decelerate
        // through hard turns.
        const speed = length(velocity)
        if (speed > 1e-6) scale(velocity, velocity, MISSILE_SPEED / speed)
        body.writeVelocity(slot, velocity)
      }
    }

    body.x[slot] = (body.x[slot] as number) + velocity.x * dt
    body.y[slot] = (body.y[slot] as number) + velocity.y * dt
    body.z[slot] = (body.z[slot] as number) + velocity.z * dt

    const remaining = (life[slot] as number) - dt
    life[slot] = remaining
    if (remaining <= 0) {
      pool.release(slot)
      continue
    }

    const x = body.x[slot]
    const y = body.y[slot]
    const z = body.z[slot]
    if (x * x + y * y + z * z < surfaceRadiusSq) pool.release(slot)
  }
}
