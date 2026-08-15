/**
 * Lateral translation (§8.1, §22.3).
 *
 * The axis exists because flight had exactly one way to avoid something: turn.
 * Turning costs heading, heading is what you spend to reach an outpost, so every
 * dodge was paid for in the currency the whole game is about.
 *
 * Which makes the load-bearing property not "strafing moves you sideways" but
 * **"strafing does not change where you are pointing"**. If heading drifts during
 * a slide, the second verb collapses back into the first and the axis is
 * pointless. That is the first test here and the reason for all the others.
 */
import { describe, expect, it } from 'vitest'

import { Simulation } from '@/game/core/Simulation'
import { dot, length, sub, create } from '@/game/math/vec3'
import {
  F_STRAFE,
  F_CRUISE,
  FIXED_DT,
  K_DRAG,
  V_CRUISE,
} from '@/game/data/constants'

/**
 * Runs the world for `seconds` under a scripted pilot.
 *
 * Every axis is zeroed before the caller's hold runs, because that is what the
 * real adapter does — `sampleInput` writes *every* field on every step. A
 * harness that only sets the axes it cares about leaves the others latched at
 * whatever the previous phase left them, and then a test for "the slide stops
 * when you let go" quietly never lets go.
 */
function fly(
  sim: Simulation,
  seconds: number,
  hold: (world: Simulation['world']) => void,
  onStep?: (world: Simulation['world']) => void,
): void {
  sim.sampleInput = (world) => {
    world.input.steerX = 0
    world.input.steerY = 0
    world.input.strafe = 0
    world.input.climb = 0
    world.input.throttle = 1
    world.input.firing = false
    world.input.locking = false
    world.input.boosting = false
    hold(world)
  }
  for (let i = 0; i < Math.round(seconds * 120); i++) {
    sim.advance(FIXED_DT)
    sim.world.events.clear()
    onStep?.(sim.world)
  }
  sim.sampleInput = null
}

function settled(seed: string, strafe: number, seconds = 8): Simulation {
  const sim = new Simulation(seed)
  sim.startRun()
  sim.skipBriefing()
  fly(sim, seconds, (world) => { world.input.strafe = strafe })
  return sim
}

describe('a slide is not a turn', () => {
  it('leaves the heading where it was', () => {
    // The whole point of the axis, in one assertion.
    const sim = new Simulation('STRAFE-HEADING')
    sim.startRun()
    sim.skipBriefing()
    fly(sim, 2, () => {})

    const before = { ...sim.world.craft.frame.forward }
    fly(sim, 3, (world) => { world.input.strafe = 1 })
    const after = sim.world.craft.frame.forward

    // The frame is re-orthonormalised as the craft moves over the sphere, so the
    // heading rotates with position even in perfectly straight flight. What must
    // not happen is a *yaw* — a rotation about local up, which is what turning
    // is. Compared against a control run that flew the same time without input.
    const control = new Simulation('STRAFE-HEADING')
    control.startRun()
    control.skipBriefing()
    fly(control, 5, () => {})

    const yawStrafe = dot(after, control.world.craft.frame.right)
    expect(Math.abs(yawStrafe), 'sliding must not yaw the craft').toBeLessThan(0.08)
    expect(before).toBeDefined()
  })

  it('does move the craft off the line it would otherwise have flown', () => {
    const straight = settled('STRAFE-OFFSET', 0, 5)
    const sliding = settled('STRAFE-OFFSET', 1, 5)

    const offset = create()
    sub(offset, sliding.world.craft.position, straight.world.craft.position)
    expect(length(offset), 'a held slide must actually go somewhere').toBeGreaterThan(15)
  })
})

describe('lateral speed is bounded by drag, not by a clamp', () => {
  it('settles at the terminal velocity the thrust implies', () => {
    // v = √(F/k) on each axis independently, because drag acts on the whole
    // velocity vector. Asserted against the formula rather than a transcribed
    // number, so retuning `F_STRAFE` moves the expectation with it.
    const sim = settled('STRAFE-TERMINAL', 1, 10)
    const craft = sim.world.craft
    const lateral = dot(craft.velocity, craft.frame.right)
    const expected = Math.sqrt(F_STRAFE / K_DRAG)

    // Combined thrust means neither axis reaches its solo terminal velocity —
    // drag is quadratic in *total* speed. The claim is that it lands in the
    // right neighbourhood, not that the axes are independent, which they are not.
    expect(lateral).toBeGreaterThan(expected * 0.45)
    expect(lateral).toBeLessThan(expected * 1.05)
  })

  it('stays well below cruise, so sliding never becomes the way to travel', () => {
    // If lateral speed approached cruise, the fastest route across the moon
    // would be sideways, and the flight model would have a dominant strategy
    // that looks like a bug.
    expect(Math.sqrt(F_STRAFE / K_DRAG)).toBeLessThan(V_CRUISE * 0.75)
    expect(F_STRAFE).toBeLessThan(F_CRUISE)
  })

  it('decays on release through drag alone', () => {
    const sim = settled('STRAFE-DECAY', 1, 8)
    const during = Math.abs(dot(sim.world.craft.velocity, sim.world.craft.frame.right))
    expect(during).toBeGreaterThan(4)

    fly(sim, 3, () => {})
    const after = Math.abs(dot(sim.world.craft.velocity, sim.world.craft.frame.right))
    expect(after, 'releasing must bleed off without an explicit damper').toBeLessThan(during * 0.4)
  })

  it('is symmetric', () => {
    const left = settled('STRAFE-SYM', -1, 8)
    const right = settled('STRAFE-SYM', 1, 8)
    const l = dot(left.world.craft.velocity, left.world.craft.frame.right)
    const r = dot(right.world.craft.velocity, right.world.craft.frame.right)
    expect(l).toBeLessThan(0)
    expect(r).toBeGreaterThan(0)
    expect(Math.abs(Math.abs(l) - Math.abs(r))).toBeLessThan(1.5)
  })
})

describe('slip is measured, so the animation cannot lie', () => {
  it('tracks lateral velocity rather than the key', () => {
    const sim = settled('SLIP-MEASURED', 1, 8)
    const craft = sim.world.craft
    const expected = dot(craft.velocity, craft.frame.right) / V_CRUISE
    expect(craft.slip).toBeCloseTo(expected, 4)
  })

  it('is non-zero after an impulse the player never asked for', () => {
    // Derived from the key, this would read zero while the craft was visibly
    // sliding — the craft would look level in the middle of being shoved. Bank
    // has been derived from measurement since §20.4 for exactly this reason.
    const sim = new Simulation('SLIP-IMPULSE')
    sim.startRun()
    sim.skipBriefing()
    fly(sim, 2, () => {})

    const craft = sim.world.craft
    craft.velocity.x += craft.frame.right.x * 12
    craft.velocity.y += craft.frame.right.y * 12
    craft.velocity.z += craft.frame.right.z * 12
    fly(sim, FIXED_DT * 2, () => {})

    expect(Math.abs(craft.slip), 'an unrequested slide still shows as slip').toBeGreaterThan(0.1)
  })

  it('stays inside the range the renderer assumes', () => {
    const sim = settled('SLIP-RANGE', 1, 12)
    expect(sim.world.craft.slip).toBeGreaterThanOrEqual(-1)
    expect(sim.world.craft.slip).toBeLessThanOrEqual(1)
  })
})

describe('climbing pitches the nose', () => {
  /**
   * The extreme pitch reached *during* a manoeuvre, not the pitch at the end.
   *
   * The altitude command is clamped to the playable shell, so a sustained dive
   * from cruise hits `ALT_MIN` in about a second and levels off — vertical
   * velocity returns to zero and so does the pitch cue, correctly. Sampling only
   * the final frame would therefore measure the craft *after* it had finished
   * descending, and conclude that diving does nothing.
   */
  function extremePitch(seed: string, climb: number): { level: number; extreme: number } {
    const sim = new Simulation(seed)
    sim.startRun()
    sim.skipBriefing()
    fly(sim, 2, () => {})
    const level = sim.world.craft.pitch

    let extreme = level
    fly(
      sim,
      2.5,
      (world) => { world.input.climb = climb },
      (world) => {
        if (climb > 0 ? world.craft.pitch > extreme : world.craft.pitch < extreme) {
          extreme = world.craft.pitch
        }
      },
    )
    return { level, extreme }
  }

  it('raises it on a keyboard climb, with no mouse input at all', () => {
    // Pitch used to move only for mouse Y, so a player climbing on the keyboard
    // ascended perfectly level — which reads as an elevator, and leaves them
    // unsure the key registered.
    const { level, extreme } = extremePitch('PITCH-CLIMB', 1)
    expect(extreme).toBeGreaterThan(level + 0.08)
  })

  it('drops it on a dive', () => {
    const { level, extreme } = extremePitch('PITCH-DIVE', -1)
    expect(extreme).toBeLessThan(level - 0.08)
  })
})
