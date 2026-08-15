import { describe, expect, it } from 'vitest'
import { createWorld, EnemyKind } from '../../src/game/core/World'
import { bombLaunchVelocity, predictBombImpact, spawnBomb, stepBombs } from '../../src/game/entities/Bomb'
import { stepFlight } from '../../src/game/systems/FlightSystem'
import { stepInput } from '../../src/game/systems/InputSystem'
import { stepWeapons } from '../../src/game/systems/WeaponSystem'
import { settleWave } from '../../src/game/systems/ScoreSystem'
import { resolveLoadout, stockLoadout } from '../../src/game/systems/LoadoutSystem'
import { drawRandomPerks, PERKS } from '../../src/game/data/perks'
import { BOMB_SPEED, FIXED_DT, LOCK_MEMORY, R } from '../../src/game/data/constants'

describe('Heavy Bomber Capabilities & Bomb Ordnance', () => {
  it('spawns heavy bombs and integrates lunar gravity trajectory toward surface', () => {
    const world = createWorld('test-seed', 42)
    const craft = world.craft
    craft.position.x = 0
    craft.position.y = R + 50
    craft.position.z = 0

    const slot = spawnBomb(world.bombs, craft.position, { x: 0, y: 0, z: 0 })
    expect(slot).toBeGreaterThanOrEqual(0)
    expect(world.bombs.pool.count).toBe(1)

    // Advance bomb simulation
    stepBombs(world, 0.1)

    // Bomb should have accelerated downward toward lunar center (y decreasing)
    expect(world.bombs.body.y[slot]).toBeLessThan(R + 50)
  })

  it('predicts the impact point the bomb actually reaches', () => {
    // The claim the HUD marker makes. If these two ever disagree, the impact
    // ring is decoration — and a player who bombs where the ring says would
    // miss, which is worse than having no ring at all.
    const world = createWorld('test-seed', 42)
    const craft = world.craft
    craft.position.x = 0
    craft.position.y = 0
    craft.position.z = R + 30
    // Moving fast, sideways: the case the old 0.7 inheritance factor got wrong.
    craft.velocity.x = 26
    craft.velocity.y = 4
    craft.velocity.z = 0

    const down = { x: 0, y: 0, z: -1 }
    const origin = { x: 0, y: 0, z: R + 28 }
    const launch = bombLaunchVelocity({ x: 0, y: 0, z: 0 }, craft.velocity, down, BOMB_SPEED)

    const predicted = { x: 0, y: 0, z: 0 }
    const fall = predictBombImpact(world, origin, launch, predicted)
    expect(fall, 'a drop from cruise altitude lands').toBeGreaterThan(0)

    // Now fly the real thing and compare.
    const slot = spawnBomb(world.bombs, origin, craft.velocity, down, BOMB_SPEED)
    let elapsed = 0
    while (world.bombs.pool.active[slot] === 1 && elapsed < 12) {
      stepBombs(world, FIXED_DT)
      elapsed += FIXED_DT
    }

    expect(elapsed).toBeCloseTo(fall, 5)
    // The last integrated position before release is what the detonation used.
    expect(world.bombs.body.x[slot]).toBeCloseTo(predicted.x, 6)
    expect(world.bombs.body.y[slot]).toBeCloseTo(predicted.y, 6)
    expect(world.bombs.body.z[slot]).toBeCloseTo(predicted.z, 6)
  })

  it('carries the craft\'s full velocity downrange', () => {
    // A released body keeps the carrier's momentum. Dropping it "mostly" down
    // is what made the bay unaimable.
    const speed = 26
    const launch = bombLaunchVelocity(
      { x: 0, y: 0, z: 0 },
      { x: speed, y: 0, z: 0 },
      { x: 0, y: 0, z: -1 },
      BOMB_SPEED,
    )
    expect(launch.x).toBe(speed)
    expect(launch.z).toBe(-BOMB_SPEED)
  })

  it('detonates upon reaching lunar surface floor and hits enemies in blast radius', () => {
    const world = createWorld('test-seed', 42)

    // Spawn a landed harvester on moon surface
    const enemySlot = world.enemies.pool.alloc()
    world.enemies.kind[enemySlot] = EnemyKind.Harvester
    world.enemies.hp[enemySlot] = 100
    world.enemies.body.spawnAt(enemySlot, 0, R + 3.2, 0, 0, 0, 0)

    // Spawn bomb directly above
    const bombSlot = spawnBomb(world.bombs, { x: 0, y: R + 1.0, z: 0 }, { x: 0, y: -10, z: 0 })
    expect(bombSlot).toBeGreaterThanOrEqual(0)

    // Step physics to hit floor (R + 0.8)
    stepBombs(world, 0.1)

    // Enemy should take heavy bomb blast damage
    expect(world.enemies.hp[enemySlot]).toBeLessThan(100)
  })
})

describe('75° Steep Pitch & Newtonian Engine Cut Float Mode', () => {
  it('allows 75-degree dive pitch towards lunar terrain', () => {
    const world = createWorld('test-seed', 42)
    const craft = world.craft

    // Pitch down to 70 degrees
    craft.pitch = -((70 * Math.PI) / 180)
    world.input.climb = -1

    stepFlight(world, 0.016)

    // Pitch should not be clamped by the old 38° limit
    expect(Math.abs(craft.pitch)).toBeGreaterThan((45 * Math.PI) / 180)
  })

  it('cuts engine thrust and enables momentum float on toggle', () => {
    const world = createWorld('test-seed', 42)
    const craft = world.craft
    craft.velocity.x = 20
    craft.velocity.y = 0
    craft.velocity.z = 0

    // Press engine cut toggle
    world.input.engineCutToggle = true
    stepInput(world)
    stepFlight(world, 0.016)

    expect(craft.engineCut).toBe(true)

    // Cruise throttle must NOT reignite it. Hands-off throttle is 1.0, so a
    // reignite on throttle alone cancelled the cut on the step after the press
    // and the control could never be used at all.
    world.input.engineCutToggle = false
    world.input.throttle = 1
    stepInput(world)
    stepFlight(world, 0.016)
    expect(craft.engineCut, 'cruise throttle leaves the engine cut').toBe(true)

    // Boost is an explicit act, and it brings the engine back.
    world.input.boosting = true
    stepInput(world)
    stepFlight(world, 0.016)
    expect(craft.engineCut).toBe(false)
  })

  it('toggles once per press, not once per step, however long the key is held', () => {
    // The bug this guards: the toggle read the *held* flag, and the fixed step
    // runs at 120 Hz — so a normal 150 ms keypress flipped the engine eighteen
    // times and settled on whichever side the parity happened to land.
    const world = createWorld('test-seed', 42)
    const craft = world.craft

    world.input.engineCutToggle = true
    for (let i = 0; i < 20; i++) {
      stepInput(world)
      stepFlight(world, FIXED_DT)
    }
    expect(craft.engineCut, 'one press is one toggle').toBe(true)

    world.input.engineCutToggle = false
    for (let i = 0; i < 5; i++) {
      stepInput(world)
      stepFlight(world, FIXED_DT)
    }
    expect(craft.engineCut, 'releasing changes nothing').toBe(true)

    world.input.engineCutToggle = true
    for (let i = 0; i < 20; i++) {
      stepInput(world)
      stepFlight(world, FIXED_DT)
    }
    expect(craft.engineCut, 'the second press toggles back').toBe(false)
  })
})

describe('Weapon mode switching', () => {
  it('switches once per press and reports the mode', () => {
    const world = createWorld('test-seed', 42)
    const craft = world.craft
    expect(craft.activeWeaponMode).toBe('cannon')

    world.input.switchWeapon = true
    for (let i = 0; i < 30; i++) {
      stepInput(world)
      stepWeapons(world, FIXED_DT)
    }
    expect(craft.activeWeaponMode, 'a quarter-second press is one switch').toBe('missiles')

    world.input.switchWeapon = false
    stepInput(world)
    stepWeapons(world, FIXED_DT)
    world.input.switchWeapon = true
    for (let i = 0; i < 30; i++) {
      stepInput(world)
      stepWeapons(world, FIXED_DT)
    }
    expect(craft.activeWeaponMode).toBe('cannon')
  })

  it('fires missiles at the locked target while in missile mode', () => {
    const world = createWorld('test-seed', 42)
    const craft = world.craft
    craft.activeWeaponMode = 'missiles'

    // An enemy dead ahead, inside the lock cone.
    const enemy = world.enemies.pool.alloc()
    world.enemies.kind[enemy] = EnemyKind.Interceptor
    world.enemies.hp[enemy] = 100
    world.enemies.body.spawnAt(
      enemy,
      craft.position.x + craft.nose.x * 60,
      craft.position.y + craft.nose.y * 60,
      craft.position.z + craft.nose.z * 60,
    )

    world.input.locking = true
    for (let i = 0; i < 120; i++) {
      stepInput(world)
      stepWeapons(world, FIXED_DT)
    }
    expect(craft.lock.kind, 'a held lock completes').toBe('Locked')

    // Releasing must NOT fire — that was the old behaviour, and it threw a
    // missile every time the player let go to fly.
    world.input.locking = false
    stepInput(world)
    stepWeapons(world, FIXED_DT)
    expect(world.missiles.pool.count).toBe(0)
    expect(craft.lock.kind, 'the lock survives the release').toBe('Locked')

    world.input.firing = true
    stepInput(world)
    stepWeapons(world, FIXED_DT)
    expect(world.missiles.pool.count).toBe(1)
    expect(world.missiles.target[0]).toBe(enemy)
  })

  it('drops a released lock once its memory runs out', () => {
    const world = createWorld('test-seed', 42)
    const craft = world.craft
    const enemy = world.enemies.pool.alloc()
    world.enemies.kind[enemy] = EnemyKind.Interceptor
    world.enemies.hp[enemy] = 100
    const place = () => {
      world.enemies.body.spawnAt(
        enemy,
        craft.position.x + craft.nose.x * 60,
        craft.position.y + craft.nose.y * 60,
        craft.position.z + craft.nose.z * 60,
      )
    }

    world.input.locking = true
    for (let i = 0; i < 120; i++) {
      place()
      stepInput(world)
      stepWeapons(world, FIXED_DT)
    }
    expect(craft.lock.kind).toBe('Locked')

    world.input.locking = false
    // Just under the memory window: still held, even though the control is up.
    for (let i = 0; i < Math.floor((LOCK_MEMORY - 0.2) / FIXED_DT); i++) {
      place()
      stepInput(world)
      stepWeapons(world, FIXED_DT)
    }
    expect(craft.lock.kind, 'the lock outlives the button').toBe('Locked')

    // Past it: gone, even with the target sitting on the nose.
    for (let i = 0; i < Math.ceil(0.4 / FIXED_DT); i++) {
      place()
      stepInput(world)
      stepWeapons(world, FIXED_DT)
    }
    expect(craft.lock.kind, 'but it is a memory, not a subscription').toBe('Idle')
  })

  it('drops the lock when its target dies', () => {
    const world = createWorld('test-seed', 42)
    const craft = world.craft
    const enemy = world.enemies.pool.alloc()
    world.enemies.kind[enemy] = EnemyKind.Interceptor
    world.enemies.hp[enemy] = 100
    world.enemies.body.spawnAt(
      enemy,
      craft.position.x + craft.nose.x * 60,
      craft.position.y + craft.nose.y * 60,
      craft.position.z + craft.nose.z * 60,
    )

    world.input.locking = true
    for (let i = 0; i < 120; i++) {
      stepInput(world)
      stepWeapons(world, FIXED_DT)
    }
    expect(craft.lock.kind).toBe('Locked')

    // Target destroyed: the lock has nothing to hold.
    world.enemies.pool.release(enemy)
    stepInput(world)
    stepWeapons(world, FIXED_DT)
    expect(craft.lock.kind).toBe('Idle')
  })
})

describe('Roguelike Perk System (18 Perks & Drafting)', () => {
  it('provides at least 18 unique perks across all categories and rarities', () => {
    expect(PERKS.length).toBeGreaterThanOrEqual(18)
    const ids = new Set(PERKS.map((p) => p.id))
    expect(ids.size).toBe(PERKS.length)
  })

  it('drafts 3 distinct random perks excluding already active ones', () => {
    const active = ['nanite_regen', 'orbital_bombs']
    const drafted = drawRandomPerks(active, undefined, 3)

    expect(drafted.length).toBe(3)
    for (const perk of drafted) {
      expect(active.includes(perk.id)).toBe(false)
    }
  })

  it('applies Nanite Auto-Regeneration perk during flight', () => {
    const world = createWorld('test-seed', 42)
    const craft = world.craft
    craft.hull = 50
    world.activePerks.push('nanite_regen')

    stepWeapons(world, 1.0)

    // Should regenerate +2% max HP per second (50 -> 52)
    expect(craft.hull).toBeCloseTo(52, 1)
  })

  it('activates Aegis Overshield perk up to 35 extra barrier HP', () => {
    const world = createWorld('test-seed', 42)
    const craft = world.craft
    craft.aegisShield = 0
    world.activePerks.push('aegis_shield')

    stepWeapons(world, 2.0)

    expect(craft.aegisShield).toBeGreaterThan(0)
  })
})

describe('Economy, Sector Dividends & Hangar Store Tuning', () => {
  it('awards sector defense dividends on wave clear', () => {
    const world = createWorld('test-seed', 42)
    world.credits = 0

    // 8 outposts at 100% integrity
    for (let i = 0; i < world.outposts.length; i++) {
      const outpost = world.outposts[i]
      if (outpost) outpost.integrity = 100
    }

    const summary = settleWave(world)
    expect(summary.creditsEarned).toBeGreaterThan(0)
    expect(world.credits).toBe(summary.creditsEarned)
  })

  it('calibrates loadout multipliers according to continuous part tuning sliders', () => {
    const base = resolveLoadout(stockLoadout(), {})
    const highSpeed = resolveLoadout(stockLoadout(), { Engine: -1.0 })
    const highAgility = resolveLoadout(stockLoadout(), { Engine: 1.0 })

    expect(highSpeed.modifiers.thrust).toBeGreaterThan(base.modifiers.thrust)
    expect(highAgility.modifiers.turnRate).toBeGreaterThan(base.modifiers.turnRate)
  })
})
