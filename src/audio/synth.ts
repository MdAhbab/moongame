/**
 * Runtime synthesis — every sound effect in the game, from oscillators, noise
 * and filters (gameplan §27.1). **No audio files. Zero bytes of samples.**
 *
 * This is not asceticism. §33.1's zero-asset pillar is the reason the bundle is
 * tiny, but the reason synthesis is *better* here than sampling is that sound
 * can then track continuous game state: the engine follows velocity, the heat
 * alarm follows heat, and the lock tone's interval follows lock progress. A
 * sample can be pitched and faded; it cannot be a readout.
 *
 * ── The allocation problem, and how it is solved ─────────────────────────
 *
 * `AudioBufferSourceNode` and `OscillatorNode` are **single-use by
 * specification**: once stopped they can never be restarted. The obvious
 * implementation — build a node graph per shot — therefore allocates on every
 * trigger, which is exactly what Rule 3 forbids in the frame path.
 *
 * So nothing is ever stopped. There is **one** noise source for the whole game,
 * started at unlock and looping forever, fanned out to every voice; and one
 * oscillator per voice, likewise never stopped, retuned on each trigger. A
 * "voice" is a fixed chain of five nodes, allocated at unlock and reused
 * forever. Triggering a sound is only `AudioParam` automation, so the whole SFX
 * path allocates nothing after startup — including the noise buffer, which is
 * filled once and shared.
 *
 * ── Layout of a voice ────────────────────────────────────────────────────
 *
 *     noise ─▶ filter ─▶ noiseGain ─┐
 *                                    ├─▶ [panner] ─▶ bus
 *     osc ─▶ oscGain ───────────────┘
 *
 * Two layers with independent envelopes, because most of §27.1's table is two
 * layers: a body and a transient, or noise and a sub. The panner is present
 * only in the spatial pool (§27.3).
 */
import { Random } from '../game/core/Random.ts'
import { V_BOOST } from '../game/data/constants.ts'
import { type Vec3 } from '../game/math/vec3.ts'
import { clamp } from '../game/physics/springs.ts'
import { type TangentFrame } from '../game/physics/tangentFrame.ts'
import type { AudioGraph } from './AudioEngine.ts'
import { createPanner, orientListener, positionPanner } from './spatial.ts'
import {
  BOOST_ENGAGE,
  BOMB_DROP,
  CHIME,
  CONFIRM_GAP_S,
  DRAIN_ALERT,
  ENGINE_BASE_HZ,
  ENGINE_BOOST_CUTOFF_MULT,
  ENGINE_BOOST_DETUNE_CENTS,
  ENGINE_BOOST_LEVEL_MULT,
  ENGINE_CUT,
  ENGINE_CUTOFF_MAX_HZ,
  ENGINE_CUTOFF_MIN_HZ,
  ENGINE_EPSILON,
  ENGINE_FILTER_Q,
  ENGINE_FULL_LEVEL,
  ENGINE_IDLE_LEVEL,
  ENGINE_NOISE_LEVEL,
  ENGINE_OSC_LEVEL,
  ENGINE_SMOOTH_S,
  ENGINE_TOP_HZ,
  EPSILON_GAIN,
  EXPLOSION,
  FLARE_LAUNCH,
  FLAT_VOICES,
  HEAT_AM_MAX_HZ,
  HEAT_AM_MIN_HZ,
  HEAT_CARRIER_HZ,
  HEAT_EPSILON,
  HEAT_LEVEL_MAX,
  HEAT_LOCKOUT,
  HEAT_LOCKOUT_GAP_S,
  HEAT_LOCKOUT_SECOND_RATIO,
  HEAT_SMOOTH_S,
  HEAT_WARN_THRESHOLD,
  IMPACT,
  LOCK_BASE_HZ,
  LOCK_CONFIRM,
  LOCK_EPSILON,
  LOCK_IDLE,
  LOCK_INTERVAL_SEMITONES,
  LOCK_LEVEL_MAX,
  LOCK_LEVEL_MIN,
  LOCK_RELEASE_S,
  LOCK_SMOOTH_S,
  LOW_CHIME,
  MISSILE_LAUNCH,
  NOISE_BUFFER_S,
  NOISE_SEED,
  OUTPOST_LOST_HIGH,
  OUTPOST_LOST_LOW,
  OUTPOST_POWER_DOWN,
  OUTPOST_SAVED_GAP_S,
  PLAYER_DESTROYED,
  PLAYER_HIT,
  PULSE_CANNON,
  RATIO_FIFTH_BELOW,
  RATIO_MAJOR_THIRD,
  RATIO_OCTAVE,
  RATIO_PERFECT_FIFTH,
  RATIO_PERFECT_FOURTH,
  RESPAWN,
  RESUPPLY_GAP_S,
  SPATIAL_VOICES,
  STRAFE_THRUSTER,
  TERRAIN_SCRAPE,
  UI_BACK,
  UI_CLICK,
  UI_CONFIRM,
  UI_HOVER,
  UI_VOICES,
  VOICE_MUTE_S,
  WAVE_CLEARED_GAP_S,
  type VoiceRecipe,
} from './audioConstants.ts'

/* ------------------------------------------------------------------ */
/* Envelopes and sweeps                                                */
/* ------------------------------------------------------------------ */

/**
 * Attack–decay envelope on a reused gain.
 *
 * The current value is read *before* `cancelScheduledValues`, because cancel
 * does not hold the running value — it reverts to the last explicitly set one,
 * which on a voice mid-decay is a step, and a step is a click. Anchoring at the
 * value we read makes stealing a still-sounding voice inaudible.
 *
 * @hot-path
 */
function envelope(param: AudioParam, now: number, start: number, peak: number, attack: number, decay: number): void {
  const held = param.value
  param.cancelScheduledValues(now)
  param.setValueAtTime(held, now)
  param.linearRampToValueAtTime(0, start)
  param.linearRampToValueAtTime(peak, start + attack)
  // Exponential, per §27.1: linear decays sound synthetic because physical
  // energy decays exponentially. It cannot reach zero, so it lands on −80 dB
  // and is squared off there.
  param.exponentialRampToValueAtTime(EPSILON_GAIN, start + attack + decay)
  param.setValueAtTime(0, start + attack + decay)
}

/** Ramps a gain to silence over `VOICE_MUTE_S`, for layers a recipe does not use. @hot-path */
function silence(param: AudioParam, now: number): void {
  const held = param.value
  param.cancelScheduledValues(now)
  param.setValueAtTime(held, now)
  param.linearRampToValueAtTime(0, now + VOICE_MUTE_S)
}

/**
 * Frequency sweep, exponential because pitch is perceived logarithmically —
 * a linear ramp from 2200 Hz to 220 Hz spends most of its time in the top
 * octave and then falls off a cliff.
 *
 * The `to > 0` guard is not defensive noise: `exponentialRampToValueAtTime`
 * throws `RangeError` on a zero target, and an exception raised here would
 * propagate out of the frame path and take the render loop with it.
 *
 * @hot-path
 */
function sweep(param: AudioParam, now: number, start: number, from: number, to: number, duration: number): void {
  param.cancelScheduledValues(now)
  param.setValueAtTime(from, start)
  if (duration > 0 && to > 0 && to !== from) {
    param.exponentialRampToValueAtTime(to, start + duration)
  }
}

/* ------------------------------------------------------------------ */
/* Voices and pools                                                    */
/* ------------------------------------------------------------------ */

interface Voice {
  readonly osc: OscillatorNode
  readonly oscGain: GainNode
  readonly filter: BiquadFilterNode
  readonly noiseGain: GainNode
  /** Present only in the spatial pool (§27.3). */
  readonly panner: PannerNode | null
}

/** Startup only. */
function createVoice(context: AudioContext, noise: AudioNode, destination: AudioNode, spatialise: boolean): Voice {
  const panner = spatialise ? createPanner(context) : null
  const out: AudioNode = panner ?? destination
  if (panner !== null) panner.connect(destination)

  const filter = context.createBiquadFilter()
  const noiseGain = context.createGain()
  noiseGain.gain.value = 0
  noise.connect(filter)
  filter.connect(noiseGain)
  noiseGain.connect(out)

  const osc = context.createOscillator()
  const oscGain = context.createGain()
  oscGain.gain.value = 0
  osc.connect(oscGain)
  oscGain.connect(out)
  osc.start()

  return { osc, oscGain, filter, noiseGain, panner }
}

/**
 * A fixed set of reusable voices.
 *
 * Allocation happens entirely in the constructor. `acquire` prefers a voice
 * that has finished, and otherwise steals the one closest to finishing — the
 * quietest thing currently sounding, so the theft is the least audible one
 * available. The scan starts at a rotating cursor so consecutive shots spread
 * across the pool instead of hammering slot 0, which keeps a resonant filter
 * from being re-triggered while it is still ringing.
 */
class VoicePool {
  private readonly voices: Voice[] = []
  /** Context time at which each voice's envelope ends. */
  private readonly freeAt: Float64Array
  private cursor = 0

  constructor(context: AudioContext, noise: AudioNode, destination: AudioNode, spatialise: boolean, count: number) {
    this.freeAt = new Float64Array(count)
    for (let i = 0; i < count; i++) {
      this.voices.push(createVoice(context, noise, destination, spatialise))
    }
  }

  /** @hot-path */
  acquire(now: number, until: number): Voice {
    const n = this.voices.length
    let best = this.cursor
    let earliest = Infinity
    for (let k = 0; k < n; k++) {
      const i = (this.cursor + k) % n
      // Fixed-length array, filled in the constructor: the index is always in
      // range, so this is asserted rather than branched on (the World.ts
      // convention for the same situation in the hot path).
      const readyAt = this.freeAt[i] as number
      if (readyAt <= now) {
        best = i
        break
      }
      if (readyAt < earliest) {
        earliest = readyAt
        best = i
      }
    }
    this.cursor = (best + 1) % n
    this.freeAt[best] = until
    return this.voices[best] as Voice
  }

  /** Cuts everything sounding. Run transitions only. */
  silenceAll(now: number): void {
    for (let i = 0; i < this.voices.length; i++) {
      const voice = this.voices[i] as Voice
      silence(voice.oscGain.gain, now)
      silence(voice.noiseGain.gain, now)
      this.freeAt[i] = 0
    }
  }
}

/* ------------------------------------------------------------------ */
/* The synth                                                           */
/* ------------------------------------------------------------------ */

/**
 * Every sound in §27.1, plus the persistent voices that track continuous
 * state. Constructed by `AudioEngine` at unlock; there is no way to build one
 * without a live `AudioContext`, which is what makes "safe before unlock" a
 * type-level property rather than a runtime check in every method.
 */
export class Synth {
  private readonly context: AudioContext
  private readonly spatialPool: VoicePool
  private readonly flatPool: VoicePool
  private readonly uiPool: VoicePool

  /* The persistent engine voice (§27.1) — saw + noise through a tracking lowpass. */
  private readonly engineOsc1: OscillatorNode
  private readonly engineOsc2: OscillatorNode
  private readonly engineOsc3: OscillatorNode
  private readonly engineSub: OscillatorNode
  private readonly engineSubGain: GainNode
  private readonly engineFilter: BiquadFilterNode
  private readonly engineLevel: GainNode
  private engineSpeedNorm = -1
  private engineBoosting = false

  /* The lock tone (§27.1) — two oscillators converging in pitch. */
  private readonly lockLower: OscillatorNode
  private readonly lockUpper: OscillatorNode
  private readonly lockLevel: GainNode
  private lockProgress = LOCK_IDLE

  /* The heat warning (§27.1) — AM square, modulation rate rising with heat. */
  private readonly heatLfo: OscillatorNode
  private readonly heatLevel: GainNode
  private heatValue = -1

  constructor(graph: AudioGraph) {
    const context = graph.context
    this.context = context

    /*
     * One noise buffer and one source node for the entire game.
     *
     * A source cannot be restarted once stopped, so the only way to have
     * zero per-shot allocation is to never stop it: this loops for the
     * lifetime of the context and fans out to all 26 voices plus the engine.
     * The buffer is seeded, so noise is bit-identical between runs and a bug
     * reproduced from a seed (§10.4) sounds the same too.
     */
    const noiseBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * NOISE_BUFFER_S), context.sampleRate)
    const samples = noiseBuffer.getChannelData(0)
    const rng = new Random(NOISE_SEED)
    for (let i = 0; i < samples.length; i++) samples[i] = rng.signed()

    const noise = context.createBufferSource()
    noise.buffer = noiseBuffer
    noise.loop = true
    noise.start()

    this.spatialPool = new VoicePool(context, noise, graph.spatialBus, true, SPATIAL_VOICES)
    this.flatPool = new VoicePool(context, noise, graph.sfxBus, false, FLAT_VOICES)
    this.uiPool = new VoicePool(context, noise, graph.uiBus, false, UI_VOICES)

    /* Engine. */
    this.engineLevel = context.createGain()
    this.engineLevel.gain.value = 0
    this.engineLevel.connect(graph.sfxBus)

    this.engineFilter = context.createBiquadFilter()
    this.engineFilter.type = 'lowpass'
    this.engineFilter.frequency.value = ENGINE_CUTOFF_MIN_HZ
    this.engineFilter.Q.value = ENGINE_FILTER_Q
    this.engineFilter.connect(this.engineLevel)

    const engineOscGain = context.createGain()
    engineOscGain.gain.value = ENGINE_OSC_LEVEL / 3
    engineOscGain.connect(this.engineFilter)

    this.engineOsc1 = context.createOscillator()
    this.engineOsc1.type = 'sawtooth'
    this.engineOsc1.frequency.value = ENGINE_BASE_HZ
    this.engineOsc1.connect(engineOscGain)
    this.engineOsc1.start()

    this.engineOsc2 = context.createOscillator()
    this.engineOsc2.type = 'sawtooth'
    this.engineOsc2.frequency.value = ENGINE_BASE_HZ
    this.engineOsc2.connect(engineOscGain)
    this.engineOsc2.start()

    this.engineOsc3 = context.createOscillator()
    this.engineOsc3.type = 'sawtooth'
    this.engineOsc3.frequency.value = ENGINE_BASE_HZ
    this.engineOsc3.connect(engineOscGain)
    this.engineOsc3.start()

    const lfo1 = context.createOscillator()
    lfo1.frequency.value = 0.5
    const lfoGain1 = context.createGain()
    lfoGain1.gain.value = 10
    lfo1.connect(lfoGain1)
    lfoGain1.connect(this.engineOsc2.detune)
    lfo1.start()

    const lfo2 = context.createOscillator()
    lfo2.frequency.value = 0.7
    const lfoGain2 = context.createGain()
    lfoGain2.gain.value = -15
    lfo2.connect(lfoGain2)
    lfoGain2.connect(this.engineOsc3.detune)
    lfo2.start()

    this.engineSub = context.createOscillator()
    this.engineSub.type = 'sine'
    this.engineSub.frequency.value = ENGINE_BASE_HZ / 2
    this.engineSubGain = context.createGain()
    this.engineSubGain.gain.value = 0
    this.engineSub.connect(this.engineSubGain)
    this.engineSubGain.connect(this.engineFilter)
    this.engineSub.start()

    const engineNoiseGain = context.createGain()
    engineNoiseGain.gain.value = ENGINE_NOISE_LEVEL
    noise.connect(engineNoiseGain)
    engineNoiseGain.connect(this.engineFilter)

    /* Lock tone. Sines, because beating is only clean between pure tones. */
    this.lockLevel = context.createGain()
    this.lockLevel.gain.value = 0
    this.lockLevel.connect(graph.sfxBus)

    this.lockLower = context.createOscillator()
    this.lockLower.type = 'sine'
    this.lockLower.frequency.value = LOCK_BASE_HZ
    this.lockLower.connect(this.lockLevel)
    this.lockLower.start()

    this.lockUpper = context.createOscillator()
    this.lockUpper.type = 'sine'
    this.lockUpper.frequency.value = LOCK_BASE_HZ * semitoneRatio(LOCK_INTERVAL_SEMITONES)
    this.lockUpper.connect(this.lockLevel)
    this.lockUpper.start()

    /*
     * Heat warning. The LFO drives the modulation gain around a midpoint of
     * 0.5 with a depth of 0.5, which is 100% amplitude modulation: the carrier
     * is fully interrupted on every cycle, so the alarm reads as a pulse train
     * rather than a wobble.
     */
    this.heatLevel = context.createGain()
    this.heatLevel.gain.value = 0
    this.heatLevel.connect(graph.sfxBus)

    const heatAm = context.createGain()
    heatAm.gain.value = 0.5
    heatAm.connect(this.heatLevel)

    const heatCarrier = context.createOscillator()
    heatCarrier.type = 'square'
    heatCarrier.frequency.value = HEAT_CARRIER_HZ
    heatCarrier.connect(heatAm)
    heatCarrier.start()

    this.heatLfo = context.createOscillator()
    this.heatLfo.type = 'sine'
    this.heatLfo.frequency.value = HEAT_AM_MIN_HZ
    const heatDepth = context.createGain()
    heatDepth.gain.value = 0.5
    this.heatLfo.connect(heatDepth)
    heatDepth.connect(heatAm.gain)
    this.heatLfo.start()
  }

  /* ---------------------------------------------------------------- */
  /* Continuous voices                                                 */
  /* ---------------------------------------------------------------- */

  /**
   * Puts the listener on the craft, oriented by its tangent frame (§27.3).
   *
   * Lives here rather than on the director because the `AudioContext` does, and
   * the director should hold no audio-graph handles at all — its whole job is
   * to translate world state into these calls.
   *
   * @hot-path
   */
  setListener(position: Readonly<Vec3>, frame: Readonly<TangentFrame>): void {
    orientListener(this.context.listener, position, frame, this.context.currentTime)
  }

  /**
   * The engine, tracking velocity continuously (§27.1).
   *
   * Pitch rises linearly with speed, but the **cutoff rises geometrically** —
   * `min·(max/min)^t` — because the ear hears frequency ratios, not
   * differences. A linear cutoff sweep spends nearly all of its travel in the
   * top two octaves and the low half of the speed range sounds identical.
   * The filter, not the pitch, is what actually carries the speed cue.
   *
   * Boost is a different regime rather than a louder one: the cutoff jumps, the
   * oscillator detunes, and the level lifts — so §7.4's boost is audible as a
   * change in character even at a speed the craft could reach on cruise thrust.
   *
   * @hot-path
   * @param speed Craft speed in u/s.
   * @param boosting §7.4 — boost active this frame.
   */
  setEngineParams(speed: number, boosting: boolean): void {
    const t = clamp(speed / V_BOOST, 0, 1)
    if (Math.abs(t - this.engineSpeedNorm) < ENGINE_EPSILON && boosting === this.engineBoosting) return
    this.engineSpeedNorm = t
    this.engineBoosting = boosting

    const now = this.context.currentTime
    const boostCutoff = boosting ? ENGINE_BOOST_CUTOFF_MULT : 1
    const boostLevel = boosting ? ENGINE_BOOST_LEVEL_MULT : 1

    const targetHz = ENGINE_BASE_HZ + (ENGINE_TOP_HZ - ENGINE_BASE_HZ) * t
    this.engineOsc1.frequency.setTargetAtTime(targetHz, now, ENGINE_SMOOTH_S)
    this.engineOsc2.frequency.setTargetAtTime(targetHz, now, ENGINE_SMOOTH_S)
    this.engineOsc3.frequency.setTargetAtTime(targetHz, now, ENGINE_SMOOTH_S)
    this.engineSub.frequency.setTargetAtTime(targetHz / 2, now, ENGINE_SMOOTH_S)

    const detune = boosting ? ENGINE_BOOST_DETUNE_CENTS : 0
    this.engineOsc1.detune.setTargetAtTime(detune, now, ENGINE_SMOOTH_S)
    this.engineOsc2.detune.setTargetAtTime(detune, now, ENGINE_SMOOTH_S)
    this.engineOsc3.detune.setTargetAtTime(detune, now, ENGINE_SMOOTH_S)

    this.engineFilter.frequency.setTargetAtTime(
      ENGINE_CUTOFF_MIN_HZ * Math.pow(ENGINE_CUTOFF_MAX_HZ / ENGINE_CUTOFF_MIN_HZ, t) * boostCutoff,
      now,
      ENGINE_SMOOTH_S,
    )
    this.engineLevel.gain.setTargetAtTime(
      (ENGINE_IDLE_LEVEL + (ENGINE_FULL_LEVEL - ENGINE_IDLE_LEVEL) * t) * boostLevel,
      now,
      ENGINE_SMOOTH_S,
    )
    this.engineSubGain.gain.setTargetAtTime(boosting ? (ENGINE_OSC_LEVEL / 2) : 0, now, ENGINE_SMOOTH_S)
  }

  /**
   * The lock tone — **the pitch interval is the progress bar** (§27.1).
   *
   * Two sines: the lower is fixed at `LOCK_BASE_HZ`, the upper starts a perfect
   * fifth above and slides down to unison as the lock closes, so the interval
   * `s = 7·(1 − p)` semitones *is* the readout. What makes this better than a
   * rising pitch or a quickening beep is that the ear resolves it in three
   * different ways over the sweep, without the player learning anything:
   *
   *   p = 0.0   s = 7.00   Δf = 328 Hz   two plainly separate pitches, a fifth
   *   p = 0.5   s = 3.50   Δf = 148 Hz   a narrowing, clearly-closing interval
   *   p = 0.8   s = 1.40   Δf =  56 Hz   maximum roughness — audibly *tense*
   *   p = 0.9   s = 0.70   Δf =  27 Hz   the roughness resolves into beating
   *   p = 0.95  s = 0.35   Δf =  14 Hz   a countable pulse
   *   p = 1.0   s = 0.00   Δf =   0 Hz   dead still: locked
   *
   * The final phase is the important one. Δf = f₀·(2^(s/12) − 1) is literally
   * the beat rate in beats per second, so the last third of the lock is a
   * physical countdown that stops at zero — and it is *more* precise than the
   * reticle, because peripheral vision resolves a converging reticle far worse
   * than hearing resolves a slowing beat. That is §27.1's actual claim: the
   * player keeps their eyes on flying and still knows exactly when to fire.
   *
   * @hot-path
   * @param progress Lock acquisition in [0, 1], or `LOCK_IDLE` when no lock is in flight.
   */
  setLockProgress(progress: number): void {
    if (Math.abs(progress - this.lockProgress) < LOCK_EPSILON) return
    this.lockProgress = progress
    const now = this.context.currentTime

    if (progress < 0) {
      this.lockLevel.gain.setTargetAtTime(0, now, LOCK_RELEASE_S)
      return
    }

    const p = clamp(progress, 0, 1)
    const separation = LOCK_INTERVAL_SEMITONES * (1 - p)
    this.lockUpper.frequency.setTargetAtTime(LOCK_BASE_HZ * semitoneRatio(separation), now, LOCK_SMOOTH_S)
    this.lockLevel.gain.setTargetAtTime(LOCK_LEVEL_MIN + (LOCK_LEVEL_MAX - LOCK_LEVEL_MIN) * p, now, LOCK_SMOOTH_S)
  }

  /**
   * Heat warning — AM square whose modulation rate rises with heat (§27.1).
   *
   * Silent below `HEAT_WARN_THRESHOLD`: the heat bar is on screen from zero
   * (§14.2), so the tone is reserved for the point at which heat becomes a
   * decision. Rate, not level, carries the urgency, which is what lets it sit
   * under gunfire without being loud.
   *
   * @hot-path
   * @param heat Heat as a fraction of `HEAT_MAX`, in [0, 1].
   */
  setHeatLevel(heat: number): void {
    if (Math.abs(heat - this.heatValue) < HEAT_EPSILON) return
    this.heatValue = heat
    const now = this.context.currentTime

    const urgency = clamp((heat - HEAT_WARN_THRESHOLD) / (1 - HEAT_WARN_THRESHOLD), 0, 1)
    this.heatLfo.frequency.setTargetAtTime(
      HEAT_AM_MIN_HZ + (HEAT_AM_MAX_HZ - HEAT_AM_MIN_HZ) * urgency,
      now,
      HEAT_SMOOTH_S,
    )
    this.heatLevel.gain.setTargetAtTime(HEAT_LEVEL_MAX * urgency, now, HEAT_SMOOTH_S)
  }

  /* ---------------------------------------------------------------- */
  /* One-shots (§27.1)                                                 */
  /* ---------------------------------------------------------------- */

  /**
   * §7.4 — the Pulse Cannon.
   *
   * Takes a position because the director cannot tell the player's shots from
   * an enemy's: both are `GameEvent.ShotFired`. The near-field test resolves it
   * for free — the player's own cannon fires from the listener and plays flat,
   * and anything further away arrives with a bearing.
   *
   * @hot-path
   */
  pulseCannon(x: number, y: number, z: number, spatialise: boolean, doppler = 1): void {
    this.emit(PULSE_CANNON, this.pool(spatialise), x, y, z, 0, doppler, 1)
  }

  /** §13.4 — a hit registered on something. @hot-path */
  impact(x: number, y: number, z: number, spatialise: boolean, doppler = 1): void {
    this.emit(IMPACT, this.pool(spatialise), x, y, z, 0, doppler, 1)
  }

  /** §13.4 — a kill. `level` scales the whole voice with the target's weight. @hot-path */
  explosion(x: number, y: number, z: number, spatialise: boolean, level: number, doppler = 1): void {
    this.emit(EXPLOSION, this.pool(spatialise), x, y, z, 0, doppler, level)
  }

  /** §7.6 — the player's craft destroyed. Flat: it happens at the listener. @hot-path */
  playerDestroyed(): void {
    this.emit(PLAYER_DESTROYED, this.flatPool, 0, 0, 0, 0, 1, 1)
  }

  /** §13.4 — "Impact + hull stress". `level` scales with damage taken. @hot-path */
  playerHit(level: number): void {
    this.emit(PLAYER_HIT, this.flatPool, 0, 0, 0, 0, 1, level)
  }

  /** §22.6 — something grazing the surface, usually the craft. @hot-path */
  terrainScrape(x: number, y: number, z: number, spatialise: boolean, doppler = 1): void {
    this.emit(TERRAIN_SCRAPE, this.pool(spatialise), x, y, z, 0, doppler, 1)
  }

  /** §7.4 — Lock Missile away. @hot-path */
  missileLaunch(): void {
    this.emit(MISSILE_LAUNCH, this.flatPool, 0, 0, 0, 0, 1, 1)
  }

  /** §7.4 — boost engaged. @hot-path */
  boostEngage(): void {
    this.emit(BOOST_ENGAGE, this.flatPool, 0, 0, 0, 0, 1, 1)
  }

  /** §13.4 — "Rising alert": a Harvester has landed and the drain clock is running. @hot-path */
  drainStarted(x: number, y: number, z: number, spatialise: boolean, doppler = 1): void {
    this.emit(DRAIN_ALERT, this.pool(spatialise), x, y, z, 0, doppler, 1)
  }

  /**
   * §27.1 — "Descending sine pair with a long release", in two halves.
   *
   * The pair is flat because it is the alert and must always be heard, even
   * from the far side of the sphere; the power-down under it is spatialised, so
   * the loss also arrives with a direction (§27.3). Two channels for one event,
   * which is the same redundancy rule §13.4 applies to everything else.
   *
   * @hot-path
   */
  outpostLost(x: number, y: number, z: number, spatialise: boolean, doppler = 1): void {
    this.emit(OUTPOST_LOST_HIGH, this.flatPool, 0, 0, 0, 0, 1, 1)
    this.emit(OUTPOST_LOST_LOW, this.flatPool, 0, 0, 0, 0, 1, 1)
    if (spatialise) this.emit(OUTPOST_POWER_DOWN, this.spatialPool, x, y, z, 0, doppler, 1)
  }

  strafeThruster(x: number, y: number, z: number): void {
    this.emit(STRAFE_THRUSTER, this.spatialPool, x, y, z, 0, 1, 1)
  }

  /** Heavy orbital bomb bay launch. */
  bombDrop(): void {
    this.emit(BOMB_DROP, this.flatPool, 0, 0, 0, 0, 1, 1)
  }

  /** Engine cut / drift mode engage sound. */
  engineCut(): void {
    this.emit(ENGINE_CUT, this.flatPool, 0, 0, 0, 0, 1, 1)
  }

  /** Countermeasure flares pyrotechnic pop. */
  flareLaunch(): void {
    this.emit(FLARE_LAUNCH, this.flatPool, 0, 0, 0, 0, 1, 1)
  }

  /** §7.2 — an outpost held to the end of the wave. A struck fifth. @hot-path */
  outpostSaved(): void {
    this.emit(CHIME, this.flatPool, 0, 0, 0, 0, 1, 1)
    this.emit(CHIME, this.flatPool, 0, 0, 0, OUTPOST_SAVED_GAP_S, RATIO_PERFECT_FIFTH, 1)
  }

  /** §13.4 — "Two-tone confirm" the instant lock completes. @hot-path */
  lockConfirm(): void {
    this.emit(LOCK_CONFIRM, this.flatPool, 0, 0, 0, 0, 1, 1)
    this.emit(LOCK_CONFIRM, this.flatPool, 0, 0, 0, CONFIRM_GAP_S, RATIO_PERFECT_FOURTH, 1)
  }

  /**
   * An Interceptor committing to an attack run.
   *
   * Two rising blips at the spot the threat is coming *from*, so the warning
   * carries a bearing — the player can turn toward it without looking away from
   * what they were doing. Rising, because the heat-lockout alarm falls and two
   * alarms that sound alike are one alarm nobody can act on.
   * @hot-path
   */
  attackRun(x: number, y: number, z: number, far: boolean): void {
    this.emit(HEAT_LOCKOUT, far ? this.spatialPool : this.flatPool, x, y, z, 0, 1, 1)
    this.emit(HEAT_LOCKOUT, far ? this.spatialPool : this.flatPool, x, y, z, HEAT_LOCKOUT_GAP_S, RATIO_PERFECT_FIFTH, 1)
  }

  /**
   * A craft subsystem has failed. Low, short, and *not* an alarm — the hull hit
   * that caused it already sounded, and doubling it would only mask the cue.
   * @hot-path
   */
  systemFault(): void {
    this.emit(LOW_CHIME, this.flatPool, 0, 0, 0, 0, RATIO_FIFTH_BELOW, 0.8)
  }

  /**
   * A lock that broke. The confirm chirp inverted, so the ear reads it as the
   * opposite of the thing it just heard rather than as a new event to decode.
   * @hot-path
   */
  lockLost(): void {
    this.emit(LOCK_CONFIRM, this.flatPool, 0, 0, 0, 0, RATIO_PERFECT_FOURTH, 0.7)
    this.emit(LOCK_CONFIRM, this.flatPool, 0, 0, 0, CONFIRM_GAP_S, 1, 0.7)
  }

  /**
   * Weapon mode changed. A single dry tick on the UI bus, not the combat bus:
   * this is the player operating the ship, not the ship doing something to the
   * world, and it must never be loud enough to be mistaken for a shot.
   * @hot-path
   */
  weaponSwitch(toMissiles: boolean): void {
    this.emit(UI_CLICK, this.uiPool, 0, 0, 0, 0, toMissiles ? RATIO_PERFECT_FIFTH : 1, 1)
  }

  /** §13.4 — "Distinct alarm" at heat lockout. Two falling square blips. @hot-path */
  heatLockout(): void {
    this.emit(HEAT_LOCKOUT, this.flatPool, 0, 0, 0, 0, 1, 1)
    this.emit(HEAT_LOCKOUT, this.flatPool, 0, 0, 0, HEAT_LOCKOUT_GAP_S, HEAT_LOCKOUT_SECOND_RATIO, 1)
  }

  /** §7.5 — hull repair and heat purge on an outpost pass. A rising fourth. @hot-path */
  resupply(): void {
    this.emit(CHIME, this.flatPool, 0, 0, 0, 0, 1, 1)
    this.emit(CHIME, this.flatPool, 0, 0, 0, RESUPPLY_GAP_S, RATIO_PERFECT_FOURTH, 1)
  }

  /** §11 — wave cleared. A four-note ascent, spaced so it reads as motion. @hot-path */
  waveCleared(): void {
    this.emit(CHIME, this.flatPool, 0, 0, 0, 0, 1, 1)
    this.emit(CHIME, this.flatPool, 0, 0, 0, WAVE_CLEARED_GAP_S, RATIO_MAJOR_THIRD, 1)
    this.emit(CHIME, this.flatPool, 0, 0, 0, WAVE_CLEARED_GAP_S * 2, RATIO_PERFECT_FIFTH, 1)
    this.emit(CHIME, this.flatPool, 0, 0, 0, WAVE_CLEARED_GAP_S * 3, RATIO_OCTAVE, 1)
  }

  /** §7.6 — back in the air after the 4 s respawn. @hot-path */
  respawned(): void {
    this.emit(RESPAWN, this.flatPool, 0, 0, 0, 0, 1, 1)
  }

  /** §11 — the run is over, win or lose. Low and falling; the Debrief says the rest. @hot-path */
  runEnded(): void {
    this.emit(LOW_CHIME, this.flatPool, 0, 0, 0, 0, 1, 1)
    this.emit(LOW_CHIME, this.flatPool, 0, 0, 0, CONFIRM_GAP_S * 2, RATIO_FIFTH_BELOW, 1)
  }

  /* ---------------------------------------------------------------- */
  /* UI bus (§14.3)                                                    */
  /* ---------------------------------------------------------------- */

  /** UI — a button press. */
  uiClick(): void {
    this.emit(UI_CLICK, this.uiPool, 0, 0, 0, 0, 1, 1)
  }

  /** UI — focus or hover moved. Near the floor of audibility by design. */
  uiHover(): void {
    this.emit(UI_HOVER, this.uiPool, 0, 0, 0, 0, 1, 1)
  }

  /** UI — a choice committed. Rising two-tone. */
  uiConfirm(): void {
    this.emit(UI_CONFIRM, this.uiPool, 0, 0, 0, 0, 1, 1)
    this.emit(UI_CONFIRM, this.uiPool, 0, 0, 0, CONFIRM_GAP_S, RATIO_PERFECT_FIFTH, 1)
  }

  /** UI — a screen dismissed. The same two-tone, inverted. */
  uiBack(): void {
    this.emit(UI_BACK, this.uiPool, 0, 0, 0, 0, 1, 1)
    this.emit(UI_BACK, this.uiPool, 0, 0, 0, CONFIRM_GAP_S, RATIO_FIFTH_BELOW, 1)
  }

  /**
   * Cuts every sounding voice and releases the continuous ones.
   *
   * Called on a run restart or a hard screen change, where the alternative is
   * an explosion from the previous run ringing out over the Title screen.
   */
  silenceAll(): void {
    const now = this.context.currentTime
    this.spatialPool.silenceAll(now)
    this.flatPool.silenceAll(now)
    this.uiPool.silenceAll(now)
    this.engineLevel.gain.setTargetAtTime(0, now, VOICE_MUTE_S)
    this.lockLevel.gain.setTargetAtTime(0, now, VOICE_MUTE_S)
    this.heatLevel.gain.setTargetAtTime(0, now, VOICE_MUTE_S)
    this.engineSpeedNorm = -1
    this.lockProgress = LOCK_IDLE
    this.heatValue = -1
  }

  /* ---------------------------------------------------------------- */

  /** @hot-path */
  private pool(spatialise: boolean): VoicePool {
    return spatialise ? this.spatialPool : this.flatPool
  }

  /**
   * Renders one recipe onto one pooled voice.
   *
   * The single place where a sound is actually triggered, so the single place
   * that has to be allocation-free: no node construction, no object literals,
   * only `AudioParam` writes on nodes that already exist.
   *
   * @hot-path
   */
  private emit(
    recipe: VoiceRecipe,
    pool: VoicePool,
    x: number,
    y: number,
    z: number,
    delay: number,
    transpose: number,
    level: number,
  ): void {
    const now = this.context.currentTime
    const start = now + delay
    const oscEnd = recipe.oscLevel > 0 ? recipe.oscAttackS + recipe.oscDecayS : 0
    const noiseEnd = recipe.noiseLevel > 0 ? recipe.noiseAttackS + recipe.noiseDecayS : 0
    const voice = pool.acquire(now, start + Math.max(oscEnd, noiseEnd))

    const panner = voice.panner
    if (panner !== null) positionPanner(panner, x, y, z, start)

    if (recipe.oscLevel > 0) {
      voice.osc.type = recipe.oscType
      sweep(
        voice.osc.frequency,
        now,
        start,
        recipe.oscFromHz * transpose,
        recipe.oscToHz * transpose,
        recipe.sweepS,
      )
      envelope(voice.oscGain.gain, now, start, recipe.oscLevel * level, recipe.oscAttackS, recipe.oscDecayS)
    } else {
      silence(voice.oscGain.gain, now)
    }

    if (recipe.noiseLevel > 0) {
      voice.filter.type = recipe.filterType
      voice.filter.Q.cancelScheduledValues(now)
      voice.filter.Q.setValueAtTime(recipe.filterQ, start)
      sweep(voice.filter.frequency, now, start, recipe.filterFromHz, recipe.filterToHz, recipe.sweepS)
      envelope(voice.noiseGain.gain, now, start, recipe.noiseLevel * level, recipe.noiseAttackS, recipe.noiseDecayS)
    } else {
      silence(voice.noiseGain.gain, now)
    }
  }
}

/** Equal-tempered frequency ratio for an interval in semitones. @hot-path */
function semitoneRatio(semitones: number): number {
  return Math.pow(2, semitones / 12)
}
