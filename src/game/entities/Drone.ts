/**
 * Escort drones — the called ability (§7.4, §10).
 *
 * ## Why they are summoned rather than drafted
 *
 * They used to be one stacking perk among eighteen, offered three at a time
 * after a wave. The arithmetic of that is unkind: a player could finish an
 * entire run without ever being shown the card, and most did — the formation
 * flight, the target selection and the lead calculation below were all content
 * nobody met. An ability on a key is met the first time the key is pressed.
 *
 * ## The ladder
 *
 * A sortie puts `bay.tier` drones up for a time that grows with the tier.
 * Bring them home and the tier goes up; lose even one and it resets to a single
 * drone. That is the entire design: the escort is not a resource you spend, it
 * is one you *protect*, and the decision it asks — press the advantage now, or
 * fly conservatively to bank a bigger formation — is a decision the game did
 * not previously have anywhere.
 *
 * ## Why they are not flown
 *
 * A drone with its own flight model would need its own steering, its own
 * collision response and its own failure modes, and none of that is what the
 * ability is for. Each drone's anchor orbits the craft; the drone springs
 * toward its anchor. That is legible in a dogfight — they visibly *keep
 * formation* — and it costs a spring per drone instead of a physics body.
 *
 * ## Why they use the player's projectile pool
 *
 * Because a drone's bullet should behave in every respect like the player's:
 * the same collision sweep, the same Sentinel shield rules, the same hit
 * registration, the same score. Giving them their own pool would mean a second
 * implementation of all of that, and the second one would be the one with the
 * bugs.
 */
import { GameEvent, type World } from '../core/World.ts'
import { type Vec3, addScaled, copy, create, cross, length, normalize, scale, sub } from '../math/vec3.ts'
import { spawnProjectile } from './Projectile.ts'
import { MAX_DRONES } from '../core/World.ts'
import {
  BULLET_LIFE,
  DRONE_DAMAGE,
  DRONE_HULL,
  DRONE_SORTIE_BASE_DURATION,
  DRONE_SORTIE_COOLDOWN,
  DRONE_SORTIE_DURATION_STEP,
  DRONE_FIRE_INTERVAL,
  DRONE_FOLLOW_OMEGA,
  DRONE_ORBIT_RADIUS,
  DRONE_ORBIT_RATE,
  DRONE_RANGE,
  DRONE_BULLET_SPEED,
} from '../data/constants.ts'

const anchor: Vec3 = create()
const position: Vec3 = create()
const velocity: Vec3 = create()
const toTarget: Vec3 = create()
const side: Vec3 = create()

/** How long a sortie at `tier` stays up, seconds. */
export function sortieDuration(tier: number): number {
  return DRONE_SORTIE_BASE_DURATION + (tier - 1) * DRONE_SORTIE_DURATION_STEP
}

/** True when the key would actually launch something. */
function canLaunchDrones(world: Readonly<World>): boolean {
  const bay = world.droneBay
  return world.craft.alive && bay.deployed === 0 && bay.cooldown <= 0
}

/**
 * Runs the bay: launch on the key, count the sortie down, land or bury it.
 *
 * Ordered launch-then-expire so a sortie always gets the step it was launched
 * on. The reverse order costs the player a frame of a 20-second ability every
 * time, which is the sort of thing that never shows up in a test and always
 * shows up in the feel.
 * @hot-path
 */
export function stepDroneBay(world: World, dt: number): void {
  const bay = world.droneBay

  if (bay.cooldown > 0) bay.cooldown = Math.max(0, bay.cooldown - dt)

  if (world.input.deployDronesPressed && canLaunchDrones(world)) {
    launchSortie(world)
  }

  if (bay.deployed === 0) return

  bay.remaining -= dt

  // Wiped out counts as ended, and ends it *now*: leaving the clock running on
  // an empty formation would let a player who lost everything at second one
  // stand in a 20-second cooldown they cannot see the reason for.
  if (world.drones.pool.count === 0) {
    endSortie(world)
    return
  }

  if (bay.remaining <= 0) endSortie(world)
}

/** Puts `tier` drones up and starts the clock. */
function launchSortie(world: World): void {
  const bay = world.droneBay
  const drones = world.drones

  const wanted = Math.min(bay.tier, drones.pool.capacity)
  let launched = 0

  for (let i = 0; i < wanted; i++) {
    const slot = drones.pool.alloc()
    if (slot < 0) break
    launched++
    // Evenly spaced around the craft, so two drones never sit on top of each
    // other and the formation reads as a formation.
    drones.angle[slot] = i * ((Math.PI * 2) / wanted)
    drones.fireCooldown[slot] = DRONE_FIRE_INTERVAL
    drones.target[slot] = -1
    drones.health[slot] = DRONE_HULL
    droneAnchor(world, drones.angle[slot], anchor)
    drones.body.spawnAt(slot, anchor.x, anchor.y, anchor.z)
  }

  // Count what actually went up, not what was asked for. A launch that
  // allocated nothing must not open a sortie at all — the next step would see
  // an empty pool, read it as "flew and expired", and hand out a free tier for
  // a sortie that never happened.
  if (launched === 0) return

  bay.deployed = launched
  bay.remaining = sortieDuration(bay.tier)
  bay.sortieLost = false

  world.events.emit(
    GameEvent.DronesLaunched,
    bay.deployed,
    bay.remaining,
    world.craft.position.x,
    world.craft.position.y,
    world.craft.position.z,
  )
}

/**
 * Ends the sortie and settles the ladder.
 *
 * The tier moves *here* rather than at the moment of a kill, because a sortie
 * is only lost once it is over — a drone shot down with fifteen seconds left
 * still has fifteen seconds of the others' fire ahead of it, and the player
 * should not watch the counter drop while they are still flying it.
 */
function endSortie(world: World): void {
  const bay = world.droneBay

  bay.tier = bay.sortieLost ? 1 : Math.min(MAX_DRONES, bay.tier + 1)
  bay.deployed = 0
  bay.remaining = 0
  bay.cooldown = DRONE_SORTIE_COOLDOWN

  world.drones.pool.reset()

  world.events.emit(
    GameEvent.DronesRecalled,
    bay.tier,
    bay.sortieLost ? 1 : 0,
    world.craft.position.x,
    world.craft.position.y,
    world.craft.position.z,
  )
  bay.sortieLost = false
}

/**
 * Takes `amount` off a drone and releases it if that finishes it.
 *
 * Marks the sortie lost on the way out, which is the flag `endSortie` reads to
 * decide whether the ladder advances or resets.
 */
export function damageDrone(world: World, slot: number, amount: number): void {
  const drones = world.drones
  if (drones.pool.active[slot] !== 1) return

  const health = (drones.health[slot] as number) - amount
  drones.health[slot] = health
  if (health > 0) return

  world.droneBay.sortieLost = true
  drones.body.readPosition(slot, position)
  world.events.emit(GameEvent.DroneDestroyed, slot, 0, position.x, position.y, position.z)
  drones.pool.release(slot)
}

/**
 * The formation point for a drone at `angle`, in the craft's tangent frame.
 * @hot-path
 */
function droneAnchor(world: Readonly<World>, angle: number, out: Vec3): void {
  const craft = world.craft
  cross(side, craft.frame.forward, craft.frame.up)
  normalize(side)

  copy(out, craft.position)
  addScaled(out, side, Math.cos(angle) * DRONE_ORBIT_RADIUS)
  addScaled(out, craft.frame.forward, Math.sin(angle) * DRONE_ORBIT_RADIUS * 0.55)
  // Slightly above the craft, so they are never hidden behind the hull from the
  // chase camera and never intersect the exhaust.
  addScaled(out, craft.frame.up, 2.2)
}

/** @hot-path */
export function stepDrones(world: World, dt: number): void {
  stepDroneBay(world, dt)

  const drones = world.drones
  if (drones.pool.count === 0) return

  for (let i = 0; i < drones.pool.count; i++) {
    const slot = drones.pool.dense[i] as number
    drones.body.savePrevious(slot)

    // Orbit the anchor, then chase it with a critically damped spring. The
    // exponential form is framerate-independent, like every other spring here.
    const angle = ((drones.angle[slot] as number) + DRONE_ORBIT_RATE * dt) % (Math.PI * 2)
    drones.angle[slot] = angle
    droneAnchor(world, angle, anchor)

    drones.body.readPosition(slot, position)
    sub(velocity, anchor, position)
    const follow = 1 - Math.exp(-DRONE_FOLLOW_OMEGA * dt)
    addScaled(position, velocity, follow)
    drones.body.writePosition(slot, position)
    // Velocity is reported for the renderer's interpolation and for the trail,
    // not integrated: the spring above already moved it.
    scale(velocity, velocity, DRONE_FOLLOW_OMEGA)
    drones.body.writeVelocity(slot, velocity)

    updateDroneFire(world, slot, dt)
  }
}

/**
 * Engages the nearest enemy in range.
 *
 * Nearest rather than "what the player is shooting", deliberately: a drone that
 * duplicated the player's target would add damage to a thing already dying,
 * while one that covers the *other* threat is the reason to take the perk.
 * @hot-path
 */
function updateDroneFire(world: World, slot: number, dt: number): void {
  const drones = world.drones
  const cooldown = (drones.fireCooldown[slot] as number) - dt
  drones.fireCooldown[slot] = cooldown
  if (cooldown > 0) return

  const { pool, body } = world.enemies
  drones.body.readPosition(slot, position)

  let best = -1
  let bestRangeSq = DRONE_RANGE * DRONE_RANGE
  for (let i = 0; i < pool.count; i++) {
    const enemy = pool.dense[i] as number
    const dx = (body.x[enemy] as number) - position.x
    const dy = (body.y[enemy] as number) - position.y
    const dz = (body.z[enemy] as number) - position.z
    const rangeSq = dx * dx + dy * dy + dz * dz
    if (rangeSq < bestRangeSq) {
      bestRangeSq = rangeSq
      best = enemy
    }
  }

  drones.target[slot] = best
  if (best < 0) {
    // A short retry rather than the full interval, so a drone that comes into
    // range mid-cooldown engages immediately instead of idling for a second.
    drones.fireCooldown[slot] = 0.15
    return
  }

  // Lead the shot. The drone's gun is slower than the player's, so firing
  // straight at a crossing target would miss almost every time.
  toTarget.x = (body.x[best] as number) - position.x
  toTarget.y = (body.y[best] as number) - position.y
  toTarget.z = (body.z[best] as number) - position.z
  const flight = length(toTarget) / DRONE_BULLET_SPEED
  toTarget.x += (body.vx[best] as number) * flight
  toTarget.y += (body.vy[best] as number) * flight
  toTarget.z += (body.vz[best] as number) * flight
  normalize(toTarget)

  const projectile = spawnProjectile(
    world.playerProjectiles,
    position,
    toTarget,
    DRONE_BULLET_SPEED,
    BULLET_LIFE,
    DRONE_DAMAGE * world.loadout.bulletDamage,
  )

  drones.fireCooldown[slot] = DRONE_FIRE_INTERVAL
  if (projectile >= 0) {
    world.events.emit(GameEvent.DroneFired, slot, 0, position.x, position.y, position.z)
  }
}
