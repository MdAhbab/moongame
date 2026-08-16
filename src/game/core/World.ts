/**
 * The mutable world (gameplan §31.2, §32.1).
 *
 * Simulation state lives here in plain objects and typed arrays — never in
 * `useState`, never in Context, never in zustand. React learns about the
 * simulation only through a throttled HUD sync (§32.2), which is what makes the
 * zero-re-render invariant achievable at all.
 *
 * Entity data is structure-of-arrays over typed arrays so the whole simulation
 * is a handful of large allocations rather than millions of small ones (§34.2).
 *
 * A note on the typed-array reads below: `noUncheckedIndexedAccess` widens every
 * index read to `number | undefined`. Typed arrays are fixed-length and
 * zero-initialised, so that case is unreachable, and the reads are asserted with
 * `as number` rather than branched on. This is the one place in the codebase
 * where an assertion is preferred to a check, because the check would be dead
 * code in the hottest loop in the game.
 */
import { Pool } from './Pool.ts'
import { Random } from './Random.ts'
import { copy, create, zero, type Vec3 } from '../math/vec3.ts'
import { type TangentFrame } from '../physics/tangentFrame.ts'
import { BucketGrid } from '../physics/collision/broadphase.ts'
import { OUTPOSTS, type OutpostName } from '../data/outposts.ts'
import { createEnvironmentModifiers, type EnvironmentModifiers } from '../data/worlds.ts'
import {
  ALT_CRUISE,
  HULL_MAX,
  MAX_ENEMIES,
  MAX_ENEMY_PROJECTILES,
  MAX_MISSILES,
  MAX_PARTICLES,
  MAX_PLAYER_PROJECTILES,
  OUTPOST_COUNT,
  R,
} from '../data/constants.ts'

/* ------------------------------------------------------------------ */
/* Enumerations                                                        */
/* ------------------------------------------------------------------ */

/**
 * §7.3 — six archetypes, distinguished by silhouette and behaviour first.
 *
 * **The numeric values are indices into `ARCHETYPES`** in `data/enemies.ts`, and
 * `archetypeOf` looks them up positionally. Inserting a kind in the middle would
 * renumber every one after it and silently repoint every archetype — so new
 * kinds are appended, in the order they enter the campaign.
 *
 * The first three carry the campaign's teaching arc (waves 1–6): the clock, the
 * pressure, the wall. The last three arrive in the back third, and each exists
 * to ask a question the first three cannot:
 *
 *   Sapper   the deadline  — a threat you cannot arrive late to
 *   Warden   the priority  — a threat that makes the others unkillable
 *   Carrier  the source    — a threat that undoes work you have already done
 */
export const EnemyKind = {
  Harvester: 0,
  Interceptor: 1,
  Sentinel: 2,
  Sapper: 3,
  Warden: 4,
  Carrier: 5,
} as const
export type EnemyKindValue = (typeof EnemyKind)[keyof typeof EnemyKind]

/** Behaviour phase within an enemy's lifetime. */
export const EnemyPhase = {
  /** Ballistic arc in from beyond the horizon. */
  Inbound: 0,
  /** Descending onto the surface beside its target outpost. */
  Landing: 1,
  /** Landed, drain beam deployed, integrity falling. */
  Draining: 2,
  /** Pursuing the player (Interceptor). */
  Pursuing: 3,
  /** Parked in orbit over an outpost (Sentinel). */
  Guarding: 4,
  /**
   * Winding up an attack run (§7.3).
   *
   * The Interceptor stops manoeuvring, lines up, and glows. This is the *tell* —
   * about a second of unmistakable warning before it commits, and the whole
   * reason the archetype is beatable rather than merely survivable.
   */
  Winding: 5,
  /**
   * Committed to the run: full speed, straight line, firing.
   *
   * It cannot correct during this. Braking, sliding or cutting the engine makes
   * it miss, and a miss costs it everything below.
   */
  Diving: 6,
  /**
   * Blown past, slow and turning around — and **exposed**.
   *
   * Takes `EXPOSED_DAMAGE_MULTIPLIER` damage and cannot fire. This is the kill
   * window the whole dance exists to produce: bait the run, break the line, put
   * everything into it while it recovers.
   */
  Exposed: 7,
  /**
   * A Sapper closing on its outpost, before the terminal dive (§7.3).
   *
   * Distinct from `Inbound` because a Sapper's approach is *flat and fast* while
   * a Harvester's is a patient arc, and the two must not be told apart only by
   * the kind field: the render bridge reads the phase to decide whether to draw
   * the arming flare.
   */
  Closing: 8,
  /**
   * Armed, committed, and about to detonate on the surface.
   *
   * The last `SAPPER_ARM_TIME` seconds of a Sapper's life. It cannot be steered
   * away from and it is at its most visible — which is the point: the deadline
   * has to be *seen* expiring, not merely expire.
   */
  Arming: 9,
  /** A Warden holding station with its field up (§7.3). */
  Projecting: 10,
  /** A Carrier on station, cycling its launch clock (§7.3). */
  Launching: 11,
} as const
export type EnemyPhaseValue = (typeof EnemyPhase)[keyof typeof EnemyPhase]

/** §7.2 — outpost lifecycle. Exact names from the spec table. */
export type OutpostStatus = 'Nominal' | 'Threatened' | 'Draining' | 'Critical' | 'Lost'

/** §7.4 — the heat model, as a state machine that cannot be misrepresented. */
export type WeaponState = { kind: 'Ready' } | { kind: 'Overheated'; remaining: number }

/** §7.4 — missile lock. */
export type LockState =
  | { kind: 'Idle' }
  | { kind: 'Acquiring'; target: number; progress: number }
  | { kind: 'Locked'; target: number }

/** The run's own state machine, distinct from the screen router in `state/`. */
export type RunPhase =
  /**
   * The menu is flying itself (§11).
   *
   * A real phase rather than a render-layer trick, because the whole point is
   * that the attract loop *is* the game — the same flight model, the same
   * camera rig, the same physics — so a retune that changes how the craft feels
   * is visible on the front page rather than only after Start.
   */
  | { kind: 'Attract' }
  | { kind: 'Briefing'; remaining: number }
  | { kind: 'Playing' }
  | { kind: 'Respawning'; remaining: number }
  | { kind: 'WaveClear'; remaining: number }
  | { kind: 'RunOver'; victory: boolean }

/* ------------------------------------------------------------------ */
/* Events — a fixed ring buffer, drained by the HUD and audio layers    */
/* ------------------------------------------------------------------ */

export const GameEvent = {
  ShotFired: 0,
  ProjectileHit: 1,
  EnemyKilled: 2,
  PlayerHit: 3,
  DrainStarted: 4,
  OutpostLost: 5,
  OutpostSaved: 6,
  LockAcquired: 7,
  HeatLockout: 8,
  Resupply: 9,
  WaveCleared: 10,
  MissileFired: 11,
  PlayerDestroyed: 12,
  Respawned: 13,
  TerrainImpact: 14,
  RunEnded: 15,
  BoostEngaged: 16,
  TutorialBeatCleared: 17,
  FlareDeployed: 18,
  BombDropped: 19,
  PerkSelected: 20,
  EngineCutToggled: 21,
  /** `a` is 0 for the cannon, 1 for missiles. */
  WeaponSwitched: 22,
  /** A held lock broke — target died, left the cone, or the memory ran out. */
  LockLost: 23,
  /** An Interceptor has begun winding up an attack run. `a` is its slot. */
  AttackRun: 24,
  /** An attack run was beaten: the enemy is in its vulnerable overshoot. */
  Exposed: 25,
  /** A craft subsystem crossed into a damaged state. `a` is the system index. */
  SystemDamaged: 26,
  /** Subsystems repaired to full, at an outpost or by nanites. */
  SystemsRepaired: 27,
  /** An escort drone fired. `a` is the drone slot. */
  DroneFired: 28,
  /** A sortie launched. `a` is how many drones, `b` its duration. */
  DronesLaunched: 29,
  /** A sortie ended. `a` is the *next* tier, `b` is 1 when it was shot down. */
  DronesRecalled: 30,
  /** A drone was destroyed. `a` is its slot. */
  DroneDestroyed: 31,
  /**
   * A Sapper has armed and committed to its terminal dive (§7.3).
   *
   * `a` is the outpost it is aimed at. Its own event rather than a phase the
   * consumers poll, because the *moment* is the tell — the audio cue and the
   * alert band both have to fire once, on the frame it happens, and a polled
   * phase gives them no way to tell "it just armed" from "it is still armed".
   */
  SapperArmed: 32,
  /** A Sapper reached its outpost. `a` is the outpost index. */
  SapperDetonated: 33,
  /** A Carrier launched a Harvester. `a` is the outpost it was launched at. */
  CarrierLaunch: 34,
  /**
   * A shot was absorbed by a Warden's field (§7.3).
   *
   * Emitted at the point of impact so the hit reads as *blocked* rather than as
   * missed. Damage failing without a signal is the fault the Sentinel's visible
   * shield arc exists to prevent, and a radial field has no silhouette to make
   * that obvious on its own.
   */
  WardenAbsorbed: 35,
} as const
export type GameEventType = (typeof GameEvent)[keyof typeof GameEvent]

const EVENT_CAPACITY = 256

/**
 * Ring buffer of this step's events.
 *
 * Fixed capacity and flat typed arrays so emitting an event costs no
 * allocation. Overflow drops the oldest rather than growing — 256 events in a
 * single frame means something is already wrong, and a growing buffer would
 * turn that into a memory leak.
 */
export class EventQueue {
  readonly type = new Uint8Array(EVENT_CAPACITY)
  /** Entity slot, outpost index, or other integer payload. */
  readonly a = new Int32Array(EVENT_CAPACITY)
  /** Magnitude: damage, score, progress. */
  readonly b = new Float32Array(EVENT_CAPACITY)
  /** World position, for spatial audio (§27.3) and particle placement. */
  readonly x = new Float32Array(EVENT_CAPACITY)
  readonly y = new Float32Array(EVENT_CAPACITY)
  readonly z = new Float32Array(EVENT_CAPACITY)

  count = 0

  /** @hot-path */
  emit(type: GameEventType, a = 0, b = 0, x = 0, y = 0, z = 0): void {
    if (this.count >= EVENT_CAPACITY) return
    const i = this.count++
    this.type[i] = type
    this.a[i] = a
    this.b[i] = b
    this.x[i] = x
    this.y[i] = y
    this.z[i] = z
  }

  /** Called once per frame after consumers have read the buffer. @hot-path */
  clear(): void {
    this.count = 0
  }
}

/* ------------------------------------------------------------------ */
/* Entity pools                                                        */
/* ------------------------------------------------------------------ */

/**
 * Position/velocity storage shared by every moving pool.
 *
 * `prevX/Y/Z` holds the position at the start of the current step so the render
 * bridge can interpolate by `alpha` (§18.2). Without it, a 120 Hz simulation
 * shown on a 60 Hz display discards up to 8.3 ms of motion each frame, which
 * reads as judder at speed.
 */
export class BodyStore {
  readonly x: Float64Array
  readonly y: Float64Array
  readonly z: Float64Array
  readonly vx: Float64Array
  readonly vy: Float64Array
  readonly vz: Float64Array
  readonly prevX: Float64Array
  readonly prevY: Float64Array
  readonly prevZ: Float64Array

  constructor(capacity: number) {
    this.x = new Float64Array(capacity)
    this.y = new Float64Array(capacity)
    this.z = new Float64Array(capacity)
    this.vx = new Float64Array(capacity)
    this.vy = new Float64Array(capacity)
    this.vz = new Float64Array(capacity)
    this.prevX = new Float64Array(capacity)
    this.prevY = new Float64Array(capacity)
    this.prevZ = new Float64Array(capacity)
  }

  /** @hot-path */
  savePrevious(slot: number): void {
    this.prevX[slot] = this.x[slot] as number
    this.prevY[slot] = this.y[slot] as number
    this.prevZ[slot] = this.z[slot] as number
  }

  /** @hot-path */
  readPosition(slot: number, out: Vec3): Vec3 {
    out.x = this.x[slot] as number
    out.y = this.y[slot] as number
    out.z = this.z[slot] as number
    return out
  }

  /** @hot-path */
  writePosition(slot: number, v: Readonly<Vec3>): void {
    this.x[slot] = v.x
    this.y[slot] = v.y
    this.z[slot] = v.z
  }

  /** @hot-path */
  readVelocity(slot: number, out: Vec3): Vec3 {
    out.x = this.vx[slot] as number
    out.y = this.vy[slot] as number
    out.z = this.vz[slot] as number
    return out
  }

  /** @hot-path */
  writeVelocity(slot: number, v: Readonly<Vec3>): void {
    this.vx[slot] = v.x
    this.vy[slot] = v.y
    this.vz[slot] = v.z
  }

  /** @hot-path */
  spawnAt(slot: number, px: number, py: number, pz: number, vx = 0, vy = 0, vz = 0): void {
    this.x[slot] = px
    this.y[slot] = py
    this.z[slot] = pz
    this.prevX[slot] = px
    this.prevY[slot] = py
    this.prevZ[slot] = pz
    this.vx[slot] = vx
    this.vy[slot] = vy
    this.vz[slot] = vz
  }
}

/** §31.2 — 48 concurrent enemies. Spawns beyond the cap queue rather than drop. */
export class EnemyStore {
  readonly pool = new Pool(MAX_ENEMIES)
  readonly body = new BodyStore(MAX_ENEMIES)
  readonly kind = new Uint8Array(MAX_ENEMIES)
  readonly phase = new Uint8Array(MAX_ENEMIES)
  readonly hp = new Int16Array(MAX_ENEMIES)
  /** Index into `outposts`, or -1 for enemies with no objective. */
  readonly target = new Int8Array(MAX_ENEMIES)
  /** Seconds remaining in the current phase, where the phase is timed. */
  readonly timer = new Float32Array(MAX_ENEMIES)
  readonly fireCooldown = new Float32Array(MAX_ENEMIES)
  /** Facing, kept so the render bridge can orient instances without deriving it. */
  readonly headingX = new Float32Array(MAX_ENEMIES)
  readonly headingY = new Float32Array(MAX_ENEMIES)
  readonly headingZ = new Float32Array(MAX_ENEMIES)
  /** Sentinel shield facing, rotated slowly so it must be flanked (§7.3). */
  readonly shieldAngle = new Float32Array(MAX_ENEMIES)
  /**
   * Shots fired in the current burst.
   *
   * Its own array because `timer` now means what its comment always said it
   * meant — seconds remaining in the current phase. The Interceptor used to
   * store the burst counter, the pursuit phase offset *and* the phase clock in
   * that one float, truncating it to an integer on every shot, which is why its
   * fanning-out pattern reset every three rounds.
   */
  readonly burst = new Uint8Array(MAX_ENEMIES)
  /** Pursuit phase offset, so a flight of Interceptors fans out. */
  readonly phaseOffset = new Float32Array(MAX_ENEMIES)
  /** Set once the enemy has touched down, so scoring can distinguish 150 from 80 (§7.7). */
  readonly hasLanded = new Uint8Array(MAX_ENEMIES)
}

export class ProjectileStore {
  readonly pool: Pool
  readonly body: BodyStore
  readonly life: Float32Array
  readonly damage: Float32Array
  /**
   * Targets this round has already passed through (Heavy Railgun Slugs).
   *
   * Zero for every ordinary bullet, which is all of them without the perk. Kept
   * on the projectile rather than derived at the hit, because "how many has this
   * one hit" is a fact about the round in flight and nothing else knows it.
   */
  readonly pierced: Uint8Array

  constructor(capacity: number) {
    this.pool = new Pool(capacity)
    this.body = new BodyStore(capacity)
    this.life = new Float32Array(capacity)
    this.damage = new Float32Array(capacity)
    this.pierced = new Uint8Array(capacity)
  }
}

export class MissileStore {
  readonly pool = new Pool(MAX_MISSILES)
  readonly body = new BodyStore(MAX_MISSILES)
  readonly life = new Float32Array(MAX_MISSILES)
  /**
   * Damage captured at launch, mirroring `ProjectileStore`.
   *
   * Reading a global at *impact* would let a loadout change mid-flight rewrite
   * what an already-committed missile does — and the lock that launched it cost
   * the player 1.2 s of attention, so it should pay out at the value it was
   * fired with.
   */
  readonly damage = new Float32Array(MAX_MISSILES)
  /** Enemy slot being tracked, or -1 once the target has died. */
  readonly target = new Int32Array(MAX_MISSILES)
}

/** Escort drones (§7.4). Also the top tier of the drone bay. */
export const MAX_DRONES = 4

/**
 * The player's escort drones.
 *
 * They fly a formation slot rather than a physics body: a drone that had to be
 * flown would need its own flight model, its own collision and its own failure
 * modes, and none of that is what the ability is *for*. It is for a second gun
 * that follows you. So the position is a spring toward an orbiting anchor,
 * which keeps them legible in a dogfight and costs nothing.
 */
export class DroneStore {
  readonly pool = new Pool(MAX_DRONES)
  readonly body = new BodyStore(MAX_DRONES)
  /** Angle around the craft, radians. Spaced evenly as drones are added. */
  readonly angle = new Float32Array(MAX_DRONES)
  readonly fireCooldown = new Float32Array(MAX_DRONES)
  /** Enemy slot currently engaged, or -1. */
  readonly target = new Int32Array(MAX_DRONES)
  /** Remaining hull. Enemy fire takes drones out of the formation (§7.4). */
  readonly health = new Float32Array(MAX_DRONES)
}

/**
 * The drone bay — a called ability with a ladder attached.
 *
 * `tier` is the size of the *next* sortie and the whole point of the mechanic:
 * bring the formation home alive and it grows, lose one and it starts over. So
 * the interesting decision is not when to press the key, it is whether to keep
 * flying aggressively while four drones you have spent three sorties earning
 * are following you into it.
 *
 * `sortieLost` is tracked rather than inferred from the pool count, because by
 * the time a sortie ends the pool is empty either way — expiring cleanly and
 * being wiped out look identical from the outside, and they mean opposite
 * things.
 */
export interface DroneBay {
  /** Drones the next launch will put up, 1..MAX_DRONES. */
  tier: number
  /** Drones currently deployed. Zero when the bay is stowed. */
  deployed: number
  /** Seconds of sortie left. */
  remaining: number
  /** Seconds until the bay can launch again. */
  cooldown: number
  /** True once anything has been shot down this sortie. */
  sortieLost: boolean
}

export function createDroneBay(): DroneBay {
  return { tier: 1, deployed: 0, remaining: 0, cooldown: 0, sortieLost: false }
}

export const MAX_BOMBS = 16

export class BombStore {
  readonly pool = new Pool(MAX_BOMBS)
  readonly body = new BodyStore(MAX_BOMBS)
  readonly life = new Float32Array(MAX_BOMBS)
  readonly damage = new Float32Array(MAX_BOMBS)
  readonly blastRadius = new Float32Array(MAX_BOMBS)
  /** 1 for a cluster sub-munition, which may not cluster again. */
  readonly clustered = new Uint8Array(MAX_BOMBS)
}

/** §26.1 — one pre-allocated pool, rendered as a single InstancedMesh. */
export class ParticleStore {
  readonly pool = new Pool(MAX_PARTICLES)
  readonly body = new BodyStore(MAX_PARTICLES)
  readonly life = new Float32Array(MAX_PARTICLES)
  readonly maxLife = new Float32Array(MAX_PARTICLES)
  readonly size = new Float32Array(MAX_PARTICLES)
  readonly r = new Float32Array(MAX_PARTICLES)
  readonly g = new Float32Array(MAX_PARTICLES)
  readonly b = new Float32Array(MAX_PARTICLES)
  /** 1 where the particle should bounce off the surface (§20.3). */
  readonly bounces = new Uint8Array(MAX_PARTICLES)
}

/* ------------------------------------------------------------------ */
/* Outposts                                                            */
/* ------------------------------------------------------------------ */

/**
 * Eight outposts. Small, fixed, and read constantly by the UI, so these stay
 * as objects rather than SoA — the clarity is worth more than the cache
 * locality at a population of eight.
 */
export interface Outpost {
  readonly index: number
  readonly name: OutpostName
  readonly position: Readonly<Vec3>
  readonly direction: Readonly<Vec3>
  integrity: number
  status: OutpostStatus
  /** Landed Harvesters currently draining this outpost. */
  drainers: number
  /** Enemies inbound to or attacking this outpost. */
  threats: number
  resupplyCooldown: number
  /** Run time at which the outpost was lost, for the Debrief timeline (§12.2 P2). */
  lostAt: number
  /** Run time at which this outpost first came under threat this wave. */
  threatenedAt: number

  /**
   * Arc distance from the craft at the moment of loss, and the number of
   * Harvesters that finished it.
   *
   * Captured at the instant it happens because the Debrief has to name the
   * cause in one sentence — "3 Harvesters landed while you were on the far
   * side" — and neither fact is recoverable afterwards (§12.2 P2).
   */
  lostArcDistance: number
  lostDrainers: number
}

/* ------------------------------------------------------------------ */
/* The craft                                                           */
/* ------------------------------------------------------------------ */

export interface Craft {
  position: Vec3
  velocity: Vec3
  previousPosition: Vec3
  frame: TangentFrame
  previousForward: Vec3

  /**
   * The aim ray. Bullets travel exactly along this, always (§7.4, §8.4).
   *
   * Kept separate from `frame.forward` because the flight heading is tangential
   * by construction (§20.1) while the nose may pitch off the tangent plane. The
   * crosshair is drawn on the nose, so if these were conflated the interface
   * would assert one direction while the weapon used another — which is exactly
   * the dishonesty V1 shipped at `game.js:510`.
   */
  nose: Vec3
  /** Nose elevation above the tangent plane, radians. Aiming only; altitude is the PD's job. */
  pitch: number

  hull: number
  heat: number
  weapon: WeaponState
  lock: LockState
  /**
   * Seconds a released lock stays held, counting down (§7.4).
   *
   * A lock that evaporated the instant the button came up meant the player had
   * to hold the lock key, aim, *and* fly at the same moment the missile mattered
   * most. The lock now survives the release for as long as this runs, so
   * acquiring and shooting are two decisions instead of one clenched hand.
   */
  lockHold: number

  /** Commanded altitude; the craft servos toward it (§22.4). */
  altitudeTarget: number
  throttle: number

  boostCharge: number
  boostActive: boolean
  boostRemaining: number

  bank: number
  /** Yaw rate about local up, used to derive bank from actual motion (§20.4). */
  yawRate: number
  /**
   * Lateral velocity as a fraction of cruise, -1..1 — **measured, not commanded**.
   *
   * `v · r̂ / V_CRUISE`. The renderer turns this into a roll into the slide and a
   * few degrees of crab against it, which is what makes a translation legible as
   * a translation rather than as the camera drifting. Measured rather than taken
   * from the key so that being knocked sideways by an impact looks like being
   * knocked sideways.
   */
  slip: number

  fireCooldown: number
  missileCooldown: number
  flareCooldown: number
  flareActiveTimer: number
  flaresRemaining: number
  bombCooldown: number
  engineCut: boolean
  activeWeaponMode: 'cannon' | 'missiles'
  aegisShield: number
  heatIdle: number
  inRepairZone: boolean

  /**
   * Per-system integrity in [0, 1] (§7.6).
   *
   * Hull is a single number counting down to death, which makes damage a
   * quantity rather than an *event*: 40 hull lost feels the same whatever hit
   * you and changes nothing about how the craft flies. Subsystems make a hit
   * something you have to fly around afterwards.
   *
   *  - `engine`  — thrust and top speed. Below 0.35 it also misfires, so the
   *                craft surges instead of accelerating smoothly.
   *  - `weapon`  — fire rate and heat. Below 0.3 rounds occasionally fail to
   *                leave the rail at all.
   *  - `control` — turn authority, and the source of the drift. A damaged
   *                stabiliser pulls the nose steadily to one side, which is the
   *                anomaly the player has to hold against by hand.
   *
   * Restored in full at an outpost, and slowly by Nanite Self-Repair.
   */
  systems: { engine: number; weapon: number; control: number }
  /**
   * Which way a damaged stabiliser pulls, ±1.
   *
   * Fixed at the moment of the damage rather than re-rolled per step, because a
   * drift that changes direction is turbulence — noise the player cannot learn —
   * while a drift that holds one way is a fault they can compensate for.
   */
  driftBias: number
  /** Seconds of enemy weapon shutdown remaining from an EMP flare (perk). */
  empTimer: number
  /** Charge on the Helios lance in [0, 1], built by cruising high (perk). */
  lanceCharge: number

  /** §24.3 — additive decaying trauma. Never accumulated into the rig. */
  trauma: number
  /** Direction the last hit came from, for the directional damage vignette (§13.4). */
  lastHitBearing: number

  alive: boolean
}

/* ------------------------------------------------------------------ */
/* Wave and score                                                      */
/* ------------------------------------------------------------------ */

export interface WaveState {
  number: number
  /** Enemies still to be released from the spawn queue. */
  pending: number
  spawnTimer: number
  /** Wall of enemies this wave will produce in total, for the Briefing. */
  plannedHarvesters: number
  plannedInterceptors: number
  plannedSentinels: number
  /** Outpost indices this wave targets, in the order they come under threat. */
  readonly targets: number[]
  elapsed: number
  /** True once every planned enemy has spawned and none remain alive. */
  cleared: boolean
  outpostsAtStart: number
  damageTakenThisWave: number
}

export interface ScoreState {
  total: number
  waveScore: number
  shots: number
  hits: number
  combo: number
  comboTimer: number
  killsHarvester: number
  killsInterceptor: number
  killsSentinel: number
  killsSapper: number
  killsWarden: number
  killsCarrier: number
  outpostsSaved: number
  outpostsLost: number
}

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

/**
 * A snapshot of intent, written by the input layer and read inside the fixed
 * step. Keeping input in one plain struct is what lets the simulation run
 * headless in tests and lets desktop, gamepad and touch all feed the same
 * fields (§8).
 */
export interface InputState {
  /** Steering, -1..1. Yaw and pitch. */
  steerX: number
  steerY: number
  /**
   * Lateral translation, -1..1 (§8.1).
   *
   * Replaces `roll`, which was never read: `FlightSystem` assigned it to
   * `craft.bank` and then overwrote that two lines later from measured angular
   * velocity, so the axis was bound, listed in Settings, and inert for the
   * project's entire history. Translation is the verb that slot should always
   * have held — turning changes where the nose points, this does not.
   */
  strafe: number
  /** Throttle, 0..1. */
  throttle: number
  /** Altitude command, -1..1. */
  climb: number
  firing: boolean
  locking: boolean
  flaring: boolean
  bombing: boolean
  switchWeapon: boolean
  engineCutToggle: boolean
  boosting: boolean
  /** Held state of the drone-bay key. Read only through its press edge. */
  deployDrones: boolean
  /** Set by touch "tap a target" and by the keyboard-only path (§8.1). */
  requestLockTarget: number

  /* ---- press edges, derived (§8.5) ---------------------------------- */
  /**
   * True for exactly the one step on which the control went from released to
   * held. Derived by `stepInput` from the held flags above and `prevInput`.
   *
   * Four controls are *acts*, not states: switching weapon, cutting the engine,
   * opening the bomb bay and punching out flares. Reading their held flag
   * directly is what broke weapon switching — the flag is true on every step the
   * key is down, so a 150 ms press toggled the mode eighteen times at 120 Hz and
   * landed wherever the parity fell. Nothing outside `stepInput` should read the
   * held flag for these; read the edge.
   */
  switchWeaponPressed: boolean
  engineCutPressed: boolean
  bombPressed: boolean
  flarePressed: boolean
  /** Launches the drone bay. An act, so only the edge is ever read. */
  deployDronesPressed: boolean
}

/**
 * Held state as of the previous step, so `stepInput` can derive press edges.
 *
 * Lives on the World rather than in module scope in the input layer, because a
 * replay feeds `InputState` directly and has to reproduce the same edges — an
 * edge detector that remembered state outside the world would make a replay
 * diverge from the run it recorded (§30.2, §37.3).
 */
export interface InputPrevious {
  switchWeapon: boolean
  engineCut: boolean
  bombing: boolean
  flaring: boolean
  deployDrones: boolean
}

export function createInputPrevious(): InputPrevious {
  return { switchWeapon: false, engineCut: false, bombing: false, flaring: false, deployDrones: false }
}

export function createInputState(): InputState {
  return {
    steerX: 0,
    steerY: 0,
    strafe: 0,
    throttle: 0,
    climb: 0,
    firing: false,
    locking: false,
    flaring: false,
    bombing: false,
    switchWeapon: false,
    engineCutToggle: false,
    boosting: false,
    deployDrones: false,
    requestLockTarget: -1,
    switchWeaponPressed: false,
    engineCutPressed: false,
    bombPressed: false,
    flarePressed: false,
    deployDronesPressed: false,
  }
}

/* ------------------------------------------------------------------ */
/* Difficulty                                                          */
/* ------------------------------------------------------------------ */

/** §10.5 — independent axes, not presets, because disabilities are not one dimension. */
export interface DifficultyAxes {
  enemyDamage: number
  drainRate: number
  enemySpeed: number
  aimAssist: number
  infiniteBoost: boolean
  /** §10.3 — bounded, disclosed, and switchable. */
  ddaEnabled: boolean
}

/**
 * Per-run modifiers contributed by the equipped ship parts.
 *
 * Deliberately the same shape and lifecycle as `DifficultyAxes`: a flat set of
 * multipliers, stored on the World, read *inline at the point of use* by the
 * systems, and written from outside the simulation. Reusing the pattern rather
 * than inventing a second one means there is one answer to "why is my thrust
 * different from the constant", not two.
 *
 * **The simulation never learns what a "part" is.** The assembler resolves a
 * loadout into these numbers in store code, exactly as the settings screen
 * resolves sliders into `DifficultyAxes`. That keeps `src/game/**` free of
 * progression concepts and keeps it testable headless.
 *
 * Every field defaults to 1.0 (or 0 for additive terms). An unequipped craft
 * must be **byte-identical** to the raw constants, because every existing test
 * builds a `Simulation` without touching this and asserts absolute numbers.
 */
export interface LoadoutModifiers {
  /* Flight — clamped downstream so no stack escapes the speed band. */
  thrust: number
  drag: number
  turnRate: number
  attitudeStiffness: number
  altitudeStiffness: number

  /* Survivability */
  hullMax: number
  /** Damage *taken*, so <1 is a buff. */
  damageTaken: number

  /* Weapons */
  fireInterval: number
  bulletDamage: number
  bulletSpeed: number
  heatPerShot: number
  heatDecay: number
  heatLockout: number

  /* Secondary */
  lockTime: number
  missileCooldown: number
  missileDamage: number

  /* Support */
  boostDuration: number
  boostRecharge: number
  resupplyRadius: number
  resupplyHull: number

  /* Assist */
  assistCone: number
}

export function createLoadoutModifiers(): LoadoutModifiers {
  return {
    thrust: 1,
    drag: 1,
    turnRate: 1,
    attitudeStiffness: 1,
    altitudeStiffness: 1,
    hullMax: 1,
    damageTaken: 1,
    fireInterval: 1,
    bulletDamage: 1,
    bulletSpeed: 1,
    heatPerShot: 1,
    heatDecay: 1,
    heatLockout: 1,
    lockTime: 1,
    missileCooldown: 1,
    missileDamage: 1,
    boostDuration: 1,
    boostRecharge: 1,
    resupplyRadius: 1,
    resupplyHull: 1,
    assistCone: 1,
  }
}

export function createDifficultyAxes(): DifficultyAxes {
  return {
    enemyDamage: 1,
    drainRate: 1,
    enemySpeed: 1,
    aimAssist: 0.35,
    infiniteBoost: false,
    ddaEnabled: true,
  }
}

/* ------------------------------------------------------------------ */
/* The World                                                           */
/* ------------------------------------------------------------------ */

export interface World {
  /** Seconds of simulated time since the run began. Never wall-clock (Rule 5). */
  time: number
  /** Completed fixed steps, for determinism assertions. */
  steps: number
  /** Interpolation factor for the render bridge, in [0, 1) (§18.2). */
  alpha: number

  readonly runSeed: string
  rng: Random

  phase: RunPhase
  craft: Craft
  readonly outposts: Outpost[]
  readonly enemies: EnemyStore
  readonly playerProjectiles: ProjectileStore
  readonly enemyProjectiles: ProjectileStore
  readonly missiles: MissileStore
  readonly bombs: BombStore
  readonly drones: DroneStore
  /** Launch state for the escort ability (§7.4). */
  droneBay: DroneBay
  /**
   * Three legendary ids offered after a destruction, or empty.
   *
   * Non-empty is what tells the UI to stop and ask. Drawn in the simulation so
   * the offer is seeded and reproducible; *chosen* in React, the same way the
   * post-wave draft has always worked.
   */
  legendaryOffer: string[]
  readonly particles: ParticleStore

  readonly grid: BucketGrid
  readonly events: EventQueue
  readonly input: InputState
  /** Held state as of the previous step. Only `stepInput` writes to this. */
  readonly prevInput: InputPrevious
  readonly difficulty: DifficultyAxes
  /** Modifiers from equipped ship parts. Neutral until the Hangar writes to it. */
  readonly loadout: LoadoutModifiers

  activePerks: string[]
  credits: number

  wave: WaveState
  score: ScoreState

  /** §10.3 — DDA multiplier in [1 − 0.15, 1 + 0.15]. Never touches damage or health. */
  ddaFactor: number
  /** Consecutive untouched waves and recent losses, the DDA's only inputs. */
  cleanWaveStreak: number
  recentLosses: number

  /** Tutorial beat index, or -1 during a normal run (§12.3). */
  tutorialBeat: number
  /** Progress within the current beat: radians of arc for FLY, kills for SHOOT. */
  tutorialProgress: number

  /**
   * The environment the run is flown in (§7.1).
   *
   * Same mechanism as `difficulty` and `loadout`: a flat multiplier set written
   * from outside the simulation and read inline at the point of use. The
   * simulation never learns what a "world" is, only that gravity and drag have
   * scalars — which is what keeps `worlds.ts` a data file and this a physics
   * engine.
   */
  environment: EnvironmentModifiers

  /**
   * Endless mode (§9): the run continues past the twelve authored waves with
   * synthesised ones, and never reaches a victory.
   *
   * A flag on the World rather than a separate `Simulation` subclass, for the
   * same reason `difficulty` and `loadout` are: it is a per-run setting written
   * from outside and read inline, and the systems that care about it are two.
   */
  endless: boolean
}

function createCraft(): Craft {
  return {
    position: create(0, 0, R + ALT_CRUISE),
    velocity: create(),
    previousPosition: create(0, 0, R + ALT_CRUISE),
    frame: { up: create(0, 0, 1), forward: create(1, 0, 0), right: create(0, -1, 0) },
    previousForward: create(1, 0, 0),
    nose: create(1, 0, 0),
    pitch: 0,
    hull: HULL_MAX,
    heat: 0,
    weapon: { kind: 'Ready' },
    lock: { kind: 'Idle' },
    lockHold: 0,
    altitudeTarget: ALT_CRUISE,
    throttle: 0,
    boostCharge: 1,
    boostActive: false,
    boostRemaining: 0,
    bank: 0,
    yawRate: 0,
    slip: 0,
    fireCooldown: 0,
    missileCooldown: 0,
    flareCooldown: 0,
    flareActiveTimer: 0,
    flaresRemaining: 5,
    bombCooldown: 0,
    engineCut: false,
    activeWeaponMode: 'cannon',
    aegisShield: 0,
    heatIdle: 0,
    inRepairZone: false,
    systems: { engine: 1, weapon: 1, control: 1 },
    driftBias: 1,
    empTimer: 0,
    lanceCharge: 0,
    trauma: 0,
    lastHitBearing: 0,
    alive: true,
  }
}

function createOutposts(): Outpost[] {
  return OUTPOSTS.map((definition) => ({
    index: definition.index,
    name: definition.name,
    position: definition.position,
    direction: definition.direction,
    integrity: 100,
    status: 'Nominal',
    drainers: 0,
    threats: 0,
    resupplyCooldown: 0,
    lostAt: -1,
    threatenedAt: -1,
    lostArcDistance: 0,
    lostDrainers: 0,
  }))
}

export function createWaveState(): WaveState {
  return {
    number: 0,
    pending: 0,
    spawnTimer: 0,
    plannedHarvesters: 0,
    plannedInterceptors: 0,
    plannedSentinels: 0,
    targets: [],
    elapsed: 0,
    cleared: false,
    outpostsAtStart: OUTPOST_COUNT,
    damageTakenThisWave: 0,
  }
}

export function createScoreState(): ScoreState {
  return {
    total: 0,
    waveScore: 0,
    shots: 0,
    hits: 0,
    combo: 0,
    comboTimer: 0,
    killsHarvester: 0,
    killsInterceptor: 0,
    killsSentinel: 0,
    killsSapper: 0,
    killsWarden: 0,
    killsCarrier: 0,
    outpostsSaved: 0,
    outpostsLost: 0,
  }
}

/**
 * Allocates the entire world once. Everything the simulation will ever need
 * exists after this call returns; the frame path only mutates it (§34.2).
 */
export function createWorld(runSeed: string, seedValue: number): World {
  return {
    time: 0,
    steps: 0,
    alpha: 0,
    runSeed,
    rng: new Random(seedValue),
    phase: { kind: 'Playing' },
    craft: createCraft(),
    outposts: createOutposts(),
    enemies: new EnemyStore(),
    playerProjectiles: new ProjectileStore(MAX_PLAYER_PROJECTILES),
    enemyProjectiles: new ProjectileStore(MAX_ENEMY_PROJECTILES),
    missiles: new MissileStore(),
    bombs: new BombStore(),
    drones: new DroneStore(),
    droneBay: createDroneBay(),
    legendaryOffer: [],
    particles: new ParticleStore(),
    grid: new BucketGrid(MAX_ENEMIES + MAX_PLAYER_PROJECTILES + MAX_ENEMY_PROJECTILES + MAX_MISSILES + MAX_BOMBS),
    events: new EventQueue(),
    input: createInputState(),
    prevInput: createInputPrevious(),
    difficulty: createDifficultyAxes(),
    loadout: createLoadoutModifiers(),
    activePerks: [],
    credits: 0,
    wave: createWaveState(),
    score: createScoreState(),
    ddaFactor: 1,
    cleanWaveStreak: 0,
    recentLosses: 0,
    tutorialBeat: -1,
    tutorialProgress: 0,
    environment: createEnvironmentModifiers(),
    endless: false,
  }
}

/**
 * Returns a world to the state `createWorld` leaves it in, without allocating.
 *
 * A run is not a `World` — it is a *pass* over one, and the same World serves
 * every run of the session because rebuilding it would tear down and rebuild the
 * scene, the moon and all eight outposts each time (§31.2, and the reason the
 * `Simulation` lives in a ref rather than in state).
 *
 * Which means somebody has to put it back, and until now nobody did. Outposts
 * kept the integrity and the `Lost` status they ended the previous run with,
 * score accumulated across runs, and the enemy pools still held whatever was
 * alive at the final moment — so a second run began mid-catastrophe, with a
 * scoreboard inherited from a game the player had already finished.
 *
 * The seed and the RNG are deliberately *not* reset: `beginWave` reseeds per
 * wave from the run seed (§10.4), which is what makes a shared seed reproduce
 * the same campaign regardless of how the previous run went.
 */
export function resetWorldForRun(world: World): void {
  world.time = 0
  world.steps = 0
  world.alpha = 0
  world.ddaFactor = 1
  world.cleanWaveStreak = 0
  world.recentLosses = 0
  world.tutorialBeat = -1
  world.tutorialProgress = 0
  world.activePerks = []
  world.legendaryOffer = []
  world.droneBay = createDroneBay()
  world.credits = 0

  const fresh = createCraft()
  const craft = world.craft
  copy(craft.position, fresh.position)
  copy(craft.previousPosition, fresh.previousPosition)
  zero(craft.velocity)
  copy(craft.frame.up, fresh.frame.up)
  copy(craft.frame.forward, fresh.frame.forward)
  copy(craft.frame.right, fresh.frame.right)
  copy(craft.previousForward, fresh.previousForward)
  copy(craft.nose, fresh.nose)
  craft.pitch = 0
  craft.hull = HULL_MAX
  craft.heat = 0
  craft.weapon = { kind: 'Ready' }
  craft.lock = { kind: 'Idle' }
  craft.lockHold = 0
  craft.altitudeTarget = ALT_CRUISE
  craft.throttle = 0
  craft.boostCharge = 1
  craft.boostActive = false
  craft.boostRemaining = 0
  craft.bank = 0
  craft.yawRate = 0
  craft.slip = 0
  craft.fireCooldown = 0
  craft.missileCooldown = 0
  craft.flareCooldown = 0
  craft.flareActiveTimer = 0
  craft.flaresRemaining = 5
  craft.bombCooldown = 0
  craft.engineCut = false
  craft.activeWeaponMode = 'cannon'
  craft.aegisShield = 0
  craft.heatIdle = 0
  craft.inRepairZone = false
  craft.systems.engine = 1
  craft.systems.weapon = 1
  craft.systems.control = 1
  craft.driftBias = 1
  craft.empTimer = 0
  craft.lanceCharge = 0
  craft.trauma = 0
  craft.lastHitBearing = 0
  craft.alive = true

  for (const outpost of world.outposts) {
    outpost.integrity = 100
    outpost.status = 'Nominal'
    outpost.drainers = 0
    outpost.threats = 0
    outpost.resupplyCooldown = 0
    outpost.lostAt = -1
    outpost.threatenedAt = -1
    outpost.lostArcDistance = 0
    outpost.lostDrainers = 0
  }

  world.enemies.pool.reset()
  world.playerProjectiles.pool.reset()
  world.enemyProjectiles.pool.reset()
  world.missiles.pool.reset()
  // Bombs were missed here for as long as the bay has existed, so a run that
  // ended with ordnance in the air began the next one with live bombs already
  // falling toward a moon that had been reset underneath them.
  world.bombs.pool.reset()
  world.drones.pool.reset()
  world.particles.pool.reset()

  // Held input belongs to the run that was being flown. Carrying it over would
  // hand the next run a phantom press edge on its very first step.
  world.prevInput.switchWeapon = false
  world.prevInput.engineCut = false
  world.prevInput.bombing = false
  world.prevInput.flaring = false

  const wave = world.wave
  const freshWave = createWaveState()
  wave.number = freshWave.number
  wave.pending = freshWave.pending
  wave.spawnTimer = freshWave.spawnTimer
  wave.plannedHarvesters = freshWave.plannedHarvesters
  wave.plannedInterceptors = freshWave.plannedInterceptors
  wave.plannedSentinels = freshWave.plannedSentinels
  wave.targets.length = 0
  wave.elapsed = freshWave.elapsed
  wave.cleared = freshWave.cleared
  wave.outpostsAtStart = freshWave.outpostsAtStart
  wave.damageTakenThisWave = freshWave.damageTakenThisWave

  const score = world.score
  const freshScore = createScoreState()
  score.total = freshScore.total
  score.waveScore = freshScore.waveScore
  score.shots = freshScore.shots
  score.hits = freshScore.hits
  score.combo = freshScore.combo
  score.comboTimer = freshScore.comboTimer
  score.killsHarvester = freshScore.killsHarvester
  score.killsInterceptor = freshScore.killsInterceptor
  score.killsSentinel = freshScore.killsSentinel
  score.killsSapper = freshScore.killsSapper
  score.killsWarden = freshScore.killsWarden
  score.killsCarrier = freshScore.killsCarrier
  score.outpostsSaved = freshScore.outpostsSaved
  score.outpostsLost = freshScore.outpostsLost

  world.events.clear()
}

/** Outposts still standing. The run ends when this reaches zero (§7.2). */
export function survivingOutposts(world: Readonly<World>): number {
  let n = 0
  for (const o of world.outposts) if (o.status !== 'Lost') n++
  return n
}
