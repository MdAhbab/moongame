/**
 * Heavy bomb bay ordnance — release, ballistic fall, and detonation (§7.4).
 *
 * A bomb is the only thing in the game the player throws *away* from the nose,
 * and the only one that obeys nothing but momentum and gravity once it is gone.
 * That makes two properties load-bearing:
 *
 *  1. **It keeps the whole of the craft's velocity.** It used to keep 70% of it,
 *     which is not a physics — it is a number that made the payload land
 *     somewhere between where momentum said and where the picture said, and no
 *     predictor could be honest about it.
 *  2. **One integrator, used twice.** `stepBombs` and `predictBombImpact` call
 *     the same function with the same `dt`, so the impact marker on the HUD is
 *     not a model of the trajectory, it is the trajectory run ahead of time.
 */
import type { BombStore, World } from '../core/World.ts'
import { GameEvent } from '../core/World.ts'
import type { Vec3 } from '../math/vec3.ts'
import { create, cross, length, normalize } from '../math/vec3.ts'
import {
  BOMB_BLAST_RADIUS,
  BOMB_DAMAGE,
  BOMB_GRAVITY_SCALE,
  BOMB_LIFE,
  BOMB_SURFACE_CLEARANCE,
  CLUSTER_COUNT,
  CLUSTER_DAMAGE_SHARE,
  CLUSTER_FUSE,
  CLUSTER_SPREAD_SPEED,
  FIXED_DT,
  G,
  MAX_ENEMIES,
  R,
} from '../data/constants.ts'
import { emitBurst } from '../systems/ParticleSystem.ts'
import { damageEnemy } from '../systems/CollisionSystem.ts'

const scratchPos: Vec3 = create()
const scratchDir: Vec3 = create()
const enemyPos: Vec3 = create()
const tangentA: Vec3 = create()
const tangentB: Vec3 = create()

/** Blast query scratch. Sized to the enemy pool: a blast can never catch more. */
const blastTargets = new Int32Array(MAX_ENEMIES)

/** Radial distance at which a bomb counts as having hit the ground. */
const IMPACT_RADIUS = R + BOMB_SURFACE_CLEARANCE

/**
 * The velocity a bomb leaves the bay with.
 *
 * Carrier velocity plus an ejection kick along the bay's axis. Shared by the
 * spawn path and the predictor so the two cannot drift apart.
 * @hot-path
 */
export function bombLaunchVelocity(
  out: Vec3,
  carrierVelocity: Readonly<Vec3>,
  down: Readonly<Vec3> | undefined,
  ejectSpeed: number,
): Vec3 {
  out.x = carrierVelocity.x + (down === undefined ? 0 : down.x * ejectSpeed)
  out.y = carrierVelocity.y + (down === undefined ? 0 : down.y * ejectSpeed)
  out.z = carrierVelocity.z + (down === undefined ? 0 : down.z * ejectSpeed)
  return out
}

/**
 * Spawns a heavy bomb from the craft's belly bay.
 * @hot-path
 */
export function spawnBomb(
  store: BombStore,
  origin: Readonly<Vec3>,
  velocity: Readonly<Vec3>,
  downVector?: Readonly<Vec3>,
  speed = 10,
  damage = BOMB_DAMAGE,
  blastRadius = BOMB_BLAST_RADIUS,
): number {
  const slot = store.pool.alloc()
  if (slot < 0) return -1

  bombLaunchVelocity(scratchDir, velocity, downVector, speed)

  store.body.spawnAt(slot, origin.x, origin.y, origin.z, scratchDir.x, scratchDir.y, scratchDir.z)
  store.damage[slot] = damage
  store.blastRadius[slot] = blastRadius
  store.life[slot] = BOMB_LIFE
  store.clustered[slot] = 0
  return slot
}

/**
 * One semi-implicit Euler step of free fall in radial gravity.
 *
 * `position` and `velocity` are advanced in place. Velocity first, then position
 * from the *new* velocity — the same order `physics/integrate.ts` uses for the
 * craft, and the reason both are symplectic rather than slowly gaining energy.
 * @hot-path
 */
export function stepBallistic(position: Vec3, velocity: Vec3, gravity: number, dt: number): void {
  const distance = Math.sqrt(position.x * position.x + position.y * position.y + position.z * position.z)
  if (distance > 1e-3) {
    // a = −g · p̂. Dividing by `distance` normalises the position vector in the
    // same multiply that scales it, so there is no separate normalise here.
    const pull = (gravity * dt) / distance
    velocity.x -= position.x * pull
    velocity.y -= position.y * pull
    velocity.z -= position.z * pull
  }
  position.x += velocity.x * dt
  position.y += velocity.y * dt
  position.z += velocity.z * dt
}

/** Gravity acting on released ordnance in this world. @hot-path */
function bombGravity(world: Readonly<World>): number {
  return G * BOMB_GRAVITY_SCALE * world.environment.gravity
}

const predictPosition: Vec3 = create()
const predictVelocity: Vec3 = create()

/**
 * Runs a release forward to the surface and reports where and when it lands.
 *
 * Returns the time of flight in seconds, or -1 if the bomb would still be in the
 * air when its fuse runs out — in which case there is nothing honest to draw.
 *
 * The cost is bounded and small: a drop from cruise altitude converges in about
 * 130 steps, and the fuse caps the worst case. Run once per fixed step for one
 * hypothetical bomb, which is the price of a HUD marker that cannot lie.
 * @hot-path
 */
export function predictBombImpact(
  world: Readonly<World>,
  origin: Readonly<Vec3>,
  velocity: Readonly<Vec3>,
  out: Vec3,
): number {
  predictPosition.x = origin.x
  predictPosition.y = origin.y
  predictPosition.z = origin.z
  predictVelocity.x = velocity.x
  predictVelocity.y = velocity.y
  predictVelocity.z = velocity.z

  const gravity = bombGravity(world)
  const steps = Math.ceil(BOMB_LIFE / FIXED_DT)

  for (let i = 0; i < steps; i++) {
    stepBallistic(predictPosition, predictVelocity, gravity, FIXED_DT)
    const radiusSq =
      predictPosition.x * predictPosition.x +
      predictPosition.y * predictPosition.y +
      predictPosition.z * predictPosition.z
    if (radiusSq <= IMPACT_RADIUS * IMPACT_RADIUS) {
      out.x = predictPosition.x
      out.y = predictPosition.y
      out.z = predictPosition.z
      return (i + 1) * FIXED_DT
    }
  }
  return -1
}

/**
 * Advances all live bombs along their ballistic orbital gravity trajectory.
 * @hot-path
 */
export function stepBombs(world: World, dt: number): void {
  const store = world.bombs
  const { pool, body, damage, blastRadius, life } = store
  const gravity = bombGravity(world)

  for (let i = pool.count - 1; i >= 0; i--) {
    const slot = pool.dense[i] as number

    // Save previous for render interpolation
    body.savePrevious(slot)

    const remainingLife = (life[slot] as number) - dt
    life[slot] = remainingLife

    scratchPos.x = body.x[slot] as number
    scratchPos.y = body.y[slot] as number
    scratchPos.z = body.z[slot] as number
    scratchDir.x = body.vx[slot] as number
    scratchDir.y = body.vy[slot] as number
    scratchDir.z = body.vz[slot] as number

    stepBallistic(scratchPos, scratchDir, gravity, dt)

    body.x[slot] = scratchPos.x
    body.y[slot] = scratchPos.y
    body.z[slot] = scratchPos.z
    body.vx[slot] = scratchDir.x
    body.vy[slot] = scratchDir.y
    body.vz[slot] = scratchDir.z

    const radiusSq = scratchPos.x * scratchPos.x + scratchPos.y * scratchPos.y + scratchPos.z * scratchPos.z
    if (radiusSq <= IMPACT_RADIUS * IMPACT_RADIUS || remainingLife <= 0) {
      detonateBomb(
        world,
        scratchPos.x,
        scratchPos.y,
        scratchPos.z,
        damage[slot] as number,
        blastRadius[slot] as number,
        store.clustered[slot] === 1,
      )
      pool.release(slot)
    }
  }
}

/**
 * Detonates a bomb with massive ground shockwave and AOE damage.
 * @hot-path
 */
function detonateBomb(
  world: World,
  x: number,
  y: number,
  z: number,
  baseDamage: number,
  baseRadius: number,
  clustered: boolean,
): void {
  scratchPos.x = x
  scratchPos.y = y
  scratchPos.z = z

  const isSingularity = world.activePerks.includes('singularity_bomb')
  const isOrbital = world.activePerks.includes('orbital_bombs')
  const isSeismic = world.activePerks.includes('seismic_shock')

  const radius = baseRadius * (isOrbital ? 1.6 : 1.0)
  const radiusSq = radius * radius
  // `baseDamage` already carries the loadout multiplier from the drop site;
  // applying it a second time here squared the perk's effect.
  const effectiveDamage = baseDamage

  // 1. Massive explosive particle burst on the surface
  emitBurst(world, x, y, z, 48, 22, 1.2, 0.8, 'flare', 1, null, true)
  emitBurst(world, x, y, z, 32, 14, 0.9, 0.6, 'critical', 1, null, true)

  // 2. Camera trauma if player is within 80u of explosion
  scratchDir.x = world.craft.position.x - x
  scratchDir.y = world.craft.position.y - y
  scratchDir.z = world.craft.position.z - z
  const distToPlayer = length(scratchDir)
  if (distToPlayer < 90) {
    const intensity = (1 - distToPlayer / 90) * 0.45
    world.craft.trauma = Math.min(1, world.craft.trauma + intensity)
  }

  // 3. Shockwave damage & gravity pulling against enemies
  //
  // Two passes, and the split is load-bearing. `damageEnemy` releases the slot
  // on a kill — and with Chain Lightning equipped it may release *others* too —
  // and the pool removes from its dense list by swapping in the last entry. A
  // single loop over `dense` that damages as it walks would therefore step over
  // enemies standing inside the blast. Gathering first costs one small array
  // and makes the blast independent of pool churn.
  const { pool: enemyPool, body: enemyBody } = world.enemies
  let found = 0

  for (let j = 0; j < enemyPool.count && found < blastTargets.length; j++) {
    const enemySlot = enemyPool.dense[j] as number
    const dx = (enemyBody.x[enemySlot] as number) - x
    const dy = (enemyBody.y[enemySlot] as number) - y
    const dz = (enemyBody.z[enemySlot] as number) - z
    if (dx * dx + dy * dy + dz * dz <= radiusSq) blastTargets[found++] = enemySlot
  }

  for (let j = 0; j < found; j++) {
    const enemySlot = blastTargets[j] as number
    if (enemyPool.active[enemySlot] !== 1) continue

    enemyPos.x = enemyBody.x[enemySlot] as number
    enemyPos.y = enemyBody.y[enemySlot] as number
    enemyPos.z = enemyBody.z[enemySlot] as number

    scratchDir.x = enemyPos.x - x
    scratchDir.y = enemyPos.y - y
    scratchDir.z = enemyPos.z - z
    const dist = Math.sqrt(
      scratchDir.x * scratchDir.x + scratchDir.y * scratchDir.y + scratchDir.z * scratchDir.z,
    )

    const falloff = 1 - (dist / radius) * 0.5 // minimum 50% damage at outer edge
    const hitDmg = Math.round(effectiveDamage * falloff)

    // Singularity pull or Seismic shockwave, applied *before* the damage: a
    // kill releases the slot, and writing velocity into a released slot would
    // shove whichever enemy the pool moves in next.
    if (dist > 1e-4 && (isSingularity || isSeismic)) {
      normalize(scratchDir)
      const push = isSingularity ? -25 : 30
      enemyBody.vx[enemySlot] = (enemyBody.vx[enemySlot] as number) + scratchDir.x * push
      enemyBody.vy[enemySlot] = (enemyBody.vy[enemySlot] as number) + scratchDir.y * push
      enemyBody.vz[enemySlot] = (enemyBody.vz[enemySlot] as number) + scratchDir.z * push
    }

    world.events.emit(GameEvent.ProjectileHit, enemySlot, hitDmg, enemyPos.x, enemyPos.y, enemyPos.z)

    // Through the kill path, not straight into `hp`. Writing the array directly
    // left bombed enemies sitting at negative health, alive, unscored and
    // undrainable-from — a Harvester "killed" by a bomb kept draining the
    // outpost it had landed on.
    damageEnemy(world, enemySlot, hitDmg)
  }

  // 4. Orbital Saturation Bay: the cluster half of the perk, which the
  //    description has always promised and the code never delivered. Four
  //    sub-munitions are thrown out along the surface and detonate on their own
  //    a moment later, so the crater is saturated rather than merely widened.
  if (isOrbital && !clustered) {
    scatterSubmunitions(world, x, y, z, baseDamage)
  }

  world.events.emit(GameEvent.TerrainImpact, 0, effectiveDamage, x, y, z)
}

/**
 * Throws four cluster rounds clear of the impact point.
 *
 * Spawned as ordinary bombs with a short fuse and a tangential kick, so they
 * arc, land and detonate through exactly the same path as the parent. They are
 * marked `clustered` so they cannot cluster again — four bombs each spawning
 * four more is a chain reaction, not a weapon.
 */
function scatterSubmunitions(world: World, x: number, y: number, z: number, damage: number): void {
  const store = world.bombs

  // A tangent basis at the impact point, so the spread lies along the ground.
  scratchPos.x = x
  scratchPos.y = y
  scratchPos.z = z
  normalize(scratchPos)
  tangentA.x = Math.abs(scratchPos.z) < 0.9 ? 0 : 1
  tangentA.y = Math.abs(scratchPos.z) < 0.9 ? 0 : 0
  tangentA.z = Math.abs(scratchPos.z) < 0.9 ? 1 : 0
  cross(tangentB, scratchPos, tangentA)
  normalize(tangentB)
  cross(tangentA, tangentB, scratchPos)
  normalize(tangentA)

  for (let i = 0; i < CLUSTER_COUNT; i++) {
    const angle = (i / CLUSTER_COUNT) * Math.PI * 2
    const slot = store.pool.alloc()
    if (slot < 0) return

    const px = x + scratchPos.x * 3
    const py = y + scratchPos.y * 3
    const pz = z + scratchPos.z * 3
    const vx = (tangentA.x * Math.cos(angle) + tangentB.x * Math.sin(angle)) * CLUSTER_SPREAD_SPEED
    const vy = (tangentA.y * Math.cos(angle) + tangentB.y * Math.sin(angle)) * CLUSTER_SPREAD_SPEED
    const vz = (tangentA.z * Math.cos(angle) + tangentB.z * Math.sin(angle)) * CLUSTER_SPREAD_SPEED

    store.body.spawnAt(slot, px, py, pz, vx, vy, vz)
    store.damage[slot] = damage * CLUSTER_DAMAGE_SHARE
    store.blastRadius[slot] = BOMB_BLAST_RADIUS * 0.6
    store.life[slot] = CLUSTER_FUSE
    store.clustered[slot] = 1
  }
}
