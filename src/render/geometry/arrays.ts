/**
 * Bounds-checked array access for geometry building.
 *
 * `noUncheckedIndexedAccess` widens every indexed read to `number | undefined`.
 * Suppressing that with `!` at each call site would trade a compile-time
 * question for a silent NaN: an out-of-range index in a subdivision or a
 * winding swap propagates into the vertex buffer and shows up as a hole in the
 * mesh, a long way from the line that caused it.
 *
 * Rule 7 allows a non-null assertion "immediately after an explicit check".
 * This is that check, written once. Geometry is baked at startup, never per
 * frame, so the branch costs nothing that matters.
 */

/** Any numeric array these builders index into, plain or typed. */
export type NumericArray = ArrayLike<number>

export function at(array: NumericArray, index: number): number {
  const value = array[index]
  if (value === undefined) {
    throw new RangeError(`geometry: index ${index} out of range (length ${array.length})`)
  }
  return value
}

/**
 * Returns the index buffer, or throws naming the geometry.
 *
 * `getIndex()` returns null for non-indexed geometry, and the usual `!` turns
 * that into a `Cannot read properties of null` several frames later. Naming the
 * caller here is the difference between a five-second fix and a bisect.
 */
export function requireIndex<T extends { getIndex(): { array: ArrayLike<number> } | null }>(
  geometry: T,
  label: string,
): { array: ArrayLike<number> } {
  const index = geometry.getIndex()
  if (index === null) {
    throw new Error(`geometry: "${label}" has no index buffer`)
  }
  return index
}
