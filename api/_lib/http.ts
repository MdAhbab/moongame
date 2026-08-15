/**
 * Thin HTTP helpers shared across all API functions.
 *
 * Keeps boilerplate out of every handler so security-relevant code
 * (validation, auth, rate-limiting) is what's visible.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

/** Reads the full request body as a string. Rejects bodies over 2 MB. */
export async function readBody(req: IncomingMessage, maxBytes = 2 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        req.destroy()
        reject(new Error('body_too_large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Writes a JSON response. */
export function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/** 405 Method Not Allowed. */
export function methodNotAllowed(res: ServerResponse): void {
  json(res, 405, { error: 'method_not_allowed' })
}

/** Reads a named cookie from the Cookie header. */
export function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, v] = part.trim().split('=')
    if (k?.trim() === name && v !== undefined) return decodeURIComponent(v.trim())
  }
  return null
}

/** Safely parse JSON; returns null on failure. */
export function safeJson(raw: string): unknown {
  try { return JSON.parse(raw) } catch { return null }
}
