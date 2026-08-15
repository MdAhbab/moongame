/**
 * Fixed-timestep accumulator (gameplan §18.2).
 *
 * The fix for V1's single largest bug class. V1 had no delta time anywhere —
 * `speed += ACCELERATION`, `frameCount % ENEMY_SPAWN_RATE`, `shieldTimer--` —
 * so a 144 Hz display ran the game 2.4× faster than 60 Hz, and physics, spawn
 * rate, cooldowns and power-up durations all scaled with refresh rate.
 *
 *   accumulator += min(realDeltaTime, MAX_ACCUM)
 *   while accumulator >= FIXED_DT:
 *       previousState = currentState
 *       step(FIXED_DT)
 *       accumulator -= FIXED_DT
 *   alpha = accumulator / FIXED_DT
 *   render(lerp(previousState, currentState, alpha))
 *
 * Two implementation choices worth stating:
 *
 * 1. Time is accumulated in *units of FIXED_DT* rather than seconds, and the
 *    step count is derived by flooring a single running total rather than by
 *    repeated subtraction. Repeated subtraction accumulates rounding error at a
 *    different rate for each frame cadence, which is enough to make 144 Hz run
 *    one step more or fewer than 60 Hz over ten seconds — and §37.3 requires
 *    those to produce *identical* state, not merely similar state.
 *
 * 2. `EPSILON` absorbs the last ulp of that floor. Without it, ten seconds fed
 *    as 1440 increments of 1/144 lands on 1199.9999999999998 steps instead of
 *    1200, and the framerate-independence test fails on a rounding artefact
 *    rather than on a real behavioural difference.
 */
import { FIXED_DT, MAX_ACCUM, MAX_SUBSTEPS } from '../data/constants.ts'

/** One part in a billion of a step — far below anything observable. */
const EPSILON = 1e-9

export type StepFunction = (dt: number) => void

export class Loop {
  /** Total simulated time, expressed in steps. Fractional part becomes `alpha`. */
  private elapsedSteps = 0
  /** Steps actually executed. */
  private ranSteps = 0

  /** Substeps executed on the most recent `advance`, for the perf overlay (§34.3). */
  lastSubsteps = 0

  /**
   * Feeds real elapsed time and runs whole simulation steps.
   * Returns `alpha`, the interpolation factor for the render bridge.
   *
   * @param realDt seconds since the previous frame, unclamped
   */
  advance(realDt: number, step: StepFunction): number {
    // A negative or non-finite delta can arrive from a clock adjustment or a
    // paused tab; treating it as zero is the only safe reading.
    const dt = Number.isFinite(realDt) && realDt > 0 ? Math.min(realDt, MAX_ACCUM) : 0

    this.elapsedSteps += dt / FIXED_DT

    const target = Math.floor(this.elapsedSteps + EPSILON)
    let due = target - this.ranSteps

    // Belt and braces alongside the MAX_ACCUM clamp: never let one frame run
    // away, even if `elapsedSteps` were somehow advanced out of band.
    if (due > MAX_SUBSTEPS) {
      this.ranSteps = target - MAX_SUBSTEPS
      due = MAX_SUBSTEPS
    }

    for (let i = 0; i < due; i++) {
      step(FIXED_DT)
      this.ranSteps++
    }
    this.lastSubsteps = due > 0 ? due : 0

    const alpha = this.elapsedSteps - this.ranSteps
    return alpha < 0 ? 0 : alpha > 1 ? 1 : alpha
  }

  /**
   * Discards accumulated time. Called on resume so unpausing never produces a
   * catch-up burst (§11 transition rules).
   */
  reset(): void {
    this.elapsedSteps = 0
    this.ranSteps = 0
    this.lastSubsteps = 0
  }

  /** Total steps executed since the last reset. Used by determinism tests. */
  get stepCount(): number {
    return this.ranSteps
  }
}
