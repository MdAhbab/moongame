/**
 * Telling a trackpad from a mouse (§8.1, §8.5).
 *
 * There is no API for this, so it is a heuristic over the shape of the `wheel`
 * event stream. Which means two things have to be true and both are tested here:
 * the heuristic has to be right on realistic traffic, and being wrong has to be
 * recoverable — the override always wins, because a player whose hardware was
 * misdetected must not be stuck with the wrong tuning.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  activeProfile,
  detectedPointer,
  observeWheel,
  profileFor,
  resetPointerDetection,
} from '@/platform/deviceProfile'

/** A notched wheel: large, whole-numbered, one axis. */
function mouseWheel(times: number): void {
  for (let i = 0; i < times; i++) observeWheel({ deltaMode: 0, deltaX: 0, deltaY: 100 })
}

/** Fingers on glass: small, fractional, often with a horizontal component. */
function trackpadWheel(times: number): void {
  for (let i = 0; i < times; i++) observeWheel({ deltaMode: 0, deltaX: 0.4, deltaY: 3.7 })
}

beforeEach(() => {
  resetPointerDetection()
})

describe('detection', () => {
  it('says nothing until it has seen enough', () => {
    // A verdict from one event would flap. Until it is confident, callers fall
    // back to the mouse tuning that has always shipped.
    expect(detectedPointer()).toBeNull()
    trackpadWheel(1)
    expect(detectedPointer()).toBeNull()
  })

  it('recognises a notched mouse wheel', () => {
    mouseWheel(5)
    expect(detectedPointer()).toBe('mouse')
  })

  it('recognises a trackpad from small fractional deltas', () => {
    trackpadWheel(5)
    expect(detectedPointer()).toBe('trackpad')
  })

  it('treats line-mode as conclusively a mouse', () => {
    // `DOM_DELTA_LINE` is what a classic notched wheel reports and a trackpad
    // essentially never does, so one event settles it.
    observeWheel({ deltaMode: 1, deltaX: 0, deltaY: 3 })
    expect(detectedPointer()).toBe('mouse')
  })

  it('reads horizontal scroll as a trackpad', () => {
    // Two-finger sideways movement is trivial on glass and rare on a wheel.
    for (let i = 0; i < 5; i++) observeWheel({ deltaMode: 0, deltaX: 60, deltaY: 0 })
    expect(detectedPointer()).toBe('trackpad')
  })

  it('latches, so the verdict cannot flip mid-flight', () => {
    // A player who scrolls a menu with a mouse and then rests a thumb on a
    // trackpad must not have their steering gain change underneath them.
    trackpadWheel(5)
    expect(detectedPointer()).toBe('trackpad')
    mouseWheel(20)
    expect(detectedPointer()).toBe('trackpad')
  })

  it('forgets on demand, so switching the override re-detects', () => {
    trackpadWheel(5)
    resetPointerDetection()
    expect(detectedPointer()).toBeNull()
    mouseWheel(5)
    expect(detectedPointer()).toBe('mouse')
  })
})

describe('tuning', () => {
  it('gives a trackpad more gain and a faster return to centre', () => {
    // The whole reason the profile exists: a trackpad's usable throw is about
    // 3 cm against a mouse's 30, so the same gesture would otherwise produce a
    // fraction of the deflection and the game would feel unresponsive.
    const mouse = profileFor('mouse')
    const trackpad = profileFor('trackpad')
    expect(trackpad.gain).toBeGreaterThan(mouse.gain * 1.5)
    expect(trackpad.recentre).toBeGreaterThan(mouse.recentre)
  })

  it('keeps the mouse profile at exactly the shipped tuning', () => {
    // `MOUSE_GAIN` in the input layer is derived from a 6.0 s^-1 recentre. If
    // this drifts, every mouse player's sensitivity silently changes.
    const mouse = profileFor('mouse')
    expect(mouse.gain).toBe(1)
    expect(mouse.recentre).toBe(6.0)
  })
})

describe('the override always wins', () => {
  it('ignores detection when the player has chosen', () => {
    trackpadWheel(5)
    expect(activeProfile('mouse', false).kind).toBe('mouse')
    expect(activeProfile('trackpad', false).kind).toBe('trackpad')
  })

  it('falls back to the shipped tuning before the detector is confident', () => {
    // Not a provisional guess: a desktop player who never scrolls should get
    // the behaviour the game has always had.
    expect(activeProfile('auto', false).kind).toBe('mouse')
  })

  it('follows detection once it is confident', () => {
    trackpadWheel(5)
    expect(activeProfile('auto', false).kind).toBe('trackpad')
  })

  it('uses the touch profile on a device with no fine pointer', () => {
    expect(activeProfile('auto', true).kind).toBe('touch')
  })
})
