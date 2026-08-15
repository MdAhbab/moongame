/**
 * The menu flies itself (gameplan §11, §14.3).
 *
 * The scene stays mounted behind the Title, Hangar and Credits screens, and the
 * world was frozen there — so the first thing anyone saw of this game was a
 * craft parked motionless over a landscape, which is a screenshot rather than a
 * game.
 *
 * ## Why this writes input rather than moving the camera
 *
 * The obvious implementation is a bespoke camera path over a static world, and
 * it is the wrong one. A menu that flies on its own rails eventually stops
 * resembling the game: it can bank in ways the flight model cannot, hold
 * altitudes the shell forbids, and keep looking good after a retune has made the
 * real thing look different. Every one of those is a promise the game then
 * fails to keep in the first ten seconds of play.
 *
 * Writing `world.input` instead means the menu is the *actual game*, flown by an
 * autopilot through the actual flight model, the actual camera rig and the
 * actual physics. If the craft looks good here it looks good in a run, and if a
 * retune breaks the feel it is visible on the front page.
 *
 * ## What it does not do
 *
 * No enemies, no drain, no score, no clock. `stepAttract` only steers; the
 * caller keeps the world out of a wave. A menu that could be lost would be a
 * menu the player has to attend to.
 */
import type { World } from '../core/World.ts'
import { ALT_CRUISE } from '../data/constants.ts'

/**
 * How long one full turn of the steering pattern takes, seconds.
 *
 * Deliberately not a divisor of anything: the yaw and the altitude sweep run on
 * periods with an irrational ratio, so the path never visibly repeats and the
 * attract loop cannot be caught doing the same lap twice.
 */
const YAW_PERIOD = 23
const ALTITUDE_PERIOD = 23 * Math.SQRT2

/** Peak steering deflection. Gentle — this is a cruise, not a demo of turning. */
const YAW_AMPLITUDE = 0.32

/** Peak altitude deflection, as a fraction of the command axis. */
const ALTITUDE_AMPLITUDE = 0.35

/**
 * Flies the menu. Called from `stepWorld` while the world is in `Attract`.
 *
 * Allocation-free and framerate-independent: everything is a function of
 * `world.time`, so the path is identical at 60 Hz and at 144 Hz, and identical
 * across a pause.
 * @hot-path
 */
export function stepAttract(world: World): void {
  const input = world.input
  const t = world.time

  input.steerX = Math.sin((t / YAW_PERIOD) * Math.PI * 2) * YAW_AMPLITUDE
  input.steerY = 0
  input.strafe = 0
  input.throttle = 1
  input.firing = false
  input.locking = false
  input.boosting = false
  input.requestLockTarget = -1

  // Drifts up and down through the middle of the shell, so the horizon moves
  // and the terrain is seen from more than one height. Clamped well inside
  // `ALT_MIN`/`ALT_MAX` so the autopilot never scrapes the ground on the menu.
  // Centred below cruise, and with a narrow band, so the terrain stays in the
  // lower third of the frame. High up, the moon shrinks to a sliver at the
  // bottom of the screen and the menu loses the one thing it is there to show.
  const target = ALT_CRUISE - 7 + Math.sin((t / ALTITUDE_PERIOD) * Math.PI * 2) * 6
  const altitude = world.craft.altitudeTarget
  input.climb = Math.max(-1, Math.min(1, (target - altitude) * 0.25)) * ALTITUDE_AMPLITUDE
}
