/**
 * @vitest-environment jsdom
 *
 * Auto-lock, and where it is allowed to live (§37.3).
 *
 * Locking is a held control: keep it on a target until the ring closes, then
 * fly. On a keyboard that is a spare finger. On glass it was a dedicated button
 * competing for a thumb already steering, which is why it is now optional.
 *
 * ## The constraint that decides the implementation
 *
 * The simulation is replay-verified — the server re-runs a submitted seed and
 * input log through the identical `stepWorld` and compares the result. So a
 * preference that changed what the world did **without passing through
 * `world.input`** would make every replay of that run diverge on a machine
 * whose settings differed, and the score would be rejected as a forgery.
 *
 * Auto-lock therefore resolves in the input layer and writes `input.locking`,
 * exactly like `autoFire`. `WeaponSystem` never learns the setting exists. The
 * tests below assert that seam, not just the feature.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bindDeviceInput } from '../../src/platform/deviceInput'
import { useSettingsStore } from '../../src/state/useSettingsStore'
import { useGameStore } from '../../src/state/useGameStore'
import { createInputState, createWorld, type World } from '../../src/game/core/World'
import type { Simulation } from '../../src/game/core/Simulation'

function setAutoLock(on: boolean): void {
  useSettingsStore.setState((s) => ({
    settings: { ...s.settings, controls: { ...s.settings.controls, autoLock: on } },
  }))
}

describe('auto-lock holds the lock control', () => {
  let detach: () => void
  let simulation: { sampleInput: ((world: World) => void) | null }
  let world: World

  beforeEach(() => {
    useGameStore.setState({ screen: 'Playing' })
    simulation = { sampleInput: null }
    detach = bindDeviceInput(simulation as unknown as Simulation)
    world = createWorld('auto-lock', 1)
    Object.assign(world.input, createInputState())
  })

  afterEach(() => {
    detach()
    setAutoLock(true)
    useGameStore.setState({ screen: 'Title' })
  })

  const sample = (): void => { simulation.sampleInput?.(world) }

  it('asserts locking with no key held', () => {
    setAutoLock(true)
    sample()
    expect(world.input.locking).toBe(true)
  })

  it('leaves locking alone when switched off', () => {
    setAutoLock(false)
    sample()
    expect(world.input.locking).toBe(false)
  })

  it('is the default, because the control it replaces has no thumb free', () => {
    expect(useSettingsStore.getState().settings.controls.autoLock).toBe(true)
  })

  it('does not fire anything by itself', () => {
    // Auto-lock arms the shot; the player still takes it. If this ever couples
    // to the trigger, a missile leaves the rail without anyone asking.
    setAutoLock(true)
    sample()
    expect(world.input.firing).toBe(false)
  })

  it('does not pin a tapped target as a standing request', () => {
    // `requestLockTarget` is reset whenever the lock control is *released*, and
    // that reset used to read the same resolved `locking` flag auto-lock pins
    // true forever — so a target tapped once in wave 1 would stay the standing
    // request for the rest of the run. The reset reads the asserted control.
    setAutoLock(true)
    sample()
    expect(world.input.locking).toBe(true)
    expect(world.input.requestLockTarget).toBe(-1)
  })
})
