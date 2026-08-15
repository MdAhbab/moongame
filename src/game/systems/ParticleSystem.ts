/**
 * Particles (gameplan §26).
 *
 * A single pre-allocated pool of 1,024 in struct-of-arrays layout, rendered as
 * one `InstancedMesh` of camera-facing quads — **one draw call for every
 * particle in the game.**
 *
 * V1 created 40 new `SphereGeometry` meshes *plus 40 new materials* per
 * explosion and disposed none of them. That is not a micro-optimisation being
 * fixed here; it is the difference between a game that degrades over five
 * minutes and one that does not.
 *
 * Particles are affected by radial gravity and bounce off the surface using the
 * exact reflection in §20.3 — physically consistent with everything else in the
 * world, at negligible cost.
 */
import type { ParticleStore, World } from '../core/World.ts'
import { type Vec3, create, normalize, scale } from '../math/vec3.ts'
import { bounceOffSurface } from '../physics/collision/response.ts'
import { G, PARTICLE_DRAG, R, RESTITUTION } from '../data/constants.ts'

const direction: Vec3 = create()
const point: Vec3 = create()
const velocityScratch: Vec3 = create()

/** Colour presets, matching the §15.2 palette so effects never invent a hue. */
export const ParticleColour = {
  friendly: [0.5, 0.91, 1.0],
  hostile: [1.0, 0.54, 0.24],
  caution: [1.0, 0.78, 0.34],
  critical: [1.0, 1.0, 1.0],
  regolith: [0.72, 0.71, 0.68],
  inert: [0.29, 0.31, 0.35],
  flare: [1.0, 0.95, 0.55],
} as const satisfies Record<string, readonly [number, number, number]>

export type ParticleColourName = keyof typeof ParticleColour

/**
 * Emits a cone or radial burst from a point.
 *
 * Silently emits fewer particles when the pool is exhausted rather than
 * growing it. A capped pool means a heavy firefight degrades the *effects*
 * smoothly instead of degrading the frame rate, which is the right trade when
 * the player is mid-decision (§3 principle 3).
 *
 * @param spread 0 for a tight cone along `axis`, 1 for a fully radial burst
 * @hot-path
 */
export function emitBurst(
  world: World,
  x: number,
  y: number,
  z: number,
  count: number,
  speed: number,
  life: number,
  size: number,
  colour: ParticleColourName,
  spread: number,
  axis: Readonly<Vec3> | null,
  bounces: boolean,
): void {
  const store = world.particles
  const rgb = ParticleColour[colour]

  for (let i = 0; i < count; i++) {
    const slot = store.pool.alloc()
    if (slot < 0) return

    // Uniform on the sphere: acos-distributed polar angle, not a naive
    // uniform-angle pick, which clusters at the poles and reads as a cross.
    const theta = world.rng.range(0, Math.PI * 2)
    const cosPhi = 1 - world.rng.next() * 2 * spread
    const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi))

    direction.x = sinPhi * Math.cos(theta)
    direction.y = sinPhi * Math.sin(theta)
    direction.z = cosPhi
    normalize(direction)

    if (axis !== null && spread < 1) {
      direction.x += axis.x * (1 - spread)
      direction.y += axis.y * (1 - spread)
      direction.z += axis.z * (1 - spread)
      normalize(direction)
    }

    const v = speed * world.rng.range(0.55, 1.35)
    store.body.spawnAt(slot, x, y, z, direction.x * v, direction.y * v, direction.z * v)

    const ttl = life * world.rng.range(0.75, 1.25)
    store.life[slot] = ttl
    store.maxLife[slot] = ttl
    store.size[slot] = size * world.rng.range(0.7, 1.3)
    store.r[slot] = rgb[0]
    store.g[slot] = rgb[1]
    store.b[slot] = rgb[2]
    store.bounces[slot] = bounces ? 1 : 0
  }
}

/** @hot-path */
export function stepParticles(world: World, dt: number): void {
  const store: ParticleStore = world.particles
  const { pool, body, life } = store

  for (let i = pool.count - 1; i >= 0; i--) {
    const slot = pool.dense[i] as number

    const remaining = (life[slot] as number) - dt
    life[slot] = remaining
    if (remaining <= 0) {
      pool.release(slot)
      continue
    }

    body.savePrevious(slot)

    point.x = body.x[slot] as number
    point.y = body.y[slot] as number
    point.z = body.z[slot] as number
    velocityScratch.x = body.vx[slot] as number
    velocityScratch.y = body.vy[slot] as number
    velocityScratch.z = body.vz[slot] as number

    // §22.2 — the same radial gravity the craft feels.
    const radius = Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z)
    if (radius > 1e-6) {
      const g = (G * dt) / radius
      velocityScratch.x -= point.x * g
      velocityScratch.y -= point.y * g
      velocityScratch.z -= point.z * g
    }

    // Exponential drag — the analytic form, exact at any timestep (§21.4).
    scale(velocityScratch, velocityScratch, Math.pow(PARTICLE_DRAG, dt))

    point.x += velocityScratch.x * dt
    point.y += velocityScratch.y * dt
    point.z += velocityScratch.z * dt

    if (store.bounces[slot] === 1) {
      // §20.3 — exact reflection, because n̂ = p̂ on a sphere (§20.2).
      if (bounceOffSurface(point, velocityScratch, R + 0.3, RESTITUTION)) {
        // Bounced debris loses part of its remaining life so the ground does
        // not slowly fill with skittering fragments.
        life[slot] = remaining * 0.6
      }
    }

    body.x[slot] = point.x
    body.y[slot] = point.y
    body.z[slot] = point.z
    body.vx[slot] = velocityScratch.x
    body.vy[slot] = velocityScratch.y
    body.vz[slot] = velocityScratch.z
  }
}
