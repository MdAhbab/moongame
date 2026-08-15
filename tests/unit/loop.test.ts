/**
 * Fixed-timestep loop (gameplan §18.2, §37.3).
 *
 * The headline correctness claim of the whole project: the simulation is
 * identical on 60 Hz, 120 Hz and 144 Hz displays. V1 had no delta time
 * anywhere, so a 144 Hz display ran the game 2.4× faster than 60 Hz — the root
 * cause of most of its "feel" problems.
 */
import { describe, expect, it } from 'vitest'

import { Loop } from '@/game/core/Loop'
import { FIXED_DT, MAX_ACCUM, MAX_SUBSTEPS } from '@/game/data/constants'

/** Runs `seconds` of wall time at a given refresh rate, returning steps taken. */
function runAt(hz: number, seconds: number): number {
  const loop = new Loop()
  const dt = 1 / hz
  const frames = Math.round(seconds * hz)
  let steps = 0
  for (let i = 0; i < frames; i++) loop.advance(dt, () => steps++)
  return steps
}

describe('Loop (§18.2)', () => {
  it('runs an identical step count at 60, 120 and 144 Hz over 10 s', () => {
    // §37.3's direct V1 regression test. 10 s at 120 Hz is exactly 1200 steps,
    // and every refresh rate must agree.
    const expected = Math.round(10 / FIXED_DT)
    expect(runAt(60, 10)).toBe(expected)
    expect(runAt(120, 10)).toBe(expected)
    expect(runAt(144, 10)).toBe(expected)
  })

  it('agrees across a wide range of refresh rates', () => {
    const expected = Math.round(10 / FIXED_DT)
    for (const hz of [30, 50, 60, 75, 90, 100, 120, 144, 165, 240]) {
      expect(runAt(hz, 10), `${hz} Hz`).toBe(expected)
    }
  })

  it('never runs more than MAX_SUBSTEPS in one frame', () => {
    // Without the clamp, returning to a backgrounded tab queues thousands of
    // substeps and locks the browser.
    const loop = new Loop()
    let steps = 0
    loop.advance(60, () => steps++)
    expect(steps).toBe(MAX_SUBSTEPS)
    expect(steps).toBe(30)
  })

  it('clamps a huge delta to MAX_ACCUM rather than spiralling', () => {
    const loop = new Loop()
    let steps = 0
    loop.advance(999, () => steps++)
    expect(steps).toBeLessThanOrEqual(Math.ceil(MAX_ACCUM / FIXED_DT))
  })

  it('ignores negative, zero and non-finite deltas', () => {
    const loop = new Loop()
    let steps = 0
    loop.advance(-1, () => steps++)
    loop.advance(0, () => steps++)
    loop.advance(Number.NaN, () => steps++)
    loop.advance(Number.POSITIVE_INFINITY, () => steps++)
    expect(steps).toBe(0)
  })

  it('reports alpha in [0, 1)', () => {
    const loop = new Loop()
    for (let i = 0; i < 500; i++) {
      const alpha = loop.advance(1 / 144, () => {})
      expect(alpha).toBeGreaterThanOrEqual(0)
      expect(alpha).toBeLessThanOrEqual(1)
    }
  })

  it('interpolates smoothly at 60 Hz — alpha stays 0 on an exact multiple', () => {
    // 1/60 is exactly two steps, so there is never a fractional remainder.
    const loop = new Loop()
    for (let i = 0; i < 60; i++) {
      const alpha = loop.advance(1 / 60, () => {})
      expect(alpha).toBeLessThan(1e-9)
    }
  })

  it('resets so unpausing produces no catch-up burst', () => {
    const loop = new Loop()
    let steps = 0
    loop.advance(0.2, () => steps++)
    loop.reset()
    steps = 0
    loop.advance(1 / 120, () => steps++)
    expect(steps).toBe(1)
  })
})
