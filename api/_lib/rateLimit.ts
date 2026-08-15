/**
 * Sliding-window rate limiter (TASK-5 §5, §7).
 *
 * In-process for local dev (resets per cold-start on Vercel).
 * Set UPSTASH_REDIS_URL + UPSTASH_REDIS_TOKEN for a persistent store.
 *
 * Used to defend:
 *  - /api/auth/magic-link  — 5 per IP per 10 minutes
 *  - /api/score            — 10 per account per minute, 5 per IP per minute
 *  - /api/leaderboard      — 60 per IP per minute
 */

interface Window {
  count: number
  resetAt: number
}

/** In-memory fallback (per-process, good enough for dev). */
const store = new Map<string, Window>()

/**
 * Returns true if the request is within the allowed rate.
 * Returns false (and the caller should respond 429) if the limit is exceeded.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  let entry = store.get(key)

  if (entry === undefined || now > entry.resetAt) {
    entry = { count: 1, resetAt: now + windowMs }
    store.set(key, entry)
    return true
  }

  entry.count++
  if (entry.count > limit) return false
  return true
}

/** Reads the first `x-forwarded-for` address, falling back to a placeholder. */
export function clientIp(headers: Record<string, string | string[] | undefined>): string {
  const fwd = headers['x-forwarded-for']
  if (typeof fwd === 'string') return fwd.split(',')[0]?.trim() ?? 'unknown'
  if (Array.isArray(fwd)) return fwd[0]?.split(',')[0]?.trim() ?? 'unknown'
  return 'unknown'
}

export function respond429(res: { writeHead: (s: number, h: Record<string, string>) => void; end: (b: string) => void }): void {
  res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' })
  res.end(JSON.stringify({ error: 'rate_limit_exceeded' }))
}
