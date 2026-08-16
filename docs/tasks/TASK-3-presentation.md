# TASK 3 — Presentation: shaders, celestial bodies, models, image-based lighting

**Owner:** you (agent, Antigravity IDE)
**Scope:** `src/render/**`, `src/workers/**`, `public/models/**`, `public/hdri/**`, `public/textures/**` — **nothing else**
**Repo root:** `moon-game-v2/`
**Runs in parallel with:** TASK-4 (audio), TASK-5 (backend), and the main session (simulation, input, UI)
**Status: landed, with drift (August 2026).**

The five workstreams mostly shipped: GLSL sun, planet/atmosphere/rings, craft
glTF, HDRI environment. God-rays were tried and then removed — §17.5 forbids
them (the moon has no atmosphere) and they dominated High-tier frame time.
Triplanar close-up terrain and the six-world catalogue remain open. Read the
source, not this brief, for what the layer does today.

---

## 0. Read these first, in this order

1. `docs/gameplan.md` §15 (Art Direction), §16 (Lighting), **§17 (Rendering
   Architecture — §17.2 is the single most important constraint in this project)**,
   §24 (Camera), §25 (Motion), §26 (Particles), §34 (Performance Budget), §35.1
   (why silhouettes carry threat identity).
2. `docs/tasks/TASK-1-render-layer.md` — the brief this layer was originally
   built under. Marked superseded, and still the best statement of the
   constraints. §2 and §3 of it apply to you unchanged.
3. `src/render/RenderBridge.tsx` — the one `useFrame`. Read it completely before
   you touch anything.
4. `src/render/disposal.ts` — every resource you create passes through this.
5. `docs/ARCHITECTURE.md` — the layer map and the five invariants, each with the
   failure it was learned from.
6. `src/game/data/worlds.ts` — the world definitions and their palettes. This
   file belongs to the **main session**; you read it, you never edit it.

`gameplan.md` is the source of truth. Where this brief and the gameplan disagree,
**raise it** rather than silently choosing.

---

## 1. What you are building

The game currently looks like a competent prototype. Your job is to make it look
like a product, without touching a line of simulation code and without breaking
the three invariants that make it run at all.

Five workstreams, in the order they pay off:

1. **A real sun** — GLSL, not a coloured sphere.
2. **Real planets** — atmospheric scattering, night lights, rings.
3. **Real models** — CC0 glTF for the craft and the three enemy archetypes.
4. **Image-based lighting** — HDRI environment, so metal reflects a place.
5. **Terrain detail** — triplanar close-up detail and LOD.

---

## 2. Non-negotiable constraints

These are build-failing acceptance criteria (§42). Every one of them has been
violated at some point in this project's history and each violation cost a day.

### 2.1 Zero React re-renders during `Playing` (§17.2)

Zero `setState` reachable from `useFrame`. Not throttled — **zero**. Exactly one
`useFrame` in the entire tree, and it already exists in `RenderBridge.tsx`. Do
not add a second, and do not start your own `requestAnimationFrame`.

A shader that needs a uniform updated per frame gets it written imperatively from
the existing `useFrame`, via a ref to the material. Never via a prop.

### 2.2 Zero allocation in the hot path (Rule 3)

No `new`, no object literals, no array literals, no closures in anything called
per frame. Pre-allocate every `Vector3`/`Matrix4`/`Color` at module scope or in a
one-shot `useMemo`. No `.forEach` in the frame path — it allocates a closure.

Verified by a 60-second soak that asserts flat heap. It currently passes at
**0.0 MB growth**; you must keep it there.

### 2.3 Dispose everything (Rule 4)

Every geometry, material, texture, render target and **loaded glTF** passes
through `registry.track()` in `src/render/disposal.ts`. glTF is the new hazard
here: `GLTFLoader` produces a scene graph whose geometries and materials are
*not* disposed by removing the group. Walk it and track each one.

### 2.4 You may read simulation state, never mutate it (§30.2)

`src/render/**` may import from `src/game/core/`, `src/game/data/` and
`src/game/math/`. It may **not** import from `src/game/systems/` — lint-enforced.

### 2.5 Interpolate by `alpha` (§18.2)

Every transform is the lerp between the previous and current position by the
`alpha` the bridge computes. Reading the live position discards up to 8.3 ms of
motion per frame and reads as judder at speed.

### 2.6 The Content Security Policy is `default-src 'self'`

See `vercel.json`. **No CDN, no external fetch, no remote textures, no
`eval`, no `new Function`.** Every asset is downloaded once, vetted, committed to
`public/`, and served same-origin. A shader compiled from a string is fine; a
shader fetched from a URL is not.

### 2.7 Budgets — measure, do not assume (Rule 11)

| Metric | Budget | Where it stands now |
|---|---|---|
| Draw calls | ≤ 120 | 30–31 |
| Frame time p95 | ≤ 33 ms | 17.1 ms |
| Heap growth over 60 s | 0 MB | 0.0 MB |
| Initial JS chunk | ≤ 400 KB gz | 68 KB (three is a separate 190 KB chunk) |

You have real headroom. Spend it deliberately and re-measure after each
workstream — `tests/e2e/smoke.spec.ts` prints all four.

---

## 3. Workstream 1 — the sun

`src/render/scene/Sun.tsx` is currently a white sphere, two additive corona
sprites and two stretched sprites for diffraction spikes. It is better than it
was and it is still a billboard trick.

Build a real one:

- **Limb darkening.** A star is measurably dimmer at its edge —
  `I(μ) = I₀(1 − u(1 − μ))` with `u ≈ 0.6`, where `μ` is the cosine of the angle
  between the surface normal and the view. This single term is most of what makes
  a rendered sun stop looking like a disc.
- **Granulation.** Animated 3D simplex noise on the photosphere, low amplitude,
  slow. Use the `simplex-noise` package that is already a dependency, or port the
  noise into GLSL — do not add a new dependency for it.
- **Corona.** Radial falloff in a fragment shader on a backside shell, with
  angular variation so it is not a perfect circle.
- **Godrays.** Screen-space radial blur from the sun's projected position, as a
  post pass in `src/render/effects/PostProcessing.tsx`. **Gate it on tier** —
  `High` only — and skip the pass entirely when the sun is off-screen, which is
  most of the time on a sphere.

The palette's `sun` colour is per-world and comes from `worlds.ts`. Read it;
don't hardcode.

---

## 4. Workstream 2 — the planets

`src/render/scene/Earth.tsx` draws the primary and a companion moon. The
terminator is now real (the emissive term that was erasing it is gone) and the
surface is a 256×128 canvas texture. Replace both with shaders.

- **Atmospheric scattering.** A Rayleigh + Mie approximation is enough — you do
  not need a full precomputed transmittance LUT for a body this size on screen.
  What must be right is that the atmosphere is **brightest on the sunlit limb**
  and fades around the terminator, because a uniformly glowing shell reads as a
  second, larger planet in front of the first. That was the previous bug.
- **Night side.** City lights on Earth-like primaries, keyed to the same
  procedural surface map so lights sit on land. Emissive, and only where
  `dot(normal, sunDir) < 0`.
- **Rings** for the gas-giant world: annulus geometry, radial-banded alpha,
  and a shadow term where the planet occludes the ring. The ring shadow on the
  planet is worth the extra line — it is the detail that sells rings.
- **Terminator softness** should differ by body: an airless moon has a knife-edge
  terminator, a body with atmosphere has a gradient. Drive it from a
  `hasAtmosphere` flag you read from the palette.

**Six worlds.** The main session owns `src/game/data/worlds.ts` and will extend
it from three to six with these identities:

| id | Primary in the sky | Notes for you |
|---|---|---|
| `mare-noctis` | Earth-like | the reference. Do not change how it reads. |
| `thule` | Blue-white gas giant, 2.5× | ice world, high albedo terrain |
| `ashfall` | Close, angry red | volcanic, hazy, low star density |
| `cerberus` | **Ringed** gas giant | rings are the whole visual identity |
| `helios-gap` | **Binary** — two suns | two directional lights, two shadow terms |
| `veil` | Nebula-lit, no primary | the nebula *is* the light source |

Add palette fields as you need them and tell the main session the exact shape;
do not edit `worlds.ts` yourself. `helios-gap` is the one that needs a
conversation — `Lighting.tsx` currently has exactly four lights by design
(§16.1), and a second sun makes five.

---

## 5. Workstream 3 — models

Replace the primitive-built craft and enemies (`src/render/geometry/shapes.ts`)
with real glTF.

**Sources, in preference order.** All must be CC0 or CC-BY with attribution:

- [Kenney Space Kit](https://kenney.nl/assets/space-kit) — CC0, low-poly, ideal silhouettes
- [Quaternius Ultimate Space Kit](https://quaternius.com/) — CC0
- [Poly Haven](https://polyhaven.com/models) — CC0

**Pipeline:**

1. Download, inspect, and **record the licence in `docs/CREDITS-ASSETS.md`**
   before doing anything else. An asset whose licence is not written down is an
   asset that has to be removed later.
2. Compress with `gltf-transform` (meshopt + WebP textures). Target ≤ 150 KB per
   model.
3. Commit to `public/models/`. Load with `useGLTF` from `@react-three/drei`,
   which is already a dependency.
4. Track every geometry and material in the disposal registry (see §2.3).

**The constraint that overrides "prettier".** §35.1: the three enemy archetypes
are identified **by silhouette at 40 px in peripheral vision**, and colour is the
*second* channel, not the first:

- Harvester — squat hexagonal body, four legs
- Interceptor — narrow swept-back dart
- Sentinel — broad angular plate with a front-facing shield

A model that looks better and reads ambiguously at 40 px is a **regression**, and
it is a regression that hurts colour-blind players first. Test it: render all
three at 40 px, desaturated, and confirm you can still name them. If you cannot,
pick different models.

Enemies are drawn as `InstancedMesh`, one per archetype (§17.3). A glTF with
multiple materials cannot be instanced in one call — merge by material or pick
single-material models.

---

## 6. Workstream 4 — image-based lighting

- CC0 HDRIs from [Poly Haven](https://polyhaven.com/hdris) — space and studio
  categories.
- Convert to `.ktx2` or RGBE. **Budget ≤ 2 MB per environment**, and lazy-load it
  so it never blocks first paint.
- Wire as `scene.environment` via `PMREMGenerator`. The craft hull is the thing
  that benefits — it is metal and currently reflects a flat colour.
- **Keep the four-light rig (§16.1).** IBL supplements it; it does not replace
  it. The rim light in particular is a *gameplay* feature — half the playfield is
  unlit at any time and the drain clock does not stop at the terminator, so
  "cannot see the thing I am shooting" is a gameplay failure, not a look.

---

## 7. Workstream 5 — terrain detail

`src/workers/terrainWorker.ts` bakes albedo/normal/AO from simplex fBm into
textures on a single icosphere. It looks good from altitude and smears at
`ALT_MIN = 8`.

- **Triplanar detail** blended in by altitude — a high-frequency normal/roughness
  layer that only appears close to the ground. Triplanar rather than UV because
  the icosphere has no good UV parameterisation at the poles.
- **LOD**: the current mesh is uniform density. Tessellate under the craft, or
  use a second higher-density patch that follows it.
- Keep the worker's `terrain: {amplitude, frequency, craterDensity, ridged}`
  contract — the main session drives it per world.

---

## 8. What you must not touch

`src/game/**`, `src/platform/**`, `src/state/**`, `src/ui/**`, `src/audio/**`,
`api/**`, `tools/**`, `docs/gameplan.md`.

The main session is actively rewriting the input layer and the flight model in
these same hours. Two specific heads-ups:

- **`Craft` is gaining a `slip` field** — measured lateral velocity as a fraction of
  cruise. The nose already crabs and the bank already rolls into a slide; if you
  replace the craft model, keep both readable or translation stops being legible.
- **`CameraRig.tsx` has been rewritten by the main session** and now reads the
  seven constants it used to hardcode, plus a lateral-lag term that makes a
  strafe visible. It is in `src/render/effects/` — your territory — but treat it
  as settled: change it only for a reason you can state, and say so in your
  report.
- **The engine trail breaks on a teleport.** `RenderBridge` resets the ribbon
  when the craft moves further in one frame than flight can account for, because
  the craft jumps position on run start and on respawn and the trail was drawing
  that jump as a cyan column across the moon. Keep that check if you touch the
  trail.
- **The world is now stepped behind the menus** (`Attract` phase) so the Title
  screen flies itself. Anything you add to the scene runs there too.

---

## 9. Verification

Everything must stay green, every time:

```bash
npx tsc --noEmit                 # zero
npx eslint . --max-warnings 0    # zero
npx vitest run                   # 149 passing
npx vite build                   # zero warnings
npx playwright test              # 26 passing, and prints the budgets
```

Plus, by hand in a browser, and this is the part that actually matters:

- Fly all six worlds. Each must be recognisably a different place, not a recolour.
- Look at the sun directly, then away. Godrays must not persist off-screen.
- Watch the terminator from orbit on an atmosphere world and an airless one.
- Render the three enemies at 40 px, desaturated, and name them.
- Take a screenshot at `ALT_MIN` and confirm the ground has detail.

**Report the four budget numbers after every workstream**, not at the end. A
regression found three workstreams later costs three workstreams of bisecting.
