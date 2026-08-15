/**
 * Endless mode invariants (§9).
 *
 * Endless generates waves rather than authoring them, which means nobody reads
 * wave 200 before a player flies it. The caps in `endlessWave` are what stop it
 * degenerating, so they are the thing worth testing — not that the numbers are
 * "right", but that the shape of the game survives arbitrarily far out.
 */
import { describe, expect, it } from 'vitest'

import { WAVES, waveAt, waveDefinition, waveEnemyCount } from '@/game/data/waves'
import { isFinalWave } from '@/game/systems/SpawnSystem'
import { DRAIN_RATE_PER_HARVESTER, MAX_ENEMIES, R, V_CRUISE } from '@/game/data/constants'

/**
 * The longest flight in the game: half the circumference, at cruise. Every
 * deadline in Endless has to leave more than this, or the wave is decided by
 * the spawn position rather than by the player.
 */
const CROSSING_SECONDS = (Math.PI * R) / V_CRUISE

/** Far enough out that every cap has long since bound. */
const DEEP = [13, 14, 20, 47, 120, 999]

describe('the campaign is unchanged by the existence of Endless', () => {
  it('waves 1 to 12 are the authored ones in both modes', () => {
    for (let n = 1; n <= WAVES.length; n++) {
      expect(waveDefinition(n, false)).toBe(waveAt(n))
      expect(waveDefinition(n, true)).toBe(waveAt(n))
    }
  })

  it('the campaign still ends at wave 12', () => {
    expect(waveDefinition(13, false)).toBeUndefined()
    expect(isFinalWave(WAVES.length)).toBe(true)
  })

  it('waveAt stays campaign-only, so callers that mean "authored" still get it', () => {
    // The Briefing, the balance harness and the wave tests all mean one of the
    // twelve when they ask. Quietly answering with a synthesised wave 47 would
    // make `WAVES.length` stop meaning anything.
    expect(waveAt(13)).toBeUndefined()
  })
})

describe('Endless continues without degenerating', () => {
  it('has no final wave, so it can only be survived and never won', () => {
    for (const n of DEEP) expect(isFinalWave(n, true), `wave ${n}`).toBe(false)
  })

  it('never threatens more than five of the eight outposts', () => {
    // With nothing safe there is no triage, only a lottery over which outposts
    // the spawn happened to put you near.
    for (const n of DEEP) {
      const wave = waveDefinition(n, true)
      expect(wave, `wave ${n}`).toBeDefined()
      expect(wave?.threatened, `wave ${n}`).toBeLessThanOrEqual(5)
      expect(wave?.threatened, `wave ${n}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('caps the drain rate so the far side stays reachable', () => {
    for (const n of DEEP) {
      const wave = waveDefinition(n, true)
      expect(wave?.drainScale, `wave ${n}`).toBeLessThanOrEqual(1.35)
    }
  })

  it('leaves enough time to cross the sphere and still shoot, at any depth', () => {
    // Derived from R and V_CRUISE rather than hardcoded, so changing the moon's
    // size or the cruise tuning fails here instead of quietly producing an
    // unwinnable wave 40. The 1.4x margin is the crossing plus time to clear.
    for (const n of DEEP) {
      const wave = waveDefinition(n, true)
      expect(wave, `wave ${n}`).toBeDefined()
      if (wave === undefined) continue
      const rate = DRAIN_RATE_PER_HARVESTER * wave.harvestersPerOutpost * wave.drainScale
      expect(100 / rate, `wave ${n} drain deadline`).toBeGreaterThan(CROSSING_SECONDS * 1.4)
    }
  })

  it('never queues more enemies than the pool can hold', () => {
    // `startWave` enqueues the whole wave up front, so an unbounded count would
    // exhaust the pool rather than merely being hard.
    for (const n of DEEP) {
      const wave = waveDefinition(n, true)
      expect(wave, `wave ${n}`).toBeDefined()
      if (wave === undefined) continue
      expect(waveEnemyCount(wave), `wave ${n}`).toBeLessThanOrEqual(MAX_ENEMIES)
    }
  })

  it('keeps the spawn interval above zero however deep the run goes', () => {
    for (const n of DEEP) {
      expect(waveDefinition(n, true)?.spawnInterval, `wave ${n}`).toBeGreaterThan(1)
    }
  })

  it('is monotonic in pressure across a cycle boundary', () => {
    const early = waveDefinition(13, true)
    const late = waveDefinition(60, true)
    expect(early).toBeDefined()
    expect(late).toBeDefined()
    if (early === undefined || late === undefined) return
    expect(late.harvestersPerOutpost).toBeGreaterThanOrEqual(early.harvestersPerOutpost)
    expect(late.interceptors).toBeGreaterThanOrEqual(early.interceptors)
    expect(late.drainScale).toBeGreaterThanOrEqual(early.drainScale)
  })
})
