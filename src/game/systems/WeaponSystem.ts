/**
 * Weapons — pulse cannon, heat, and the lock missile (gameplan §7.4, §8.4).
 *
 * **Heat instead of ammo.** Ammo requires pickups, which requires spawning
 * them, which pulls attention away from the outposts. Heat is self-regulating,
 * needs no world objects, and creates a burst–reposition–burst rhythm that fits
 * flying. It also makes "hold the button forever" self-defeating without
 * punishing the player with scarcity.
 *
 * **The crosshair cannot lie.** Bullets travel exactly along the nose ray,
 * always. V1 lerped fire direction 60% toward an auto-aim target while the
 * reticle sat at screen centre (`game.js:510`) — the interface asserted
 * precision aiming and the system did something else. Assist here is *visible
 * reticle magnetism* computed for the UI, never a redirection of the shot
 * (§8.4).
 */
import type { World } from '../core/World.ts'
import { GameEvent } from '../core/World.ts'
import { type Vec3, addScaled, copy, create, dot, length, normalize, sub } from '../math/vec3.ts'
import { clamp } from '../physics/springs.ts'
import { spawnProjectile } from '../entities/Projectile.ts'
import { spawnMissile } from '../entities/Missile.ts'
import { archetypeOf } from '../data/enemies.ts'
import { emitBurst } from './ParticleSystem.ts'
import {
  ASSIST_MAX_ANGLE,
  BULLET_DAMAGE,
  BULLET_LIFE,
  BULLET_SPEED,
  FIRE_INTERVAL,
  FLARE_COOLDOWN,
  FLARE_DURATION,
  HEAT_DECAY_DELAY,
  HEAT_DECAY_PER_S,
  HEAT_LOCKOUT_S,
  HEAT_MAX,
  HEAT_PER_SHOT,
  LOCK_BREAK_HALF_ANGLE,
  LOCK_CONE_HALF_ANGLE,
  LOCK_MEMORY,
  LOCK_RANGE,
  LOCK_TIME,
  SPOTTER_LOCK_SCALE,
  SYSTEM_FAULT_THRESHOLD,
  MISSILE_COOLDOWN,
  MISSILE_DAMAGE,
  CRAFT_MUZZLE_OFFSET,
  BOMB_BASE_COOLDOWN,
  BOMB_DAMAGE,
  BOMB_BLAST_RADIUS,
  BOMB_SPEED,
} from '../data/constants.ts'
import { bombLaunchVelocity, predictBombImpact, spawnBomb, stepBombs } from '../entities/Bomb.ts'
import { stepDrones } from '../entities/Drone.ts'
import { applyEmpBurst, fireSolarLance, stepPerks } from './PerkSystem.ts'

const muzzle: Vec3 = create()
const toTarget: Vec3 = create()
const targetPosition: Vec3 = create()
const flareDir: Vec3 = create()
const bombDown: Vec3 = create()
const bombVelocity: Vec3 = create()

/**
 * The reticle's magnetised aim point, in world space.
 *
 * Read by the render layer to draw where the reticle has been pulled to. The
 * *shot* still leaves along `craft.nose`; this is only where the crosshair is
 * drawn, so the player literally watches the assist happen and the interface
 * never contradicts the weapon.
 */
export const reticleAim: Vec3 = create()
/** True while the reticle is magnetised onto something. */
export let reticleMagnetised = false

/* ------------------------------------------------------------------ */
/* Aim solutions, published for the HUD                                */
/* ------------------------------------------------------------------ */

/**
 * Where the tracked target will be when a bullet fired now could reach it.
 *
 * Solved rather than guessed: with the target at `p` moving at `v` relative to
 * the craft and a bullet at speed `s`, the intercept time is the positive root
 * of `|p + v·t| = s·t`, which is a plain quadratic. Drawn as a second, hollow
 * pip so the player can see the difference between where a thing *is* and where
 * to shoot — the whole skill of deflection shooting, made teachable.
 *
 * This is presentation only. `fire()` still sends the bullet down `craft.nose`,
 * exactly as §8.4 requires.
 */
export const leadAim: Vec3 = create()
/** True when `leadAim` holds a real solution this step. */
export let leadValid = false

/**
 * Where a bomb released *this instant* would strike the surface.
 *
 * Integrated with the same radial-gravity stepper the bombs themselves run, at
 * the same fixed `dt`, from the same launch velocity — so the marker is not an
 * approximation of the trajectory, it *is* the trajectory. Anything less would
 * be a HUD that lies about the physics, which is the exact failure §8.4 exists
 * to forbid.
 */
export const bombImpact: Vec3 = create()
/** True when the bomb solution converged on the surface within its flight time. */
export let bombImpactValid = false
/** Seconds of fall between release and impact, for the marker's readout. */
export let bombImpactTime = 0

/** @hot-path */
export function stepWeapons(world: World, dt: number): void {
  const craft = world.craft

  stepBombs(world, dt)
  updateHeat(world, dt)
  updateFlares(world, dt)
  updateBombs(world, dt)
  stepPerks(world, dt)
  stepDrones(world, dt)

  if (craft.fireCooldown > 0) craft.fireCooldown -= dt
  if (craft.missileCooldown > 0) craft.missileCooldown -= dt

  if (!craft.alive) {
    craft.lock = { kind: 'Idle' }
    craft.lockHold = 0
    updateAssist(world)
    updateAimSolutions(world)
    return
  }

  // Weapon mode. On the press *edge*, never the held flag — see
  // `InputSystem.deriveEdges` for what reading the held flag did to this.
  if (world.input.switchWeaponPressed) {
    craft.activeWeaponMode = craft.activeWeaponMode === 'cannon' ? 'missiles' : 'cannon'
    world.events.emit(
      GameEvent.WeaponSwitched,
      craft.activeWeaponMode === 'missiles' ? 1 : 0,
      0,
      craft.position.x,
      craft.position.y,
      craft.position.z,
    )
  }

  // The lock is resolved *before* the trigger is read, so a missile fired on the
  // same step the lock completes goes to the target rather than one step late.
  updateLock(world, dt)

  if (world.input.firing) {
    if (craft.activeWeaponMode === 'missiles') {
      // A lock is an advantage, not a requirement: firing without one sends an
      // unguided rocket down the nose. The player is never blocked by the
      // interface, they are merely rewarded for having waited.
      if (craft.missileCooldown <= 0) launchMissile(world, lockedTarget(world))
    } else if (craft.fireCooldown <= 0 && craft.weapon.kind === 'Ready') {
      fire(world)
    }
  }

  updateAssist(world)
  updateAimSolutions(world)
}

/** The enemy slot a completed lock is holding, or -1. */
export function lockedTarget(world: Readonly<World>): number {
  return world.craft.lock.kind === 'Locked' ? world.craft.lock.target : -1
}

/** The enemy slot the lock is working on or holding, or -1. Used by the HUD. */
export function trackedTarget(world: Readonly<World>): number {
  const lock = world.craft.lock
  return lock.kind === 'Idle' ? -1 : lock.target
}

/**
 * Heavy Bomb Bay drop handling.
 * @hot-path
 */
function updateBombs(world: World, dt: number): void {
  const craft = world.craft
  if (craft.bombCooldown > 0) craft.bombCooldown -= dt

  if (!craft.alive) return

  // The press edge, not the held flag: a bomb is an act. Holding the key used
  // to arm an automatic drop the instant each cooldown expired, twenty seconds
  // apart, with nothing on screen to say it was about to happen.
  if (world.input.bombPressed && craft.bombCooldown <= 0) {
    const isRapid = world.activePerks.includes('rapid_ordnance')
    const isOrbital = world.activePerks.includes('orbital_bombs')

    bombBayPoint(world, muzzle, bombDown)

    const dmg = BOMB_DAMAGE * world.loadout.bulletDamage
    const radius = BOMB_BLAST_RADIUS * (isOrbital ? 1.6 : 1.0)
    spawnBomb(world.bombs, muzzle, craft.velocity, bombDown, BOMB_SPEED, dmg, radius)

    const baseCd = Math.max(7, BOMB_BASE_COOLDOWN - world.wave.number * 0.8)
    craft.bombCooldown = isRapid ? baseCd * 0.65 : baseCd

    world.events.emit(GameEvent.BombDropped, 0, dmg, muzzle.x, muzzle.y, muzzle.z)
  }
}

/**
 * Where a bomb leaves the craft, and which way the bay ejects it.
 *
 * One function so the predictor and the drop cannot disagree: the marker on the
 * HUD is computed from exactly the release state the bomb will be spawned with.
 * "Down" is radially down — the bay points at the moon's centre regardless of
 * how the craft is banked, because a payload on rails does not care about the
 * pilot's attitude.
 * @hot-path
 */
function bombBayPoint(world: Readonly<World>, outOrigin: Vec3, outDown: Vec3): void {
  const craft = world.craft
  outDown.x = -craft.frame.up.x
  outDown.y = -craft.frame.up.y
  outDown.z = -craft.frame.up.z

  copy(outOrigin, craft.position)
  addScaled(outOrigin, outDown, 2.0)
}

/**
 * Flares / Countermeasures.
 * Deploys glowing decoy heat sources behind the craft to spoof incoming enemy
 * fire, disrupt enemy target acquisition, and clear nearby hostile homing projectiles.
 * @hot-path
 */
function updateFlares(world: World, dt: number): void {
  const craft = world.craft

  if (craft.flareCooldown > 0) craft.flareCooldown -= dt
  if (craft.flareActiveTimer > 0) craft.flareActiveTimer -= dt

  if (!craft.alive) return

  if (world.input.flarePressed && craft.flareCooldown <= 0 && craft.flaresRemaining > 0) {
    craft.flaresRemaining--
    craft.flareCooldown = FLARE_COOLDOWN
    craft.flareActiveTimer = FLARE_DURATION

    // Spawn radiant flare decoy particles
    copy(flareDir, craft.frame.forward)
    flareDir.x = -flareDir.x
    flareDir.y = -flareDir.y
    flareDir.z = -flareDir.z

    emitBurst(
      world,
      craft.position.x,
      craft.position.y,
      craft.position.z,
      16,
      28,
      1.6,
      0.8,
      'flare',
      0.85,
      flareDir,
      true,
    )

    // Neutralize enemy projectiles in close proximity (flare deflection aura)
    const enemyProj = world.enemyProjectiles
    for (let i = enemyProj.pool.count - 1; i >= 0; i--) {
      const slot = enemyProj.pool.dense[i] as number
      const dx = (enemyProj.body.x[slot] as number) - craft.position.x
      const dy = (enemyProj.body.y[slot] as number) - craft.position.y
      const dz = (enemyProj.body.z[slot] as number) - craft.position.z
      if (dx * dx + dy * dy + dz * dz < 40 * 40) {
        emitBurst(world, enemyProj.body.x[slot] as number, enemyProj.body.y[slot] as number, enemyProj.body.z[slot] as number, 3, 10, 0.2, 0.2, 'flare', 1, null, false)
        enemyProj.pool.release(slot)
      }
    }

    applyEmpBurst(world)

    world.events.emit(
      GameEvent.FlareDeployed,
      craft.flaresRemaining,
      FLARE_DURATION,
      craft.position.x,
      craft.position.y,
      craft.position.z,
    )
  }
}

/**
 * Each shot adds 4% heat; heat decays 30%/s after a 0.4 s delay; at 100% the
 * weapon locks out for 1.5 s with an unmistakable cue (§7.4).
 * @hot-path
 */
function updateHeat(world: World, dt: number): void {
  const craft = world.craft

  if (craft.weapon.kind === 'Overheated') {
    const remaining = craft.weapon.remaining - dt
    if (remaining <= 0) {
      craft.weapon = { kind: 'Ready' }
      craft.heat = 0
    } else {
      craft.weapon = { kind: 'Overheated', remaining }
      // Heat still bleeds off during lockout, so the bar visibly recovers and
      // the wait reads as cooling rather than as an arbitrary timer.
      craft.heat = Math.max(0, craft.heat - HEAT_DECAY_PER_S * world.loadout.heatDecay * dt)
    }
    return
  }

  if (craft.heatIdle > 0) {
    craft.heatIdle -= dt
  } else if (craft.heat > 0) {
    craft.heat = Math.max(0, craft.heat - HEAT_DECAY_PER_S * world.loadout.heatDecay * dt)
  }
}

/** @hot-path */
function fire(world: World): void {
  const craft = world.craft

  // Helios Solar Lance (perk): a full charge discharges instead of the round.
  // Checked first so the legendary is what happens when it is ready, rather
  // than something the player has to remember to use with another key.
  if (fireSolarLance(world)) {
    craft.fireCooldown = FIRE_INTERVAL * 6
    return
  }

  // §7.6 — a wrecked weapon bay occasionally fails to fire at all. Deterministic
  // in simulated time, so it is reproducible and so it comes in short clusters
  // the player can feel rather than as isolated unlucky frames.
  if (craft.systems.weapon < SYSTEM_FAULT_THRESHOLD) {
    const jam = Math.sin(world.time * 13.7) * Math.sin(world.time * 5.9)
    if (jam > 0.35 + craft.systems.weapon) {
      craft.fireCooldown = FIRE_INTERVAL * 2
      return
    }
  }

  // The muzzle sits at the nose so the tracer does not appear to spawn inside
  // the hull, which reads as the shot starting late.
  copy(muzzle, craft.position)
  addScaled(muzzle, craft.nose, CRAFT_MUZZLE_OFFSET)

  const slot = spawnProjectile(
    world.playerProjectiles,
    muzzle,
    craft.nose,
    BULLET_SPEED * world.loadout.bulletSpeed,
    BULLET_LIFE,
    BULLET_DAMAGE * world.loadout.bulletDamage,
  )
  if (slot < 0) return

  // A damaged bay is slower and runs hotter: the same fault charged twice, once
  // in tempo and once in the resource that limits it.
  const weaponWear = 0.6 + 0.4 * craft.systems.weapon
  craft.fireCooldown = (FIRE_INTERVAL * world.loadout.fireInterval) / weaponWear
  craft.heat = Math.min(HEAT_MAX, craft.heat + (HEAT_PER_SHOT * world.loadout.heatPerShot) / weaponWear)
  craft.heatIdle = HEAT_DECAY_DELAY
  world.score.shots++

  world.events.emit(GameEvent.ShotFired, slot, craft.heat, muzzle.x, muzzle.y, muzzle.z)

  if (craft.heat >= HEAT_MAX) {
    craft.weapon = { kind: 'Overheated', remaining: HEAT_LOCKOUT_S * world.loadout.heatLockout }
    world.events.emit(GameEvent.HeatLockout, 0, HEAT_LOCKOUT_S, craft.position.x, craft.position.y, craft.position.z)
  }
}

/**
 * Missile lock (§7.4).
 *
 * **Hold to acquire, keep after release, fire when you choose.** The lock used
 * to launch the missile on *release* and drop to idle on the same step, which
 * made one control do three jobs — aim, commit and shoot — and made every lock a
 * held-breath. Worse, letting go for any reason (to bank, to brake, to reach the
 * bomb key) both threw the missile and threw away the lock, so the player was
 * punished for flying.
 *
 * Now: hold `lock` to fill the meter inside the 26° cone; the lock survives the
 * release for `LOCK_MEMORY` seconds; the *fire* control launches it, and only
 * in missile mode, so nothing is ever thrown by accident. A held lock breaks
 * when its target dies, leaves the wider `LOCK_BREAK_HALF_ANGLE` cone, or leaves
 * range — each of which is a fact about the world rather than a timer.
 * @hot-path
 */
function updateLock(world: World, dt: number): void {
  const craft = world.craft
  const holding = world.input.locking

  if (craft.lockHold > 0) craft.lockHold = Math.max(0, craft.lockHold - dt)

  // ---- a lock already earned ----
  //
  // Three ways to lose it, and all three are facts about the world rather than
  // timers the player cannot see: the target dies, it leaves the wide cone, or
  // the memory runs out after the control was released. Keeping the control down
  // re-arms the memory, so a player who holds lock never has one expire on them.
  if (craft.lock.kind === 'Locked') {
    const target = craft.lock.target
    if (!targetAlive(world, target) || !withinCone(world, target, LOCK_BREAK_HALF_ANGLE)) {
      breakLock(world)
      return
    }
    if (holding) craft.lockHold = LOCK_MEMORY
    else if (craft.lockHold <= 0) breakLock(world)
    return
  }

  // ---- acquiring ----
  if (!holding) {
    // Letting go mid-acquisition abandons it. Nothing is fired: a half-lock is
    // an unfinished decision, and turning it into a rocket meant every aborted
    // lock spent the missile cooldown the player was saving.
    if (craft.lock.kind === 'Acquiring') craft.lock = { kind: 'Idle' }
    return
  }

  const candidate = craft.lock.kind === 'Idle' ? findLockTarget(world) : currentTarget(world, craft.lock.target)
  if (candidate < 0) {
    craft.lock = { kind: 'Idle' }
    return
  }

  const progress =
    (craft.lock.kind === 'Acquiring' ? craft.lock.progress : 0) + dt / (LOCK_TIME * world.loadout.lockTime)
  if (progress >= 1) {
    craft.lock = { kind: 'Locked', target: candidate }
    craft.lockHold = LOCK_MEMORY
    world.events.emit(
      GameEvent.LockAcquired,
      candidate,
      1,
      world.enemies.body.x[candidate],
      world.enemies.body.y[candidate],
      world.enemies.body.z[candidate],
    )
  } else {
    craft.lock = { kind: 'Acquiring', target: candidate, progress }
  }
}

/** Drops a held lock and says so, so the HUD and the audio can react. @hot-path */
function breakLock(world: World): void {
  const craft = world.craft
  const previous = craft.lock.kind === 'Idle' ? -1 : craft.lock.target
  craft.lock = { kind: 'Idle' }
  craft.lockHold = 0
  if (previous >= 0) world.events.emit(GameEvent.LockLost, previous, 0, 0, 0, 0)
}

/** @hot-path */
function targetAlive(world: Readonly<World>, slot: number): boolean {
  return slot >= 0 && world.enemies.pool.active[slot] === 1
}

/** Confirms the held target is still alive and still inside the cone. @hot-path */
function currentTarget(world: World, slot: number): number {
  if (!targetAlive(world, slot)) return -1
  return withinCone(world, slot, LOCK_CONE_HALF_ANGLE) ? slot : -1
}

/** @hot-path */
function withinCone(world: Readonly<World>, slot: number, halfAngle: number): boolean {
  const craft = world.craft
  toTarget.x = (world.enemies.body.x[slot] as number) - craft.position.x
  toTarget.y = (world.enemies.body.y[slot] as number) - craft.position.y
  toTarget.z = (world.enemies.body.z[slot] as number) - craft.position.z
  const range = length(toTarget)
  if (range < 1e-6 || range > lockRange(world)) return false
  normalize(toTarget)
  return dot(toTarget, craft.nose) >= Math.cos(halfAngle)
}

/** Apex Orbital Optics (perk) doubles how far a lock can reach. @hot-path */
function lockRange(world: Readonly<World>): number {
  return world.activePerks.includes('high_orbit_spotter') ? LOCK_RANGE * SPOTTER_LOCK_SCALE : LOCK_RANGE
}

/** Nearest enemy inside the lock cone. @hot-path */
function findLockTarget(world: World): number {
  const requested = world.input.requestLockTarget
  if (requested >= 0 && world.enemies.pool.active[requested] === 1) return requested

  const { pool } = world.enemies
  let best = -1
  let bestAngle = Math.cos(LOCK_CONE_HALF_ANGLE)

  for (let i = 0; i < pool.count; i++) {
    const slot = pool.dense[i] as number
    toTarget.x = (world.enemies.body.x[slot] as number) - world.craft.position.x
    toTarget.y = (world.enemies.body.y[slot] as number) - world.craft.position.y
    toTarget.z = (world.enemies.body.z[slot] as number) - world.craft.position.z
    const range = length(toTarget)
    if (range < 1e-6 || range > lockRange(world)) continue
    normalize(toTarget)
    const alignment = dot(toTarget, world.craft.nose)
    if (alignment > bestAngle) {
      bestAngle = alignment
      best = slot
    }
  }
  return best
}

/** @hot-path */
function launchMissile(world: World, targetSlot: number): void {
  const craft = world.craft
  copy(muzzle, craft.position)
  addScaled(muzzle, craft.nose, CRAFT_MUZZLE_OFFSET)

  const isSwarm = world.activePerks.includes('swarm_missiles')
  const count = isSwarm ? 3 : 1

  for (let i = 0; i < count; i++) {
    const slot = spawnMissile(world.missiles, muzzle, craft.nose, targetSlot, MISSILE_DAMAGE * world.loadout.missileDamage)
    if (slot >= 0) {
      world.events.emit(GameEvent.MissileFired, slot, 0, muzzle.x, muzzle.y, muzzle.z)
    }
  }

  craft.missileCooldown = MISSILE_COOLDOWN * world.loadout.missileCooldown
}

/**
 * §8.4 — visible reticle magnetism.
 *
 * Finds the nearest valid target within a small angle of the nose and reports
 * where the reticle should be drawn. Strength is the player's Aim Assist slider
 * (0–100%, default 35% desktop / 70% touch). At 0 the reticle sits exactly on
 * the nose ray. At any setting the *bullet* still goes exactly where the nose
 * points — the system may help, but it may never contradict what the interface
 * asserts.
 * @hot-path
 */
function updateAssist(world: World): void {
  const craft = world.craft
  const strength = clamp(world.difficulty.aimAssist, 0, 1)

  copy(reticleAim, craft.position)
  addScaled(reticleAim, craft.nose, 200)
  reticleMagnetised = false
  assistTarget = -1

  if (!craft.alive) return

  const { pool } = world.enemies
  let best = -1
  let bestAlignment = Math.cos(ASSIST_MAX_ANGLE * world.loadout.assistCone)

  for (let i = 0; i < pool.count; i++) {
    const slot = pool.dense[i] as number
    toTarget.x = (world.enemies.body.x[slot] as number) - craft.position.x
    toTarget.y = (world.enemies.body.y[slot] as number) - craft.position.y
    toTarget.z = (world.enemies.body.z[slot] as number) - craft.position.z
    const range = length(toTarget)
    if (range < 1e-6 || range > 320) continue
    normalize(toTarget)
    const alignment = dot(toTarget, craft.nose)
    if (alignment > bestAlignment) {
      bestAlignment = alignment
      best = slot
    }
  }

  if (best < 0) return
  // Found regardless of the assist slider, because the *lead pip* is drawn on
  // this target too and a player who has turned assist off has not asked to
  // stop being told where to shoot — they have asked not to be nudged.
  assistTarget = best

  if (strength <= 0) return

  targetPosition.x = world.enemies.body.x[best] as number
  targetPosition.y = world.enemies.body.y[best] as number
  targetPosition.z = world.enemies.body.z[best] as number

  sub(toTarget, targetPosition, reticleAim)
  addScaled(reticleAim, toTarget, strength)
  reticleMagnetised = true
}

/**
 * The enemy the reticle is nearest to, or -1.
 *
 * Exported for the HUD's target readout: it is the thing the player is about to
 * shoot, which is exactly what a targeting display should be naming.
 */
export let assistTarget = -1

/* ------------------------------------------------------------------ */
/* Aim solutions for the HUD (§8.4)                                     */
/* ------------------------------------------------------------------ */

/**
 * Recomputes the bullet lead pip and the bomb impact marker.
 *
 * Both are *predictions of this simulation's own physics*, computed here in the
 * simulation rather than in the renderer, for the same reason bearings are
 * computed in `HudSystem`: one place derives it, so one place can be wrong. The
 * render layer's only job is to project the point onto the screen.
 * @hot-path
 */
function updateAimSolutions(world: World): void {
  const craft = world.craft

  leadValid = false
  bombImpactValid = false
  bombImpactTime = 0
  if (!craft.alive) return

  // ---- bullet lead ----
  const target = craft.lock.kind === 'Locked' ? craft.lock.target : assistTarget
  if (target >= 0 && world.enemies.pool.active[target] === 1) {
    const bulletSpeed = BULLET_SPEED * world.loadout.bulletSpeed
    targetPosition.x = world.enemies.body.x[target] as number
    targetPosition.y = world.enemies.body.y[target] as number
    targetPosition.z = world.enemies.body.z[target] as number

    // Relative to the craft, because the bullet inherits nothing: it leaves at
    // `bulletSpeed` along the nose from a moving platform, so the geometry that
    // matters is the target's motion *relative* to that platform.
    const rx = targetPosition.x - craft.position.x
    const ry = targetPosition.y - craft.position.y
    const rz = targetPosition.z - craft.position.z
    const vx = (world.enemies.body.vx[target] as number) - craft.velocity.x
    const vy = (world.enemies.body.vy[target] as number) - craft.velocity.y
    const vz = (world.enemies.body.vz[target] as number) - craft.velocity.z

    // |r + v·t|² = (s·t)²  →  (v·v − s²)t² + 2(r·v)t + r·r = 0
    const a = vx * vx + vy * vy + vz * vz - bulletSpeed * bulletSpeed
    const b = 2 * (rx * vx + ry * vy + rz * vz)
    const c = rx * rx + ry * ry + rz * rz
    let t = -1
    if (Math.abs(a) < 1e-6) {
      if (Math.abs(b) > 1e-6) t = -c / b
    } else {
      const discriminant = b * b - 4 * a * c
      if (discriminant >= 0) {
        const root = Math.sqrt(discriminant)
        const t1 = (-b - root) / (2 * a)
        const t2 = (-b + root) / (2 * a)
        // The earliest strictly positive root: the first moment a bullet fired
        // now could arrive. A negative root is an interception in the past.
        t = t1 > 0 ? (t2 > 0 ? Math.min(t1, t2) : t1) : t2
      }
    }

    if (t > 0 && t < BULLET_LIFE) {
      leadAim.x = targetPosition.x + vx * t
      leadAim.y = targetPosition.y + vy * t
      leadAim.z = targetPosition.z + vz * t
      leadValid = true
    }
  }

  // ---- bomb impact ----
  //
  // Only while the bay could actually be used. A marker for an ordnance the
  // player cannot release would be a promise the interface cannot keep.
  if (craft.bombCooldown <= 0) {
    bombBayPoint(world, muzzle, bombDown)
    bombLaunchVelocity(bombVelocity, craft.velocity, bombDown, BOMB_SPEED)
    const fall = predictBombImpact(world, muzzle, bombVelocity, bombImpact)
    if (fall >= 0) {
      bombImpactValid = true
      bombImpactTime = fall
    }
  }
}

/** Radius used when a missile tests for detonation. */
export function missileBlastRadius(kind: number): number {
  return archetypeOf(kind).radius + 1.5
}
