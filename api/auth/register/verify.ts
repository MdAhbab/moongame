/**
 * POST /api/auth/register/verify
 *
 * Verifies the WebAuthn registration response, creates the account and
 * credential rows, and sets the session cookie (TASK-5 §3).
 *
 * Body: RegistrationResponseJSON (from @simplewebauthn/browser)
 * Response: { accountId, displayName }
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { db } from '../../../db/client.ts'
import { accounts, credentials } from '../../../db/schema.ts'
import { setSession } from '../../_lib/session.ts'
import { checkRateLimit, clientIp, respond429 } from '../../_lib/rateLimit.ts'
import { readBody, json, methodNotAllowed, parseCookie } from '../../_lib/http.ts'
import { isCleanDisplayName, sanitiseDisplayName } from '../../_lib/profanity.ts'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') return methodNotAllowed(res)

  const ip = clientIp(req.headers)
  if (!checkRateLimit(`reg-verify:${ip}`, 10, 60_000)) return respond429(res)

  const cookieHeader = req.headers['cookie'] ?? ''
  const challenge = parseCookie(cookieHeader, 'mn_reg_challenge')
  const rawName  = parseCookie(cookieHeader, 'mn_reg_name')

  if (!challenge) {
    json(res, 400, { error: 'missing_challenge' })
    return
  }

  const displayName = rawName && isCleanDisplayName(rawName)
    ? sanitiseDisplayName(rawName)
    : `Pilot#${Math.floor(Math.random() * 0xffff).toString(16)}`

  let body: string
  try { body = await readBody(req) } catch { json(res, 413, { error: 'body_too_large' }); return }

  let registration: unknown
  try { registration = JSON.parse(body) } catch { json(res, 400, { error: 'invalid_json' }); return }

  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>
  try {
    verification = await verifyRegistrationResponse({
      response:              registration as Parameters<typeof verifyRegistrationResponse>[0]['response'],
      expectedChallenge:     challenge,
      expectedOrigin:        process.env['RP_ORIGIN'] ?? 'http://localhost:5173',
      expectedRPID:          process.env['RP_ID'] ?? 'localhost',
      requireUserVerification: false,
    })
  } catch (e) {
    json(res, 400, { error: 'verification_failed', detail: String(e) })
    return
  }

  if (!verification.verified || !verification.registrationInfo) {
    json(res, 400, { error: 'verification_failed' })
    return
  }

  const { credential } = verification.registrationInfo

  // Insert account + credential in a single logical operation.
  const [account] = await db.insert(accounts).values({ displayName }).returning()
  if (!account) { json(res, 500, { error: 'db_error' }); return }

  await db.insert(credentials).values({
    accountId:    account.id,
    credentialId: credential.id,
    publicKey:    Buffer.from(credential.publicKey).toString('base64url'),
    counter:      credential.counter,
    transports:   (credential.transports ?? []) as string[],
  })

  // Clear challenge cookies, set session.
  res.setHeader('Set-Cookie', [
    'mn_reg_challenge=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/',
    'mn_reg_name=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/',
  ])
  await setSession(res, account.id)

  json(res, 200, { accountId: account.id, displayName: account.displayName })
}
