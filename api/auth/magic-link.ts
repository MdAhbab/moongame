/**
 * POST /api/auth/magic-link
 *
 * Generates a single-use email token and sends it to the player (TASK-5 §3).
 * PII (email) is collected only for players who choose the fallback;
 * passkey users give nothing.
 *
 * Body: { email: string }
 * Response: 204 (always — no oracle for whether an address exists)
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { createTransport } from 'nodemailer'
import { eq } from 'drizzle-orm'
import { db } from '../../db/client.ts'
import { accounts, magicLinks } from '../../db/schema.ts'
import { checkRateLimit, clientIp, respond429 } from '../_lib/rateLimit.ts'
import { readBody, json, methodNotAllowed } from '../_lib/http.ts'

/** Token TTL: 15 minutes. */
const TOKEN_TTL_MS = 15 * 60 * 1000

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') return methodNotAllowed(res)

  const ip = clientIp(req.headers)
  // Strict limit: magic links have delivery cost and can be abused for spam.
  if (!checkRateLimit(`magic-link:${ip}`, 5, 10 * 60_000)) return respond429(res)

  let body: string
  try { body = await readBody(req) } catch { json(res, 413, { error: 'body_too_large' }); return }

  let payload: unknown
  try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'invalid_json' }); return }

  const raw = payload as Record<string, unknown>
  const email = typeof raw['email'] === 'string' ? raw['email'].trim().toLowerCase() : null
  if (!email || email.length > 256 || !email.includes('@')) {
    json(res, 400, { error: 'invalid_email' })
    return
  }

  // Generate token — store only the hash.
  const token = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(token).digest('hex')

  // Find or create the account.
  let accountId: number | null = null
  const [existing] = await db.select().from(accounts).where(eq(accounts.email, email))
  if (existing && existing.deletedAt === null) {
    accountId = existing.id
  }
  // If no account yet, it is created on verification.

  await db.insert(magicLinks).values({
    accountId: accountId ?? undefined,
    email,
    tokenHash,
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
  })

  await sendMagicLinkEmail(email, token)

  // 204: always succeed. The client cannot learn whether the email exists.
  res.writeHead(204)
  res.end()
}

async function sendMagicLinkEmail(to: string, token: string): Promise<void> {
  const origin = process.env['RP_ORIGIN'] ?? 'http://localhost:5173'
  const link = `${origin}/api/auth/magic-link/verify?token=${token}`

  const transport = createTransport({
    host:   process.env['SMTP_HOST'] ?? 'localhost',
    port:   Number(process.env['SMTP_PORT'] ?? 1025),
    secure: false,
    auth:   process.env['SMTP_USER'] ? {
      user: process.env['SMTP_USER'],
      pass: process.env['SMTP_PASS'],
    } : undefined,
  })

  await transport.sendMail({
    from:    process.env['EMAIL_FROM'] ?? 'noreply@mare-noctis.example',
    to,
    subject: 'Sign in to Mare Noctis',
    text:    `Click this link to sign in (valid 15 minutes):\n\n${link}\n\nIf you did not request this, ignore this email.`,
    html:    `<p>Click this link to sign in (valid 15 minutes):</p><p><a href="${link}">${link}</a></p><p>If you did not request this, ignore this email.</p>`,
  })
}
