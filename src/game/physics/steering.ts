/**
 * Steering forces (gameplan §20.5).
 *
 *   desired  = normalize(p_target − p_self) · v_max
 *   steering = clamp(desired − v_self, max_force)
 *   a       += steering / m
 *
 * Produces smooth pursuit with natural overshoot and correction, rather than
 * V1's `lookAt` plus straight-line motion, which read as robotic and was
 * trivially exploitable — you could stand still and let enemies queue up.
 *
 * Lives in `physics/` rather than in each entity because all three archetypes
 * share it; only their targets and limits differ.
 */
import { type Vec3, create, length, scale, sub, addScaled } from '../math/vec3.ts'

const desired: Vec3 = create()
const steering: Vec3 = create()

/**
 * Accumulates a seek force into `velocity`.
 *
 * @param maxSpeed the speed the body converges on
 * @param maxForce the per-second acceleration cap — lower values give a wider,
 *                 lazier turn, which is what separates a Harvester's deliberate
 *                 approach from an Interceptor's jitter
 * @hot-path
 */
export function seek(
  velocity: Vec3,
  position: Readonly<Vec3>,
  target: Readonly<Vec3>,
  maxSpeed: number,
  maxForce: number,
  dt: number,
): void {
  sub(desired, target, position)
  const distance = length(desired)
  if (distance < 1e-6) return
  scale(desired, desired, maxSpeed / distance)

  sub(steering, desired, velocity)
  const magnitude = length(steering)
  if (magnitude > maxForce) scale(steering, steering, maxForce / magnitude)

  addScaled(velocity, steering, dt)
}

/**
 * Seek, but easing to a stop inside `slowRadius` — used where an enemy must
 * settle onto a station rather than overshoot it (the Sentinel's orbit post,
 * the Harvester's landing site).
 * @hot-path
 */
export function arrive(
  velocity: Vec3,
  position: Readonly<Vec3>,
  target: Readonly<Vec3>,
  maxSpeed: number,
  maxForce: number,
  slowRadius: number,
  dt: number,
): void {
  sub(desired, target, position)
  const distance = length(desired)
  if (distance < 1e-6) {
    scale(velocity, velocity, Math.exp(-6 * dt))
    return
  }

  const speed = distance < slowRadius ? maxSpeed * (distance / slowRadius) : maxSpeed
  scale(desired, desired, speed / distance)

  sub(steering, desired, velocity)
  const magnitude = length(steering)
  if (magnitude > maxForce) scale(steering, steering, maxForce / magnitude)

  addScaled(velocity, steering, dt)
}

/**
 * Lead prediction for a shot at a moving target (§21.2).
 *
 *   t     = ‖p_target − p_shooter‖ / v_projectile
 *   p_aim = p_target + v_target · t
 *
 * A closed form is used because one exists and it is both exact and cheaper
 * than iterating — §21.2's rule is that analytic solutions are used wherever
 * they are available. Drag over the short flight is negligible.
 * @hot-path
 */
export function predictAim(
  out: Vec3,
  shooter: Readonly<Vec3>,
  target: Readonly<Vec3>,
  targetVelocity: Readonly<Vec3>,
  projectileSpeed: number,
): Vec3 {
  sub(out, target, shooter)
  const range = length(out)
  const flightTime = projectileSpeed > 1e-6 ? range / projectileSpeed : 0
  out.x = target.x + targetVelocity.x * flightTime
  out.y = target.y + targetVelocity.y * flightTime
  out.z = target.z + targetVelocity.z * flightTime
  return out
}
