/**
 * Outpost state transitions (gameplan §7.2).
 *
 * | State | Integrity | Visual | Audio |
 * |---|---|---|---|
 * | Nominal    | 100%              | cyan beacon, slow pulse   | silent |
 * | Threatened | Harvesters inbound| amber beacon, medium pulse| distant chirp |
 * | Draining   | falling           | amber fast, drain beam    | rising urgency |
 * | Critical   | < 25%             | white strobe              | insistent, ducks music |
 * | Lost       | 0%                | goes dark, structure stays| one-shot power-down |
 *
 * Lost outposts stay lost for the run, and losing all eight ends it. This
 * replaces V1's hull-based death: hull damage still matters, but destruction
 * costs *time* rather than the run, so every consequence in the game is
 * denominated in the same currency (§7.2, §7.6).
 */
import type { Outpost, OutpostStatus, World } from '../core/World.ts'
import { GameEvent } from '../core/World.ts'
import { arcDistance } from '../math/spherical.ts'
import { OUTPOST_CRITICAL_INTEGRITY, R, RESUPPLY_COOLDOWN, RESUPPLY_HULL, HULL_MAX } from '../data/constants.ts'

/**
 * Recomputes an outpost's status from its integrity and the threats on it.
 *
 * Status is derived rather than assigned, so it can never disagree with the
 * numbers behind it — the roster showing "Draining" while nothing drains would
 * be exactly the kind of dishonest interface §12 rules out.
 * @hot-path
 */
export function refreshStatus(world: World, outpost: Outpost): void {
  if (outpost.status === 'Lost') return

  const previous = outpost.status
  let next: OutpostStatus

  if (outpost.integrity <= 0) {
    next = 'Lost'
  } else if (outpost.integrity < OUTPOST_CRITICAL_INTEGRITY) {
    next = 'Critical'
  } else if (outpost.drainers > 0) {
    next = 'Draining'
  } else if (outpost.threats > 0) {
    next = 'Threatened'
  } else {
    next = 'Nominal'
  }

  if (next === previous) return

  if (next !== 'Nominal' && outpost.threatenedAt < 0) {
    outpost.threatenedAt = world.time
  }

  outpost.status = next

  if (next === 'Lost') {
    outpost.integrity = 0
    outpost.lostAt = world.time
    outpost.lostWave = world.wave.number
    outpost.lostDrainers = outpost.drainers
    outpost.lostArcDistance = arcDistance(world.craft.position, outpost.position, R)
    world.score.outpostsLost++
    world.recentLosses++
    world.events.emit(
      GameEvent.OutpostLost,
      outpost.index,
      0,
      outpost.position.x,
      outpost.position.y,
      outpost.position.z,
    )
  }
}

/**
 * §7.5 — resupply. Flying within 15 u of a nominal outpost restores hull,
 * purges heat, and recharges boost, on a 20 s per-outpost cooldown.
 *
 * This is what makes surviving outposts *instrumentally* valuable rather than
 * merely scoreable: losing one degrades your future capability, so the stakes
 * are felt mechanically and not just narratively. It also replaces V1's random
 * power-up drops with something spatially meaningful — you route through your
 * own territory.
 * @hot-path
 */
export function tryResupply(world: World, outpost: Outpost): boolean {
  if (outpost.status === 'Lost' || outpost.resupplyCooldown > 0) return false
  if (!world.craft.alive) return false

  const craft = world.craft
  const maxHull = HULL_MAX * world.loadout.hullMax
  craft.hull = Math.min(maxHull, craft.hull + RESUPPLY_HULL * world.loadout.resupplyHull)
  craft.heat = 0
  craft.weapon = { kind: 'Ready' }
  craft.boostCharge = 1
  outpost.resupplyCooldown = RESUPPLY_COOLDOWN

  world.events.emit(
    GameEvent.Resupply,
    outpost.index,
    RESUPPLY_HULL * world.loadout.resupplyHull,
    outpost.position.x,
    outpost.position.y,
    outpost.position.z,
  )
  return true
}

/**
 * Takes integrity off an outpost in one stroke, and settles the consequences.
 *
 * The drain is continuous and owned by `DrainSystem`; this is the *discrete*
 * path, for the Sapper (§7.3), which does its damage all at once on impact.
 * Routed through here rather than written into `integrity` directly for the same
 * reason every enemy death goes through `damageEnemy`: an outpost taken to zero
 * by a raw assignment would sit at zero with its status still reading
 * "Threatened", never emit `OutpostLost`, never count toward the run's loss
 * tally, and never end the run when it was the eighth.
 *
 * Difficulty scaling is applied by the *caller*, not here, because the
 * accessibility axis this belongs to is Drain Rate (§10.5) and only the caller
 * knows whether its damage is drain-shaped.
 */
export function damageOutpost(world: World, outpost: Outpost, amount: number): void {
  if (outpost.status === 'Lost' || amount <= 0) return
  outpost.integrity = Math.max(0, outpost.integrity - amount)
  if (outpost.threatenedAt < 0) outpost.threatenedAt = world.time
  refreshStatus(world, outpost)
}

/** Clears per-wave bookkeeping without resetting integrity — damage persists. */
export function beginWave(outpost: Outpost): void {
  outpost.threats = 0
  outpost.drainers = 0
  if (outpost.status !== 'Lost') outpost.threatenedAt = -1
}
