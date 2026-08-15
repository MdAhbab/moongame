/**
 * The eight outposts (gameplan §7.2).
 *
 * Named, not numbered, so the Debrief can say "Lost Cassini" — which is
 * memorable in a way "Outpost 3" is not (§12.2 P4). Positions are fixed across
 * every run so spatial memory builds between attempts.
 */
import { R } from './constants.ts'
import { create, scale, type Vec3 } from '../math/vec3.ts'
import { fibonacciDirection } from '../math/spherical.ts'

/** Exact names from §7.2, in roster order. Rule 8: never invent synonyms. */
export const OUTPOST_NAMES = [
  'VEGA',
  'CASSINI',
  'KEPLER',
  'TYCHO',
  'HADLEY',
  'AITKEN',
  'RILLE',
  'NECTARIS',
] as const

export type OutpostName = (typeof OUTPOST_NAMES)[number]

export interface OutpostDefinition {
  readonly index: number
  readonly name: OutpostName
  /** Unit surface normal — also the outpost's "up" (§20.2). */
  readonly direction: Readonly<Vec3>
  /** World position on the surface. */
  readonly position: Readonly<Vec3>
}

/**
 * Built once at module load from the Fibonacci lattice (§7.2), so positions are
 * identical in the simulation, the Orbital Map, the Briefing map, and the
 * headless test harness — there is one source of truth for where things are.
 */
export const OUTPOSTS: readonly OutpostDefinition[] = OUTPOST_NAMES.map((name, index) => {
  const direction = fibonacciDirection(create(), index, OUTPOST_NAMES.length)
  return {
    index,
    name,
    direction,
    position: scale(create(), direction, R),
  }
})
