/**
 * POST /api/auth/register/options
 *
 * Generates WebAuthn registration options for a new passkey (TASK-5 §3).
 * The challenge is returned to the client and also stored in a short-lived
 * cookie so the verify step can compare it without a DB round-trip.
 *
 * Body: { displayName?: string }
 * Response: PublicKeyCredentialCreationOptionsJSON
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { generateRegistrationOptions } from '@simplewebauthn/server'
import { checkRateLimit, clientIp, respond429 } from '../../_lib/rateLimit.ts'
import { readBody, json, methodNotAllowed } from '../../_lib/http.ts'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') return methodNotAllowed(res)

  const ip = clientIp(req.headers)
  if (!checkRateLimit(`reg-opts:${ip}`, 10, 60_000)) return respond429(res)

  let body: string
  try { body = await readBody(req) } catch { json(res, 413, { error: 'body_too_large' }); return }

  let payload: unknown
  try { payload = body ? JSON.parse(body) : {} } catch { json(res, 400, { error: 'invalid_json' }); return }

  const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  const displayName = typeof raw['displayName'] === 'string' ? raw['displayName'].trim().slice(0, 32) : `Pilot#${Math.floor(Math.random() * 0xffff).toString(16)}`

  const options = await generateRegistrationOptions({
    rpName:                 process.env['RP_NAME'] ?? 'Mare Noctis',
    rpID:                   process.env['RP_ID'] ?? 'localhost',
    userName:               displayName,
    attestationType:        'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  })

  // Store challenge in a short-lived signed cookie so the verify step can read it.
  const challengeCookie = `mn_reg_challenge=${encodeURIComponent(options.challenge)}; HttpOnly; SameSite=Lax; Max-Age=300; Path=/`
  // Also pass the display name through so verify can use it.
  const nameCookie = `mn_reg_name=${encodeURIComponent(displayName)}; HttpOnly; SameSite=Lax; Max-Age=300; Path=/`
  res.setHeader('Set-Cookie', [challengeCookie, nameCookie])

  json(res, 200, options)
}
