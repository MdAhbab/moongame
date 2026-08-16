/**
 * The read model — the only shape in which the simulation is exposed to the
 * presentation layers (gameplan §31.3, §32.2).
 *
 * Two channels, deliberately separated by update frequency:
 *
 *   `HudFrame`      — values that change every frame. Written **directly to DOM
 *                     refs**, bypassing React's render entirely. Never put one
 *                     of these in `useState` or in zustand.
 *   `MetaSnapshot`  — values that change on events. Delivered through zustand at
 *                     ≤10 Hz.
 *
 * Keeping the split in the type system is what makes §17.2 enforceable by
 * review rather than by discipline alone: if a value is in `HudFrame`, routing
 * it through React is visibly wrong.
 *
 * Both objects are **pre-allocated and mutated in place**. Consumers must read
 * what they need immediately and must not retain a reference expecting it to
 * stay frozen (Rule 3).
 */
import type { OutpostStatus, World } from './World.ts'
import type { OutpostName } from '../data/outposts.ts'

/* ------------------------------------------------------------------ */
/* Per-frame channel                                                   */
/* ------------------------------------------------------------------ */

export interface HudFrame {
  hull: number
  heat: number
  /** True while the weapon is locked out at 100% heat (§7.4). */
  overheated: boolean
  score: number
  combo: number
  /** Current speed, u/s. Drives the engine synth and the speed cue. */
  speed: number
  altitude: number
  /** ḣ = v · û (§21.3). Feeds the altitude ladder's trend arrow. */
  altitudeRate: number
  altitudeTarget: number
  boostCharge: number
  boostActive: boolean
  /** Lock acquisition in [0, 1]; 0 when idle (§7.4). */
  lockProgress: number
  /** Screen-space bank angle, radians. */
  bank: number
  /** Trauma in [0, 1] — the vignette and shake amplitude (§24.3). */
  trauma: number
  /** Bearing the last damage arrived from, radians, for the directional vignette. */
  lastHitBearing: number
  /** Pitch of the local horizon relative to the camera, radians (§12.2 P3). */
  horizonPitch: number
  horizonRoll: number
  throttle: number
  /** Seconds elapsed in the current run. */
  runTime: number
  /** Current wave number. */
  wave: number
  bombCooldown: number
  weaponMode: 'cannon' | 'missiles'
  engineCut: boolean
  aegisShield: number
  flaresRemaining: number

  /* ---- targeting (§8.4) ---------------------------------------------- */
  /** 0 idle, 1 acquiring, 2 locked. A number so the HUD can switch cheaply. */
  lockState: 0 | 1 | 2
  /** Distance to the tracked target, u. 0 when nothing is tracked. */
  lockRange: number
  /** Tracked target's health as a fraction of its archetype's maximum, 0–1. */
  lockHealth: number
  /** The tracked target's archetype name, for the target readout. */
  lockKind: MarkerKind | null
  /** Seconds until the next missile may be launched. */
  missileCooldown: number
  /** Seconds a bomb dropped now would fall, or 0 when there is no solution. */
  bombFallTime: number

  /* ---- craft condition (§7.6) ---------------------------------------- */
  /** Per-system integrity in [0, 1]. */
  engineIntegrity: number
  weaponIntegrity: number
  controlIntegrity: number
  /** Escort drones currently flying. */
  drones: number
  /** Seconds left in the sortie, 0 when the bay is stowed. */
  droneRemaining: number
  /** Seconds until the bay can launch again, 0 when it is ready. */
  droneCooldown: number
  /** Size of the *next* sortie, 1..MAX_DRONES. */
  droneTier: number
  /** Helios lance charge in [0, 1]; 0 without the perk. */
  lanceCharge: number
  /** True while an Interceptor is winding up or committed to a run on you. */
  underAttackRun: boolean
}

export function createHudFrame(): HudFrame {
  return {
    hull: 100,
    heat: 0,
    overheated: false,
    score: 0,
    combo: 0,
    speed: 0,
    altitude: 0,
    altitudeRate: 0,
    altitudeTarget: 0,
    boostCharge: 1,
    boostActive: false,
    lockProgress: 0,
    bank: 0,
    trauma: 0,
    lastHitBearing: 0,
    horizonPitch: 0,
    horizonRoll: 0,
    throttle: 0,
    runTime: 0,
    wave: 0,
    bombCooldown: 0,
    weaponMode: 'cannon',
    engineCut: false,
    aegisShield: 0,
    flaresRemaining: 5,
    lockState: 0,
    lockRange: 0,
    lockHealth: 0,
    lockKind: null,
    missileCooldown: 0,
    bombFallTime: 0,
    engineIntegrity: 1,
    weaponIntegrity: 1,
    controlIntegrity: 1,
    drones: 0,
    droneRemaining: 0,
    droneCooldown: 0,
    droneTier: 1,
    lanceCharge: 0,
    underAttackRun: false,
  }
}

/* ------------------------------------------------------------------ */
/* Threat Ring markers (§12.2 P1, §20.7)                               */
/* ------------------------------------------------------------------ */

/**
 * What a Threat Ring marker is showing.
 *
 * One per archetype plus the outposts. Six hostile glyphs is a lot to ask a
 * player to learn, so the ring does not ask: the glyph carries *role*, not
 * identity — a chevron descends, a dart hunts, a bar blocks — and the three late
 * archetypes extend the same vocabulary rather than adding a new one. See
 * `ThreatRing.Glyph`, where the shapes and the reasoning live together.
 */
export type MarkerKind =
  | 'Harvester'
  | 'Interceptor'
  | 'Sentinel'
  | 'Sapper'
  | 'Warden'
  | 'Carrier'
  | 'Outpost'
export type MarkerUrgency = 'safe' | 'threatened' | 'critical'

export interface ThreatMarker {
  /** Stable per entity, so the ring can transition a marker rather than swap it. */
  id: number
  kind: MarkerKind
  /** Bearing relative to heading, radians on (-π, π]. 0 is dead ahead. */
  bearing: number
  /** 0 at the player, 1 at THREAT_RING_MAX_RANGE. */
  proximity: number
  urgency: MarkerUrgency
  hostile: boolean
  /** True for a Lost outpost, which draws hollow (§12.2 P1). */
  extinguished: boolean
  active: boolean
}

/** Enemies (48) + outposts (8). Pre-allocated once; never resized. */
export const MAX_MARKERS = 56

export function createMarkers(): ThreatMarker[] {
  const markers: ThreatMarker[] = []
  for (let i = 0; i < MAX_MARKERS; i++) {
    markers.push({
      id: -1,
      kind: 'Harvester',
      bearing: 0,
      proximity: 1,
      urgency: 'safe',
      hostile: true,
      extinguished: false,
      active: false,
    })
  }
  return markers
}

/* ------------------------------------------------------------------ */
/* Orbital Map (§12.4)                                                 */
/* ------------------------------------------------------------------ */

/**
 * One symbol on the Orbital Map, in **azimuthal equidistant** coordinates
 * centred on the craft.
 *
 * The projection is the whole point, and it is chosen rather than convenient.
 * On this map, distance from the centre is *directly proportional to
 * great-circle distance* — the exact quantity every decision in the game is
 * denominated in. A globe view would foreshorten the far side into a rim where
 * an outpost twenty seconds away and one forty seconds away sit on top of each
 * other, and an equirectangular map would make the poles enormous and the
 * shortest route a curve. Here, "twice as far from the middle" means "twice as
 * far to fly", and the whole sphere fits with no hidden hemisphere.
 *
 * `x` and `y` are in [-1, 1] with the craft at the origin and its heading up
 * the screen; radius 1 is the antipode, the furthest any point can be.
 */
export interface MapMarker {
  kind: MarkerKind
  x: number
  y: number
  /** Outposts only: 0 nominal, 1 threatened, 2 draining, 3 critical, 4 lost. */
  status: number
  /** Index into `OUTPOSTS`, or -1 for an enemy. Drives the label. */
  outpost: number
  active: boolean
}

/** 8 outposts + 48 enemies, same budget as the Threat Ring. */
export const MAX_MAP_MARKERS = 56

export function createMapMarkers(): MapMarker[] {
  const markers: MapMarker[] = []
  for (let i = 0; i < MAX_MAP_MARKERS; i++) {
    markers.push({ kind: 'Outpost', x: 0, y: 0, status: 0, outpost: -1, active: false })
  }
  return markers
}

/* ------------------------------------------------------------------ */
/* Event-driven channel                                                */
/* ------------------------------------------------------------------ */

export interface OutpostSnapshot {
  index: number
  name: OutpostName
  integrity: number
  status: OutpostStatus
  drainers: number
}

export interface MetaSnapshot {
  wave: number
  outposts: OutpostSnapshot[]
  survivingOutposts: number
  /** Highest-priority active alert, or null. One alert at a time (§13.2). */
  alert: string | null
  respawning: boolean
  respawnRemaining: number
  tutorialBeat: number
  /** Progress through the current tutorial beat, 0-1. */
  tutorialProgress: number
}

export function createMetaSnapshot(): MetaSnapshot {
  return {
    wave: 0,
    outposts: [],
    survivingOutposts: 8,
    alert: null,
    respawning: false,
    respawnRemaining: 0,
    tutorialBeat: -1,
    tutorialProgress: 0,
  }
}

/* ------------------------------------------------------------------ */
/* Run and wave summaries (Debrief / WaveClear / Results)              */
/* ------------------------------------------------------------------ */

/** One outpost's history through a wave, for the Debrief timeline (§12.2 P2). */
export interface OutpostTimelineEntry {
  name: OutpostName
  /** Run time the outpost first came under threat, or -1. */
  threatenedAt: number
  /** Run time it was lost, or -1 if it survived. */
  lostAt: number
  finalIntegrity: number
  survived: boolean
}

export interface WaveSummary {
  wave: number
  duration: number
  score: number
  outpostsSaved: number
  outpostsLost: number
  killsHarvester: number
  killsInterceptor: number
  killsSentinel: number
  killsSapper: number
  killsWarden: number
  killsCarrier: number
  shots: number
  hits: number
  accuracy: number
  accuracyBonus: number
  noDamage: number
  allIntact: number
  creditsEarned?: number
  timeline: OutpostTimelineEntry[]
  /**
   * The one-sentence cause, e.g.
   * "Lost Cassini at 2:41 — 3 Harvesters landed while you were on the far side."
   * Null when nothing was lost (§12.2 P2).
   */
  cause: string | null
}

export interface RunSummary {
  seed: string
  finalScore: number
  waveReached: number
  victory: boolean
  duration: number
  outpostsRemaining: number
  totalKills: number
  accuracy: number
  waves: WaveSummary[]
}

/* ------------------------------------------------------------------ */
/* Projection                                                          */
/* ------------------------------------------------------------------ */

/**
 * Signature of the render bridge's per-frame projection. Implemented in
 * `game/systems/HudSystem.ts`; declared here so the presentation layers can
 * depend on the shape without depending on the system.
 */
export type ProjectHudFrame = (world: Readonly<World>, out: HudFrame) => void
