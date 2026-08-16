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
  /**
   * Sappers for the whole wave (§7.3). Released against threatened outposts on
   * the ordinary spawn cadence, so they arrive *among* the Harvesters rather
   * than as a separate event the player can learn to expect.
   */
  readonly sappers: number
  /** Wardens for the whole wave; each holds station over a threatened outpost. */
  readonly wardens: number
  /**
   * Carriers for the whole wave.
   *
   * Deliberately never more than one per threatened outpost. Two Carriers over
   * one outpost is not twice the decision, it is the same decision with twice
   * the health bar — and the archetype's cost is meant to be the seconds of
   * travel, not the seconds of shooting.
   */
  readonly carriers: number
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
    sappers: 0,
    wardens: 0,
    carriers: 0,
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
    sappers: 0,
    wardens: 0,
    carriers: 0,
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
    sappers: 0,
    wardens: 0,
    carriers: 0,
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
    sappers: 0,
    wardens: 0,
    carriers: 0,
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
    sappers: 0,
    wardens: 0,
    carriers: 0,
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
    sappers: 0,
    wardens: 0,
    carriers: 0,
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
    sappers: 0,
    wardens: 0,
    carriers: 0,
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
    sappers: 3,
    wardens: 0,
    carriers: 0,
    spawnInterval: 1.85,
    drainScale: 1.1,
    newElement: 'Sappers',
    title: 'Scattered',
    briefing:
      'Three outposts, spread wide — and Sappers in among the Harvesters. A Sapper does not drain: it runs flat and fast at an outpost and detonates on it for fourteen points in one stroke. One hit kills it, and there is no arriving late. Watch for the arming flare.',
    intent:
      'Worse geometry, plus the first threat with no partial credit. Every other clock can be arrived at late; this one cannot.',
  },
  {
    number: 9,
    threatened: 3,
    spread: 'moderate',
    harvestersPerOutpost: 4,
    interceptors: 4,
    sentinels: 2,
    sappers: 3,
    wardens: 1,
    carriers: 0,
    spawnInterval: 1.8,
    drainScale: 1.1,
    newElement: 'Wardens',
    title: 'Combined Arms',
    briefing:
      'Everything at once, four Harvesters to an outpost — and a Warden over one of them. Nothing inside its field can be hurt at all. Flanking will not help you here the way it helps against a Sentinel: kill the Warden first, or waste every round you fire.',
    intent:
      'The composition itself is now the difficulty. A Warden makes that literal by changing what to shoot rather than where to stand.',
  },
  {
    number: 10,
    threatened: 4,
    spread: 'wide',
    harvestersPerOutpost: 3,
    interceptors: 5,
    sentinels: 2,
    sappers: 4,
    wardens: 1,
    carriers: 0,
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
    sappers: 3,
    wardens: 2,
    carriers: 1,
    spawnInterval: 1.8,
    drainScale: 1.15,
    newElement: 'Carriers',
    title: 'Siege',
    briefing:
      'Fewer fronts, far harder ones. Three Sentinels to flank, two Wardens to kill first — and a Carrier holding high station, launching a fresh Harvester every eleven seconds. Clear the outpost beneath it and it will be threatened again before you have reached the next one.',
    intent:
      'Back off simultaneity, raise positional cost, and introduce the only threat whose existence undoes work already done.',
  },
  {
    number: 12,
    threatened: 4,
    spread: 'full',
    harvestersPerOutpost: 4,
    interceptors: 6,
    sentinels: 3,
    sappers: 4,
    wardens: 2,
    carriers: 2,
    spawnInterval: 1.7,
    drainScale: 1.2,
    newElement: 'Everything',
    title: 'Sea of Night',
    briefing:
      'Four outposts, as far apart as this moon allows, and all six archetypes in the sky at once. Two Carriers are seeding the board faster than you can clear it, so this is not a wave you finish — it is one you outlast. Hold anything at all and the night is yours.',
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
 * wave harder, it would make spawns silently fail.
 *
 * That budget had to be re-cut when the three late archetypes landed. It was
 * 5 x 5 + 14 + 8 = 47 across three types; six types cannot all keep their old
 * ceilings and still fit. The Harvester block is untouchable — it is the drain
 * clock, and the whole difficulty of a deep wave is how fast integrity falls —
 * so the 25 slots it can claim come off the top and the remaining 23 are split:
 *
 *     harvesters  5 x 5 = 25     the clock, unchanged
 *     interceptors       10      was 14
 *     sentinels           4      was 8
 *     sappers             4      new
 *     wardens             3      new
 *     carriers            2      new
 *                        --
 *                        48
 *
 * Cutting Interceptors and Sentinels rather than shaving all six evenly is the
 * point of the exercise: past a handful, more of either adds volume without
 * adding a decision, while a Carrier or a Warden changes what the player has to
 * *do*. A deep Endless wave is a harder wave than it was, with fewer things in
 * it.
 *
 * The two slots a Carrier's launches need at runtime come out of the same pool.
 * `Carrier.updateLaunch` defers rather than drops when it is full, exactly as
 * `SpawnSystem.release` does, so a saturated board delays pressure instead of
 * quietly losing it.
 *
 * Everything past those ceilings grows in *count* instead, which raises the
 * cost of every route without making any route impossible. All the bounds are
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
    interceptors: Math.min(10, 6 + cycle * 2 + step),
    sentinels: Math.min(4, 2 + Math.floor(cycle / 2)),
    // The late archetypes arrive in Endless from the first synthesised wave.
    // A player only reaches wave 13 by clearing 12, where all three have already
    // been introduced and taught, so there is nothing left to stagger.
    sappers: Math.min(4, 2 + Math.floor(cycle / 2)),
    wardens: Math.min(3, 1 + Math.floor(cycle / 2)),
    carriers: Math.min(2, 1 + Math.floor(cycle / 3)),
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

/**
 * How many of one archetype a wave sends.
 *
 * Keyed by the archetype's own `name`, so the Briefing can walk `ARCHETYPES` and
 * ask rather than carrying a parallel chain of `if`s. It carried one, and the
 * chain ended in a bare `return wave.sentinels > 0` — a fall-through that was
 * correct while there were exactly three archetypes and, the moment there were
 * six, silently claimed a wave contained Sappers, Wardens and Carriers whenever
 * it contained a single Sentinel.
 */
export function archetypeCountInWave(wave: WaveDefinition, name: string): number {
  switch (name) {
    case 'Harvester':
      return wave.harvestersPerOutpost * wave.threatened
    case 'Interceptor':
      return wave.interceptors
    case 'Sentinel':
      return wave.sentinels
    case 'Sapper':
      return wave.sappers
    case 'Warden':
      return wave.wardens
    case 'Carrier':
      return wave.carriers
    default:
      return 0
  }
}

/** Total enemies a wave will produce. Shown on the Briefing (§14.3). */
export function waveEnemyCount(wave: WaveDefinition): number {
  return (
    wave.harvestersPerOutpost * wave.threatened +
    wave.interceptors +
    wave.sentinels +
    wave.sappers +
    wave.wardens +
    wave.carriers
  )
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
