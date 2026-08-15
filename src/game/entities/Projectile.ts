/**
 * Projectiles (gameplan §7.4, §23.2).
 *
 * Fast, straight, and short-lived. They carry no steering and no gravity: at
 * 220 u/s over a 1.6 s life a bullet crosses two thirds of the moon, and a
 * ballistic drop over that distance would make the crosshair a lie in a
 * different way.
 *
 * Collision is *not* handled here — `CollisionSystem` sweeps them analytically
 * so they cannot tunnel (§23.2).
 */
import type { ProjectileStore, World } from '../core/World.ts'
import type { Vec3 } from '../math/vec3.ts'
import { advancePosition } from '../physics/integrate.ts'
import { ALT_CRASH, R } from '../data/constants.ts'

/**
 * Claims a slot and launches a projectile. Returns the slot, or -1 when the
 * pool is full — a full pool simply means the player is firing faster than the
 * world can hold, which the heat model already prevents in practice.
 * @hot-path
 */
export function spawnProjectile(
  store: ProjectileStore,
  origin: Readonly<Vec3>,
  direction: Readonly<Vec3>,
  speed: number,
  life: number,
  damage: number,
): number {
  const slot = store.pool.alloc()
  if (slot < 0) return -1
  store.body.spawnAt(
    slot,
    origin.x,
    origin.y,
    origin.z,
    direction.x * speed,
    direction.y * speed,
    direction.z * speed,
  )
  store.life[slot] = life
  store.damage[slot] = damage
  return slot
}

const surfaceRadiusSq = (R + ALT_CRASH) * (R + ALT_CRASH)

/**
 * Advances every live projectile and retires those that expire or strike the
 * surface. Iterates backwards over the dense list because `release` swaps the
 * last element into the freed position.
 * @hot-path
 */
export function stepProjectiles(store: ProjectileStore, dt: number): void {
  const { pool, body, life } = store
  for (let i = pool.count - 1; i >= 0; i--) {
    const slot = pool.dense[i] as number

    body.savePrevious(slot)
    body.x[slot] = (body.x[slot] as number) + (body.vx[slot] as number) * dt
    body.y[slot] = (body.y[slot] as number) + (body.vy[slot] as number) * dt
    body.z[slot] = (body.z[slot] as number) + (body.vz[slot] as number) * dt

    const remaining = (life[slot] as number) - dt
    life[slot] = remaining

    if (remaining <= 0) {
      pool.release(slot)
      continue
    }

    const x = body.x[slot]
    const y = body.y[slot]
    const z = body.z[slot]
    if (x * x + y * y + z * z < surfaceRadiusSq) {
      pool.release(slot)
    }
  }
}

/** Frees a projectile on impact. Kept as a named call so intent is legible. */
export function retireProjectile(store: ProjectileStore, slot: number): void {
  store.pool.release(slot)
}

/** Reads a projectile's velocity into `out` without allocating. @hot-path */
export function projectileVelocity(store: ProjectileStore, slot: number, out: Vec3): Vec3 {
  out.x = store.body.vx[slot] as number
  out.y = store.body.vy[slot] as number
  out.z = store.body.vz[slot] as number
  return out
}

/** Unused parameter guard so `World` stays imported for the public type surface. */
export type ProjectileWorld = Pick<World, 'playerProjectiles' | 'enemyProjectiles'>

// `advancePosition` is re-exported for the enemy projectile path, which shares
// the same straight-line integration but is stepped from AISystem.
export { advancePosition }
