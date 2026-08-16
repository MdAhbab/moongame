/**
 * @vitest-environment jsdom
 *
 * The on-glass stick flies the craft in all four directions (§8.3).
 *
 * ## The bug this pins
 *
 * The stick's vertical axis used to write `steerY`, which `FlightSystem` reads
 * as *aim* and nothing else. Altitude lives on `input.climb`, and on a
 * touchscreen the only thing writing it was a **horizontal** scrub across the
 * throttle column — a widget labelled THR, on the opposite side of the screen,
 * on the axis nobody drags it along.
 *
 * So pushing the stick up tilted the nose and held altitude exactly. The craft
 * looked like it was climbing and was not, and the control that actually flew
 * it was undiscoverable. On a phone, where the stick is the only flight control
 * there is, that is the difference between flying and not.
 *
 * ## Why it renders the component
 *
 * The mapping lives in a closure inside `TouchControls`'s effect, and it is the
 * mapping that was wrong — not the plumbing beneath it, which was faithfully
 * carrying a value nothing set. Asserting on `touchState` after a real pointer
 * gesture is the only version of this test that would have failed before.
 *
 * jsdom has no `PointerEvent`, so `MouseEvent` stands in: the handlers read
 * `clientX`, `clientY` and `pointerId`, and an undefined `pointerId` is a
 * consistent map key for a single-pointer gesture.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createElement, act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// Resolved after the touch stub below, because `hasTouch` is a module-level
// const: imported at the top of the file it would be captured as `false` and
// the component would render nothing.
let TouchControls: () => ReactNode
let touchState: {
  steerX: number
  steerY: number
  climb: number
  throttle: number
}

/** Full stick deflection, mirroring `STICK_RANGE`. */
const RANGE = 46

beforeAll(async () => {
  Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true })
  ;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

  const controls = await import('../../src/ui/hud/TouchControls')
  const input = await import('../../src/platform/deviceInput')
  TouchControls = controls.TouchControls as typeof TouchControls
  touchState = input.touchState
})

let host: HTMLDivElement
let root: Root
let surface: Element

function pointer(type: string, target: EventTarget, x: number, y: number): void {
  target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }))
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  // Not awaited: `act` with a synchronous callback flushes synchronously and
  // its type is `void`, so an `await` here would be awaiting nothing.
  act(() => { root.render(createElement(TouchControls)) })
  const first = host.firstElementChild
  if (first === null) throw new Error('TouchControls rendered nothing — is `hasTouch` false?')
  surface = first
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
})

describe('the stick commands altitude, not just aim', () => {
  it('climbs when the thumb pushes up', () => {
    // Screen Y grows downward, so "up" is a *smaller* clientY.
    pointer('pointerdown', surface, 200, 300)
    pointer('pointermove', window, 200, 300 - RANGE)

    expect(touchState.climb, 'pushing up must command a climb').toBeGreaterThan(0.9)
  })

  it('dives when the thumb pulls down', () => {
    pointer('pointerdown', surface, 200, 300)
    pointer('pointermove', window, 200, 300 + RANGE)

    expect(touchState.climb).toBeLessThan(-0.9)
  })

  it('spends most of the vertical axis on altitude and only a little on aim', () => {
    // Both, deliberately. Altitude is a commanded quantity the PD controller
    // flies to over the better part of a second, so a stick that only wrote
    // `climb` would feel like it had a hold before anything moved; a modest aim
    // term makes the nose answer on the same frame. See `STICK_AIM_FROM_Y`.
    pointer('pointerdown', surface, 200, 300)
    pointer('pointermove', window, 200, 300 - RANGE)

    expect(Math.abs(touchState.steerY), 'the nose still responds').toBeGreaterThan(0)
    expect(
      Math.abs(touchState.steerY),
      'but vertical drag is an altitude command first',
    ).toBeLessThan(Math.abs(touchState.climb))
  })

  it('still turns on the horizontal axis', () => {
    pointer('pointerdown', surface, 200, 300)
    pointer('pointermove', window, 200 + RANGE, 300)

    expect(touchState.steerX).toBeGreaterThan(0.9)
    // `toBeCloseTo`, not `toBe`: the sign flip that makes up mean climb turns a
    // zero into `-0`, and `Object.is(-0, 0)` is false. Nothing downstream can
    // tell the difference — `-0 === 0` is true, so `updateAltitudeCommand`'s
    // `input.climb !== 0` guard reads it as neutral exactly as intended.
    expect(touchState.climb, 'a pure left-right drag must not change altitude').toBeCloseTo(0, 10)
  })

  it('turns and climbs at once on a diagonal', () => {
    pointer('pointerdown', surface, 200, 300)
    pointer('pointermove', window, 240, 260)

    expect(touchState.steerX).toBeGreaterThan(0)
    expect(touchState.climb).toBeGreaterThan(0)
  })

  it('centres every axis when the thumb lifts', () => {
    // A finger lifted mid-turn that left the axes pinned would fly the craft
    // into the ground while the player was reading the wave summary.
    pointer('pointerdown', surface, 200, 300)
    pointer('pointermove', window, 240, 260)
    pointer('pointerup', window, 240, 260)

    expect(touchState.steerX).toBe(0)
    expect(touchState.steerY).toBe(0)
    expect(touchState.climb).toBe(0)
  })
})

describe('the throttle column is throttle only', () => {
  it('does not touch altitude when dragged sideways', () => {
    // This axis *was* the altitude control. It is the stick's now, and a
    // horizontal scrub here must be inert rather than fighting it.
    const right = Math.round(window.innerWidth * 0.9)
    pointer('pointerdown', surface, right, 300)
    pointer('pointermove', window, right - 60, 300)

    expect(touchState.climb).toBe(0)
  })

  it('still sets throttle when dragged up', () => {
    const right = Math.round(window.innerWidth * 0.9)
    pointer('pointerdown', surface, right, 300)
    const neutral = touchState.throttle
    pointer('pointermove', window, right, 260)

    expect(touchState.throttle).toBeGreaterThan(neutral)
  })
})
