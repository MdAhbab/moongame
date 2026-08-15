/**
 * A session plays more than one run.
 *
 * The `Simulation` is created once and held for the whole session, because
 * rebuilding it would tear down and rebuild the scene, the moon and all eight
 * outposts on every wave (§31.2). That is the right call, and it comes with an
 * obligation nobody had met: something has to put the world back between runs.
 *
 * Nothing did. `startRun` was gated on `wave.number === 0`, which is true
 * exactly once per page load, so the second "START RUN" of a session walked into
 * a world still parked on `RunOver` with its outposts in ruins and its score
 * carried over from a game the player had already finished. The Briefing showed
 * for a moment, the phase poll saw `RunOver`, and the player was routed to the
 * Debrief for a run they never flew. Reloading the page was the only cure, and
 * because every screen still navigated correctly, none of the existing tests
 * noticed.
 *
 * These are the invariants that make a second run a run.
 */
import { describe, expect, it } from 'vitest'

import { Simulation } from '@/game/core/Simulation'
import { survivingOutposts } from '@/game/core/World'
import { FIXED_DT, HULL_MAX } from '@/game/data/constants'

/** Advances the world by `seconds`, clearing events as a consumer would. */
function play(sim: Simulation, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 120); i++) {
    sim.advance(FIXED_DT)
    sim.world.events.clear()
  }
}

/** Puts the world into the state a finished, badly-going run leaves it in. */
function ruinTheRun(sim: Simulation): void {
  sim.startRun()
  sim.skipBriefing()
  play(sim, 4)
  sim.world.score.total = 4321
  sim.world.craft.hull = 12
  const first = sim.world.outposts[0]
  const second = sim.world.outposts[1]
  if (first !== undefined) {
    first.status = 'Lost'
    first.integrity = 0
    first.lostAt = 3
  }
  if (second !== undefined) second.integrity = 44
  sim.abortRun()
}

describe('a run can be started twice', () => {
  it('restores every outpost, so run two does not begin in ruins', () => {
    const sim = new Simulation('SECOND-RUN')
    ruinTheRun(sim)
    expect(survivingOutposts(sim.world)).toBeLessThan(8)

    sim.resetRun()
    sim.startRun()

    expect(survivingOutposts(sim.world)).toBe(8)
    for (const outpost of sim.world.outposts) {
      expect(outpost.integrity, outpost.name).toBe(100)
      expect(outpost.status, outpost.name).toBe('Nominal')
      expect(outpost.lostAt, outpost.name).toBe(-1)
    }
  })

  it('starts the score, the clock and the hull from zero', () => {
    const sim = new Simulation('SECOND-RUN-SCORE')
    ruinTheRun(sim)

    sim.resetRun()
    sim.startRun()

    expect(sim.world.score.total).toBe(0)
    expect(sim.world.score.killsHarvester).toBe(0)
    expect(sim.world.time).toBe(0)
    expect(sim.world.craft.hull).toBe(HULL_MAX)
    expect(sim.world.craft.alive).toBe(true)
  })

  it('begins at wave 1 rather than wherever the last run stopped', () => {
    const sim = new Simulation('SECOND-RUN-WAVE')
    sim.startRun()
    sim.beginWave(7)
    expect(sim.world.wave.number).toBe(7)

    sim.resetRun()
    sim.startRun()
    expect(sim.world.wave.number).toBe(1)
  })

  it('leaves nothing alive from the previous run', () => {
    const sim = new Simulation('SECOND-RUN-POOLS')
    sim.startRun()
    sim.skipBriefing()
    play(sim, 12)
    expect(sim.world.enemies.pool.count).toBeGreaterThan(0)

    sim.resetRun()
    expect(sim.world.enemies.pool.count).toBe(0)
    expect(sim.world.playerProjectiles.pool.count).toBe(0)
    expect(sim.world.enemyProjectiles.pool.count).toBe(0)
    expect(sim.world.missiles.pool.count).toBe(0)
    expect(sim.world.particles.pool.count).toBe(0)
  })

  it('is deterministic across runs from the same seed', () => {
    // The whole point of reseeding per wave (§10.4): run two of a seed has to
    // reproduce run one, regardless of how run one went.
    const first = new Simulation('DETERMINISM')
    first.startRun()
    first.skipBriefing()
    play(first, 6)
    const firstPosition = { ...first.world.craft.position }

    first.resetRun()
    first.startRun()
    first.skipBriefing()
    play(first, 6)

    expect(first.world.craft.position.x).toBeCloseTo(firstPosition.x, 6)
    expect(first.world.craft.position.y).toBeCloseTo(firstPosition.y, 6)
    expect(first.world.craft.position.z).toBeCloseTo(firstPosition.z, 6)
  })
})

describe('aborting is an ending, not a navigation', () => {
  it('ends the run, so a summary exists to show', () => {
    const sim = new Simulation('ABORT')
    sim.startRun()
    sim.skipBriefing()
    play(sim, 5)

    sim.abortRun()

    expect(sim.world.phase.kind).toBe('RunOver')
    // `ResultsScreen` renders entirely from this. Aborting used to navigate
    // there without producing one, and the screen rendered as `null` — a
    // transparent, buttonless overlay over the live game with no way out.
    const summary = sim.buildRunSummary()
    expect(summary.victory).toBe(false)
    expect(summary.seed).toBe('ABORT')
    expect(summary.waveReached).toBe(1)
    expect(summary.outpostsRemaining).toBeGreaterThan(0)
  })

  it('does not overwrite a victory that already happened', () => {
    const sim = new Simulation('ABORT-AFTER-WIN')
    sim.startRun()
    sim.world.phase = { kind: 'RunOver', victory: true }
    sim.abortRun()
    expect(sim.buildRunSummary().victory).toBe(true)
  })
})

describe('the tutorial hands the world back', () => {
  it('reports completion once all three beats are cleared', () => {
    const sim = new Simulation('TUTORIAL-END')
    sim.startTutorial()
    expect(sim.tutorialComplete).toBe(false)

    sim.world.tutorialBeat = 3
    expect(sim.tutorialComplete).toBe(true)
  })

  it('leaves no tutorial state behind for the campaign that follows', () => {
    const sim = new Simulation('TUTORIAL-THEN-RUN')
    sim.startTutorial()
    sim.skipBriefing()
    play(sim, 3)

    sim.resetRun()
    sim.startRun()

    // A leftover `tutorialBeat ≥ 0` suppresses the wave spawner outright
    // (`stepSpawn` returns early), so a campaign that inherited it would be a
    // silent, permanently empty sky.
    expect(sim.world.tutorialBeat).toBe(-1)
    play(sim, 6)
    expect(sim.world.enemies.pool.count).toBeGreaterThan(0)
  })
})
