/**
 * Resolves an equipped set of parts into the flat multipliers the simulation
 * reads.
 *
 * This is the only place that knows both vocabularies. Above it, the Hangar
 * talks about parts, manufacturers and set bonuses; below it, the systems see
 * nothing but numbers on `world.loadout`. Keeping the translation in one
 * function means a balance question always has one place to look.
 *
 * ## Why multipliers compose multiplicatively
 *
 * Two parts each giving +10% produce ×1.21, not +20%. Additive stacking makes
 * the last point of a stat worth the same as the first, which is what produces
 * runaway builds; multiplicative stacking has natural diminishing returns and
 * cannot cross zero however many parts pile on.
 */
import { createLoadoutModifiers, type LoadoutModifiers } from '../core/World.ts'
import {
  MANUFACTURERS,
  PARTS_BY_SLOT,
  SET_BONUSES,
  SLOTS,
  partById,
  stockPart,
  type Manufacturer,
  type PartModifiers,
  type Slot,
} from '../data/parts.ts'
import { F_CRUISE, K_DRAG, V_CRUISE } from '../data/constants.ts'

/** One part id per slot. A missing or unknown id falls back to stock. */
export type EquippedLoadout = Partial<Record<Slot, string>>

/**
 * The speed band, as a fraction of base cruise velocity.
 *
 * Travel time is the currency the entire game is denominated in: the campaign's
 * triage arithmetic is balanced against a 44.7 u/s cruise, and a build that
 * moved far outside this range would not be a strong build, it would be a
 * different game. ±8% is wide enough to feel and narrow enough that every wave
 * stays a decision.
 */
export const SPEED_BAND_MIN = 0.92
export const SPEED_BAND_MAX = 1.08

/** Per-field caps, applied after composition. Belt and braces on top of the band. */
const FIELD_MIN = 0.55
const FIELD_MAX = 1.9

/** Fields whose composition must not be clamped by the generic bounds. */
const UNBOUNDED: ReadonlySet<keyof LoadoutModifiers> = new Set()

const FIELDS = Object.keys(createLoadoutModifiers()) as (keyof LoadoutModifiers)[]

export interface ResolvedLoadout {
  modifiers: LoadoutModifiers
  /** Active set bonuses, for the Hangar to display. */
  activeSets: { manufacturer: Manufacturer; pieces: number; label: string }[]
  /** Resulting cruise velocity in u/s, after the band clamp. */
  cruiseVelocity: number
  /** True when the band clamp actually bit, so the Hangar can say so. */
  speedClamped: boolean
}

/**
 * Composes parts, set bonuses, and part calibration tuning sliders into `LoadoutModifiers`.
 *
 * Pure, so the Hangar can call it speculatively to preview a candidate build
 * without touching the live world.
 */
export function resolveLoadout(
  equipped: EquippedLoadout,
  tuning?: Partial<Record<Slot, number>>,
): ResolvedLoadout {
  const modifiers = createLoadoutModifiers()

  // Count manufacturers as we go, so set bonuses need no second pass over slots.
  const counts = new Map<Manufacturer, number>()

  for (const slot of SLOTS) {
    const id = equipped[slot]
    const part = (id === undefined ? undefined : partById(id)) ?? stockPart(slot)

    // A part in the wrong slot would silently apply its modifiers anyway, which
    // is exactly the sort of thing a corrupt save could smuggle in.
    if (part.slot !== slot) continue

    apply(modifiers, part.modifiers)
    if (part.manufacturer !== null) {
      counts.set(part.manufacturer, (counts.get(part.manufacturer) ?? 0) + 1)
    }

    // Apply slot calibration slider in [-1, 1]
    const t = tuning?.[slot] ?? 0
    if (t !== 0) {
      applySlotTuning(modifiers, slot, t)
    }
  }

  const activeSets: ResolvedLoadout['activeSets'] = []
  for (const manufacturer of MANUFACTURERS) {
    const pieces = counts.get(manufacturer) ?? 0
    if (pieces < 2) continue

    const bonus = SET_BONUSES.find((entry) => entry.manufacturer === manufacturer)
    if (bonus === undefined) continue

    // Four-piece replaces two-piece rather than stacking with it, so the
    // displayed bonus is always exactly what is applied.
    if (pieces >= 4) {
      apply(modifiers, bonus.four)
      activeSets.push({ manufacturer, pieces, label: bonus.fourLabel })
    } else {
      apply(modifiers, bonus.two)
      activeSets.push({ manufacturer, pieces, label: bonus.twoLabel })
    }
  }

  clampFields(modifiers)
  const { cruiseVelocity, clamped } = clampSpeedBand(modifiers)

  return { modifiers, activeSets, cruiseVelocity, speedClamped: clamped }
}

function applySlotTuning(modifiers: LoadoutModifiers, slot: Slot, t: number): void {
  const clamped = Math.max(-1, Math.min(1, t))
  if (slot === 'Engine') {
    if (clamped > 0) {
      modifiers.turnRate *= 1 + 0.25 * clamped
      modifiers.attitudeStiffness *= 1 + 0.2 * clamped
      modifiers.drag *= 1 + 0.1 * clamped
    } else {
      const mag = -clamped
      modifiers.thrust *= 1 + 0.25 * mag
      modifiers.turnRate *= 1 - 0.15 * mag
    }
  } else if (slot === 'Weapon') {
    if (clamped > 0) {
      modifiers.heatDecay *= 1 + 0.35 * clamped
      modifiers.heatLockout *= 1 - 0.2 * clamped
    } else {
      const mag = -clamped
      modifiers.fireInterval *= 1 - 0.2 * mag
      modifiers.heatPerShot *= 1 + 0.25 * mag
    }
  } else if (slot === 'Hull') {
    if (clamped > 0) {
      modifiers.drag *= 1 - 0.2 * clamped
      modifiers.boostDuration *= 1 + 0.2 * clamped
    } else {
      const mag = -clamped
      modifiers.hullMax *= 1 + 0.3 * mag
      modifiers.thrust *= 1 - 0.15 * mag
    }
  } else if (slot === 'Targeting') {
    if (clamped > 0) {
      modifiers.missileDamage *= 1 + 0.35 * clamped
      modifiers.missileCooldown *= 1 + 0.2 * clamped
    } else {
      const mag = -clamped
      modifiers.lockTime *= 1 - 0.3 * mag
      modifiers.missileDamage *= 1 - 0.15 * mag
    }
  }
}

/** @hot-path — called on equip, not per frame, but kept allocation-free anyway. */
function apply(target: LoadoutModifiers, source: PartModifiers): void {
  for (const field of FIELDS) {
    const value = source[field]
    if (value !== undefined) target[field] *= value
  }
}

function clampFields(modifiers: LoadoutModifiers): void {
  for (const field of FIELDS) {
    if (UNBOUNDED.has(field)) continue
    const value = modifiers[field]
    modifiers[field] = value < FIELD_MIN ? FIELD_MIN : value > FIELD_MAX ? FIELD_MAX : value
  }
}

/**
 * Holds the resulting cruise velocity inside the band, adjusting thrust to suit.
 *
 * Terminal velocity is `v = √(F/k)`, so thrust and drag both move it and a
 * build could otherwise stack an engine's thrust with a frame's drag reduction
 * and slip past the limit. Solving for the thrust that lands on the boundary —
 * `F = k·v²` — and writing it back means the clamp is applied to the quantity
 * the design actually cares about, rather than to each contributing stat
 * separately.
 */
function clampSpeedBand(modifiers: LoadoutModifiers): { cruiseVelocity: number; clamped: boolean } {
  const thrust = F_CRUISE * modifiers.thrust
  const drag = K_DRAG * modifiers.drag
  const velocity = Math.sqrt(thrust / drag)

  const min = V_CRUISE * SPEED_BAND_MIN
  const max = V_CRUISE * SPEED_BAND_MAX

  if (velocity >= min && velocity <= max) {
    return { cruiseVelocity: velocity, clamped: false }
  }

  const target = velocity < min ? min : max
  modifiers.thrust = (drag * target * target) / F_CRUISE
  return { cruiseVelocity: target, clamped: true }
}

/** Copies resolved modifiers into the live world without reallocating. */
export function applyLoadout(target: LoadoutModifiers, source: Readonly<LoadoutModifiers>): void {
  for (const field of FIELDS) target[field] = source[field]
}

/** The all-stock loadout — what a fresh profile flies. */
export function stockLoadout(): EquippedLoadout {
  const equipped: EquippedLoadout = {}
  for (const slot of SLOTS) equipped[slot] = stockPart(slot).id
  return equipped
}

/** Every part legal in a slot at the given pilot level. */
export function availableParts(slot: Slot, level: number) {
  return PARTS_BY_SLOT[slot].filter((part) => part.unlockLevel <= level)
}
