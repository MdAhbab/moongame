/**
 * Allocation-free 3-vector operations (gameplan §30.1, Rule 3).
 *
 * Replaces `three`'s `Vector3` inside `src/game/**`, which may not import three
 * (§30.2). Every operation writes into a caller-supplied `out`, so the hot path
 * can run with zero heap traffic: callers hold module-scoped scratch vectors and
 * reuse them (§34.2).
 *
 * `Vec3` is a plain object rather than a class so it is structurally typed,
 * trivially cloneable for test fixtures, and free of prototype lookups.
 */
export interface Vec3 {
  x: number
  y: number
  z: number
}

/** Allocates. Startup and test code only — never the frame path. */
export function create(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z }
}

/** @hot-path */
export function set(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x
  out.y = y
  out.z = z
  return out
}

/** @hot-path */
export function copy(out: Vec3, a: Readonly<Vec3>): Vec3 {
  out.x = a.x
  out.y = a.y
  out.z = a.z
  return out
}

/** @hot-path */
export function zero(out: Vec3): Vec3 {
  out.x = 0
  out.y = 0
  out.z = 0
  return out
}

/** @hot-path */
export function add(out: Vec3, a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 {
  out.x = a.x + b.x
  out.y = a.y + b.y
  out.z = a.z + b.z
  return out
}

/** @hot-path */
export function sub(out: Vec3, a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 {
  out.x = a.x - b.x
  out.y = a.y - b.y
  out.z = a.z - b.z
  return out
}

/** @hot-path */
export function scale(out: Vec3, a: Readonly<Vec3>, s: number): Vec3 {
  out.x = a.x * s
  out.y = a.y * s
  out.z = a.z * s
  return out
}

/** `out += a * s`. The workhorse of symplectic integration (§18.3). @hot-path */
export function addScaled(out: Vec3, a: Readonly<Vec3>, s: number): Vec3 {
  out.x += a.x * s
  out.y += a.y * s
  out.z += a.z * s
  return out
}

/** @hot-path */
export function dot(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

/** Right-handed cross product. `out` must not alias `a` or `b`. @hot-path */
export function cross(out: Vec3, a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 {
  const x = a.y * b.z - a.z * b.y
  const y = a.z * b.x - a.x * b.z
  const z = a.x * b.y - a.y * b.x
  out.x = x
  out.y = y
  out.z = z
  return out
}

/** @hot-path */
export function lengthSq(a: Readonly<Vec3>): number {
  return a.x * a.x + a.y * a.y + a.z * a.z
}

/** @hot-path */
export function length(a: Readonly<Vec3>): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
}

/** @hot-path */
export function distanceSq(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

/** @hot-path */
export function distance(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return Math.sqrt(distanceSq(a, b))
}

/**
 * Normalises in place. A zero-length input is left untouched rather than
 * producing NaN — a NaN here would propagate silently through the tangent frame
 * and corrupt every downstream basis for the rest of the run.
 * @hot-path
 */
export function normalize(out: Vec3): Vec3 {
  const len = Math.sqrt(out.x * out.x + out.y * out.y + out.z * out.z)
  if (len > 1e-12) {
    const inv = 1 / len
    out.x *= inv
    out.y *= inv
    out.z *= inv
  }
  return out
}

/** @hot-path */
export function lerp(out: Vec3, a: Readonly<Vec3>, b: Readonly<Vec3>, t: number): Vec3 {
  out.x = a.x + (b.x - a.x) * t
  out.y = a.y + (b.y - a.y) * t
  out.z = a.z + (b.z - a.z) * t
  return out
}

/**
 * Removes the component of `out` parallel to the unit vector `n`, leaving only
 * the part lying in the plane perpendicular to `n`.
 *
 * This is the vector projection at the heart of the tangent frame (§20.1):
 * `f − (f·û)û`. Without it the craft's heading drifts out of the flight surface
 * as it travels around the curve.
 * @hot-path
 */
export function projectOntoPlane(out: Vec3, n: Readonly<Vec3>): Vec3 {
  const d = out.x * n.x + out.y * n.y + out.z * n.z
  out.x -= n.x * d
  out.y -= n.y * d
  out.z -= n.z * d
  return out
}

/**
 * Reflects `out` about the unit normal `n`, scaled by restitution `e`:
 * `v' = (v − 2(v·n̂)n̂) · e`  (§20.3).
 *
 * Used for debris striking the surface, where `n̂ = p̂` is exact (§20.2).
 * @hot-path
 */
export function reflect(out: Vec3, n: Readonly<Vec3>, restitution: number): Vec3 {
  const d = 2 * (out.x * n.x + out.y * n.y + out.z * n.z)
  out.x = (out.x - n.x * d) * restitution
  out.y = (out.y - n.y * d) * restitution
  out.z = (out.z - n.z * d) * restitution
  return out
}

/** True when every component is finite. Used by the NaN-guard tests (§37.2). */
export function isFinite3(a: Readonly<Vec3>): boolean {
  return Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z)
}

/**
 * Builds a unit vector perpendicular to `n`, chosen deterministically.
 *
 * Picks the world axis least aligned with `n` before crossing, because crossing
 * with a nearly-parallel axis loses catastrophic precision.
 */
export function anyPerpendicular(out: Vec3, n: Readonly<Vec3>): Vec3 {
  const ax = Math.abs(n.x)
  const ay = Math.abs(n.y)
  const az = Math.abs(n.z)
  if (ax <= ay && ax <= az) set(out, 1, 0, 0)
  else if (ay <= az) set(out, 0, 1, 0)
  else set(out, 0, 0, 1)
  const d = dot(out, n)
  out.x -= n.x * d
  out.y -= n.y * d
  out.z -= n.z * d
  return normalize(out)
}
