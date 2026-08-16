# Architecture

> The layer map, the rules that hold it together, and why each rule exists.
> `docs/gameplan.md` is the design source of truth; this describes the shape of
> the code that implements it.

---

## The one-paragraph version

A **deterministic, framework-free simulation** runs on a fixed 120 Hz timestep in
plain objects and typed arrays. Around it sit four adapters that may read it and
must never own it: a renderer, an audio director, an input layer and a React
shell. React learns about the world through two narrow channels — DOM refs at
frame rate and a throttled 10 Hz store sync — and never re-renders during play.

Everything else follows from that.

---

## The layers

```
                     ┌─────────────────────────────────────────┐
                     │  src/game/**   THE SIMULATION            │
                     │  no React · no three · no DOM · no clock │
                     │  fixed 120 Hz · seeded · headless        │
                     └──────────────────┬──────────────────────┘
                       reads            │            reads
        ┌─────────────────┬─────────────┼─────────────┬─────────────────┐
        ▼                 ▼             ▼             ▼                 ▼
  src/render/**    src/audio/**   src/platform/**  src/state/**    api/** (server)
  three · R3F      Web Audio      DOM input        zustand +       replays it to
  one useFrame     one director   device profiles  localStorage    verify a score
        │                 │             │             │
        └─────────────────┴──────┬──────┴─────────────┘
                                 ▼
                          src/ui/**  React
                          screens · HUD · a11y
```

### `src/game/**` — the simulation

Owns all game state. Knows nothing about how it is displayed, heard, controlled
or persisted.

- **No `import` of React, three, zustand, `window` or `document`** — enforced by
  `no-restricted-imports` / `no-restricted-globals` in `eslint.config.js`, not by
  convention.
- **No wall-clock reads.** Every function takes `dt`. Nothing counts frames.
- **No `Math.random()`.** One seeded `Random` per world, reseeded per wave from
  the run seed, so wave *N* is reproducible regardless of how wave *N−1* went.
- **No allocation in the frame path.** Structure-of-arrays over typed arrays,
  pooled entities, module-scoped scratch vectors.

This is why the simulation can run in Node, why 327 tests exercise it headlessly,
and why a server can replay a run to verify a leaderboard score.

### `src/platform/**` — device input

Everything built out of DOM APIs: keyboard, mouse, trackpad, pointer lock,
gamepad, touch. Lives outside `src/game/` for the same structural reason
`src/audio/` does — the simulation must run headless.

The contract is **one function pointer**: `Simulation.sampleInput`, invoked at the
head of *every fixed step*, not once per frame. That distinction is not
cosmetic — sampling per frame means a 60 Hz and a 144 Hz machine feed the world
different input histories over the same ten seconds, and determinism becomes
impossible no matter how correct the physics is.

Four sources — keyboard, pointer, gamepad, touch — are **combined, not ranked**.
Axes sum and clamp; buttons OR.

### `src/render/**` — the renderer

R3F over three. **Exactly one `useFrame` in the whole tree**, in
`RenderBridge.tsx`. It advances the simulation, writes every instance buffer, and
calls back into the shell. A second `useFrame` or a stray `requestAnimationFrame`
is two clocks, which is a named failure mode.

That sentence was aspirational until August 2026 — `Sun.tsx` owned a second one
the whole time (see below). It is now literally true, and everything else that
needs per-frame work is **driven imperatively from the bridge**: the camera rig,
the sun, the moon's LOD and post-processing are stepped through an `update()` or
through refs the bridge writes, and hold no hooks of their own. A file under
`src/render/` that imports `useFrame` is the bug, not the exception — and
nothing asserts that, which is why it was false for months.

May import from `src/game/core/`, `src/game/data/` and `src/game/math/`. May
**not** import from `src/game/systems/` — lint-enforced, including relative
paths. Presentation reads published view state from `src/game/core/view.ts`
(`Aim`, `sentinelShieldNormal`) rather than the systems that write it. Reading
`world.craft.position` is correct; writing it is a bug.

The Canvas stays mounted across screens, so `disposeAll()` is not the whole of
Rule 4. World swaps and quality-tier changes must `registry.release()` the
previous geometry, texture and light. A test in `tests/unit/renderInvariants.test.ts`
asserts there is still exactly one `useFrame(` under `src/render/`.

Post-processing is bloom and vignette only (§17.5). Volumetric god-rays were
tried and removed: the moon has no atmosphere, and a 60-sample occlusion pass
was the dominant High-tier cost.

The directional light's shadow frustum is recentred on the craft each frame
from that same `useFrame`.

### `src/audio/**` — the audio director

The audio counterpart of the render bridge: world state and the event queue in,
sound out. Reads, never mutates — and in particular **never calls
`events.clear()`**, because the simulation drains that queue once every consumer
has read it.

`update(world, dt, live)` takes the shell's `stepping` flag, **not the phase**.
Two different questions hide in "is the player flying": *is this a run*, which
`world.phase` can answer, and *is the world moving*, which it cannot. Conflating
them shipped: the frame callback runs on every screen that mounts the canvas, so
on WaveClear, Paused, Debrief and Results the continuous voices went on reading a
frozen craft — an engine roar held at the last cruise velocity, a lock droning on
one pitch mid-acquisition, the alarm stem pinned because integrity had stopped
falling. Nothing decayed because nothing was moving to decay it. A frozen world
now gets silence from every state-driven voice. `reset()` runs on Title, which is
where a run is actually torn down.

The four UI sounds reach the director through `uiBus.ts` — a module-level slot
armed once from the shared `Button`, deliberately not a React context, because
`Button` also renders inside the HUD and a context read is a subscription, which
invariant 1 forbids outright.

**The game is fully playable muted.** `AudioDirector.ts`'s header carries a
row-by-row proof: every sound names the visual channel carrying the same fact.
Audio is always the second channel.

### `src/state/**` — meta state and persistence

zustand holds **meta state only** — which screen, which wave, the run summary.
Never simulation state. `persistence.ts` owns a versioned, schema-validated
`localStorage` payload whose parsers are *total*: every field either validates or
falls back, so a partially corrupt save loses only the corrupt fields. A schema
bump is a migration, never a reset.

### `src/ui/**` — React

Screens and the HUD. Subscribes to the screen and almost nothing else.

### `api/**` — the server

Vercel Functions on the same origin, so `connect-src 'self'` in `vercel.json`
already permits them. Imports `src/game/**` read-only to replay submitted runs,
and reuses `persistence.ts`'s validators rather than writing a second copy.

---

## The invariants

Five rules. Each was learned from a specific failure, and each is checked
mechanically rather than trusted.

### 1. Zero React re-renders during `Playing`

Per-frame values go to pre-allocated buffers and then straight to DOM nodes
through refs (`src/state/hudRefs.ts`). Event-driven values reach zustand at
**≤ 10 Hz**. Nothing in the frame callback calls `setState`.

*Why:* the HUD has a hull gauge, a heat gauge, an altitude ladder, a speed
readout, a combo meter and up to 32 threat markers. Routing those through React
at 60 Hz re-renders the tree sixty times a second to move some text.

**The boundary is the canvas, not the phase.** `WaveClearScreen` sat outside
`Playing` and ran five concurrent rAF loops, each calling `setState` per tick —
roughly three hundred renders a second, over a scene still drawing at full DPR
behind a translucent overlay. That is the "it crashes between waves" report: the
tab had no idle time left to service input. One driver writes those counters
straight to DOM nodes now, exactly as `hudRefs` does.

### 2. Fixed timestep, interpolated render

`FIXED_DT = 1/120` with an accumulator; the renderer lerps by `alpha`.

*Why:* V1 did `speed += ACCELERATION` per frame, so a 144 Hz display ran the game
2.4× faster than a 60 Hz one. Reading the live position instead of interpolating
discards up to 8.3 ms of motion per frame and reads as judder.

### 3. No allocation in the hot path

No `new`, no object or array literals, no closures, no `.forEach` in anything
called per frame.

*Why:* V1 allocated per bullet and per particle and disposed nothing. Verified
now by a 60-second soak asserting flat heap.

### 4. Dispose everything

*Why:* same failure. `scene.remove()` without `dispose()` leaks the GPU
resource, silently, until the tab dies.

### 5. Determinism

Same seed plus same inputs equals same state, asserted at 10,000 steps.

*Why:* it makes runs shareable, bugs reproducible from a seed, balance testable
by a scripted player — and it is the entire security model of a leaderboard that
cannot be forged.

---

## Where the bodies are buried

Composition bugs, not unit bugs, have caused nearly every serious defect here.
Each of these passed every unit test in the repository:

- **The renderer owned a private `Loop`** and called `stepWorld` directly,
  bypassing `Simulation` and therefore `sampleInput`. The world drained, spawned,
  scored and rendered perfectly while ignoring every control the player touched.
- **Three components each registered a global Escape handler.** They fired on one
  keystroke, each reading what the previous had just written: pause opened, then
  the shell saw a menu and closed it. The pause menu was unreachable for an
  entire run.
- **Abort navigated to a screen that renders from a summary nothing had
  written**, so it rendered `null` — a transparent, buttonless overlay over a
  live game, on a screen with no history to unwind.
- **`startRun` was gated on `wave.number === 0`**, true once per page load, so a
  session was worth exactly one run.
- **`CameraRig.tsx` hardcoded every camera constant**, so seven values in
  `constants.ts` were read by nothing and tuning them did nothing.
- **`Sun.tsx` owned the second `useFrame`** — for as long as the rule against a
  second `useFrame` had been written down. It wrote `uTime` from
  `clock.getElapsedTime()` while the bridge wrote the *same two uniforms* from
  `world.time`: two loops, two time bases, one value, and whichever subscriber
  R3F happened to invoke last won the frame. The clocks are not merely
  duplicates — one is wall-clock and monotonic from context creation, the other
  advances only while the world steps and resets with a run — so the corona
  sampled its noise field across two unrelated timelines and jumped by minutes
  the moment a run began. There is still no lint rule and no test that counts
  them: a rule stated only in prose is a rule that can be false for months.
- **Thirty ship parts shipped with no price.** `Part` carried an optional
  `cost?: number` and not one of the thirty set it, so `part.cost ?? 0` was zero
  everywhere, `!part.cost` was always true, every part read as owned,
  `spendCredits(0)` always succeeded, and the Hangar's purchase branch was
  unreachable code guarding a free transaction. Credits were earned correctly for
  twelve waves against a price list that did not exist. The field is gone;
  `partCost(part)` derives the price from `unlockLevel`, because an optional
  field is an invitation to forget it and thirty declarations are thirty chances
  to.
- **Three finished features that nothing called.** `AudioDirector.reset()`
  promised in its own docstring to run on "run restarts and hard screen changes";
  `uiClick`/`uiHover`/`uiConfirm`/`uiBack` were implemented in `synth.ts` and
  exposed on the director, so every button in the game was silent; and the render
  bridge passed a hardcoded `false` for reduced motion under a comment reading
  "reducedMotion flag would come from settings", disabling the one setting that
  exists to suppress trauma shake. Each piece was correct in isolation. Nothing
  tests for a call site that does not exist.

The lesson is written into the test strategy: **e2e tests drive the built game in
a real browser and assert on observable state** — instrument readings, visible
buttons, `localStorage` — rather than on which functions were called.

---

## Layout

```
src/
├── game/          simulation — headless, deterministic, no framework
│   ├── core/      World, Simulation, Loop, Pool, Random, step, readModel, view
│   ├── systems/   flight, AI, collision, spawn, weapons, drain, score, HUD
│   ├── entities/  six hostile archetypes — spawn and behaviour, one file each
│   ├── physics/   integration, drag, gravity, springs, tangent frame, collision
│   ├── math/      vec3, spherical
│   └── data/      every tuning constant, waves, enemies, parts, worlds, skins
├── platform/      keyboard, pointer, trackpad, gamepad, touch → sampleInput
├── render/        R3F scene, one useFrame, instanced pools, disposal registry
├── audio/         graph, director, synth voices, spatialisation, music, UI bus
├── state/         zustand meta state, hudRefs, versioned persistence
├── ui/            screens, HUD components, accessibility
├── workers/       terrain baking, off the main thread
└── styles/        design tokens

api/               Vercel Functions: auth, save, score verification
db/                Drizzle schema and migrations
tools/             offline asset generation (audio rendering)
tests/
├── unit/          pure functions and invariants
├── integration/   the simulation with a scripted player
└── e2e/           the built game in a real browser
docs/              gameplan, this file, controls, per-track task briefs
```

---

## Reading order for a new contributor

1. `docs/gameplan.md` §7 (Mechanics), §17.2 (the re-render rule), §22 (physics).
2. `src/game/data/constants.ts` — every number the game feels like.
3. `src/game/core/World.ts` — all state, in one file.
4. `src/game/systems/FlightSystem.ts` — the model everything else orbits.
5. `src/render/RenderBridge.tsx` — the single frame callback.
6. `src/platform/deviceInput.ts` — how a keypress becomes a force.
