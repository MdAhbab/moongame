/**
 * Recording and replaying a run (§10.4, §37.3).
 *
 * These are **security tests**, not convenience tests. The replay is the entire
 * mechanism by which a leaderboard score can be trusted: the server re-runs the
 * submitted inputs through this same simulation and accepts the result only if
 * it reproduces. Every property below is therefore load-bearing —
 *
 *  - if a replay does not reproduce, honest scores are rejected;
 *  - if `parseReplay` accepts something malformed, the server runs attacker-shaped
 *    work on its own CPU;
 *  - if the step count can be understated, a submission can claim a short run and
 *    then replay a long one.
 */
import { describe, expect, it } from 'vitest'

import { Simulation } from '@/game/core/Simulation'
import {
  InputPlayer,
  InputRecorder,
  REPLAY_FORMAT,
  decodeReplayFrames,
  encodeReplay,
  parseReplay,
  runReplay,
  type ReplayTarget,
  type RunContext,
} from '@/game/core/InputRecorder'
import { FIXED_DT, SIM_VERSION } from '@/game/data/constants'
import { Random } from '@/game/core/Random'

const LIMITS = { maxSteps: 200_000, maxFrames: 60_000 }

/** Stock parts on the default world — the context a new pilot flies in. */
const CONTEXT: RunContext = { worldId: 'mare-noctis', equipped: {} }

/**
 * Plays a scripted run, recording as it goes.
 *
 * The pilot is deliberately analogue — `rng.signed()` produces values that do
 * *not* land on quantisation boundaries — because a keyboard-only recording
 * would pass even if the quantisation write-back were broken.
 */
function recordRun(seed: string, seconds: number): { sim: Simulation; recorder: InputRecorder } {
  const sim = new Simulation(seed)
  sim.startRun()
  sim.skipBriefing()

  const recorder = new InputRecorder()
  const rng = new Random(1234)
  let t = 0

  sim.sampleInput = (world) => {
    t += FIXED_DT
    const input = world.input
    input.steerX = Math.sin(t * 0.7) * 0.83
    input.steerY = 0
    input.strafe = Math.sin(t * 1.3) * 0.61
    input.climb = Math.cos(t * 0.4) * 0.5
    input.throttle = 0.7 + Math.sin(t * 0.2) * 0.3
    input.firing = rng.next() > 0.4
    input.locking = rng.next() > 0.9
    input.boosting = Math.sin(t * 0.15) > 0.85
    input.requestLockTarget = -1
    recorder.record(input)
  }

  // The same wave-boundary commands the shell issues, so a recording that
  // crosses a wave describes the run the driver will reproduce.
  for (let i = 0; i < Math.round(seconds * 120); i++) {
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
  sim.sampleInput = null
  return { sim, recorder }
}

/**
 * Steps a simulation the way the shell does, including the wave-boundary
 * commands. Returns how many boundaries were crossed.
 */
function play(sim: Simulation, steps: number): number {
  let boundaries = 0
  for (let i = 0; i < steps; i++) {
    sim.advance(FIXED_DT)
    sim.world.events.clear()
    const phase = sim.world.phase
    if (phase.kind === 'WaveClear') {
      sim.captureWaveSummary()
      sim.advanceWave()
      sim.skipBriefing()
      boundaries++
    } else if (phase.kind === 'RunOver') {
      break
    }
  }
  return boundaries
}

/**
 * Replays a log through the shared driver.
 *
 * Deliberately not a hand-rolled loop: the driver is the thing the server will
 * use, so testing anything else would be testing code nobody runs.
 */
function replayRun(replay: ReturnType<InputRecorder['build']>): Simulation {
  return runReplay(replay, (seed) => new Simulation(seed)) as Simulation
}

describe('a replay reproduces the run', () => {
  it('lands on identical state after a full run', () => {
    // The claim the leaderboard rests on, stated once.
    const { sim, recorder } = recordRun('REPLAY-EXACT', 20)
    const replay = recorder.build('REPLAY-EXACT', SIM_VERSION, false, CONTEXT)
    const replayed = replayRun(replay)

    expect(replayed.world.craft.position.x).toBeCloseTo(sim.world.craft.position.x, 9)
    expect(replayed.world.craft.position.y).toBeCloseTo(sim.world.craft.position.y, 9)
    expect(replayed.world.craft.position.z).toBeCloseTo(sim.world.craft.position.z, 9)
    expect(replayed.world.score.total).toBe(sim.world.score.total)
    expect(replayed.world.score.shots).toBe(sim.world.score.shots)
    expect(replayed.world.score.hits).toBe(sim.world.score.hits)
    expect(replayed.world.craft.hull).toBeCloseTo(sim.world.craft.hull, 9)
  })

  it('reproduces every outpost, not just the score', () => {
    const { sim, recorder } = recordRun('REPLAY-OUTPOSTS', 25)
    const replayed = replayRun(recorder.build('REPLAY-OUTPOSTS', SIM_VERSION, false, CONTEXT))

    for (let i = 0; i < sim.world.outposts.length; i++) {
      const original = sim.world.outposts[i]
      const copy = replayed.world.outposts[i]
      expect(copy?.integrity).toBeCloseTo(original?.integrity ?? -1, 9)
      expect(copy?.status).toBe(original?.status)
    }
  })

  it('quantises in place, so the log describes the run it came from', () => {
    // The subtle one. Quantising for storage while letting the simulation run on
    // the unrounded value would make the recording a *different* run from the
    // one played — and it would only show up for analogue input, so a
    // keyboard-only test would pass and every mouse-flown replay would fail.
    const recorder = new InputRecorder()
    const input = {
      steerX: 0.123456789, steerY: -0.987654321, strafe: 0.5555, climb: -0.3333,
      throttle: 0.777777, firing: false, locking: false, flaring: false, boosting: false,
      bombing: false, switchWeapon: false, engineCutToggle: false,
      requestLockTarget: -1,
      switchWeaponPressed: false, engineCutPressed: false, bombPressed: false, flarePressed: false,
    }
    recorder.record(input)
    // Every axis must now be exactly representable in the log's precision.
    for (const key of ['steerX', 'steerY', 'strafe', 'climb', 'throttle'] as const) {
      expect(Number.isInteger(input[key] * 127), key).toBe(true)
    }
  })
})

describe('the log is small enough to send', () => {
  it('collapses a held control into one frame', () => {
    // Run-length encoding earns its keep on the keyboard, where a turn is held
    // for half a second — sixty identical steps.
    const recorder = new InputRecorder()
    const held = {
      steerX: 1, steerY: 0, strafe: 0, climb: 0, throttle: 1,
      firing: true, locking: false, flaring: false, boosting: false,
      bombing: false, switchWeapon: false, engineCutToggle: false,
      requestLockTarget: -1,
      switchWeaponPressed: false, engineCutPressed: false, bombPressed: false, flarePressed: false,
    }
    for (let i = 0; i < 600; i++) recorder.record({ ...held })

    expect(recorder.stepCount).toBe(600)
    expect(recorder.frameCount, 'five seconds of a held key is one entry').toBe(1)
  })

  it('survives the case where run-length encoding does nothing', () => {
    // And this is why the wire form is packed rather than JSON. A player flying
    // with a mouse produces a *new* quantised frame on almost every step,
    // because the virtual stick decays continuously toward centre — so the
    // realistic worst case is close to one frame per step, and the encoding has
    // to be sized for that rather than for the keyboard's best case.
    const { recorder } = recordRun('REPLAY-SIZE', 20)
    expect(recorder.stepCount).toBe(2400)

    const replay = recorder.build('REPLAY-SIZE', SIM_VERSION, false, CONTEXT)
    const packed = encodeReplay(replay)
    const asJson = JSON.stringify(replay.frames).length

    // Under 12 bytes of base64 per frame, and several times smaller than the
    // structured form. Extrapolated, a twelve-wave run is a few hundred
    // kilobytes rather than several megabytes.
    expect(packed.length / replay.frames.length).toBeLessThan(12)
    expect(packed.length).toBeLessThan(asJson / 3)
  })

  it('round-trips exactly through the wire form', () => {
    // Lossy here would mean a replay that fails to verify a score that was
    // honestly earned.
    const { recorder } = recordRun('REPLAY-WIRE', 12)
    const replay = recorder.build('REPLAY-WIRE', SIM_VERSION, false, CONTEXT)
    const decoded = decodeReplayFrames(encodeReplay(replay), LIMITS)

    expect(decoded).not.toBeNull()
    expect(decoded?.steps).toBe(replay.steps)
    expect(decoded?.frames).toEqual(replay.frames)
  })

  it('replays identically from the wire form', () => {
    const { sim, recorder } = recordRun('REPLAY-WIRE-SIM', 15)
    const original = recorder.build('REPLAY-WIRE-SIM', SIM_VERSION, false, CONTEXT)
    const decoded = decodeReplayFrames(encodeReplay(original), LIMITS)
    expect(decoded).not.toBeNull()
    if (decoded === null) return

    const replayed = replayRun({ ...original, frames: decoded.frames, steps: decoded.steps })
    expect(replayed.world.score.total).toBe(sim.world.score.total)
    expect(replayed.world.craft.position.x).toBeCloseTo(sim.world.craft.position.x, 9)
  })

  it('rejects a packed log that overruns the limits', () => {
    const { recorder } = recordRun('REPLAY-WIRE-LIMIT', 6)
    const packed = encodeReplay(recorder.build('REPLAY-WIRE-LIMIT', SIM_VERSION, false, CONTEXT))
    expect(decodeReplayFrames(packed, { maxSteps: 10, maxFrames: 60_000 })).toBeNull()
    expect(decodeReplayFrames(packed, { maxSteps: 200_000, maxFrames: 2 })).toBeNull()
  })

  it('rejects packed bytes that are not a valid log', () => {
    expect(decodeReplayFrames('!!!not base64!!!', LIMITS)).toBeNull()
    // A truncated frame: varint present, axes missing.
    expect(decodeReplayFrames(encodeReplay({
      format: REPLAY_FORMAT, simVersion: SIM_VERSION, seed: 'X', endless: false, context: CONTEXT, steps: 1,
      frames: [{ steps: 1, steerX: 0, steerY: 0, strafe: 0, climb: 0, throttle: 127, buttons: 0, lockTarget: -1 }],
    }).slice(0, 4), LIMITS)).toBeNull()
  })
})

describe('parseReplay treats every submission as hostile', () => {
  const valid = (): unknown => {
    const { recorder } = recordRun('PARSE-VALID', 3)
    return JSON.parse(JSON.stringify(recorder.build('PARSE-VALID', SIM_VERSION, false, CONTEXT)))
  }

  it('accepts a well-formed replay', () => {
    expect(parseReplay(valid(), LIMITS)).not.toBeNull()
  })

  it('rejects a declared step count the frames do not add up to', () => {
    // Otherwise a submission claims a two-second run, passes the length check,
    // and then costs ten minutes of server CPU to replay.
    const payload = valid() as { steps: number }
    payload.steps = 10
    expect(parseReplay(payload, LIMITS)).toBeNull()
  })

  it('rejects a log longer than the limit', () => {
    const payload = valid() as { steps: number }
    expect(parseReplay(payload, { maxSteps: 5, maxFrames: 60_000 })).toBeNull()
  })

  it('rejects more frames than the limit', () => {
    expect(parseReplay(valid(), { maxSteps: 200_000, maxFrames: 1 })).toBeNull()
  })

  it('rejects an unknown wire format', () => {
    const payload = valid() as { format: number }
    payload.format = REPLAY_FORMAT + 1
    expect(parseReplay(payload, LIMITS)).toBeNull()
  })

  it('rejects out-of-range axes', () => {
    // A steer of 900 would not clamp inside the simulation until `stepInput`,
    // and accepting it here means storing data the format says cannot exist.
    const payload = valid() as { frames: { steerX: number }[] }
    const frame = payload.frames[0]
    if (frame !== undefined) frame.steerX = 900
    expect(parseReplay(payload, LIMITS)).toBeNull()
  })

  it('rejects a negative or fractional step run', () => {
    const payload = valid() as { frames: { steps: number }[] }
    const frame = payload.frames[0]
    if (frame !== undefined) frame.steps = 0
    expect(parseReplay(payload, LIMITS)).toBeNull()
  })

  it('rejects garbage outright', () => {
    expect(parseReplay(null, LIMITS)).toBeNull()
    expect(parseReplay('nope', LIMITS)).toBeNull()
    expect(parseReplay({ format: REPLAY_FORMAT }, LIMITS)).toBeNull()
    expect(parseReplay({ ...(valid() as object), frames: 'nope' }, LIMITS)).toBeNull()
  })

  it('preserves the simulation version, so retired physics can be refused', () => {
    // A replay is only meaningful against the physics it ran on. The server
    // compares this; there is no honest way to migrate an input log.
    const parsed = parseReplay(valid(), LIMITS)
    expect(parsed?.simVersion).toBe(SIM_VERSION)
  })
})

describe('a replay that runs out coasts rather than repeating', () => {
  it('writes neutral input past the end of the log', () => {
    const { recorder } = recordRun('REPLAY-END', 2)
    const replay = recorder.build('REPLAY-END', SIM_VERSION, false, CONTEXT)
    const player = new InputPlayer(replay)

    const input = {
      steerX: 1, steerY: 1, strafe: 1, climb: 1, throttle: 0,
      firing: true, locking: true, flaring: false, boosting: true,
      bombing: false, switchWeapon: false, engineCutToggle: false,
      requestLockTarget: 4,
      switchWeaponPressed: false, engineCutPressed: false, bombPressed: false, flarePressed: false,
    }
    for (let i = 0; i < replay.steps + 10; i++) player.apply(input)

    expect(player.finished).toBe(true)
    // A held turn that never released would silently corrupt anything appended
    // after a replay — a ghost, a resumed run, a debug session.
    expect(input.steerX).toBe(0)
    expect(input.firing).toBe(false)
    expect(input.throttle).toBe(1)
  })
})

describe('the driver issues the commands the shell issues', () => {
  /**
   * A run is not only input.
   *
   * At every wave boundary the *shell* issues commands the world does not issue
   * for itself, and one of them has a side effect on score:
   * `captureWaveSummary` calls `settleWave`, which awards the accuracy,
   * no-damage and all-intact bonuses. A driver that stepped input and skipped
   * that call would finish a multi-wave replay with a lower score than the run
   * it was replaying — and would then reject an honest submission as a forgery,
   * which is the worst failure this system can have.
   *
   * Tested against a stand-in rather than a live simulation because reaching a
   * natural wave clear needs a pilot that can hit a *landed* Harvester, and
   * doing that requires breaking off and re-approaching from ~32 u out — the
   * nose pitches only 38° down, by design. A boundary test that never reaches a
   * boundary would pass while testing nothing, which is worse than no test.
   */
  function fakeTarget(phases: string[]): {
    target: ReplayTarget
    calls: string[]
  } {
    const calls: string[] = []
    let step = 0
    const world = {
      phase: { kind: 'Playing' },
      events: { clear: () => undefined },
      input: {
        steerX: 0, steerY: 0, strafe: 0, climb: 0, throttle: 1,
        firing: false, locking: false, boosting: false, requestLockTarget: -1,
      },
    }
    const target = {
      world,
      sampleInput: null,
      advance: () => {
        world.phase = { kind: phases[step] ?? 'Playing' }
        step++
        return 0
      },
      applyRunContext: () => { calls.push('applyRunContext') },
      startRun: () => { calls.push('startRun') },
      skipBriefing: () => { calls.push('skipBriefing') },
      advanceWave: () => { calls.push('advanceWave') },
      captureWaveSummary: () => { calls.push('captureWaveSummary'); return null },
    }
    return { target: target as unknown as ReplayTarget, calls }
  }

  const emptyReplay = (steps: number): ReturnType<InputRecorder['build']> => ({
    format: REPLAY_FORMAT,
    simVersion: SIM_VERSION,
    seed: 'DRIVER',
    endless: false,
    context: CONTEXT,
    steps,
    frames: [{ steps, steerX: 0, steerY: 0, strafe: 0, climb: 0, throttle: 127, buttons: 0, lockTarget: -1 }],
  })

  it('settles the wave before advancing it', () => {
    const { target, calls } = fakeTarget(['Playing', 'WaveClear', 'Playing'])
    runReplay(emptyReplay(3), () => target)

    expect(calls).toEqual([
      // Context first, always: gravity, drag and every part multiplier have to
      // be in place before the first step, or the replay is a different run.
      'applyRunContext',
      'startRun',
      'skipBriefing',
      // The boundary, in the order `App.tsx` performs it.
      'captureWaveSummary',
      'advanceWave',
      'skipBriefing',
    ])
  })

  it('handles several boundaries in one replay', () => {
    const { target, calls } = fakeTarget(['WaveClear', 'Playing', 'WaveClear', 'Playing'])
    runReplay(emptyReplay(4), () => target)
    expect(calls.filter((c) => c === 'captureWaveSummary')).toHaveLength(2)
    expect(calls.filter((c) => c === 'advanceWave')).toHaveLength(2)
  })

  it('stops at RunOver rather than stepping a finished world', () => {
    const { target, calls } = fakeTarget(['Playing', 'RunOver', 'Playing', 'Playing'])
    runReplay(emptyReplay(4), () => target)
    expect(calls).toEqual(['applyRunContext', 'startRun', 'skipBriefing'])
  })

  it('carries the endless flag into the run it starts', () => {
    let sawEndless: boolean | undefined
    const { target } = fakeTarget(['Playing'])
    const spy = { ...target, startRun: (endless?: boolean) => { sawEndless = endless } }
    runReplay({ ...emptyReplay(1), endless: true }, () => spy)
    expect(sawEndless).toBe(true)
  })
})

describe('a live run records itself', () => {
  it('captures the run and can verify its own score', () => {
    // End to end, through the public surface a real session uses. This is the
    // shape of the leaderboard's happy path: play, build, replay, compare.
    const sim = new Simulation('LIVE-RECORD')
    sim.startRun()
    sim.skipBriefing()

    let t = 0
    sim.sampleInput = (world) => {
      t += FIXED_DT
      const input = world.input
      input.steerX = Math.sin(t * 0.6) * 0.7
      input.steerY = 0
      input.strafe = Math.cos(t * 0.9) * 0.4
      input.climb = 0
      input.throttle = 1
      input.firing = Math.sin(t * 3) > 0
      input.locking = false
      input.boosting = false
      input.requestLockTarget = -1
    }
    play(sim, 120 * 15)
    sim.sampleInput = null

    const replay = sim.buildReplay()
    expect(replay).not.toBeNull()
    if (replay === null) return

    expect(replay.seed).toBe('LIVE-RECORD')
    expect(replay.simVersion).toBe(SIM_VERSION)
    expect(sim.recordedSteps).toBe(replay.steps)

    const verified = replayRun(replay)
    expect(verified.world.score.total).toBe(sim.world.score.total)
    expect(verified.world.craft.position.x).toBeCloseTo(sim.world.craft.position.x, 9)
  })

  it('does not record the menu autopilot', () => {
    // The attract loop flies the craft behind the Title screen. Recording it
    // would prefix every replay with a lap the player never flew, and the
    // verification would fail on the first honest submission.
    const sim = new Simulation('LIVE-ATTRACT')
    sim.resetRun()
    for (let i = 0; i < 240; i++) {
      sim.advance(FIXED_DT)
      sim.world.events.clear()
    }
    expect(sim.recordedSteps).toBe(0)
    expect(sim.buildReplay()).toBeNull()

    sim.startRun()
    sim.skipBriefing()
    play(sim, 60)
    expect(sim.recordedSteps).toBe(60)
  })
})

describe('the replay carries the context the run was flown in', () => {
  /**
   * The regression that made the whole leaderboard useless.
   *
   * `Replay` recorded seed, inputs and step count, and nothing about *physics*.
   * But gravity and drag come from the world, and thrust, drag, hull and turn
   * rate all come from the equipped parts — and the shell applied both by hand
   * at the Briefing beat, in code the verifier had no equivalent of. So the
   * server replayed every submission under Mare Noctis gravity with stock parts.
   *
   * The result was not a security hole; it was worse in a quieter way. Every
   * honest run flown on Thule or Ashfall, or with a single part equipped,
   * produced a different score on replay and was rejected as a forgery. The
   * feature would have looked like it worked, for exactly the players who had
   * unlocked nothing yet.
   */
  const scoreUnder = (context: RunContext): number => {
    const sim = new Simulation('CONTEXT-MATTERS')
    sim.applyRunContext(context)
    sim.startRun()
    sim.skipBriefing()
    let t = 0
    sim.sampleInput = (world) => {
      t += FIXED_DT
      world.input.steerX = Math.sin(t * 0.7) * 0.9
      world.input.throttle = 1
      world.input.firing = Math.sin(t * 2.5) > 0
      world.input.requestLockTarget = -1
    }
    play(sim, 1800)
    sim.sampleInput = null
    return sim.world.craft.position.x
  }

  it('a different world really does fly differently', () => {
    // If this ever fails, the test below is proving nothing.
    const home = scoreUnder({ worldId: 'mare-noctis', equipped: {} })
    const ashfall = scoreUnder({ worldId: 'ashfall', equipped: {} })
    expect(ashfall, 'Ashfall is heavier and draggier than Mare Noctis').not.toBeCloseTo(home, 3)
  })

  it('an equipped part really does fly differently', () => {
    const stock = scoreUnder({ worldId: 'mare-noctis', equipped: {} })
    const tuned = scoreUnder({ worldId: 'mare-noctis', equipped: { Engine: 'engine-whisper' } })
    expect(tuned, 'a +7% thrust engine changes the trajectory').not.toBeCloseTo(stock, 3)
  })

  it('reproduces a run flown on another world with parts equipped', () => {
    // The property the leaderboard actually needs, stated once.
    const context: RunContext = { worldId: 'ashfall', equipped: { Engine: 'engine-whisper' } }

    const sim = new Simulation('CONTEXT-REPLAY')
    sim.applyRunContext(context)
    sim.startRun()
    sim.skipBriefing()
    const recorder = new InputRecorder()
    let t = 0
    sim.sampleInput = (world) => {
      t += FIXED_DT
      world.input.steerX = Math.sin(t * 0.7) * 0.83
      world.input.strafe = Math.sin(t * 1.3) * 0.61
      world.input.throttle = 0.8
      world.input.firing = Math.sin(t * 2.2) > 0
      world.input.requestLockTarget = -1
      recorder.record(world.input)
    }
    play(sim, 2400)
    sim.sampleInput = null

    const replayed = replayRun(recorder.build('CONTEXT-REPLAY', SIM_VERSION, false, context))

    expect(replayed.world.score.total).toBe(sim.world.score.total)
    expect(replayed.world.craft.position.x).toBeCloseTo(sim.world.craft.position.x, 9)
    expect(replayed.world.craft.position.y).toBeCloseTo(sim.world.craft.position.y, 9)
    expect(replayed.world.craft.position.z).toBeCloseTo(sim.world.craft.position.z, 9)
  })

  it('does not let a submission invent its own physics', () => {
    // Only identifiers cross the wire. A payload carrying multipliers is not a
    // context that means anything, and an unknown world or part falls back to
    // the registry default rather than being honoured.
    const parsed = parseReplay(
      JSON.parse(JSON.stringify(
        new InputRecorder().build('X', SIM_VERSION, false, {
          worldId: 'no-such-world',
          equipped: { Engine: 'no-such-part' },
        }),
      )),
      LIMITS,
    )
    expect(parsed).not.toBeNull()

    const sim = new Simulation('X')
    sim.applyRunContext(parsed?.context ?? CONTEXT)
    // Unknown world → default environment; unknown part → stock multipliers.
    expect(sim.world.environment.gravity).toBe(1)
    expect(sim.world.environment.drag).toBe(1)
    expect(sim.world.loadout.thrust).toBe(1)
  })

  it('rejects a context shaped to pollute a prototype', () => {
    // Through `JSON.parse`, deliberately — that is the only path a submission
    // takes, and it is the only path where `__proto__` survives as a real own
    // property. In an object *literal* the engine swallows it, so a test written
    // the obvious way would pass against a validator that did nothing.
    expect(parseReplay(JSON.parse(
      '{"format":1,"simVersion":' + String(SIM_VERSION) + ',"seed":"P","endless":false,' +
      '"steps":0,"frames":[],"context":{"worldId":"mare-noctis","equipped":{"__proto__":"x"}}}',
    ), LIMITS)).toBeNull()

    expect(parseReplay({
      format: REPLAY_FORMAT, simVersion: SIM_VERSION, seed: 'P', endless: false, steps: 0,
      frames: [], context: { worldId: 'mare-noctis' },
    }, LIMITS), 'a context with no loadout at all is malformed').toBeNull()

    expect(parseReplay({
      format: REPLAY_FORMAT, simVersion: SIM_VERSION, seed: 'P', endless: false, steps: 0,
      frames: [], context: null,
    }, LIMITS), 'a replay with no context cannot be verified').toBeNull()
  })
})
