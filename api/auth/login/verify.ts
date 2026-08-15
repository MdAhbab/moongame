/**
 * POST /api/auth/login/verify
 *
 * Verifies the WebAuthn authentication assertion, updates the credential
 * counter, and sets the session cookie (TASK-5 §3).
 *
 * Body: AuthenticationResponseJSON (from @simplewebauthn/browser)
 * Response: { accountId, displayName }
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { eq } from 'drizzle-orm'
import { db } from '../../../db/client.ts'
import { accounts, credentials } from '../../../db/schema.ts'
import { setSession } from '../../_lib/session.ts'
import { checkRateLimit, clientIp, respond429 } from '../../_lib/rateLimit.ts'
import { readBody, json, methodNotAllowed, parseCookie } from '../../_lib/http.ts'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') return methodNotAllowed(res)

  const ip = clientIp(req.headers)
  if (!checkRateLimit(`login-verify:${ip}`, 20, 60_000)) return respond429(res)

  const cookieHeader = req.headers['cookie'] ?? ''
  const challenge = parseCookie(cookieHeader, 'mn_auth_challenge')
  if (!challenge) { json(res, 400, { error: 'missing_challenge' }); return }

  let body: string
  try { body = await readBody(req) } catch { json(res, 413, { error: 'body_too_large' }); return }

  let authResponse: unknown
  try { authResponse = JSON.parse(body) } catch { json(res, 400, { error: 'invalid_json' }); return }

  // credentialId is in the response — look up the stored credential.
  const raw = authResponse as Record<string, unknown>
  const credId = typeof raw['id'] === 'string' ? raw['id'] : null
  if (!credId) { json(res, 400, { error: 'missing_credential_id' }); return }

  const [storedCred] = await db.select().from(credentials).where(eq(credentials.credentialId, credId))
  if (!storedCred) { json(res, 401, { error: 'credential_not_found' }); return }

  const [account] = await db.select().from(accounts).where(eq(accounts.id, storedCred.accountId))
  if (!account || account.deletedAt !== null) { json(res, 401, { error: 'account_not_found' }); return }

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>
  try {
    verification = await verifyAuthenticationResponse({
      response:            authResponse as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
      expectedChallenge:   challenge,
      expectedOrigin:      process.env['RP_ORIGIN'] ?? 'http://localhost:5173',
      expectedRPID:        process.env['RP_ID'] ?? 'localhost',
      credential: {
        id:         storedCred.credentialId,
        publicKey:  Buffer.from(storedCred.publicKey, 'base64url'),
        counter:    storedCred.counter,
        transports: (storedCred.transports ?? []) as AuthenticatorTransport[],
      },
    })
  } catch (e) {
    json(res, 400, { error: 'verification_failed', detail: String(e) })
    return
  }

  if (!verification.verified) { json(res, 400, { error: 'verification_failed' }); return }

  // Update counter (replay-attack prevention).
  await db.update(credentials)
    .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(credentials.id, storedCred.id))

  // Clear challenge cookie, set session.
  res.setHeader('Set-Cookie', [
    'mn_auth_challenge=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/',
  ])
  await setSession(res, account.id)

  json(res, 200, { accountId: account.id, displayName: account.displayName })
}
