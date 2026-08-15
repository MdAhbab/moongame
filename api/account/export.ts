/**
 * GET /api/account/export
 *
 * Returns the player's full data as JSON — GDPR data portability (TASK-5 §3).
 * Ships on day one rather than being added when someone asks.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { eq } from 'drizzle-orm'
import { db } from '../../db/client.ts'
import { accounts, saves, leaderboard } from '../../db/schema.ts'
import { requireSession } from '../_lib/session.ts'
import { json, methodNotAllowed } from '../_lib/http.ts'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') return methodNotAllowed(res)
  const session = await requireSession(req, res)
  if (!session) return

  const [account] = await db.select().from(accounts).where(eq(accounts.id, session.accountId))
  if (!account || account.deletedAt !== null) {
    json(res, 404, { error: 'account_not_found' })
    return
  }

  const [save] = await db.select().from(saves).where(eq(saves.accountId, session.accountId))
  const entries = await db.select().from(leaderboard).where(eq(leaderboard.accountId, session.accountId))

  json(res, 200, {
    account: {
      id:          account.id,
      displayName: account.displayName,
      email:       account.email ?? null,
      createdAt:   account.createdAt,
    },
    save:        save?.blob ?? null,
    leaderboard: entries.map((e) => ({
      worldId:           e.worldId,
      endless:           e.endless,
      score:             e.score,
      wave:              e.wave,
      outpostsRemaining: e.outpostsRemaining,
      seed:              e.seed,
      simVersion:        e.simVersion,
      verifiedAt:        e.verifiedAt,
    })),
  })
}
