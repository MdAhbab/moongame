/**
 * Seeded PRNG (gameplan §10.4).
 *
 * Determinism is load-bearing here: it makes runs comparable between players,
 * makes bugs reproducible from the seed shown on the Debrief, and is what would
 * later make replay and co-op cheap (§45).
 *
 * mulberry32 — 32-bit state, passes gjrand and PractRand to well beyond any
 * sequence length this game will draw, and is a handful of integer operations.
 * No `eval`, no `Function` constructor (Rule 17, §39.1).
 */
export class Random {
  private state: number

  constructor(seed: number) {
    // A zero state is a fixed point for many 32-bit generators; nudge it.
    this.state = (seed >>> 0) || 0x9e3779b9
  }

  /** Uniform in [0, 1). @hot-path */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Uniform in [min, max). @hot-path */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** Uniform integer in [min, max]. @hot-path */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1))
  }

  /** Uniform in [-1, 1). @hot-path */
  signed(): number {
    return this.next() * 2 - 1
  }

  /** Picks an element, or `undefined` for an empty list. */
  pick<T>(items: readonly T[]): T | undefined {
    if (items.length === 0) return undefined
    return items[Math.floor(this.next() * items.length)]
  }

  /** Current internal state — lets a test snapshot and restore the stream. */
  snapshot(): number {
    return this.state
  }

  restore(state: number): void {
    this.state = state >>> 0
  }
}

/**
 * FNV-1a over UTF-16 code units. Maps a human-typeable seed string to a 32-bit
 * integer, so a player can share "NX-7742-K" and get the same run.
 */
export function hashString(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * `seed = hash(runId, waveNumber)` (§10.4) — two players with the same run seed
 * face identical waves, and each wave draws from an independent stream so
 * replaying wave 7 does not depend on what happened in wave 6.
 */
export function waveSeed(runSeed: string, waveNumber: number): number {
  return (hashString(runSeed) ^ Math.imul(waveNumber + 1, 0x9e3779b9)) >>> 0
}

const SEED_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * Formats a 32-bit value as a readable run seed, e.g. `NX-7742-K`.
 * Ambiguous glyphs (I/O/0/1) are excluded so a seed can be read off a screen
 * and typed back in without error.
 */
export function formatSeed(value: number): string {
  let v = value >>> 0
  let out = ''
  for (let i = 0; i < 8; i++) {
    if (i === 2 || i === 6) out += '-'
    out += SEED_ALPHABET[v % SEED_ALPHABET.length] ?? 'A'
    v = Math.floor(v / SEED_ALPHABET.length) + 7
  }
  return out
}
