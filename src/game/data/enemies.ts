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
import { RADIUS_HARVESTER, RADIUS_INTERCEPTOR, RADIUS_SENTINEL } from './constants.ts'

export interface EnemyArchetype {
  readonly kind: EnemyKindValue
  /** Exact name from §7.3. Rule 8 — never a synonym. */
  readonly name: 'Harvester' | 'Interceptor' | 'Sentinel'
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

export const ARCHETYPES: readonly EnemyArchetype[] = [HARVESTER, INTERCEPTOR, SENTINEL]

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
