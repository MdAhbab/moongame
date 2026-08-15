/**
 * DELETE /api/account
 *
 * Soft-deletes the account and hard-deletes the save (TASK-5 §3, §9).
 * Leaderboard entries remain but the display name is nulled — the entry
 * is archived rather than deleted, preserving leaderboard integrity.
 *
 * Ships on day one. This is two endpoints on day one and a migration later,
 * as the task spec puts it.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { eq } from 'drizzle-orm'
import { db } from '../../db/client.ts'
import { accounts, saves, leaderboard } from '../../db/schema.ts'
import { requireSession } from '../_lib/session.ts'
import { clearSession } from '../_lib/session.ts'
import { json, methodNotAllowed } from '../_lib/http.ts'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'DELETE') return methodNotAllowed(res)
  const session = await requireSession(req, res)
  if (!session) return

  // 1. Soft-delete account (preserves FK integrity).
  await db.update(accounts)
    .set({ deletedAt: new Date(), displayName: '[deleted]', email: null })
    .where(eq(accounts.id, session.accountId))

  // 2. Delete save data (player data, gone for real).
  await db.delete(saves).where(eq(saves.accountId, session.accountId))

  // 3. Null display name on leaderboard entries (archived, not deleted).
  await db.update(leaderboard)
    .set({ inputLog: null })
    .where(eq(leaderboard.accountId, session.accountId))

  // 4. Clear session.
  clearSession(res)

  json(res, 200, { ok: true })
}
