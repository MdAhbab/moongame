/**
 * Escort drones — the stacking buff (§7.4, §10).
 *
 * One drone per pick of `escort_drone`, up to `MAX_DRONES`. They fly a formation
 * slot around the craft and shoot whatever is nearest, which makes the perk a
 * *presence* rather than a number: you can see how many you have, watch them
 * work, and lose them when you die.
 *
 * ## Why they are not flown
 *
 * A drone with its own flight model would need its own steering, its own
 * collision response and its own failure modes, and none of that is what the
 * perk is for. Each drone's anchor orbits the craft; the drone springs toward
 * its anchor. That is legible in a dogfight — they visibly *keep formation* —
 * and it costs a spring per drone instead of a physics body.
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
import {
  BULLET_LIFE,
  DRONE_DAMAGE,
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

/** How many escort drones the current perk loadout is worth. */
export function droneCount(world: Readonly<World>): number {
  let n = 0
  for (const perk of world.activePerks) if (perk === 'escort_drone') n++
  return Math.min(n, world.drones.pool.capacity)
}

/**
 * Brings the live drone population in line with the perks held.
 *
 * Called every step rather than on the perk pick, so it is correct after a
 * respawn wipe, a replay, or any other path that rewrites `activePerks` without
 * going through the draft screen.
 * @hot-path
 */
export function syncDrones(world: World): void {
  const drones = world.drones
  const wanted = droneCount(world)

  while (drones.pool.count > wanted) {
    const slot = drones.pool.dense[drones.pool.count - 1] as number
    drones.pool.release(slot)
  }

  while (drones.pool.count < wanted) {
    const slot = drones.pool.alloc()
    if (slot < 0) break
    // Evenly spaced around the craft, so two drones never sit on top of each
    // other and the formation reads as a formation.
    drones.angle[slot] = (drones.pool.count - 1) * ((Math.PI * 2) / drones.pool.capacity)
    drones.fireCooldown[slot] = DRONE_FIRE_INTERVAL
    drones.target[slot] = -1
    droneAnchor(world, drones.angle[slot], anchor)
    drones.body.spawnAt(slot, anchor.x, anchor.y, anchor.z)
  }
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
  syncDrones(world)

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
