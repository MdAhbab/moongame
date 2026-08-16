/**
 * Simulation commands the shell used to perform by poking `world` itself.
 *
 * Perk selection is a run event. If the UI writes `activePerks` directly,
 * a replay of the same inputs cannot reproduce the draft, and two call
 * sites will eventually disagree.
 */
import { describe, expect, it } from 'vitest'

import { Simulation } from '@/game/core/Simulation'
import { GameEvent } from '@/game/core/World'
import { trackedTarget } from '@/game/core/view'

describe('Simulation perk commands', () => {
  it('selectPerk appends once and emits PerkSelected', () => {
    const sim = new Simulation('TESTSEED')
    sim.startRun()
    sim.selectPerk('rapid_ordnance')
    sim.selectPerk('rapid_ordnance')
    expect(sim.world.activePerks).toEqual(['rapid_ordnance'])
    let selected = 0
    for (let i = 0; i < sim.world.events.count; i++) {
      if (sim.world.events.type[i] === GameEvent.PerkSelected) selected++
    }
    expect(selected).toBe(1)
  })

  it('resolveLegendary fits one card and clears the offer', () => {
    const sim = new Simulation('TESTSEED')
    sim.startRun()
    sim.world.legendaryOffer = ['a', 'b', 'c']
    sim.resolveLegendary('b')
    expect(sim.world.activePerks).toEqual(['b'])
    expect(sim.world.legendaryOffer).toEqual([])
  })

  it('trackedTarget is idle on a fresh world', () => {
    const sim = new Simulation('TESTSEED')
    expect(trackedTarget(sim.world)).toBe(-1)
  })
})
