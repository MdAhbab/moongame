/**
 * API client — all network calls for the backend track (TASK-5 §6).
 *
 * Components never `fetch` directly. This module is the one place networking
 * lives. Nothing here runs during `Playing` — all calls happen on screen
 * transitions (§17.2: zero React re-renders during Playing).
 *
 * All calls use same-origin `/api/*`. `connect-src 'self'` in vercel.json
 * already permits this; no CSP change is needed.
 */
import {
  startRegistration,
  startAuthentication,
} from '@simplewebauthn/browser'
import type { PersistedData } from '../state/persistence.ts'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface AccountInfo {
  id:          number
  displayName: string
  email:       string | null
}

export interface SaveResponse {
  revision: number
  savedAt:  string
  data:     PersistedData
}

export interface PutSaveResult {
  /** 200 = success. 409 = conflict (both versions returned). */
  status:         'ok' | 'conflict'
  revision?:      number
  data?:          PersistedData
  /** Only present on conflict. */
  serverRevision?: number
  server?:        PersistedData
  client?:        PersistedData
}

export interface LeaderboardEntry {
  rank:              number
  displayName:       string
  score:             number
  wave:              number
  outpostsRemaining: number
  seed:              string
  simVersion:        number
  worldId:           string
  endless:           boolean
  verifiedAt:        string
}

export interface ScoreSubmission {
  seed:         string
  simVersion:   number
  inputLog:     string  // base64-packed from encodeReplay
  claimedScore: number
  worldId:      string
  /**
   * Slot → part id, as flown. The server re-resolves these against its own part
   * registry; it never trusts a multiplier from a client. Without it, a replay
   * runs under stock parts and every honest run with a part equipped is
   * rejected as a forgery.
   */
  equipped:     Record<string, string>
  endless:      boolean
}

export interface ScoreResult {
  score:             number
  wave:              number
  outpostsRemaining: number
  rank:              number
  personalBest:      boolean
}

/* ------------------------------------------------------------------ */
/* Availability                                                        */
/* ------------------------------------------------------------------ */

/**
 * Whether the API is actually deployed behind this build.
 *
 * The game ships as a static SPA; the functions in `api/` are a separate
 * deployment concern. "No backend" is therefore a normal state, not a fault —
 * it is what `vite dev`, a preview build, and any host serving `dist/` alone
 * all look like. Screens ask this before they ask for data, so they can say
 * *that* rather than surfacing `Error: leaderboard: 404` to a player who did
 * nothing wrong.
 *
 * Probed once and cached: the answer cannot change without a reload, and the
 * probe reuses an endpoint the Account screen would have called anyway.
 */
let cloudProbe: Promise<boolean> | null = null

export function cloudAvailable(): Promise<boolean> {
  cloudProbe ??= (async () => {
    try {
      const res = await fetch('/api/account', { headers: { Accept: 'application/json' } })
      // 401/403 mean the endpoint exists and you are signed out — that is
      // availability. 404 means the function is not deployed; 5xx means the
      // deployment is broken. Neither is something a player can act on.
      if (res.status === 404 || res.status >= 500) return false
      return (res.headers.get('content-type') ?? '').includes('json')
    } catch {
      return false // offline, blocked, or nothing listening at all
    }
  })()
  return cloudProbe
}

/** Test seam — forgets the cached probe. */
export function resetCloudProbe(): void {
  cloudProbe = null
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

/** Register a new passkey. Creates account and session. */
export async function registerPasskey(): Promise<AccountInfo> {
  const optRes = await fetch('/api/auth/register/options', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } })
  if (!optRes.ok) throw new Error(`register/options: ${optRes.status}`)
  const options: unknown = await optRes.json()

  const regResponse = await startRegistration({ optionsJSON: options as Parameters<typeof startRegistration>[0]['optionsJSON'] })

  const verRes = await fetch('/api/auth/register/verify', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(regResponse),
  })
  if (!verRes.ok) throw new Error(`register/verify: ${verRes.status}`)
  return (await verRes.json()) as AccountInfo
}

/** Authenticate with an existing passkey. */
export async function loginPasskey(): Promise<AccountInfo> {
  const optRes = await fetch('/api/auth/login/options', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } })
  if (!optRes.ok) throw new Error(`login/options: ${optRes.status}`)
  const options: unknown = await optRes.json()

  const authResponse = await startAuthentication({ optionsJSON: options as Parameters<typeof startAuthentication>[0]['optionsJSON'] })

  const verRes = await fetch('/api/auth/login/verify', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(authResponse),
  })
  if (!verRes.ok) throw new Error(`login/verify: ${verRes.status}`)
  return (await verRes.json()) as AccountInfo
}

/** Send a magic-link email (fallback for users without a passkey device). */
export async function sendMagicLink(email: string): Promise<void> {
  const res = await fetch('/api/auth/magic-link', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email }),
  })
  if (!res.ok) throw new Error(`magic-link: ${res.status}`)
}

/** Sign out and clear the session cookie. */
export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' })
}

/* ------------------------------------------------------------------ */
/* Account                                                             */
/* ------------------------------------------------------------------ */

/** Returns the current account, or null if unauthenticated. */
export async function getAccount(): Promise<AccountInfo | null> {
  const res = await fetch('/api/account')
  if (res.status === 401 || res.status === 404) return null
  if (!res.ok) throw new Error(`account: ${res.status}`)
  return (await res.json()) as AccountInfo
}

/** Update the display name. Returns the validated name. */
export async function updateDisplayName(displayName: string): Promise<string> {
  const res = await fetch('/api/account', {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ displayName }),
  })
  if (!res.ok) throw new Error(`account PATCH: ${res.status}`)
  const body = (await res.json()) as { displayName: string }
  return body.displayName
}

/** Download all player data (GDPR portability). */
export async function exportData(): Promise<unknown> {
  const res = await fetch('/api/account/export')
  if (!res.ok) throw new Error(`export: ${res.status}`)
  return res.json()
}

/** Delete the account. Returns after the server has confirmed. */
export async function deleteAccount(): Promise<void> {
  const res = await fetch('/api/account/delete', { method: 'DELETE' })
  if (!res.ok) throw new Error(`delete: ${res.status}`)
}

/* ------------------------------------------------------------------ */
/* Cloud Save                                                          */
/* ------------------------------------------------------------------ */

/** Fetch the cloud save, or null if none exists. */
export async function getSave(): Promise<SaveResponse | null> {
  const res = await fetch('/api/save')
  if (res.status === 204) return null
  if (res.status === 401) return null
  if (!res.ok) throw new Error(`save GET: ${res.status}`)
  return (await res.json()) as SaveResponse
}

/** Push a save. Returns 'ok' or 'conflict' with both versions. */
export async function putSave(baseRevision: number, data: PersistedData): Promise<PutSaveResult> {
  const res = await fetch('/api/save', {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ baseRevision, data }),
  })

  if (res.status === 409) {
    const body = (await res.json()) as { serverRevision: number; server: PersistedData; client: PersistedData }
    return {
      status:         'conflict',
      serverRevision: body.serverRevision,
      server:         body.server,
      client:         body.client,
    }
  }

  if (!res.ok) throw new Error(`save PUT: ${res.status}`)
  const body = (await res.json()) as { revision: number; data: PersistedData }
  return { status: 'ok', revision: body.revision, data: body.data }
}

/* ------------------------------------------------------------------ */
/* Leaderboard                                                         */
/* ------------------------------------------------------------------ */

export async function getLeaderboard(
  worldId: string,
  endless: boolean,
  limit = 50,
  offset = 0,
): Promise<LeaderboardEntry[]> {
  const params = new URLSearchParams({
    worldId,
    endless: String(endless),
    limit:   String(limit),
    offset:  String(offset),
  })
  const res = await fetch(`/api/leaderboard?${params.toString()}`)
  if (!res.ok) throw new Error(`leaderboard: ${res.status}`)
  const body = (await res.json()) as { entries: LeaderboardEntry[] }
  return body.entries
}

/* ------------------------------------------------------------------ */
/* Score Submission                                                    */
/* ------------------------------------------------------------------ */

export async function submitScore(submission: ScoreSubmission): Promise<ScoreResult> {
  const res = await fetch('/api/score', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(submission),
  })
  if (!res.ok) throw new Error(`score: ${res.status}`)
  return (await res.json()) as ScoreResult
}
