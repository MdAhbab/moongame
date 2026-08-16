/**
 * The three late archetypes (§7.3), pinned by the promise each one makes.
 *
 * Every test here asserts a *design* claim rather than an implementation
 * detail, because the claims are the reason the archetypes exist:
 *
 *   Sapper   there is no arriving late, and no reward for arriving too late
 *   Warden   nothing inside the field can be hurt, and the field never protects
 *            another Warden
 *   Carrier  it keeps producing work, and it stops when there is none left to do
 *
 * A regression in any of those turns a decision back into a damage sponge.
 */
import { describe, expect, it } from 'vitest'
import { EnemyKind, EnemyPhase, GameEvent, createWorld, type World } from '../../src/game/core/World'
import { stepAI } from '../../src/game/systems/AISystem'
import { damageEnemy } from '../../src/game/systems/CollisionSystem'
import { spawnSapper } from '../../src/game/entities/Sapper'
import { spawnWarden, shieldedByWarden } from '../../src/game/entities/Warden'
import { spawnCarrier } from '../../src/game/entities/Carrier'
import { waveDefinition, waveEnemyCount, WAVES } from '../../src/game/data/waves'
import {
  CARRIER_LAUNCH_INTERVAL,
  FIXED_DT,
  MAX_ENEMIES,
  SAPPER_IMPACT_DAMAGE,
  WARDEN_FIELD_RADIUS,
} from '../../src/game/data/constants'

/** Advances only the AI, which is all three of these archetypes need. */
function runAI(world: World, seconds: number): void {
  const steps = Math.round(seconds / FIXED_DT)
  for (let i = 0; i < steps; i++) stepAI(world, FIXED_DT)
}

function liveOfKind(world: World, kind: number): number {
  const { pool } = world.enemies
  let n = 0
  for (let i = 0; i < pool.count; i++) {
    if ((world.enemies.kind[pool.dense[i] as number] as number) === kind) n++
  }
  return n
}

describe('Sapper — the deadline', () => {
  it('reaches its outpost and takes integrity in one stroke', () => {
    const world = createWorld('sapper-hit', 7)
    const outpost = world.outposts[0]
    expect(outpost).toBeDefined()
    if (outpost === undefined) return

    const before = outpost.integrity
    const slot = world.enemies.pool.alloc()
    spawnSapper(world, slot, 0, 0.2)

    // Generous: the run is ~60 u at 32 u/s plus the arming fuse.
    runAI(world, 20)

    expect(outpost.integrity).toBeLessThanOrEqual(before - SAPPER_IMPACT_DAMAGE + 0.001)
    expect(world.enemies.pool.active[slot]).toBe(0)
  })

  it('arms before it detonates, so the deadline is visible expiring', () => {
    const world = createWorld('sapper-tell', 7)
    const slot = world.enemies.pool.alloc()
    spawnSapper(world, slot, 0, 0.2)

    let sawArming = false
    const steps = Math.round(20 / FIXED_DT)
    for (let i = 0; i < steps; i++) {
      stepAI(world, FIXED_DT)
      if (world.enemies.pool.active[slot] !== 1) break
      if ((world.enemies.phase[slot] as number) === EnemyPhase.Arming) sawArming = true
    }
    expect(sawArming).toBe(true)
  })

  it('pays nothing for reaching its target — a detonation is a failure, not a kill', () => {
    // Routing the detonation through the kill path would award score, a bounty
    // and a combo tick for an outpost the player just lost 14 points of.
    const world = createWorld('sapper-nopay', 7)
    const scoreBefore = world.score.total
    const creditsBefore = world.credits

    const slot = world.enemies.pool.alloc()
    spawnSapper(world, slot, 0, 0.2)
    runAI(world, 20)

    expect(world.enemies.pool.active[slot]).toBe(0)
    expect(world.score.total).toBe(scoreBefore)
    expect(world.credits).toBe(creditsBefore)
    expect(world.score.killsSapper).toBe(0)
  })

  it('leaves rather than detonating on an outpost that is already lost', () => {
    const world = createWorld('sapper-lost', 7)
    const outpost = world.outposts[0]
    expect(outpost).toBeDefined()
    if (outpost === undefined) return
    outpost.status = 'Lost'
    outpost.integrity = 0

    const slot = world.enemies.pool.alloc()
    spawnSapper(world, slot, 0, 0.2)
    runAI(world, 8)

    // Still alive, and climbing away rather than driving at the ruin.
    expect(world.enemies.pool.active[slot]).toBe(1)
    expect(outpost.integrity).toBe(0)
  })
})

describe('Warden — the priority', () => {
  it('makes everything inside its field immune', () => {
    const world = createWorld('warden-block', 7)
    const warden = world.enemies.pool.alloc()
    spawnWarden(world, warden, 0)

    // A Harvester parked right beside it.
    const victim = world.enemies.pool.alloc()
    world.enemies.kind[victim] = EnemyKind.Harvester
    world.enemies.hp[victim] = 3
    world.enemies.body.spawnAt(
      victim,
      (world.enemies.body.x[warden] as number) + 5,
      world.enemies.body.y[warden] as number,
      world.enemies.body.z[warden] as number,
    )

    expect(shieldedByWarden(world, victim)).toBe(true)
    damageEnemy(world, victim, 999)
    expect(world.enemies.pool.active[victim]).toBe(1)
    expect(world.enemies.hp[victim]).toBe(3)
  })

  it('announces every absorbed hit, so damage never fails silently', () => {
    const world = createWorld('warden-say', 7)
    const warden = world.enemies.pool.alloc()
    spawnWarden(world, warden, 0)

    const victim = world.enemies.pool.alloc()
    world.enemies.kind[victim] = EnemyKind.Harvester
    world.enemies.hp[victim] = 3
    world.enemies.body.spawnAt(
      victim,
      (world.enemies.body.x[warden] as number) + 5,
      world.enemies.body.y[warden] as number,
      world.enemies.body.z[warden] as number,
    )

    world.events.clear()
    damageEnemy(world, victim, 10)

    let absorbed = 0
    for (let i = 0; i < world.events.count; i++) {
      if ((world.events.type[i] as number) === GameEvent.WardenAbsorbed) absorbed++
    }
    expect(absorbed).toBe(1)
  })

  it('never shields itself or another Warden', () => {
    // Two Wardens covering each other would be unkillable — a lock with no
    // counterplay at all, and the exact emergent failure a "protects nearby
    // allies" rule produces if the exception is not written down.
    const world = createWorld('warden-pair', 7)
    const a = world.enemies.pool.alloc()
    const b = world.enemies.pool.alloc()
    spawnWarden(world, a, 0)
    spawnWarden(world, b, 0)
    world.enemies.body.spawnAt(
      b,
      (world.enemies.body.x[a] as number) + 4,
      world.enemies.body.y[a] as number,
      world.enemies.body.z[a] as number,
    )

    expect(shieldedByWarden(world, a)).toBe(false)
    expect(shieldedByWarden(world, b)).toBe(false)

    damageEnemy(world, a, 999)
    expect(world.enemies.pool.active[a]).toBe(0)
  })

  it('stops protecting the moment it dies', () => {
    const world = createWorld('warden-death', 7)
    const warden = world.enemies.pool.alloc()
    spawnWarden(world, warden, 0)

    const victim = world.enemies.pool.alloc()
    world.enemies.kind[victim] = EnemyKind.Harvester
    world.enemies.hp[victim] = 3
    world.enemies.body.spawnAt(
      victim,
      (world.enemies.body.x[warden] as number) + 5,
      world.enemies.body.y[warden] as number,
      world.enemies.body.z[warden] as number,
    )

    damageEnemy(world, warden, 999)
    expect(world.enemies.pool.active[warden]).toBe(0)

    damageEnemy(world, victim, 999)
    expect(world.enemies.pool.active[victim]).toBe(0)
  })

  it('does not reach past its stated radius', () => {
    const world = createWorld('warden-range', 7)
    const warden = world.enemies.pool.alloc()
    spawnWarden(world, warden, 0)

    const outside = world.enemies.pool.alloc()
    world.enemies.kind[outside] = EnemyKind.Harvester
    world.enemies.hp[outside] = 3
    world.enemies.body.spawnAt(
      outside,
      (world.enemies.body.x[warden] as number) + WARDEN_FIELD_RADIUS + 3,
      world.enemies.body.y[warden] as number,
      world.enemies.body.z[warden] as number,
    )

    expect(shieldedByWarden(world, outside)).toBe(false)
  })
})

describe('Carrier — the source', () => {
  it('launches a Harvester on its clock, and keeps doing it', () => {
    const world = createWorld('carrier-launch', 7)
    const slot = world.enemies.pool.alloc()
    spawnCarrier(world, slot, 0)

    expect(liveOfKind(world, EnemyKind.Harvester)).toBe(0)
    runAI(world, 8)
    expect(liveOfKind(world, EnemyKind.Harvester)).toBe(1)

    runAI(world, CARRIER_LAUNCH_INTERVAL + 1)
    expect(liveOfKind(world, EnemyKind.Harvester)).toBe(2)
  })

  it('stops launching once its outpost is lost', () => {
    // A Carrier over a ruin that carried on seeding would ask the player to
    // clear a threat that no longer matters — the same rule the Harvester's
    // lift-off obeys.
    const world = createWorld('carrier-lost', 7)
    const slot = world.enemies.pool.alloc()
    spawnCarrier(world, slot, 0)
    runAI(world, 8)
    const after = liveOfKind(world, EnemyKind.Harvester)

    const outpost = world.outposts[0]
    expect(outpost).toBeDefined()
    if (outpost === undefined) return
    outpost.status = 'Lost'
    outpost.integrity = 0

    runAI(world, CARRIER_LAUNCH_INTERVAL * 2)
    expect(liveOfKind(world, EnemyKind.Harvester)).toBe(after)
  })

  it('defers rather than drops a launch when the pool is full', () => {
    // Queue, never drop (§7.3). A dropped launch would make a Carrier quietly
    // weaker on a busy board, which is difficulty by pool contention rather than
    // by authorship.
    const world = createWorld('carrier-full', 7)
    const slot = world.enemies.pool.alloc()
    spawnCarrier(world, slot, 0)

    // Fill every remaining slot with inert Harvesters far from anything.
    while (!world.enemies.pool.isFull) {
      const filler = world.enemies.pool.alloc()
      world.enemies.kind[filler] = EnemyKind.Harvester
      world.enemies.hp[filler] = 3
      world.enemies.target[filler] = -1
      world.enemies.phase[filler] = EnemyPhase.Draining
      world.enemies.body.spawnAt(filler, 0, 400, 0)
    }
    expect(world.enemies.pool.isFull).toBe(true)

    runAI(world, 8)
    expect(world.enemies.pool.count).toBe(MAX_ENEMIES)

    // Free one slot; the deferred launch takes it on the next step.
    const freed = world.enemies.pool.dense[world.enemies.pool.count - 1] as number
    world.enemies.pool.release(freed)
    runAI(world, 0.2)
    expect(world.enemies.pool.isFull).toBe(true)
  })

  it('is worth more than anything else to kill', () => {
    // The only kill in the game that prevents future work. If it ever stops
    // paying the most, the archetype's whole decision inverts.
    const world = createWorld('carrier-value', 7)
    const slot = world.enemies.pool.alloc()
    spawnCarrier(world, slot, 0)
    const creditsBefore = world.credits
    const scoreBefore = world.score.total
    damageEnemy(world, slot, 999)

    const carrierCredits = world.credits - creditsBefore
    const carrierScore = world.score.total - scoreBefore

    const other = createWorld('carrier-value-2', 7)
    const sentinel = other.enemies.pool.alloc()
    other.enemies.kind[sentinel] = EnemyKind.Sentinel
    other.enemies.hp[sentinel] = 6
    other.enemies.body.spawnAt(sentinel, 0, 140, 0)
    const otherCredits = other.credits
    const otherScore = other.score.total
    damageEnemy(other, sentinel, 999)

    expect(carrierCredits).toBeGreaterThan(other.credits - otherCredits)
    expect(carrierScore).toBeGreaterThan(other.score.total - otherScore)
  })
})

describe('the recomposed wave arc', () => {
  it('keeps waves 1 to 7 free of the late archetypes', () => {
    // The first seven waves are the teaching arc, and they are unchanged. A late
    // archetype leaking into them would test a mechanic before it was taught.
    for (let n = 1; n <= 7; n++) {
      const wave = waveDefinition(n, false)
      expect(wave, `wave ${n}`).toBeDefined()
      expect(wave?.sappers, `wave ${n} sappers`).toBe(0)
      expect(wave?.wardens, `wave ${n} wardens`).toBe(0)
      expect(wave?.carriers, `wave ${n} carriers`).toBe(0)
    }
  })

  it('introduces each late archetype exactly once, in order', () => {
    const firstWith = (pick: (w: NonNullable<ReturnType<typeof waveDefinition>>) => number): number => {
      for (let n = 1; n <= WAVES.length; n++) {
        const wave = waveDefinition(n, false)
        if (wave !== undefined && pick(wave) > 0) return n
      }
      return -1
    }
    const sapper = firstWith((w) => w.sappers)
    const warden = firstWith((w) => w.wardens)
    const carrier = firstWith((w) => w.carriers)

    expect(sapper).toBeGreaterThan(0)
    expect(warden).toBeGreaterThan(sapper)
    expect(carrier).toBeGreaterThan(warden)

    // Each is announced on the Briefing the wave it arrives.
    expect(waveDefinition(sapper, false)?.newElement).toBe('Sappers')
    expect(waveDefinition(warden, false)?.newElement).toBe('Wardens')
    expect(waveDefinition(carrier, false)?.newElement).toBe('Carriers')
  })

  it('never queues more than the pool holds, campaign or Endless', () => {
    // `startWave` enqueues the whole wave up front, and a Carrier needs live
    // slots on top of that. Six archetypes made this budget tight enough to be
    // worth asserting across the whole range rather than at a few depths.
    for (let n = 1; n <= WAVES.length; n++) {
      const wave = waveDefinition(n, false)
      expect(wave, `wave ${n}`).toBeDefined()
      if (wave === undefined) continue
      expect(waveEnemyCount(wave), `campaign wave ${n}`).toBeLessThanOrEqual(MAX_ENEMIES)
    }
    for (const n of [13, 14, 20, 47, 120, 999]) {
      const wave = waveDefinition(n, true)
      expect(wave, `wave ${n}`).toBeDefined()
      if (wave === undefined) continue
      expect(waveEnemyCount(wave), `endless wave ${n}`).toBeLessThanOrEqual(MAX_ENEMIES)
    }
  })

  it('never sends more Carriers than there are outposts to seed', () => {
    // Two Carriers over one outpost is the same decision with twice the health
    // bar, and the archetype's cost is meant to be travel, not shooting.
    for (const [n, endless] of [[11, false], [12, false], [13, true], [99, true]] as const) {
      const wave = waveDefinition(n, endless)
      expect(wave, `wave ${n}`).toBeDefined()
      if (wave === undefined) continue
      expect(wave.carriers, `wave ${n}`).toBeLessThanOrEqual(wave.threatened)
    }
  })
})
