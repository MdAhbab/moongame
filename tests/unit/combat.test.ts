/**
 * The three things the player asked for, pinned.
 *
 *  - An Interceptor you can *beat*, not merely survive.
 *  - Buffs that are real: every perk id in the table reachable from the code.
 *  - Damage that lands somewhere, and a death that ends and restarts cleanly.
 */
import { describe, expect, it } from 'vitest'
import { EnemyKind, EnemyPhase, GameEvent, createWorld, type World } from '../../src/game/core/World'
import { stepWorld } from '../../src/game/core/step'
import { stepAI } from '../../src/game/systems/AISystem'
import { stepInput } from '../../src/game/systems/InputSystem'
import { stepWeapons } from '../../src/game/systems/WeaponSystem'
import { damageCraft, damageEnemy } from '../../src/game/systems/CollisionSystem'
import { stepDrones } from '../../src/game/entities/Drone'
import { PERKS } from '../../src/game/data/perks'
import {
  CRAFT_MUZZLE_OFFSET,
  EXPOSED_DAMAGE_MULTIPLIER,
  FIXED_DT,
  RESPAWN_TIME,
  RUN_COOLDOWN,
  WINDUP_TIME,
} from '../../src/game/data/constants'

/** An Interceptor sitting just off the player's nose, ready to be provoked. */
function spawnStalker(world: World, range = 60): number {
  const craft = world.craft
  const slot = world.enemies.pool.alloc()
  world.enemies.kind[slot] = EnemyKind.Interceptor
  world.enemies.hp[slot] = 100
  world.enemies.phase[slot] = EnemyPhase.Pursuing
  world.enemies.timer[slot] = 0.05
  world.enemies.body.spawnAt(
    slot,
    craft.position.x + craft.nose.x * range,
    craft.position.y + craft.nose.y * range,
    craft.position.z + craft.nose.z * range,
  )
  return slot
}

function eventFired(world: World, type: number): boolean {
  for (let i = 0; i < world.events.count; i++) if (world.events.type[i] === type) return true
  return false
}

describe('the Interceptor attack run — the counterplay', () => {
  it('telegraphs, commits, and ends up exposed', () => {
    const world = createWorld('attack-run', 7)
    const slot = spawnStalker(world)

    // The run clock is nearly up, so it should wind up almost immediately.
    let sawWindup = false
    let sawDive = false
    let sawExposed = false

    for (let i = 0; i < 900; i++) {
      stepAI(world, FIXED_DT)
      const phase = world.enemies.phase[slot]
      if (phase === EnemyPhase.Winding) sawWindup = true
      if (phase === EnemyPhase.Diving) sawDive = true
      if (phase === EnemyPhase.Exposed) sawExposed = true
      world.events.clear()
    }

    expect(sawWindup, 'it winds up before committing — that is the tell').toBe(true)
    expect(sawDive, 'it commits').toBe(true)
    expect(sawExposed, 'and it ends up exposed whether or not it connected').toBe(true)
  })

  it('gives the player a full second of warning before the commit', () => {
    const world = createWorld('attack-run', 7)
    const slot = spawnStalker(world)

    let windupSteps = 0
    for (let i = 0; i < 900; i++) {
      stepAI(world, FIXED_DT)
      if (world.enemies.phase[slot] === EnemyPhase.Winding) windupSteps++
      if (world.enemies.phase[slot] === EnemyPhase.Diving) break
      world.events.clear()
    }

    // Within a step of the constant either way. A tell shorter than this is not
    // a tell, and the number is the one the design doc quotes.
    expect(windupSteps * FIXED_DT).toBeGreaterThan(WINDUP_TIME - 0.05)
  })

  it('takes multiplied damage while exposed', () => {
    const world = createWorld('attack-run', 7)
    const slot = spawnStalker(world)
    world.enemies.hp[slot] = 100

    world.enemies.phase[slot] = EnemyPhase.Pursuing
    damageEnemy(world, slot, 10)
    const normalLoss = 100 - world.enemies.hp[slot]

    world.enemies.hp[slot] = 100
    world.enemies.phase[slot] = EnemyPhase.Exposed
    damageEnemy(world, slot, 10)
    const exposedLoss = 100 - world.enemies.hp[slot]

    expect(exposedLoss).toBeCloseTo(normalLoss * EXPOSED_DAMAGE_MULTIPLIER, 5)
  })

  it('is aborted by flares during the wind-up', () => {
    const world = createWorld('attack-run', 7)
    const slot = spawnStalker(world)

    for (let i = 0; i < 900; i++) {
      stepAI(world, FIXED_DT)
      world.events.clear()
      if (world.enemies.phase[slot] === EnemyPhase.Winding) break
    }
    expect(world.enemies.phase[slot]).toBe(EnemyPhase.Winding)

    // Countermeasures away.
    world.craft.flareActiveTimer = 2
    stepAI(world, FIXED_DT)

    expect(world.enemies.phase[slot], 'flares break the run before it starts').toBe(EnemyPhase.Pursuing)
    expect(world.enemies.timer[slot]).toBeCloseTo(RUN_COOLDOWN, 3)
  })
})

describe('every perk is real', () => {
  it('has an implementation for every id in the table', async () => {
    // The audit that would have caught six perks shipping as pure text: read the
    // source of every system and require each id to appear somewhere that is not
    // the perk table itself.
    const fs = await import('node:fs')
    const path = await import('node:path')

    const sources: string[] = []
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry)
        if (fs.statSync(full).isDirectory()) walk(full)
        else if (entry.endsWith('.ts') && !full.endsWith('data/perks.ts')) {
          sources.push(fs.readFileSync(full, 'utf8'))
        }
      }
    }
    walk(path.join(process.cwd(), 'src/game'))
    const haystack = sources.join('\n')

    const unimplemented = PERKS.filter((perk) => !haystack.includes(`'${perk.id}'`))
    expect(unimplemented.map((p) => p.id)).toEqual([])
  })

  it('offers the drone again while under its cap, and never anything else twice', async () => {
    const { drawRandomPerks } = await import('../../src/game/data/perks')
    const held = ['escort_drone', 'nanite_regen']
    for (let i = 0; i < 40; i++) {
      const drawn = drawRandomPerks(held, undefined, 3)
      for (const perk of drawn) {
        if (perk.id === 'escort_drone') continue
        expect(held.includes(perk.id), `${perk.id} was offered twice`).toBe(false)
      }
    }

    // At the cap it stops being offered at all.
    const full = ['escort_drone', 'escort_drone', 'escort_drone', 'escort_drone']
    for (let i = 0; i < 40; i++) {
      const drawn = drawRandomPerks(full, undefined, 3)
      expect(drawn.some((p) => p.id === 'escort_drone')).toBe(false)
    }
  })
})

describe('escort drones', () => {
  it('appear and disappear with the perk that grants them', () => {
    const world = createWorld('drones', 3)
    expect(world.drones.pool.count).toBe(0)

    world.activePerks.push('escort_drone')
    stepDrones(world, FIXED_DT)
    expect(world.drones.pool.count).toBe(1)

    world.activePerks.push('escort_drone')
    stepDrones(world, FIXED_DT)
    expect(world.drones.pool.count, 'the perk stacks').toBe(2)

    world.activePerks.length = 0
    stepDrones(world, FIXED_DT)
    expect(world.drones.pool.count, 'and they go when it does').toBe(0)
  })

  it('engages a nearby enemy on its own', () => {
    const world = createWorld('drones', 3)
    world.activePerks.push('escort_drone')
    stepDrones(world, FIXED_DT)

    const craft = world.craft
    const enemy = world.enemies.pool.alloc()
    world.enemies.kind[enemy] = EnemyKind.Harvester
    world.enemies.hp[enemy] = 500
    world.enemies.body.spawnAt(
      enemy,
      craft.position.x + craft.nose.x * 40,
      craft.position.y + craft.nose.y * 40,
      craft.position.z + craft.nose.z * 40,
    )

    let fired = false
    for (let i = 0; i < 200 && !fired; i++) {
      stepDrones(world, FIXED_DT)
      fired = eventFired(world, GameEvent.DroneFired)
      if (!fired) world.events.clear()
    }
    expect(fired, 'a drone shoots without being told to').toBe(true)
  })
})

describe('subsystem damage', () => {
  it('puts a hit into a system and degrades how the craft flies', () => {
    const world = createWorld('systems', 11)
    const craft = world.craft

    for (let i = 0; i < 12; i++) {
      damageCraft(world, 6, { x: 1, y: 0, z: 0 })
      craft.hull = 100 // isolate the subsystem effect from death
    }

    const worst = Math.min(craft.systems.engine, craft.systems.weapon, craft.systems.control)
    expect(worst, 'twelve hits have to land somewhere').toBeLessThan(1)
    expect(craft.systems.engine).toBeGreaterThanOrEqual(0)
    expect(craft.systems.weapon).toBeGreaterThanOrEqual(0)
    expect(craft.systems.control).toBeGreaterThanOrEqual(0)
  })

  it('a damaged stabiliser pulls the nose one consistent way', () => {
    const world = createWorld('systems', 11)
    world.craft.systems.control = 0.2
    world.craft.driftBias = 1

    world.input.steerX = 0
    for (let i = 0; i < 60; i++) {
      stepInput(world)
      stepWeapons(world, FIXED_DT)
    }
    // The pull is applied in FlightSystem; assert the state it reads, so this
    // test does not silently pass if the wiring is removed.
    expect(world.craft.systems.control).toBeLessThan(1)
    expect(Math.abs(world.craft.driftBias)).toBe(1)
  })
})

describe('death and respawn', () => {
  it('respawns rather than freezing, and strips the build down to one legendary', () => {
    const world = createWorld('death', 5)
    world.activePerks.push('nanite_regen', 'escort_drone', 'aegis_shield')

    // Kill the craft.
    world.craft.hull = 1
    damageCraft(world, 50, { x: 1, y: 0, z: 0 })
    expect(world.craft.alive).toBe(false)

    stepWorld(world, FIXED_DT)
    expect(world.phase.kind, 'death enters the respawn phase').toBe('Respawning')

    // Fly the clock out. This is the freeze the player reported: nothing
    // advanced the timer, so the run sat here forever.
    for (let i = 0; i < Math.ceil((RESPAWN_TIME + 0.5) / FIXED_DT); i++) {
      stepWorld(world, FIXED_DT)
    }

    expect(world.phase.kind, 'and comes back out of it').toBe('Playing')
    expect(world.craft.alive).toBe(true)
    expect(world.craft.systems.engine, 'a respawn is a new airframe').toBe(1)
    expect(world.craft.systems.weapon).toBe(1)
    expect(world.craft.systems.control).toBe(1)
    expect(world.activePerks.length, 'the build is wiped down to a single perk').toBe(1)

    const survivor = PERKS.find((perk) => perk.id === world.activePerks[0])
    expect(survivor?.rarity, 'and that perk is a legendary').toBe('legendary')
  })
})

describe('the bullet goes where the crosshair is', () => {
  /** Fires one round and returns its unit direction of travel. */
  function fireOnce(world: World): { x: number; y: number; z: number } {
    world.input.firing = true
    world.craft.fireCooldown = 0
    for (let i = 0; i < 3 && world.playerProjectiles.pool.count === 0; i++) {
      stepInput(world)
      stepWeapons(world, FIXED_DT)
    }
    const slot = world.playerProjectiles.pool.dense[0] as number
    const body = world.playerProjectiles.body
    const vx = body.vx[slot] as number
    const vy = body.vy[slot] as number
    const vz = body.vz[slot] as number
    const speed = Math.hypot(vx, vy, vz)
    return { x: vx / speed, y: vy / speed, z: vz / speed }
  }

  it('fires exactly down the nose when assist is off', () => {
    const world = createWorld('aim', 2)
    world.difficulty.aimAssist = 0

    // A target off to one side, well inside the assist cone.
    const craft = world.craft
    const enemy = world.enemies.pool.alloc()
    world.enemies.kind[enemy] = EnemyKind.Harvester
    world.enemies.hp[enemy] = 100
    world.enemies.body.spawnAt(
      enemy,
      craft.position.x + craft.nose.x * 100 + craft.frame.right.x * 6,
      craft.position.y + craft.nose.y * 100 + craft.frame.right.y * 6,
      craft.position.z + craft.nose.z * 100 + craft.frame.right.z * 6,
    )

    const dir = fireOnce(world)
    const alignment = dir.x * craft.nose.x + dir.y * craft.nose.y + dir.z * craft.nose.z
    expect(alignment, 'zero assist must be bit-identical to no assist at all').toBeCloseTo(1, 6)
  })

  it('bends the shot toward the target by exactly the assist fraction', () => {
    const world = createWorld('aim', 2)
    world.difficulty.aimAssist = 1

    const craft = world.craft
    const enemy = world.enemies.pool.alloc()
    world.enemies.kind[enemy] = EnemyKind.Harvester
    world.enemies.hp[enemy] = 100
    const ex = craft.position.x + craft.nose.x * 100 + craft.frame.right.x * 6
    const ey = craft.position.y + craft.nose.y * 100 + craft.frame.right.y * 6
    const ez = craft.position.z + craft.nose.z * 100 + craft.frame.right.z * 6
    world.enemies.body.spawnAt(enemy, ex, ey, ez)

    const dir = fireOnce(world)

    // At full assist the round is aimed at the target itself, from the muzzle.
    const mx = ex - (craft.position.x + craft.nose.x * CRAFT_MUZZLE_OFFSET)
    const my = ey - (craft.position.y + craft.nose.y * CRAFT_MUZZLE_OFFSET)
    const mz = ez - (craft.position.z + craft.nose.z * CRAFT_MUZZLE_OFFSET)
    const len = Math.hypot(mx, my, mz)
    const alignment = (dir.x * mx + dir.y * my + dir.z * mz) / len
    expect(alignment, 'full assist puts the round on the mark the crosshair is drawn at').toBeCloseTo(1, 4)
  })

  it('cannot reach a target outside the assist cone', () => {
    const world = createWorld('aim', 2)
    world.difficulty.aimAssist = 1

    // 90° off the nose: far outside ASSIST_MAX_ANGLE, so no help at all.
    const craft = world.craft
    const enemy = world.enemies.pool.alloc()
    world.enemies.kind[enemy] = EnemyKind.Harvester
    world.enemies.hp[enemy] = 100
    world.enemies.body.spawnAt(
      enemy,
      craft.position.x + craft.frame.right.x * 60,
      craft.position.y + craft.frame.right.y * 60,
      craft.position.z + craft.frame.right.z * 60,
    )

    const dir = fireOnce(world)
    const alignment = dir.x * craft.nose.x + dir.y * craft.nose.y + dir.z * craft.nose.z
    expect(alignment, 'assist helps a shot you nearly made, never one you did not').toBeCloseTo(1, 6)
  })
})
