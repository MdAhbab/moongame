/**
 * GPU resources, tracked by lifetime.
 *
 * Two lifetimes, and conflating them was a real bug. Most resources here belong
 * to a *mount*: a geometry built in a component's `useMemo` dies with that
 * component, and `disposeAll()` on Canvas unmount is exactly right for it.
 *
 * But `materials/registry.ts` builds its materials as **module singletons**, at
 * import time, once per page load. Sweeping those into `disposeAll()` meant that
 * any remount of the Canvas — React StrictMode's double-invoked effects in
 * development, or the ErrorBoundary's "Try again" in production — left the scene
 * drawing with disposed materials and rendering nothing at all. A black canvas,
 * no error, no console warning, and a menu sitting on top of it looking fine.
 *
 * So a resource that outlives a mount is registered as permanent, and
 * `disposeAll()` leaves it alone. The browser reclaims it with the context on
 * page teardown, which is the only point at which it is genuinely dead.
 *
 * A third case arrived later: the Canvas **stays mounted** across screens, so
 * `disposeAll()` never runs on a world swap or a quality-tier change. Those
 * rebuilds must `release()` the previous resource themselves, or the Set grows
 * for the rest of the session. `replace()` is that swap in one call.
 */
export type Disposable = { dispose(): void }

export class ResourceRegistry {
  private resources: Set<Disposable> = new Set()
  private permanent: Set<Disposable> = new Set()

  /**
   * Tracks a resource that belongs to the current mount.
   * @param resource Any object with a dispose() method
   * @returns The resource, for chaining
   */
  track<T extends Disposable>(resource: T): T {
    this.resources.add(resource)
    return resource
  }

  /**
   * Tracks a resource created once at module scope, which must survive a
   * remount because nothing will ever build it again.
   */
  trackPermanent<T extends Disposable>(resource: T): T {
    this.permanent.add(resource)
    return resource
  }

  /**
   * Disposes a per-mount resource and drops it from the Set.
   *
   * Permanent resources are ignored — disposing a singleton material is how the
   * black-canvas bug was born. Calling this twice is a no-op, so effect
   * cleanups and `disposeAll()` can both run without double-freeing.
   */
  release(resource: Disposable): void {
    if (this.permanent.has(resource)) return
    if (!this.resources.delete(resource)) return
    resource.dispose()
  }

  /**
   * Tracks `next` and, if `previous` is a different live resource, releases it.
   *
   * The Canvas stays mounted across Hangar world swaps and adaptive quality
   * drops, so a `useMemo` that only `track()`s the new geometry would leak the
   * old one until page teardown.
   */
  replace<T extends Disposable>(previous: T | null | undefined, next: T): T {
    if (previous !== undefined && previous !== null && previous !== next) {
      this.release(previous)
    }
    return this.track(next)
  }

  /**
   * Disposes every per-mount resource and clears them. Permanent resources are
   * deliberately left alone — see the note on the class.
   */
  disposeAll(): void {
    for (const resource of this.resources) {
      resource.dispose()
    }
    this.resources.clear()
  }

  /**
   * Number of tracked resources, both lifetimes. Exposed for the leak test,
   * which cares that the count is *stable*, not which set a resource is in.
   */
  get size(): number {
    return this.resources.size + this.permanent.size
  }

  /** Per-mount resources only — the set that must not grow across rebuilds. */
  get mountCount(): number {
    return this.resources.size
  }
}

// Global registry for the render layer
export const registry = new ResourceRegistry()
