/**
 * World invariants (§7.1).
 *
 * A world varies the *environment*, never the geometry, and the reason is that
 * every number the game states — the Briefing's seconds-to-outpost, the
 * Debrief's "you were six seconds away", the Orbital Map's range rings — is
 * derived from `R` and `V_CRUISE`. A world that moved those would invalidate
 * all of them silently, showing up as waves that are quietly unwinnable rather
 * than as a failing test. These are the bounds that keep that true.
 */
import { describe, expect, it } from 'vitest'

import {
  WORLDS,
  createEnvironmentModifiers,
  cruiseFactor,
  defaultWorld,
  isWorldUnlocked,
  worldById,
} from '@/game/data/worlds'
import { createWorld } from '@/game/core/World'
import { DRAIN_RATE_PER_HARVESTER, R, V_CRUISE } from '@/game/data/constants'
import { WAVES } from '@/game/data/waves'

/** How far a craft can travel in a straight line, worst case, on any world. */
const CROSSING_SECONDS = (Math.PI * R) / V_CRUISE

describe('the reference world is exactly the base tuning', () => {
  it('Mare Noctis is neutral on every axis', () => {
    // The hard requirement behind the other 101 tests: an unset environment has
    // to be byte-identical to the constants, or every existing regression test
    // stops meaning what it says.
    expect(defaultWorld().id).toBe('mare-noctis')
    expect(defaultWorld().environment).toEqual(createEnvironmentModifiers())
  })

  it('a fresh world starts neutral, whatever is selected in the UI', () => {
    expect(createWorld('TEST-SEED', 1).environment).toEqual({ gravity: 1, drag: 1 })
  })

  it('an unknown id falls back rather than throwing', () => {
    expect(worldById('not-a-world')).toBeUndefined()
  })
})

describe('no world moves cruise speed outside the band the deadlines assume', () => {
  it('every world stays within ±6% of cruise', () => {
    // Tighter than the loadout's ±8%, because the two stack: a speed-nerfed
    // build on a draggy world must not compound into a craft that cannot make
    // the far side of a wave it is being asked to save.
    for (const world of WORLDS) {
      const factor = cruiseFactor(world.environment)
      expect(factor, `${world.id} cruise factor`).toBeGreaterThanOrEqual(0.94)
      expect(factor, `${world.id} cruise factor`).toBeLessThanOrEqual(1.06)
    }
  })

  it('gravity stays inside a band the altitude controller can hold', () => {
    // The PD controller is tuned critically damped at ω_n = 5 for G. Far outside
    // this band it either overshoots into the ground or floats.
    for (const world of WORLDS) {
      expect(world.environment.gravity, `${world.id}`).toBeGreaterThanOrEqual(0.75)
      expect(world.environment.gravity, `${world.id}`).toBeLessThanOrEqual(1.25)
    }
  })

  it('every campaign wave stays winnable on the slowest world', () => {
    const slowest = WORLDS.reduce((worst, world) =>
      cruiseFactor(world.environment) < cruiseFactor(worst.environment) ? world : worst,
    )
    const cruise = V_CRUISE * cruiseFactor(slowest.environment)

    for (const wave of WAVES) {
      const rate = DRAIN_RATE_PER_HARVESTER * wave.harvestersPerOutpost * wave.drainScale
      const deadline = 100 / rate
      // The furthest an outpost can be is half the circumference.
      const worstCrossing = (Math.PI * R) / cruise
      expect(deadline, `wave ${wave.number} on ${slowest.id}`).toBeGreaterThan(worstCrossing * 0.9)
    }
  })

  it('the slowest world still crosses the sphere inside the drain clock', () => {
    // Bounded against the tightest deadline any authored wave sets, not against
    // a transcribed "nine seconds" — that figure was the crossing time for one
    // particular cruise speed, and survived a retune only by failing.
    const slowest = Math.min(...WORLDS.map((world) => cruiseFactor(world.environment)))
    const tightestDeadline = Math.min(
      ...WAVES.map((wave) => 100 / (DRAIN_RATE_PER_HARVESTER * wave.harvestersPerOutpost * wave.drainScale)),
    )
    expect(CROSSING_SECONDS / slowest).toBeLessThan(tightestDeadline * 0.75)
  })
})

describe('the world roster is coherent', () => {
  it('offers three worlds with distinct ids', () => {
    expect(WORLDS).toHaveLength(3)
    expect(new Set(WORLDS.map((world) => world.id)).size).toBe(3)
  })

  it('the first world is available to a brand-new pilot', () => {
    expect(isWorldUnlocked(defaultWorld(), 1)).toBe(true)
  })

  it('the others are gated but reachable well inside the level cap', () => {
    for (const world of WORLDS.slice(1)) {
      expect(world.unlockLevel, world.id).toBeGreaterThan(1)
      expect(world.unlockLevel, world.id).toBeLessThanOrEqual(20)
    }
  })

  it('every world has a full palette, so nothing falls back to Luna grey', () => {
    for (const world of WORLDS) {
      for (const [key, value] of Object.entries(world.palette)) {
        expect(typeof value, `${world.id}.${key}`).toBe('number')
        if (key !== 'primarySize') {
          expect(value, `${world.id}.${key}`).toBeGreaterThanOrEqual(0)
          expect(value, `${world.id}.${key}`).toBeLessThanOrEqual(0xffffff)
        }
      }
      expect(world.starDensity, world.id).toBeGreaterThan(0)
    }
  })

  it('terrain parameters are all positive and bounded', () => {
    for (const world of WORLDS) {
      expect(world.terrain.amplitude, world.id).toBeGreaterThan(0)
      expect(world.terrain.frequency, world.id).toBeGreaterThan(0)
      expect(world.terrain.craterDensity, world.id).toBeGreaterThanOrEqual(0)
      // The ridged weight is a blend factor and has to stay one.
      expect(world.terrain.ridged, world.id).toBeGreaterThanOrEqual(0)
      expect(world.terrain.ridged, world.id).toBeLessThanOrEqual(1)
    }
  })
})
