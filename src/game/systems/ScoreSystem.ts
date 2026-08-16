/**
 * Scoring (gameplan §7.7).
 *
 * | Source | Points |
 * |---|---|
 * | Harvester killed **before landing** | 150 |
 * | Harvester killed after landing | 80 |
 * | Interceptor | 100 |
 * | Sentinel | 250 |
 * | Sapper (§7.3) | 120 |
 * | Warden (§7.3) | 300 |
 * | **Carrier** (§7.3) | **450** |
 * | **Outpost survives a wave** | **400** |
 * | Wave cleared with all outposts intact | 800 |
 * | No-damage wave | 300 |
 *
 * **Outposts saved outscore kills by design.** A player optimising for score is
 * thereby optimising for the thing the game is actually about — which is the
 * only honest way to use a score in a game whose subject is triage.
 *
 * Combo is capped at ×5. V1's was uncapped within a 150-frame window, which
 * produced score inflation rather than skill expression.
 */
import { EnemyKind, type World } from '../core/World.ts'
import { clamp } from '../physics/springs.ts'
import {
  ACCURACY_BONUS_MAX,
  ACCURACY_BONUS_MIN,
  COMBO_MAX,
  COMBO_WINDOW,
  CREDITS_PER_OUTPOST_PERCENT,
  SCORE_CARRIER,
  SCORE_HARVESTER_AIRBORNE,
  SCORE_HARVESTER_LANDED,
  SCORE_INTERCEPTOR,
  SCORE_NO_DAMAGE_WAVE,
  SCORE_OUTPOST_SURVIVED,
  SCORE_SAPPER,
  SCORE_SENTINEL,
  SCORE_WARDEN,
  SCORE_WAVE_ALL_INTACT,
} from '../data/constants.ts'

/** @hot-path */
export function stepScore(world: World, dt: number): void {
  const score = world.score
  if (score.comboTimer > 0) {
    score.comboTimer -= dt
    if (score.comboTimer <= 0) score.combo = 0
  }
}

/**
 * Awards a kill and advances the combo.
 *
 * Called directly by `CollisionSystem` rather than driven off the event queue,
 * because the queue is drained once per *frame* by the render and audio layers
 * and score belongs to the simulation.
 */
export function awardKill(world: World, kind: number, hadLanded: boolean): number {
  const score = world.score
  score.combo = Math.min(COMBO_MAX, score.combo + 1)
  score.comboTimer = COMBO_WINDOW

  let base = 0
  switch (kind) {
    case EnemyKind.Harvester:
      base = hadLanded ? SCORE_HARVESTER_LANDED : SCORE_HARVESTER_AIRBORNE
      score.killsHarvester++
      break
    case EnemyKind.Interceptor:
      base = SCORE_INTERCEPTOR
      score.killsInterceptor++
      break
    case EnemyKind.Sentinel:
      base = SCORE_SENTINEL
      score.killsSentinel++
      break
    case EnemyKind.Sapper:
      base = SCORE_SAPPER
      score.killsSapper++
      break
    case EnemyKind.Warden:
      base = SCORE_WARDEN
      score.killsWarden++
      break
    case EnemyKind.Carrier:
      base = SCORE_CARRIER
      score.killsCarrier++
      break
  }

  const awarded = Math.round(base * Math.max(1, score.combo))
  score.total += awarded
  score.waveScore += awarded
  return awarded
}

/** Registers a hit for the accuracy bonus. @hot-path */
export function registerHit(world: World): void {
  world.score.hits++
}

/** Hits ÷ shots over the run so far, in [0, 1]. */
export function accuracy(world: Readonly<World>): number {
  return world.score.shots > 0 ? clamp(world.score.hits / world.score.shots, 0, 1) : 0
}

/**
 * Accuracy multiplier applied at wave end, ×1.0 to ×2.5 (§7.7).
 *
 * Linear in accuracy rather than stepped, so improving from 40% to 50% is worth
 * the same as 80% to 90% — a stepped bonus would make the last percent before a
 * threshold worth far more than the rest, which rewards threshold-gaming
 * instead of aim.
 */
export function accuracyBonus(world: Readonly<World>): number {
  return ACCURACY_BONUS_MIN + accuracy(world) * (ACCURACY_BONUS_MAX - ACCURACY_BONUS_MIN)
}

/**
 * Settles the wave: survival bonuses, accuracy multiplier, all-intact and
 * no-damage awards, plus sector defense revenue. Returns the itemised totals for the WaveClear breakdown.
 */
export function settleWave(world: World): {
  survivalPoints: number
  accuracyBonusApplied: number
  allIntactBonus: number
  noDamageBonus: number
  waveTotal: number
  creditsEarned: number
} {
  const score = world.score

  let survivors = 0
  let sectorIntegritySum = 0
  for (const outpost of world.outposts) {
    if (outpost.status !== 'Lost') {
      survivors++
      sectorIntegritySum += outpost.integrity
    }
  }

  const survivalPoints = survivors * SCORE_OUTPOST_SURVIVED
  score.outpostsSaved += survivors

  const bonus = accuracyBonus(world)
  const accuracyBonusApplied = Math.round(score.waveScore * (bonus - 1))

  const allIntactBonus = survivors === world.wave.outpostsAtStart && survivors === 8 ? SCORE_WAVE_ALL_INTACT : 0
  const noDamageBonus = world.wave.damageTakenThisWave <= 0 ? SCORE_NO_DAMAGE_WAVE : 0

  const waveTotal = survivalPoints + accuracyBonusApplied + allIntactBonus + noDamageBonus
  score.total += waveTotal

  let creditsEarned = Math.round(sectorIntegritySum * CREDITS_PER_OUTPOST_PERCENT)
  if (world.activePerks.includes('bounty_protocol')) creditsEarned = Math.round(creditsEarned * 1.5)
  world.credits += creditsEarned

  return { survivalPoints, accuracyBonusApplied, allIntactBonus, noDamageBonus, waveTotal, creditsEarned }
}

/**
 * Every hostile killed this run, across all six archetypes.
 *
 * One function rather than a sum spelled out at each call site. The sum was
 * written out at two of them and both listed exactly three archetypes, so adding
 * a fourth would have under-reported the run summary and the pilot XP it feeds
 * — silently, and only for players who got far enough to meet one.
 */
export function totalKills(score: Readonly<World['score']>): number {
  return (
    score.killsHarvester +
    score.killsInterceptor +
    score.killsSentinel +
    score.killsSapper +
    score.killsWarden +
    score.killsCarrier
  )
}

/** Resets per-wave counters. Run totals are untouched. */
export function beginWaveScoring(world: World): void {
  world.score.waveScore = 0
  world.score.combo = 0
  world.score.comboTimer = 0
}
