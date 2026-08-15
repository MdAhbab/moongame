/**
 * The audio graph: master, three buses, limiter (gameplan §27.4).
 *
 * ────────────────────────────────────────────────────────────────────────
 * ARCHITECTURAL DEVIATION FROM §30.1 — stated deliberately.
 *
 * §30.1's directory listing places `AudioSystem.ts` under `game/systems/`.
 * That is not implementable, and the conflict is decided by §30.2, not by the
 * listing:
 *
 *   §30.2  `src/game/**` is the pure simulation. Zero React, zero Three.js,
 *          zero DOM — "what makes the simulation unit-testable in Node with no
 *          DOM" (§37.6, §37.1).
 *
 * Web Audio *is* a DOM API. `AudioContext` does not exist in Node, so an
 * `AudioSystem` under `game/` would crash the very test suite §37.1 requires,
 * and the rule is mechanically enforced, not merely documented — a probe file
 * under `src/game/systems/` referencing `window.AudioContext` fails ESLint on
 * `no-restricted-globals` ("src/game/** must run headless in Node").
 *
 * Resolution: the whole Web Audio implementation lives in `src/audio/`, a
 * presentation-side layer in the same tier as `src/render/`. It obeys the
 * presentation contract exactly — it *reads* `World` and the event queue and
 * **never mutates them**, in the same way `render/` reads the world to draw it.
 * `AudioDirector.update(world, dt)` is the audio counterpart of the render
 * bridge (§31.3), and the simulation remains unaware that audio exists.
 *
 * The §30.1 listing should be read as "there is an audio system, driven by the
 * event queue", which is exactly what this is; only its address changes.
 * ────────────────────────────────────────────────────────────────────────
 *
 * **Nothing here may be created before a user gesture.** Browsers refuse to
 * start an `AudioContext` outside a trusted gesture, and a context created at
 * module scope lands in `suspended` and often stays there. So the context is
 * constructed inside `unlock()`, and every other method on this class is a
 * no-op until that has happened. None of them ever throw: an unlocked-audio
 * check is not the caller's job, and a game that crashes because the player has
 * not clicked yet is worse than a game that is quiet.
 */
import { Synth } from './synth.ts'
/* Type-only, so `verbatimModuleSyntax` erases the statement completely and
 * `music.ts` stays reachable by dynamic import alone — see `loadMusic`. */
import type { MusicBed } from './music.ts'
import {
  DEFAULT_MASTER_VOLUME,
  DEFAULT_MUSIC_VOLUME,
  DEFAULT_SFX_VOLUME,
  DEFAULT_UI_VOLUME,
  LIMITER_ATTACK_S,
  LIMITER_KNEE_DB,
  LIMITER_RATIO,
  LIMITER_RELEASE_S,
  LIMITER_THRESHOLD_DB,
  MIX_RAMP_S,
} from './audioConstants.ts'

/**
 * The node skeleton, built once at unlock.
 *
 * Held as a single nullable object rather than as six nullable fields so one
 * `graph === null` check narrows every node at once — which is what keeps the
 * "safe before unlock" guarantee from turning into a null check per line.
 */
export interface AudioGraph {
  readonly context: AudioContext
  readonly limiter: DynamicsCompressorNode
  readonly master: GainNode
  readonly musicBus: GainNode
  readonly sfxBus: GainNode
  readonly spatialBus: GainNode
  readonly uiBus: GainNode
}

export class AudioEngine {
  private graph: AudioGraph | null = null
  private synthesiser: Synth | null = null
  private musicBed: MusicBed | null = null

  private masterVolume = DEFAULT_MASTER_VOLUME
  private musicVolume = DEFAULT_MUSIC_VOLUME
  private sfxVolume = DEFAULT_SFX_VOLUME
  private uiVolume = DEFAULT_UI_VOLUME
  private isMuted = false

  /** Linear multiplier on the music bus, driven by the director (§27.2). */
  private duck = 1

  /** True once a user gesture has brought the graph up. */
  get ready(): boolean {
    return this.graph !== null
  }

  /** The synth, or `null` before unlock. Callers must tolerate the null. */
  get synth(): Synth | null {
    return this.synthesiser
  }

  get muted(): boolean {
    return this.isMuted
  }

  /**
   * Brings the graph up. **Must be called from inside a user gesture** (§27.4).
   *
   * Idempotent: a second call only resumes a context the browser may have
   * suspended. Safe in Node and in a jsdom test, where `AudioContext` does not
   * exist and the engine simply stays silent for its whole lifetime.
   */
  unlock(): void {
    if (this.graph !== null) {
      this.resume()
      return
    }
    if (typeof AudioContext === 'undefined') return

    const context = new AudioContext({ latencyHint: 'interactive' })

    /*
     * The limiter sits *after* the master sum, not on each bus. A limiter per
     * bus cannot see the case it exists to catch — three buses each below full
     * scale that clip once added together. §27.4's "Master → three buses →
     * limiter" is a hierarchy, and the signal flows the other way: sources into
     * their bus, buses into master, master into the limiter, limiter out.
     */
    const limiter = context.createDynamicsCompressor()
    limiter.threshold.value = LIMITER_THRESHOLD_DB
    limiter.knee.value = LIMITER_KNEE_DB
    limiter.ratio.value = LIMITER_RATIO
    limiter.attack.value = LIMITER_ATTACK_S
    limiter.release.value = LIMITER_RELEASE_S
    limiter.connect(context.destination)

    const master = context.createGain()
    master.connect(limiter)

    const musicBus = context.createGain()
    const sfxBus = context.createGain()
    const spatialBus = context.createGain()
    const uiBus = context.createGain()

    musicBus.connect(master)
    sfxBus.connect(master)
    spatialBus.connect(master)
    uiBus.connect(master)

    const convolver = context.createConvolver()
    const irLength = Math.ceil(context.sampleRate * 0.4)
    const irBuffer = context.createBuffer(2, irLength, context.sampleRate)
    for (let c = 0; c < 2; c++) {
      const channel = irBuffer.getChannelData(c)
      for (let i = 0; i < irLength; i++) {
        const env = Math.pow(1 - i / irLength, 3.5)
        channel[i] = (Math.random() * 2 - 1) * env
      }
    }
    convolver.buffer = irBuffer
    
    const reverbFilter = context.createBiquadFilter()
    reverbFilter.type = 'highpass'
    reverbFilter.frequency.value = 600
    reverbFilter.connect(convolver)
    convolver.connect(master)
    
    const reverbSend = context.createGain()
    reverbSend.gain.value = 0.4
    spatialBus.connect(reverbSend)
    reverbSend.connect(reverbFilter)

    this.graph = { context, limiter, master, musicBus, sfxBus, spatialBus, uiBus }
    this.applyMix()

    this.synthesiser = new Synth(this.graph)
    this.loadMusic()
    this.resume()
  }

  /**
   * Pauses the audio thread entirely (§11 — Paused, and tab visibility).
   *
   * Suspending is not the same as muting: a suspended context stops consuming
   * CPU, which matters on the mobile tier where the game may be backgrounded
   * mid-wave.
   */
  suspend(): void {
    const graph = this.graph
    if (graph === null || graph.context.state === 'closed') return
    void graph.context.suspend().catch(() => {
      // Nothing to recover: a context that will not suspend simply keeps running.
    })
  }

  /** Resumes after `suspend`, or after the browser suspended us on its own. */
  resume(): void {
    const graph = this.graph
    if (graph === null || graph.context.state !== 'suspended') return
    void graph.context.resume().catch(() => {
      // A rejected resume means the gesture was not trusted. Staying quiet is correct.
    })
  }

  /* ---------------------------------------------------------------- */
  /* §27.4 — independent sliders per bus, plus a master mute           */
  /* ---------------------------------------------------------------- */

  /** Master level, 0..1. Safe before unlock; the value is applied when the graph comes up. */
  setMasterVolume(volume: number): void {
    this.masterVolume = clamp01(volume)
    this.applyMix()
  }

  /** Music bus level, 0..1 (§27.2). */
  setMusicVolume(volume: number): void {
    this.musicVolume = clamp01(volume)
    this.writeMusicGain()
  }

  /** SFX bus level, 0..1 (§27.1). */
  setSfxVolume(volume: number): void {
    this.sfxVolume = clamp01(volume)
    this.applyMix()
  }

  /** UI bus level, 0..1 (§14.3). */
  setUiVolume(volume: number): void {
    this.uiVolume = clamp01(volume)
    this.applyMix()
  }

  /**
   * Master mute.
   *
   * Implemented as a gain of zero rather than by suspending, so muting is
   * instant and un-muting resumes mid-sound instead of mid-silence. The
   * per-bus volumes are untouched, so un-muting restores the player's mix.
   */
  setMuted(muted: boolean): void {
    this.isMuted = muted
    this.applyMix()
  }

  /**
   * Music duck multiplier, 1 = unducked (§27.2 — "music ducks 6 dB under
   * critical alerts, so alerts always cut through").
   *
   * Driven every frame by `AudioDirector`, which gates the call so a settled
   * mix schedules no automation at all.
   *
   * @hot-path
   */
  setMusicDuck(multiplier: number): void {
    this.duck = multiplier
    this.writeMusicGain()
  }

  /**
   * Update the adaptive score stem mix.
   * @hot-path
   */
  updateStems(tension: number, combat: number, alarm: number): void {
    if (this.musicBed) {
      this.musicBed.updateStems(tension, combat, alarm)
    }
  }

  /** Tears the graph down. HMR and teardown only. */
  dispose(): void {
    const graph = this.graph
    this.musicBed?.stop()
    this.musicBed = null
    this.synthesiser = null
    this.graph = null
    if (graph === null || graph.context.state === 'closed') return
    void graph.context.close().catch(() => {
      // Already closing, or closed by the browser. Nothing to do.
    })
  }

  /* ---------------------------------------------------------------- */

  private applyMix(): void {
    const graph = this.graph
    if (graph === null) return
    const now = graph.context.currentTime
    graph.master.gain.setTargetAtTime(this.isMuted ? 0 : this.masterVolume, now, MIX_RAMP_S)
    graph.sfxBus.gain.setTargetAtTime(this.sfxVolume, now, MIX_RAMP_S)
    graph.spatialBus.gain.setTargetAtTime(this.sfxVolume, now, MIX_RAMP_S)
    graph.uiBus.gain.setTargetAtTime(this.uiVolume, now, MIX_RAMP_S)
    this.writeMusicGain()
  }

  private writeMusicGain(): void {
    const graph = this.graph
    if (graph === null) return
    graph.musicBus.gain.setTargetAtTime(this.musicVolume * this.duck, graph.context.currentTime, MIX_RAMP_S)
  }

  /**
   * Loads the ambient bed as a separate chunk, lazily, after the gesture
   * (§27.2, §33.4).
   *
   * The dynamic import is what produces the `music` chunk: `music.ts` is
   * reachable by no static import anywhere in the app, so the bundler splits it
   * out and neither the loader nor the ~400 KB it fetches sits in the path to
   * first play.
   */
  private loadMusic(): void {
    void import('./music.ts')
      .then((module) => {
        const graph = this.graph
        if (graph === null) return
        this.musicBed = new module.MusicBed(graph.context, graph.musicBus)
        this.musicBed.start()
      })
      .catch(() => {
        // The chunk itself failed to load. The game is fully playable without it.
      })
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}
