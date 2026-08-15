/**
 * Gamepad rumble (gameplan §8.2, §13.4).
 *
 * The audio counterpart's structure, deliberately: world state and the event
 * queue in, effects out, reading and never mutating. It never calls
 * `events.clear()` — the simulation drains that queue once every consumer has
 * read it, and a layer that cleared it would starve the HUD and the particles.
 *
 * ## Rumble is a third channel, never the only one
 *
 * §13.4 gives every action three channels, and the standing rule from
 * `AudioDirector` applies here unchanged: a player with no gamepad, or with a
 * gamepad that has no actuator, loses texture and no information. Every event
 * below already has a visual channel — hull gauge, damage vignette, debris
 * burst, boost meter — so this reinforces rather than carries.
 *
 * ## Why the effects are short
 *
 * A continuous rumble stops being felt within a couple of seconds and starts
 * being felt as a broken controller. Everything here is a pulse under 300 ms,
 * and overlapping requests take the strongest rather than queueing, so a busy
 * fight is a series of distinct hits instead of one long buzz.
 */
import { GameEvent, type World } from '../game/core/World.ts'

/** One effect: how hard, on which motor, for how long. */
interface Pulse {
  readonly strong: number
  readonly weak: number
  readonly ms: number
}

/**
 * The table. Weak is the high-frequency motor — texture and detail; strong is
 * the low-frequency one — impact and weight.
 */
const PULSES: Partial<Record<number, Pulse>> = {
  [GameEvent.PlayerHit]: { strong: 0.55, weak: 0.3, ms: 180 },
  [GameEvent.PlayerDestroyed]: { strong: 1, weak: 0.7, ms: 280 },
  [GameEvent.TerrainImpact]: { strong: 0.7, weak: 0.45, ms: 200 },
  [GameEvent.BoostEngaged]: { strong: 0.2, weak: 0.45, ms: 140 },
  [GameEvent.MissileFired]: { strong: 0.3, weak: 0.25, ms: 90 },
  [GameEvent.LockAcquired]: { strong: 0, weak: 0.35, ms: 60 },
  [GameEvent.Resupply]: { strong: 0.15, weak: 0.3, ms: 120 },
  [GameEvent.OutpostLost]: { strong: 0.8, weak: 0.2, ms: 260 },
}

/**
 * The minimum gap between pulses, ms.
 *
 * Without it, a wave of Interceptor fire produces one continuous vibration that
 * conveys nothing. Hits still register visually and audibly; this only limits
 * how often the *third* channel fires.
 */
const MIN_INTERVAL_MS = 90

export class HapticsDirector {
  private lastPulseAt = 0
  private enabled = true

  /** Turned off from Settings, and by `reducedMotion` for players who need it. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  /**
   * Reads this frame's events and plays at most one pulse.
   *
   * Allocation-free: indexed `for`, no closures, no literals. It runs every
   * frame alongside the audio director.
   * @hot-path
   */
  update(world: Readonly<World>): void {
    if (!this.enabled) return

    const now = performance.now()
    if (now - this.lastPulseAt < MIN_INTERVAL_MS) return

    // The strongest event this frame wins, rather than the first — being shot
    // and destroyed in the same frame should feel like being destroyed.
    let best: Pulse | undefined
    const events = world.events
    for (let i = 0; i < events.count; i++) {
      const pulse = PULSES[events.type[i] as number]
      if (pulse === undefined) continue
      if (best === undefined || pulse.strong > best.strong) best = pulse
    }
    if (best === undefined) return

    if (play(best)) this.lastPulseAt = now
  }
}

/**
 * Fires one pulse on the first gamepad that can take it.
 *
 * Two APIs exist and neither is universal: `vibrationActuator.playEffect` is the
 * modern one, `hapticActuators[0].pulse` the older Firefox path. Both are tried
 * and both failing is a no-op, because a controller without motors must not be
 * a controller that throws.
 */
function play(pulse: Pulse): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return false

  const pads = navigator.getGamepads()
  for (let i = 0; i < pads.length; i++) {
    const pad = pads[i]
    if (pad === null) continue

    const modern = (pad as Gamepad & {
      vibrationActuator?: { playEffect?: (type: string, options: unknown) => Promise<unknown> }
    }).vibrationActuator
    if (modern?.playEffect !== undefined) {
      // A rejected promise here is routine — the page can lose focus mid-effect
      // — and must never surface as an unhandled rejection.
      void modern.playEffect('dual-rumble', {
        duration: pulse.ms,
        strongMagnitude: pulse.strong,
        weakMagnitude: pulse.weak,
      }).catch(() => undefined)
      return true
    }

    const legacy = (pad as Gamepad & {
      hapticActuators?: { pulse?: (value: number, duration: number) => Promise<unknown> }[]
    }).hapticActuators?.[0]
    if (legacy?.pulse !== undefined) {
      void legacy.pulse(Math.max(pulse.strong, pulse.weak), pulse.ms).catch(() => undefined)
      return true
    }
  }
  return false
}
