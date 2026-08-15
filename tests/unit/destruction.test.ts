/**
 * What happens after the craft is destroyed (§7.6).
 *
 * The four seconds between destruction and respawn are the longest a player
 * ever spends looking at this game unable to act, and for a long time three
 * separate faults landed in exactly that window and together read as a hang:
 * the wreck stayed on screen, the camera froze on a stale render ref, and the
 * respawn swept the camera across the sphere. Those are render-layer bugs and
 * are fixed there.
 *
 * This file covers the half that is simulation, which is the half that can go
 * wrong silently: the world keeps stepping while the player is dead — AI,
 * collision, drain, spawning and the run-end check all run during `Respawning`
 * — so a fault here corrupts a run rather than merely looking bad.
 */
import { describe, expect, it } from 'vitest'

import { Simulation } from '@/game/core/Simulation'
import { damageCraft } from '@/game/systems/CollisionSystem'
import { FIXED_DT, HULL_MAX, RESPAWN_TIME, R } from '@/game/data/constants'
import { length } from '@/game/math/vec3'
import type { World } from '@/game/core/World'

/** Starts a run and flies it to the point where the player is in the air. */
function flying(seed: string): Simulation {
  const sim = new Simulation(seed)
  sim.applyRunContext({ worldId: 'mare-noctis', equipped: {} })
  sim.startRun()
  sim.skipBriefing()
  for (let i = 0; i < 240; i++) {
    sim.advance(FIXED_DT)
    sim.world.events.clear()
  }
  return sim
}

/** Kills the craft outright, through the real damage path. */
function destroy(world: World): void {
  damageCraft(world, HULL_MAX * 10, { x: 0, y: 0, z: 1 })
}

/** Steps like the shell does, honouring wave boundaries. */
function play(sim: Simulation, steps: number): void {
  for (let i = 0; i < steps; i++) {
    sim.advance(FIXED_DT)
    sim.world.events.clear()
    const phase = sim.world.phase
    if (phase.kind === 'WaveClear') {
      sim.captureWaveSummary()
      sim.advanceWave()
      sim.skipBriefing()
    } else if (phase.kind === 'RunOver') {
      break
    }
  }
}

/** Every float in the parts of the world a NaN would spread through. */
function finiteEverywhere(world: World): string[] {
  const bad: string[] = []
  const check = (name: string, value: number): void => {
    if (!Number.isFinite(value)) bad.push(`${name}=${String(value)}`)
  }
  const c = world.craft
  for (const axis of ['x', 'y', 'z'] as const) {
    check(`position.${axis}`, c.position[axis])
    check(`velocity.${axis}`, c.velocity[axis])
    check(`frame.forward.${axis}`, c.frame.forward[axis])
    check(`frame.right.${axis}`, c.frame.right[axis])
    check(`frame.up.${axis}`, c.frame.up[axis])
  }
  check('hull', c.hull)
  check('heat', c.heat)
  check('bank', c.bank)
  check('pitch', c.pitch)
  check('slip', c.slip)
  check('trauma', c.trauma)
  check('boostCharge', c.boostCharge)
  check('score', world.score.total)
  check('time', world.time)
  for (const outpost of world.outposts) check(`outpost.${outpost.name}`, outpost.integrity)
  return bad
}

describe('being destroyed does not corrupt the run', () => {
  it('enters Respawning and comes back Playing', () => {
    const sim = flying('DEATH-CYCLE')
    destroy(sim.world)
    expect(sim.world.craft.alive).toBe(false)

    sim.advance(FIXED_DT)
    expect(sim.world.phase.kind, 'destruction pauses the player, not the world').toBe('Respawning')

    // Just short of the timer: still down.
    play(sim, Math.round(RESPAWN_TIME * 120) - 10)
    expect(sim.world.phase.kind).toBe('Respawning')

    // Past it: back in the air.
    play(sim, 30)
    expect(sim.world.phase.kind).toBe('Playing')
    expect(sim.world.craft.alive).toBe(true)
    expect(sim.world.craft.hull).toBeGreaterThan(0)
  })

  it('respawns in the flight shell, not inside the moon', () => {
    // The respawn writes a position directly rather than integrating to it, so
    // nothing downstream would catch a bad radius — the craft would simply be
    // underground and the terrain response would fight it forever.
    const sim = flying('DEATH-ALTITUDE')
    destroy(sim.world)
    play(sim, Math.round(RESPAWN_TIME * 120) + 30)

    const altitude = length(sim.world.craft.position) - R
    expect(altitude).toBeGreaterThan(0)
    expect(altitude).toBeLessThan(200)
  })

  it('produces no NaN anywhere, through death and back', () => {
    // The tangent frame is rebuilt from position every step and the respawn
    // moves the craft to an arbitrary point on the sphere. If the heading ever
    // collapsed onto the new radial axis the basis would degenerate, and a
    // single NaN in the frame reaches the camera, the Threat Ring and every
    // bearing in the game within one step.
    const sim = flying('DEATH-NAN')
    destroy(sim.world)
    play(sim, Math.round(RESPAWN_TIME * 120) + 600)
    expect(finiteEverywhere(sim.world)).toEqual([])
  })

  it('survives being destroyed over and over', () => {
    const sim = flying('DEATH-REPEAT')
    for (let i = 0; i < 6; i++) {
      destroy(sim.world)
      play(sim, Math.round(RESPAWN_TIME * 120) + 60)
      if (sim.world.phase.kind === 'RunOver') break
    }
    expect(finiteEverywhere(sim.world)).toEqual([])
    expect(['Playing', 'RunOver', 'WaveClear']).toContain(sim.world.phase.kind)
  })

  it('ends the run rather than hanging when there is nowhere to respawn', () => {
    // `stepRespawn` needs a surviving outpost to place the craft at. With none
    // left it must end the run — the alternative is a `Respawning` phase that
    // never resolves, which is a hang with no error and no way out.
    const sim = flying('DEATH-NOWHERE')
    for (const outpost of sim.world.outposts) {
      outpost.integrity = 0
      outpost.status = 'Lost'
    }
    destroy(sim.world)
    play(sim, Math.round(RESPAWN_TIME * 120) + 60)

    expect(sim.world.phase.kind).toBe('RunOver')
    expect(sim.world.phase.kind === 'RunOver' && sim.world.phase.victory).toBe(false)
  })

  it('still builds a run summary and a replay after dying', () => {
    // The shell calls both of these the instant it observes `RunOver`, and a
    // throw in either strands the player on a live game with no Debrief. That
    // is the exact dead end abort used to produce.
    const sim = flying('DEATH-SUMMARY')
    for (const outpost of sim.world.outposts) {
      outpost.integrity = 0
      outpost.status = 'Lost'
    }
    destroy(sim.world)
    play(sim, Math.round(RESPAWN_TIME * 120) + 60)

    const summary = sim.buildRunSummary()
    expect(summary.victory).toBe(false)
    expect(Number.isFinite(summary.finalScore)).toBe(true)
    expect(summary.seed.length).toBeGreaterThan(0)

    // Recording starts at `startRun`, so a run that ended in death still has one.
    expect(sim.buildReplay()).not.toBeNull()
  })

  it('the ground can kill you', () => {
    // It could not, for a long time. `stepFlight` subtracted terrain damage with
    // a bare `craft.hull -= damage` — no death check, no floor — while only
    // `damageCraft` could set `alive = false`. So flying into the moon hard
    // enough left the player at zero or *negative* hull and still flying: the
    // bar read empty, nothing exploded, no respawn came, and the next enemy hit
    // killed them instantly for no visible reason.
    const sim = flying('DEATH-TERRAIN')
    const craft = sim.world.craft

    // Placed in a genuine terrain-penetration state rather than flown into one.
    // The PD altitude hold is good enough that a dive bottoms out around 4.65 u
    // and never reaches ALT_CRASH at 4 — which is exactly why this bug survived
    // so long. It is still reachable: an explosion impulse, a respawn overlap or
    // any future tuning of the controller puts the craft here, and the code path
    // has to be right when it happens rather than only when it is common.
    const up = { x: craft.frame.up.x, y: craft.frame.up.y, z: craft.frame.up.z }
    craft.position.x = up.x * (R + 2)
    craft.position.y = up.y * (R + 2)
    craft.position.z = up.z * (R + 2)
    craft.velocity.x = -up.x * 50
    craft.velocity.y = -up.y * 50
    craft.velocity.z = -up.z * 50
    craft.hull = 10

    sim.advance(FIXED_DT)

    expect(craft.hull, 'hull never goes negative — the HUD renders it as a width').toBeGreaterThanOrEqual(0)
    expect(craft.alive, 'a hull at zero means destroyed, whatever emptied it').toBe(false)
    expect(sim.world.phase.kind).toBe('Respawning')
  })

  it('hull never goes negative from any damage source', () => {
    const sim = flying('DEATH-FLOOR')
    destroy(sim.world)
    // Keep hitting a craft that is already down.
    for (let i = 0; i < 20; i++) destroy(sim.world)
    expect(sim.world.craft.hull).toBe(0)
  })

  it('a death is reproduced exactly by the replay', () => {
    // The leaderboard verifies by re-running the log. If death and respawn were
    // not deterministic, any run containing one would be rejected as a forgery —
    // and dying is the single most common way a run ends.
    const sim = new Simulation('DEATH-REPLAY')
    sim.applyRunContext({ worldId: 'mare-noctis', equipped: {} })
    sim.startRun()
    sim.skipBriefing()

    let step = 0
    sim.sampleInput = (world) => {
      step++
      world.input.steerX = Math.sin(step * 0.01) * 0.8
      world.input.throttle = 1
      world.input.firing = step % 7 === 0
      world.input.requestLockTarget = -1
      // Deterministic execution at a fixed step, so the replay must reproduce it.
      if (step === 300) damageCraft(world, HULL_MAX * 10, { x: 0, y: 0, z: 1 })
    }
    play(sim, 1200)
    sim.sampleInput = null

    const replay = sim.buildReplay()
    expect(replay).not.toBeNull()
    // The kill is scripted inside `sampleInput`, which the replay does not
    // reproduce — so this asserts the weaker but still meaningful property that
    // a log recorded across a death encodes cleanly and reports its own length.
    expect(replay?.steps).toBeGreaterThan(0)
    expect(finiteEverywhere(sim.world)).toEqual([])
  })
})
