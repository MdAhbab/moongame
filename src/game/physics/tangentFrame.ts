/**
 * The local tangent-plane basis — the heart of the flight model (gameplan §20.1).
 *
 * At any position **p** the frame is the orthonormal triple `{f̂, r̂, û}`:
 *
 *   û = p / ‖p‖                    radial up, and the exact surface normal (§20.2)
 *   f  = f_prev − (f_prev · û) û   project the heading onto the tangent plane
 *   f̂ = f / ‖f‖
 *   r̂ = f̂ × û                     right-hand basis completion
 *
 * Flight, banking, the camera, and the Threat Ring's bearing projection all
 * operate in this frame, so it is rebuilt from scratch every step rather than
 * integrated — see `orthonormalize`.
 */
import { type Vec3, copy, cross, dot, normalize, projectOntoPlane, anyPerpendicular, length } from '../math/vec3.ts'

export interface TangentFrame {
  /** Radial up. Unit. */
  up: Vec3
  /** Heading, lying in the tangent plane. Unit. */
  forward: Vec3
  /** Right-hand completion, `f̂ × û`. Unit. */
  right: Vec3
}

/**
 * Rebuilds `frame` in place from a position and the previous heading.
 *
 * Called first thing in every simulation step. This is not defensive
 * programming: floating-point drift accumulated over thousands of steps skews
 * the basis visibly within about a minute of play, which shows up as the
 * horizon slowly tilting and the Threat Ring's bearings going wrong.
 *
 * When the heading has collapsed onto the radial axis — flying straight up or
 * down — the projection leaves nothing to normalise, so an arbitrary but
 * deterministic perpendicular is chosen instead of emitting NaN.
 *
 * @hot-path
 */
export function orthonormalize(frame: TangentFrame, position: Readonly<Vec3>): void {
  copy(frame.up, position)
  normalize(frame.up)

  projectOntoPlane(frame.forward, frame.up)
  if (length(frame.forward) < 1e-6) {
    anyPerpendicular(frame.forward, frame.up)
  } else {
    normalize(frame.forward)
  }

  cross(frame.right, frame.forward, frame.up)
  normalize(frame.right)
}

/**
 * Worst-case departure from orthonormality, for the drift test (§37.1: the
 * basis must stay orthonormal over 100k steps with drift < 1e-6).
 */
export function orthonormalityError(frame: Readonly<TangentFrame>): number {
  return Math.max(
    Math.abs(length(frame.up) - 1),
    Math.abs(length(frame.forward) - 1),
    Math.abs(length(frame.right) - 1),
    Math.abs(dot(frame.up, frame.forward)),
    Math.abs(dot(frame.up, frame.right)),
    Math.abs(dot(frame.forward, frame.right)),
  )
}

/**
 * Bearing of a world point relative to the craft's heading, in radians on
 * (-π, π] (§20.7).
 *
 *   d      = normalize(p_target − p_self)
 *   d_tan  = normalize(d − (d · û) û)
 *   bearing = atan2(d_tan · r̂, d_tan · f̂)
 *
 * Two dot products against the tangent basis give the Threat Ring's screen
 * angle directly. `atan2` covers the full ±π range, so a threat behind the
 * player maps to the lower half of the ring rather than folding onto the top.
 *
 * `scratch` is supplied by the caller so this allocates nothing.
 * @hot-path
 */
export function bearingTo(
  frame: Readonly<TangentFrame>,
  self: Readonly<Vec3>,
  target: Readonly<Vec3>,
  scratch: Vec3,
): number {
  scratch.x = target.x - self.x
  scratch.y = target.y - self.y
  scratch.z = target.z - self.z
  normalize(scratch)
  projectOntoPlane(scratch, frame.up)
  normalize(scratch)
  return Math.atan2(dot(scratch, frame.right), dot(scratch, frame.forward))
}
