/**
 * Interceptor — the pressure, and the one enemy you *beat* rather than survive
 * (gameplan §7.3).
 *
 * ## The dance
 *
 * It used to be a permanent tail-chase: it orbited, it shot, and the only
 * counterplay was to out-turn it or ignore it. That makes an Interceptor a
 * weather condition — something that happens to you — and a player who cannot
 * win an exchange stops trying to and just flies away. So it now runs a loop
 * with a hole in it:
 *
 *  1. **Stalk** — orbits an offset pursuit point, takes long-range pot shots.
 *  2. **Wind up** — `WINDUP_TIME` of lining up, not manoeuvring, and visibly
 *     glowing. This is the tell, and it is deliberately long enough to react to.
 *  3. **Dive** — commits to a straight line at `DIVE_SPEED_SCALE` its cruise,
 *     firing. **It cannot correct.** The line was chosen when the run began.
 *  4. **Exposed** — having blown past, it is slow, silent, and takes double
 *     damage for `EXPOSED_TIME`.
 *
 * The trick, therefore: *make it miss*. Brake, slide, or cut the engine as it
 * commits and it overshoots into the one window where it can be killed cheaply.
 * Flares during the wind-up abort the run outright. Standing still and trading
 * fire is the losing line, which is exactly the lesson the archetype should
 * teach.
 */
import { EnemyPhase, GameEvent, type World } from '../core/World.ts'
import { type Vec3, addScaled, copy, create, cross, dot, length, normalize, scale, sub } from '../math/vec3.ts'
import { predictAim, seek } from '../physics/steering.ts'
import { spawnProjectile } from './Projectile.ts'
import { INTERCEPTOR } from '../data/enemies.ts'
import {
  ALT_MAX,
  ALT_MIN,
  DIVE_SPEED_SCALE,
  DIVE_TIME,
  EXPOSED_TIME,
  R,
  RUN_COOLDOWN,
  RUN_TRIGGER_RANGE,
  WINDUP_TIME,
} from '../data/constants.ts'

const position: Vec3 = create()
const velocity: Vec3 = create()
const waypoint: Vec3 = create()
const aim: Vec3 = create()
const scratch: Vec3 = create()
const runAxis: Vec3 = create()

/**
 * How far off the player an Interceptor aims its pursuit point.
 *
 * Seeking the player's exact position produces a dead tail-chase that locks
 * both craft into the same line. Offsetting the pursuit target makes the
 * Interceptor arc across the player's path, which both reads as flying and
 * gives it firing solutions.
 */
const PURSUIT_OFFSET = 26

/** Burst discipline: three shots, then a longer pause. */
const BURST_SIZE = 3
const BURST_GAP = 0.16

/** @hot-path */
export function spawnInterceptor(world: World, slot: number, direction: Readonly<Vec3>, altitude: number): void {
  copy(position, direction)
  normalize(position)
  scale(position, position, R + altitude)

  const enemies = world.enemies
  enemies.body.spawnAt(slot, position.x, position.y, position.z)
  enemies.kind[slot] = INTERCEPTOR.kind
  enemies.phase[slot] = EnemyPhase.Pursuing
  enemies.hp[slot] = INTERCEPTOR.health
  enemies.target[slot] = -1
  // A random start on the run clock, so a flight of Interceptors does not
  // commit in unison — three simultaneous attack runs is not a harder version
  // of one, it is an unreadable one.
  enemies.timer[slot] = world.rng.range(RUN_COOLDOWN * 0.4, RUN_COOLDOWN)
  enemies.burst[slot] = 0
  enemies.phaseOffset[slot] = world.rng.range(0, Math.PI * 2)
  enemies.fireCooldown[slot] = INTERCEPTOR.fireInterval
  enemies.hasLanded[slot] = 0
  enemies.shieldAngle[slot] = 0
  enemies.headingX[slot] = 0
  enemies.headingY[slot] = 0
  enemies.headingZ[slot] = 0
}

/** @hot-path */
export function updateInterceptor(world: World, slot: number, dt: number): void {
  const enemies = world.enemies

  enemies.body.readPosition(slot, position)
  enemies.body.readVelocity(slot, velocity)

  const timer = (enemies.timer[slot] as number) - dt
  enemies.timer[slot] = timer

  switch (enemies.phase[slot]) {
    case EnemyPhase.Winding:
      windUp(world, slot, dt, timer)
      break
    case EnemyPhase.Diving:
      dive(world, slot, dt, timer)
      break
    case EnemyPhase.Exposed:
      recover(world, slot, dt, timer)
      break
    default:
      stalk(world, slot, dt, timer)
      break
  }

  clampToShell(position, velocity)
  enemies.body.writePosition(slot, position)
  enemies.body.writeVelocity(slot, velocity)

  const speed = length(velocity)
  if (speed > 0.5) {
    enemies.headingX[slot] = velocity.x / speed
    enemies.headingY[slot] = velocity.y / speed
    enemies.headingZ[slot] = velocity.z / speed
  }
}

/**
 * Orbiting an offset pursuit point, sniping, waiting for the run clock.
 * @hot-path
 */
function stalk(world: World, slot: number, dt: number, timer: number): void {
  const enemies = world.enemies
  const craft = world.craft

  // Pursue a point offset laterally from the player rather than the player
  // itself, phased per enemy so a group fans out instead of stacking.
  const phase = (enemies.phaseOffset[slot] as number) + world.time * 0.6

  cross(scratch, craft.frame.forward, craft.frame.up)
  normalize(scratch)
  copy(waypoint, craft.position)
  addScaled(waypoint, scratch, Math.cos(phase) * PURSUIT_OFFSET)
  addScaled(waypoint, craft.frame.up, Math.sin(phase) * PURSUIT_OFFSET * 0.4)

  seek(velocity, position, waypoint, INTERCEPTOR.speed * world.difficulty.enemySpeed, 90, dt)
  addScaled(position, velocity, dt)

  updateFiring(world, slot, dt)

  // Close enough, and the clock is up: line up a run.
  sub(scratch, craft.position, position)
  if (timer <= 0 && craft.alive && length(scratch) < RUN_TRIGGER_RANGE) {
    enemies.phase[slot] = EnemyPhase.Winding
    enemies.timer[slot] = WINDUP_TIME
    world.events.emit(GameEvent.AttackRun, slot, 0, position.x, position.y, position.z)
  }
}

/**
 * The tell. Slows, holds station off the player's flank, and commits at zero.
 *
 * Flares abort it: the countermeasure is a real answer to a real threat rather
 * than a button that adds a number somewhere.
 * @hot-path
 */
function windUp(world: World, slot: number, dt: number, timer: number): void {
  const enemies = world.enemies
  const craft = world.craft

  if (craft.flareActiveTimer > 0 || !craft.alive) {
    abortRun(world, slot)
    return
  }

  // Drifts in slowly, which both reads as "taking aim" and keeps the run from
  // starting from so far out that the player cannot see the tell.
  seek(velocity, position, craft.position, INTERCEPTOR.speed * 0.45 * world.difficulty.enemySpeed, 70, dt)
  addScaled(position, velocity, dt)

  if (timer > 0) return

  // Commit. The line is chosen **now**, from where the player is **now**, and
  // is never revised — that fixed line is what makes braking work.
  predictAim(waypoint, position, craft.position, craft.velocity, INTERCEPTOR.speed * DIVE_SPEED_SCALE)
  sub(runAxis, waypoint, position)
  if (length(runAxis) < 1e-3) copy(runAxis, craft.frame.forward)
  normalize(runAxis)

  scale(velocity, runAxis, INTERCEPTOR.speed * DIVE_SPEED_SCALE * world.difficulty.enemySpeed)
  enemies.headingX[slot] = runAxis.x
  enemies.headingY[slot] = runAxis.y
  enemies.headingZ[slot] = runAxis.z
  enemies.phase[slot] = EnemyPhase.Diving
  enemies.timer[slot] = DIVE_TIME
  enemies.burst[slot] = 0
  enemies.fireCooldown[slot] = 0.1
}

/**
 * Committed. Straight line, full speed, firing — and no steering at all.
 * @hot-path
 */
function dive(world: World, slot: number, dt: number, timer: number): void {
  const enemies = world.enemies

  // No `seek`. The velocity set at commit time is carried unchanged, which is
  // the entire mechanic: the player's job is to not be on that line any more.
  addScaled(position, velocity, dt)
  updateFiring(world, slot, dt)

  sub(scratch, world.craft.position, position)
  const range = length(scratch)
  // Ends when the run is spent, or the instant it is past the player — carrying
  // on after the merge would let it clip the player from behind, which reads as
  // the dodge not having worked.
  const closing = dot(scratch, velocity)
  if (timer <= 0 || (closing < 0 && range > 12)) {
    enemies.phase[slot] = EnemyPhase.Exposed
    enemies.timer[slot] = EXPOSED_TIME
    world.events.emit(GameEvent.Exposed, slot, 0, position.x, position.y, position.z)
  }
}

/**
 * Blown past: coasting, unarmed, and taking double damage until it recovers.
 * @hot-path
 */
function recover(world: World, slot: number, dt: number, timer: number): void {
  // Bleeds off the dive speed rather than stopping dead, so the window reads as
  // an overshoot the player caused instead of an enemy that was switched off.
  scale(velocity, velocity, Math.exp(-1.6 * dt))
  addScaled(position, velocity, dt)

  if (timer <= 0) abortRun(world, slot)
}

/** Back to stalking, with the run clock reset. @hot-path */
function abortRun(world: World, slot: number): void {
  const enemies = world.enemies
  enemies.phase[slot] = EnemyPhase.Pursuing
  enemies.timer[slot] = RUN_COOLDOWN
  enemies.fireCooldown[slot] = INTERCEPTOR.fireInterval
}

/** True while this enemy is in its post-run recovery, and takes bonus damage. */
export function isExposed(world: Readonly<World>, slot: number): boolean {
  return world.enemies.phase[slot] === EnemyPhase.Exposed
}

/**
 * Fires bursts with lead prediction, and only with a reasonable firing
 * solution — an Interceptor that sprays from 300 u away trains the player to
 * ignore incoming fire, which makes the fire pointless.
 * @hot-path
 */
function updateFiring(world: World, slot: number, dt: number): void {
  if (!world.craft.alive) return

  const enemies = world.enemies
  const cooldown = (enemies.fireCooldown[slot] as number) - dt
  enemies.fireCooldown[slot] = cooldown
  if (cooldown > 0) return

  // EMP Burst Countermeasures (perk): a flare shuts its guns down outright
  // rather than merely spoiling its aim.
  if (world.craft.empTimer > 0) {
    enemies.fireCooldown[slot] = 0.5
    return
  }

  sub(scratch, world.craft.position, position)
  const range = length(scratch)
  if (range > 150) {
    enemies.fireCooldown[slot] = 0.4
    return
  }

  // Ghost ECM (perk): tracking degrades badly, and a craft running silent on
  // momentum cannot be shot at all.
  const ghost = world.activePerks.includes('ghost_ecm')
  if (ghost && world.craft.engineCut) {
    enemies.fireCooldown[slot] = 0.5
    return
  }

  // If the player deployed flares, aim is scrambled and deflected
  if (world.craft.flareActiveTimer > 0) {
    predictAim(aim, position, world.craft.position, world.craft.velocity, INTERCEPTOR.projectileSpeed)
    sub(aim, aim, position)
    normalize(aim)
    aim.x += world.rng.range(-0.35, 0.35)
    aim.y += world.rng.range(-0.35, 0.35)
    aim.z += world.rng.range(-0.35, 0.35)
    normalize(aim)
  } else {
    // Evasion dynamics: when player is boosting or making hard turns, lead accuracy has realistic dispersion
    predictAim(aim, position, world.craft.position, world.craft.velocity, INTERCEPTOR.projectileSpeed)
    sub(aim, aim, position)
    normalize(aim)

    // Dispersion from the target's own manoeuvring, plus the ECM penalty.
    let dispersion = 0
    if (world.craft.boostActive) dispersion += 0.08
    else if (Math.abs(world.craft.yawRate) > 0.4) dispersion += 0.04
    if (ghost) dispersion += 0.09
    if (dispersion > 0) {
      aim.x += world.rng.range(-dispersion, dispersion)
      aim.y += world.rng.range(-dispersion, dispersion)
      aim.z += world.rng.range(-dispersion, dispersion)
      normalize(aim)
    }
  }

  const projectile = spawnProjectile(
    world.enemyProjectiles,
    position,
    aim,
    INTERCEPTOR.projectileSpeed,
    3.0,
    INTERCEPTOR.damage,
  )

  if (projectile >= 0) {
    world.events.emit(GameEvent.ShotFired, -1, 0, position.x, position.y, position.z)
  }

  // The burst counter lives in its own array. It shared `timer` with the phase
  // clock and the pursuit offset, and truncating that float to an integer on
  // every shot quietly reset the fan-out pattern three times a burst.
  const fired = ((enemies.burst[slot] as number) + 1) % BURST_SIZE
  enemies.burst[slot] = fired
  enemies.fireCooldown[slot] = fired === 0 ? INTERCEPTOR.fireInterval : BURST_GAP
}

/**
 * Keeps a powered enemy inside the playable shell. They have no altitude
 * controller of their own, and an Interceptor that dives into the regolith
 * chasing a low-flying player looks broken rather than aggressive.
 * @hot-path
 */
export function clampToShell(p: Vec3, v: Vec3): void {
  const radius = length(p)
  const floor = R + ALT_MIN * 0.5
  const ceiling = R + ALT_MAX

  if (radius < floor || radius > ceiling) {
    const target = radius < floor ? floor : ceiling
    normalize(p)
    // Remove the radial velocity component before rescaling, so the enemy
    // slides along the shell instead of bouncing off it.
    const radial = p.x * v.x + p.y * v.y + p.z * v.z
    v.x -= p.x * radial
    v.y -= p.y * radial
    v.z -= p.z * radial
    scale(p, p, target)
  }
}
