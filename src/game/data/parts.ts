/**
 * Ship parts — the assembler's content (design doc: `docs/tasks/`).
 *
 * Static data only, no behaviour. `LoadoutSystem` resolves an equipped set into
 * the flat `LoadoutModifiers` the simulation reads; nothing under
 * `src/game/systems/**` ever sees a `Part`.
 *
 * ## The rule every part obeys
 *
 * **Every non-stock part carries a real buff and a real nerf.** Not a token
 * downside — a cost a player can feel and might reasonably refuse to pay. That
 * is what makes the Hangar a decision rather than a checklist, and it is what
 * keeps a maxed loadout from trivialising the campaign.
 *
 * Slot index 0 of every slot is the stock part with **no modifiers at all**, so
 * a fresh profile flies exactly the tuning the constants describe and every
 * existing regression test stays meaningful.
 *
 * ## Multipliers, and which direction is good
 *
 * All values are multipliers on the base constant. For most fields >1 is the
 * buff, but four are inverted because the underlying quantity is a cost:
 * `drag`, `damageTaken`, `fireInterval`, `heatPerShot`, `heatLockout`,
 * `lockTime`, `missileCooldown`, `boostRecharge`. `isBuff()` below is the single
 * source of truth for that, so the UI never has to guess.
 */
import type { LoadoutModifiers } from '../core/World.ts'

/** The six slots. Order is the order they appear in the Hangar. */
export const SLOTS = ['Hull', 'Engine', 'Weapon', 'Targeting', 'Support', 'Frame'] as const
export type Slot = (typeof SLOTS)[number]

/**
 * Manufacturers exist so a loadout can express an identity rather than just a
 * stat total. Equipping two or four parts from the same house grants a set
 * bonus, which gives a reason to open the assembler a second time.
 */
export const MANUFACTURERS = [
  'Kestrel Dynamics',
  'Nocturne Arsenal',
  'Vega Shipworks',
  'Tycho Industrial',
  'Aitken Labs',
] as const
export type Manufacturer = (typeof MANUFACTURERS)[number]

/** A sparse set of multipliers. Omitted fields default to neutral. */
export type PartModifiers = Partial<LoadoutModifiers>

export interface Part {
  readonly id: string
  readonly slot: Slot
  readonly name: string
  /** Null for stock parts, which belong to no house and count toward no set. */
  readonly manufacturer: Manufacturer | null
  /** Pilot level at which this becomes equippable. 1 for stock. */
  readonly unlockLevel: number
  /** Purchase cost in credits (0 for stock). */
  readonly cost?: number
  /** Grade tier from Mk.I up to Mk.IV. */
  readonly tier?: 'Mk.I' | 'Mk.II' | 'Mk.III' | 'Mk.IV'
  /** One line of in-world flavour. Shown under the name in the Hangar. */
  readonly description: string
  readonly modifiers: PartModifiers
}

export interface SetBonus {
  readonly manufacturer: Manufacturer
  /** Bonus granted at two matching parts. */
  readonly two: PartModifiers
  readonly twoLabel: string
  /** Bonus granted at four matching parts, replacing the two-piece. */
  readonly four: PartModifiers
  readonly fourLabel: string
}

/**
 * True when a higher multiplier is better for this field.
 *
 * Several fields measure a *cost* — time between shots, heat per shot, damage
 * taken — where a lower number is the improvement. The Hangar's stat readout
 * colours deltas from this, so getting it wrong would show a buff in the nerf
 * colour and quietly mislead every build decision.
 */
export function isBuff(field: keyof LoadoutModifiers, multiplier: number): boolean {
  const lowerIsBetter =
    field === 'drag' ||
    field === 'damageTaken' ||
    field === 'fireInterval' ||
    field === 'heatPerShot' ||
    field === 'heatLockout' ||
    field === 'lockTime' ||
    field === 'missileCooldown' ||
    field === 'boostRecharge'
  return lowerIsBetter ? multiplier < 1 : multiplier > 1
}

/** Human labels for the stat readout. */
export const FIELD_LABELS: Record<keyof LoadoutModifiers, string> = {
  thrust: 'Thrust',
  drag: 'Drag',
  turnRate: 'Turn rate',
  attitudeStiffness: 'Handling',
  altitudeStiffness: 'Altitude hold',
  hullMax: 'Hull',
  damageTaken: 'Damage taken',
  fireInterval: 'Fire interval',
  bulletDamage: 'Bullet damage',
  bulletSpeed: 'Bullet speed',
  heatPerShot: 'Heat per shot',
  heatDecay: 'Heat decay',
  heatLockout: 'Lockout time',
  lockTime: 'Lock time',
  missileCooldown: 'Missile cooldown',
  missileDamage: 'Missile damage',
  boostDuration: 'Boost duration',
  boostRecharge: 'Boost recharge',
  resupplyRadius: 'Resupply radius',
  resupplyHull: 'Resupply hull',
  assistCone: 'Assist cone',
}

/* ------------------------------------------------------------------ */
/* Hull — the reference slot. Follow this shape for the rest.          */
/* ------------------------------------------------------------------ */

const HULL_PARTS: readonly Part[] = [
  {
    id: 'hull-stock',
    slot: 'Hull',
    name: 'MN-1 Standard Shell',
    manufacturer: null,
    unlockLevel: 1,
    description: 'Factory plating. No compromises in either direction.',
    modifiers: {},
  },
  {
    id: 'hull-reinforced',
    slot: 'Hull',
    name: 'Bulwark Composite',
    manufacturer: 'Tycho Industrial',
    unlockLevel: 3,
    description: 'Survives a Sentinel volley. You will feel every gram of it in a turn.',
    // Retuned down from hull +30% / damage -12% for only -6% thrust and -10%
    // turn. That was the best buff-to-nerf ratio in the game and made every
    // other Hull part pointless — a slot with an obvious answer is not a slot.
    modifiers: { hullMax: 1.24, damageTaken: 0.93, thrust: 0.9, turnRate: 0.84 },
  },
  {
    id: 'hull-ablative',
    slot: 'Hull',
    name: 'Ablative Weave',
    manufacturer: 'Aitken Labs',
    unlockLevel: 7,
    description: 'Sheds impact energy beautifully. Sheds heat considerably less well.',
    modifiers: { damageTaken: 0.78, heatDecay: 0.82, hullMax: 0.95 },
  },
  {
    id: 'hull-lattice',
    slot: 'Hull',
    name: 'Void Lattice',
    manufacturer: 'Kestrel Dynamics',
    unlockLevel: 11,
    description: 'Barely there. Everything you hit, hits back harder.',
    modifiers: { thrust: 1.08, turnRate: 1.18, hullMax: 0.72, damageTaken: 1.22 },
  },
  {
    id: 'hull-corsair',
    slot: 'Hull',
    name: 'Corsair Frame-Skin',
    manufacturer: 'Vega Shipworks',
    unlockLevel: 16,
    description: 'Outpost technicians can patch it in seconds. Nobody claims it is strong.',
    modifiers: { resupplyHull: 1.45, resupplyRadius: 1.2, hullMax: 0.88 },
  },
]

/* ------------------------------------------------------------------ */
/* Engine — thrust, drag, boost.                                       */
/* ------------------------------------------------------------------ */

const ENGINE_PARTS: readonly Part[] = [
  {
    id: 'engine-stock',
    slot: 'Engine',
    name: 'MN-1 Standard Drive',
    manufacturer: null,
    unlockLevel: 1,
    description: 'Factory reaction drive. Exactly the thrust curve on the spec sheet.',
    modifiers: {},
  },
  {
    id: 'engine-whisper',
    slot: 'Engine',
    name: 'Whisper Coil',
    manufacturer: 'Kestrel Dynamics',
    unlockLevel: 4,
    description: 'Trims mass off the housing for every unit of thrust it gains. The boost capacitor pays the difference.',
    modifiers: { thrust: 1.07, boostRecharge: 1.2 },
  },
  {
    id: 'engine-capacitor',
    slot: 'Engine',
    name: 'Capacitor Feed',
    manufacturer: 'Nocturne Arsenal',
    unlockLevel: 9,
    description: 'Reroutes drive power into the heat exchangers. Cruise thrust suffers for it.',
    modifiers: { heatDecay: 1.15, thrust: 0.93 },
  },
  {
    id: 'engine-ironclad',
    slot: 'Engine',
    name: 'Ironclad Feed',
    manufacturer: 'Tycho Industrial',
    unlockLevel: 14,
    description: 'Reinforced feed lines double as armor plate around the drive. You feel the extra mass in every burn.',
    modifiers: { hullMax: 1.12, thrust: 0.91 },
  },
  {
    id: 'engine-cryo',
    slot: 'Engine',
    name: 'Cryo-Cascade Drive',
    manufacturer: 'Aitken Labs',
    unlockLevel: 20,
    description: 'Supercooled feed lines stretch the boost burn. The radiator fins catch more drag than anyone would like.',
    modifiers: { boostDuration: 1.25, drag: 1.08 },
  },
]

/* ------------------------------------------------------------------ */
/* Weapon — the primary gun.                                           */
/* ------------------------------------------------------------------ */

const WEAPON_PARTS: readonly Part[] = [
  {
    id: 'weapon-stock',
    slot: 'Weapon',
    name: 'MN-1 Autocannon',
    manufacturer: null,
    unlockLevel: 1,
    description: 'Standard-issue coil gun. Nothing about it will surprise you.',
    modifiers: {},
  },
  {
    id: 'weapon-needler',
    slot: 'Weapon',
    name: 'Needler Array',
    manufacturer: 'Nocturne Arsenal',
    unlockLevel: 5,
    description: 'Higher cyclic rate, lighter charge per round. Runs cool. Whittles instead of punching.',
    modifiers: { fireInterval: 0.88, heatPerShot: 0.92, bulletDamage: 0.85 },
  },
  {
    id: 'weapon-cycler',
    slot: 'Weapon',
    name: 'Field Cycler',
    manufacturer: 'Vega Shipworks',
    unlockLevel: 10,
    description: 'Built to keep firing, not to fire hard. Dissipates heat fast; the rounds leave the barrel noticeably slower.',
    modifiers: { heatDecay: 1.15, bulletSpeed: 0.9 },
  },
  {
    id: 'weapon-mauler',
    slot: 'Weapon',
    name: 'Mauler Cannon',
    manufacturer: 'Tycho Industrial',
    unlockLevel: 17,
    description: 'Bores clean through Interceptor plating. The coil needs longer to recharge between rounds, and it runs hot doing it.',
    modifiers: { bulletDamage: 1.22, fireInterval: 1.18, heatPerShot: 1.1 },
  },
  {
    id: 'weapon-thermic',
    slot: 'Weapon',
    name: 'Thermic Lance',
    manufacturer: 'Aitken Labs',
    unlockLevel: 24,
    description: 'Superheated rounds punch harder than the housing really wants to allow. Push it into lockout and you will wait.',
    modifiers: { bulletDamage: 1.15, heatLockout: 1.25 },
  },
]

/* ------------------------------------------------------------------ */
/* Targeting — missile lock and assist.                                */
/* ------------------------------------------------------------------ */

const TARGETING_PARTS: readonly Part[] = [
  {
    id: 'targeting-stock',
    slot: 'Targeting',
    name: 'MN-1 Threat Scope',
    manufacturer: null,
    unlockLevel: 1,
    description: 'Baseline lock computer. Does the job and nothing extra.',
    modifiers: {},
  },
  {
    id: 'targeting-flash',
    slot: 'Targeting',
    name: 'Flash-Lock Array',
    manufacturer: 'Kestrel Dynamics',
    unlockLevel: 6,
    description: 'Locks in a hurry. The trade is a tighter cone — you need to be pointed at the target, not just near it.',
    modifiers: { lockTime: 0.8, assistCone: 0.85 },
  },
  {
    id: 'targeting-widefield',
    slot: 'Targeting',
    name: 'Widefield Scope',
    manufacturer: 'Vega Shipworks',
    unlockLevel: 12,
    description: 'A generous assist cone forgives a sloppy line-up. The lock computer behind it is not built for speed.',
    modifiers: { assistCone: 1.2, lockTime: 1.15 },
  },
  {
    id: 'targeting-siege',
    slot: 'Targeting',
    name: 'Siege Battery',
    manufacturer: 'Tycho Industrial',
    unlockLevel: 19,
    description: 'A warhead the airframe can barely carry. The launcher needs real time to recycle between shots.',
    modifiers: { missileDamage: 1.3, missileCooldown: 1.25 },
  },
  {
    id: 'targeting-predictive',
    slot: 'Targeting',
    name: 'Predictive Suite',
    manufacturer: 'Nocturne Arsenal',
    unlockLevel: 27,
    description: 'Tracks lead angle before you finish the turn. The warhead it carries is scaled down to keep cycle time this low.',
    modifiers: { lockTime: 0.75, missileCooldown: 0.85, missileDamage: 0.85 },
  },
]

/* ------------------------------------------------------------------ */
/* Support — resupply and boost.                                       */
/* ------------------------------------------------------------------ */

const SUPPORT_PARTS: readonly Part[] = [
  {
    id: 'support-stock',
    slot: 'Support',
    name: 'MN-1 Field Kit',
    manufacturer: null,
    unlockLevel: 1,
    description: 'Standard resupply transponder and boost regulator. Unremarkable by design.',
    modifiers: {},
  },
  {
    id: 'support-relay',
    slot: 'Support',
    name: 'Relay Beacon',
    manufacturer: 'Vega Shipworks',
    unlockLevel: 4,
    description: 'Widens the resupply catch radius by a third. The boost capacitor loses budget to power the beacon.',
    modifiers: { resupplyRadius: 1.25, boostRecharge: 1.15 },
  },
  {
    id: 'support-diverter',
    slot: 'Support',
    name: 'Weapons Diverter',
    manufacturer: 'Nocturne Arsenal',
    unlockLevel: 10,
    description: "Bleeds power from the resupply system into the weapon's cooling loop. Outposts patch you up for less when you dock.",
    modifiers: { heatDecay: 1.2, resupplyHull: 0.8 },
  },
  {
    id: 'support-hardpoint',
    slot: 'Support',
    name: 'Hardpoint Kit',
    manufacturer: 'Tycho Industrial',
    unlockLevel: 16,
    description: 'Extra plating bolted around the docking collar. It is wider than the resupply beacon was built to reach around.',
    modifiers: { hullMax: 1.15, resupplyRadius: 0.85 },
  },
  {
    id: 'support-thermal-cell',
    slot: 'Support',
    name: 'Thermal Cell',
    manufacturer: 'Aitken Labs',
    unlockLevel: 23,
    description: 'Extra cells stretch the boost burn by a third. They sit where the backing armor used to.',
    modifiers: { boostDuration: 1.3, damageTaken: 1.1 },
  },
]

/* ------------------------------------------------------------------ */
/* Frame — the airframe itself: hull, handling, damage response.       */
/* ------------------------------------------------------------------ */

const FRAME_PARTS: readonly Part[] = [
  {
    id: 'frame-stock',
    slot: 'Frame',
    name: 'MN-1 Standard Frame',
    manufacturer: null,
    unlockLevel: 1,
    description: 'Baseline airframe. Every other part is measured against this one.',
    modifiers: {},
  },
  {
    id: 'frame-needle',
    slot: 'Frame',
    name: 'Needle Frame',
    manufacturer: 'Kestrel Dynamics',
    unlockLevel: 5,
    description: 'Cut down to exactly what the spec sheet allows. Turns like it means it. Absorbs nothing.',
    modifiers: { turnRate: 1.15, attitudeStiffness: 1.1, hullMax: 0.85 },
  },
  {
    id: 'frame-skeletal',
    slot: 'Frame',
    name: 'Skeletal Mount',
    manufacturer: 'Nocturne Arsenal',
    unlockLevel: 13,
    description: 'Stripped to the load-bearing members to keep the gun platform steady. Anything that hits you goes straight through to something that matters.',
    modifiers: { drag: 0.93, damageTaken: 1.15 },
  },
  {
    id: 'frame-salvage',
    slot: 'Frame',
    name: 'Salvage Chassis',
    manufacturer: 'Vega Shipworks',
    unlockLevel: 21,
    description: 'Refit from outpost scrap. Heavier than anything Vega sells new, and it holds a line better than it holds a turn.',
    modifiers: { hullMax: 1.2, altitudeStiffness: 1.12, turnRate: 0.88 },
  },
  {
    id: 'frame-phase',
    slot: 'Frame',
    name: 'Phase-Dampened Hull',
    manufacturer: 'Aitken Labs',
    unlockLevel: 30,
    description: 'Absorbs impact energy across the whole shell instead of the plate that got hit. The mass penalty is everywhere at once — handling, acceleration, all of it.',
    modifiers: { damageTaken: 0.8, attitudeStiffness: 0.85, thrust: 0.92 },
  },
]

/**
 * Populated per slot below. `ALL_PARTS` is assembled at the bottom so a missing
 * slot is a visible gap rather than a silent one.
 */
export const PARTS_BY_SLOT: Record<Slot, readonly Part[]> = {
  Hull: HULL_PARTS,
  Engine: ENGINE_PARTS,
  Weapon: WEAPON_PARTS,
  Targeting: TARGETING_PARTS,
  Support: SUPPORT_PARTS,
  Frame: FRAME_PARTS,
}

export const ALL_PARTS: readonly Part[] = SLOTS.flatMap((slot) => PARTS_BY_SLOT[slot])

/**
 * One entry per manufacturer. Each bonus amplifies the identity its parts
 * already establish rather than opening a new axis: Kestrel trades
 * durability for handling, Tycho trades output for survivability, Vega
 * trades power for logistics reach, Aitken trades heat economy for damage
 * mitigation, Nocturne trades armor for weapon and lock efficiency. The
 * four-piece bonus *replaces* the two-piece rather than stacking with it, so
 * committing further to a house is a decision with a ceiling, not a runaway
 * multiplier.
 */
export const SET_BONUSES: readonly SetBonus[] = [
  {
    manufacturer: 'Kestrel Dynamics',
    two: { turnRate: 1.08 },
    twoLabel: 'Turn rate +8%',
    four: { turnRate: 1.15, thrust: 1.05, damageTaken: 1.1 },
    fourLabel: 'Turn rate +15%, thrust +5% — damage taken +10%',
  },
  {
    manufacturer: 'Nocturne Arsenal',
    two: { heatPerShot: 0.92 },
    twoLabel: 'Heat per shot −8%',
    four: { heatPerShot: 0.85, lockTime: 0.85, hullMax: 0.9 },
    fourLabel: 'Heat per shot −15%, lock time −15% — hull cap −10%',
  },
  {
    manufacturer: 'Vega Shipworks',
    two: { resupplyRadius: 1.15 },
    twoLabel: 'Resupply radius +15%',
    four: { resupplyRadius: 1.3, resupplyHull: 1.3, hullMax: 0.92 },
    fourLabel: 'Resupply radius +30%, resupply hull +30% — hull cap −8%',
  },
  {
    manufacturer: 'Tycho Industrial',
    two: { damageTaken: 0.94 },
    twoLabel: 'Damage taken −6%',
    four: { damageTaken: 0.88, hullMax: 1.1, thrust: 0.94 },
    fourLabel: 'Damage taken −12%, hull +10% — thrust −6%',
  },
  {
    manufacturer: 'Aitken Labs',
    two: { damageTaken: 0.93 },
    twoLabel: 'Damage taken −7%',
    four: { damageTaken: 0.85, heatDecay: 0.85 },
    fourLabel: 'Damage taken −15% — heat dissipation −15%',
  },
]

/** Lookup by id, built once. Unknown ids resolve to the slot's stock part. */
const PART_INDEX = new Map<string, Part>(ALL_PARTS.map((part) => [part.id, part]))

export function partById(id: string): Part | undefined {
  return PART_INDEX.get(id)
}

/** The stock part for a slot — the fallback for an unknown or locked id. */
export function stockPart(slot: Slot): Part {
  const parts = PARTS_BY_SLOT[slot]
  const first = parts[0]
  if (first === undefined) throw new Error(`parts: slot "${slot}" has no stock entry`)
  return first
}

/** Every valid part id, for validating a persisted profile. */
export function allPartIds(): string[] {
  return ALL_PARTS.map((part) => part.id)
}
