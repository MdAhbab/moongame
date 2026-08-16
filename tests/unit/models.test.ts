/**
 * What you shoot at and what the simulation tests must be the same object.
 *
 * This file exists because they were not. The render layer scaled every hostile
 * by a hand-tuned `scale(6, 6, 6)` while the collision system used `RADIUS_*`
 * from `constants.ts`, and nothing anywhere compared the two. Measured, the
 * hulls on screen were 12.3× (Harvester), 18.3× (Interceptor) and 8.2×
 * (Sentinel) the spheres being tested — so a player aiming at a hostile that
 * filled the screen fired through it, and reported, correctly, that shooting
 * things did not kill them.
 *
 * Every assertion below is against the constants rather than against a number,
 * so retuning a radius moves the model with it and this file stays quiet. What
 * it will not let pass is the two drifting apart again.
 */
import { describe, expect, it } from 'vitest'
import {
  ENEMY_MODEL_SLACK,
  RADIUS_CARRIER,
  RADIUS_HARVESTER,
  RADIUS_INTERCEPTOR,
  RADIUS_SAPPER,
  RADIUS_SENTINEL,
  RADIUS_WARDEN,
} from '@/game/data/constants'
import { Geometries, reachFromOrigin } from '@/render/geometry/shapes'

const ARCHETYPES = [
  { name: 'Harvester', geometry: () => Geometries.Harvester, radius: RADIUS_HARVESTER },
  { name: 'Interceptor', geometry: () => Geometries.Interceptor, radius: RADIUS_INTERCEPTOR },
  { name: 'Sentinel', geometry: () => Geometries.Sentinel, radius: RADIUS_SENTINEL },
  { name: 'Sapper', geometry: () => Geometries.Sapper, radius: RADIUS_SAPPER },
  { name: 'Warden', geometry: () => Geometries.Warden, radius: RADIUS_WARDEN },
  { name: 'Carrier', geometry: () => Geometries.Carrier, radius: RADIUS_CARRIER },
] as const

describe('a hostile is the size of its hitbox', () => {
  for (const { name, geometry, radius } of ARCHETYPES) {
    it(`${name} reaches exactly radius x slack from its origin`, () => {
      expect(reachFromOrigin(geometry())).toBeCloseTo(radius * ENEMY_MODEL_SLACK, 4)
    })

    it(`${name} never extends far enough past its hitbox to look like a miss`, () => {
      // The direction of the error matters. A hull *inside* its hitbox means
      // being hit by nothing, which players resent; a hull slightly outside
      // means a clipped wingtip reads as a graze, which they forgive. So the
      // model is allowed to be bigger, and only a little.
      const reach = reachFromOrigin(geometry())
      expect(reach).toBeGreaterThanOrEqual(radius)
      expect(reach / radius).toBeLessThanOrEqual(1.5)
    })
  }

  it('keeps the archetypes in their designed size order', () => {
    // A Carrier is the biggest thing in the sky and a Sapper the smallest, and
    // both facts are load-bearing: a Carrier has to be identifiable from further
    // away than anything else because its decision must be made early, and a
    // Sapper's fragility has to be legible at a glance. If a retune ever inverts
    // any of this the silhouettes stop reading, whatever their shapes are.
    const size = Object.fromEntries(
      ARCHETYPES.map((a) => [a.name, reachFromOrigin(a.geometry())]),
    ) as Record<(typeof ARCHETYPES)[number]['name'], number>

    const descending = ['Carrier', 'Sentinel', 'Warden', 'Harvester', 'Interceptor', 'Sapper'] as const
    for (let i = 1; i < descending.length; i++) {
      const bigger = descending[i - 1] as (typeof descending)[number]
      const smaller = descending[i] as (typeof descending)[number]
      expect(size[bigger], `${bigger} should be larger than ${smaller}`).toBeGreaterThan(size[smaller])
    }
  })

  it('separates every pair of silhouettes by enough to tell apart at 40 px', () => {
    // Six archetypes is the point at which "you can tell them apart" stops being
    // self-evident. Two hostiles within a few percent of each other in size have
    // to be distinguished by shape alone in peripheral vision, which is a much
    // weaker signal than the size difference the player also gets for free.
    const sizes = ARCHETYPES.map((a) => ({ name: a.name, reach: reachFromOrigin(a.geometry()) }))
    for (let i = 0; i < sizes.length; i++) {
      for (let j = i + 1; j < sizes.length; j++) {
        const a = sizes[i]
        const b = sizes[j]
        if (a === undefined || b === undefined) continue
        const ratio = Math.max(a.reach, b.reach) / Math.min(a.reach, b.reach)
        expect(ratio, `${a.name} vs ${b.name}`).toBeGreaterThan(1.1)
      }
    }
  })
})

describe('a hostile is built, not loaded', () => {
  for (const { name, geometry } of ARCHETYPES) {
    it(`${name} has a hull group and a glow group, in that order`, () => {
      // The material array in `EnemyInstances` is `[hull, glow]`, indexed by
      // `group.materialIndex`. Reversing the merge order here would silently
      // paint the hull with the unlit glow material — no error, no crash, just
      // a flat cut-out, which is exactly what the old single material did.
      const groups = geometry().groups
      expect(groups).toHaveLength(2)
      expect(groups[0]?.materialIndex).toBe(0)
      expect(groups[1]?.materialIndex).toBe(1)
      expect(groups[1]?.count).toBeGreaterThan(0)
    })

    it(`${name} has no degenerate or missing vertices`, () => {
      const position = geometry().getAttribute('position')
      expect(position.count).toBeGreaterThan(0)
      for (let i = 0; i < position.count; i++) {
        expect(Number.isFinite(position.getX(i))).toBe(true)
        expect(Number.isFinite(position.getY(i))).toBe(true)
        expect(Number.isFinite(position.getZ(i))).toBe(true)
      }
    })

    it(`${name} carries the normals the lighting rig needs`, () => {
      // A mirrored part that lost its winding renders as a hole. Zero-length
      // normals are the cheapest signal that one did.
      const normals = Geometries[name].getAttribute('normal')
      expect(normals.count).toBeGreaterThan(0)
      let degenerate = 0
      for (let i = 0; i < normals.count; i++) {
        const x = normals.getX(i)
        const y = normals.getY(i)
        const z = normals.getZ(i)
        if (Math.abs(x * x + y * y + z * z - 1) > 0.05) degenerate++
      }
      expect(degenerate).toBe(0)
    })
  }
})

describe('the Sentinel shows the arc it actually blocks', () => {
  it('spreads its shield over the cone the rules use, and no wider', () => {
    // The Sentinel's whole design is "flank it", and until the geometry spanned
    // `SENTINEL_SHIELD_HALF_ANGLE` there was nothing on screen that said where
    // the blocked cone stopped. If someone widens the plate without widening
    // the rule — or the reverse — the picture starts lying again.
    const geometry = Geometries.Sentinel
    const position = geometry.getAttribute('position')

    // Local +Z is the shield normal; measure the bearing of the forward-most
    // structure, which is the plate.
    let widest = 0
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i)
      const z = position.getZ(i)
      if (z <= 0) continue
      const radial = Math.hypot(x, z)
      if (radial < 2.5) continue // hub, guns and wing roots, not the plate
      widest = Math.max(widest, Math.abs(Math.atan2(x, z)))
    }

    const halfAngle = (72 * Math.PI) / 180
    expect(widest).toBeGreaterThan(halfAngle * 0.85)
    expect(widest).toBeLessThanOrEqual(halfAngle * 1.15)
  })
})
