/**
 * What the perks actually do (§10).
 *
 * ## Why this file exists
 *
 * Six of the eighteen perks were text. `plasma_afterburner`, `kinetic_railgun`,
 * `emp_flares`, `high_orbit_spotter`, `ghost_ecm` and `solar_beam` had names,
 * rarities, icons, flavour quotes and confident descriptions of what they did,
 * and not one line of code anywhere referenced their ids. Several of the others
 * were half-true: Orbital Saturation promised cluster munitions and only widened
 * the blast, Rapid Autoloader promised +2 flares and only cut the cooldown,
 * Plasma Arc promised 40% damage and dealt a flat 15.
 *
 * A buff that does nothing is worse than no buff. The player spends a draft pick
 * on it, plays differently because of it, and attributes the run's outcome to a
 * decision that never mattered.
 *
 * So: the effects that belong to a moment live at that moment (a bomb's cluster
 * munitions are in `Bomb.ts`, the missile volley is in `WeaponSystem`), and
 * everything *continuous* — anything that has to be true on every step — lives
 * here, in one place, where it can be read against the perk table.
 */
import { GameEvent, type World } from '../core/World.ts'
import { emitBurst } from './ParticleSystem.ts'
import { damageEnemy } from './CollisionSystem.ts'
import { type Vec3, create, length, normalize } from '../math/vec3.ts'
import {
  ALT_MAX,
  EMP_DURATION,
  HULL_MAX,
  LANCE_CHARGE_ALTITUDE,
  LANCE_CHARGE_RATE,
  LANCE_DAMAGE,
  LANCE_RANGE,
  MAX_ENEMIES,
  R,
} from '../data/constants.ts'

const toTarget: Vec3 = create()
const lanceTargets = new Int32Array(MAX_ENEMIES)

/** True when the run holds this perk. @hot-path */
export function hasPerk(world: Readonly<World>, id: string): boolean {
  return world.activePerks.includes(id)
}

/**
 * Every per-step perk effect, in one pass.
 * @hot-path
 */
export function stepPerks(world: World, dt: number): void {
  const craft = world.craft

  if (craft.empTimer > 0) craft.empTimer = Math.max(0, craft.empTimer - dt)

  if (!craft.alive) return

  // 1. Nanite Self-Repair — hull *and* subsystems. Repairing the hull while
  //    leaving a wrecked engine would be a perk that stops mattering the moment
  //    it matters most.
  if (hasPerk(world, 'nanite_regen')) {
    const maxHull = HULL_MAX * world.loadout.hullMax
    if (craft.hull < maxHull) craft.hull = Math.min(maxHull, craft.hull + maxHull * 0.02 * dt)
    repairSystems(world, 0.045 * dt)
  }

  // 2. Magnetic Tractor Layer — drags hostiles off the outposts they are
  //    draining and toward the one thing that can shoot them.
  if (hasPerk(world, 'magnetic_tether')) {
    const { pool, body } = world.enemies
    const pullRadiusSq = 45 * 45
    for (let i = pool.count - 1; i >= 0; i--) {
      const slot = pool.dense[i] as number
      toTarget.x = craft.position.x - (body.x[slot] as number)
      toTarget.y = craft.position.y - (body.y[slot] as number)
      toTarget.z = craft.position.z - (body.z[slot] as number)
      const dSq = toTarget.x * toTarget.x + toTarget.y * toTarget.y + toTarget.z * toTarget.z
      if (dSq < pullRadiusSq && dSq > 1) {
        normalize(toTarget)
        body.vx[slot] = (body.vx[slot] as number) + toTarget.x * 24 * dt
        body.vy[slot] = (body.vy[slot] as number) + toTarget.y * 24 * dt
        body.vz[slot] = (body.vz[slot] as number) + toTarget.z * 24 * dt
      }
    }
  }

  // 3. Aegis Kinetic Barrier — an overshield that rebuilds between exchanges.
  if (hasPerk(world, 'aegis_shield') && craft.aegisShield < 35) {
    craft.aegisShield = Math.min(35, craft.aegisShield + 4.0 * dt)
  }

  // 4. Thermal Afterburner Nova — the burn behind you.
  //
  //    The recharge half is applied in `FlightSystem`, where the boost clock
  //    lives. This is the trail: while boosting, anything close behind takes
  //    damage, which turns boost from pure escape into a way to punish a chase.
  if (hasPerk(world, 'plasma_afterburner') && craft.boostActive) {
    burnPursuers(world, dt)
  }

  // 5. Helios Solar Lance — charges only in the sunlit high orbit it is named
  //    for, so the legendary asks the player to fly somewhere specific for it.
  if (hasPerk(world, 'solar_beam')) {
    const altitude = length(craft.position) - R
    if (altitude > LANCE_CHARGE_ALTITUDE && craft.lanceCharge < 1) {
      // Scaled by how far into the high band the craft is, so climbing to the
      // ceiling is meaningfully faster than skimming the threshold.
      const band = Math.min(1, (altitude - LANCE_CHARGE_ALTITUDE) / (ALT_MAX - LANCE_CHARGE_ALTITUDE))
      craft.lanceCharge = Math.min(1, craft.lanceCharge + LANCE_CHARGE_RATE * (0.45 + 0.55 * band) * dt)
    }
  } else {
    craft.lanceCharge = 0
  }
}

/**
 * Discharges the Helios lance down the nose.
 *
 * Called from `WeaponSystem` when the player fires with a full charge in cannon
 * mode. Everything within `LANCE_RANGE` and a narrow cone takes `LANCE_DAMAGE`,
 * which is enough to delete a Sentinel — and the shield does not stop it, since
 * the whole point of a legendary is that it answers a problem the ordinary
 * weapons cannot.
 */
export function fireSolarLance(world: World): boolean {
  const craft = world.craft
  if (!hasPerk(world, 'solar_beam') || craft.lanceCharge < 1) return false

  craft.lanceCharge = 0

  const { pool, body } = world.enemies
  const cosCone = Math.cos((9 * Math.PI) / 180)
  let found = 0

  for (let i = 0; i < pool.count && found < lanceTargets.length; i++) {
    const slot = pool.dense[i] as number
    toTarget.x = (body.x[slot] as number) - craft.position.x
    toTarget.y = (body.y[slot] as number) - craft.position.y
    toTarget.z = (body.z[slot] as number) - craft.position.z
    const range = length(toTarget)
    if (range < 1e-3 || range > LANCE_RANGE) continue
    normalize(toTarget)
    const alignment =
      toTarget.x * craft.nose.x + toTarget.y * craft.nose.y + toTarget.z * craft.nose.z
    if (alignment >= cosCone) lanceTargets[found++] = slot
  }

  // Gathered first, then damaged — `damageEnemy` releases pool slots on a kill
  // and a beam that walked the dense list as it fired would skip targets.
  for (let i = 0; i < found; i++) {
    const slot = lanceTargets[i] as number
    if (pool.active[slot] !== 1) continue
    emitBurst(
      world,
      body.x[slot] as number,
      body.y[slot] as number,
      body.z[slot] as number,
      14,
      26,
      0.4,
      0.5,
      'critical',
      1,
      null,
      false,
    )
    damageEnemy(world, slot, LANCE_DAMAGE * world.loadout.bulletDamage)
  }

  world.events.emit(
    GameEvent.ShotFired,
    -2,
    0,
    craft.position.x,
    craft.position.y,
    craft.position.z,
  )
  return true
}

/** EMP Burst Countermeasures — silences hostile guns for a few seconds. */
export function applyEmpBurst(world: World): void {
  if (!hasPerk(world, 'emp_flares')) return
  world.craft.empTimer = EMP_DURATION
  emitBurst(
    world,
    world.craft.position.x,
    world.craft.position.y,
    world.craft.position.z,
    26,
    40,
    0.7,
    0.5,
    'friendly',
    1,
    null,
    false,
  )
}

/**
 * The afterburner's wake. Damages anything close behind while boosting.
 * @hot-path
 */
function burnPursuers(world: World, dt: number): void {
  const craft = world.craft
  const { pool, body } = world.enemies

  for (let i = pool.count - 1; i >= 0; i--) {
    const slot = pool.dense[i] as number
    toTarget.x = (body.x[slot] as number) - craft.position.x
    toTarget.y = (body.y[slot] as number) - craft.position.y
    toTarget.z = (body.z[slot] as number) - craft.position.z
    const range = length(toTarget)
    if (range < 1e-3 || range > 16) continue

    // Behind only: the plume comes out of the back of the craft, so ramming
    // something head-on must not set it on fire.
    normalize(toTarget)
    const behind =
      toTarget.x * craft.frame.forward.x +
      toTarget.y * craft.frame.forward.y +
      toTarget.z * craft.frame.forward.z
    if (behind > -0.25) continue

    damageEnemy(world, slot, 6 * dt)
  }
}

/** Restores subsystem integrity by `amount`, clamped. @hot-path */
export function repairSystems(world: World, amount: number): void {
  const systems = world.craft.systems
  systems.engine = Math.min(1, systems.engine + amount)
  systems.weapon = Math.min(1, systems.weapon + amount)
  systems.control = Math.min(1, systems.control + amount)
}
