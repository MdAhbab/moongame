/**
 * Swept-sphere continuous collision — the V1 tunneling fix (gameplan §23.2).
 *
 * V1 checked `distanceTo` once per frame with projectiles moving 5 u/frame
 * against ~2 u targets (`game.js:730`), so fast shots teleported straight
 * through enemies. That is why V1's shooting felt unreliable.
 *
 * V2 solves the ray-sphere intersection analytically across the substep. Given
 * a projectile at **p** with velocity **v** over Δt against a target centred at
 * **c** with combined radius `r_sum`:
 *
 *   m  = p − c
 *   a  = v · v
 *   b  = 2 (m · v)
 *   C  = m·m − r_sum²
 *
 *   discriminant = b² − 4·a·C
 *   if discriminant < 0:  no hit
 *   t = (−b − √discriminant) / (2a)
 *   hit if 0 ≤ t ≤ Δt
 *
 * Three dot products and a quadratic solve.
 *
 * Note on the spec's pseudocode: §23.2 names the target centre `c` and the
 * constant term `c₀`, then writes the discriminant as `b² − 4ac`. Taken
 * literally that multiplies by the centre *vector*. The constant term is
 * plainly what is meant, so it is named `C` here to remove the ambiguity.
 */
import { type Vec3 } from '../../math/vec3.ts'

export interface SweepHit {
  /** Fraction of the substep at which contact occurs, in [0, 1]. */
  t: number
  /** Exact contact point, `p + v·t·dt`. */
  x: number
  y: number
  z: number
}

/** Reused across every narrowphase test in a step, so the sweep allocates nothing. */
const hitResult: SweepHit = { t: 0, x: 0, y: 0, z: 0 }

/**
 * Sweeps a moving point-sphere against a stationary sphere over one substep.
 *
 * Returns the shared result object on contact, or `null`. The object is
 * overwritten by the next call — read what you need before testing again.
 *
 * The impact point is `p + v·t` rather than the target's centre, so sparks
 * appear exactly where the shot landed. That is a small thing which makes hits
 * feel precise.
 *
 * @hot-path
 */
export function sweepSphere(
  origin: Readonly<Vec3>,
  velocity: Readonly<Vec3>,
  dt: number,
  centre: Readonly<Vec3>,
  radiusSum: number,
): SweepHit | null {
  const mx = origin.x - centre.x
  const my = origin.y - centre.y
  const mz = origin.z - centre.z

  const C = mx * mx + my * my + mz * mz - radiusSum * radiusSum

  // Already overlapping at the start of the substep — a hit at t = 0.
  if (C <= 0) {
    hitResult.t = 0
    hitResult.x = origin.x
    hitResult.y = origin.y
    hitResult.z = origin.z
    return hitResult
  }

  const vx = velocity.x * dt
  const vy = velocity.y * dt
  const vz = velocity.z * dt

  const a = vx * vx + vy * vy + vz * vz
  if (a < 1e-12) return null // not moving this substep

  const b = 2 * (mx * vx + my * vy + mz * vz)
  if (b >= 0) return null // moving away from the target

  const disc = b * b - 4 * a * C
  if (disc < 0) return null

  const t = (-b - Math.sqrt(disc)) / (2 * a)
  if (t < 0 || t > 1) return null

  hitResult.t = t
  hitResult.x = origin.x + vx * t
  hitResult.y = origin.y + vy * t
  hitResult.z = origin.z + vz * t
  return hitResult
}

/**
 * Sweeps a moving sphere against a *moving* sphere by working in the target's
 * rest frame — the relative velocity reduces it to the stationary case.
 * Used for projectile-vs-Interceptor, where both are fast.
 * @hot-path
 */
export function sweepSphereMoving(
  origin: Readonly<Vec3>,
  velocity: Readonly<Vec3>,
  dt: number,
  centre: Readonly<Vec3>,
  centreVelocity: Readonly<Vec3>,
  radiusSum: number,
): SweepHit | null {
  relative.x = velocity.x - centreVelocity.x
  relative.y = velocity.y - centreVelocity.y
  relative.z = velocity.z - centreVelocity.z
  const hit = sweepSphere(origin, relative, dt, centre, radiusSum)
  if (hit === null) return null
  // Report the contact point in world space, not the target's rest frame.
  hit.x = origin.x + velocity.x * dt * hit.t
  hit.y = origin.y + velocity.y * dt * hit.t
  hit.z = origin.z + velocity.z * dt * hit.t
  return hit
}

const relative: Vec3 = { x: 0, y: 0, z: 0 }

/**
 * The naive per-frame check V1 used, kept only so the regression test can
 * demonstrate the case it misses: a projectile at 220 u/s against a 2.4 u
 * target passes clean through between samples (§37.1).
 */
export function naiveDistanceCheck(
  origin: Readonly<Vec3>,
  velocity: Readonly<Vec3>,
  dt: number,
  centre: Readonly<Vec3>,
  radiusSum: number,
): boolean {
  const ex = origin.x + velocity.x * dt - centre.x
  const ey = origin.y + velocity.y * dt - centre.y
  const ez = origin.z + velocity.z * dt - centre.z
  return ex * ex + ey * ey + ez * ez <= radiusSum * radiusSum
}
