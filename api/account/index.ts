/**
 * GET  /api/account  — returns { id, displayName, email? } or 401
 * PATCH /api/account — update display name
 *
 * Display names: length-capped, rendered as text never as HTML,
 * profanity-filtered at submission (TASK-5 §7).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { eq } from 'drizzle-orm'
import { db } from '../../db/client.ts'
import { accounts } from '../../db/schema.ts'
import { requireSession } from '../_lib/session.ts'
import { readBody, json, methodNotAllowed } from '../_lib/http.ts'
import { isCleanDisplayName, sanitiseDisplayName } from '../_lib/profanity.ts'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const session = await requireSession(req, res)
  if (!session) return

  if (req.method === 'GET') {
    const [account] = await db.select().from(accounts).where(eq(accounts.id, session.accountId))
    if (!account || account.deletedAt !== null) {
      json(res, 404, { error: 'account_not_found' })
      return
    }
    json(res, 200, {
      id:          account.id,
      displayName: account.displayName,
      email:       account.email ?? null,
    })
    return
  }

  if (req.method === 'PATCH') {
    let body: string
    try { body = await readBody(req) } catch { json(res, 413, { error: 'body_too_large' }); return }

    let payload: unknown
    try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'invalid_json' }); return }

    const raw = payload as Record<string, unknown>
    const newName = typeof raw['displayName'] === 'string' ? raw['displayName'] : null
    if (!newName || !isCleanDisplayName(newName)) {
      json(res, 400, { error: 'invalid_display_name', detail: 'Must be 2–32 characters, no profanity.' })
      return
    }

    await db.update(accounts)
      .set({ displayName: sanitiseDisplayName(newName) })
      .where(eq(accounts.id, session.accountId))

    json(res, 200, { ok: true, displayName: sanitiseDisplayName(newName) })
    return
  }

  methodNotAllowed(res)
}
