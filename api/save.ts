/**
 * GET  /api/save — returns the stored cloud save
 * PUT  /api/save — validates and stores a new save
 *
 * Conflict policy: last-write-wins, with the loser surfaced (TASK-5 §4).
 * If the client's `baseRevision` is stale, return 409 with both versions
 * and let the player choose. Silently overwriting a session someone played
 * on their phone is how you lose a player permanently.
 *
 * The parsers from `persistence.ts` are imported verbatim — no second
 * validator is written. Two validators for one schema will disagree
 * eventually, and the one the player hits will be the wrong one.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { saves } from '../db/schema.ts'
import { requireSession } from './_lib/session.ts'
import { checkRateLimit, clientIp, respond429 } from './_lib/rateLimit.ts'
import { readBody, json, methodNotAllowed } from './_lib/http.ts'

// Import the server-reused validators from persistence.ts.
// This file has no DOM dependencies and runs unchanged in Node.
import { parseSettings, parseProgress, parseKeybinds, CURRENT_VERSION } from '../src/state/persistence.ts'
import type { PersistedData } from '../src/state/persistence.ts'

/*
 * Imported rather than copied. It *was* copied, with a comment saying it must
 * match — and it did not: the client moved to v7 and this stayed at 6, so every
 * cloud save would have come back stamped with a version that no longer existed.
 * A constant with a comment telling you to keep it in sync is a constant that
 * will not be.
 */

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const session = await requireSession(req, res)
  if (!session) return

  /* ------------------------------------------------------------------ */
  /* GET /api/save                                                        */
  /* ------------------------------------------------------------------ */
  if (req.method === 'GET') {
    const [row] = await db.select().from(saves).where(eq(saves.accountId, session.accountId))
    if (!row) { res.writeHead(204); res.end(); return }

    json(res, 200, {
      revision: row.revision,
      savedAt:  row.savedAt,
      data:     row.blob,
    })
    return
  }

  /* ------------------------------------------------------------------ */
  /* PUT /api/save                                                        */
  /* ------------------------------------------------------------------ */
  if (req.method === 'PUT') {
    const ip = clientIp(req.headers)
    if (!checkRateLimit(`save:${session.accountId}`, 60, 60_000)) return respond429(res)
    if (!checkRateLimit(`save-ip:${ip}`, 120, 60_000)) return respond429(res)

    let body: string
    try { body = await readBody(req, 1024 * 512) } catch { json(res, 413, { error: 'body_too_large' }); return }

    let payload: unknown
    try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'invalid_json' }); return }

    const raw = payload as Record<string, unknown>
    const baseRevision = typeof raw['baseRevision'] === 'number' ? raw['baseRevision'] : -1
    const clientData = raw['data']

    if (typeof clientData !== 'object' || clientData === null) {
      json(res, 400, { error: 'missing_data' })
      return
    }

    // Validate and canonicalise using the same parsers the client uses.
    const d = clientData as Record<string, unknown>
    const version = typeof d['version'] === 'number' ? d['version'] : 0
    const canonical: PersistedData = {
      version:  CURRENT_VERSION,
      settings: parseSettings(d['settings']),
      progress: parseProgress(d['progress']),
      keybinds: parseKeybinds(d['keybinds'], version),
    }

    // Check for conflict.
    const [existing] = await db.select().from(saves).where(eq(saves.accountId, session.accountId))

    if (existing && existing.revision > baseRevision) {
      // Client is behind — return 409 with both versions.
      json(res, 409, {
        error:          'conflict',
        serverRevision: existing.revision,
        server:         existing.blob,
        client:         canonical,
      })
      return
    }

    const newRevision = (existing?.revision ?? 0) + 1
    const now = new Date()

    if (existing) {
      await db.update(saves)
        .set({ blob: canonical, revision: newRevision, savedAt: now })
        .where(eq(saves.accountId, session.accountId))
    } else {
      await db.insert(saves).values({
        accountId: session.accountId,
        blob:      canonical,
        revision:  newRevision,
        savedAt:   now,
      })
    }

    json(res, 200, { revision: newRevision, savedAt: now, data: canonical })
    return
  }

  methodNotAllowed(res)
}
