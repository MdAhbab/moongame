/**
 * The campaign — twelve authored waves (gameplan §9, §10.2).
 *
 * Static configuration only, no behaviour (§30.2). `SpawnSystem` reads this and
 * decides *where*; this file decides *what* and *why*.
 *
 * Difficulty rises along axes the player can perceive and adapt to (§10.1):
 * simultaneity first, then composition, drain rate, and spatial spread. Enemy
 * health and damage are held nearly constant on purpose — inflating those makes
 * a game feel unfair, while inflating simultaneity and spread makes it feel
 * demanding.
 *
 * Progression is *within* a run. There is no unlock grind and no persistent
 * upgrade tree: the player's capability is constant and the situation gets
 * harder, which keeps the skill expression honest and means the game is fully
 * itself on a judge's first and only run (§9).
 */

/** How far apart this wave's threatened outposts are placed (§10.1 axis 4). */
export type SpatialSpread =
  /** Neighbouring outposts. Both are reachable in sequence. */
  | 'adjacent'
  /** Roughly a quarter-sphere apart. Reachable, but you will spend boost. */
  | 'moderate'
  /** Better than half a hemisphere apart. One of them is going to hurt. */
  | 'wide'
  /** As near to antipodal as the lattice allows. */
  | 'full'

export interface WaveDefinition {
  readonly number: number
  /** Outposts threatened simultaneously — the primary difficulty axis (§10.1). */
  readonly threatened: number
  readonly spread: SpatialSpread
  /** Harvesters sent per threatened outpost. This sets the drain clock. */
  readonly harvestersPerOutpost: number
  /** Interceptors for the whole wave; they hunt the player, not an outpost. */
  readonly interceptors: number
  /** Sentinels for the whole wave; each parks over a threatened outpost. */
  readonly sentinels: number
  /** Seconds between spawn releases, before DDA. */
  readonly spawnInterval: number
  /** Multiplier on the base drain rate (§10.1 axis 3). */
  readonly drainScale: number
  /** The element introduced here, shown on the Briefing. Null when nothing is new. */
  readonly newElement: string | null
  /** In-world wave name, used by the Briefing and the Debrief. */
  readonly title: string
  /** Pre-wave orientation. Real information the player can plan against (§14.3). */
  readonly briefing: string
  /** Why this wave exists. Design intent, surfaced in the Credits tech notes. */
  readonly intent: string
}

/**
 * Wave 3 is deliberately winnable, and Wave 5 deliberately is not.
 *
 * The player's first taste of triage should be one they can solve, so they learn
 * the *shape* of the decision before they meet one with no good answer.
 * Teaching a mechanic and testing it in the same beat is a common design error
 * (§10.2).
 */
export const WAVES: readonly WaveDefinition[] = [
  {
    number: 1,
    threatened: 1,
    spread: 'adjacent',
    harvestersPerOutpost: 2,
    interceptors: 0,
    sentinels: 0,
    spawnInterval: 2.6,
    drainScale: 1,
    newElement: 'Harvesters',
    title: 'First Contact',
    briefing:
      'Two Harvesters are descending on a single outpost. They will land, deploy a drain beam, and take its integrity down at 0.8% a second each. Kill them before the beam finishes and the outpost holds.',
    intent: 'Teach the drain and the kill, with no time pressure worth the name.',
  },
  {
    number: 2,
    threatened: 1,
    spread: 'adjacent',
    harvestersPerOutpost: 3,
    interceptors: 0,
    sentinels: 0,
    spawnInterval: 2.3,
    drainScale: 1,
    newElement: null,
    title: 'Standing Watch',
    briefing:
      'Three Harvesters this time, on one outpost. Three beams drain a third faster than two. You still have room — use it to learn how long the flight actually takes.',
    intent: 'Build confidence. Let the player feel competent before the first real decision.',
  },
  {
    number: 3,
    threatened: 2,
    spread: 'adjacent',
    harvestersPerOutpost: 3,
    interceptors: 0,
    sentinels: 0,
    spawnInterval: 2.2,
    drainScale: 1,
    newElement: 'Simultaneous threats',
    title: 'Two Fires',
    briefing:
      'Two outposts, both under threat, and they are neighbours. Clear the first and you can still reach the second in time. This one you can win outright — find the route.',
    intent: 'First triage, and it is a rehearsal: both are savable. Teach the shape of the decision.',
  },
  {
    number: 4,
    threatened: 2,
    spread: 'moderate',
    harvestersPerOutpost: 3,
    interceptors: 2,
    sentinels: 0,
    spawnInterval: 2.1,
    drainScale: 1,
    newElement: 'Interceptors',
    title: 'Escort',
    briefing:
      'Interceptors are in the sky. They ignore the outposts and hunt you instead, leading their shots. Travel is no longer free — the arc between two outposts is now a place where things happen.',
    intent: 'Make travel dangerous, so triage stops being pure arithmetic.',
  },
  {
    number: 5,
    threatened: 2,
    spread: 'wide',
    harvestersPerOutpost: 3,
    interceptors: 3,
    sentinels: 0,
    spawnInterval: 2.0,
    drainScale: 1.05,
    newElement: null,
    title: 'The Long Way Round',
    briefing:
      'Two outposts, most of a hemisphere apart. Each is savable on its own. Neither route saves both. Decide early — hesitating costs you the one you could have had.',
    intent: 'The first genuine triage. The player is meant to lose one and understand exactly why.',
  },
  {
    number: 6,
    threatened: 2,
    spread: 'moderate',
    harvestersPerOutpost: 3,
    interceptors: 2,
    sentinels: 1,
    spawnInterval: 2.0,
    drainScale: 1.05,
    newElement: 'Sentinels',
    title: 'The Wall',
    briefing:
      'A Sentinel is parked over one of the threatened outposts. Its shield plate blocks everything from the front arc and it turns slowly. You cannot shoot through it — you have to go around, and going around costs seconds.',
    intent: 'Convert a time problem into a positioning problem.',
  },
  {
    number: 7,
    threatened: 3,
    spread: 'moderate',
    harvestersPerOutpost: 3,
    interceptors: 3,
    sentinels: 1,
    spawnInterval: 1.9,
    drainScale: 1.1,
    newElement: 'Three-way pressure',
    title: 'Overload',
    briefing:
      'Three outposts at once. You will not reach all three. Read the Threat Ring, pick the two you can hold, and accept the third — a chosen loss costs less than an indecisive one.',
    intent: 'Overload begins. Teach that accepting a loss deliberately is a legitimate play.',
  },
  {
    number: 8,
    threatened: 3,
    spread: 'wide',
    harvestersPerOutpost: 3,
    interceptors: 4,
    sentinels: 1,
    spawnInterval: 1.85,
    drainScale: 1.1,
    newElement: null,
    title: 'Scattered',
    briefing:
      'Three outposts, spread wide. Boost exists for exactly this — but you get three seconds of it and six to recharge, so spend it on the leg that actually changes the outcome.',
    intent: 'Same simultaneity, worse geometry. Make boost a decision rather than a reflex.',
  },
  {
    number: 9,
    threatened: 3,
    spread: 'moderate',
    harvestersPerOutpost: 4,
    interceptors: 4,
    sentinels: 2,
    spawnInterval: 1.8,
    drainScale: 1.1,
    newElement: 'Mixed composition',
    title: 'Combined Arms',
    briefing:
      'Everything at once, and the Harvesters are coming four to an outpost. Four beams drain in under thirty seconds — barely two crossings of the moon. Anything you clear on the way is time you did not spend clearing it later.',
    intent: 'All three archetypes interacting. The composition itself is now the difficulty.',
  },
  {
    number: 10,
    threatened: 4,
    spread: 'wide',
    harvestersPerOutpost: 3,
    interceptors: 5,
    sentinels: 2,
    spawnInterval: 1.75,
    drainScale: 1.15,
    newElement: 'Four-way pressure',
    title: 'Peak',
    briefing:
      'Four outposts. Half of everything you have left is under the beam at the same time. Hold what you can hold. Every outpost that survives resupplies you for what comes next.',
    intent: 'Peak simultaneity. The hardest arithmetic in the campaign.',
  },
  {
    number: 11,
    threatened: 3,
    spread: 'moderate',
    harvestersPerOutpost: 4,
    interceptors: 4,
    sentinels: 3,
    spawnInterval: 1.8,
    drainScale: 1.15,
    newElement: 'Heavy Sentinels',
    title: 'Siege',
    briefing:
      'Fewer fronts, far harder ones. Three Sentinels, one over each threatened outpost, each needing a flank before you can touch the Harvesters behind it. This is a different shape of hard.',
    intent: 'Back off simultaneity, raise positional cost. Vary the texture before the finale.',
  },
  {
    number: 12,
    threatened: 4,
    spread: 'full',
    harvestersPerOutpost: 4,
    interceptors: 6,
    sentinels: 3,
    spawnInterval: 1.7,
    drainScale: 1.2,
    newElement: 'Everything',
    title: 'Sea of Night',
    briefing:
      'Four outposts, as far apart as this moon allows, every archetype in the sky. Hold anything at all and the night is yours. Whatever is still lit when this ends is what you saved.',
    intent: 'The finale. Clearing it with any outpost standing is a victory.',
  },
]

/* ------------------------------------------------------------------ */
/* Endless mode (§9)                                                   */
/* ------------------------------------------------------------------ */

/**
 * Synthesises wave N for N > 12.
 *
 * Endless is not "the campaign, forever". The twelve authored waves are a
 * dramatic arc with a beginning and an ending, and running them on a loop would
 * flatten that into a treadmill. What Endless continues is the *pressure*, and
 * it does so along the axes §10.1 already names — simultaneity, composition,
 * drain rate — with two deliberate limits.
 *
 * **Simultaneity stops at five of eight.** Threatening every outpost at once is
 * not harder, it is a different and worse game: with nothing safe there is no
 * triage, only a lottery over which four you happen to be near. Capping it
 * keeps the choice a choice.
 *
 * **The drain clock stops at ~18.5 s.** `CROSSING_TIME` — the flight from any
 * point to its antipode at cruise — is 12.1 s. An outpost that falls faster than
 * that is decided by where the spawn happened to put you, not by anything you
 * did; difficulty that removes agency is just noise. Five Harvesters at 1.35× is
 * 5.4 integrity/s, or 18.5 s to drain — the crossing plus about half of it again
 * to actually shoot, which is tight and still a decision.
 *
 * **The total composition stays inside the 48-slot enemy pool.** `startWave`
 * enqueues the whole wave up front, so an unbounded count would not make the
 * wave harder, it would make spawns silently fail. Worst case here is
 * 5 × 5 + 14 + 8 = 47.
 *
 * Everything past those ceilings grows in *count* instead, which raises the
 * cost of every route without making any route impossible. All four bounds are
 * asserted in `tests/unit/endless.test.ts` against the constants they derive
 * from, so changing `R`, `V_CRUISE` or `MAX_ENEMIES` fails there rather than
 * quietly producing an unwinnable wave 40.
 */
function endlessWave(number: number): WaveDefinition {
  // Cycles past the campaign, 0-based. Each cycle is one full turn of the
  // difficulty screw.
  const past = number - WAVES.length
  const cycle = Math.floor((past - 1) / 4)
  const step = (past - 1) % 4

  const threatened = Math.min(5, 3 + (step % 3))
  const spreads: SpatialSpread[] = ['moderate', 'wide', 'full', 'wide']
  const spread = spreads[step] ?? 'wide'

  return {
    number,
    threatened,
    spread,
    harvestersPerOutpost: Math.min(5, 4 + Math.floor(cycle / 3)),
    interceptors: Math.min(14, 6 + cycle * 2 + step),
    sentinels: Math.min(8, 3 + Math.floor(cycle / 2)),
    // Never below the fastest authored wave, and asymptotically approaching a
    // 1.05 s release rather than dropping to zero.
    spawnInterval: Math.max(1.05, 1.7 - cycle * 0.08),
    drainScale: Math.min(1.35, 1.2 + cycle * 0.03),
    newElement: null,
    title: `Long Night ${past}`,
    briefing:
      'No relief rotation is coming. Command has stopped numbering these. ' +
      'Hold what you can hold, for as long as you can hold it.',
    intent: 'Endless: pressure continues along §10.1 axes, capped so triage stays a choice.',
  }
}

/**
 * The definition for wave N, campaign or endless.
 *
 * `waveAt` stays campaign-only on purpose — the Briefing, the balance harness
 * and the wave tests all mean "one of the twelve authored waves" when they ask
 * for one, and quietly returning a synthesised wave 47 to those callers would
 * make `WAVES.length` stop meaning anything.
 */
export function waveDefinition(number: number, endless: boolean): WaveDefinition | undefined {
  const authored = waveAt(number)
  if (authored !== undefined) return authored
  return endless && number > WAVES.length ? endlessWave(number) : undefined
}

/** Total enemies a wave will produce. Shown on the Briefing (§14.3). */
export function waveEnemyCount(wave: WaveDefinition): number {
  return wave.harvestersPerOutpost * wave.threatened + wave.interceptors + wave.sentinels
}

export function waveAt(number: number): WaveDefinition | undefined {
  return WAVES[number - 1]
}

/**
 * Seconds a fully-committed drain takes at this wave's rate — the clock the
 * player is racing. Surfaced on the Briefing so the decision is informed rather
 * than guessed (§14.3).
 */
export function drainDuration(wave: WaveDefinition, baseRatePerHarvester: number): number {
  const rate = baseRatePerHarvester * wave.harvestersPerOutpost * wave.drainScale
  return rate > 0 ? 100 / rate : Infinity
}
