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
 */
export class ResourceRegistry {
  private resources: Set<{ dispose(): void }> = new Set()
  private permanent: Set<{ dispose(): void }> = new Set()

  /**
   * Tracks a resource that belongs to the current mount.
   * @param resource Any object with a dispose() method
   * @returns The resource, for chaining
   */
  track<T extends { dispose(): void }>(resource: T): T {
    this.resources.add(resource)
    return resource
  }

  /**
   * Tracks a resource created once at module scope, which must survive a
   * remount because nothing will ever build it again.
   */
  trackPermanent<T extends { dispose(): void }>(resource: T): T {
    this.permanent.add(resource)
    return resource
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
}

// Global registry for the render layer
export const registry = new ResourceRegistry()
