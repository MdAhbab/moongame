/**
 * Pilot progression — 30 levels, driven entirely by run performance.
 *
 * **XP has exactly one source: `xpFromRun`, fed by `RunSummary`.** No daily
 * rewards, no energy timers, no login streaks, no randomised drops. Every one
 * of those exists to bring a lapsed player back on a schedule the game
 * controls; this game has nothing to sell and nobody to bring back on a
 * schedule, so none of them belong here. XP is a receipt for a run that
 * already happened, not a hook to make you start another one.
 *
 * This paragraph used to open "No currency" as well, and that clause is no
 * longer true: credits are earned from bounties and sector revenue and spent on
 * parts in the Hangar (gameplan §9, amendment of 2026-08-16). The distinction
 * the rest of the list draws still holds exactly — credits come only from
 * performance, cannot be bought, expire on no schedule and buy nothing
 * randomised — which is why the other four clauses survive unchanged.
 *
 * Weighting mirrors `ScoreSystem.ts`'s own thesis — "outposts saved outscore
 * kills by design" — because a progression system that rewarded kills over
 * triage would be teaching the opposite lesson to the one score already
 * teaches, and a player would eventually notice the two systems disagreeing.
 */
import type { RunSummary } from '../core/readModel.ts'
import { OUTPOST_COUNT } from './constants.ts'
import { ALL_PARTS } from './parts.ts'
import { SKINS } from './skins.ts'

/* ------------------------------------------------------------------ */
/* The XP curve                                                        */
/* ------------------------------------------------------------------ */

export const MAX_LEVEL = 30

const LEVEL_CURVE_K = 270
const LEVEL_CURVE_EXPONENT = 1.55

function thresholdForLevel(level: number): number {
  return level <= 1 ? 0 : Math.round(LEVEL_CURVE_K * Math.pow(level - 1, LEVEL_CURVE_EXPONENT))
}

/**
 * Cumulative XP required to *be* each level, index 0 = level 1 = 0 XP.
 *
 * A power curve, not linear or exponential: linear makes the back half of
 * the table a flat grind with no shape, and a pure exponential makes the
 * first few levels feel like nothing happened. `exponent = 1.55` puts level
 * 5 (2315 XP) within reach of roughly three of an average new pilot's early
 * runs, while level 30 (≈49,900 XP) stays a season of well-played ones —
 * reached, not handed out. See `xpFromRun` for what an average run actually
 * pays.
 */
const LEVEL_THRESHOLDS: readonly number[] = Array.from({ length: MAX_LEVEL }, (_, i) => thresholdForLevel(i + 1))

function thresholdAt(index: number): number {
  const value = LEVEL_THRESHOLDS[index]
  if (value === undefined) throw new Error(`progression: level threshold index ${index} out of range`)
  return value
}

/** XP required to reach `level`. Clamped to [1, MAX_LEVEL]. */
export function xpForLevel(level: number): number {
  const clamped = Math.min(MAX_LEVEL, Math.max(1, Math.round(level)))
  return thresholdAt(clamped - 1)
}

/** The pilot level implied by an accumulated XP total. Never exceeds MAX_LEVEL. */
export function levelForXp(xp: number): number {
  const total = Math.max(0, xp)
  let level = 1
  for (let candidate = 2; candidate <= MAX_LEVEL; candidate++) {
    if (total < thresholdAt(candidate - 1)) break
    level = candidate
  }
  return level
}

/** XP still needed to reach the next level, or 0 once MAX_LEVEL is already reached. */
export function xpToNextLevel(xp: number): number {
  const level = levelForXp(xp)
  if (level >= MAX_LEVEL) return 0
  return xpForLevel(level + 1) - Math.max(0, xp)
}

/* ------------------------------------------------------------------ */
/* XP from a run                                                       */
/* ------------------------------------------------------------------ */

/** Per wave reached, win or lose — depth into the 12-wave campaign is progress either way. */
const XP_PER_WAVE_REACHED = 40

/**
 * Per outpost still standing when the run ends. The largest per-unit weight
 * in the formula on purpose: the campaign is a triage problem, not a
 * shooting gallery, so what survives should be worth more than what dies.
 */
const XP_PER_OUTPOST_SAVED = 60

/**
 * Ceiling for full-run accuracy (a 0..1 fraction), scaled linearly rather
 * than in steps — the same reasoning `ScoreSystem.accuracyBonus` uses:
 * 40%→50% should be worth what 80%→90% is, or the formula ends up rewarding
 * threshold-gaming instead of aim.
 */
const XP_ACCURACY_CEILING = 250

/**
 * Per kill — deliberately the smallest per-unit weight here. A kill that
 * doesn't save an outpost is a distraction from the objective, and the
 * reward for it should read as minor, not as the main event.
 */
const XP_PER_KILL = 2

/**
 * A small cut of the final score, so two otherwise-identical runs with
 * different combo play separate slightly. Kept low on purpose — score
 * already amplifies kills and saves through the combo multiplier, and
 * counting that escalation again at full weight would drown out everything
 * above it.
 */
const XP_PER_SCORE_POINT = 0.05

/** Per wave cleared without taking a hit. */
const XP_PER_NO_DAMAGE_WAVE = 25

/** Per wave cleared with every outpost still standing — rarer than a no-damage wave, so worth more. */
const XP_PER_ALL_INTACT_WAVE = 35

/** Flat award for reaching the victory screen at all. */
const XP_VICTORY_BONUS = 300

/**
 * Extra award for a pilot's *first* win. `RunSummary` describes one run in
 * isolation, so `xpFromRun` cannot know on its own whether this run was the
 * first to end in victory — that is profile history, which lives outside
 * this file's remit. The caller passes `isFirstVictory`; every later win
 * still earns `XP_VICTORY_BONUS`, just not this on top of it.
 */
const XP_FIRST_VICTORY_BONUS = 400

/**
 * Converts one run's performance into pilot XP.
 *
 * `duration` is available on `RunSummary` and is deliberately not weighted:
 * paying XP for elapsed time would reward stalling between engagements,
 * which fights the drain clock the entire campaign is built around. Pacing
 * is captured instead through `waveReached` and the victory bonus — how far
 * you got and whether you finished, not how long the clock ran.
 */
export function xpFromRun(summary: RunSummary, isFirstVictory = false): number {
  let xp = 0

  xp += summary.waveReached * XP_PER_WAVE_REACHED
  xp += Math.min(summary.outpostsRemaining, OUTPOST_COUNT) * XP_PER_OUTPOST_SAVED
  xp += summary.accuracy * XP_ACCURACY_CEILING
  xp += summary.totalKills * XP_PER_KILL
  xp += summary.finalScore * XP_PER_SCORE_POINT

  for (const wave of summary.waves) {
    if (wave.noDamage > 0) xp += XP_PER_NO_DAMAGE_WAVE
    if (wave.allIntact > 0) xp += XP_PER_ALL_INTACT_WAVE
  }

  if (summary.victory) {
    xp += XP_VICTORY_BONUS
    if (isFirstVictory) xp += XP_FIRST_VICTORY_BONUS
  }

  return Math.round(xp)
}

/* ------------------------------------------------------------------ */
/* Pilot titles                                                        */
/* ------------------------------------------------------------------ */

export interface PilotTitle {
  readonly level: number
  readonly title: string
  readonly description: string
}

/**
 * One title every five levels. Terse operational ranks, not fantasy ones —
 * this is an outpost defense roster, not a guild — and each description says
 * what changed rather than praising the pilot for changing it.
 */
export const PILOT_TITLES: readonly PilotTitle[] = [
  {
    level: 1,
    title: 'Cadet',
    description: 'Cleared for the simulator queue. Nobody trusts you with a live outpost yet.',
  },
  {
    level: 5,
    title: 'Rated',
    description: 'Cleared to fly a live rotation. Command still reviews every Debrief.',
  },
  {
    level: 10,
    title: 'Line Pilot',
    description: 'Trusted with a rotation and no supervision.',
  },
  {
    level: 15,
    title: 'Section Lead',
    description: 'Enough hours logged that Command asks your read on a wave before it launches.',
  },
  {
    level: 20,
    title: 'Wing Lead',
    description: 'The pilots flying beside you are there because you are.',
  },
  {
    level: 25,
    title: 'Defense Lead',
    description: 'Command defers the hard calls to your Debrief, not the other way round.',
  },
  {
    level: 30,
    title: 'First Pilot',
    description: 'There is no rank above this one. There is just the next wave.',
  },
]

/** The highest title a pilot at `level` has earned. */
export function titleForLevel(level: number): PilotTitle {
  const first = PILOT_TITLES[0]
  if (first === undefined) throw new Error('progression: PILOT_TITLES is empty')
  let current = first
  for (const candidate of PILOT_TITLES) {
    if (candidate.level > level) break
    current = candidate
  }
  return current
}

/* ------------------------------------------------------------------ */
/* Unlocks                                                             */
/* ------------------------------------------------------------------ */

export interface LevelUnlocks {
  readonly parts: readonly string[]
  readonly skins: readonly string[]
}

/**
 * Parts and skins that become available at exactly `level` — not cumulative,
 * so a caller can announce "new this level" on the level-up screen without
 * re-deriving the delta itself.
 */
export function unlocksAtLevel(level: number): LevelUnlocks {
  return {
    parts: ALL_PARTS.filter((part) => part.unlockLevel === level).map((part) => part.id),
    skins: SKINS.filter((skin) => skin.unlock.kind === 'level' && skin.unlock.level === level).map((skin) => skin.id),
  }
}
