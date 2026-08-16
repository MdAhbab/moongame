/**
 * Carrier — the source (gameplan §7.3).
 *
 * Holds high station over an outpost and launches a fresh Harvester every
 * `CARRIER_LAUNCH_INTERVAL` seconds, for as long as it is alive.
 *
 * ## The decision it exists to create
 *
 * It is the only hostile in the game whose existence *undoes work already done*.
 * Every other threat is a task with an end: kill the Harvesters and the outpost
 * stops draining, kill the Interceptors and travel is safe again. Clear an
 * outpost while its Carrier still flies and the outpost will be under threat
 * again before you have reached the next one — so the work you just did bought
 * you less than it appeared to.
 *
 * That turns the wave's arithmetic into a genuine investment question, in the
 * currency the whole game is denominated in. A Carrier is slow, tanky and parked
 * far above the surface: going after it costs real seconds now, and those seconds
 * are the ones you would otherwise spend on the outpost that is draining *right
 * now*. Paying them buys back every future trip to this outpost. Refusing to pay
 * them is legitimate, and the game is careful to make it legitimate — you can
 * beat a wave by out-clearing a Carrier, it is simply the expensive route.
 *
 * ## Why it does not shoot
 *
 * Deliberately unarmed. The cost of going after a Carrier has to be *only* the
 * time, because time is the thing the decision is meant to be about. Giving it a
 * gun would mean a player who chose correctly could still lose hull for it, and
 * the lesson would come back muddled — was going after it wrong, or was I just
 * unlucky on the way? The tanky hull is the price; nothing else is.
 */
import { EnemyPhase, GameEvent, type World } from '../core/World.ts'
import { type Vec3, addScaled, copy, create, scale } from '../math/vec3.ts'
import { arrive } from '../physics/steering.ts'
import { CARRIER } from '../data/enemies.ts'
import { spawnHarvester } from './Harvester.ts'
import { CARRIER_ALTITUDE, CARRIER_FIRST_LAUNCH_DELAY, CARRIER_LAUNCH_INTERVAL, R } from '../data/constants.ts'

const position: Vec3 = create()
const velocity: Vec3 = create()
const station: Vec3 = create()

/** Radians per second the hull yaws on station. Slow enough to read as mass. */
const YAW_RATE = 0.18

/** @hot-path */
export function spawnCarrier(world: World, slot: number, outpostIndex: number): void {
  const outpost = world.outposts[outpostIndex]
  if (outpost === undefined) return

  copy(position, outpost.direction)
  scale(position, position, R + CARRIER_ALTITUDE + 30)

  const enemies = world.enemies
  enemies.body.spawnAt(slot, position.x, position.y, position.z)
  enemies.kind[slot] = CARRIER.kind
  enemies.phase[slot] = EnemyPhase.Launching
  enemies.hp[slot] = CARRIER.health
  enemies.target[slot] = outpostIndex
  // The grace before the first launch. Without it a Carrier releases a Harvester
  // on the frame it arrives, which reads as the wave having spawned wrong rather
  // than as a machine doing a job.
  enemies.timer[slot] = CARRIER_FIRST_LAUNCH_DELAY
  enemies.fireCooldown[slot] = 0
  enemies.hasLanded[slot] = 0
  enemies.shieldAngle[slot] = world.rng.range(0, Math.PI * 2)
  enemies.headingX[slot] = outpost.direction.x
  enemies.headingY[slot] = outpost.direction.y
  enemies.headingZ[slot] = outpost.direction.z
}

/** @hot-path */
export function updateCarrier(world: World, slot: number, dt: number): void {
  const enemies = world.enemies
  const outpostIndex = enemies.target[slot] as number
  const outpost = world.outposts[outpostIndex]

  enemies.body.readPosition(slot, position)
  enemies.body.readVelocity(slot, velocity)

  if (outpost !== undefined && outpost.status !== 'Lost') {
    copy(station, outpost.direction)
    scale(station, station, R + CARRIER_ALTITUDE)
    arrive(velocity, position, station, CARRIER.speed * world.difficulty.enemySpeed, 40, 30, dt)
  } else {
    // Nothing left to seed. It drifts and stops launching, for the same reason a
    // Harvester lifts off a dead outpost: the player must never be asked to clear
    // a threat that no longer matters.
    scale(velocity, velocity, Math.exp(-1.5 * dt))
  }

  addScaled(position, velocity, dt)
  enemies.body.writePosition(slot, position)
  enemies.body.writeVelocity(slot, velocity)

  enemies.shieldAngle[slot] = ((enemies.shieldAngle[slot] as number) + YAW_RATE * dt) % (Math.PI * 2)

  updateLaunch(world, slot, dt, outpostIndex)
}

/**
 * The launch clock.
 *
 * Two guards, both load-bearing:
 *
 *  - **A dead or lost outpost stops the clock**, so a Carrier over a ruin is
 *    inert rather than seeding Harvesters that would immediately lift off again.
 *  - **A full pool defers the launch rather than dropping it.** The timer is not
 *    reset on a failed allocation, so the Carrier retries next step and the
 *    wave's pressure is delayed rather than silently reduced. That is the same
 *    rule `SpawnSystem.release` follows — queue, never drop (§7.3) — and it is
 *    what keeps difficulty authored rather than emergent from pool contention.
 * @hot-path
 */
function updateLaunch(world: World, slot: number, dt: number, outpostIndex: number): void {
  const enemies = world.enemies
  const outpost = world.outposts[outpostIndex]
  if (outpost === undefined || outpost.status === 'Lost') return

  const remaining = (enemies.timer[slot] as number) - dt
  if (remaining > 0) {
    enemies.timer[slot] = remaining
    return
  }

  if (enemies.pool.isFull) return // retry next step; the timer stays expired

  const child = enemies.pool.alloc()
  if (child < 0) return

  // Drawn from the wave-seeded PRNG like every other spawn, so a Carrier's
  // output is part of the reproducible wave rather than a source of divergence
  // between two runs of the same seed (§10.4).
  const entry = world.rng.range(0.35, 0.8) * (world.rng.next() < 0.5 ? -1 : 1)
  spawnHarvester(world, child, outpostIndex, entry)

  enemies.timer[slot] = CARRIER_LAUNCH_INTERVAL
  world.events.emit(
    GameEvent.CarrierLaunch,
    outpostIndex,
    0,
    position.x,
    position.y,
    position.z,
  )
}
