/**
 * @vitest-environment jsdom
 *
 * The device → simulation seam (§8, §30.2).
 *
 * Everything else in `tests/unit` runs headless against the simulation, which is
 * the right default — but it leaves the one layer the player actually touches
 * untested, and that is where the controls people reported as broken actually
 * broke. Both failures pinned here were invisible to a headless test:
 *
 *  1. A press shorter than one fixed step was dropped entirely, because
 *     `sampleInput` reads what is *held* at the head of a step and a tap can
 *     begin and end between two of them.
 *  2. The act controls were reported as held flags and toggled on every step of
 *     the press, so a normal 150 ms keypress switched weapon mode eighteen times.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bindDeviceInput } from '../../src/platform/deviceInput'
import { useGameStore } from '../../src/state/useGameStore'
import { createInputState, createWorld, type World } from '../../src/game/core/World'
import { stepInput } from '../../src/game/systems/InputSystem'
import type { Simulation } from '../../src/game/core/Simulation'

/** The single method `bindDeviceInput` actually needs. */
function fakeSimulation(): { sampleInput: ((world: World) => void) | null } {
  return { sampleInput: null }
}

function press(code: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }))
}

function release(code: string): void {
  window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }))
}

describe('the keyboard reaches the simulation', () => {
  let detach: () => void
  let simulation: { sampleInput: ((world: World) => void) | null }
  let world: World

  beforeEach(() => {
    useGameStore.setState({ screen: 'Playing' })
    simulation = fakeSimulation()
    detach = bindDeviceInput(simulation as unknown as Simulation)
    world = createWorld('device-test', 1)
    // A fresh input struct each time, so one test cannot leak into the next.
    Object.assign(world.input, createInputState())
  })

  afterEach(() => {
    detach()
    useGameStore.setState({ screen: 'Title' })
  })

  /** One fixed step: sample the devices, then condition and derive edges. */
  const step = (): void => {
    simulation.sampleInput?.(world)
    stepInput(world)
  }

  it('holds a steering key for as long as it is down', () => {
    press('ArrowLeft')
    step()
    expect(world.input.steerX).toBeLessThan(0)

    release('ArrowLeft')
    step()
    expect(world.input.steerX).toBe(0)
  })

  it('delivers a weapon switch that begins and ends between two steps', () => {
    // No step runs while the key is down — the exact case that made the control
    // feel dead on a frame hitch, and the reason presses are latched.
    press('KeyQ')
    release('KeyQ')

    step()
    expect(world.input.switchWeapon, 'the latched press reads as held for one step').toBe(true)
    expect(world.input.switchWeaponPressed).toBe(true)

    step()
    expect(world.input.switchWeapon, 'and for exactly one step').toBe(false)
    expect(world.input.switchWeaponPressed).toBe(false)
  })

  it('yields one press edge however many steps the key is held for', () => {
    press('KeyC')
    let edges = 0
    for (let i = 0; i < 40; i++) {
      step()
      if (world.input.engineCutPressed) edges++
    }
    expect(edges, 'a third of a second of holding is one act').toBe(1)

    release('KeyC')
    step()
    press('KeyC')
    step()
    expect(world.input.engineCutPressed, 'and a second press is a second act').toBe(true)
  })

  it('latches the bomb and the flare too', () => {
    press('KeyV')
    release('KeyV')
    press('KeyX')
    release('KeyX')
    step()
    expect(world.input.bombPressed).toBe(true)
    expect(world.input.flarePressed).toBe(true)
  })

  it('ignores gameplay keys outside a run', () => {
    useGameStore.setState({ screen: 'Title' })
    press('KeyQ')
    release('KeyQ')
    step()
    expect(world.input.switchWeaponPressed).toBe(false)
  })

  it('drops everything held when the window loses focus', () => {
    press('ArrowRight')
    step()
    expect(world.input.steerX).toBeGreaterThan(0)

    window.dispatchEvent(new Event('blur'))
    step()
    expect(world.input.steerX, 'a key released off-screen must not stay held').toBe(0)
  })
})
