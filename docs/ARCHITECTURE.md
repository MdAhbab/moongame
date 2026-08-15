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

This is why the simulation can run in Node, why 149 tests exercise it headlessly,
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

May import from `src/game/core/`, `src/game/data/` and `src/game/math/`. May
**not** import from `src/game/systems/` — lint-enforced. Reading
`world.craft.position` is correct; writing it is a bug.

Every geometry, material and texture passes through `src/render/disposal.ts` and
is released on teardown.

### `src/audio/**` — the audio director

The audio counterpart of the render bridge: world state and the event queue in,
sound out. Reads, never mutates — and in particular **never calls
`events.clear()`**, because the simulation drains that queue once every consumer
has read it.

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

The lesson is written into the test strategy: **e2e tests drive the built game in
a real browser and assert on observable state** — instrument readings, visible
buttons, `localStorage` — rather than on which functions were called.

---

## Layout

```
src/
├── game/          simulation — headless, deterministic, no framework
│   ├── core/      World, Simulation, Loop, Pool, Random, step, readModel
│   ├── systems/   flight, AI, collision, spawn, weapons, drain, score, HUD
│   ├── entities/  per-archetype spawn and behaviour
│   ├── physics/   integration, drag, gravity, springs, tangent frame, collision
│   ├── math/      vec3, spherical
│   └── data/      every tuning constant, waves, enemies, parts, worlds, skins
├── platform/      keyboard, pointer, trackpad, gamepad, touch → sampleInput
├── render/        R3F scene, one useFrame, instanced pools, disposal registry
├── audio/         graph, director, synth voices, spatialisation, music
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
