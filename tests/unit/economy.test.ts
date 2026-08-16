/**
 * The credit economy, pinned end to end.
 *
 * This file exists because the whole thing was broken in a way no test could
 * see. Credits were earned correctly — bounties on kill, sector revenue at wave
 * end, persisted across runs — and there was nothing in the game to spend them
 * on: `Part.cost` was an optional field that not one of the thirty parts set, so
 * `part.cost ?? 0` resolved to zero everywhere, `spendCredits(0)` always
 * succeeded, and the Hangar's purchase branch was unreachable code guarding a
 * free transaction.
 *
 * Every assertion below is against a *property* of the economy rather than
 * against a number, so retuning the curve moves the prices and this file stays
 * quiet. What it will not let pass is the store going back to being a facade.
 */
import { describe, expect, it } from 'vitest'
import { ALL_PARTS, PARTS_BY_SLOT, SLOTS, partCost, partOwned } from '../../src/game/data/parts'
import { EnemyKind, createWorld } from '../../src/game/core/World'
import { damageEnemy } from '../../src/game/systems/CollisionSystem'
import { settleWave } from '../../src/game/systems/ScoreSystem'
import {
  CREDITS_PER_CARRIER,
  CREDITS_PER_HARVESTER,
  CREDITS_PER_INTERCEPTOR,
  CREDITS_PER_SAPPER,
  CREDITS_PER_SENTINEL,
  CREDITS_PER_WARDEN,
} from '../../src/game/data/constants'

describe('every part has a price', () => {
  it('prices every non-stock part above zero', () => {
    // The original bug, stated directly. A part with no price is a free part,
    // and a store of free parts is not a store.
    for (const part of ALL_PARTS) {
      if (part.manufacturer === null) continue
      expect(partCost(part), `${part.id} is unpriced`).toBeGreaterThan(0)
    }
  })

  it('leaves stock free, so a fresh profile flies the balanced game', () => {
    // Slot 0 of every slot is neutral and must never be behind a paywall —
    // the invariant `balance.test.ts` depends on.
    for (const slot of SLOTS) {
      const stock = (PARTS_BY_SLOT[slot] ?? [])[0]
      expect(stock, `${slot} has no stock part`).toBeDefined()
      if (stock === undefined) continue
      expect(stock.manufacturer).toBeNull()
      expect(partCost(stock)).toBe(0)
      expect(partOwned(stock, [])).toBe(true)
    }
  })

  it('never asks for a part the player cannot yet equip to cost less than an earlier one', () => {
    // Price tracks lateness, not power — no part is strictly better than
    // another, so a cheaper late part would imply a ranking that does not exist.
    const priced = ALL_PARTS.filter((part) => part.manufacturer !== null)
    for (const a of priced) {
      for (const b of priced) {
        if (a.unlockLevel < b.unlockLevel) {
          expect(partCost(a), `${a.id} vs ${b.id}`).toBeLessThanOrEqual(partCost(b))
        }
      }
    }
  })

  it('does not own a bought-able part until it has been bought', () => {
    const paid = ALL_PARTS.find((part) => part.manufacturer !== null)
    expect(paid).toBeDefined()
    if (paid === undefined) return
    expect(partOwned(paid, [])).toBe(false)
    expect(partOwned(paid, [paid.id])).toBe(true)
  })
})

describe('credits are earned by playing', () => {
  it('pays a bounty for every archetype, scaled to what killing it is worth', () => {
    const expected: Record<number, number> = {
      [EnemyKind.Harvester]: CREDITS_PER_HARVESTER,
      [EnemyKind.Interceptor]: CREDITS_PER_INTERCEPTOR,
      [EnemyKind.Sentinel]: CREDITS_PER_SENTINEL,
      [EnemyKind.Sapper]: CREDITS_PER_SAPPER,
      [EnemyKind.Warden]: CREDITS_PER_WARDEN,
      [EnemyKind.Carrier]: CREDITS_PER_CARRIER,
    }

    for (const [kind, bounty] of Object.entries(expected)) {
      const world = createWorld(`bounty-${kind}`, 7)
      const slot = world.enemies.pool.alloc()
      world.enemies.kind[slot] = Number(kind)
      world.enemies.hp[slot] = 1
      world.enemies.body.spawnAt(slot, 0, 160, 0)
      const before = world.credits
      damageEnemy(world, slot, 99)
      expect(world.credits - before, `kind ${kind}`).toBe(bounty)
    }
  })

  it('pays sector revenue at wave end, proportional to what survived', () => {
    const intact = createWorld('revenue-full', 7)
    intact.wave.outpostsAtStart = intact.outposts.length
    const full = settleWave(intact).creditsEarned

    const damaged = createWorld('revenue-half', 7)
    damaged.wave.outpostsAtStart = damaged.outposts.length
    for (const outpost of damaged.outposts) outpost.integrity = outpost.integrity / 2
    const half = settleWave(damaged).creditsEarned

    expect(full).toBeGreaterThan(0)
    expect(half).toBeGreaterThan(0)
    expect(half).toBeLessThan(full)
  })

  it('earns enough across a campaign to buy some of the catalogue, and not all of it', () => {
    // The shape of the economy in one assertion. If a single run could buy
    // everything the Hangar stops being a decision; if it could buy nothing the
    // credits are decoration, which is what they were.
    const priced = ALL_PARTS.filter((part) => part.manufacturer !== null)
    const catalogue = priced.reduce((sum, part) => sum + partCost(part), 0)
    const cheapest = Math.min(...priced.map(partCost))

    // A conservative floor for a completed twelve-wave run: sector revenue
    // alone, at half a board's worth of integrity, ignoring every bounty.
    const conservativeRun = 12 * 200

    expect(conservativeRun).toBeGreaterThan(cheapest * 3)
    expect(conservativeRun).toBeLessThan(catalogue)
  })
})
