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
import { stepProjectiles } from '../entities/Projectile.ts'
import { stepMissiles } from '../entities/Missile.ts'

/** @hot-path */
export function stepAI(world: World, dt: number): void {
  const { pool, body } = world.enemies

  for (let i = 0; i < pool.count; i++) {
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
      default:
        break
    }
  }

  stepProjectiles(world.playerProjectiles, dt)
  stepProjectiles(world.enemyProjectiles, dt)
  stepMissiles(world, dt)
}
