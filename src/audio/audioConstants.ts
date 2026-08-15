/**
 * Every audio tuning value, in one file (gameplan §30.1 Rule 8, §27).
 *
 * The same rule `game/data/constants.ts` follows: sound *feel* is produced by
 * these numbers, so they live together and nowhere else. A magic number
 * anywhere under `src/audio/` is a bug.
 *
 * One-shot SFX are expressed as **recipes** rather than as code. Every sound in
 * §27.1's table is the same five-node voice — a noise layer through a filter
 * plus an oscillator layer, each with its own envelope — differing only in its
 * numbers. Making that difference *data* is what keeps `synth.ts` free of the
 * copy-pasted node graphs that audio code usually degenerates into, and it puts
 * every tunable value in this file where Rule 8 requires it.
 */

/* ------------------------------------------------------------------ */
/* §27.4 — Mixing: master, three buses, limiter                        */
/* ------------------------------------------------------------------ */

/** Defaults for the three Settings sliders (§14.3, Audio tab). */
export const DEFAULT_MASTER_VOLUME = 0.8
export const DEFAULT_MUSIC_VOLUME = 0.5
export const DEFAULT_SFX_VOLUME = 0.9
export const DEFAULT_UI_VOLUME = 0.65

/**
 * Ramp applied to every mixer change.
 *
 * A gain written instantaneously steps the waveform, and a step is a click.
 * 20 ms is below the threshold at which a slider feels laggy and well above the
 * threshold at which the discontinuity is audible.
 */
export const MIX_RAMP_S = 0.02

/**
 * Limiter (§27.4). A high ratio with a fast attack and a slow release, sitting
 * on the *summed* signal so it catches the case the individual buses cannot see:
 * three quiet buses that clip only once added together.
 */
export const LIMITER_THRESHOLD_DB = -8
export const LIMITER_KNEE_DB = 2
export const LIMITER_RATIO = 20
export const LIMITER_ATTACK_S = 0.002
export const LIMITER_RELEASE_S = 0.22

/* ------------------------------------------------------------------ */
/* §27.2 — Music and ducking                                           */
/* ------------------------------------------------------------------ */

/**
 * Candidate music sources, tried in order until one both fetches *and*
 * decodes. Ordering by preference rather than sniffing codecs means a browser
 * that reports Opus support but fails to decode it still ends up with music,
 * and a browser with neither ends up silent rather than broken.
 *
 * Both are rendered by `tools/render-ambient-bed.py` and committed under
 * `public/audio/`. See that script for why the bed is generated offline rather
 * than sourced, and `music.ts` for how it is looped.
 */
export const MUSIC_STEMS = {
  bed: ['/audio/ambient-bed.opus', '/audio/ambient-bed.m4a'],
  tension: ['/audio/ambient-tension.opus', '/audio/ambient-tension.m4a'],
  combat: ['/audio/ambient-combat.opus', '/audio/ambient-combat.m4a'],
  alarm: ['/audio/ambient-alarm.opus', '/audio/ambient-alarm.m4a'],
} as const

/** −6 dB, as linear gain: 10^(−6/20). §27.2 — alerts always cut through. */
export const MUSIC_DUCK_GAIN = 0.501187

/** How long the duck is held after the alert that triggered it. */
export const MUSIC_DUCK_HOLD_S = 1.8

/** Duck envelope rate, s⁻¹, used with the analytic `damp` so it is Δt-independent (Rule 5). */
export const MUSIC_DUCK_LAMBDA = 9

/** Below this change the duck is not rewritten, so a settled mix schedules nothing. */
export const DUCK_EPSILON = 0.002

/** Music fades in rather than starting mid-bar at full level. */
export const MUSIC_FADE_IN_S = 3

/**
 * Loop-point trim, seconds.
 *
 * Lossy codecs prepend encoder delay and append padding, so a bed authored to
 * loop seamlessly usually does not once decoded — the seam is a short gap of
 * silence every 90 s, which is exactly the kind of defect that only shows up
 * after a judge has been on the Title screen for two minutes. When the real
 * file lands, measure the seam and trim it here; these two numbers are the
 * whole fix. Zero means "loop the decoded buffer end to end".
 */
export const MUSIC_LOOP_TRIM_START_S = 0
export const MUSIC_LOOP_TRIM_END_S = 0

/* ------------------------------------------------------------------ */
/* Voice pools (§34.2 — allocate once, never in the frame path)        */
/* ------------------------------------------------------------------ */

/**
 * Pool sizes.
 *
 * Sized against the worst realistic frame: a burst of hits on several enemies
 * at once, one of them dying, while terrain scrapes. Beyond that the pool
 * steals the voice closest to finishing, which is inaudible — and a hard cap is
 * what stops a 48-enemy wave turning into a wall of mush.
 */
export const SPATIAL_VOICES = 12
export const FLAT_VOICES = 10
export const UI_VOICES = 4

/** −80 dB. `exponentialRampToValueAtTime` cannot target zero, so decays end here. */
export const EPSILON_GAIN = 0.0001

/**
 * Fade applied when a layer is silenced or a voice is stolen mid-sound.
 * Four milliseconds is below the ear's temporal resolution and above the
 * discontinuity that would otherwise click.
 */
export const VOICE_MUTE_S = 0.004

/**
 * Deterministic noise (§10.4 in spirit).
 *
 * Two seconds is long enough that the loop point is not perceptible as a
 * pitch, and the seed makes the noise bit-identical between runs so a recorded
 * bug report sounds the same on replay.
 */
export const NOISE_BUFFER_S = 2
export const NOISE_SEED = 0x5eed_a1d0

/* ------------------------------------------------------------------ */
/* §27.3 — Spatialisation                                              */
/* ------------------------------------------------------------------ */

export const PANNER_MODEL: PanningModelType = 'HRTF'
export const PANNER_DISTANCE_MODEL: DistanceModelType = 'inverse'
export const PANNER_REF_DISTANCE = 20
export const PANNER_MAX_DISTANCE = 400
export const PANNER_ROLLOFF = 1

/** Listener smoothing time constant. Long enough to kill zipper, short enough to track a turn. */
export const LISTENER_SMOOTH_S = 0.03

/**
 * Inside this radius a sound plays flat instead of through a panner.
 *
 * HRTF at zero distance is degenerate — the head-related transfer function has
 * no meaningful direction for a source at the listener's own position, and the
 * result is a phasey smear. The craft's own weapons and engine are at the
 * listener, so they are simply not spatialised.
 */
export const NEAR_FIELD_U = 6

/* ------------------------------------------------------------------ */
/* §27.1 — The persistent engine voice                                 */
/* ------------------------------------------------------------------ */

/**
 * Engine pitch, Hz, at rest and at `V_BOOST`.
 *
 * Just under an octave and a half of travel. More than that and cruise sounds
 * like a different vehicle from boost; less and the speed cue stops reading.
 */
export const ENGINE_BASE_HZ = 46
export const ENGINE_TOP_HZ = 132

/** Lowpass cutoff at rest and at `V_BOOST`. The cutoff carries the speed cue more than the pitch does. */
export const ENGINE_CUTOFF_MIN_HZ = 240
export const ENGINE_CUTOFF_MAX_HZ = 4200
export const ENGINE_FILTER_Q = 1.1

export const ENGINE_OSC_LEVEL = 0.15
export const ENGINE_NOISE_LEVEL = 0.1

/** Overall engine level at rest and at full throttle, before the boost multiplier. */
export const ENGINE_IDLE_LEVEL = 0.35
export const ENGINE_FULL_LEVEL = 1

/** Boost (§7.4) opens the filter and pushes level — audibly a different regime, not just louder. */
export const ENGINE_BOOST_LEVEL_MULT = 1.3
export const ENGINE_BOOST_CUTOFF_MULT = 1.55
export const ENGINE_BOOST_DETUNE_CENTS = 14

/** Parameter smoothing, seconds. Short: the engine must feel bolted to the throttle (§8.5). */
export const ENGINE_SMOOTH_S = 0.05

/** Below this change the engine parameters are not rewritten. */
export const ENGINE_EPSILON = 0.001

/* ------------------------------------------------------------------ */
/* §27.1 — The lock tone: the pitch interval IS the progress bar       */
/* ------------------------------------------------------------------ */

/**
 * Lower oscillator, Hz. Around E5 — high enough to sit above the engine bed,
 * low enough that the beating at the end of the sweep is easy to count.
 */
export const LOCK_BASE_HZ = 659.25

/**
 * Interval at zero progress, in semitones. A perfect fifth.
 *
 * Chosen so the sweep passes through three perceptually distinct regimes:
 * a consonant interval (wide, "just started"), roughness (mid), and countable
 * beating (about to lock). See the derivation in `synth.ts`.
 */
export const LOCK_INTERVAL_SEMITONES = 7

/** Level at zero and full progress. The tone leans in as the lock closes. */
export const LOCK_LEVEL_MIN = 0.045
export const LOCK_LEVEL_MAX = 0.115

/** Smoothing for the converging oscillator, and the release when lock is dropped. */
export const LOCK_SMOOTH_S = 0.025
export const LOCK_RELEASE_S = 0.07

/** Below this change in progress the lock tone is not rewritten. */
export const LOCK_EPSILON = 0.002

/**
 * Sentinel progress meaning "no lock in flight".
 *
 * Negative rather than a second boolean argument, because progress and
 * "is there a lock at all" are the same fact from the caller's side: the
 * simulation's `LockState` is `Idle | Acquiring | Locked`, and mapping `Idle`
 * to a value outside [0, 1] keeps the synth's interface to the one number that
 * actually drives the sound.
 */
export const LOCK_IDLE = -1

/* ------------------------------------------------------------------ */
/* §27.1 — Heat warning: AM square, modulation rate rises with heat    */
/* ------------------------------------------------------------------ */

/**
 * Fraction of `HEAT_MAX` at which the warning becomes audible.
 *
 * The gauge is visible from zero (§14.2); the tone starts only once heat is
 * actually a decision, so it is information rather than noise.
 */
export const HEAT_WARN_THRESHOLD = 0.55

export const HEAT_CARRIER_HZ = 233
/** Modulation rate at the threshold and at 100% heat. 16 Hz is a hard, urgent buzz. */
export const HEAT_AM_MIN_HZ = 2.5
export const HEAT_AM_MAX_HZ = 16
export const HEAT_LEVEL_MAX = 0.15
export const HEAT_SMOOTH_S = 0.05
export const HEAT_EPSILON = 0.004

/* ------------------------------------------------------------------ */
/* One-shot recipes                                                    */
/* ------------------------------------------------------------------ */

/**
 * A single one-shot voice, as data.
 *
 * Both layers are always present; a layer is silenced by setting its level to
 * zero, which the synth skips entirely. `sweepS` of 0 holds the `From` values
 * and ignores the `To` values.
 */
export interface VoiceRecipe {
  /** Tonal layer. */
  readonly oscType: OscillatorType
  readonly oscLevel: number
  readonly oscFromHz: number
  readonly oscToHz: number
  readonly oscAttackS: number
  readonly oscDecayS: number
  /** Noise layer, through one biquad. */
  readonly noiseLevel: number
  readonly filterType: BiquadFilterType
  readonly filterFromHz: number
  readonly filterToHz: number
  readonly filterQ: number
  readonly noiseAttackS: number
  readonly noiseDecayS: number
  /** Duration of the pitch and cutoff sweeps. */
  readonly sweepS: number
}

/**
 * §27.1 — "Noise burst + pitched click, 40 ms exponential decay."
 * The click is what makes the shot feel like it has a firing pin; the noise is
 * what makes it feel like it has energy.
 */
export const PULSE_CANNON: VoiceRecipe = {
  oscType: 'square',
  oscLevel: 0.2,
  oscFromHz: 1400,
  oscToHz: 210,
  oscAttackS: 0.001,
  oscDecayS: 0.04,
  noiseLevel: 0.3,
  filterType: 'highpass',
  filterFromHz: 1800,
  filterToHz: 1200,
  filterQ: 0.7,
  noiseAttackS: 0.001,
  noiseDecayS: 0.04,
  sweepS: 0.04,
}

/** §27.1 — "Bandpass noise, sharp attack." Sub-millisecond attack: this must read as *contact*. */
export const IMPACT: VoiceRecipe = {
  oscType: 'sine',
  oscLevel: 0.07,
  oscFromHz: 430,
  oscToHz: 250,
  oscAttackS: 0.001,
  oscDecayS: 0.07,
  noiseLevel: 0.5,
  filterType: 'bandpass',
  filterFromHz: 1500,
  filterToHz: 900,
  filterQ: 2.2,
  noiseAttackS: 0.0008,
  noiseDecayS: 0.11,
  sweepS: 0.1,
}

/** §27.1 — "Lowpassed noise, exponential decay, pitch-dropping sub layer." */
export const EXPLOSION: VoiceRecipe = {
  oscType: 'sine',
  oscLevel: 0.5,
  oscFromHz: 140,
  oscToHz: 34,
  oscAttackS: 0.004,
  oscDecayS: 0.62,
  noiseLevel: 0.75,
  filterType: 'lowpass',
  filterFromHz: 2200,
  filterToHz: 220,
  filterQ: 0.8,
  noiseAttackS: 0.004,
  noiseDecayS: 0.75,
  sweepS: 0.55,
}

/** The player's own death (§7.6). The same shape as `EXPLOSION`, lower and much longer. */
export const PLAYER_DESTROYED: VoiceRecipe = {
  oscType: 'sine',
  oscLevel: 0.7,
  oscFromHz: 112,
  oscToHz: 26,
  oscAttackS: 0.006,
  oscDecayS: 1.5,
  noiseLevel: 0.85,
  filterType: 'lowpass',
  filterFromHz: 2600,
  filterToHz: 110,
  filterQ: 0.8,
  noiseAttackS: 0.006,
  noiseDecayS: 1.7,
  sweepS: 1.2,
}

/**
 * §13.4 — "Impact + hull stress."
 * The long triangle groan under the impact is the hull; it is what makes taking
 * damage feel structural rather than cosmetic.
 */
export const PLAYER_HIT: VoiceRecipe = {
  oscType: 'triangle',
  oscLevel: 0.45,
  oscFromHz: 190,
  oscToHz: 62,
  oscAttackS: 0.003,
  oscDecayS: 0.55,
  noiseLevel: 0.45,
  filterType: 'bandpass',
  filterFromHz: 800,
  filterToHz: 380,
  filterQ: 1.1,
  noiseAttackS: 0.001,
  noiseDecayS: 0.22,
  sweepS: 0.5,
}

/** §22.6 — grazing the surface. Wide, grinding, and deliberately unpleasant. */
export const TERRAIN_SCRAPE: VoiceRecipe = {
  oscType: 'sawtooth',
  oscLevel: 0.12,
  oscFromHz: 92,
  oscToHz: 68,
  oscAttackS: 0.01,
  oscDecayS: 0.3,
  noiseLevel: 0.5,
  filterType: 'bandpass',
  filterFromHz: 1100,
  filterToHz: 700,
  filterQ: 0.9,
  noiseAttackS: 0.006,
  noiseDecayS: 0.34,
  sweepS: 0.3,
}

/** §7.4 — missile away. The cutoff rises as the motor lights, so it reads as departing. */
export const MISSILE_LAUNCH: VoiceRecipe = {
  oscType: 'sawtooth',
  oscLevel: 0.3,
  oscFromHz: 180,
  oscToHz: 70,
  oscAttackS: 0.01,
  oscDecayS: 0.55,
  noiseLevel: 0.55,
  filterType: 'lowpass',
  filterFromHz: 500,
  filterToHz: 5200,
  filterQ: 0.9,
  noiseAttackS: 0.02,
  noiseDecayS: 0.6,
  sweepS: 0.5,
}

/** §7.4 — boost engaged. Rising, because the craft is about to be somewhere else. */
export const BOOST_ENGAGE: VoiceRecipe = {
  oscType: 'sawtooth',
  oscLevel: 0.26,
  oscFromHz: 130,
  oscToHz: 620,
  oscAttackS: 0.02,
  oscDecayS: 0.4,
  noiseLevel: 0.35,
  filterType: 'bandpass',
  filterFromHz: 400,
  filterToHz: 3000,
  filterQ: 0.8,
  noiseAttackS: 0.02,
  noiseDecayS: 0.42,
  sweepS: 0.35,
}

export const STRAFE_THRUSTER: VoiceRecipe = {
  oscType: 'sine',
  oscFromHz: 0,
  oscToHz: 0,
  oscLevel: 0,
  oscAttackS: 0,
  oscDecayS: 0,
  filterType: 'bandpass',
  filterQ: 2.0,
  filterFromHz: 2000,
  filterToHz: 1000,
  noiseLevel: 0.5,
  noiseAttackS: 0.02,
  noiseDecayS: 0.2,
  sweepS: 0.1,
}

/** Heavy orbital bomb bay pneumatic launch and ejection clunk. */
export const BOMB_DROP: VoiceRecipe = {
  oscType: 'triangle',
  oscFromHz: 140,
  oscToHz: 35,
  oscLevel: 0.6,
  oscAttackS: 0.01,
  oscDecayS: 0.65,
  filterType: 'lowpass',
  filterFromHz: 450,
  filterToHz: 80,
  filterQ: 3.5,
  noiseLevel: 0.45,
  noiseAttackS: 0.02,
  noiseDecayS: 0.5,
  sweepS: 0.55,
}

/** Engine cut: thrusters power down into Newtonian drift float. */
export const ENGINE_CUT: VoiceRecipe = {
  oscType: 'sine',
  oscFromHz: 280,
  oscToHz: 55,
  oscLevel: 0.35,
  oscAttackS: 0.02,
  oscDecayS: 0.8,
  filterType: 'lowpass',
  filterFromHz: 600,
  filterToHz: 100,
  filterQ: 1.2,
  noiseLevel: 0.25,
  noiseAttackS: 0.01,
  noiseDecayS: 0.6,
  sweepS: 0.7,
}

/** Countermeasure flares pyrotechnic burst and ejection hiss. */
export const FLARE_LAUNCH: VoiceRecipe = {
  oscType: 'triangle',
  oscFromHz: 480,
  oscToHz: 160,
  oscLevel: 0.35,
  oscAttackS: 0.01,
  oscDecayS: 0.35,
  filterType: 'bandpass',
  filterFromHz: 2400,
  filterToHz: 800,
  filterQ: 1.5,
  noiseLevel: 0.6,
  noiseAttackS: 0.01,
  noiseDecayS: 0.4,
  sweepS: 0.3,
}

/** §13.4 — "Rising alert" when a Harvester lands and the drain clock starts. */
export const DRAIN_ALERT: VoiceRecipe = {
  oscType: 'triangle',
  oscLevel: 0.4,
  oscFromHz: 300,
  oscToHz: 640,
  oscAttackS: 0.01,
  oscDecayS: 0.42,
  noiseLevel: 0,
  filterType: 'lowpass',
  filterFromHz: 1000,
  filterToHz: 1000,
  filterQ: 1,
  noiseAttackS: 0.01,
  noiseDecayS: 0.01,
  sweepS: 0.34,
}

/**
 * §27.1 — "Descending sine pair with a long release." Upper voice.
 *
 * The pair falls exactly an octave and stays a perfect fifth apart throughout,
 * so the interval never turns dissonant: this is meant to be mournful (§26.3,
 * "slow, dark, deliberately mournful"), not alarming. The alarm already
 * happened; this is the outpost going dark.
 */
export const OUTPOST_LOST_HIGH: VoiceRecipe = {
  oscType: 'sine',
  oscLevel: 0.34,
  oscFromHz: 330,
  oscToHz: 165,
  oscAttackS: 0.05,
  oscDecayS: 2.4,
  noiseLevel: 0,
  filterType: 'lowpass',
  filterFromHz: 1000,
  filterToHz: 1000,
  filterQ: 1,
  noiseAttackS: 0.01,
  noiseDecayS: 0.01,
  sweepS: 2.2,
}

/** Lower voice of the §27.1 pair, a perfect fifth below. */
export const OUTPOST_LOST_LOW: VoiceRecipe = {
  oscType: 'sine',
  oscLevel: 0.3,
  oscFromHz: 220,
  oscToHz: 110,
  oscAttackS: 0.07,
  oscDecayS: 2.8,
  noiseLevel: 0,
  filterType: 'lowpass',
  filterFromHz: 1000,
  filterToHz: 1000,
  filterQ: 1,
  noiseAttackS: 0.01,
  noiseDecayS: 0.01,
  sweepS: 2.4,
}

/**
 * The positional half of an outpost loss (§27.3).
 *
 * The sine pair above is a flat alert because it must always be heard; this
 * layer is spatialised at the outpost, so the player also learns *which side of
 * the sphere* just went dark without reading the roster.
 */
export const OUTPOST_POWER_DOWN: VoiceRecipe = {
  oscType: 'sine',
  oscLevel: 0.18,
  oscFromHz: 90,
  oscToHz: 40,
  oscAttackS: 0.02,
  oscDecayS: 1.6,
  noiseLevel: 0.4,
  filterType: 'lowpass',
  filterFromHz: 1400,
  filterToHz: 130,
  filterQ: 0.7,
  noiseAttackS: 0.02,
  noiseDecayS: 1.7,
  sweepS: 1.5,
}

/** §7.4 — heat lockout. Low, square and buzzy: distinct from the heat *warning* by timbre, not level. */
export const HEAT_LOCKOUT: VoiceRecipe = {
  oscType: 'square',
  oscLevel: 0.26,
  oscFromHz: 340,
  oscToHz: 300,
  oscAttackS: 0.004,
  oscDecayS: 0.22,
  noiseLevel: 0.1,
  filterType: 'bandpass',
  filterFromHz: 1200,
  filterToHz: 900,
  filterQ: 3,
  noiseAttackS: 0.004,
  noiseDecayS: 0.2,
  sweepS: 0.2,
}

/** The lockout alarm is two blips; this is the gap and the drop of the second. */
export const HEAT_LOCKOUT_GAP_S = 0.15
export const HEAT_LOCKOUT_SECOND_RATIO = 0.84

/** §13.4 — "Two-tone confirm" on lock acquired. */
export const LOCK_CONFIRM: VoiceRecipe = {
  oscType: 'square',
  oscLevel: 0.14,
  oscFromHz: 988,
  oscToHz: 988,
  oscAttackS: 0.002,
  oscDecayS: 0.1,
  noiseLevel: 0,
  filterType: 'lowpass',
  filterFromHz: 1000,
  filterToHz: 1000,
  filterQ: 1,
  noiseAttackS: 0.01,
  noiseDecayS: 0.01,
  sweepS: 0,
}

/** Warm bell, transposed by the callers that build chords from it. Base is C5. */
export const CHIME: VoiceRecipe = {
  oscType: 'triangle',
  oscLevel: 0.24,
  oscFromHz: 523.25,
  oscToHz: 523.25,
  oscAttackS: 0.008,
  oscDecayS: 0.5,
  noiseLevel: 0,
  filterType: 'lowpass',
  filterFromHz: 1000,
  filterToHz: 1000,
  filterQ: 1,
  noiseAttackS: 0.01,
  noiseDecayS: 0.01,
  sweepS: 0,
}

/** Low bell for run-end. Base is G3. */
export const LOW_CHIME: VoiceRecipe = {
  oscType: 'sine',
  oscLevel: 0.3,
  oscFromHz: 196,
  oscToHz: 196,
  oscAttackS: 0.02,
  oscDecayS: 1.6,
  noiseLevel: 0,
  filterType: 'lowpass',
  filterFromHz: 1000,
  filterToHz: 1000,
  filterQ: 1,
  noiseAttackS: 0.01,
  noiseDecayS: 0.01,
  sweepS: 0,
}

/** §7.6 — back in the air after the 4 s respawn. Rising, clean, unambiguous. */
export const RESPAWN: VoiceRecipe = {
  oscType: 'sine',
  oscLevel: 0.35,
  oscFromHz: 180,
  oscToHz: 760,
  oscAttackS: 0.02,
  oscDecayS: 0.5,
  noiseLevel: 0.18,
  filterType: 'bandpass',
  filterFromHz: 600,
  filterToHz: 3000,
  filterQ: 1,
  noiseAttackS: 0.02,
  noiseDecayS: 0.45,
  sweepS: 0.45,
}

/* Just-intonation-adjacent ratios, used to build the small chords above from
 * one recipe. Equal temperament to three places; the error is inaudible on a
 * 0.5 s bell and the numbers stay readable. */
export const RATIO_MAJOR_THIRD = 1.26
export const RATIO_PERFECT_FOURTH = 1.335
export const RATIO_PERFECT_FIFTH = 1.498
export const RATIO_OCTAVE = 2
export const RATIO_FIFTH_BELOW = 0.667

/** §7.5 — resupply: a rising fourth, because the craft leaves better than it arrived. */
export const RESUPPLY_GAP_S = 0.09

/** §11 — wave cleared: a four-note arpeggio, spaced so it reads as an ascent, not a chord. */
export const WAVE_CLEARED_GAP_S = 0.11

/** §7.2 — an outpost held. A fifth, struck together. */
export const OUTPOST_SAVED_GAP_S = 0.02

/** Two-tone screen confirms and the run-end fall. */
export const CONFIRM_GAP_S = 0.07

/* ------------------------------------------------------------------ */
/* UI bus (§14.3)                                                      */
/* ------------------------------------------------------------------ */

export const UI_CLICK: VoiceRecipe = {
  oscType: 'square',
  oscLevel: 0.12,
  oscFromHz: 1150,
  oscToHz: 880,
  oscAttackS: 0.001,
  oscDecayS: 0.035,
  noiseLevel: 0.1,
  filterType: 'highpass',
  filterFromHz: 3000,
  filterToHz: 3000,
  filterQ: 0.7,
  noiseAttackS: 0.001,
  noiseDecayS: 0.03,
  sweepS: 0.03,
}

/** Hover is deliberately near the floor of audibility: present, never chattery. */
export const UI_HOVER: VoiceRecipe = {
  oscType: 'sine',
  oscLevel: 0.06,
  oscFromHz: 2100,
  oscToHz: 2100,
  oscAttackS: 0.002,
  oscDecayS: 0.03,
  noiseLevel: 0,
  filterType: 'lowpass',
  filterFromHz: 1000,
  filterToHz: 1000,
  filterQ: 1,
  noiseAttackS: 0.01,
  noiseDecayS: 0.01,
  sweepS: 0,
}

export const UI_CONFIRM: VoiceRecipe = {
  oscType: 'triangle',
  oscLevel: 0.18,
  oscFromHz: 880,
  oscToHz: 880,
  oscAttackS: 0.004,
  oscDecayS: 0.13,
  noiseLevel: 0,
  filterType: 'lowpass',
  filterFromHz: 1000,
  filterToHz: 1000,
  filterQ: 1,
  noiseAttackS: 0.01,
  noiseDecayS: 0.01,
  sweepS: 0,
}

export const UI_BACK: VoiceRecipe = {
  oscType: 'triangle',
  oscLevel: 0.16,
  oscFromHz: 660,
  oscToHz: 660,
  oscAttackS: 0.004,
  oscDecayS: 0.13,
  noiseLevel: 0,
  filterType: 'lowpass',
  filterFromHz: 1000,
  filterToHz: 1000,
  filterQ: 1,
  noiseAttackS: 0.01,
  noiseDecayS: 0.01,
  sweepS: 0,
}

/* ------------------------------------------------------------------ */
/* Director                                                            */
/* ------------------------------------------------------------------ */

/**
 * Kill loudness is scaled by the event's score payload, which is the only
 * archetype proxy the event carries (`EventQueue.b` — "magnitude: damage,
 * score, progress"). A Sentinel at 250 lands heavier than an Interceptor at
 * 100, and an event that reports no score degrades to the floor rather than to
 * silence.
 */
export const KILL_LEVEL_MIN = 0.7
export const KILL_LEVEL_MAX = 1.25
export const KILL_LEVEL_PER_SCORE = 0.0022

/** Player-hit loudness scales with damage, floored so a scratch is still felt. */
export const HIT_LEVEL_MIN = 0.6
export const HIT_LEVEL_MAX = 1.3
export const HIT_LEVEL_PER_DAMAGE = 0.035
