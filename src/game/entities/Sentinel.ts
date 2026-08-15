/**
 * Sentinel — the wall (gameplan §7.3).
 *
 * Parks in orbit over an outpost behind a directional shield plate that blocks
 * fire from its front arc, and rotates slowly. Six hits to the body; the shield
 * is immune.
 *
 * Its role is to convert a *time* problem into a *positioning* problem. You
 * cannot shoot through it, so you fly around it — and flying around costs
 * seconds, which is the scarce resource the whole game is denominated in.
 * Introduced at Wave 6, after triage itself is understood.
 */
import { EnemyPhase, GameEvent, type World } from '../core/World.ts'
import { type Vec3, addScaled, copy, create, cross, dot, length, normalize, scale, sub } from '../math/vec3.ts'
import { arrive, predictAim } from '../physics/steering.ts'
import { spawnProjectile } from './Projectile.ts'
import { SENTINEL, SENTINEL_SHIELD_HALF_ANGLE, SENTINEL_SHIELD_RATE } from '../data/enemies.ts'
import { R } from '../data/constants.ts'

const position: Vec3 = create()
const velocity: Vec3 = create()
const station: Vec3 = create()
const aim: Vec3 = create()
const scratch: Vec3 = create()
const shieldNormal: Vec3 = create()
const tangentA: Vec3 = create()
const tangentB: Vec3 = create()

/** Orbit altitude. High enough to be a landmark, low enough to be a wall. */
const STATION_ALTITUDE = 40

/** @hot-path */
export function spawnSentinel(world: World, slot: number, outpostIndex: number): void {
  const outpost = world.outposts[outpostIndex]
  if (outpost === undefined) return

  copy(position, outpost.direction)
  scale(position, position, R + STATION_ALTITUDE + 18)

  const enemies = world.enemies
  enemies.body.spawnAt(slot, position.x, position.y, position.z)
  enemies.kind[slot] = SENTINEL.kind
  enemies.phase[slot] = EnemyPhase.Guarding
  enemies.hp[slot] = SENTINEL.health
  enemies.target[slot] = outpostIndex
  enemies.timer[slot] = 0
  enemies.fireCooldown[slot] = SENTINEL.fireInterval
  enemies.hasLanded[slot] = 0
  enemies.shieldAngle[slot] = world.rng.range(0, Math.PI * 2)
  enemies.headingX[slot] = outpost.direction.x
  enemies.headingY[slot] = outpost.direction.y
  enemies.headingZ[slot] = outpost.direction.z
}

/** @hot-path */
export function updateSentinel(world: World, slot: number, dt: number): void {
  const enemies = world.enemies
  const outpostIndex = enemies.target[slot] as number
  const outpost = world.outposts[outpostIndex]

  enemies.body.readPosition(slot, position)
  enemies.body.readVelocity(slot, velocity)

  if (outpost !== undefined) {
    copy(station, outpost.direction)
    scale(station, station, R + STATION_ALTITUDE)
    arrive(velocity, position, station, SENTINEL.speed * world.difficulty.enemySpeed, 30, 22, dt)
  } else {
    scale(velocity, velocity, Math.exp(-2 * dt))
  }

  addScaled(position, velocity, dt)
  enemies.body.writePosition(slot, position)
  enemies.body.writeVelocity(slot, velocity)

  // The shield sweeps at a fixed rate. Slow enough that the player can read it
  // and plan a flank, rather than having to react to it.
  enemies.shieldAngle[slot] = ((enemies.shieldAngle[slot] as number) + SENTINEL_SHIELD_RATE * dt) % (Math.PI * 2)

  updateFiring(world, slot, dt)
}

/**
 * Computes the shield's outward normal into `out`.
 *
 * The plate lies in the local tangent plane at the Sentinel's position and
 * rotates within it, so the shield is always "sideways" relative to the moon —
 * which is the plane the player actually approaches through.
 * @hot-path
 */
export function sentinelShieldNormal(out: Vec3, world: Readonly<World>, slot: number): Vec3 {
  const enemies = world.enemies
  scratch.x = enemies.body.x[slot] as number
  scratch.y = enemies.body.y[slot] as number
  scratch.z = enemies.body.z[slot] as number
  normalize(scratch)

  cross(tangentA, scratch, WORLD_UP)
  if (length(tangentA) < 1e-6) cross(tangentA, scratch, WORLD_FORWARD)
  normalize(tangentA)
  cross(tangentB, scratch, tangentA)
  normalize(tangentB)

  const angle = enemies.shieldAngle[slot] as number
  out.x = tangentA.x * Math.cos(angle) + tangentB.x * Math.sin(angle)
  out.y = tangentA.y * Math.cos(angle) + tangentB.y * Math.sin(angle)
  out.z = tangentA.z * Math.cos(angle) + tangentB.z * Math.sin(angle)
  return normalize(out)
}

const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 }
const WORLD_FORWARD: Vec3 = { x: 0, y: 0, z: 1 }

/**
 * True when an impact arriving from `fromDirection` is stopped by the shield.
 *
 * `fromDirection` points *from the shield toward the shooter*, so a shot
 * arriving head-on gives a dot product near 1.
 * @hot-path
 */
export function sentinelBlocks(world: Readonly<World>, slot: number, fromDirection: Readonly<Vec3>): boolean {
  sentinelShieldNormal(shieldNormal, world, slot)
  return dot(shieldNormal, fromDirection) >= Math.cos(SENTINEL_SHIELD_HALF_ANGLE)
}

/** Slow, heavy shots. Area denial rather than damage racing. @hot-path */
function updateFiring(world: World, slot: number, dt: number): void {
  if (!world.craft.alive) return

  const enemies = world.enemies
  const cooldown = (enemies.fireCooldown[slot] as number) - dt
  enemies.fireCooldown[slot] = cooldown
  if (cooldown > 0) return

  sub(scratch, world.craft.position, position)
  if (length(scratch) > 200) {
    enemies.fireCooldown[slot] = 0.8
    return
  }

  predictAim(aim, position, world.craft.position, world.craft.velocity, SENTINEL.projectileSpeed)
  sub(aim, aim, position)
  normalize(aim)

  spawnProjectile(world.enemyProjectiles, position, aim, SENTINEL.projectileSpeed, 4.0, SENTINEL.damage)
  enemies.fireCooldown[slot] = SENTINEL.fireInterval
  world.events.emit(GameEvent.ShotFired, -1, 0, position.x, position.y, position.z)
}
