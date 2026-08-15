/**
 * The objective clock (gameplan §7.2, §7.3, §7.5).
 *
 * This is the system the whole game is about. Every landed Harvester removes
 * 1.4% integrity per second; when integrity reaches zero the outpost is lost
 * for the rest of the run, and losing all eight ends it.
 *
 * The travel-time budget in §7.1 is set against these numbers: at cruise the
 * antipode is 8.8 s away and a three-Harvester drain runs ~24 s, which is what
 * makes the far side *reachable but expensive*. Tune drain rate, never travel
 * speed — travel speed is the player's feel and must stay constant.
 */
import { EnemyKind, EnemyPhase, GameEvent, type World } from '../core/World.ts'
import { distanceSq } from '../math/vec3.ts'
import { refreshStatus, tryResupply } from '../entities/Outpost.ts'
import { DRAIN_RATE_PER_HARVESTER, RESUPPLY_RADIUS, FLARE_COUNT } from '../data/constants.ts'
import { repairSystems } from './PerkSystem.ts'
import { waveAt } from '../data/waves.ts'

/** @hot-path */
export function stepDrain(world: World, dt: number): void {
  countThreats(world)

  const waveDefinition = waveAt(world.wave.number)
  const waveScale = waveDefinition?.drainScale ?? 1

  // §10.5 — the Drain Rate accessibility axis, and §10.3's bounded DDA. Neither
  // touches enemy damage or health, so moment-to-moment feel stays honest.
  const rate = DRAIN_RATE_PER_HARVESTER * waveScale * world.difficulty.drainRate * world.ddaFactor

  let inSafeCheckpointAura = false

  for (let i = 0; i < world.outposts.length; i++) {
    const outpost = world.outposts[i]
    if (outpost === undefined) continue

    if (outpost.resupplyCooldown > 0) outpost.resupplyCooldown -= dt

    if (outpost.status !== 'Lost' && outpost.drainers > 0) {
      outpost.integrity = Math.max(0, outpost.integrity - rate * outpost.drainers * dt)
    }

    refreshStatus(world, outpost)

    // §7.5 — Safe checkpoint proximity healing & resupply aura.
    // Flying within the generous radius of any nominal outpost restores
    // hull integrity, purges heat, recharges boost, and replenishes countermeasures.
    const resupplyRadius = RESUPPLY_RADIUS * world.loadout.resupplyRadius
    if (
      outpost.status !== 'Lost' &&
      distanceSq(world.craft.position, outpost.position) < resupplyRadius * resupplyRadius
    ) {
      inSafeCheckpointAura = true

      if (outpost.resupplyCooldown <= 0 && world.craft.alive) {
        tryResupply(world, outpost)
        // Rapid Autoloader Bay (perk) — the "+2 flares" half, which until now
        // existed only in the perk's description.
        const stock = FLARE_COUNT + (world.activePerks.includes('rapid_ordnance') ? 2 : 0)
        if (world.craft.flaresRemaining < stock) world.craft.flaresRemaining = stock

        // §7.6 — an outpost pass is where a damaged craft is put back together.
        // Ground crew, in effect: the same visit that patches the hull re-seats
        // the engine, the weapon bay and the stabiliser, which gives a hurt
        // player somewhere specific to fly rather than a slow death.
        const systems = world.craft.systems
        if (systems.engine < 1 || systems.weapon < 1 || systems.control < 1) {
          repairSystems(world, 1)
          world.events.emit(
            GameEvent.SystemsRepaired,
            outpost.index,
            0,
            world.craft.position.x,
            world.craft.position.y,
            world.craft.position.z,
          )
        }
      }
    }
  }

  world.craft.inRepairZone = inSafeCheckpointAura
}

/**
 * Recounts drainers and inbound threats per outpost.
 *
 * A single pass over the enemy pool writing into the outposts, rather than the
 * obvious pass over outposts querying the enemy pool: the latter is O(outposts ×
 * enemies) with a closure per outpost, which at 120 Hz was ~1,900 closures a
 * second in the prior implementation.
 * @hot-path
 */
function countThreats(world: World): void {
  for (let i = 0; i < world.outposts.length; i++) {
    const outpost = world.outposts[i]
    if (outpost === undefined) continue
    outpost.drainers = 0
    outpost.threats = 0
  }

  const { pool } = world.enemies
  for (let i = 0; i < pool.count; i++) {
    const slot = pool.dense[i] as number
    const targetIndex = world.enemies.target[slot] as number
    if (targetIndex < 0) continue

    const outpost = world.outposts[targetIndex]
    if (outpost === undefined || outpost.status === 'Lost') continue

    outpost.threats++

    if (
      (world.enemies.kind[slot] as number) === EnemyKind.Harvester &&
      (world.enemies.phase[slot] as number) === EnemyPhase.Draining
    ) {
      outpost.drainers++
    }
  }
}

/**
 * Seconds until this outpost falls at its current drain rate, or Infinity when
 * nothing is draining it.
 *
 * Used by the Briefing and the Debrief to state the decision in the terms the
 * player actually experiences it — "falls in 10.7 s" rather than "45%
 * integrity" (§6, §14.3).
 */
export function timeToLoss(world: Readonly<World>, outpostIndex: number): number {
  const outpost = world.outposts[outpostIndex]
  if (outpost === undefined || outpost.status === 'Lost') return 0
  if (outpost.drainers <= 0) return Infinity

  const waveDefinition = waveAt(world.wave.number)
  const rate =
    DRAIN_RATE_PER_HARVESTER *
    (waveDefinition?.drainScale ?? 1) *
    world.difficulty.drainRate *
    world.ddaFactor *
    outpost.drainers

  return rate > 0 ? outpost.integrity / rate : Infinity
}
