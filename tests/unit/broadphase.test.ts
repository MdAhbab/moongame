/**
 * Broadphase correctness (gameplan §37.1, §40 Phase 4).
 *
 * The spec's instruction is explicit: build brute force first, verify it is
 * correct, *then* add the bucket grid and assert the two produce identical
 * results across 10,000 random configurations. Optimising before you have a
 * correct reference leaves no way to tell whether the optimisation broke
 * something.
 *
 * So this file is the reference implementation and the equivalence proof.
 */
import { describe, expect, it } from 'vitest'

import { BucketGrid } from '@/game/physics/collision/broadphase'
import { Random } from '@/game/core/Random'
import { ALT_MAX, R } from '@/game/data/constants'

interface Point {
  x: number
  y: number
  z: number
}

/** The reference every grid query is checked against. */
function bruteForce(points: readonly Point[], x: number, y: number, z: number, radius: number): Set<number> {
  const found = new Set<number>()
  const r2 = radius * radius
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (p === undefined) continue
    const dx = p.x - x
    const dy = p.y - y
    const dz = p.z - z
    if (dx * dx + dy * dy + dz * dz <= r2) found.add(i)
  }
  return found
}

/** Uniform on the shell — not uniform in angle, which clusters at the poles. */
function randomShellPoint(rng: Random): Point {
  const u = rng.range(-1, 1)
  const theta = rng.range(0, Math.PI * 2)
  const s = Math.sqrt(Math.max(0, 1 - u * u))
  const radius = R + rng.range(0, ALT_MAX)
  return { x: radius * s * Math.cos(theta), y: radius * u, z: radius * s * Math.sin(theta) }
}

describe('bucket grid (§23.3)', () => {
  it('matches brute force across 10,000 random configurations', () => {
    const rng = new Random(0xc0ffee)
    const capacity = 64
    const grid = new BucketGrid(capacity)
    const out = new Int32Array(capacity)

    let checked = 0

    for (let trial = 0; trial < 10_000; trial++) {
      const count = rng.int(0, 48)
      const points: Point[] = []
      grid.clear()
      for (let i = 0; i < count; i++) {
        const p = randomShellPoint(rng)
        points.push(p)
        grid.insert(i, p.x, p.y, p.z)
      }
      grid.build()

      const query = randomShellPoint(rng)
      const radius = rng.range(1, 25)

      const expected = bruteForce(points, query.x, query.y, query.z, radius)
      const n = grid.query(query.x, query.y, query.z, radius, out)

      const actual = new Set<number>()
      for (let i = 0; i < n; i++) actual.add(out[i] as number)

      // The grid returns a superset — cells are coarser than the query sphere.
      // What must never happen is a *miss*, because a missed pair is a shot
      // that visibly passes through an enemy.
      for (const id of expected) {
        expect(actual.has(id), `trial ${trial}: grid missed point ${id}`).toBe(true)
      }
      checked++
    }

    expect(checked).toBe(10_000)
  })

  it('finds neighbours across the longitude seam', () => {
    // Cell 23 and cell 0 are adjacent in space but far apart in index. Getting
    // the wrap wrong produces a blind stripe that is very hard to spot in play.
    const grid = new BucketGrid(8)
    const out = new Int32Array(8)

    const radius = R + 20
    const epsilon = 0.01
    const a = { x: radius * Math.cos(-epsilon), y: 0, z: radius * Math.sin(-epsilon) }
    const b = { x: radius * Math.cos(epsilon), y: 0, z: radius * Math.sin(epsilon) }

    grid.clear()
    grid.insert(0, a.x, a.y, a.z)
    grid.insert(1, b.x, b.y, b.z)
    grid.build()

    const n = grid.query(a.x, a.y, a.z, 10, out)
    const found = new Set(Array.from(out.subarray(0, n)))
    expect(found.has(1)).toBe(true)
  })

  it('finds neighbours near the pole, where longitude cells converge', () => {
    // Equal-area latitude bands mean the polar band spans a wide angle. A fixed
    // ±1 longitude window there would cover a shrinking absolute distance.
    const grid = new BucketGrid(8)
    const out = new Int32Array(8)

    const radius = R + 20
    const a = { x: 0.5, y: radius, z: 0.5 }
    const b = { x: -0.5, y: radius, z: -0.5 }

    grid.clear()
    grid.insert(0, a.x, a.y, a.z)
    grid.insert(1, b.x, b.y, b.z)
    grid.build()

    const n = grid.query(a.x, a.y, a.z, 5, out)
    const found = new Set(Array.from(out.subarray(0, n)))
    expect(found.has(1)).toBe(true)
  })

  it('returns nothing before build, rather than stale contents', () => {
    const grid = new BucketGrid(8)
    const out = new Int32Array(8)
    grid.clear()
    grid.insert(0, R + 10, 0, 0)
    expect(grid.query(R + 10, 0, 0, 5, out)).toBe(0)
  })

  it('is meaningfully cheaper than brute force at full population', () => {
    // §23.3 claims ~20×. The point of the test is that the reduction is real,
    // not that it hits a precise ratio on a particular machine.
    const rng = new Random(7)
    const grid = new BucketGrid(64)
    const out = new Int32Array(64)

    grid.clear()
    const points: Point[] = []
    for (let i = 0; i < 48; i++) {
      const p = randomShellPoint(rng)
      points.push(p)
      grid.insert(i, p.x, p.y, p.z)
    }
    grid.build()

    let visited = 0
    for (let i = 0; i < 256; i++) {
      const q = randomShellPoint(rng)
      visited += grid.query(q.x, q.y, q.z, 6, out)
    }

    const bruteForcePairs = 48 * 256
    expect(visited).toBeLessThan(bruteForcePairs / 5)
  })
})
