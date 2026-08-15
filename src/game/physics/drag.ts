/**
 * Quadratic drag and its emergent terminal velocity (gameplan §22.3).
 *
 *   a_drag = −k · ‖v‖ · v
 *
 * Proportional to v², matching real high-Reynolds drag, rather than V1's
 * `Math.min(speed, MAX_SPEED)` clamp. Terminal velocity then falls out of the
 * steady state where thrust balances drag:
 *
 *   F = k·v²   →   v_max = √(F / k)
 *
 * Why this matters for feel: speed *approaches* its limit asymptotically
 * instead of hitting a wall, so acceleration tapers naturally and the craft
 * reads as having mass. Boost gives a real felt surge because the terminal
 * velocity itself moves. A hard clamp can never produce either.
 *
 * These numbers set the travel-time budget in §7.1, which sets the difficulty
 * of every triage decision — so they are verified empirically by test rather
 * than assumed (§40 Phase 2 acceptance).
 */
import { type Vec3, addScaled, length } from '../math/vec3.ts'

/** Accumulates drag acceleration into `acceleration`. @hot-path */
export function applyDrag(acceleration: Vec3, velocity: Readonly<Vec3>, k: number): void {
  addScaled(acceleration, velocity, -k * length(velocity))
}

/** Analytic steady-state speed for a given thrust and drag coefficient. */
export function terminalVelocity(thrust: number, k: number): number {
  if (k <= 0 || thrust <= 0) return 0
  return Math.sqrt(thrust / k)
}
