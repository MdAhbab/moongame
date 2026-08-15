/**
 * Replay verification worker (TASK-5 §5.2, §5.3).
 *
 * Runs in a `worker_threads` Worker. Receives a decoded Replay via `workerData`,
 * runs it through the same `runReplay` + `Simulation` the client uses, and posts
 * back the final score state.
 *
 * This is CPU-bound work. Isolating it in a worker with a hard timeout in the
 * caller bounds the damage from a malicious oversized input log.
 *
 * **No I/O here.** The worker receives all data via workerData and reports back
 * via parentPort. Nothing else crosses the boundary.
 */
import { workerData, parentPort } from 'node:worker_threads'
import { Simulation } from '../../src/game/core/Simulation.ts'
import { runReplay, type Replay } from '../../src/game/core/InputRecorder.ts'

interface WorkerInput {
  replay: Replay
}

interface WorkerResult {
  score:             number
  wave:              number
  outpostsRemaining: number
  error?:            string
}

const input = workerData as WorkerInput

function run(): WorkerResult {
  try {
    const sim = runReplay(input.replay, (seed) => new Simulation(seed)) as Simulation
    const world = sim.world
    // Count surviving outposts.
    const outpostsRemaining = world.outposts.filter((o) => o.status !== 'Lost').length
    return {
      score:             world.score.total,
      wave:              world.wave.number,
      outpostsRemaining,
    }
  } catch (e) {
    return {
      score:             0,
      wave:              0,
      outpostsRemaining: 0,
      error:             String(e),
    }
  }
}

parentPort?.postMessage(run())
