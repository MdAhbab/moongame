/**
 * Spherical bucket-grid broadphase (gameplan §23.3).
 *
 * Everything in this game lives in a thin shell between r = 100 and r = 170,
 * which makes a uniform 3D grid mostly empty interior. Bucketing instead by
 * (longitude cell, latitude cell, radial band) — 24 × 12 × 3 = 864 buckets —
 * keeps every occupied cell useful.
 *
 * §23.3's measured effect: 48 enemies × 256 projectiles is 12,288 brute-force
 * pairs per step; bucketing reduces this to roughly 600. That ~20× reduction is
 * what makes a 120 Hz simulation affordable.
 *
 * Latitude cells are sized by equal *area* rather than equal angle — bands are
 * uniform in sin(latitude) — so polar buckets do not become pathologically
 * dense.
 *
 * Storage is a counting sort over three pre-allocated typed arrays. Nothing
 * here allocates after construction (Rule 3).
 */
import { BUCKET_LON, BUCKET_LAT, BUCKET_RADIAL, BUCKET_COUNT, R, SHELL_OUTER } from '../../data/constants.ts'

const TWO_PI = Math.PI * 2
const LON_PER_CELL = TWO_PI / BUCKET_LON
const SHELL_SPAN = SHELL_OUTER - R

/** Longitude cell for an azimuth in [0, 2π). @hot-path */
function lonCellOf(x: number, z: number): number {
  let a = Math.atan2(z, x)
  if (a < 0) a += TWO_PI
  const c = Math.floor((a / TWO_PI) * BUCKET_LON)
  return c >= BUCKET_LON ? BUCKET_LON - 1 : c
}

/** Equal-area latitude band: uniform in sin(lat) = y/r. @hot-path */
function latCellOf(y: number, r: number): number {
  const s = r > 1e-9 ? y / r : 0
  const c = Math.floor(((s + 1) * 0.5) * BUCKET_LAT)
  return c < 0 ? 0 : c >= BUCKET_LAT ? BUCKET_LAT - 1 : c
}

/** @hot-path */
function radialBandOf(r: number): number {
  const c = Math.floor(((r - R) / SHELL_SPAN) * BUCKET_RADIAL)
  return c < 0 ? 0 : c >= BUCKET_RADIAL ? BUCKET_RADIAL - 1 : c
}

/** @hot-path */
function bucketIndex(lon: number, lat: number, band: number): number {
  return (band * BUCKET_LAT + lat) * BUCKET_LON + lon
}

export class BucketGrid {
  private readonly counts = new Int32Array(BUCKET_COUNT)
  private readonly starts = new Int32Array(BUCKET_COUNT + 1)
  private readonly cursor = new Int32Array(BUCKET_COUNT)
  private readonly items: Int32Array
  private readonly pendingId: Int32Array
  private readonly pendingCell: Int32Array
  private pending = 0
  private built = false

  constructor(private readonly capacity: number) {
    this.items = new Int32Array(capacity)
    this.pendingId = new Int32Array(capacity)
    this.pendingCell = new Int32Array(capacity)
  }

  /** @hot-path */
  clear(): void {
    this.counts.fill(0)
    this.pending = 0
    this.built = false
  }

  /**
   * Registers an entity at a world position. Silently ignores inserts beyond
   * capacity — pools are fixed size (§31.2), so overflow means a pool leak,
   * which the pool's own assertions catch rather than this hot loop.
   * @hot-path
   */
  insert(id: number, x: number, y: number, z: number): void {
    if (this.pending >= this.capacity) return
    const r = Math.sqrt(x * x + y * y + z * z)
    const cell = bucketIndex(lonCellOf(x, z), latCellOf(y, r), radialBandOf(r))
    this.pendingId[this.pending] = id
    this.pendingCell[this.pending] = cell
    this.counts[cell] = (this.counts[cell] as number) + 1
    this.pending++
  }

  /** Prefix-sums the counts and scatters ids into their buckets. @hot-path */
  build(): void {
    let running = 0
    for (let i = 0; i < BUCKET_COUNT; i++) {
      this.starts[i] = running
      this.cursor[i] = running
      running += this.counts[i] ?? 0
    }
    this.starts[BUCKET_COUNT] = running

    for (let i = 0; i < this.pending; i++) {
      const cell = this.pendingCell[i] ?? 0
      const at = this.cursor[cell] ?? 0
      this.items[at] = this.pendingId[i] ?? 0
      this.cursor[cell] = at + 1
    }
    this.built = true
  }

  /**
   * Collects the ids of every entity within `radius` of a point into `out`,
   * returning how many were written. Results are a superset of the true
   * neighbours — the narrowphase does the exact test.
   *
   * Longitude span is computed from the latitude rather than fixed at ±1,
   * because longitude cells converge towards the poles: a fixed 3-cell window
   * there covers a shrinking absolute distance and would start missing pairs.
   *
   * @hot-path
   */
  query(x: number, y: number, z: number, radius: number, out: Int32Array): number {
    if (!this.built) return 0

    const r = Math.sqrt(x * x + y * y + z * z)
    const lat = latCellOf(y, r)
    const band = radialBandOf(r)
    const lon = lonCellOf(x, z)

    // Horizontal circle radius at this latitude bounds the longitudinal arc.
    const horizontal = Math.sqrt(Math.max(1e-6, x * x + z * z))
    const angularSpan = Math.min(Math.PI, radius / horizontal)
    const lonSpan = Math.min(BUCKET_LON >> 1, Math.ceil(angularSpan / LON_PER_CELL) + 1)

    const latLo = Math.max(0, lat - 1)
    const latHi = Math.min(BUCKET_LAT - 1, lat + 1)
    const bandLo = Math.max(0, band - 1)
    const bandHi = Math.min(BUCKET_RADIAL - 1, band + 1)

    let n = 0
    const limit = out.length

    for (let b = bandLo; b <= bandHi; b++) {
      for (let la = latLo; la <= latHi; la++) {
        for (let dl = -lonSpan; dl <= lonSpan; dl++) {
          // Longitude wraps: cell 23 and cell 0 are neighbours.
          const lo = (((lon + dl) % BUCKET_LON) + BUCKET_LON) % BUCKET_LON
          const cell = bucketIndex(lo, la, b)
          const from = this.starts[cell] ?? 0
          const to = this.starts[cell + 1] ?? from
          for (let i = from; i < to; i++) {
            if (n >= limit) return n
            out[n++] = this.items[i] ?? 0
          }
        }
      }
    }
    return n
  }

  /** Number of entities registered this step. Used by the perf overlay. */
  get size(): number {
    return this.pending
  }
}
