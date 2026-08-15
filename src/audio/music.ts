/**
 * The ambient bed — the audio files in the game (gameplan §27.2, §33.1).
 *
 * ────────────────────────────────────────────────────────────────────────
 * THE FILES
 *
 *   public/audio/ambient-bed.opus
 *   public/audio/ambient-tension.opus
 *   public/audio/ambient-combat.opus
 *   public/audio/ambient-alarm.opus
 *
 * Both opus and m4a paths are declared in `MUSIC_STEMS` (`audioConstants.ts`) 
 * and tried in order; the first that fetches *and* decodes wins. If any stem
 * fails to fetch or decode, the game falls back to single-file behavior (bed only).
 * If bed fails too, the module resolves to silence and the game is unaffected.
 *
 * They are rendered by `tools/render-ambient-bed.py`, which builds the signal
 * in the frequency domain so that every component is an exact integer multiple
 * of 1/60 Hz and the waveform is periodic over the loop by construction.
 *
 * WHY THIS IS NOT THE THING §27.2 RULES OUT. That section rejects *runtime
 * generative music* — "procedurally generated music that is genuinely good is a
 * research problem, not a feature". What ships here is a set of sustained textures 
 * rendered once, offline, into fixed files. The runtime decodes and loops buffers 
 * and crossfades them, exactly as it would with composed stems.
 * ────────────────────────────────────────────────────────────────────────
 */
import {
  MUSIC_FADE_IN_S,
  MUSIC_LOOP_TRIM_END_S,
  MUSIC_LOOP_TRIM_START_S,
  MUSIC_STEMS,
} from './audioConstants.ts'
import { debug } from './debug.ts'

type BedState = 'idle' | 'loading' | 'playing' | 'unavailable'
type StemName = keyof typeof MUSIC_STEMS

/**
 * Lazily-fetched, seamlessly looped ambient stems on the music bus (§27.2).
 */
export class MusicBed {
  private readonly context: AudioContext
  private readonly destination: AudioNode
  
  private sources: Record<StemName, AudioBufferSourceNode | null> = { bed: null, tension: null, combat: null, alarm: null }
  private gains: Record<StemName, GainNode | null> = { bed: null, tension: null, combat: null, alarm: null }
  
  private state: BedState = 'idle'
  /** Set by `stop()`; checked after each await so a teardown mid-fetch is respected. */
  private cancelled = false

  constructor(context: AudioContext, destination: AudioNode) {
    this.context = context
    this.destination = destination
  }

  /** False once every candidate source has failed. */
  get available(): boolean {
    return this.state !== 'unavailable'
  }

  /**
   * Begins fetching and, on success, starts the loop with a fade-in (§27.2).
   */
  start(): void {
    if (this.state !== 'idle') return
    this.state = 'loading'
    void this.load()
  }

  /** Stops the bed and prevents an in-flight load from starting one. */
  stop(): void {
    this.cancelled = true
    for (const stem in this.sources) {
      const source = this.sources[stem as StemName]
      if (source !== null) {
        source.stop()
        source.disconnect()
      }
    }
    this.sources = { bed: null, tension: null, combat: null, alarm: null }
  }

  /**
   * Tries each candidate in order for all stems.
   */
  private async load(): Promise<void> {
    const buffers: Partial<Record<StemName, AudioBuffer>> = {}

    const promises = (Object.keys(MUSIC_STEMS) as StemName[]).map(async (stem) => {
      const urls = MUSIC_STEMS[stem]
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i]
        if (url === undefined) continue
        const buffer = await decodeFrom(this.context, url)
        if (this.cancelled) return
        if (buffer !== null) {
          buffers[stem] = buffer
          return
        }
      }
    })

    await Promise.all(promises)
    if (this.cancelled) return

    const allLoaded = (Object.keys(MUSIC_STEMS) as StemName[]).every(stem => buffers[stem] !== undefined)

    if (allLoaded) {
      this.play(buffers)
    } else if (buffers.bed) {
      // Fallback: single-file behavior
      this.play({ bed: buffers.bed })
    } else {
      this.state = 'unavailable'
      debug('no ambient bed found; running without music (see music.ts header)')
    }
  }

  private play(buffers: Partial<Record<StemName, AudioBuffer>>): void {
    const now = this.context.currentTime

    for (const stem in buffers) {
      const s = stem as StemName
      const buffer = buffers[s]
      if (!buffer) continue

      const gain = this.context.createGain()
      gain.connect(this.destination)

      const source = this.context.createBufferSource()
      source.buffer = buffer
      source.loop = true
      source.loopStart = MUSIC_LOOP_TRIM_START_S
      source.loopEnd = buffer.duration - MUSIC_LOOP_TRIM_END_S
      source.connect(gain)

      gain.gain.setValueAtTime(0, now)
      
      this.sources[s] = source
      this.gains[s] = gain
    }

    if (this.gains.bed) {
      this.gains.bed.gain.linearRampToValueAtTime(1, now + MUSIC_FADE_IN_S)
    }

    for (const stem in this.sources) {
      const source = this.sources[stem as StemName]
      if (source) {
        source.start(now, MUSIC_LOOP_TRIM_START_S)
      }
    }

    this.state = 'playing'
  }
  
  /**
   * Updates stem mix based on threat states.
   * Crossfade is applied via setTargetAtTime.
   */
  public updateStems(tension: number, combat: number, alarm: number): void {
    if (this.state !== 'playing') return
    const now = this.context.currentTime
    const crossfadeSmoothTime = 1.0 // Results in ~2-4s fade depending on threshold
    
    if (this.gains.tension) {
      this.gains.tension.gain.setTargetAtTime(tension, now, crossfadeSmoothTime)
    }
    if (this.gains.combat) {
      this.gains.combat.gain.setTargetAtTime(combat, now, crossfadeSmoothTime)
    }
    if (this.gains.alarm) {
      this.gains.alarm.gain.setTargetAtTime(alarm, now, crossfadeSmoothTime)
    }
  }
}

/**
 * Fetches and decodes one candidate, or returns `null`.
 */
async function decodeFrom(context: AudioContext, url: string): Promise<AudioBuffer | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const encoded = await response.arrayBuffer()
    return await context.decodeAudioData(encoded)
  } catch {
    return null
  }
}
