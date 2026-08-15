/**
 * POST /api/auth/logout
 *
 * Clears the session cookie (TASK-5 §3).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { clearSession } from '../_lib/session.ts'
import { json, methodNotAllowed } from '../_lib/http.ts'

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'POST') return methodNotAllowed(res)
  clearSession(res)
  json(res, 200, { ok: true })
}
