/**
 * Spherical parameterisation and arc geometry (gameplan §19.2).
 *
 * Cartesian is used for all simulation because trigonometric updates accumulate
 * error and are slower; these helpers exist for spawn placement, the broadphase
 * grid (§23.3), the Orbital Map, and the travel-time estimates that drive every
 * triage decision.
 */
import { type Vec3, set, normalize } from './vec3.ts'

/**
 * Great-circle distance between two surface points.
 *
 *   d_arc = R · arccos(p̂₁ · p̂₂)
 *
 * This is the "how far must I fly?" quantity (§19.2). It produces the Briefing
 * screen's travel-time estimate and lets the spawner place threats at a chosen
 * difficulty of spatial spread (§10.1 axis 4).
 *
 * The dot product is clamped because floating-point error can push it a few
 * ulps outside [-1, 1], where `acos` returns NaN.
 */
export function arcDistance(a: Readonly<Vec3>, b: Readonly<Vec3>, radius: number): number {
  const la = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
  const lb = Math.sqrt(b.x * b.x + b.y * b.y + b.z * b.z)
  if (la < 1e-12 || lb < 1e-12) return 0
  const cos = (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb)
  return radius * Math.acos(Math.min(1, Math.max(-1, cos)))
}

/** Travel time over an arc at a given cruise speed — the game's core currency (§7.1). */
export function travelTime(arc: number, speed: number): number {
  return speed > 1e-6 ? arc / speed : Infinity
}

/**
 * The `i`-th direction of an `n`-point Fibonacci sphere lattice.
 *
 * Chosen over a lat/long grid because it distributes points near-uniformly with
 * no polar clustering, which is what guarantees §7.2's "no two outposts are
 * trivially close" — the property the triage decision depends on.
 */
export function fibonacciDirection(out: Vec3, i: number, n: number): Vec3 {
  const golden = Math.PI * (3 - Math.sqrt(5))
  const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2
  const r = Math.sqrt(Math.max(0, 1 - y * y))
  const theta = golden * i
  return normalize(set(out, Math.cos(theta) * r, y, Math.sin(theta) * r))
}

/** Longitude in [0, 2π) — the azimuth about the +Y axis. */
export function longitudeOf(p: Readonly<Vec3>): number {
  const a = Math.atan2(p.z, p.x)
  return a < 0 ? a + Math.PI * 2 : a
}

/** Latitude in [-π/2, π/2], measured from the equatorial plane. */
export function latitudeOf(p: Readonly<Vec3>): number {
  const len = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z)
  if (len < 1e-12) return 0
  return Math.asin(Math.min(1, Math.max(-1, p.y / len)))
}

/** Altitude above the surface of a sphere of the given radius. */
export function altitudeOf(p: Readonly<Vec3>, radius: number): number {
  return Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z) - radius
}
