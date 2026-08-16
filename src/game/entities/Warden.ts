/**
 * Warden — the priority (gameplan §7.3).
 *
 * Holds station over an outpost and projects a spherical field of radius
 * `WARDEN_FIELD_RADIUS`. **Every other hostile inside that field is immune to
 * damage.** The Warden itself is not.
 *
 * ## Why this is not a second Sentinel
 *
 * Both archetypes stop damage, and they are answers to opposite questions.
 *
 * A Sentinel's shield is *directional*: it blocks a 144° cone that sweeps
 * slowly, and the answer is to move — flank past the lit post and shoot the
 * thing behind it. It converts a time problem into a positioning problem, which
 * is its stated role, and the cost is seconds of flying.
 *
 * A Warden's field is *radial*, so no amount of positioning gets damage through
 * to anything inside it. The answer is not to move but to **retarget**: shoot
 * the Warden first, then everything it was covering. It is the only archetype
 * that changes what a player should be aiming at rather than where they should
 * be standing, which is why it is the one introduced when the campaign's stated
 * difficulty becomes "the composition itself" (wave 9).
 *
 * ## The field has to be visible
 *
 * `EnemyInstances` draws it as a translucent shell and `CollisionSystem` emits
 * `WardenAbsorbed` at each blocked impact. Damage that silently fails is the
 * exact fault the Sentinel's shield geometry was rebuilt to remove — a player
 * was expected to deduce a 144° arc from shots disappearing — and a radial field
 * has no silhouette of its own to make the boundary legible. So it is drawn, and
 * every absorbed round says so where it landed.
 */
import { EnemyKind, EnemyPhase, GameEvent, type World } from '../core/World.ts'
import { type Vec3, addScaled, copy, create, length, normalize, scale, sub } from '../math/vec3.ts'
import { arrive, predictAim } from '../physics/steering.ts'
import { spawnProjectile } from './Projectile.ts'
import { WARDEN } from '../data/enemies.ts'
import { R, WARDEN_ALTITUDE, WARDEN_FIELD_RADIUS } from '../data/constants.ts'

const position: Vec3 = create()
const velocity: Vec3 = create()
const station: Vec3 = create()
const aim: Vec3 = create()
const scratch: Vec3 = create()

/** Radians per second the arm assembly turns. Slow; it is a landmark, not a threat display. */
const SPIN_RATE = 0.35

/** @hot-path */
export function spawnWarden(world: World, slot: number, outpostIndex: number): void {
  const outpost = world.outposts[outpostIndex]
  if (outpost === undefined) return

  copy(position, outpost.direction)
  scale(position, position, R + WARDEN_ALTITUDE + 22)

  const enemies = world.enemies
  enemies.body.spawnAt(slot, position.x, position.y, position.z)
  enemies.kind[slot] = WARDEN.kind
  enemies.phase[slot] = EnemyPhase.Projecting
  enemies.hp[slot] = WARDEN.health
  enemies.target[slot] = outpostIndex
  enemies.timer[slot] = 0
  enemies.fireCooldown[slot] = WARDEN.fireInterval
  enemies.hasLanded[slot] = 0
  enemies.shieldAngle[slot] = world.rng.range(0, Math.PI * 2)
  enemies.headingX[slot] = outpost.direction.x
  enemies.headingY[slot] = outpost.direction.y
  enemies.headingZ[slot] = outpost.direction.z
}

/** @hot-path */
export function updateWarden(world: World, slot: number, dt: number): void {
  const enemies = world.enemies
  const outpostIndex = enemies.target[slot] as number
  const outpost = world.outposts[outpostIndex]

  enemies.body.readPosition(slot, position)
  enemies.body.readVelocity(slot, velocity)

  if (outpost !== undefined) {
    copy(station, outpost.direction)
    scale(station, station, R + WARDEN_ALTITUDE)
    arrive(velocity, position, station, WARDEN.speed * world.difficulty.enemySpeed, 34, 24, dt)
  } else {
    scale(velocity, velocity, Math.exp(-2 * dt))
  }

  addScaled(position, velocity, dt)
  enemies.body.writePosition(slot, position)
  enemies.body.writeVelocity(slot, velocity)

  // Reuses `shieldAngle` rather than adding an array: it is the archetype's
  // rotational state and no enemy is both a Sentinel and a Warden. A seventh
  // Float32Array across 48 slots to say the same thing would be 192 bytes of
  // duplication and one more field for the next archetype to have to consider.
  enemies.shieldAngle[slot] = ((enemies.shieldAngle[slot] as number) + SPIN_RATE * dt) % (Math.PI * 2)

  updateFiring(world, slot, dt)
}

/**
 * True when `slot` is covered by some living Warden's field.
 *
 * Linear over the active pool. That is the honest cost of a radial field, and it
 * is small: the pool is 48 and a wave carries at most three Wardens, so the
 * early exit on `kind` rejects the overwhelming majority on one integer compare.
 * A spatial index would be more code than the thing it indexes.
 *
 * ## Two archetypes are never shielded
 *
 * **Another Warden**, because two of them covering each other would be
 * unkillable — a lock with no counterplay at all, and exactly the kind of
 * emergent failure a "protects nearby allies" rule produces if nobody writes the
 * exception down.
 *
 * **A Sapper**, for a sharper reason. A Warden holds station at
 * `WARDEN_ALTITUDE` over its outpost and the field reaches
 * `WARDEN_FIELD_RADIUS`, so the protected volume spans altitude 6 to 98 — a
 * column that completely contains a Sapper's terminal dive, which ends at
 * `R + 5.5`. And `SpawnSystem.startWave` assigns both archetypes with
 * `targets[i % spread]` from index 0, so the pairing is *guaranteed* rather than
 * unlucky: on wave 11 two of three Sappers spawn under a Warden.
 *
 * Measured, that was 1.02 s of total invulnerability ending 0.8 frames above the
 * detonation point — an outpost losing 14 integrity with no counterplay
 * whatsoever. It also directly contradicts the promise the Sapper is built on
 * and this file's neighbour states twice: "one hit kills it, so seeing it in
 * time is always sufficient". A blanket immunity rule breaks precisely the
 * archetype whose whole design is that there is no partial credit, so the
 * archetype wins the argument and takes the exception.
 * @hot-path
 */
export function shieldedByWarden(world: Readonly<World>, slot: number): boolean {
  const enemies = world.enemies
  const kind = enemies.kind[slot] as number
  if (kind === EnemyKind.Warden || kind === EnemyKind.Sapper) return false

  const { pool, body } = enemies
  const x = body.x[slot] as number
  const y = body.y[slot] as number
  const z = body.z[slot] as number

  for (let i = 0; i < pool.count; i++) {
    const other = pool.dense[i] as number
    if ((enemies.kind[other] as number) !== WARDEN.kind) continue
    const dx = (body.x[other] as number) - x
    const dy = (body.y[other] as number) - y
    const dz = (body.z[other] as number) - z
    if (dx * dx + dy * dy + dz * dz <= WARDEN_FIELD_RADIUS * WARDEN_FIELD_RADIUS) return true
  }

  return false
}

/** Slow, heavy shots — the same area-denial role the Sentinel fills. @hot-path */
function updateFiring(world: World, slot: number, dt: number): void {
  if (!world.craft.alive) return

  const enemies = world.enemies
  const cooldown = (enemies.fireCooldown[slot] as number) - dt
  enemies.fireCooldown[slot] = cooldown
  if (cooldown > 0) return

  sub(scratch, world.craft.position, position)
  if (length(scratch) > 210) {
    enemies.fireCooldown[slot] = 0.8
    return
  }

  predictAim(aim, position, world.craft.position, world.craft.velocity, WARDEN.projectileSpeed)
  sub(aim, aim, position)
  normalize(aim)

  spawnProjectile(world.enemyProjectiles, position, aim, WARDEN.projectileSpeed, 4.2, WARDEN.damage)
  enemies.fireCooldown[slot] = WARDEN.fireInterval
  world.events.emit(GameEvent.ShotFired, -1, 0, position.x, position.y, position.z)
}
