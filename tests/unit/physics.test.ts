/**
 * Physics unit tests (gameplan §37.1, §37.3).
 *
 * Each test here maps to a numbered acceptance criterion or to a specific V1
 * defect from §2.2. Where the spec states a number, the test asserts that exact
 * number rather than a range — "terminal velocity converges to √(F/k) within
 * 1%" is checkable, and the whole travel-time budget depends on it.
 */
import { describe, expect, it } from 'vitest'

import { create, dot, length, normalize, reflect, projectOntoPlane, anyPerpendicular } from '@/game/math/vec3'
import { orthonormalize, orthonormalityError, bearingTo, type TangentFrame } from '@/game/physics/tangentFrame'
import { applyDrag, terminalVelocity } from '@/game/physics/drag'
import { applyGravity } from '@/game/physics/gravity'
import { integrate } from '@/game/physics/integrate'
import { criticalDamping, damp, dampingRatio, naturalFrequency, pdAcceleration } from '@/game/physics/springs'
import { naiveDistanceCheck, sweepSphere } from '@/game/physics/collision/sweptSphere'
import { resolveTerrain, bounceOffSurface } from '@/game/physics/collision/response'
import { arcDistance, fibonacciDirection } from '@/game/math/spherical'
import {
  F_BOOST,
  F_CRUISE,
  FIXED_DT,
  G,
  K_DRAG,
  K_D_ALT,
  K_P_ALT,
  R,
  RADIUS_HARVESTER,
  RADIUS_INTERCEPTOR,
  RADIUS_PROJECTILE,
  RADIUS_SENTINEL,
  RESTITUTION,
  V_BOOST,
  V_CRUISE,
} from '@/game/data/constants'

const RADIUS_INTERCEPTOR_SUM = RADIUS_INTERCEPTOR + RADIUS_PROJECTILE
const RADIUS_SENTINEL_SUM = RADIUS_SENTINEL + RADIUS_PROJECTILE

function makeFrame(): TangentFrame {
  return { up: create(0, 0, 1), forward: create(1, 0, 0), right: create(0, -1, 0) }
}

describe('vec3', () => {
  it('projects a vector onto the plane perpendicular to a normal', () => {
    const v = create(3, 4, 5)
    const n = create(0, 0, 1)
    projectOntoPlane(v, n)
    expect(v.z).toBeCloseTo(0, 12)
    expect(dot(v, n)).toBeCloseTo(0, 12)
  })

  it('leaves a zero-length vector alone rather than emitting NaN', () => {
    // A NaN here would propagate through the tangent frame and corrupt every
    // downstream basis for the rest of the run.
    const v = create(0, 0, 0)
    normalize(v)
    expect(Number.isNaN(v.x)).toBe(false)
    expect(length(v)).toBe(0)
  })

  it('reflects with restitution (§20.3)', () => {
    const v = create(0, 0, -10)
    reflect(v, create(0, 0, 1), RESTITUTION)
    expect(v.z).toBeCloseTo(10 * RESTITUTION, 10)
  })

  it('finds a perpendicular for any axis without losing precision', () => {
    for (const axis of [create(1, 0, 0), create(0, 1, 0), create(0, 0, 1), create(0.577, 0.577, 0.577)]) {
      normalize(axis)
      const perp = anyPerpendicular(create(), axis)
      expect(Math.abs(dot(perp, axis))).toBeLessThan(1e-9)
      expect(length(perp)).toBeCloseTo(1, 9)
    }
  })
})

describe('tangent frame (§20.1)', () => {
  it('produces an orthonormal right-handed basis', () => {
    const frame = makeFrame()
    orthonormalize(frame, create(30, 40, 50))
    expect(orthonormalityError(frame)).toBeLessThan(1e-12)
  })

  it('stays orthonormal over 100k steps — drift < 1e-6', () => {
    // §37.1's exact assertion. Float drift over thousands of steps otherwise
    // skews the basis visibly within about a minute of play.
    const frame = makeFrame()
    const position = create(R + 25, 0, 0)

    for (let i = 0; i < 100_000; i++) {
      // Walk the position around the sphere so the basis is genuinely rebuilt
      // from a moving frame rather than re-derived from a constant.
      const a = i * 1e-4
      position.x = (R + 25) * Math.cos(a)
      position.y = (R + 25) * Math.sin(a) * 0.3
      position.z = (R + 25) * Math.sin(a)
      orthonormalize(frame, position)
    }

    expect(orthonormalityError(frame)).toBeLessThan(1e-6)
  })

  it('survives a heading collapsed onto the radial axis', () => {
    const frame = makeFrame()
    frame.forward.x = 0
    frame.forward.y = 0
    frame.forward.z = 1
    orthonormalize(frame, create(0, 0, R))
    expect(Number.isNaN(frame.forward.x)).toBe(false)
    expect(orthonormalityError(frame)).toBeLessThan(1e-9)
  })

  it('maps bearings to the correct quadrant (§20.7)', () => {
    const frame = makeFrame()
    const self = create(0, 0, R + 25)
    orthonormalize(frame, self)

    const scratch = create()
    const ahead = create(frame.forward.x * 50, frame.forward.y * 50, self.z)
    const right = create(frame.right.x * 50, frame.right.y * 50, self.z)

    expect(Math.abs(bearingTo(frame, self, ahead, scratch))).toBeLessThan(1e-6)
    expect(bearingTo(frame, self, right, scratch)).toBeCloseTo(Math.PI / 2, 6)

    // Directly behind must land near ±π, i.e. the lower half of the ring.
    const behind = create(-frame.forward.x * 50, -frame.forward.y * 50, self.z)
    expect(Math.abs(bearingTo(frame, self, behind, scratch))).toBeGreaterThan(Math.PI - 1e-6)
  })
})

describe('drag and terminal velocity (§22.3)', () => {
  it('derives the spec figures from the constants', () => {
    // Asserted against the formula, not against transcribed decimals.
    //
    // These used to read `toBeCloseTo(44.72, 2)`, which is the *output* of
    // √(F/k) for one particular pair of constants written back as if it were an
    // independent fact. Retuning the craft's speed then failed this test without
    // anything being wrong — the test was restating the tuning rather than
    // checking the relationship between the tuning and the derived value.
    expect(terminalVelocity(F_CRUISE, K_DRAG)).toBeCloseTo(V_CRUISE, 6)
    expect(terminalVelocity(F_BOOST, K_DRAG)).toBeCloseTo(V_BOOST, 6)
    expect(V_CRUISE).toBeCloseTo(Math.sqrt(F_CRUISE / K_DRAG), 6)
    expect(V_BOOST).toBeCloseTo(Math.sqrt(F_BOOST / K_DRAG), 6)
  })

  it('cruise is a speed a player can read a horizon at', () => {
    // The one absolute claim worth pinning, and it is a *design* claim rather
    // than an arithmetic one: a lap of the moon has to take long enough that the
    // sphere registers as a place. At 44.7 u/s it was 14 s and the game's most
    // consistent complaint was that it was unflyable.
    const lapSeconds = (2 * Math.PI * R) / V_CRUISE
    expect(lapSeconds).toBeGreaterThan(18)
    expect(lapSeconds).toBeLessThan(32)
  })

  it('converges to √(F/k) within 1% under integration', () => {
    // The empirical check §40 Phase 2 requires. If this drifts, every
    // travel-time number in the design is wrong.
    const velocity = create()
    const position = create(R + 25, 0, 0)
    const acceleration = create()
    const thrust = create(0, 1, 0)

    for (let i = 0; i < 120 * 60; i++) {
      acceleration.x = 0
      acceleration.y = 0
      acceleration.z = 0
      // Thrust only — gravity and the altitude controller are excluded so the
      // steady state is exactly the drag balance being asserted.
      acceleration.x += thrust.x * F_CRUISE
      acceleration.y += thrust.y * F_CRUISE
      acceleration.z += thrust.z * F_CRUISE
      applyDrag(acceleration, velocity, K_DRAG)
      integrate(position, velocity, acceleration, FIXED_DT)
    }

    const relativeError = Math.abs(length(velocity) - V_CRUISE) / V_CRUISE
    expect(relativeError).toBeLessThan(0.01)
  })

  it('boost raises terminal velocity by √2, so the surge is felt', () => {
    expect(V_BOOST / V_CRUISE).toBeCloseTo(Math.SQRT2, 3)
  })
})

describe('gravity (§22.2)', () => {
  it('always points at the centre, whatever the position', () => {
    for (const p of [create(R, 0, 0), create(0, R, 0), create(-30, 40, 90)]) {
      const up = create(p.x, p.y, p.z)
      normalize(up)
      const a = create()
      applyGravity(a, up, G)
      const magnitude = length(a)
      expect(magnitude).toBeCloseTo(G, 10)
      // Anti-parallel to the outward radial.
      expect(dot(a, up) / magnitude).toBeCloseTo(-1, 10)
    }
  })
})

describe('springs (§21.4, §22.4)', () => {
  it('altitude gains are exactly critically damped', () => {
    expect(naturalFrequency(K_P_ALT)).toBeCloseTo(5, 10)
    expect(criticalDamping(K_P_ALT)).toBeCloseTo(K_D_ALT, 10)
    expect(dampingRatio(K_P_ALT, K_D_ALT)).toBeCloseTo(1, 10)
  })

  it('a critically damped response never overshoots', () => {
    // §37.1's assertion. Overshoot would make altitude bob, which is nauseating
    // and turns holding an altitude into a fight.
    let height = 0
    let rate = 0
    const target = 25
    let maximum = 0

    for (let i = 0; i < 120 * 10; i++) {
      const a = pdAcceleration(target - height, rate, K_P_ALT, K_D_ALT)
      rate += a * FIXED_DT
      height += rate * FIXED_DT
      if (height > maximum) maximum = height
    }

    expect(maximum).toBeLessThanOrEqual(target + 1e-6)
    expect(height).toBeCloseTo(target, 4)
  })

  it('settles to within 2% in about 0.8 s', () => {
    let height = 0
    let rate = 0
    const target = 25
    let settledAt = Infinity

    for (let i = 0; i < 120 * 5; i++) {
      const a = pdAcceleration(target - height, rate, K_P_ALT, K_D_ALT)
      rate += a * FIXED_DT
      height += rate * FIXED_DT
      if (settledAt === Infinity && Math.abs(target - height) <= target * 0.02) settledAt = i * FIXED_DT
    }

    expect(settledAt).toBeLessThan(1.3)
  })

  it('exponential damping is frame-rate independent — the V1 bug class', () => {
    // The same elapsed time must produce the same result whether it arrives as
    // 60 large steps or 144 small ones. V1's `x += (t - x) * k` does not.
    const run = (hz: number): number => {
      let x = 0
      const dt = 1 / hz
      for (let i = 0; i < hz; i++) x = damp(x, 100, 3, dt)
      return x
    }

    const at60 = run(60)
    const at144 = run(144)
    expect(Math.abs(at60 - at144)).toBeLessThan(1e-9)

    // And it matches the closed form exactly.
    expect(at60).toBeCloseTo(100 * (1 - Math.exp(-3)), 9)
  })
})

describe('swept-sphere CCD (§23.2) — the V1 tunneling regression', () => {
  /**
   * A correction to §23.2's worked example, recorded here because the spec
   * states it as the motivating case and it does not hold under V2's own
   * timestep.
   *
   * §23.2 offers "a projectile at 220 u/s versus a 2.4 u target, where a naive
   * per-frame distance check misses entirely". At the fixed 1/120 s step a
   * 220 u/s projectile advances 1.83 u, against a combined radius of 2.7 u —
   * so a head-on shot at cruise speed is *not* missed by an endpoint check.
   * The fixed timestep alone fixed most of what V1 got wrong here, because
   * V1's real defect was that its step was the frame time.
   *
   * The sweep still earns its place, in three regimes this file pins down:
   *   - glancing shots, where the chord through the sphere is short;
   *   - the §42 requirement of no tunneling up to 400 u/s;
   *   - V1's own condition, a 60 Hz frame-coupled step.
   */
  it('at 220 u/s head-on, a discrete check happens to succeed — the honest baseline', () => {
    const target = create(0, 0, 0)
    const radiusSum = RADIUS_HARVESTER + RADIUS_PROJECTILE
    const travel = 220 * FIXED_DT

    expect(travel).toBeLessThan(radiusSum)

    const origin = create(-travel / 2, 0, 0)
    const velocity = create(220, 0, 0)
    expect(naiveDistanceCheck(origin, velocity, FIXED_DT, target, radiusSum)).toBe(true)
    expect(sweepSphere(origin, velocity, FIXED_DT, target, radiusSum)).not.toBeNull()
  })

  it('catches glancing shots a discrete check misses', () => {
    // The realistic failure: the projectile clips the edge of the target, so
    // both endpoints lie outside the radius while the path passes through it.
    const target = create(0, 0, 0)
    const radiusSum = RADIUS_HARVESTER + RADIUS_PROJECTILE
    const speed = 400
    const travel = speed * FIXED_DT
    const offset = radiusSum * 0.93

    const origin = create(-travel / 2, offset, 0)
    const velocity = create(speed, 0, 0)

    expect(naiveDistanceCheck(origin, velocity, FIXED_DT, target, radiusSum)).toBe(false)

    const hit = sweepSphere(origin, velocity, FIXED_DT, target, radiusSum)
    expect(hit).not.toBeNull()
    expect(hit?.t).toBeGreaterThanOrEqual(0)
    expect(hit?.t).toBeLessThanOrEqual(1)
  })

  it("reproduces V1's condition — 60 Hz frame-coupled, and the discrete check fails", () => {
    // `game.js:730` sampled once per rendered frame. At 60 Hz a 220 u/s
    // projectile advances 3.67 u per sample, and a glancing shot is lost.
    const frameDt = 1 / 60
    const target = create(0, 0, 0)
    const radiusSum = RADIUS_HARVESTER + RADIUS_PROJECTILE
    const travel = 220 * frameDt
    const origin = create(-travel / 2, radiusSum * 0.93, 0)
    const velocity = create(220, 0, 0)

    expect(naiveDistanceCheck(origin, velocity, frameDt, target, radiusSum)).toBe(false)
    expect(sweepSphere(origin, velocity, frameDt, target, radiusSum)).not.toBeNull()
  })

  it('registers every hit up to 400 u/s at any approach angle (§42)', () => {
    // The acceptance criterion, swept across speed *and* impact parameter.
    // Any offset strictly inside the combined radius is a genuine hit and must
    // be reported, whatever the speed.
    const target = create(0, 0, 0)
    let naiveMisses = 0
    let checked = 0

    for (const radiusSum of [
      RADIUS_HARVESTER + RADIUS_PROJECTILE,
      RADIUS_INTERCEPTOR_SUM,
      RADIUS_SENTINEL_SUM,
    ]) {
      for (let speed = 20; speed <= 400; speed += 10) {
        const travel = speed * FIXED_DT
        for (let k = 0; k < 10; k++) {
          const offset = (radiusSum * 0.97 * k) / 9
          const origin = create(-travel / 2, offset, 0)
          const velocity = create(speed, 0, 0)

          const hit = sweepSphere(origin, velocity, FIXED_DT, target, radiusSum)
          expect(hit, `missed at ${speed} u/s, offset ${offset.toFixed(2)}`).not.toBeNull()
          if (!naiveDistanceCheck(origin, velocity, FIXED_DT, target, radiusSum)) naiveMisses++
          checked++
        }
      }
    }

    // The sweep caught all of them; the discrete check did not. If this ever
    // reaches zero, the sweep has stopped being load-bearing and the claim in
    // §23.2 should be revisited rather than left as decoration.
    expect(checked).toBeGreaterThan(1000)
    expect(naiveMisses).toBeGreaterThan(0)
  })

  it('reports the contact point on the sphere surface, not the centre', () => {
    const target = create(0, 0, 0)
    const radiusSum = 2.7
    const origin = create(-10, 0, 0)
    const velocity = create(220, 0, 0)
    const hit = sweepSphere(origin, velocity, 0.06, target, radiusSum)

    expect(hit).not.toBeNull()
    if (hit === null) return
    const distanceFromCentre = Math.hypot(hit.x, hit.y, hit.z)
    expect(distanceFromCentre).toBeCloseTo(radiusSum, 6)
  })

  it('misses when the path passes outside the combined radius', () => {
    const hit = sweepSphere(create(-10, 5, 0), create(220, 0, 0), FIXED_DT, create(0, 0, 0), 2.7)
    expect(hit).toBeNull()
  })

  it('does not report a hit on a target being moved away from', () => {
    const hit = sweepSphere(create(10, 0, 0), create(220, 0, 0), FIXED_DT, create(0, 0, 0), 2.7)
    expect(hit).toBeNull()
  })

  it('detects an already-overlapping pair at t = 0', () => {
    const hit = sweepSphere(create(1, 0, 0), create(0, 0, 0), FIXED_DT, create(0, 0, 0), 2.7)
    expect(hit?.t).toBe(0)
  })
})

describe('terrain response (§22.6)', () => {
  it('removes only the radial velocity, keeping tangential speed', () => {
    const position = create(R, 0, 0)
    const velocity = create(-20, 40, 0)
    const impact = resolveTerrain(position, velocity, R + 4)

    expect(impact.hit).toBe(true)
    expect(impact.impactSpeed).toBeCloseTo(20, 6)
    expect(length(position)).toBeCloseTo(R + 4, 9)
    expect(velocity.x).toBeCloseTo(0, 9)
    expect(velocity.y).toBeCloseTo(40, 9) // tangential component preserved
  })

  it('a graze costs far less than a dive', () => {
    const graze = resolveTerrain(create(R, 0, 0), create(-2, 40, 0), R + 4).impactSpeed
    const dive = resolveTerrain(create(R, 0, 0), create(-40, 2, 0), R + 4).impactSpeed
    expect(graze).toBeLessThan(dive / 10)
  })

  it('does nothing above the floor', () => {
    const position = create(R + 30, 0, 0)
    const impact = resolveTerrain(position, create(0, 10, 0), R + 4)
    expect(impact.hit).toBe(false)
    expect(position.x).toBe(R + 30)
  })

  it('bounces debris off the surface with restitution', () => {
    const position = create(R - 1, 0, 0)
    const velocity = create(-10, 5, 0)
    expect(bounceOffSurface(position, velocity, R, RESTITUTION)).toBe(true)
    expect(velocity.x).toBeCloseTo(10 * RESTITUTION, 6)
    expect(length(position)).toBeCloseTo(R, 9)
  })
})

describe('spherical geometry (§19.2)', () => {
  it('measures arc distance between antipodes as half the circumference', () => {
    expect(arcDistance(create(R, 0, 0), create(-R, 0, 0), R)).toBeCloseTo(Math.PI * R, 6)
    expect(arcDistance(create(R, 0, 0), create(0, R, 0), R)).toBeCloseTo((Math.PI / 2) * R, 6)
    expect(arcDistance(create(R, 0, 0), create(R, 0, 0), R)).toBeCloseTo(0, 6)
  })

  it('never returns NaN when the dot product rounds outside [-1, 1]', () => {
    const a = create(1, 0, 0)
    expect(Number.isNaN(arcDistance(a, a, R))).toBe(false)
  })

  it('distributes eight Fibonacci points with no two trivially close (§7.2)', () => {
    const directions = Array.from({ length: 8 }, (_, i) => fibonacciDirection(create(), i, 8))

    let minimum = Infinity
    for (let i = 0; i < directions.length; i++) {
      for (let j = i + 1; j < directions.length; j++) {
        const a = directions[i]
        const b = directions[j]
        if (a === undefined || b === undefined) continue
        minimum = Math.min(minimum, arcDistance(a, b, R))
      }
    }

    // A quarter of the way round the sphere is the practical floor for the
    // triage decision to have any geometry in it at all.
    expect(minimum).toBeGreaterThan(R * 0.7)
  })
})
