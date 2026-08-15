/**
 * Session helpers — HttpOnly, Secure, SameSite=Lax JWT cookie (TASK-5 §3).
 *
 * No token in localStorage — a save file is already read from there and
 * treating it as untrusted is the whole posture of persistence.ts.
 *
 * `jose` is used for signing/verifying because it works in Node and Edge
 * environments without native crypto polyfills.
 */
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import type { IncomingMessage, ServerResponse } from 'node:http'

const SECRET = new TextEncoder().encode(
  process.env['SESSION_SECRET'] ?? 'dev-secret-replace-in-production-min-32-bytes',
)

const COOKIE_NAME = 'mn_session'
/** 30-day session lifetime. */
const MAX_AGE_S = 60 * 60 * 24 * 30

interface SessionPayload extends JWTPayload {
  accountId: number
}

export interface Session {
  accountId: number
}

/** Signs a new session JWT and sets it as an HttpOnly cookie. */
export async function setSession(res: ServerResponse, accountId: number): Promise<void> {
  const token = await new SignJWT({ accountId } satisfies Omit<SessionPayload, keyof JWTPayload>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(SECRET)

  res.setHeader('Set-Cookie', buildCookie(token, MAX_AGE_S))
}

/** Reads and verifies the session cookie. Returns null if absent or invalid. */
export async function getSession(req: IncomingMessage): Promise<Session | null> {
  const raw = parseCookie(req.headers['cookie'] ?? '', COOKIE_NAME)
  if (raw === null) return null
  try {
    const { payload } = await jwtVerify<SessionPayload>(raw, SECRET)
    if (typeof payload['accountId'] !== 'number') return null
    return { accountId: payload['accountId'] }
  } catch {
    return null
  }
}

/** Clears the session cookie. */
export function clearSession(res: ServerResponse): void {
  res.setHeader('Set-Cookie', buildCookie('', 0))
}

/** Reads and verifies session; writes 401 and returns null if missing. */
export async function requireSession(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Session | null> {
  const session = await getSession(req)
  if (session === null) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'unauthenticated' }))
    return null
  }
  return session
}

// ── Helpers ──────────────────────────────────────────────────────────

function buildCookie(value: string, maxAge: number): string {
  const secure = process.env['NODE_ENV'] === 'production' ? '; Secure' : ''
  return `${COOKIE_NAME}=${value}; HttpOnly${secure}; SameSite=Lax; Max-Age=${maxAge}; Path=/`
}

function parseCookie(header: string, name: string): string | null {
  for (const part of header.split(';')) {
    const [k, v] = part.trim().split('=')
    if (k?.trim() === name && v !== undefined) return decodeURIComponent(v.trim())
  }
  return null
}
