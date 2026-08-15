/**
 * Semi-implicit (symplectic) Euler integration (gameplan §18.3).
 *
 *   v ← v + a·Δt      velocity first
 *   p ← p + v·Δt      then position, using the NEW velocity
 *
 * The order is what makes it symplectic. It costs exactly what explicit Euler
 * costs and is dramatically more stable for the spring-damper systems in §22.4,
 * conserving energy over long runs instead of drifting.
 *
 * RK4 is deliberately rejected (§18.3): four force evaluations per step for
 * accuracy that is imperceptible in tuned arcade flight, where feel is set by
 * the constants in §22.1 rather than by integration error.
 */
import { type Vec3, addScaled } from '../math/vec3.ts'

/** @hot-path */
export function integrate(position: Vec3, velocity: Vec3, acceleration: Readonly<Vec3>, dt: number): void {
  addScaled(velocity, acceleration, dt)
  addScaled(position, velocity, dt)
}

/** Position-only advance, for bodies whose velocity is set directly. @hot-path */
export function advancePosition(position: Vec3, velocity: Readonly<Vec3>, dt: number): void {
  addScaled(position, velocity, dt)
}
