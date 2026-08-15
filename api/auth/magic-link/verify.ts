/**
 * GET /api/auth/magic-link/verify?token=...
 *
 * Validates the single-use token, creates/retrieves the account,
 * sets the session cookie, and redirects to the game (TASK-5 §3).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { and, eq, gt } from 'drizzle-orm'
import { db } from '../../../db/client.ts'
import { accounts, magicLinks } from '../../../db/schema.ts'
import { setSession } from '../../_lib/session.ts'
import { json, methodNotAllowed } from '../../_lib/http.ts'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') return methodNotAllowed(res)

  const url = new URL(req.url ?? '/', `http://${req.headers['host'] ?? 'localhost'}`)
  const token = url.searchParams.get('token')
  if (!token || token.length > 128) {
    json(res, 400, { error: 'missing_token' })
    return
  }

  const tokenHash = createHash('sha256').update(token).digest('hex')
  const now = new Date()

  const [link] = await db
    .select()
    .from(magicLinks)
    .where(
      and(
        eq(magicLinks.tokenHash, tokenHash),
        eq(magicLinks.used, false),
        gt(magicLinks.expiresAt, now),
      ),
    )

  if (!link) {
    json(res, 400, { error: 'invalid_or_expired_token' })
    return
  }

  // Mark token used (single-use).
  await db.update(magicLinks).set({ used: true }).where(eq(magicLinks.id, link.id))

  let accountId: number
  if (link.accountId !== null) {
    // Existing account.
    const [acct] = await db.select().from(accounts).where(eq(accounts.id, link.accountId))
    if (!acct || acct.deletedAt !== null) {
      json(res, 400, { error: 'account_deleted' })
      return
    }
    accountId = acct.id
  } else {
    // First-time magic-link: create account.
    const displayName = `Pilot#${Math.floor(Math.random() * 0xffff).toString(16)}`
    const [newAcct] = await db.insert(accounts).values({ displayName, email: link.email }).returning()
    if (!newAcct) { json(res, 500, { error: 'db_error' }); return }
    accountId = newAcct.id
    // Update the link to remember the account for future sign-ins.
    await db.update(magicLinks).set({ accountId }).where(eq(magicLinks.id, link.id))
  }

  await setSession(res, accountId)

  // Redirect to the game with a hint to open the Account screen.
  const origin = process.env['RP_ORIGIN'] ?? 'http://localhost:5173'
  res.writeHead(302, { Location: `${origin}/?screen=Account` })
  res.end()
}
