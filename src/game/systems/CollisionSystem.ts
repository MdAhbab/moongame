/**
 * Collision (gameplan §23).
 *
 * Broadphase bucket grid → analytic swept-sphere narrowphase → response.
 *
 * The narrowphase is continuous, not discrete. V1 checked `distanceTo` once per
 * frame with projectiles moving 5 u/frame against ~2 u targets
 * (`game.js:730`), so fast shots teleported straight through enemies — the
 * reason its shooting felt unreliable. At 220 u/s and a fixed 1/120 s step a
 * bullet advances 1.83 u per substep against a 2.4 u Harvester, which is
 * marginal even before boost closes the gap; the sweep removes the question
 * entirely.
 *
 * The collision matrix (§23.4) is deliberately sparse. Friendly fire is off and
 * projectile-vs-projectile is off: both add nothing and cost broadphase work.
 */
import { EnemyKind, EnemyPhase, GameEvent, type World } from '../core/World.ts'
import { type Vec3, create, dot, length, normalize, sub, copy } from '../math/vec3.ts'
import { sweepSphere, sweepSphereMoving } from '../physics/collision/sweptSphere.ts'
import { applyImpulse, separateSpheres } from '../physics/collision/response.ts'
import { sentinelBlocks } from '../entities/Sentinel.ts'
import { shieldedByWarden } from '../entities/Warden.ts'
import { damageDrone } from '../entities/Drone.ts'
import { archetypeOf } from '../data/enemies.ts'
import { awardKill, registerHit } from './ScoreSystem.ts'
import { emitBurst } from './ParticleSystem.ts'
import { noteTutorialKill } from './TutorialSystem.ts'
import {
  HIT_IMPULSE,
  CRAFT_MASS,
  CREDITS_PER_CARRIER,
  CREDITS_PER_HARVESTER,
  CREDITS_PER_INTERCEPTOR,
  CREDITS_PER_SAPPER,
  CREDITS_PER_SENTINEL,
  CREDITS_PER_WARDEN,
  DRONE_RADIUS,
  EXPOSED_DAMAGE_MULTIPLIER,
  MAX_ENEMIES,
  PARTICLES_IMPACT,
  PARTICLES_KILL,
  R,
  RADIUS_CRAFT,
  RADIUS_PROJECTILE,
  RAILGUN_GROUND_BONUS,
  RAILGUN_PIERCE,
  SPOTTER_CRIT_ALTITUDE,
  SPOTTER_CRIT_MULTIPLIER,
  SYSTEM_DAMAGE_PER_HULL,
  SYSTEM_FAULT_THRESHOLD,
} from '../data/constants.ts'

const origin: Vec3 = create()
const velocity: Vec3 = create()
const dronePoint: Vec3 = create()
const droneVelocity: Vec3 = create()
const centre: Vec3 = create()
const centreVelocity: Vec3 = create()
const incoming: Vec3 = create()
const scratch: Vec3 = create()

/** Query scratch. Sized to the enemy pool: a query can never return more. */
const candidates = new Int32Array(MAX_ENEMIES)

/** @hot-path */
export function stepCollision(world: World, dt: number): void {
  buildBroadphase(world)
  playerProjectilesVsEnemies(world, dt)
  missilesVsEnemies(world, dt)
  enemyProjectilesVsCraft(world, dt)
  enemyProjectilesVsDrones(world, dt)
  craftVsEnemies(world)
}

/**
 * Only enemies go into the grid.
 *
 * Every query in this system is "what enemies are near this point", so indexing
 * projectiles too would double the insert cost for no query benefit. §23.3's
 * ~20× reduction comes from the queries, not from the fill.
 * @hot-path
 */
function buildBroadphase(world: World): void {
  const grid = world.grid
  grid.clear()

  const { pool, body } = world.enemies
  for (let i = 0; i < pool.count; i++) {
    const slot = pool.dense[i] as number
    grid.insert(slot, body.x[slot] as number, body.y[slot] as number, body.z[slot] as number)
  }
  grid.build()
}

/** @hot-path */
function playerProjectilesVsEnemies(world: World, dt: number): void {
  const store = world.playerProjectiles
  const { pool, body } = store
  const enemies = world.enemies

  for (let i = pool.count - 1; i >= 0; i--) {
    const slot = pool.dense[i] as number

    // Sweep from where the projectile was at the start of the step to where it
    // is now, so the test covers the whole path rather than the endpoint.
    origin.x = body.prevX[slot] as number
    origin.y = body.prevY[slot] as number
    origin.z = body.prevZ[slot] as number
    velocity.x = body.vx[slot] as number
    velocity.y = body.vy[slot] as number
    velocity.z = body.vz[slot] as number

    // The query radius covers the swept segment plus the largest target, so a
    // fast projectile cannot leave the neighbourhood mid-step.
    const reach = length(velocity) * dt + 6
    const found = world.grid.query(origin.x, origin.y, origin.z, reach, candidates)

    for (let c = 0; c < found; c++) {
      const enemySlot = candidates[c] as number
      if (enemies.pool.active[enemySlot] !== 1) continue

      const kind = enemies.kind[enemySlot] as number
      const radius = archetypeOf(kind).radius

      centre.x = enemies.body.x[enemySlot] as number
      centre.y = enemies.body.y[enemySlot] as number
      centre.z = enemies.body.z[enemySlot] as number
      centreVelocity.x = enemies.body.vx[enemySlot] as number
      centreVelocity.y = enemies.body.vy[enemySlot] as number
      centreVelocity.z = enemies.body.vz[enemySlot] as number

      const hit = sweepSphereMoving(origin, velocity, dt, centre, centreVelocity, radius + RADIUS_PROJECTILE)
      if (hit === null) continue

      // §7.3 — a Sentinel's shield is immune, and the shot is stopped rather
      // than passing through. Flanking is the only answer, which is what turns
      // it from a damage sponge into a positioning problem.
      if (kind === EnemyKind.Sentinel) {
        sub(incoming, origin, centre)
        normalize(incoming)
        if (sentinelBlocks(world, enemySlot, incoming)) {
          emitBurst(world, hit.x, hit.y, hit.z, 5, 16, 0.18, 0.35, 'inert', 0.8, null, false)
          store.pool.release(slot)
          break
        }
      }

      registerHit(world)
      emitBurst(world, hit.x, hit.y, hit.z, PARTICLES_IMPACT, 24, 0.25, 0.32, 'friendly', 0.55, null, false)
      world.events.emit(GameEvent.ProjectileHit, enemySlot, store.damage[slot], hit.x, hit.y, hit.z)

      damageEnemy(world, enemySlot, bulletDamage(world, store.damage[slot] as number, enemySlot))

      // Heavy Railgun Slugs: the round carries on through. `pierced` counts the
      // targets this slug has already taken, so it stops after two rather than
      // scything the whole wave from one shot.
      if (world.activePerks.includes('kinetic_railgun')) {
        const pierced = (store.pierced[slot] as number) + 1
        store.pierced[slot] = pierced
        if (pierced <= RAILGUN_PIERCE) continue
      }

      store.pool.release(slot)
      break
    }
  }
}

/**
 * Bullet damage at the moment of impact, with the perks that key off *where*
 * and *what* the target is.
 *
 * Resolved here rather than at spawn because both terms depend on facts that
 * are only true at the hit: whether the target had landed, and how high the
 * craft was when the shot connected.
 * @hot-path
 */
function bulletDamage(world: Readonly<World>, base: number, enemySlot: number): number {
  let damage = base

  // Heavy Railgun Slugs — the anti-armour half of the perk, against anything
  // that has actually touched down.
  if (world.enemies.hasLanded[enemySlot] === 1 && world.activePerks.includes('kinetic_railgun')) {
    damage *= RAILGUN_GROUND_BONUS
  }

  // Apex Orbital Optics — "death from the high frontier", paid out only when
  // the shot really was taken from up there.
  if (world.activePerks.includes('high_orbit_spotter')) {
    const altitude = length(world.craft.position) - R
    if (altitude > SPOTTER_CRIT_ALTITUDE) damage *= SPOTTER_CRIT_MULTIPLIER
  }

  return damage
}

/** @hot-path */
function missilesVsEnemies(world: World, dt: number): void {
  const store = world.missiles
  const { pool, body } = store
  const enemies = world.enemies

  for (let i = pool.count - 1; i >= 0; i--) {
    const slot = pool.dense[i] as number

    origin.x = body.prevX[slot] as number
    origin.y = body.prevY[slot] as number
    origin.z = body.prevZ[slot] as number
    velocity.x = body.vx[slot] as number
    velocity.y = body.vy[slot] as number
    velocity.z = body.vz[slot] as number

    const reach = length(velocity) * dt + 8
    const found = world.grid.query(origin.x, origin.y, origin.z, reach, candidates)

    for (let c = 0; c < found; c++) {
      const enemySlot = candidates[c] as number
      if (enemies.pool.active[enemySlot] !== 1) continue

      const radius = archetypeOf(enemies.kind[enemySlot] as number).radius

      centre.x = enemies.body.x[enemySlot] as number
      centre.y = enemies.body.y[enemySlot] as number
      centre.z = enemies.body.z[enemySlot] as number

      // A missile detonates on proximity rather than contact, so it does not
      // need to pass the shield test — the blast reaches around the plate.
      const hit = sweepSphere(origin, velocity, dt, centre, radius + 1.8)
      if (hit === null) continue

      emitBurst(world, hit.x, hit.y, hit.z, 18, 34, 0.5, 0.5, 'caution', 1, null, true)
      registerHit(world)
      damageEnemy(world, enemySlot, store.damage[slot] as number)
      store.pool.release(slot)
      break
    }
  }
}

/** @hot-path */
function enemyProjectilesVsCraft(world: World, dt: number): void {
  if (!world.craft.alive) return

  const store = world.enemyProjectiles
  const { pool, body } = store
  const craft = world.craft

  for (let i = pool.count - 1; i >= 0; i--) {
    const slot = pool.dense[i] as number

    origin.x = body.prevX[slot] as number
    origin.y = body.prevY[slot] as number
    origin.z = body.prevZ[slot] as number
    velocity.x = body.vx[slot] as number
    velocity.y = body.vy[slot] as number
    velocity.z = body.vz[slot] as number

    const hit = sweepSphereMoving(
      origin,
      velocity,
      dt,
      craft.position,
      craft.velocity,
      RADIUS_CRAFT + RADIUS_PROJECTILE,
    )
    if (hit === null) continue

    sub(incoming, origin, craft.position)
    damageCraft(world, (store.damage[slot] as number) * world.difficulty.enemyDamage * world.loadout.damageTaken, incoming)
    emitBurst(world, hit.x, hit.y, hit.z, 8, 20, 0.2, 0.28, 'hostile', 0.6, null, false)
    store.pool.release(slot)
  }
}

/**
 * Enemy fire against the escort formation (§7.4).
 *
 * Drones have to be killable for the bay's ladder to mean anything — the tier
 * resets when a sortie is lost, and without this nothing could ever lose one.
 * Run after the craft sweep so a round that would hit both spends itself on the
 * player: the drone is the thing you are trying to protect, and a round that
 * passed through you to kill it would read as the game cheating.
 *
 * Deliberately *not* difficulty-scaled. The accessibility axes exist so a
 * player can lower what the game does to *them*; quietly making their escort
 * immortal too would hand out a second, undisclosed advantage.
 * @hot-path
 */
function enemyProjectilesVsDrones(world: World, dt: number): void {
  const drones = world.drones
  if (drones.pool.count === 0) return

  const store = world.enemyProjectiles
  const { pool, body } = store

  for (let i = pool.count - 1; i >= 0; i--) {
    const slot = pool.dense[i] as number

    origin.x = body.prevX[slot] as number
    origin.y = body.prevY[slot] as number
    origin.z = body.prevZ[slot] as number
    velocity.x = body.vx[slot] as number
    velocity.y = body.vy[slot] as number
    velocity.z = body.vz[slot] as number

    // Reverse order: `damageDrone` releases the slot on a kill, and walking the
    // dense list forwards across a release skips whatever backfills it.
    for (let d = drones.pool.count - 1; d >= 0; d--) {
      const drone = drones.pool.dense[d] as number
      dronePoint.x = drones.body.x[drone] as number
      dronePoint.y = drones.body.y[drone] as number
      dronePoint.z = drones.body.z[drone] as number
      droneVelocity.x = drones.body.vx[drone] as number
      droneVelocity.y = drones.body.vy[drone] as number
      droneVelocity.z = drones.body.vz[drone] as number

      const hit = sweepSphereMoving(
        origin,
        velocity,
        dt,
        dronePoint,
        droneVelocity,
        DRONE_RADIUS + RADIUS_PROJECTILE,
      )
      if (hit === null) continue

      damageDrone(world, drone, store.damage[slot] as number)
      emitBurst(world, hit.x, hit.y, hit.z, 6, 18, 0.18, 0.24, 'hostile', 0.5, null, false)
      store.pool.release(slot)
      break
    }
  }
}

/**
 * Craft-vs-enemy contact. Both take damage (§23.4), and the craft is pushed
 * clear so it cannot end the step inside an enemy.
 * @hot-path
 */
function craftVsEnemies(world: World): void {
  if (!world.craft.alive) return

  const craft = world.craft
  const enemies = world.enemies
  const found = world.grid.query(craft.position.x, craft.position.y, craft.position.z, RADIUS_CRAFT + 8, candidates)

  for (let c = 0; c < found; c++) {
    const enemySlot = candidates[c] as number
    if (enemies.pool.active[enemySlot] !== 1) continue

    const kind = enemies.kind[enemySlot] as number
    const radius = archetypeOf(kind).radius

    centre.x = enemies.body.x[enemySlot] as number
    centre.y = enemies.body.y[enemySlot] as number
    centre.z = enemies.body.z[enemySlot] as number

    if (separateSpheres(craft.position, craft.velocity, centre, RADIUS_CRAFT + radius, HIT_IMPULSE * 2, CRAFT_MASS)) {
      sub(incoming, centre, craft.position)
      damageCraft(world, 8 * world.difficulty.enemyDamage * world.loadout.damageTaken, incoming)
      damageEnemy(world, enemySlot, 1)
    }
  }
}

/**
 * Applies damage and, if it kills, settles everything a death owes: score,
 * bounty, perks, particles and the pool slot.
 *
 * **Every damage source must come through here.** Two of them did not — the bomb
 * blast and the chain-lightning arc wrote `hp` directly — and an enemy taken to
 * zero by either simply kept existing at negative health: no explosion, no
 * points, no credits, and a landed Harvester carried on draining the outpost it
 * had been "killed" over.
 *
 * `chain` is false for the arc itself, so a chain kill cannot re-enter the arc
 * and cascade through the whole wave from one shot.
 * @hot-path
 */
export function damageEnemy(world: World, slot: number, amount: number, chain = true): void {
  const enemies = world.enemies
  if (enemies.pool.active[slot] !== 1) return

  /*
   * §7.3 — a Warden's field makes everything inside it immune.
   *
   * Checked here rather than at each weapon's impact site, for the same reason
   * the docstring above insists every damage source comes through this function:
   * there are seven of them — cannon, missile, bomb, cluster, drone, ram and the
   * chain-lightning arc — and a rule enforced at the call sites is a rule that
   * six of them will eventually be written without. The Sentinel's shield is
   * the counter-example and it earns the exception: it is *directional*, so it
   * has to be tested against the incoming ray at the point of impact, which only
   * the impact site knows.
   *
   * The absorption is announced. A radial field has no silhouette of its own to
   * make its boundary legible, so without this the player experiences damage
   * quietly failing — which is precisely the fault the Sentinel's visible shield
   * arc was rebuilt to remove.
   */
  if (shieldedByWarden(world, slot)) {
    const bx = enemies.body.x[slot] as number
    const by = enemies.body.y[slot] as number
    const bz = enemies.body.z[slot] as number
    // The same inert spark the Sentinel's shield throws, for the same reason and
    // in the same colour: a player who has learned "grey sparks mean that did
    // nothing" gets to reuse the lesson rather than learn a second one.
    emitBurst(world, bx, by, bz, 5, 16, 0.18, 0.35, 'inert', 0.8, null, false)
    world.events.emit(GameEvent.WardenAbsorbed, slot, 0, bx, by, bz)
    return
  }

  // §7.3 — an Interceptor caught in the overshoot of a failed attack run takes
  // multiplied damage. This is the payout for the whole bait-and-break dance,
  // and it is applied here so *every* source benefits: cannon, drone, missile,
  // bomb and afterburner alike.
  const scaled =
    enemies.phase[slot] === EnemyPhase.Exposed ? amount * EXPOSED_DAMAGE_MULTIPLIER : amount

  const remaining = (enemies.hp[slot] as number) - scaled
  enemies.hp[slot] = remaining
  if (remaining > 0) return

  const kind = enemies.kind[slot] as number
  const hadLanded = enemies.hasLanded[slot] === 1

  const x = enemies.body.x[slot] as number
  const y = enemies.body.y[slot] as number
  const z = enemies.body.z[slot] as number

  const points = awardKill(world, kind, hadLanded)
  noteTutorialKill(world)

  // Combat bounties, from `constants.ts` rather than from a ladder written out
  // here. The inline version listed three archetypes and defaulted everything
  // else to a Harvester's 80, so a Carrier — the most expensive kill in the game
  // — would have paid the least of any of the six.
  let bounty = bountyFor(kind)
  if (world.activePerks.includes('bounty_protocol')) bounty = Math.round(bounty * 1.5)
  world.credits += bounty
  // Also onto the wave, which is what the shell actually banks. `world.credits`
  // alone was written by every kill and read by nothing.
  world.wave.creditsEarned += bounty

  // Thermal Siphon perk: vent 50% heat and restore 10% boost charge on kill
  if (world.activePerks.includes('thermal_siphon')) {
    world.craft.heat = Math.max(0, world.craft.heat - 50)
    world.craft.boostCharge = Math.min(1, world.craft.boostCharge + 0.1)
  }

  // Plasma Chain Lightning perk: arc electricity to up to 2 nearby enemies
  if (chain && world.activePerks.includes('chain_lightning')) {
    const { pool, body } = world.enemies
    let arcs = 0
    for (let k = pool.count - 1; k >= 0 && arcs < 2; k--) {
      const otherSlot = pool.dense[k] as number
      if (otherSlot === slot || pool.active[otherSlot] !== 1) continue
      const ox = (body.x[otherSlot] as number) - x
      const oy = (body.y[otherSlot] as number) - y
      const oz = (body.z[otherSlot] as number) - z
      if (ox * ox + oy * oy + oz * oz < 30 * 30) {
        emitBurst(world, body.x[otherSlot] as number, body.y[otherSlot] as number, body.z[otherSlot] as number, 10, 18, 0.2, 0.3, 'friendly', 0.8, null, false)
        damageEnemy(world, otherSlot, 15, false)
        arcs++
      }
    }
  }

  emitBurst(world, x, y, z, PARTICLES_KILL, 30, 0.9, 0.45, 'hostile', 1, null, true)
  world.events.emit(GameEvent.EnemyKilled, kind, points, x, y, z)

  enemies.pool.release(slot)
}

/**
 * The credit bounty for killing one of each archetype.
 *
 * Tracks the score ladder rather than restating it in a different shape: a
 * Carrier is the most valuable thing to kill under both, because it is the only
 * kill that prevents future work.
 * @hot-path
 */
function bountyFor(kind: number): number {
  switch (kind) {
    case EnemyKind.Sentinel:
      return CREDITS_PER_SENTINEL
    case EnemyKind.Interceptor:
      return CREDITS_PER_INTERCEPTOR
    case EnemyKind.Carrier:
      return CREDITS_PER_CARRIER
    case EnemyKind.Warden:
      return CREDITS_PER_WARDEN
    case EnemyKind.Sapper:
      return CREDITS_PER_SAPPER
    default:
      return CREDITS_PER_HARVESTER
  }
}

/**
 * Applies damage to the craft, records where it came from for the directional
 * vignette, and adds trauma.
 *
 * `from` points from the craft toward the source. The bearing is stored rather
 * than the vector so the HUD can render the vignette without re-deriving the
 * tangent basis (§13.4 — damage feedback is directional, so the player learns
 * *where* the threat is rather than merely that they are hurt).
 * @hot-path
 */
export function damageCraft(world: World, amount: number, from: Readonly<Vec3>): void {
  const craft = world.craft
  if (!craft.alive || amount <= 0) return

  // Aegis Shield absorbs damage first
  let remainingDmg = amount
  if (craft.aegisShield > 0) {
    if (craft.aegisShield >= remainingDmg) {
      craft.aegisShield -= remainingDmg
      remainingDmg = 0
    } else {
      remainingDmg -= craft.aegisShield
      craft.aegisShield = 0
    }
  }

  craft.hull -= remainingDmg
  world.wave.damageTakenThisWave += remainingDmg
  craft.trauma = Math.min(1, craft.trauma + Math.min(0.5, amount / 45))

  // A hit lands *somewhere*. See `damageSystem`.
  if (remainingDmg > 0) damageSystem(world, remainingDmg)

  copy(scratch, from)
  normalize(scratch)
  // Project into the tangent plane and read off the bearing against the frame.
  const radial = dot(scratch, craft.frame.up)
  scratch.x -= craft.frame.up.x * radial
  scratch.y -= craft.frame.up.y * radial
  scratch.z -= craft.frame.up.z * radial
  normalize(scratch)
  craft.lastHitBearing = Math.atan2(dot(scratch, craft.frame.right), dot(scratch, craft.frame.forward))

  applyImpulse(craft.velocity, from, HIT_IMPULSE, CRAFT_MASS)

  world.events.emit(
    GameEvent.PlayerHit,
    0,
    amount,
    craft.position.x,
    craft.position.y,
    craft.position.z,
  )

  destroyIfHullGone(world)
}

/**
 * Puts a hit into a subsystem (§7.6).
 *
 * Hull alone makes damage a *quantity*: forty points off feels identical
 * whatever hit you and changes nothing about the next thirty seconds. A hit that
 * takes the stabiliser with it is something you have to fly around — the craft
 * pulls, the guns stutter, the engine surges — and that turns "I got shot" into
 * a situation rather than a number.
 *
 * Which system takes it is drawn from `world.rng`, so it is part of the seeded,
 * replayable run rather than an out-of-band roll. The scaling is deliberately
 * gentle — a system is not wrecked by a single hit, and an outpost pass repairs
 * everything — because the point is friction the player can work against, not a
 * second health bar to lose.
 * @hot-path
 */
function damageSystem(world: World, amount: number): void {
  const craft = world.craft
  const systems = craft.systems
  const severity = Math.min(0.4, amount * SYSTEM_DAMAGE_PER_HULL)

  const roll = world.rng.range(0, 3)
  if (roll < 1) {
    const before = systems.engine
    systems.engine = Math.max(0, before - severity)
    if (before > SYSTEM_FAULT_THRESHOLD && systems.engine <= SYSTEM_FAULT_THRESHOLD) {
      world.events.emit(GameEvent.SystemDamaged, 0, systems.engine, craft.position.x, craft.position.y, craft.position.z)
    }
  } else if (roll < 2) {
    const before = systems.weapon
    systems.weapon = Math.max(0, before - severity)
    if (before > SYSTEM_FAULT_THRESHOLD && systems.weapon <= SYSTEM_FAULT_THRESHOLD) {
      world.events.emit(GameEvent.SystemDamaged, 1, systems.weapon, craft.position.x, craft.position.y, craft.position.z)
    }
  } else {
    const before = systems.control
    systems.control = Math.max(0, before - severity)
    // The drift direction is fixed the first time the stabiliser is hurt and
    // held from then on: a pull that keeps changing sides is turbulence the
    // player cannot learn, while a constant one is a fault they can trim out.
    if (before >= 1) craft.driftBias = world.rng.range(0, 1) < 0.5 ? -1 : 1
    if (before > SYSTEM_FAULT_THRESHOLD && systems.control <= SYSTEM_FAULT_THRESHOLD) {
      world.events.emit(GameEvent.SystemDamaged, 2, systems.control, craft.position.x, craft.position.y, craft.position.z)
    }
  }
}

/**
 * Ends the craft if its hull has run out. Idempotent.
 */
export function destroyIfHullGone(world: World): void {
  const craft = world.craft
  if (!craft.alive || craft.hull > 0) return

  // Emergency Warp Perk saves player once per run!
  if (world.activePerks.includes('emergency_warp')) {
    world.activePerks = world.activePerks.filter((p) => p !== 'emergency_warp')
    craft.hull = 25
    craft.trauma = 0.5
    emitBurst(world, craft.position.x, craft.position.y, craft.position.z, 30, 24, 1.0, 0.5, 'friendly', 1, null, true)
    return
  }

  craft.hull = 0
  craft.alive = false
  craft.trauma = 1
  emitBurst(world, craft.position.x, craft.position.y, craft.position.z, 40, 36, 1.2, 0.6, 'critical', 1, null, true)
  world.events.emit(
    GameEvent.PlayerDestroyed,
    0,
    0,
    craft.position.x,
    craft.position.y,
    craft.position.z,
  )
}
