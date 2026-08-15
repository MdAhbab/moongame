/**
 * HRTF spatialisation and the listener on the craft (gameplan §27.3).
 *
 * This is functional, not decorative. The design claim it exists to satisfy is
 * that **an Interceptor behind you is audible before it is visible** — on a
 * sphere the horizon is close, so a chasing Interceptor spends real time in the
 * band where it can be heard and not seen. The Threat Ring reinforces that
 * information rather than duplicating it: the ring tells you a bearing you must
 * look at, the panner tells you a bearing you already know.
 *
 * Everything here is a pure configuration or a parameter write. Panners are
 * created once by the synth's voice pool and reused forever, so nothing in this
 * file allocates after startup (Rule 3).
 *
 * `positionX`/`forwardX`/... are used rather than the deprecated
 * `setPosition`/`setOrientation`: they are `AudioParam`s, so they can be
 * smoothed on the audio thread instead of stepping once per frame, and every
 * browser in the §37.7 matrix has shipped them since Safari 14.1.
 */
import { type Vec3 } from '../game/math/vec3.ts'
import { type TangentFrame } from '../game/physics/tangentFrame.ts'
import {
  LISTENER_SMOOTH_S,
  NEAR_FIELD_U,
  PANNER_DISTANCE_MODEL,
  PANNER_MAX_DISTANCE,
  PANNER_MODEL,
  PANNER_REF_DISTANCE,
  PANNER_ROLLOFF,
} from './audioConstants.ts'

/**
 * Builds a panner with the §27.3 distance law: inverse, ref 20 u, max 400 u.
 *
 * Inverse rather than linear because it is the physical law — a linear model
 * reaches silence at `maxDistance` and then stops carrying any information,
 * whereas inverse keeps a distant Harvester quietly present, which is exactly
 * the cue that tells a player the far side of the sphere is not empty.
 *
 * Startup only. Never called from the frame path.
 */
export function createPanner(context: AudioContext): PannerNode {
  const panner = context.createPanner()
  panner.panningModel = PANNER_MODEL
  panner.distanceModel = PANNER_DISTANCE_MODEL
  panner.refDistance = PANNER_REF_DISTANCE
  panner.maxDistance = PANNER_MAX_DISTANCE
  panner.rolloffFactor = PANNER_ROLLOFF
  // No cone: enemies radiate equally in all directions, and a cone would make
  // audibility depend on an enemy's facing, which the player cannot see.
  panner.coneInnerAngle = 360
  return panner
}

/**
 * Places a voice in the world (§27.3).
 *
 * Written with `setValueAtTime` rather than smoothed: a one-shot is placed once,
 * at the instant it starts, and never moves. Smoothing here would drag the
 * source from wherever the previous user of this pooled panner left it, which
 * is audible as a swoop on the attack.
 *
 * @hot-path
 */
export function positionPanner(panner: PannerNode, x: number, y: number, z: number, time: number): void {
  panner.positionX.setValueAtTime(x, time)
  panner.positionY.setValueAtTime(y, time)
  panner.positionZ.setValueAtTime(z, time)
}

/**
 * Puts the listener on the craft, oriented by its tangent frame (§20.1, §27.3).
 *
 * The frame's `forward` and `up` are already an orthonormal pair — the same
 * pair the camera and the Threat Ring use — so what the player hears, what the
 * camera shows, and what the ring reports cannot disagree.
 *
 * Positions are smoothed rather than stepped: at boost the craft covers ~1 u per
 * frame, and a per-frame step in the listener position is audible as a faint
 * ticking in the HRTF convolution. The 30 ms constant lags by under 2 u, which
 * is a tenth of the panner's reference distance and therefore inaudible.
 *
 * @hot-path
 */
export function orientListener(
  listener: AudioListener,
  position: Readonly<Vec3>,
  frame: Readonly<TangentFrame>,
  time: number,
): void {
  listener.positionX.setTargetAtTime(position.x, time, LISTENER_SMOOTH_S)
  listener.positionY.setTargetAtTime(position.y, time, LISTENER_SMOOTH_S)
  listener.positionZ.setTargetAtTime(position.z, time, LISTENER_SMOOTH_S)

  listener.forwardX.setTargetAtTime(frame.forward.x, time, LISTENER_SMOOTH_S)
  listener.forwardY.setTargetAtTime(frame.forward.y, time, LISTENER_SMOOTH_S)
  listener.forwardZ.setTargetAtTime(frame.forward.z, time, LISTENER_SMOOTH_S)

  listener.upX.setTargetAtTime(frame.up.x, time, LISTENER_SMOOTH_S)
  listener.upY.setTargetAtTime(frame.up.y, time, LISTENER_SMOOTH_S)
  listener.upZ.setTargetAtTime(frame.up.z, time, LISTENER_SMOOTH_S)
}

/**
 * True when an event actually carries a world position.
 *
 * `EventQueue.emit` defaults `x`, `y` and `z` to zero, and zero is the centre
 * of the moon — a point no entity can ever occupy, since the playable shell
 * starts at `R` = 100 u (§7.1). The default is therefore unambiguous as a
 * sentinel, and no separate "has position" flag is needed on the event.
 *
 * @hot-path
 */
export function hasPosition(x: number, y: number, z: number): boolean {
  return x !== 0 || y !== 0 || z !== 0
}

/**
 * True when a source is close enough to the listener that HRTF should be
 * skipped (§27.3).
 *
 * A source at the listener's own position has no direction for the transfer
 * function to encode, and the convolution smears it. The craft's own weapons
 * fire from the listener, so they play flat — which is also correct in
 * gameplay terms: your own cannon is not a bearing you need to locate.
 *
 * @hot-path
 */
export function isNearField(
  listenerPosition: Readonly<Vec3>,
  x: number,
  y: number,
  z: number,
): boolean {
  const dx = x - listenerPosition.x
  const dy = y - listenerPosition.y
  const dz = z - listenerPosition.z
  return dx * dx + dy * dy + dz * dz < NEAR_FIELD_U * NEAR_FIELD_U
}
