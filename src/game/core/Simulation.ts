/**
 * The simulation facade (gameplan §31).
 *
 * Owns the `World` and the fixed-timestep `Loop`, and is the entire surface the
 * application drives. It has no React, no Three.js and no DOM: the app feeds it
 * a delta and reads the result, which is what lets the whole game run headless
 * in a Node test with a scripted player (§37.2).
 */
import { createWorld, resetWorldForRun, survivingOutposts, type World } from './World.ts'
import { Loop } from './Loop.ts'
import { stepWorld, advanceWave } from './step.ts'
import { formatSeed, hashString, Random, waveSeed } from './Random.ts'
import { clearInput } from '../systems/InputSystem.ts'
import { resetSpawner, startWave } from '../systems/SpawnSystem.ts'
import { accuracy, accuracyBonus, settleWave } from '../systems/ScoreSystem.ts'
import { arcDistance } from '../math/spherical.ts'
import type { OutpostTimelineEntry, RunSummary, WaveSummary } from './readModel.ts'
import { BRIEFING_DURATION, HULL_MAX, R, SIM_VERSION, V_CRUISE, WAVE_COUNT } from '../data/constants.ts'
import { InputRecorder, type Replay, type RunContext } from './InputRecorder.ts'
import { waveAt } from '../data/waves.ts'
import { applyLoadout, resolveLoadout, stockLoadout } from '../systems/LoadoutSystem.ts'
import { defaultWorld, worldById } from '../data/worlds.ts'

export class Simulation {
  readonly world: World
  private readonly loop = new Loop()
  private readonly summaries: WaveSummary[] = []

  /**
   * The physical context the current run is being flown in.
   *
   * Held here, rather than only poked into `world` by the shell, because a
   * replay is worthless without it. Gravity and drag vary by world and every
   * flight multiplier varies by equipped parts, so two runs on the same seed
   * with the same inputs legitimately produce different scores. A verifier that
   * replays with defaults therefore rejects every honest run flown anywhere but
   * Luna with stock parts — which was the case until this was added.
   */
  private context: RunContext = { worldId: defaultWorld().id, equipped: {} }

  constructor(seed: string) {
    this.world = createWorld(seed, hashString(seed))
  }

  /**
   * Feeds real elapsed time. Returns `alpha`, the render interpolation factor.
   *
   * The only entry point that advances time. Everything else is a command.
   */
  advance(realDelta: number): number {
    const alpha = this.loop.advance(realDelta, this.stepBound)
    this.world.alpha = alpha
    return alpha
  }

  /**
   * Folds device state into `world.input` at the head of every fixed step.
   *
   * §31.1 puts `InputSystem` *inside* the `while accumulator ≥ FIXED_DT` block,
   * for two reasons that only look like the same reason. The first is latency:
   * sampling outside the loop means a control change can sit unread for a whole
   * frame. The second is determinism: if input is written per *frame*, then a
   * 60 Hz client and a 120 Hz client feed the simulation different input
   * histories over the same ten seconds, and §37.3's identical-state
   * requirement becomes impossible to satisfy no matter how correct the physics
   * is. The platform layers write raw device state into their own buffers; this
   * hook is where that becomes simulation input.
   */
  sampleInput: ((world: World) => void) | null = null

  /**
   * Records every step's input while a run is in progress (§10.4).
   *
   * Sits *between* `sampleInput` and the step, which is the only place it can
   * be: it has to see exactly what the simulation is about to run on — after
   * every device has been combined and conditioned — and it has to normalise
   * that value in place before the step consumes it. Recording in the platform
   * layer would capture pre-conditioning input; recording after the step would
   * capture input the world had already used.
   */
  private recorder: InputRecorder | null = null

  private readonly stepBound = (dt: number): void => {
    this.sampleInput?.(this.world)
    this.recorder?.record(this.world.input)
    stepWorld(this.world, dt)
  }

  /** Begins capturing a replay. Called at the head of every run. */
  startRecording(): void {
    this.recorder = new InputRecorder()
  }

  /** Stops capturing, discarding whatever was recorded. */
  stopRecording(): void {
    this.recorder = null
  }

  /**
   * The replay for the run just played, or `null` if nothing was recorded.
   *
   * Carries `SIM_VERSION`, because a replay is only meaningful against the
   * physics it ran on and there is no honest way to reinterpret one.
   */
  buildReplay(): Replay | null {
    return this.recorder?.build(this.world.runSeed, SIM_VERSION, this.world.endless, this.context) ?? null
  }

  /**
   * Puts the world into a run's physical context: world environment and parts.
   *
   * One method rather than two assignments at the call site, because there are
   * now two callers that must agree exactly — the shell starting a run, and the
   * verifier replaying one — and "agree exactly" is not something two copies of
   * the same four lines have ever managed in this codebase.
   *
   * Takes **identifiers, never multipliers**. The registries are the authority
   * on what a world and a part do, so a client cannot submit a run claiming it
   * flew under a gravity of 0.1: an unknown world falls back to the default and
   * an unknown part falls back to stock, exactly as `resolveLoadout` already
   * does for a corrupt save.
   */
  applyRunContext(context: RunContext): void {
    this.context = { worldId: context.worldId, equipped: { ...context.equipped } }

    const world = worldById(context.worldId) ?? defaultWorld()
    this.world.environment.gravity = world.environment.gravity
    this.world.environment.drag = world.environment.drag

    const equipped = Object.keys(context.equipped).length > 0 ? context.equipped : stockLoadout()
    applyLoadout(this.world.loadout, resolveLoadout(equipped).modifiers)
  }

  /** Steps recorded so far — the size of the pending replay. */
  get recordedSteps(): number {
    return this.recorder?.stepCount ?? 0
  }

  /**
   * Resets the craft to full hull for the equipped loadout.
   *
   * `createCraft()` bakes `HULL_MAX` in at world-creation time, before any
   * loadout exists, so a hull part would otherwise not take effect until the
   * first resupply. Called at the head of every run.
   */
  private resetCraftHull(): void {
    const craft = this.world.craft
    craft.hull = HULL_MAX * this.world.loadout.hullMax
  }

  /**
   * Begins wave 1 after the Briefing beat.
   *
   * `endless` is set here rather than on the constructor because the mode is a
   * property of the *run*, not of the simulation: the player picks it from the
   * Title screen and the same `Simulation` instance serves every run of the
   * session (it is created once and held in a ref, so that the scene is not
   * rebuilt twelve times a campaign).
   */
  startRun(endless = false): void {
    this.world.endless = endless
    resetSpawner()
    resetWorldForRun(this.world)
    this.resetCraftHull()
    this.summaries.length = 0
    this.startRecording()
    this.beginWave(1)
  }

  /**
   * Ends the run where it stands, as a loss.
   *
   * The pause menu's "Abort Run" used to navigate straight to `Results` without
   * telling the simulation anything. `ResultsScreen` renders from `runSummary`,
   * which is only ever written when the *world* reaches `RunOver` — so aborting
   * produced a screen with no summary, which rendered as `null`: a blank page
   * over the live scene, with no buttons and no way back, because `goto` pushes
   * no history for Escape to unwind. "Abort" was a one-way door out of the game.
   *
   * Routing to a screen is not the same as ending a run. This is the ending.
   */
  abortRun(): void {
    if (this.world.phase.kind === 'RunOver') return
    this.world.phase = { kind: 'RunOver', victory: false }
  }

  /**
   * Returns the simulation to the state a fresh one is in, ready for `startRun`.
   *
   * Called when the player reaches the Title screen, and it closes a bug that
   * made the game strictly single-use per page load: `startRun` was only
   * invoked when `wave.number === 0`, so after any finished run — victory,
   * defeat, abort or tutorial — the counter was non-zero and the next "START
   * RUN" walked into a world already parked on `RunOver`. The Briefing showed,
   * the phase poll saw `RunOver` immediately, and the player was bounced to the
   * Debrief for a run they never played. Reloading the page was the only cure.
   *
   * Outposts and terrain survive deliberately: they are the scene behind the
   * menu, and rebuilding them here would flash the Title screen every time
   * somebody backed out of Settings.
   */
  resetRun(): void {
    resetSpawner()
    clearInput(this.world)
    resetWorldForRun(this.world)
    this.summaries.length = 0
    // The menu's autopilot would otherwise be recorded as if it were the
    // player, and every replay would begin with a lap nobody flew.
    this.stopRecording()
    this.world.phase = { kind: 'Attract' }
    this.loop.reset()
  }

  /** Starts a special tutorial run (§12.3). */
  startTutorial(): void {
    this.world.endless = false
    resetSpawner()
    resetWorldForRun(this.world)
    this.resetCraftHull()
    this.summaries.length = 0
    // The tutorial is not a run and produces no score, so there is nothing for
    // a replay to verify. Recording it would only cost memory.
    this.stopRecording()
    this.world.tutorialBeat = 0
    this.world.tutorialProgress = 0
    this.beginWave(1)
  }

  /**
   * True once the player has demonstrated all three tutorial verbs (§12.3).
   * Polled by the shell, which owns the routing out of the tutorial — the
   * simulation has no opinion about screens.
   */
  get tutorialComplete(): boolean {
    return this.world.tutorialBeat >= 3
  }

  /**
   * Reseeds the wave's PRNG before composing it, so wave N is reproducible from
   * the run seed alone and does not depend on how the player played wave N−1
   * (§10.4). Without this, a shared seed would only reproduce the first wave.
   */
  beginWave(number: number): void {
    this.world.rng = new Random(waveSeed(this.world.runSeed, number))
    startWave(this.world, number)
    this.world.phase = { kind: 'Briefing', remaining: BRIEFING_DURATION }
  }

  /**
   * Moves to the next wave, settling the current one first.
   *
   * Called by the UI when the player leaves the Debrief, so the world never
   * runs ahead of what is on screen.
   */
  advanceWave(): void {
    advanceWave(this.world)
  }

  /**
   * Puts the world into its menu state: flying, with nothing to fight.
   *
   * Called when the player reaches the Title screen, immediately after
   * `resetRun`, so the craft the player is looking at behind the menu is a live
   * craft rather than a parked one.
   */
  enterAttract(): void {
    this.world.phase = { kind: 'Attract' }
  }

  /** Skips the Briefing beat. It is a courtesy, never a gate (§14.3). */
  skipBriefing(): void {
    if (this.world.phase.kind === 'Briefing') this.world.phase = { kind: 'Playing' }
  }

  /**
   * Discards accumulated time so resuming never produces a catch-up burst
   * (§11 transition rules). Input is cleared too: a key held at the moment of
   * pause would otherwise still be held on resume.
   */
  resetAccumulator(): void {
    this.loop.reset()
    clearInput(this.world)
  }

  /** Substeps run on the last frame — dev overlay only (§34.3). */
  get substeps(): number {
    return this.loop.lastSubsteps
  }

  get steps(): number {
    return this.loop.stepCount
  }

  get isRunOver(): boolean {
    return this.world.phase.kind === 'RunOver'
  }

  /** Records the finished wave and returns its breakdown for the WaveClear screen. */
  captureWaveSummary(): WaveSummary {
    const summary = buildWaveSummary(this.world)
    this.summaries.push(summary)
    return summary
  }

  buildRunSummary(): RunSummary {
    const world = this.world
    return {
      seed: world.runSeed,
      finalScore: world.score.total,
      waveReached: world.wave.number,
      victory: world.phase.kind === 'RunOver' && world.phase.victory,
      duration: world.time,
      outpostsRemaining: survivingOutposts(world),
      totalKills: world.score.killsHarvester + world.score.killsInterceptor + world.score.killsSentinel,
      accuracy: accuracy(world),
      waves: this.summaries.slice(),
    }
  }
}

/** Generates a human-typeable run seed from an arbitrary integer. */
export function makeRunSeed(value: number): string {
  return formatSeed(value)
}

/* ------------------------------------------------------------------ */
/* Wave summary and cause attribution                                  */
/* ------------------------------------------------------------------ */

function buildWaveSummary(world: World): WaveSummary {
  const timeline: OutpostTimelineEntry[] = world.outposts.map((outpost) => ({
    name: outpost.name,
    threatenedAt: outpost.threatenedAt,
    lostAt: outpost.lostAt,
    finalIntegrity: outpost.integrity,
    survived: outpost.status !== 'Lost',
  }))

  const totals = settleWaveIfNeeded(world)

  return {
    wave: world.wave.number,
    duration: world.wave.elapsed,
    score: world.score.waveScore,
    outpostsSaved: survivingOutposts(world),
    outpostsLost: world.outposts.length - survivingOutposts(world),
    killsHarvester: world.score.killsHarvester,
    killsInterceptor: world.score.killsInterceptor,
    killsSentinel: world.score.killsSentinel,
    shots: world.score.shots,
    hits: world.score.hits,
    accuracy: accuracy(world),
    accuracyBonus: accuracyBonus(world),
    noDamage: totals.noDamageBonus,
    allIntact: totals.allIntactBonus,
    creditsEarned: totals.creditsEarned,
    timeline,
    cause: describeCause(world),
  }
}

/**
 * `settleWave` is normally called by the step that clears the wave. Calling it
 * again here would double-award, so the bonus figures are recomputed without
 * mutating score when the wave has already settled.
 */
function settleWaveIfNeeded(world: World): { noDamageBonus: number; allIntactBonus: number; creditsEarned: number } {
  if (world.wave.cleared) {
    return { noDamageBonus: 0, allIntactBonus: 0, creditsEarned: 0 }
  }
  const settled = settleWave(world)
  return { noDamageBonus: settled.noDamageBonus, allIntactBonus: settled.allIntactBonus, creditsEarned: settled.creditsEarned }
}

/**
 * The Debrief's one job: name the cause in a single sentence (§12.2 P2).
 *
 *   "Lost Cassini at 2:41 — 3 Harvesters landed while you were on the far side."
 *
 * The distance clause is derived from where the craft actually was when the
 * outpost fell, converted into the currency the player thinks in — seconds of
 * flight at cruise — rather than world units, which mean nothing to them.
 *
 * Failure becomes a lesson about the sphere rather than an insult, which is the
 * difference between a loss that teaches and one that frustrates (§13.4).
 */
export function describeCause(world: Readonly<World>): string | null {
  let worst: (typeof world.outposts)[number] | null = null
  for (const outpost of world.outposts) {
    if (outpost.lostAt < 0) continue
    if (worst === null || outpost.lostAt > worst.lostAt) worst = outpost
  }
  if (worst === null) return null

  const drainers = Math.max(1, worst.lostDrainers)
  const plural = drainers === 1 ? 'Harvester' : 'Harvesters'
  const secondsAway = worst.lostArcDistance / V_CRUISE

  let where: string
  if (secondsAway < 2.5) {
    where = 'while you were right on top of it'
  } else if (secondsAway < 5) {
    where = `while you were ${secondsAway.toFixed(0)} seconds out`
  } else if (worst.lostArcDistance > Math.PI * R * 0.6) {
    where = 'while you were on the far side'
  } else {
    where = `while you were ${secondsAway.toFixed(0)} seconds away`
  }

  return `Lost ${worst.name} at ${formatClock(worst.lostAt)} — ${drainers} ${plural} landed ${where}.`
}

/** m:ss, the format the Debrief and the timeline both label times in. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, '0')}`
}

/**
 * Travel time in seconds from the craft to an outpost at cruise (§7.1).
 * Surfaced on the Briefing so the triage decision is informed rather than
 * guessed.
 */
export function secondsToOutpost(world: Readonly<World>, outpostIndex: number): number {
  const outpost = world.outposts[outpostIndex]
  if (outpost === undefined) return Infinity
  return arcDistance(world.craft.position, outpost.position, R) / V_CRUISE
}

/** Total waves in the campaign. Clearing the last with anything standing wins (§9). */
export function campaignLength(): number {
  return Math.min(WAVE_COUNT, waveAt(WAVE_COUNT) !== undefined ? WAVE_COUNT : WAVE_COUNT)
}
