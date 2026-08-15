/**
 * Flight — forces, integration, attitude and terrain (gameplan §20–22).
 *
 * Build order inside a step, and it matters: tangent frame → steering →
 * gravity/drag/thrust → altitude PD → integrate → terrain → bank.
 *
 * Everything here is scaled by the fixed `dt` handed in by the Loop. Nothing
 * reads a clock and nothing counts frames (Rule 5) — which is the whole fix for
 * V1, where `speed += ACCELERATION` and `frameCount % ENEMY_SPAWN_RATE` made a
 * 144 Hz display run the game 2.4× faster than 60 Hz.
 */
import type { World } from '../core/World.ts'
import { type Vec3, addScaled, copy, create, cross, dot, length, normalize, scale, zero } from '../math/vec3.ts'
import { orthonormalize } from '../physics/tangentFrame.ts'
import { applyGravity } from '../physics/gravity.ts'
import { applyDrag } from '../physics/drag.ts'
import { integrate } from '../physics/integrate.ts'
import { clamp, damp, pdAcceleration } from '../physics/springs.ts'
import { resolveTerrain } from '../physics/collision/response.ts'
import { destroyIfHullGone } from './CollisionSystem.ts'
import { GameEvent } from '../core/World.ts'
import {
  ALT_COMMAND_RATE,
  ALT_CRASH,
  ALT_MAX,
  ALT_MIN,
  ATTITUDE_OMEGA,
  BANK_GAIN,
  BANK_MAX,
  BOOST_DURATION,
  BOOST_RECHARGE,
  CONTROL_DRIFT_RATE,
  CRAFT_MASS,
  F_BOOST,
  F_CRUISE,
  F_STRAFE,
  G,
  K_DRAG,
  K_D_ALT,
  K_P_ALT,
  PITCH_FROM_CLIMB,
  R,
  SLIP_CRAB,
  SLIP_ROLL,
  SYSTEM_FAULT_THRESHOLD,
  TRAUMA_DECAY,
  TURN_RATE,
  V_CRUISE,
} from '../data/constants.ts'

/* Module-scoped scratch. Reused every step; the flight path allocates nothing. */
const acceleration: Vec3 = create()
const scratch: Vec3 = create()
const angularVelocity: Vec3 = create()

/** Maximum nose elevation off the tangent plane — allowing up to 75° steep dive targeting. */
const PITCH_LIMIT = (75 * Math.PI) / 180

/**
 * Advances the craft by one fixed step.
 * @hot-path
 */
export function stepFlight(world: World, dt: number): void {
  const craft = world.craft

  copy(craft.previousPosition, craft.position)
  copy(craft.previousForward, craft.frame.forward)

  // §20.1 — rebuild the basis from scratch every step. Float drift over
  // thousands of steps skews it visibly within about a minute.
  orthonormalize(craft.frame, craft.position)

  if (!craft.alive) {
    decayTrauma(craft, dt)
    return
  }

  // Engine Cut / Momentum Drift. Driven by the press *edge*: the held flag is
  // true on every step of the press, and toggling on it flipped the engine 120
  // times a second for as long as the key was down.
  if (world.input.engineCutPressed) {
    craft.engineCut = !craft.engineCut
    world.events.emit(GameEvent.EngineCutToggled, craft.engineCut ? 1 : 0, 0, craft.position.x, craft.position.y, craft.position.z)
  }

  // Boost reignites the engine, and only boost.
  //
  // This used to reignite on `throttle > 0.4` as well, which meant it never
  // stayed cut for a single step: **neutral throttle is 1.0**. The craft holds
  // cruise with no key held (every deadline in the game is derived from that
  // terminal velocity), so the reignite condition was true on the very next step
  // of every cut. The control was bound, documented, audible, drawn on the HUD —
  // and impossible to use. Boost is an explicit act, which is what a reignite
  // should require; the toggle is the other way back.
  if (craft.engineCut && world.input.boosting) {
    craft.engineCut = false
    world.events.emit(GameEvent.EngineCutToggled, 0, 0, craft.position.x, craft.position.y, craft.position.z)
  }

  applySteering(world, dt)
  updateBoost(world, dt)
  updateAltitudeCommand(world, dt)

  // ---- forces ----
  zero(acceleration)

  // §22.2 — radial gravity. "Down" points at the centre and differs everywhere.
  applyGravity(acceleration, craft.frame.up, G * world.environment.gravity)

  if (!craft.engineCut) {
    // Thrust acts along the *flight* heading, not the nose: altitude is the PD
    // controller's job (§22.4), and letting thrust fight it would make altitude a
    // wrestling match instead of a command.
    const boosting = craft.boostActive
    // §7.6 — a damaged engine is down on thrust, and below the fault threshold
    // it surges: the sine is deterministic (a function of simulated time, never
    // a clock or a random) so a replay reproduces the same stutter.
    let engineFactor = 0.55 + 0.45 * craft.systems.engine
    if (craft.systems.engine < SYSTEM_FAULT_THRESHOLD) {
      const misfire = Math.sin(world.time * 9.3) * Math.sin(world.time * 3.1)
      engineFactor *= misfire > 0.55 ? 0.35 : 1
    }
    const thrust =
      (boosting ? F_BOOST : F_CRUISE) * world.loadout.thrust * craft.throttle * engineFactor
    addScaled(acceleration, craft.frame.forward, thrust / CRAFT_MASS)

    // §8.1 — lateral translation. Thrust along r̂, which lies in the tangent plane
    // by construction, so a slide stays on the shell without a projection step.
    const strafe = clamp(world.input.strafe, -1, 1)
    if (strafe !== 0) {
      addScaled(acceleration, craft.frame.right, (F_STRAFE * strafe * world.loadout.thrust) / CRAFT_MASS)
    }

    // §22.3 — quadratic drag. Terminal velocity √(F/k) emerges rather than being clamped.
    applyDrag(acceleration, craft.velocity, K_DRAG * world.loadout.drag * world.environment.drag)

    // §22.4 — critically damped altitude hold.
    const altitude = length(craft.position) - R
    const altitudeRate = dot(craft.velocity, craft.frame.up)
    const command = pdAcceleration(
      craft.altitudeTarget - altitude,
      altitudeRate,
      K_P_ALT * world.loadout.altitudeStiffness,
      K_D_ALT * Math.sqrt(world.loadout.altitudeStiffness),
    )
    addScaled(acceleration, craft.frame.up, command)
  }

  // §18.3 — semi-implicit Euler: velocity first, then position from the NEW
  // velocity. The order is what makes it symplectic.
  integrate(craft.position, craft.velocity, acceleration, dt)

  // §22.6 — terrain. Only the radial component of velocity is removed, so a
  // graze costs little and flying straight in hurts.
  const impact = resolveTerrain(craft.position, craft.velocity, R + ALT_CRASH)
  if (impact.hit && impact.impactSpeed > 4) {
    const damage = Math.min(45, impact.impactSpeed * 0.9)
    craft.hull -= damage
    craft.trauma = clamp(craft.trauma + damage / 60, 0, 1)
    world.wave.damageTakenThisWave += damage
    world.events.emit(GameEvent.TerrainImpact, 0, damage, craft.position.x, craft.position.y, craft.position.z)
    // The ground can kill you, and for a long time it could not: this line was
    // missing, so a hard enough crash left the player at zero hull and still
    // flying. See `destroyIfHullGone`.
    destroyIfHullGone(world)
  }

  // Re-derive the basis at the final position so the frame the renderer and the
  // Threat Ring read is the one that matches this step's position exactly.
  orthonormalize(craft.frame, craft.position)
  updateSlip(world)
  updateNose(craft.nose, craft.frame.forward, craft.frame.right, craft.frame.up, craft.pitch, craft.slip)
  updateBank(world, dt)
  decayTrauma(craft, dt)
}

/**
 * Lateral velocity as a fraction of cruise — **measured, not commanded**.
 *
 * The renderer turns this into a roll into the slide and a few degrees of crab
 * against it, which is the entire reason a translation reads as a translation
 * rather than as the camera drifting for no reason.
 *
 * Measuring rather than reading `input.strafe` is the same decision `updateBank`
 * makes and for the same reason: an impact that shoves the craft sideways should
 * look like an impact that shoved the craft sideways. Taking it from the key
 * would leave the craft perfectly level while it is visibly sliding.
 * @hot-path
 */
function updateSlip(world: World): void {
  const craft = world.craft
  craft.slip = clamp(dot(craft.velocity, craft.frame.right) / V_CRUISE, -1, 1)
}

/**
 * Turns steering input into a heading change.
 *
 * The heading is rotated about local up rather than integrated as a quaternion:
 * on a sphere the flight direction is a tangent-plane quantity by definition,
 * and rotating within that plane keeps it there without a re-projection step.
 * @hot-path
 */
function applySteering(world: World, dt: number): void {
  const craft = world.craft
  const input = world.input

  // §22.5 — attitude uses a much stiffer spring than altitude, because steering
  // must feel immediate (§8.5's <50 ms requirement) while altitude feels heavy.
  //
  // §7.6 — a damaged stabiliser costs turn authority *and* adds a constant pull
  // to one side. The pull is the interesting half: it is a fault the player can
  // hold against with the stick, so a wounded craft is flyable but demanding,
  // which is what damage should feel like.
  const control = craft.systems.control
  const authority = 0.5 + 0.5 * control
  const drift = (1 - control) * CONTROL_DRIFT_RATE * craft.driftBias
  const desiredYawRate =
    clamp(input.steerX, -1, 1) * TURN_RATE * world.loadout.turnRate * authority + drift
  craft.yawRate = damp(craft.yawRate, desiredYawRate, ATTITUDE_OMEGA * world.loadout.attitudeStiffness, dt)

  const yaw = craft.yawRate * dt
  if (yaw !== 0) {
    // Rotate forward about up by `yaw`, in the tangent plane.
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)
    const fx = craft.frame.forward.x
    const fy = craft.frame.forward.y
    const fz = craft.frame.forward.z
    const rx = craft.frame.right.x
    const ry = craft.frame.right.y
    const rz = craft.frame.right.z
    craft.frame.forward.x = fx * cos + rx * sin
    craft.frame.forward.y = fy * cos + ry * sin
    craft.frame.forward.z = fz * cos + rz * sin
    normalize(craft.frame.forward)
    cross(craft.frame.right, craft.frame.forward, craft.frame.up)
    normalize(craft.frame.right)
  }

  // `input.roll` is deliberately not read here.
  //
  // It used to write `craft.bank` directly, and `updateBank` — called later in
  // the same step — overwrote that value from the craft's *measured* angular
  // velocity (§20.4). The assignment was dead on arrival, so the roll keys were
  // bound, listed in Settings, and had no effect on anything. Bank is a
  // consequence of turning, not an input; the keys now steer instead, and the
  // bank they produce falls out of the physics as it should.

  // Two things pitch the nose, and only one of them is aiming.
  //
  // Mouse Y aims. It does not command altitude — the climb keys do (§8.1). But a
  // player who climbs on the keyboard was previously given *no* visual response
  // at all: the craft ascended perfectly level, which reads as an elevator
  // rather than as flight, and left them unsure the key had registered.
  //
  // The second term is measured climb rate, so it is right whether the altitude
  // changed because the player asked or because the PD controller is recovering
  // from a dive.
  const climbRate = dot(craft.velocity, craft.frame.up) / ALT_COMMAND_RATE
  const target =
    clamp(-input.steerY, -1, 1) * PITCH_LIMIT + clamp(climbRate, -1, 1) * PITCH_FROM_CLIMB
  craft.pitch = damp(
    craft.pitch,
    clamp(target, -PITCH_LIMIT, PITCH_LIMIT),
    ATTITUDE_OMEGA * world.loadout.attitudeStiffness,
    dt,
  )
}

/**
 * Nose direction: the flight heading, elevated by `pitch` and crabbed by `slip`.
 *
 * The crab term is what separates translating from turning on screen. During a
 * slide the nose swings a few degrees *against* the drift — the aircraft is
 * moving one way and pointing slightly another — while `frame.forward`, the
 * actual heading the simulation flies and shoots along, does not move at all.
 * That is the honest reading of the physics: strafing changes where you are, not
 * where you are aimed.
 *
 * Deliberately small. Past about ten degrees it stops reading as a crab and
 * starts reading as the craft having turned, which would make the two verbs
 * look like one.
 * @hot-path
 */
function updateNose(
  out: Vec3,
  forward: Readonly<Vec3>,
  right: Readonly<Vec3>,
  up: Readonly<Vec3>,
  pitch: number,
  slip: number,
): void {
  const cos = Math.cos(pitch)
  const sin = Math.sin(pitch)
  const crab = -SLIP_CRAB * slip
  const crabCos = Math.cos(crab)
  const crabSin = Math.sin(crab)

  // Heading rotated by `crab` within the tangent plane, then elevated by pitch.
  const fx = forward.x * crabCos + right.x * crabSin
  const fy = forward.y * crabCos + right.y * crabSin
  const fz = forward.z * crabCos + right.z * crabSin

  out.x = fx * cos + up.x * sin
  out.y = fy * cos + up.y * sin
  out.z = fz * cos + up.z * sin
  normalize(out)
}

/**
 * Bank derived from *actual* angular velocity (§20.4):
 *
 *   ω    = (f̂_now × f̂_prev) / Δt
 *   bank = clamp(−k · (ω · û), ±60°)
 *
 * V1 faked this with `rotation.z = -turnRate * 22`, tying the visual to an
 * input. Deriving it from measured rotation means the bank stays correct during
 * collisions, boosts and any external force — the visual is *caused by* the
 * physics rather than correlated with a button.
 * @hot-path
 */
function updateBank(world: World, dt: number): void {
  const craft = world.craft
  cross(angularVelocity, craft.frame.forward, craft.previousForward)
  if (dt > 0) {
    scale(angularVelocity, angularVelocity, 1 / dt)
  }
  const yawComponent = dot(angularVelocity, craft.frame.up)

  // Two contributions, both measured: bank from the turn, and a roll into a
  // lateral slide. They add rather than override, so strafing *through* a turn
  // rolls further than either alone — which is what the manoeuvre looks like.
  const fromTurn = -BANK_GAIN * yawComponent
  const fromSlip = SLIP_ROLL * craft.slip
  const target = clamp(fromTurn + fromSlip, -BANK_MAX, BANK_MAX)
  craft.bank = damp(craft.bank, target, 8, dt)
}

/** §7.4 — 3 s of boost, 6 s to recharge. The tool that makes a far outpost reachable. */
function updateBoost(world: World, dt: number): void {
  const craft = world.craft
  const wants = world.input.boosting

  if (world.difficulty.infiniteBoost) {
    craft.boostActive = wants
    craft.boostCharge = 1
    return
  }

  if (craft.boostActive) {
    craft.boostRemaining -= dt
    if (craft.boostRemaining <= 0 || !wants) {
      craft.boostActive = false
      craft.boostRemaining = 0
    }
  } else if (wants && craft.boostCharge >= 1) {
    craft.boostActive = true
    craft.boostRemaining = BOOST_DURATION * world.loadout.boostDuration
    craft.boostCharge = 0
    world.events.emit(GameEvent.BoostEngaged, 0, 0, craft.position.x, craft.position.y, craft.position.z)
  }

  if (!craft.boostActive && craft.boostCharge < 1) {
    // Thermal Afterburner Nova (perk) — "+100% faster", i.e. half the wait.
    const rate = world.activePerks.includes('plasma_afterburner') ? 2 : 1
    craft.boostCharge = Math.min(
      1,
      craft.boostCharge + (dt * rate) / (BOOST_RECHARGE * world.loadout.boostRecharge),
    )
  }
}

/**
 * Space/Ctrl move the commanded altitude; the PD controller flies to it.
 * Clamped to the playable shell (§7.1). The ceiling is soft — thrust does not
 * cut out abruptly, the command simply stops rising.
 */
function updateAltitudeCommand(world: World, dt: number): void {
  const craft = world.craft
  if (world.input.climb !== 0) {
    craft.altitudeTarget = clamp(
      craft.altitudeTarget + clamp(world.input.climb, -1, 1) * ALT_COMMAND_RATE * dt,
      ALT_MIN,
      ALT_MAX,
    )
  }
  craft.throttle = clamp(world.input.throttle, 0, 1)
}

/**
 * §24.3 — trauma decays exponentially, and the camera squares it, so light hits
 * barely register while heavy ones are dramatic. Decay is the analytic form, so
 * it is identical at any timestep.
 * @hot-path
 */
function decayTrauma(craft: World['craft'], dt: number): void {
  if (craft.trauma > 0) {
    craft.trauma = craft.trauma * Math.exp(-TRAUMA_DECAY * dt)
    if (craft.trauma < 1e-4) craft.trauma = 0
  }
}

/** Current altitude above the surface. Used by the HUD and the AI. */
export function craftAltitude(world: Readonly<World>): number {
  return length(world.craft.position) - R
}

/** ḣ = v · û (§21.3) — feeds the altitude ladder's trend arrow. */
export function craftAltitudeRate(world: Readonly<World>): number {
  return dot(world.craft.velocity, world.craft.frame.up)
}

/** Bearing of a world point, reused by several systems without allocating. */
export function scratchVector(): Vec3 {
  return scratch
}
