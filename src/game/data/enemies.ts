/**
 * Enemy archetypes (gameplan §7.3).
 *
 * Three, distinguished by **silhouette and behaviour first, colour second**
 * (§35.1) — so a player with any form of colour vision deficiency loses no
 * information, and so threat identification works at 40 px in the periphery.
 *
 * Health and damage are held nearly constant across the wave arc on purpose:
 * inflating those makes a game feel *unfair*, while inflating simultaneity and
 * spatial spread makes it feel *demanding* (§10.1).
 */
import { EnemyKind, type EnemyKindValue } from '../core/World.ts'
import {
  RADIUS_CARRIER,
  RADIUS_HARVESTER,
  RADIUS_INTERCEPTOR,
  RADIUS_SAPPER,
  RADIUS_SENTINEL,
  RADIUS_WARDEN,
} from './constants.ts'

export interface EnemyArchetype {
  readonly kind: EnemyKindValue
  /** Exact name from §7.3. Rule 8 — never a synonym. */
  readonly name: 'Harvester' | 'Interceptor' | 'Sentinel' | 'Sapper' | 'Warden' | 'Carrier'
  readonly radius: number
  readonly health: number
  /**
   * Cruise speed, u/s. Scaled by the Enemy Speed accessibility axis (§10.5).
   *
   * Every speed here is a fraction of the player's `V_CRUISE` and moved with it
   * when the craft slowed: a Harvester at 0.58× is something you can always
   * outrun to, an Interceptor at 1.15× is something you cannot, and a Sentinel
   * at 0.31× is a fixture. Those three relationships are the design; the
   * absolute figures are only their units.
   */
  readonly speed: number
  /** Hull damage per hit landed on the player. */
  readonly damage: number
  readonly score: number
  /** Seconds between shots; Infinity for archetypes that never fire. */
  readonly fireInterval: number
  readonly projectileSpeed: number
  /** One-line description used by the Briefing screen. */
  readonly role: string
  readonly silhouette: string
}

export const HARVESTER: EnemyArchetype = {
  kind: EnemyKind.Harvester,
  name: 'Harvester',
  radius: RADIUS_HARVESTER,
  health: 3,
  speed: 15,
  damage: 0,
  score: 0, // resolved at kill time: 150 airborne, 80 landed (§7.7)
  fireInterval: Infinity,
  projectileSpeed: 0,
  role: 'Descends and drains. It is the clock — everything else exists to stop you reaching it.',
  silhouette: 'Squat hexagonal body, four legs. Slow and deliberate.',
}

export const INTERCEPTOR: EnemyArchetype = {
  kind: EnemyKind.Interceptor,
  name: 'Interceptor',
  radius: RADIUS_INTERCEPTOR,
  health: 2,
  speed: 30,
  damage: 4,
  score: 100,
  fireInterval: 2.3,
  projectileSpeed: 76,
  role: 'Hunts you. Makes travel dangerous, so triage is never purely arithmetic.',
  silhouette: 'Narrow swept-back dart. Fast and jittery.',
}

export const SENTINEL: EnemyArchetype = {
  kind: EnemyKind.Sentinel,
  name: 'Sentinel',
  radius: RADIUS_SENTINEL,
  health: 6,
  speed: 8,
  damage: 11,
  score: 250,
  fireInterval: 2.6,
  projectileSpeed: 58,
  role: 'Parks over an outpost behind a directional shield. Converts a time problem into a positioning problem.',
  silhouette: 'Broad angular plate, front-facing shield. Rotates slowly.',
}

/**
 * Sapper — the deadline (§7.3).
 *
 * Every other objective threat gives the player a *clock*: a Harvester drains,
 * and arriving late still saves whatever integrity is left. A Sapper is the one
 * threat with no partial credit — it reaches the outpost or it does not, and the
 * cost of failing to stop it lands all at once.
 *
 * One hit kills it, and it is the fastest thing in the sky. That trade is
 * deliberate: the skill it tests is *noticing in time and committing*, not
 * winning a fight. It never shoots, because a Sapper that could also hurt you
 * would let the player fail for a reason unrelated to the deadline.
 */
export const SAPPER: EnemyArchetype = {
  kind: EnemyKind.Sapper,
  name: 'Sapper',
  radius: RADIUS_SAPPER,
  health: 1,
  speed: 32,
  damage: 0, // dealt by the detonation, not by contact — see entities/Sapper.ts
  score: 120,
  fireInterval: Infinity,
  projectileSpeed: 0,
  role: 'Runs at an outpost and detonates on it. There is no arriving late — you stop it or you do not.',
  silhouette: 'Small forward-swept wedge, no cockpit. Trails a hard bright line.',
}

/**
 * Warden — the priority (§7.3).
 *
 * Projects a field that makes every other hostile inside it immune. It is the
 * Sentinel's question asked from the other side: a Sentinel says *move* — flank
 * the plate, pay in seconds — and a Warden says *retarget*, because no amount of
 * positioning gets damage through. Killing it is a prerequisite, not an option,
 * which is why it is the only archetype whose presence changes what a player
 * should shoot at rather than where they should be.
 *
 * The field is drawn, and it has to be: damage silently failing is the exact
 * fault the Sentinel's visible shield arc was rebuilt to remove.
 */
export const WARDEN: EnemyArchetype = {
  kind: EnemyKind.Warden,
  name: 'Warden',
  radius: RADIUS_WARDEN,
  health: 8,
  speed: 11,
  damage: 7,
  score: 300,
  fireInterval: 3.4,
  projectileSpeed: 62,
  role: 'Shields every hostile around it. Nothing inside its field can be hurt until it is dead.',
  silhouette: 'Three-armed ring on a slim column. The field hangs off the arms.',
}

/**
 * Carrier — the source (§7.3).
 *
 * Holds high station over an outpost and launches a fresh Harvester every
 * `CARRIER_LAUNCH_INTERVAL` seconds, indefinitely. It is the only hostile whose
 * existence *undoes work already done*: an outpost cleared while its Carrier
 * still flies is an outpost that will be threatened again before the player has
 * reached the next one.
 *
 * That makes it the sharpest triage question in the game. Killing a Carrier
 * costs time now — it is slow, tanky and parked far up — and pays in time later,
 * which is the same currency every other decision here is denominated in. It
 * does not shoot at all, so the cost of going after it is purely the seconds,
 * never a fight.
 */
export const CARRIER: EnemyArchetype = {
  kind: EnemyKind.Carrier,
  name: 'Carrier',
  radius: RADIUS_CARRIER,
  health: 14,
  speed: 7,
  damage: 0,
  score: 450,
  fireInterval: Infinity,
  projectileSpeed: 0,
  role: 'Launches a new Harvester every eleven seconds. Clearing the outpost beneath it does not finish it.',
  silhouette: 'Broad slab hull with an open launch bay underneath. The biggest thing in the sky.',
}

/**
 * Indexed by `EnemyKind`. `archetypeOf` looks up positionally, so the order here
 * is the enum's order and not a stylistic choice.
 */
export const ARCHETYPES: readonly EnemyArchetype[] = [
  HARVESTER,
  INTERCEPTOR,
  SENTINEL,
  SAPPER,
  WARDEN,
  CARRIER,
]

/** @hot-path */
export function archetypeOf(kind: number): EnemyArchetype {
  return ARCHETYPES[kind] ?? HARVESTER
}

/**
 * Half-angle of the Sentinel's shield arc, radians.
 * Fire arriving inside this cone of its facing is blocked entirely (§7.3), so
 * the only answer is to flank — which costs time, the scarce resource.
 */
export const SENTINEL_SHIELD_HALF_ANGLE = (72 * Math.PI) / 180

/** Radians per second the Sentinel's shield sweeps. Slow enough to read and plan around. */
export const SENTINEL_SHIELD_RATE = 0.55
