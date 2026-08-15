/**
 * Input conditioning (gameplan §8, §31.1).
 *
 * The platform layers — keyboard/mouse, gamepad, touch — all write raw intent
 * into `world.input`. This system runs *first* inside the fixed step (§31.1:
 * "input before flight, no one-frame lag") and conditions it: deadzone, clamp,
 * and the sanity checks that keep a stuck or malformed value from reaching the
 * physics.
 *
 * Conditioning lives here rather than in the platform layer so every input
 * path gets identical treatment, and so the headless test harness exercises the
 * same code the player does.
 */
import type { World } from '../core/World.ts'
import { clamp } from '../physics/springs.ts'

/** §8.5 — 8% deadzone at centre, to stop drift from a resting stick or mouse. */
const DEADZONE = 0.08

/**
 * Applies a deadzone and rescales the remainder to the full range, so the first
 * unit of movement past the threshold is not a jump.
 * @hot-path
 */
function applyDeadzone(value: number): number {
  const magnitude = Math.abs(value)
  if (magnitude < DEADZONE) return 0
  const scaled = (magnitude - DEADZONE) / (1 - DEADZONE)
  return value < 0 ? -scaled : scaled
}

/** @hot-path */
export function stepInput(world: World): void {
  const input = world.input

  // A NaN reaching the integrator would propagate into position and corrupt
  // every downstream frame, and it is unrecoverable once in the state. Cheaper
  // to reject it here than to hunt it later.
  input.steerX = Number.isFinite(input.steerX) ? clamp(applyDeadzone(input.steerX), -1, 1) : 0
  input.steerY = Number.isFinite(input.steerY) ? clamp(applyDeadzone(input.steerY), -1, 1) : 0
  input.strafe = Number.isFinite(input.strafe) ? clamp(applyDeadzone(input.strafe), -1, 1) : 0
  input.climb = Number.isFinite(input.climb) ? clamp(applyDeadzone(input.climb), -1, 1) : 0
  input.throttle = Number.isFinite(input.throttle) ? clamp(input.throttle, 0, 1) : 0

  // A dead craft holds no intent. Without this, a held fire button would keep
  // the weapon cycling through the respawn.
  if (!world.craft.alive) {
    input.firing = false
    input.locking = false
    input.flaring = false
    input.bombing = false
    input.switchWeapon = false
    input.engineCutToggle = false
    input.boosting = false
    input.deployDrones = false
  }

  deriveEdges(world)
}

/**
 * Turns the four *act* controls from held flags into single-step press edges.
 *
 * This is the whole fix for a weapon-mode toggle that read as broken. The device
 * layer reports what is held, faithfully; the fixed step runs at 120 Hz; so
 * `if (input.switchWeapon) toggle()` ran on every step of the press and the mode
 * ended up wherever the parity of the player's reflexes left it. Deriving the
 * edge here — once, in the system that already conditions every other axis —
 * means every device path and the replay player get identical treatment for
 * free.
 * @hot-path
 */
function deriveEdges(world: World): void {
  const input = world.input
  const previous = world.prevInput

  input.switchWeaponPressed = input.switchWeapon && !previous.switchWeapon
  input.engineCutPressed = input.engineCutToggle && !previous.engineCut
  input.bombPressed = input.bombing && !previous.bombing
  input.flarePressed = input.flaring && !previous.flaring
  input.deployDronesPressed = input.deployDrones && !previous.deployDrones

  previous.switchWeapon = input.switchWeapon
  previous.engineCut = input.engineCutToggle
  previous.bombing = input.bombing
  previous.flaring = input.flaring
  previous.deployDrones = input.deployDrones
}

/** Zeroes every intent. Called on pause and on losing pointer lock. */
export function clearInput(world: World): void {
  const input = world.input
  input.steerX = 0
  input.steerY = 0
  input.strafe = 0
  input.climb = 0
  input.throttle = 0
  input.firing = false
  input.locking = false
  input.flaring = false
  input.bombing = false
  input.switchWeapon = false
  input.engineCutToggle = false
  input.boosting = false
  input.deployDrones = false
  input.requestLockTarget = -1
  input.switchWeaponPressed = false
  input.engineCutPressed = false
  input.bombPressed = false
  input.flarePressed = false
  input.deployDronesPressed = false

  // The edge detector's memory goes with it. The platform layer drops every
  // held key at the same moment (`releaseAllInput`), so after a pause the next
  // `true` on any of these is genuinely a fresh press — remembering the old one
  // would only swallow it.
  world.prevInput.switchWeapon = false
  world.prevInput.engineCut = false
  world.prevInput.bombing = false
  world.prevInput.flaring = false
  world.prevInput.deployDrones = false
}
