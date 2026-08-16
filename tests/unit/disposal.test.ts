/**
 * GPU resource registry — Rule 4.
 *
 * The Canvas stays mounted across screens, so `disposeAll()` is not enough:
 * a world swap or quality-tier change must release the *previous* resource
 * or the Set grows for the rest of the session.
 */
import { describe, expect, it } from 'vitest'

import { ResourceRegistry } from '@/render/disposal'

function disposable(label: string): { label: string; disposed: boolean; dispose(): void } {
  const resource = {
    label,
    disposed: false,
    dispose(): void {
      resource.disposed = true
    },
  }
  return resource
}

describe('ResourceRegistry', () => {
  it('tracks and disposeAll releases per-mount resources', () => {
    const registry = new ResourceRegistry()
    const a = disposable('a')
    registry.track(a)
    expect(registry.mountCount).toBe(1)
    registry.disposeAll()
    expect(a.disposed).toBe(true)
    expect(registry.mountCount).toBe(0)
  })

  it('leaves permanent resources alone on disposeAll', () => {
    const registry = new ResourceRegistry()
    const mat = disposable('permanent')
    registry.trackPermanent(mat)
    registry.disposeAll()
    expect(mat.disposed).toBe(false)
    expect(registry.size).toBe(1)
  })

  it('release is idempotent and does not dispose permanent resources', () => {
    const registry = new ResourceRegistry()
    const a = disposable('a')
    const perm = disposable('perm')
    registry.track(a)
    registry.trackPermanent(perm)
    registry.release(a)
    registry.release(a)
    registry.release(perm)
    expect(a.disposed).toBe(true)
    expect(perm.disposed).toBe(false)
    expect(registry.mountCount).toBe(0)
  })

  it('replace disposes the previous resource and keeps mountCount stable', () => {
    const registry = new ResourceRegistry()
    const first = disposable('first')
    const second = disposable('second')
    registry.track(first)
    registry.replace(first, second)
    expect(first.disposed).toBe(true)
    expect(second.disposed).toBe(false)
    expect(registry.mountCount).toBe(1)
    registry.replace(second, second)
    expect(second.disposed).toBe(false)
    expect(registry.mountCount).toBe(1)
  })
})
