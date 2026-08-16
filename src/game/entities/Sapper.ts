/**
 * Sapper — the deadline (gameplan §7.3).
 *
 * Enters low and fast on a flat line toward its outpost, arms for
 * `SAPPER_ARM_TIME` seconds where everything can see it, and detonates on the
 * surface for `SAPPER_IMPACT_DAMAGE` integrity in one stroke.
 *
 * ## Why it is not just a fast Harvester
 *
 * Every other objective threat in the game gives the player a *clock they can
 * arrive late to*. A Harvester drains at a rate; reaching it with eight seconds
 * of integrity left still saves eight seconds of integrity. That is what makes
 * triage arithmetic rather than a series of pass/fail gates, and it is right for
 * the first six waves.
 *
 * The Sapper is the one threat with no partial credit, and it exists so the back
 * third of the campaign can ask a question the drain clock cannot: *is this the
 * one you commit to right now?* Ignoring a Harvester costs you integrity in
 * proportion to how long you ignore it. Ignoring a Sapper costs you fourteen
 * points at a fixed moment, whatever else you were doing.
 *
 * ## What keeps it fair
 *
 * One hit kills it, and it never fires. A player who sees it in time always
 * beats it, and the only reason to lose to one is having been somewhere else —
 * which is the game's whole subject. Giving it a gun would let the player fail
 * for a reason unrelated to the deadline, and giving it more health would make
 * "saw it in time" insufficient, which is the same thing as making the tell a
 * lie.
 */
import { EnemyPhase, GameEvent, type World } from '../core/World.ts'
import { type Vec3, addScaled, copy, create, cross, length, normalize, scale, sub } from '../math/vec3.ts'
import { seek } from '../physics/steering.ts'
import { SAPPER } from '../data/enemies.ts'
import { damageOutpost } from './Outpost.ts'
import { emitBurst } from '../systems/ParticleSystem.ts'
import { damageCraft } from '../systems/CollisionSystem.ts'
import {
  ALT_MAX,
  R,
  SAPPER_ARM_TIME,
  SAPPER_BLAST_DAMAGE,
  SAPPER_BLAST_RADIUS,
  SAPPER_IMPACT_DAMAGE,
} from '../data/constants.ts'

const position: Vec3 = create()
const velocity: Vec3 = create()
const waypoint: Vec3 = create()
const tangent: Vec3 = create()
const scratch: Vec3 = create()

const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 }
const WORLD_FORWARD: Vec3 = { x: 0, y: 0, z: 1 }

/**
 * Approach altitude, u.
 *
 * Deliberately below the Harvester's 34: a Sapper comes in *under* the traffic,
 * so it reads as a different kind of movement at a glance rather than as a
 * Harvester in a hurry.
 */
const RUN_ALTITUDE = 16

/** Radial clearance at which the run becomes a detonation. */
const DETONATION_CLEARANCE = 5.5

/** @hot-path */
export function spawnSapper(world: World, slot: number, outpostIndex: number, entryAngle: number): void {
  const outpost = world.outposts[outpostIndex]
  if (outpost === undefined) return

  // Same entry construction as the Harvester — over the horizon, along a tangent
  // — so both archetypes arrive from directions the player has learned to watch.
  copy(scratch, outpost.direction)
  cross(tangent, scratch, WORLD_UP)
  if (length(tangent) < 1e-6) cross(tangent, scratch, WORLD_FORWARD)
  normalize(tangent)

  const cos = Math.cos(entryAngle)
  const sin = Math.sin(entryAngle)
  position.x = scratch.x * cos + tangent.x * sin
  position.y = scratch.y * cos + tangent.y * sin
  position.z = scratch.z * cos + tangent.z * sin
  normalize(position)
  scale(position, position, R + ALT_MAX * 0.45)

  const enemies = world.enemies
  enemies.body.spawnAt(slot, position.x, position.y, position.z)
  enemies.kind[slot] = SAPPER.kind
  enemies.phase[slot] = EnemyPhase.Closing
  enemies.hp[slot] = SAPPER.health
  enemies.target[slot] = outpostIndex
  enemies.timer[slot] = 0
  enemies.fireCooldown[slot] = 0
  enemies.hasLanded[slot] = 0
  enemies.shieldAngle[slot] = 0

  sub(scratch, outpost.position, position)
  normalize(scratch)
  enemies.headingX[slot] = scratch.x
  enemies.headingY[slot] = scratch.y
  enemies.headingZ[slot] = scratch.z
}

/** @hot-path */
export function updateSapper(world: World, slot: number, dt: number): void {
  const enemies = world.enemies
  const outpostIndex = enemies.target[slot] as number
  const outpost = world.outposts[outpostIndex]
  const speedScale = world.difficulty.enemySpeed

  enemies.body.readPosition(slot, position)
  enemies.body.readVelocity(slot, velocity)

  // A Sapper whose outpost is already lost has no deadline left to enforce. It
  // climbs out and leaves, for the same reason a Harvester does: the player must
  // never be asked to clear a threat that no longer matters.
  if (outpost === undefined || outpost.status === 'Lost') {
    copy(waypoint, position)
    normalize(waypoint)
    scale(waypoint, waypoint, R + ALT_MAX)
    seek(velocity, position, waypoint, SAPPER.speed * speedScale, 30, dt)
    commit(world, slot, dt)
    return
  }

  const phase = enemies.phase[slot] as number

  if (phase === EnemyPhase.Closing) {
    // Straight at the outpost's airspace, holding the run altitude until the
    // last moment. `seek` rather than `arrive`: a Sapper never slows down.
    copy(waypoint, outpost.direction)
    scale(waypoint, waypoint, R + RUN_ALTITUDE)
    seek(velocity, position, waypoint, SAPPER.speed * speedScale, 26, dt)

    if (length(sub(scratch, waypoint, position)) < 22) {
      enemies.phase[slot] = EnemyPhase.Arming
      enemies.timer[slot] = SAPPER_ARM_TIME
      // The tell. Announced as its own event so audio and particles can mark the
      // moment rather than inferring it from a phase they would have to poll.
      world.events.emit(GameEvent.SapperArmed, outpostIndex, 0, position.x, position.y, position.z)
    }
  } else {
    // Armed: committed straight down at the outpost. Nothing steers it now, and
    // the timer is only a fuse — reaching the surface first is the usual ending.
    const fuse = (enemies.timer[slot] as number) - dt
    enemies.timer[slot] = fuse

    copy(waypoint, outpost.direction)
    scale(waypoint, waypoint, R)
    seek(velocity, position, waypoint, SAPPER.speed * 1.15 * speedScale, 40, dt)

    const radius = length(position)
    if (radius < R + DETONATION_CLEARANCE || fuse <= 0) {
      detonate(world, slot, outpostIndex)
      return
    }
  }

  commit(world, slot, dt)
}

/**
 * The payload.
 *
 * Damages the outpost, and the craft too if it is inside the blast — which is
 * the one way a Sapper can hurt the player, and it only happens to a player who
 * killed it too late rather than too early. Releases its own pool slot, so this
 * is a death that does **not** go through `damageEnemy`: no score, no bounty, no
 * combo. A Sapper that reaches its target is a failure, and paying for it would
 * say otherwise.
 */
function detonate(world: World, slot: number, outpostIndex: number): void {
  const enemies = world.enemies
  const x = enemies.body.x[slot] as number
  const y = enemies.body.y[slot] as number
  const z = enemies.body.z[slot] as number

  const outpost = world.outposts[outpostIndex]
  if (outpost !== undefined) {
    damageOutpost(world, outpost, SAPPER_IMPACT_DAMAGE)
  }

  const craft = world.craft
  if (craft.alive) {
    const dx = craft.position.x - x
    const dy = craft.position.y - y
    const dz = craft.position.z - z
    if (dx * dx + dy * dy + dz * dz < SAPPER_BLAST_RADIUS * SAPPER_BLAST_RADIUS) {
      scratch.x = -dx
      scratch.y = -dy
      scratch.z = -dz
      damageCraft(world, SAPPER_BLAST_DAMAGE * world.difficulty.enemyDamage * world.loadout.damageTaken, scratch)
    }
  }

  emitBurst(world, x, y, z, 34, 42, 1.1, 0.5, 'hostile', 1.2, null, true)
  world.events.emit(GameEvent.SapperDetonated, outpostIndex, 0, x, y, z)
  enemies.pool.release(slot)
}

/** Integrates and writes back, keeping the heading current for the renderer. @hot-path */
function commit(world: World, slot: number, dt: number): void {
  const enemies = world.enemies
  addScaled(position, velocity, dt)

  enemies.body.writePosition(slot, position)
  enemies.body.writeVelocity(slot, velocity)

  const speed = length(velocity)
  if (speed > 0.5) {
    enemies.headingX[slot] = velocity.x / speed
    enemies.headingY[slot] = velocity.y / speed
    enemies.headingZ[slot] = velocity.z / speed
  }
}
