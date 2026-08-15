/**
 * Fixed-capacity slot allocator with an O(1) free list and a dense active list
 * (gameplan §31.2, Rule 3).
 *
 * Every pool is allocated once at startup and never grows. Spawning takes the
 * next free slot; expiry returns it. Nothing allocates in the frame path, so the
 * garbage collector never runs mid-gameplay — the direct fix for V1's GC
 * hitching, which came from creating geometry and materials per bullet and per
 * particle and disposing none of it.
 *
 * The caps are gameplay decisions as much as performance ones: a bounded
 * population keeps difficulty *authored* rather than emergent, which is
 * precisely what V1 lost by spawning without limit (`game.js:1009`).
 *
 * Iteration goes through `dense`, so a step touches only live entities and
 * walks them contiguously rather than scanning the whole capacity.
 */
export class Pool {
  /** 1 where the slot holds a live entity. */
  readonly active: Uint8Array

  /** Live slot indices, packed into [0, count). Iterate this, not `capacity`. */
  readonly dense: Int32Array

  private readonly denseOf: Int32Array
  private readonly free: Int32Array
  private freeCount: number
  private liveCount = 0

  /** High-water mark of simultaneous live slots, for the perf overlay (§34.3). */
  peak = 0

  constructor(readonly capacity: number) {
    this.active = new Uint8Array(capacity)
    this.dense = new Int32Array(capacity)
    this.denseOf = new Int32Array(capacity).fill(-1)
    this.free = new Int32Array(capacity)
    for (let i = 0; i < capacity; i++) this.free[i] = capacity - 1 - i
    this.freeCount = capacity
  }

  /** Number of live entities. @hot-path */
  get count(): number {
    return this.liveCount
  }

  /** True when the pool is full. Spawns should queue rather than drop (§7.3). */
  get isFull(): boolean {
    return this.freeCount === 0
  }

  /**
   * Claims a slot, or returns -1 when full.
   *
   * -1 rather than throwing: a full pool is an expected condition (the 48-enemy
   * cap is a design constraint, not an error), and the caller decides whether to
   * queue, replace the oldest, or skip.
   * @hot-path
   */
  alloc(): number {
    if (this.freeCount === 0) return -1
    const slot = this.free[--this.freeCount] as number
    this.active[slot] = 1
    this.denseOf[slot] = this.liveCount
    this.dense[this.liveCount] = slot
    this.liveCount++
    if (this.liveCount > this.peak) this.peak = this.liveCount
    return slot
  }

  /**
   * Returns a slot to the free list. Safe to call on an already-free slot.
   *
   * Removal from the dense list is a swap with the last element, which is why
   * callers must not cache dense positions across a release.
   * @hot-path
   */
  release(slot: number): void {
    if (this.active[slot] !== 1) return
    this.active[slot] = 0

    const at = this.denseOf[slot] as number
    const last = this.liveCount - 1
    const moved = this.dense[last] as number
    this.dense[at] = moved
    this.denseOf[moved] = at
    this.denseOf[slot] = -1
    this.liveCount = last

    this.free[this.freeCount++] = slot
  }

  /** Frees every slot without reallocating. Used between runs. */
  reset(): void {
    this.active.fill(0)
    this.denseOf.fill(-1)
    for (let i = 0; i < this.capacity; i++) this.free[i] = this.capacity - 1 - i
    this.freeCount = this.capacity
    this.liveCount = 0
    this.peak = 0
  }
}
