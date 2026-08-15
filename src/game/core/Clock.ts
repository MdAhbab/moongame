/**
 * Wall-clock source for the *render* layer (gameplan §18.2, Rule 5).
 *
 * This is deliberately the only place in the project that reads a real clock,
 * and it lives outside `src/game/**`'s reach by contract: the simulation is fed
 * a delta, never a timestamp. Keeping the read in one named place is what makes
 * "nothing in the simulation reads wall-clock time" a checkable claim rather
 * than a hope.
 */
export class Clock {
  private last = 0
  private started = false

  /** Seconds since the previous call. The first call returns 0. */
  tick(now: number): number {
    if (!this.started) {
      this.started = true
      this.last = now
      return 0
    }
    const dt = (now - this.last) / 1000
    this.last = now
    return dt > 0 ? dt : 0
  }

  /** Re-bases the clock so a pause does not surface as one enormous delta. */
  resume(now: number): void {
    this.last = now
    this.started = true
  }

  reset(): void {
    this.started = false
    this.last = 0
  }
}

/**
 * Rolling frame-time average used in production to drive automatic quality-tier
 * reduction (§17.6), and shown in the dev overlay (§34.3).
 *
 * A ring buffer rather than a growing array so it allocates once.
 */
export class FrameTimeMonitor {
  private readonly samples: Float32Array
  private index = 0
  private filled = 0

  constructor(size = 120) {
    this.samples = new Float32Array(size)
  }

  push(frameMs: number): void {
    this.samples[this.index] = frameMs
    this.index = (this.index + 1) % this.samples.length
    if (this.filled < this.samples.length) this.filled++
  }

  get average(): number {
    if (this.filled === 0) return 0
    let sum = 0
    for (let i = 0; i < this.filled; i++) sum += this.samples[i] ?? 0
    return sum / this.filled
  }

  /**
   * True once the ring has a complete window.
   *
   * Callers gate on this before reading `p95`, which sorts a copy and therefore
   * allocates: sampling it every frame would put a fresh array per frame on the
   * heap purely to ask a question that only has a meaningful answer once every
   * `size` frames anyway.
   */
  get full(): boolean {
    return this.filled === this.samples.length
  }

  /** p95 frame time — the number §37.5 actually gates on, not the mean. */
  get p95(): number {
    if (this.filled === 0) return 0
    const copy = Array.from(this.samples.subarray(0, this.filled)).sort((a, b) => a - b)
    return copy[Math.min(copy.length - 1, Math.floor(copy.length * 0.95))] ?? 0
  }

  reset(): void {
    this.index = 0
    this.filled = 0
  }
}
