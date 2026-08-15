/**
 * Radial gravity (gameplan §22.2).
 *
 *   a_gravity = −g · û = −g · (p / ‖p‖)
 *
 * "Down" always points at the moon's centre and therefore differs at every
 * position. This one line is the entire reason no off-the-shelf physics engine
 * fits (§18.1) — Rapier, Cannon-es, Ammo and Matter all assume a uniform
 * gravity vector, so each would need per-body custom force application every
 * step, which is most of what they exist to do for you.
 */
import { type Vec3, addScaled } from '../math/vec3.ts'

/**
 * Accumulates gravitational acceleration into `acceleration`.
 * `up` must already be the unit radial at the body's position.
 * @hot-path
 */
export function applyGravity(acceleration: Vec3, up: Readonly<Vec3>, g: number): void {
  addScaled(acceleration, up, -g)
}
