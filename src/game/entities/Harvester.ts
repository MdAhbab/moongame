/**
 * Harvester — the objective threat (gameplan §7.3).
 *
 * Spawns on an arc from beyond the horizon, lands beside an outpost, and
 * deploys a drain beam. **It does not attack the player at all.**
 *
 * That is the whole design: the Harvester is the clock, and every other enemy
 * exists to stop you reaching it. Killing one before it lands is worth 150 and
 * prevents any drain; killing it after is worth 80 and the drain has already
 * been ticking (§7.7). Rewarding proactivity without punishing reaction.
 */
import { EnemyPhase, GameEvent, type World } from '../core/World.ts'
import { type Vec3, create, normalize, scale, addScaled, length, sub, dot, copy, cross } from '../math/vec3.ts'
import { arrive, seek } from '../physics/steering.ts'
import { HARVESTER } from '../data/enemies.ts'
import { ALT_MAX, R } from '../data/constants.ts'

const position: Vec3 = create()
const velocity: Vec3 = create()
const waypoint: Vec3 = create()
const tangent: Vec3 = create()
const scratch: Vec3 = create()

/** Altitude a Harvester holds during its approach before committing to descend. */
const APPROACH_ALTITUDE = 34
/** Landed Harvesters sit slightly clear of the outpost so both stay visible. */
const LANDING_OFFSET = 6

/**
 * Places a Harvester on an approach arc toward `outpostIndex`.
 *
 * Entry is offset around the sphere from its target so the craft appears over
 * the horizon and flies in, rather than materialising overhead — the approach
 * is the player's warning that the clock is about to start.
 * @hot-path
 */
export function spawnHarvester(world: World, slot: number, outpostIndex: number, entryAngle: number): void {
  const outpost = world.outposts[outpostIndex]
  if (outpost === undefined) return

  // Build a tangent at the outpost and rotate the spawn point away along it.
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
  scale(position, position, R + ALT_MAX * 0.85)

  const enemies = world.enemies
  enemies.body.spawnAt(slot, position.x, position.y, position.z)
  enemies.kind[slot] = HARVESTER.kind
  enemies.phase[slot] = EnemyPhase.Inbound
  enemies.hp[slot] = HARVESTER.health
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

const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 }
const WORLD_FORWARD: Vec3 = { x: 0, y: 0, z: 1 }

/** @hot-path */
export function updateHarvester(world: World, slot: number, dt: number): void {
  const enemies = world.enemies
  const outpostIndex = enemies.target[slot] as number
  const outpost = world.outposts[outpostIndex]
  const speedScale = world.difficulty.enemySpeed

  enemies.body.readPosition(slot, position)
  enemies.body.readVelocity(slot, velocity)

  // A Harvester whose outpost is already lost has nothing to drain. It lifts
  // off and leaves rather than sitting on a dead objective, so the player is
  // never asked to clear a threat that no longer matters.
  if (outpost === undefined || outpost.status === 'Lost') {
    copy(waypoint, position)
    normalize(waypoint)
    scale(waypoint, waypoint, R + ALT_MAX)
    seek(velocity, position, waypoint, HARVESTER.speed * speedScale, 24, dt)
    enemies.phase[slot] = EnemyPhase.Inbound
    commit(world, slot, dt)
    return
  }

  const phase = enemies.phase[slot] as number

  if (phase === EnemyPhase.Inbound) {
    // Hold approach altitude directly over the target, then commit downward.
    copy(waypoint, outpost.direction)
    scale(waypoint, waypoint, R + APPROACH_ALTITUDE)
    seek(velocity, position, waypoint, HARVESTER.speed * speedScale, 30, dt)

    if (length(sub(scratch, waypoint, position)) < 14) {
      enemies.phase[slot] = EnemyPhase.Landing
    }
  } else if (phase === EnemyPhase.Landing) {
    landingSite(waypoint, outpost.direction, slot)
    arrive(velocity, position, waypoint, HARVESTER.speed * 0.8 * speedScale, 26, 12, dt)

    if (length(sub(scratch, waypoint, position)) < 2.5) {
      enemies.phase[slot] = EnemyPhase.Draining
      enemies.hasLanded[slot] = 1
      velocity.x = 0
      velocity.y = 0
      velocity.z = 0
      world.events.emit(GameEvent.DrainStarted, outpostIndex, 0, position.x, position.y, position.z)
    }
  } else {
    // Draining: planted. DrainSystem owns the integrity clock; the Harvester
    // just holds station and keeps its beam pointed down.
    velocity.x = 0
    velocity.y = 0
    velocity.z = 0
  }

  commit(world, slot, dt)
}

/**
 * Landing sites are spread around the outpost by slot so multiple Harvesters
 * are individually targetable rather than stacking into one silhouette.
 */
function landingSite(out: Vec3, direction: Readonly<Vec3>, slot: number): void {
  cross(tangent, direction, WORLD_UP)
  if (length(tangent) < 1e-6) cross(tangent, direction, WORLD_FORWARD)
  normalize(tangent)
  cross(scratch, direction, tangent)
  normalize(scratch)

  const angle = (slot * 2.39996) % (Math.PI * 2)
  out.x = direction.x * R + (tangent.x * Math.cos(angle) + scratch.x * Math.sin(angle)) * LANDING_OFFSET
  out.y = direction.y * R + (tangent.y * Math.cos(angle) + scratch.y * Math.sin(angle)) * LANDING_OFFSET
  out.z = direction.z * R + (tangent.z * Math.cos(angle) + scratch.z * Math.sin(angle)) * LANDING_OFFSET

  // Seat on the surface clear of lunar terrain displacement
  normalize(out)
  scale(out, out, R + 3.2)
}

/** Integrates and writes back, keeping the enemy out of the terrain. @hot-path */
function commit(world: World, slot: number, dt: number): void {
  const enemies = world.enemies
  addScaled(position, velocity, dt)

  const radius = length(position)
  if (radius < R + 2.8) {
    normalize(position)
    scale(position, position, R + 2.8)
    const radial = dot(velocity, position) / (R + 2.8)
    addScaled(velocity, position, -radial / (R + 2.8))
  }

  enemies.body.writePosition(slot, position)
  enemies.body.writeVelocity(slot, velocity)

  const speed = length(velocity)
  if (speed > 0.5) {
    enemies.headingX[slot] = velocity.x / speed
    enemies.headingY[slot] = velocity.y / speed
    enemies.headingZ[slot] = velocity.z / speed
  }
}
