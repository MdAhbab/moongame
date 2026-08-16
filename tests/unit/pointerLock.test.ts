/**
 * @vitest-environment jsdom
 *
 * Pointer Lock on a browser that does not have it.
 *
 * ## The bug this pins
 *
 * iOS Safari implements no part of the Pointer Lock API. On its own that is
 * fine — the game ships touch controls and never wants the lock on a phone.
 * What made it fatal is the shape of the absence:
 *
 * ```js
 * document.pointerLockElement   // undefined on iOS, null everywhere else
 * document.exitPointerLock      // undefined on iOS
 * ```
 *
 * so the guard `if (document.pointerLockElement !== null) document.exitPointerLock()`
 * evaluated `undefined !== null` as **true**, entered the branch, and called a
 * method that was not there. `releasePointer` runs from an effect in `App` on
 * the first commit — the Title screen is not `Playing`, so the lock gets
 * "released" before a single frame is drawn — and since that effect belongs to
 * the component rendering the error boundary, nothing caught the throw. React
 * unmounted the root. iOS Safari showed a black page with no text on it.
 *
 * ## Why no existing test saw it
 *
 * Not because jsdom is unlike Safari. jsdom's `document` is shaped *identically*
 * — `exitPointerLock`, `requestPointerLock` and `pointerLockElement` are all
 * `undefined`, asserted below so that stays true. The suite missed it for a much
 * plainer reason: **nothing ever called `releasePointer`.** The one line of the
 * input layer that only runs from a React effect was the one line no test
 * reached, and every real browser on every dev machine implements the API, so
 * manual play could not find it either.
 *
 * The assertions are therefore about *reachability* as much as behaviour. The
 * first one calls the function the app calls, in the environment that breaks it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindDeviceInput, releasePointer } from '../../src/platform/deviceInput'
import { useGameStore } from '../../src/state/useGameStore'
import type { Simulation } from '../../src/game/core/Simulation'

type Loose = Record<string, unknown>

/** Restores whatever the API stubs below overwrite. */
function clearPointerLockStubs(): void {
  delete (document as unknown as Loose).exitPointerLock
  delete (document as unknown as Loose).pointerLockElement
  delete (document.body as unknown as Loose).requestPointerLock
}

/** Gives the document the API a desktop browser has. */
function stubDesktopPointerLock(locked: Element | null): { exit: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> } {
  const exit = vi.fn()
  const request = vi.fn()
  Object.defineProperty(document, 'exitPointerLock', { value: exit, configurable: true, writable: true })
  Object.defineProperty(document, 'pointerLockElement', { value: locked, configurable: true, writable: true })
  Object.defineProperty(document.body, 'requestPointerLock', { value: request, configurable: true, writable: true })
  return { exit, request }
}

afterEach(() => {
  clearPointerLockStubs()
  useGameStore.setState({ screen: 'Title' })
})

describe('a browser without the Pointer Lock API', () => {
  beforeEach(clearPointerLockStubs)

  it('is what this environment is, which is why the test is honest', () => {
    // If jsdom ever implements Pointer Lock, the test below stops reproducing
    // iOS and starts passing for the wrong reason. This fails loudly first.
    expect(typeof (document as unknown as Loose).exitPointerLock).toBe('undefined')
    expect(typeof (document.body as unknown as Loose).requestPointerLock).toBe('undefined')
    expect((document as unknown as Loose).pointerLockElement).toBeUndefined()
  })

  it('does not throw from releasePointer — the exact call that black-screened iOS', () => {
    expect(() => releasePointer()).not.toThrow()
  })

  it('survives the Title-screen mount, where the real crash happened', () => {
    // `App` calls `releasePointer()` from an effect whenever the screen is not
    // Playing or Tutorial. The very first commit satisfies that, so this is the
    // first thing the game did on iOS and the last.
    useGameStore.setState({ screen: 'Title' })
    expect(() => releasePointer()).not.toThrow()
  })

  it('does not throw when a mouse button is pressed during play', () => {
    // Reachable on iPadOS, which has no Pointer Lock but does deliver real
    // mouse events from an attached trackpad.
    useGameStore.setState({ screen: 'Playing' })
    const simulation = { sampleInput: null } as unknown as Simulation
    const detach = bindDeviceInput(simulation)
    try {
      expect(() => {
        window.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }))
      }).not.toThrow()
    } finally {
      detach()
    }
  })
})

describe('a browser with the Pointer Lock API still gets it', () => {
  it('releases a held lock', () => {
    // The guard must not have "fixed" iOS by disabling the feature everywhere.
    const { exit } = stubDesktopPointerLock(document.body)
    releasePointer()
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('does not call exit when nothing is locked', () => {
    const { exit } = stubDesktopPointerLock(null)
    releasePointer()
    expect(exit).not.toHaveBeenCalled()
  })

  it('requests the lock on a mouse press during play', () => {
    useGameStore.setState({ screen: 'Playing' })
    const { request } = stubDesktopPointerLock(null)
    const simulation = { sampleInput: null } as unknown as Simulation
    const detach = bindDeviceInput(simulation)
    try {
      window.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }))
      expect(request).toHaveBeenCalledTimes(1)
    } finally {
      detach()
    }
  })
})
