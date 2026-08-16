/**
 * The UI stepping predicates must not quietly disagree with each other.
 *
 * `WaveClear` used to be listed as "sim running" in one place and frozen in
 * another. Menus freeze the world on purpose — the Debrief is untimed.
 */
import { describe, expect, it } from 'vitest'

import {
  screenAnimatesAttract,
  screenRunsSimulation,
  type Screen,
} from '@/state/useGameStore'

const ALL: Screen[] = [
  'Boot', 'Loading', 'Title', 'Settings', 'Tutorial', 'Briefing',
  'Playing', 'Paused', 'WaveClear', 'LegendaryChoice', 'Debrief',
  'Results', 'Credits', 'Hangar', 'Profile', 'Account', 'Leaderboard',
]

describe('screen stepping predicates', () => {
  it('runs the simulation only while the player is flying', () => {
    expect(ALL.filter(screenRunsSimulation)).toEqual(['Tutorial', 'Playing'])
  })

  it('animates attract behind menus that show the scene, not behind wave screens', () => {
    expect(ALL.filter(screenAnimatesAttract).sort()).toEqual(
      ['Account', 'Credits', 'Hangar', 'Leaderboard', 'Profile', 'Title'].sort(),
    )
  })

  it('does not step the world on WaveClear, Paused, Briefing, or Results', () => {
    for (const screen of ['WaveClear', 'Paused', 'Briefing', 'Results', 'Debrief', 'Settings'] as const) {
      expect(screenRunsSimulation(screen), screen).toBe(false)
      expect(screenAnimatesAttract(screen), screen).toBe(false)
    }
  })
})
