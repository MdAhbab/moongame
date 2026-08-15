/**
 * POST /api/auth/login/options
 *
 * Generates WebAuthn authentication options (TASK-5 §3).
 * The challenge is stored in a short-lived cookie for the verify step.
 *
 * Body: {} (empty — browser discovers resident keys automatically)
 * Response: PublicKeyCredentialRequestOptionsJSON
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { checkRateLimit, clientIp, respond429 } from '../../_lib/rateLimit.ts'
import { json, methodNotAllowed } from '../../_lib/http.ts'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') return methodNotAllowed(res)

  const ip = clientIp(req.headers)
  if (!checkRateLimit(`login-opts:${ip}`, 20, 60_000)) return respond429(res)

  const options = await generateAuthenticationOptions({
    rpID:                 process.env['RP_ID'] ?? 'localhost',
    userVerification:     'preferred',
    // No allowCredentials — resident-key / discoverable credential flow.
  })

  const challengeCookie = `mn_auth_challenge=${encodeURIComponent(options.challenge)}; HttpOnly; SameSite=Lax; Max-Age=300; Path=/`
  res.setHeader('Set-Cookie', challengeCookie)

  json(res, 200, options)
}
