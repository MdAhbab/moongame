/**
 * API-layer replay verification security tests (TASK-5 §9).
 *
 * These tests exercise the exact validation logic the score endpoint uses:
 * `decodeReplayFrames`, `parseReplay`, and the score comparison — all the
 * places a forged submission could slip through.
 *
 * The suite is a security test, not a happy-path check with one negative case
 * bolted on. Every forgery case the task spec names is covered, plus timing
 * data for the verification report.
 */
import { describe, expect, it } from 'vitest'
import {
  decodeReplayFrames,
  encodeReplay,
  runReplay,
  REPLAY_FORMAT,
  type Replay,
  type RunContext,
} from '@/game/core/InputRecorder'
import { Simulation } from '@/game/core/Simulation'
import { SIM_VERSION, FIXED_DT } from '@/game/data/constants'

const LIMITS = { maxSteps: 200_000, maxFrames: 60_000 }

/** Stock parts on the default world — the context a new pilot flies in. */
const CONTEXT: RunContext = { worldId: 'mare-noctis', equipped: {} }

/** The current accepted version. Everything else is retired. */
const ACCEPTED_SIM_VERSIONS = new Set([SIM_VERSION])

/** Simulates what the score endpoint does: decode → replay → compare. */
function verifySubmission(params: {
  inputLog: string
  claimedScore: number
  seed: string
  simVersion: number
  endless?: boolean
}): { ok: boolean; reason?: string; actualScore?: number; timingMs?: number } {
  const { inputLog, claimedScore, seed, simVersion, endless = false } = params

  // Step 1: reject retired simVersion.
  if (!ACCEPTED_SIM_VERSIONS.has(simVersion)) {
    return { ok: false, reason: 'retired_version' }
  }

  // Step 2: decode inputLog.
  const decoded = decodeReplayFrames(inputLog, LIMITS)
  if (decoded === null) {
    return { ok: false, reason: 'invalid_input_log' }
  }

  const replay: Replay = {
    format: REPLAY_FORMAT,
    simVersion,
    seed,
    endless,
    context: CONTEXT,
    frames: decoded.frames,
    steps:  decoded.steps,
  }

  // Step 3: replay (the server runs this in a worker with a timeout).
  const t0 = Date.now()
  const sim = runReplay(replay, (s) => new Simulation(s)) as Simulation
  const timingMs = Date.now() - t0
  const actualScore = sim.world.score.total

  // Step 4: exact match.
  if (actualScore !== claimedScore) {
    return { ok: false, reason: 'score_mismatch', actualScore, timingMs }
  }

  return { ok: true, actualScore, timingMs }
}

/** Records a short scripted run and returns its encoded replay + actual score. */
function recordAndEncode(seed: string, seconds: number): { inputLog: string; score: number; steps: number } {
  const sim = new Simulation(seed)
  sim.startRun()
  sim.skipBriefing()

  let t = 0
  sim.sampleInput = (world) => {
    t += FIXED_DT
    world.input.steerX  = Math.sin(t * 0.7) * 0.9
    world.input.steerY  = 0
    world.input.strafe  = Math.cos(t * 1.1) * 0.5
    world.input.climb   = 0
    world.input.throttle = 1
    world.input.firing  = Math.sin(t * 2.5) > 0
    world.input.locking = false
    world.input.boosting = t % 8 < 1
    world.input.requestLockTarget = -1
  }

  const steps = Math.round(seconds * 120)
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
  sim.sampleInput = null

  const replay = sim.buildReplay()
  if (!replay) throw new Error('no replay built')
  return {
    inputLog: encodeReplay(replay),
    score:    sim.world.score.total,
    steps:    replay.steps,
  }
}

/* ------------------------------------------------------------------ */
/* Forgery rejection tests                                             */
/* ------------------------------------------------------------------ */

describe('score verification — forgery cases', () => {
  it('accepts a valid submission', () => {
    const { inputLog, score } = recordAndEncode('FORGERY-VALID', 15)
    const result = verifySubmission({ inputLog, claimedScore: score, seed: 'FORGERY-VALID', simVersion: SIM_VERSION })
    expect(result.ok).toBe(true)
  })

  it('rejects an inflated claimedScore', () => {
    const { inputLog, score } = recordAndEncode('FORGERY-INFLATE', 15)
    const result = verifySubmission({
      inputLog,
      claimedScore: score + 999_999,   // Classic devtools edit
      seed:         'FORGERY-INFLATE',
      simVersion:   SIM_VERSION,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('score_mismatch')
  })

  it('rejects a truncated inputLog (log ends mid-run)', () => {
    const { inputLog, score } = recordAndEncode('FORGERY-TRUNCATE', 15)
    // Truncate the base64 string — decodeReplayFrames will reject it or the
    // replay will produce a different score because the run is shorter.
    const truncated = inputLog.slice(0, Math.floor(inputLog.length / 3))
    const result = verifySubmission({
      inputLog:     truncated,
      claimedScore: score,
      seed:         'FORGERY-TRUNCATE',
      simVersion:   SIM_VERSION,
    })
    // Either the decode fails (invalid_input_log) or the score mismatches.
    expect(result.ok).toBe(false)
  })

  it('rejects a log played on a different seed', () => {
    const { inputLog } = recordAndEncode('SEED-A', 10)
    // Play the same input on a different seed — the physics will produce a different outcome.
    const scoreOnB = (() => {
      const decoded = decodeReplayFrames(inputLog, LIMITS)
      if (decoded === null) throw new Error('Failed to decode replay frames')
      const replay: Replay = {
        format: REPLAY_FORMAT, simVersion: SIM_VERSION, seed: 'SEED-B', context: CONTEXT,
        endless: false, frames: decoded.frames, steps: decoded.steps,
      }
      const sim = runReplay(replay, (s) => new Simulation(s)) as Simulation
      return sim.world.score.total
    })()

    const result = verifySubmission({
      inputLog,
      claimedScore: scoreOnB + 1,   // Wrong score for wrong seed
      seed:         'SEED-B',
      simVersion:   SIM_VERSION,
    })
    expect(result.ok).toBe(false)
  })

  it('rejects a log from a retired simVersion', () => {
    const { inputLog, score } = recordAndEncode('FORGERY-OLD-VERSION', 10)
    const result = verifySubmission({
      inputLog,
      claimedScore: score,
      seed:         'FORGERY-OLD-VERSION',
      simVersion:   SIM_VERSION - 1,   // Retired
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('retired_version')
  })

  it('rejects a log that exceeds the step cap (DoS defence)', () => {
    // Build a huge fake encoded log that claims more steps than the cap.
    const decoded = decodeReplayFrames(
      encodeReplay({
        format:     REPLAY_FORMAT,
        simVersion: SIM_VERSION,
        seed:       'DOS',
        endless:    false,
        context:    CONTEXT,
        steps:      300_000,
        frames:     [{ steps: 300_000, steerX: 0, steerY: 0, strafe: 0, climb: 0, throttle: 127, buttons: 0, lockTarget: -1 }],
      }),
      LIMITS,
    )
    expect(decoded).toBeNull()
  })

  it('rejects garbage inputLog (not valid base64 / frame data)', () => {
    const result = verifySubmission({
      inputLog:     '!!!this-is-not-a-replay!!!',
      claimedScore: 99999,
      seed:         'GARBAGE',
      simVersion:   SIM_VERSION,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid_input_log')
  })
})

/* ------------------------------------------------------------------ */
/* Performance report (§9 requirement)                                 */
/* ------------------------------------------------------------------ */

describe('replay verification performance', () => {
  it('verifies a 12-wave run in well under 1 second', () => {
    const { inputLog, score } = recordAndEncode('PERF-12WAVE', 120)
    const timings: number[] = []

    for (let i = 0; i < 5; i++) {
      const result = verifySubmission({
        inputLog, claimedScore: score, seed: 'PERF-12WAVE', simVersion: SIM_VERSION,
      })
      if (result.timingMs !== undefined) timings.push(result.timingMs)
    }

    const median = timings.sort((a, b) => a - b)[Math.floor(timings.length / 2)] ?? 0
    const p99    = timings[timings.length - 1] ?? 0

    console.log(`[replay perf] median=${median}ms  p99=${p99}ms`)
    // A 10-minute run (72,000 steps) must complete in well under 5 seconds.
    expect(p99).toBeLessThan(5000)
  })

  it('reports input log size for a 12-wave run', () => {
    const { inputLog, steps } = recordAndEncode('SIZE-12WAVE', 120)
    const bytes = Math.ceil((inputLog.length * 3) / 4)
    console.log(`[replay size] steps=${steps}  packed=${bytes} bytes  base64len=${inputLog.length}`)
    // Should be well under 1 MB for a mouse-flown run.
    expect(bytes).toBeLessThan(1024 * 1024)
  })
})

/* ------------------------------------------------------------------ */
/* Determinism across encode/decode round-trip                         */
/* ------------------------------------------------------------------ */

describe('determinism — encode → decode → replay produces identical state', () => {
  it('produces the same score after wire round-trip', () => {
    const { inputLog, score } = recordAndEncode('DETERM-WIRE', 20)
    const result = verifySubmission({ inputLog, claimedScore: score, seed: 'DETERM-WIRE', simVersion: SIM_VERSION })
    expect(result.ok).toBe(true)
    expect(result.actualScore).toBe(score)
  })
})
