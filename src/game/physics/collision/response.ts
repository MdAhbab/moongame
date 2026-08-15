/**
 * Collision response (gameplan §22.6, §22.7, §20.3, §23.5).
 *
 * There is no resting contact anywhere in this game, so no solver iteration is
 * required — another reason a full physics engine would be pure overhead
 * (§23.5).
 */
import { type Vec3, addScaled, copy, dot, normalize, reflect, scale, length } from '../../math/vec3.ts'

/** Result of a terrain test, reused so the response path allocates nothing. */
export interface TerrainImpact {
  hit: boolean
  /** Radial closing speed at the moment of contact — damage scales with this. */
  impactSpeed: number
}

const impact: TerrainImpact = { hit: false, impactSpeed: 0 }
const normalScratch: Vec3 = { x: 0, y: 0, z: 0 }

/**
 * Terrain collision against the sphere (§22.6):
 *
 *   if ‖p‖ < R + h_crash:
 *       p ← p̂ · (R + h_crash)     push out along the exact normal
 *       v ← v − (v · û) û          remove radial velocity, keep tangential
 *       damage ∝ |v · û| before removal
 *
 * Removing only the radial component means grazing the surface at a shallow
 * angle costs almost nothing while flying straight into it hurts — which is
 * both physically right and good game feel.
 *
 * The normal is exactly `p̂` for a sphere (§20.2), so this is exact rather than
 * approximated.
 *
 * @hot-path
 */
export function resolveTerrain(position: Vec3, velocity: Vec3, floorRadius: number): Readonly<TerrainImpact> {
  const r = length(position)
  if (r >= floorRadius || r < 1e-9) {
    impact.hit = false
    impact.impactSpeed = 0
    return impact
  }

  copy(normalScratch, position)
  normalize(normalScratch)

  const radialSpeed = dot(velocity, normalScratch)
  impact.hit = true
  impact.impactSpeed = radialSpeed < 0 ? -radialSpeed : 0

  scale(position, normalScratch, floorRadius)
  addScaled(velocity, normalScratch, -radialSpeed)

  return impact
}

/**
 * Bounces a particle off the surface using the exact reflection in §20.3:
 * `v' = (v − 2(v·n̂)n̂) · e`, with `n̂ = p̂`.
 *
 * Returns true when a bounce occurred, so the caller can decide whether the
 * particle should also lose life on contact.
 * @hot-path
 */
export function bounceOffSurface(position: Vec3, velocity: Vec3, surfaceRadius: number, restitution: number): boolean {
  const r = length(position)
  if (r >= surfaceRadius || r < 1e-9) return false

  copy(normalScratch, position)
  normalize(normalScratch)
  if (dot(velocity, normalScratch) >= 0) return false

  scale(position, normalScratch, surfaceRadius)
  reflect(velocity, normalScratch, restitution)
  return true
}

/**
 * Impulse applied on a projectile impact (§22.7): `Δv = (J / m) · n̂`.
 *
 * Deliberately small — enough to be felt as feedback, never enough to take
 * control away. Taking control away *as a consequence of being hit* compounds
 * failure, which §13.5 warns against.
 * @hot-path
 */
export function applyImpulse(velocity: Vec3, direction: Readonly<Vec3>, impulse: number, mass: number): void {
  copy(normalScratch, direction)
  normalize(normalScratch)
  addScaled(velocity, normalScratch, impulse / mass)
}

/**
 * Separates two overlapping spheres along their centre line and exchanges a
 * symmetric impulse. Used only for craft-vs-enemy contact (§23.4); there is no
 * enemy-vs-enemy collision, which would cost broadphase work for nothing.
 * @hot-path
 */
export function separateSpheres(
  positionA: Vec3,
  velocityA: Vec3,
  positionB: Readonly<Vec3>,
  radiusSum: number,
  impulse: number,
  mass: number,
): boolean {
  normalScratch.x = positionA.x - positionB.x
  normalScratch.y = positionA.y - positionB.y
  normalScratch.z = positionA.z - positionB.z
  const d = length(normalScratch)
  if (d >= radiusSum) return false

  if (d < 1e-6) {
    // Exactly coincident: pick a deterministic axis rather than dividing by zero.
    normalScratch.x = 1
    normalScratch.y = 0
    normalScratch.z = 0
  } else {
    const inv = 1 / d
    normalScratch.x *= inv
    normalScratch.y *= inv
    normalScratch.z *= inv
  }

  addScaled(positionA, normalScratch, radiusSum - d)
  addScaled(velocityA, normalScratch, impulse / mass)
  return true
}
