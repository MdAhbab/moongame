/**
 * POST /api/score
 *
 * Replay-verified leaderboard submission (TASK-5 §5).
 *
 * The server does not trust the claimed score. It replays the submitted
 * input log through the exact same deterministic simulation and compares
 * the final state bit-for-bit. A score endpoint that accepts a number is
 * a leaderboard of whoever opens devtools first.
 *
 * Body: {
 *   seed:         string
 *   simVersion:   number
 *   inputLog:     string  (base64 packed, from encodeReplay)
 *   claimedScore: number
 *   worldId:      string
 *   endless:      boolean
 * }
 *
 * Steps (§5.2):
 *  1. Auth check
 *  2. Rate-limit
 *  3. Reject unknown/retired simVersion
 *  4. Decode inputLog (decodeReplayFrames with hard caps)
 *  5. Replay in worker_threads with 5s timeout
 *  6. Compare score/wave/outposts — exact match only
 *  7. Upsert leaderboard; store inputLog for accepted top entries
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Worker } from 'node:worker_threads'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { leaderboard } from '../db/schema.ts'
import { requireSession } from './_lib/session.ts'
import { checkRateLimit, clientIp, respond429 } from './_lib/rateLimit.ts'
import { readBody, json, methodNotAllowed } from './_lib/http.ts'
import { decodeReplayFrames, parseRunContext } from '../src/game/core/InputRecorder.ts'
import { SIM_VERSION } from '../src/game/data/constants.ts'
import { WORLDS } from '../src/game/data/worlds.ts'
import type { Replay } from '../src/game/core/InputRecorder.ts'

/** The worlds this server will accept a run for. The registry is the authority. */
const WORLD_IDS = new Set(WORLDS.map((world) => world.id))

/** Only the current sim version is accepted. Retired versions are rejected outright. */
const ACCEPTED_SIM_VERSIONS = new Set([SIM_VERSION])

/**
 * Hard caps matching the replay test suite's LIMITS.
 * A 10-minute run at 120 Hz = 72,000 steps. 200,000 is generous and still
 * bounds the CPU budget: 200k steps completes in well under a second in Node.
 */
const MAX_STEPS  = 200_000
const MAX_FRAMES = 60_000

/** Worker timeout: 5 seconds (§5.2). */
const WORKER_TIMEOUT_MS = 5_000

/** Top-N entries for which we store the full inputLog (for re-verification and ghost replay). */
const TOP_N_STORE_LOG = 1000

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WORKER_PATH = path.join(__dirname, '_lib', 'replayWorker.ts')

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') return methodNotAllowed(res)

  // 1. Auth.
  const session = await requireSession(req, res)
  if (!session) return

  // 2. Rate-limit.
  const ip = clientIp(req.headers)
  if (!checkRateLimit(`score-acct:${session.accountId}`, 10, 60_000)) return respond429(res)
  if (!checkRateLimit(`score-ip:${ip}`, 5, 60_000)) return respond429(res)

  // 3. Parse body.
  let body: string
  try { body = await readBody(req, 2 * 1024 * 1024) } catch { json(res, 413, { error: 'body_too_large' }); return }

  let payload: unknown
  try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'invalid_json' }); return }

  const raw = payload as Record<string, unknown>

  const simVersion   = typeof raw['simVersion']   === 'number'  ? raw['simVersion']   : null
  const seed         = typeof raw['seed']         === 'string'  ? raw['seed']         : null
  const inputLogB64  = typeof raw['inputLog']     === 'string'  ? raw['inputLog']     : null
  const claimedScore = typeof raw['claimedScore'] === 'number'  ? raw['claimedScore'] : null
  const worldId      = typeof raw['worldId']      === 'string'  ? raw['worldId']      : null
  const endless      = raw['endless'] === true

  if (!simVersion || !seed || !inputLogB64 || claimedScore === null || !worldId) {
    json(res, 400, { error: 'missing_fields' })
    return
  }

  if (seed.length === 0 || seed.length > 64) {
    json(res, 400, { error: 'invalid_seed' })
    return
  }

  // 3b. The run's physical context.
  //
  // Gravity and drag come from the world, and every flight multiplier comes from
  // the equipped parts, so the same seed and the same inputs legitimately give
  // different scores in different contexts. The replay has to be run in the
  // context it was flown in or an honest run does not reproduce.
  //
  // Only *identifiers* are accepted. `worldId` is checked against this server's
  // registry, and the part ids go through `resolveLoadout`, which already
  // discards anything unknown or in the wrong slot. A client can therefore
  // choose among real worlds and real parts, and cannot invent physics.
  if (!WORLD_IDS.has(worldId)) {
    json(res, 400, { error: 'unknown_world' })
    return
  }

  const context = parseRunContext({ worldId, equipped: raw['equipped'] ?? {} })
  if (context === null) {
    json(res, 400, { error: 'invalid_loadout' })
    return
  }

  // 4. Reject unknown or retired simVersion.
  if (!ACCEPTED_SIM_VERSIONS.has(simVersion)) {
    json(res, 400, { error: 'retired_version', detail: `simVersion ${simVersion} is not accepted` })
    return
  }

  // 5. Decode input log (decodeReplayFrames enforces limits and rejects garbage).
  const decoded = decodeReplayFrames(inputLogB64, { maxSteps: MAX_STEPS, maxFrames: MAX_FRAMES })
  if (decoded === null) {
    json(res, 422, { error: 'invalid_input_log' })
    return
  }

  const replay: Replay = {
    format:     1,  // REPLAY_FORMAT
    simVersion,
    seed,
    endless,
    context,
    frames:     decoded.frames,
    steps:      decoded.steps,
  }

  // 6. Replay in worker with hard timeout.
  let workerResult: { score: number; wave: number; outpostsRemaining: number; error?: string }
  try {
    workerResult = await runInWorker(replay)
  } catch (e) {
    // Worker timeout or crash.
    json(res, 422, { error: 'replay_failed', detail: String(e) })
    return
  }

  if (workerResult.error) {
    json(res, 422, { error: 'replay_error', detail: workerResult.error })
    return
  }

  // 7. Exact match — score, wave, outposts all must match.
  if (workerResult.score !== claimedScore) {
    json(res, 422, {
      error:         'score_mismatch',
      claimedScore,
      actualScore:   workerResult.score,
    })
    return
  }

  // 8. Upsert leaderboard row.
  const [existing] = await db
    .select()
    .from(leaderboard)
    .where(and(
      eq(leaderboard.accountId, session.accountId),
      eq(leaderboard.worldId, worldId),
      eq(leaderboard.endless, endless),
    ))

  // Only update if this run is a personal best.
  const isImprovement = !existing || workerResult.score > existing.score

  // Determine rank (approximate — count rows with higher score).
  const countResult = await db
    .select()
    .from(leaderboard)
    .where(and(eq(leaderboard.worldId, worldId), eq(leaderboard.endless, endless)))

  const rank = countResult.filter((e) => e.score > workerResult.score).length + 1
  const storeLog = rank <= TOP_N_STORE_LOG ? inputLogB64 : null

  if (isImprovement) {
    if (existing) {
      await db.update(leaderboard)
        .set({
          score:             workerResult.score,
          wave:              workerResult.wave,
          outpostsRemaining: workerResult.outpostsRemaining,
          seed,
          simVersion,
          inputLog:          storeLog,
          verifiedAt:        new Date(),
        })
        .where(eq(leaderboard.id, existing.id))
    } else {
      await db.insert(leaderboard).values({
        accountId:         session.accountId,
        worldId,
        endless,
        score:             workerResult.score,
        wave:              workerResult.wave,
        outpostsRemaining: workerResult.outpostsRemaining,
        seed,
        simVersion,
        inputLog:          storeLog,
      })
    }
  }

  json(res, 200, {
    ok:                true,
    score:             workerResult.score,
    wave:              workerResult.wave,
    outpostsRemaining: workerResult.outpostsRemaining,
    rank,
    personalBest:      isImprovement,
  })
}

/**
 * Runs the replay worker with a hard timeout.
 * Rejects if the worker exceeds WORKER_TIMEOUT_MS or posts an error.
 */
function runInWorker(replay: Replay): Promise<{ score: number; wave: number; outpostsRemaining: number; error?: string }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, {
      workerData: { replay },
      // ts-node / tsx support — needed when running TypeScript workers directly.
      execArgv:   ['--import', 'tsx/esm'],
    })

    const timer = setTimeout(() => {
      void worker.terminate()
      reject(new Error('replay_timeout'))
    }, WORKER_TIMEOUT_MS)

    worker.on('message', (result: { score: number; wave: number; outpostsRemaining: number; error?: string }) => {
      clearTimeout(timer)
      resolve(result)
    })

    worker.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })

    worker.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`worker_exit_${code}`))
    })
  })
}
