/**
 * GET /api/leaderboard?worldId=&endless=&limit=&offset=
 *
 * Returns paginated verified leaderboard entries (TASK-5 §5.3).
 * Display names are returned as plain strings — the client must render
 * them as text, never innerHTML.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { and, eq, desc } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { leaderboard, accounts } from '../db/schema.ts'
import { checkRateLimit, clientIp, respond429 } from './_lib/rateLimit.ts'
import { json, methodNotAllowed } from './_lib/http.ts'
import { SIM_VERSION } from '../src/game/data/constants.ts'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') return methodNotAllowed(res)

  const ip = clientIp(req.headers)
  if (!checkRateLimit(`leaderboard:${ip}`, 60, 60_000)) return respond429(res)

  const url = new URL(req.url ?? '/', `http://${req.headers['host'] ?? 'localhost'}`)
  const worldId = url.searchParams.get('worldId') ?? 'luna'
  const endless = url.searchParams.get('endless') === 'true'
  const limit   = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 50)))
  const offset  = Math.max(0, Number(url.searchParams.get('offset') ?? 0))

  if (worldId.length > 64) { json(res, 400, { error: 'invalid_world_id' }); return }

  const rows = await db
    .select({
      rank:              leaderboard.id,   // We compute rank client-side from offset
      accountId:         leaderboard.accountId,
      displayName:       accounts.displayName,
      score:             leaderboard.score,
      wave:              leaderboard.wave,
      outpostsRemaining: leaderboard.outpostsRemaining,
      seed:              leaderboard.seed,
      simVersion:        leaderboard.simVersion,
      worldId:           leaderboard.worldId,
      endless:           leaderboard.endless,
      verifiedAt:        leaderboard.verifiedAt,
    })
    .from(leaderboard)
    .innerJoin(accounts, eq(accounts.id, leaderboard.accountId))
    /*
     * Scoped to the physics the board is currently played on.
     *
     * `score.ts` already refuses to *verify* a submission against a superseded
     * `SIM_VERSION`, because there is no honest way to reinterpret an input log
     * against physics it never ran on. This query did not apply the same rule to
     * *reading*, so runs verified under an older version went on ranking beside
     * new ones — and at v4 that meant three archetypes instead of six, a
     * different Endless composition and a different bounty ladder, all competing
     * on one table. A version gate that partitions writes and not reads leaves
     * exactly the hole it was added to close.
     */
    .where(
      and(
        eq(leaderboard.simVersion, SIM_VERSION),
        eq(leaderboard.worldId, worldId),
        eq(leaderboard.endless, endless),
      ),
    )
    .orderBy(desc(leaderboard.score))
    .limit(limit)
    .offset(offset)

  // Filter deleted accounts (deletedAt != null means displayName is '[deleted]').
  const entries = rows.map((row, i) => ({
    rank:              offset + i + 1,
    // displayName rendered as text on the client — never innerHTML
    displayName:       row.displayName,
    score:             row.score,
    wave:              row.wave,
    outpostsRemaining: row.outpostsRemaining,
    seed:              row.seed,
    simVersion:        row.simVersion,
    worldId:           row.worldId,
    endless:           row.endless,
    verifiedAt:        row.verifiedAt,
  }))

  json(res, 200, { entries, offset, limit })
}
