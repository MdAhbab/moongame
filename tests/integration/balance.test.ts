/**
 * Loadout balance guardrails.
 *
 * Six slots of five parts is 15,625 combinations. Nobody can hand-balance that,
 * and claiming otherwise would be the kind of assertion this project exists to
 * avoid. What *can* be done is to state the invariants the campaign depends on
 * and check them mechanically at every extreme — so the honest claim is "the
 * extremes are tested", not "it is balanced".
 *
 * The invariant that matters most: **every triage wave must keep at least two
 * viable routes.** The game's whole subject is a choice between two painful
 * options. A loadout that reduces a wave to one option has not made the game
 * harder or easier — it has deleted the thing the game is about.
 */
import { describe, expect, it } from 'vitest'

import { createLoadoutModifiers, type LoadoutModifiers } from '@/game/core/World'
import { resolveLoadout, stockLoadout, SPEED_BAND_MIN, SPEED_BAND_MAX, type EquippedLoadout } from '@/game/systems/LoadoutSystem'
import { PARTS_BY_SLOT, SLOTS, isBuff, type Part } from '@/game/data/parts'
import { WAVES } from '@/game/data/waves'
import { DRAIN_RATE_PER_HARVESTER, F_CRUISE, K_DRAG, R, V_CRUISE } from '@/game/data/constants'

/* ------------------------------------------------------------------ */
/* A route-viability model                                             */
/* ------------------------------------------------------------------ */

/** Fraction of the maximum great-circle separation each spread targets. */
const SPREAD_FRACTION = { adjacent: 0.22, moderate: 0.48, wide: 0.74, full: 0.97 } as const

/** Seconds to clear one outpost's Harvesters at this loadout's rate of fire. */
function clearSeconds(harvesters: number, modifiers: LoadoutModifiers): number {
  // 3 hits per Harvester at the base fire interval, scaled by the loadout.
  const shotsNeeded = (harvesters * 3) / Math.max(0.1, modifiers.bulletDamage)
  return shotsNeeded * 0.11 * modifiers.fireInterval
}

/** Seconds to fly a given arc at this loadout's cruise velocity. */
function travelSeconds(arc: number, cruise: number): number {
  return arc / cruise
}

/**
 * How many of a wave's threatened outposts a player could still save, counting
 * routes rather than assuming one.
 *
 * Deliberately a *model*, not a playthrough: it isolates the geometry and the
 * clock from the player's aim, which is what makes a regression here point at a
 * balance change rather than at flaky simulated shooting.
 */
function viableRoutes(wave: (typeof WAVES)[number], cruise: number, modifiers: LoadoutModifiers): number {
  const drainRate = DRAIN_RATE_PER_HARVESTER * wave.harvestersPerOutpost * wave.drainScale
  const deadline = 100 / drainRate
  const arc = Math.PI * R * SPREAD_FRACTION[wave.spread]
  const clear = clearSeconds(wave.harvestersPerOutpost, modifiers)

  // Route A: nearest first. Route B: farthest first. Both are real player plans,
  // and the design intends both to be arguable.
  const nearFirst = travelSeconds(arc * 0.35, cruise) + clear
  const farFirst = travelSeconds(arc, cruise) + clear

  let routes = 0
  if (nearFirst <= deadline) routes++
  if (farFirst <= deadline) routes++
  return routes
}

/** Builds a loadout that takes index `i` from every slot, clamped per slot. */
function loadoutAtIndex(index: number): EquippedLoadout {
  const equipped: EquippedLoadout = {}
  for (const slot of SLOTS) {
    const parts = PARTS_BY_SLOT[slot]
    const part = parts[Math.min(index, parts.length - 1)]
    if (part !== undefined) equipped[slot] = part.id
  }
  return equipped
}

/** Every single-part loadout: stock everywhere except one slot. */
function singlePartLoadouts(): { part: Part; equipped: EquippedLoadout }[] {
  const out: { part: Part; equipped: EquippedLoadout }[] = []
  for (const slot of SLOTS) {
    for (const part of PARTS_BY_SLOT[slot]) {
      out.push({ part, equipped: { ...stockLoadout(), [slot]: part.id } })
    }
  }
  return out
}

/* ------------------------------------------------------------------ */

describe('the stock loadout is exactly the base tuning', () => {
  it('produces neutral modifiers', () => {
    // The hard requirement behind every other test in the suite: an unequipped
    // craft must be byte-identical to the constants, or the existing regression
    // tests stop meaning what they say.
    const { modifiers } = resolveLoadout(stockLoadout())
    const neutral = createLoadoutModifiers()
    expect(modifiers).toEqual(neutral)
  })

  it('flies at exactly the documented cruise velocity', () => {
    const { cruiseVelocity, speedClamped } = resolveLoadout(stockLoadout())
    expect(cruiseVelocity).toBeCloseTo(V_CRUISE, 6)
    expect(cruiseVelocity).toBeCloseTo(Math.sqrt(F_CRUISE / K_DRAG), 6)
    expect(speedClamped).toBe(false)
  })

  it('an empty loadout falls back to stock rather than to nothing', () => {
    expect(resolveLoadout({}).modifiers).toEqual(createLoadoutModifiers())
  })

  it('ignores an unknown part id instead of trusting it', () => {
    // A corrupt save is the realistic source of this, and it must not become a
    // way to fly with modifiers no part actually grants.
    const equipped = { ...stockLoadout(), Hull: 'hull-does-not-exist' }
    expect(resolveLoadout(equipped).modifiers).toEqual(createLoadoutModifiers())
  })
})

describe('the speed band holds at every extreme', () => {
  it('no whole-index loadout escapes ±8% cruise', () => {
    for (let index = 0; index < 5; index++) {
      const { cruiseVelocity } = resolveLoadout(loadoutAtIndex(index))
      expect(cruiseVelocity, `index ${index}`).toBeGreaterThanOrEqual(V_CRUISE * SPEED_BAND_MIN - 1e-6)
      expect(cruiseVelocity, `index ${index}`).toBeLessThanOrEqual(V_CRUISE * SPEED_BAND_MAX + 1e-6)
    }
  })

  it('no single part escapes the band', () => {
    for (const { part, equipped } of singlePartLoadouts()) {
      const { cruiseVelocity } = resolveLoadout(equipped)
      expect(cruiseVelocity, part.id).toBeGreaterThanOrEqual(V_CRUISE * SPEED_BAND_MIN - 1e-6)
      expect(cruiseVelocity, part.id).toBeLessThanOrEqual(V_CRUISE * SPEED_BAND_MAX + 1e-6)
    }
  })

  it('the clamp is consistent with v = sqrt(F/k)', () => {
    // If this drifts, the band is being enforced against the wrong quantity and
    // a thrust+drag stack could slip through.
    for (let index = 0; index < 5; index++) {
      const { modifiers, cruiseVelocity } = resolveLoadout(loadoutAtIndex(index))
      const derived = Math.sqrt((F_CRUISE * modifiers.thrust) / (K_DRAG * modifiers.drag))
      expect(derived).toBeCloseTo(cruiseVelocity, 6)
    }
  })
})

describe('every triage wave keeps at least two routes', () => {
  const triageWaves = WAVES.filter((wave) => wave.threatened >= 2)

  it('at the stock loadout', () => {
    const { cruiseVelocity, modifiers } = resolveLoadout(stockLoadout())
    for (const wave of triageWaves) {
      expect(viableRoutes(wave, cruiseVelocity, modifiers), `wave ${wave.number} (${wave.title})`).toBeGreaterThanOrEqual(2)
    }
  })

  it('at the slowest legal loadout — the case that used to collapse the decision', () => {
    // A speed-nerfed build previously ate the 0.2 s of slack on the far route,
    // turning "two painful options" into "one option".
    const modifiers = createLoadoutModifiers()
    const cruise = V_CRUISE * SPEED_BAND_MIN
    for (const wave of triageWaves) {
      expect(viableRoutes(wave, cruise, modifiers), `wave ${wave.number} at -8% speed`).toBeGreaterThanOrEqual(2)
    }
  })

  it('at every single-part loadout', () => {
    for (const { part, equipped } of singlePartLoadouts()) {
      const { cruiseVelocity, modifiers } = resolveLoadout(equipped)
      for (const wave of triageWaves) {
        expect(
          viableRoutes(wave, cruiseVelocity, modifiers),
          `${part.id} on wave ${wave.number}`,
        ).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('at every whole-index loadout', () => {
    for (let index = 0; index < 5; index++) {
      const { cruiseVelocity, modifiers } = resolveLoadout(loadoutAtIndex(index))
      for (const wave of WAVES) {
        expect(viableRoutes(wave, cruiseVelocity, modifiers), `index ${index} on wave ${wave.number}`).toBeGreaterThanOrEqual(1)
      }
    }
  })
})

describe('every part is a genuine trade', () => {
  it('non-stock parts carry both a buff and a nerf', () => {
    // A strictly-better part is a bug, not a reward: it makes the Hangar a
    // checklist rather than a decision.
    for (const slot of SLOTS) {
      for (const part of PARTS_BY_SLOT[slot]) {
        const entries = Object.entries(part.modifiers) as [keyof LoadoutModifiers, number][]
        if (entries.length === 0) continue // stock

        const buffs = entries.filter(([field, value]) => isBuff(field, value))
        const nerfs = entries.filter(([field, value]) => !isBuff(field, value) && value !== 1)

        expect(buffs.length, `${part.id} has no buff`).toBeGreaterThan(0)
        expect(nerfs.length, `${part.id} has no nerf`).toBeGreaterThan(0)
      }
    }
  })

  it('stock parts are exactly neutral', () => {
    for (const slot of SLOTS) {
      const stock = PARTS_BY_SLOT[slot][0]
      expect(stock, `${slot} has no stock part`).toBeDefined()
      expect(Object.keys(stock?.modifiers ?? {}), `${slot} stock is not neutral`).toHaveLength(0)
      expect(stock?.unlockLevel).toBe(1)
      expect(stock?.manufacturer).toBeNull()
    }
  })

  it('no single part swings a stat beyond the sane bound', () => {
    for (const slot of SLOTS) {
      for (const part of PARTS_BY_SLOT[slot]) {
        for (const [field, value] of Object.entries(part.modifiers)) {
          expect(value, `${part.id}.${field}`).toBeGreaterThan(0.6)
          expect(value, `${part.id}.${field}`).toBeLessThan(1.7)
        }
      }
    }
  })

  it('every slot offers five parts and unlocks span the level range', () => {
    for (const slot of SLOTS) {
      expect(PARTS_BY_SLOT[slot], slot).toHaveLength(5)
    }
    const levels = SLOTS.flatMap((slot) => PARTS_BY_SLOT[slot].map((part) => part.unlockLevel))
    expect(Math.min(...levels)).toBe(1)
    expect(Math.max(...levels)).toBeGreaterThanOrEqual(25)
  })
})
