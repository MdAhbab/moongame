/**
 * Enemy behaviour dispatch (gameplan §7.3, §20.5, §31.1).
 *
 * Runs after flight so every enemy steers against the player's *current*
 * position rather than last step's, and before collision so all positions are
 * final when contacts are resolved (§31.1's fixed system order).
 */
import { EnemyKind, type World } from '../core/World.ts'
import { updateHarvester } from '../entities/Harvester.ts'
import { updateInterceptor } from '../entities/Interceptor.ts'
import { updateSentinel } from '../entities/Sentinel.ts'
import { updateSapper } from '../entities/Sapper.ts'
import { updateWarden } from '../entities/Warden.ts'
import { updateCarrier } from '../entities/Carrier.ts'
import { stepProjectiles } from '../entities/Projectile.ts'
import { stepMissiles } from '../entities/Missile.ts'

/** @hot-path */
export function stepAI(world: World, dt: number): void {
  const { pool, body } = world.enemies

  // Reverse iteration, because two archetypes mutate the pool from inside this
  // loop: a Sapper releases its own slot when it detonates, and a Carrier
  // allocates one when it launches.
  //
  // `Pool.release` removes from the dense list by swapping in the last element,
  // so a forward walk that released at cursor `i` would advance past the entity
  // just moved into `i` and skip its step entirely — for one frame, an enemy
  // that does not move, aim or fire. Going backwards puts every swap source at a
  // position already visited. It also leaves a Carrier's newly allocated child
  // above the cursor, so it starts cleanly on the next step rather than taking
  // half of this one.
  for (let i = pool.count - 1; i >= 0; i--) {
    const slot = pool.dense[i] as number
    body.savePrevious(slot)

    switch (world.enemies.kind[slot] as number) {
      case EnemyKind.Harvester:
        updateHarvester(world, slot, dt)
        break
      case EnemyKind.Interceptor:
        updateInterceptor(world, slot, dt)
        break
      case EnemyKind.Sentinel:
        updateSentinel(world, slot, dt)
        break
      case EnemyKind.Sapper:
        updateSapper(world, slot, dt)
        break
      case EnemyKind.Warden:
        updateWarden(world, slot, dt)
        break
      case EnemyKind.Carrier:
        updateCarrier(world, slot, dt)
        break
      default:
        break
    }
  }

  stepProjectiles(world.playerProjectiles, dt)
  stepProjectiles(world.enemyProjectiles, dt)
  stepMissiles(world, dt)
}
