/**
 * Telling a trackpad from a mouse, and tuning for each (gameplan §8.1, §8.5).
 *
 * ## Why one set of numbers cannot serve both
 *
 * Mouse steering is a *rate* control: movement pushes a virtual stick, which
 * decays back to centre. `MOUSE_GAIN` is derived from the equilibrium of that
 * decay so that a sustained 750 px/s sweep reaches full deflection — a firm but
 * comfortable movement with a mouse on a desk.
 *
 * A trackpad cannot produce 750 px/s for any length of time. Its usable throw is
 * about 3 cm against a mouse's 30, so the same gesture yields roughly a third of
 * the deflection, and the player concludes the game does not respond. Worse, the
 * fix a player reaches for — winding the sensitivity slider to 300% — makes small
 * corrections unusable, because the curve was shaped for a device with ten times
 * the resolution.
 *
 * Two devices, two tunings.
 *
 * ## Detection is a heuristic, so it must be overridable
 *
 * There is no API that reports "trackpad". The reliable tell is the shape of the
 * `wheel` stream: a mouse wheel emits large, quantised, infrequent deltas
 * (typically ±100 px in `deltaMode: 0`, or ±3 lines in `deltaMode: 1`), while a
 * trackpad emits a dense run of small, often fractional deltas as the fingers
 * move. That is a strong signal and it is still a guess — a high-resolution
 * mouse wheel can look like a trackpad — so `Pointer: Auto / Mouse / Trackpad`
 * exists in Settings and always wins. Being wrong about the player's hardware is
 * forgivable; being wrong and unfixable is not.
 *
 * Detection is passive: it watches events the game receives anyway and never
 * asks the player to do anything.
 */

export type PointerKind = 'mouse' | 'trackpad' | 'touch'

/** How the player's device is set up. Everything here is presentation-free. */
export interface PointerProfile {
  readonly kind: PointerKind
  /**
   * Multiplier on `MOUSE_GAIN`.
   *
   * A trackpad's short throw needs roughly twice the gain to reach full
   * deflection from a gesture a hand can actually make.
   */
  readonly gain: number
  /**
   * Recentre rate, s⁻¹ — how fast the virtual stick returns to neutral.
   *
   * Faster on a trackpad. A trackpad gesture ends abruptly when the fingers
   * lift, where a mouse sweep decelerates, so a slow recentre leaves the craft
   * turning after the player has stopped asking.
   */
  readonly recentre: number
}

const MOUSE_PROFILE: PointerProfile = { kind: 'mouse', gain: 1, recentre: 6.0 }
const TRACKPAD_PROFILE: PointerProfile = { kind: 'trackpad', gain: 2.1, recentre: 9.0 }
const TOUCH_PROFILE: PointerProfile = { kind: 'touch', gain: 1, recentre: 8.0 }

export function profileFor(kind: PointerKind): PointerProfile {
  switch (kind) {
    case 'trackpad':
      return TRACKPAD_PROFILE
    case 'touch':
      return TOUCH_PROFILE
    default:
      return MOUSE_PROFILE
  }
}

/* ------------------------------------------------------------------ */
/* Detection                                                           */
/* ------------------------------------------------------------------ */

/**
 * A wheel event's fingerprint, reduced to the two facts that separate the
 * devices: how big the step was, and whether it was a whole number.
 *
 * `deltaMode` matters as much as the magnitude. `DOM_DELTA_LINE` (1) is what a
 * classic notched wheel reports and a trackpad essentially never does, so it is
 * treated as conclusive on its own.
 */
export interface WheelSample {
  readonly deltaMode: number
  readonly deltaX: number
  readonly deltaY: number
}

/** Below this, a delta is a fingertip rather than a notch. */
const SMALL_DELTA = 40

/** How many samples before the verdict is trusted. */
const SAMPLES_REQUIRED = 4

class PointerDetector {
  private trackpadEvidence = 0
  private mouseEvidence = 0
  /** Latched once decided, so the verdict cannot flap mid-flight. */
  private decided: PointerKind | null = null

  get verdict(): PointerKind | null {
    return this.decided
  }

  /** Feeds one wheel event. Cheap enough to call unconditionally. */
  observe(sample: WheelSample): void {
    if (this.decided !== null) return

    // A line-mode wheel is a notched mouse wheel, full stop.
    if (sample.deltaMode === 1) {
      this.mouseEvidence += SAMPLES_REQUIRED
    } else {
      const magnitude = Math.max(Math.abs(sample.deltaX), Math.abs(sample.deltaY))
      const fractional = !Number.isInteger(sample.deltaY) || !Number.isInteger(sample.deltaX)
      // Horizontal scroll is a trackpad tell in its own right: two-finger
      // sideways movement is trivial on glass and rare on a wheel.
      const horizontal = Math.abs(sample.deltaX) > 0.5
      if (fractional || horizontal || magnitude < SMALL_DELTA) {
        this.trackpadEvidence += 1
      } else {
        this.mouseEvidence += 1
      }
    }

    if (this.trackpadEvidence >= SAMPLES_REQUIRED) this.decided = 'trackpad'
    else if (this.mouseEvidence >= SAMPLES_REQUIRED) this.decided = 'mouse'
  }

  reset(): void {
    this.trackpadEvidence = 0
    this.mouseEvidence = 0
    this.decided = null
  }
}

const detector = new PointerDetector()

/** Feeds the detector. Called from the input layer's `wheel` handler. */
export function observeWheel(sample: WheelSample): void {
  detector.observe(sample)
}

/** Clears the latched verdict — used when the player switches the override. */
export function resetPointerDetection(): void {
  detector.reset()
}

/**
 * The profile in force, given the player's setting.
 *
 * `'auto'` uses the detector's verdict, falling back to mouse until it has one:
 * a desktop player who never scrolls should get the tuning that has always
 * shipped, not a provisional guess.
 */
export function activeProfile(setting: 'auto' | PointerKind, touchOnly: boolean): PointerProfile {
  if (setting !== 'auto') return profileFor(setting)
  if (touchOnly) return TOUCH_PROFILE
  return profileFor(detector.verdict ?? 'mouse')
}

/** What the detector currently believes, for the Settings screen to show. */
export function detectedPointer(): PointerKind | null {
  return detector.verdict
}
