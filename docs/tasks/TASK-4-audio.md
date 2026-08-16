# TASK 4 — Audio: adaptive score, space, and captions

**Owner:** you (agent, Antigravity IDE)
**Scope:** `src/audio/**`, `tools/**`, `public/audio/**` — **nothing else**
**Repo root:** `moon-game-v2/`
**Runs in parallel with:** TASK-3 (presentation), TASK-5 (backend), and the main session
**Status: landed, with drift (August 2026).**

Adaptive stems, captions API, UI bus and mute-playability are in
`src/audio/`. Convolution reverb / Doppler remain open. The header of
`AudioDirector.ts` is still the contract: every sound names the visual
channel carrying the same fact.

---

## 0. Read these first, in this order

1. `docs/gameplan.md` §27 (Audio), especially **§27.2 (why runtime generative
   music is ruled out)** and §27.4 (the bus architecture and the muted-play rule).
2. `src/audio/AudioEngine.ts` — the graph. Read it completely.
3. `src/audio/AudioDirector.ts` — the bridge from world state to sound. Its
   header contains a row-by-row proof that the game is fully playable muted.
   **That proof is a contract you must not break.**
4. `src/audio/music.ts` — the ambient bed, and why it is a rendered file rather
   than a runtime generator.
5. `tools/render-ambient-bed.py` — how that file is made.

---

## 1. Start by understanding what already works

This layer is further along than it looks, and the fastest way to waste a day
here is to rebuild something that exists. Already done, correctly:

- **Master → three buses → limiter**, with the limiter *after* the sum, because a
  per-bus limiter cannot see three buses that each sit below full scale and clip
  once added (`AudioEngine.ts:118`).
- **Pooled voices** — 12 spatial, 10 flat, 4 UI. Nothing allocates per sound.
- **HRTF panning** with an inverse distance model and a near-field bypass
  (`spatial.ts`).
- **A 6 dB music duck** under alerts, with hold and exponential release.
- **A seamless 60 s ambient bed**, rendered in the frequency domain so every
  partial is an integer multiple of 1/60 Hz and the loop is periodic *by
  construction*. Measured wrap discontinuity: 0.0025 against a 0.109 peak.
- **`update()` allocates nothing** — no literals, no closures, no iterators.

Four things are missing. Those four are your job.

---

## 2. Workstream 1 — an adaptive score

One 60-second drone plays at one level for a whole run. The wave arc goes from
"two Harvesters, no time pressure" to "four outposts under the beam at once", and
the music does not know.

**Build layered stems, not a runtime generator.** §27.2 rules out procedural
music, and it is right — "procedurally generated music that is genuinely good is
a research problem, not a feature". What it rules out is *generation at runtime*.
Pre-rendered stems cross-faded by game state is the standard approach in the
industry and is not that. Say so in the file header, the way `music.ts` already
does, so the next reader does not think the rule was forgotten.

Four stems, all 60 s, all rendered by an extended `tools/render-ambient-bed.py`,
all sharing one tempo and key so any subset sounds intentional together:

| Stem | Enters when | Character |
|---|---|---|
| `bed` | always | the current drone, unchanged |
| `tension` | any outpost threatened | slow pulse, a fifth above |
| `combat` | hostiles within engagement range | rhythmic low element |
| `alarm` | any outpost below `OUTPOST_CRITICAL_INTEGRITY` | dissonant high element |

**The threat metric drives the crossfade** and must be computed from world state
the director already reads: threatened outpost count, minimum outpost integrity,
live enemy count, distance to the nearest hostile. Smooth it with the existing
`damp()` from `src/game/physics/springs.ts` — a stem that snaps in and out on a
single kill is worse than no adaptation. Target a 2–4 s crossfade.

**Every stem must remain periodic over 60 s** by the same frequency-domain
construction. If you add a component that is not an integer multiple of 1/60 Hz,
it will click at the wrap, forty times a run.

**All four stems must decode or none play.** Partial layers are worse than the
bed alone. Fall back to the current single-file behaviour if any fails, exactly
as `music.ts` falls back to silence today.

Budget: **≤ 1.2 MB total** for all four in Opus, lazily fetched after first
interaction.

---

## 3. Workstream 2 — space

The mix is dry. Everything sounds like it is in the room with you, on a body with
no atmosphere, which is technically defensible and dramatically inert.

- **A convolution reverb send** on the SFX bus. Generate the impulse response
  in-process — exponentially-decaying filtered noise is enough, and it means no
  asset and nothing for the CSP to object to. Short and metallic: this is a
  cockpit, not a cathedral. ~0.4 s decay.
- **Send level by context**, not globally: near-field sounds (the player's own
  gun) stay dry, distant ones get more send. `isNearField()` in `spatial.ts`
  already makes that distinction for panning; reuse it rather than inventing a
  second notion of "close".
- **Doppler on enemy passes.** `PannerNode` supports it natively via velocity,
  but the Web Audio velocity API is deprecated — compute the pitch shift yourself
  from closing speed and apply it to the voice's `playbackRate`. An Interceptor
  crossing your nose at 30 u/s should be audible as a *pass*, which is the one
  cue that tells a player something went behind them without a glance.

---

## 4. Workstream 3 — the engine

`ENGINE_BASE_HZ = 46`, `ENGINE_TOP_HZ = 132`, one oscillator plus filtered noise.
It reads as a hum that changes pitch.

- **Multiple detuned oscillators** with independent, slow LFOs, so the tone has
  beating in it rather than being a pure interval.
- **Load-dependent timbre**, not just pitch: opening the filter and adding a
  harmonic under boost is what makes acceleration *feel* like effort. The craft
  now has a real brake and a real boost, and the difference between 0.3 throttle
  and 1.0 should be audible without looking at the speed readout.
- **Strafe thrusters.** The main session is adding a lateral translation axis.
  It needs its own short, dry, directional sound — left or right — and this is
  the one new event you will need to coordinate on. The world will emit a
  `GameEvent` for it; ask the main session for the constant name rather than
  guessing.

---

## 5. Workstream 4 — captions

`AudioDirector`'s header claims, row by row, that every audio cue has a visual
channel carrying the same fact, and that a muted player "loses convenience and
atmosphere and no information at all".

That claim is currently **argued** rather than **verified**. Make it verifiable:

- A caption channel emitting short text for every sound the director produces —
  `[Interceptor closing, left]`, `[Outpost integrity critical]`.
- Off by default, toggled in Settings → Accessibility. **The main session owns
  Settings**, so expose a clean API (`onCaption: (text: string) => void`) and
  they will wire the toggle and the display surface.
- The real value is as a test: with captions on, play a run muted and confirm
  every caption's fact is already on screen. Any caption that is *news* is a
  §27.4 violation and a bug to file, not to fix in this layer.

---

## 6. Constraints

- **`update()` allocates nothing.** No object literals, no array literals, no
  closures, no `.forEach`, indexed `for` only. It runs every frame.
- **Never call `world.events.clear()`.** The simulation loop drains the queue
  once every consumer has read it; an audio layer that cleared it would starve
  the HUD and the particle system of the same frame's events.
- **Never mutate `World`.** Read only.
- **CSP is `default-src 'self'`** — no CDN, no remote audio, no `eval`.
- **Audio must never be required.** Every failure path is silence plus a `debug`
  line, never a throw and never an unhandled rejection. A blocked `AudioContext`,
  a failed decode, a missing file: the game plays.
- **First interaction unlocks the context.** Already handled in `App.tsx`; do not
  add a second unlock path.

---

## 7. What you must not touch

`src/game/**`, `src/platform/**`, `src/state/**`, `src/ui/**`, `src/render/**`,
`api/**`, `docs/gameplan.md`.

You will want a Settings toggle for captions and for the adaptive-music
intensity. **Do not add them.** Expose the API, list what you need in your
report, and the main session wires it.

---

## 8. Verification

```bash
npx tsc --noEmit                 # zero
npx eslint . --max-warnings 0    # zero
npx vitest run                   # 149 passing
npx vite build                   # zero warnings
npx playwright test              # 26 passing
```

Audio-specific, and none of these is optional:

- **Loop test**: decode each stem, compare the last 512 samples to the first 512.
  The discontinuity must stay in the same order as the current bed's 0.0025.
- **Soak**: 5 minutes of play, assert no voice-pool exhaustion and flat heap. A
  leaking voice pool presents as sounds silently stopping after ten minutes,
  which is nearly impossible to diagnose from a bug report.
- **Muted play**: a full wave with the master at zero. Nothing about the run may
  be harder to understand.
- **Adaptive sweep**: script a run from calm to critical and back, and confirm
  the stem mix moves smoothly and returns. Listen for the crossfade, not for the
  transition.
- **Failure paths**: rename the audio directory and play a wave. Silence, one
  debug line, no console error, no throw.

Report the stem sizes and the measured loop discontinuity in your summary.
