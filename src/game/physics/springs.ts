/**
 * Damped springs and frame-rate-independent smoothing (gameplan §21.4, §22.4).
 *
 * Rule 5: any per-frame smoothing must use the analytic form. The naive
 * `x += (target − x) · k` is frame-rate dependent — V1's bug class — because
 * `k` is only a linear approximation of `1 − e^(−λΔt)`, and the error grows
 * with Δt. Everything here uses the exact solution instead.
 */
import { type Vec3 } from '../math/vec3.ts'

/**
 * Exponential approach, exact at any Δt:
 *
 *   x ← target + (x − target) · e^(−λ·Δt)
 *
 * `lambda` is the decay rate in s⁻¹: after 1/λ seconds the remaining error has
 * fallen to 1/e of its starting value.
 * @hot-path
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt)
}

/** Componentwise `damp` on a vector, written into `out`. @hot-path */
export function dampVec3(out: Vec3, target: Readonly<Vec3>, lambda: number, dt: number): Vec3 {
  const k = Math.exp(-lambda * dt)
  out.x = target.x + (out.x - target.x) * k
  out.y = target.y + (out.y - target.y) * k
  out.z = target.z + (out.z - target.z) * k
  return out
}

/**
 * Damped-angle approach that takes the short way round the circle.
 * Plain `damp` on a raw angle spins the long way whenever the pair straddles
 * ±π, which reads as the craft snapping through a full rotation.
 * @hot-path
 */
export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  let delta = target - current
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  return current + delta * (1 - Math.exp(-lambda * dt))
}

/**
 * Acceleration commanded by a critically damped PD controller (§22.4):
 *
 *   a = k_p · (target − x) − k_d · ẋ
 *
 * With m = 1, ω_n = √k_p and critical damping is k_d = 2·ω_n. Critically damped
 * is the correct choice here: fastest convergence with *no overshoot*.
 * Underdamped would bob, which is nauseating and turns altitude into a fight;
 * overdamped feels like lag.
 * @hot-path
 */
export function pdAcceleration(error: number, rate: number, kp: number, kd: number): number {
  return kp * error - kd * rate
}

/** Natural frequency of a unit-mass spring with stiffness `kp`. */
export function naturalFrequency(kp: number, mass = 1): number {
  return Math.sqrt(kp / mass)
}

/** The `k_d` that makes a unit-mass spring of stiffness `kp` exactly critically damped. */
export function criticalDamping(kp: number, mass = 1): number {
  return 2 * mass * naturalFrequency(kp, mass)
}

/** ζ = k_d / (2√(k_p·m)). 1 is critical, <1 underdamped, >1 overdamped. */
export function dampingRatio(kp: number, kd: number, mass = 1): number {
  return kd / (2 * Math.sqrt(kp * mass))
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/** Maps `v` from [inMin, inMax] onto [outMin, outMax], clamped at both ends. */
export function remapClamped(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  if (inMax - inMin === 0) return outMin
  return clamp(outMin + ((v - inMin) / (inMax - inMin)) * (outMax - outMin), Math.min(outMin, outMax), Math.max(outMin, outMax))
}
