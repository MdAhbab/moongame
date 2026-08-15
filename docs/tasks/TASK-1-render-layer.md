# TASK 1 — The Render Layer

> **Status: completed and superseded (August 2026).**
>
> This brief was written to hand the layer to a separate agent, and that work
> landed. It is kept as a record of the constraints the layer was built under,
> not as a description of the code as it stands — several decisions here were
> revised afterwards, most notably the render bridge, which no longer owns a
> `Loop` and no longer calls `stepWorld` (see `src/render/RenderBridge.tsx` for
> why that was a bug). Read the source, not this, to find out what the layer
> does today.

---

**Owner:** you (Sonnet agent, Antigravity IDE)
**Scope:** `src/render/**` and `src/workers/terrainWorker.ts` — **nothing else**
**Repo root:** `moon-game-v2/`
**Corresponds to:** gameplan.md Phase 5 (§40), milestone M5

---

## 0. Read these first, in this order

1. `docs/gameplan.md` §16 (Lighting), §17 (Rendering Architecture — **§17.2 is the
   single most important constraint in the project**), §24 (Camera), §26 (Particles),
   §30.1–30.2 (directory structure and layer separation), §31.3 (the render bridge),
   §33.2–33.3 (asset pipeline), §34 (Performance Budget).
2. `src/game/core/World.ts` — the world you are rendering. Read it completely.
3. `src/game/data/constants.ts` — every tuning value. Import from here; never
   inline a number.
4. `docs/reference/ui-builder/src/game/GameScene.tsx` — a prior single-file
   attempt at this layer. **It is a reference, not a base.** Parts of it are good
   (see §7 below) and parts are wrong (see §8).

`gameplan.md` is the single source of truth. If this brief and the gameplan
disagree, **the gameplan wins** — raise the conflict rather than silently
choosing.

---

## 1. What you are building

The bridge between a headless simulation and the screen. The simulation is
already written and it does not know you exist: it has no React, no Three.js, no
DOM. Your job is to draw it, at 60 fps, inside a 120 draw-call budget, without
ever making React re-render.

You own the entire `src/render/` tree:

```
src/render/
├── Canvas.tsx                 R3F <Canvas> host, DPR + tier wiring, context-loss recovery
├── RenderBridge.tsx           the ONE useFrame that drives everything (§31.3)
├── disposal.ts                the resource registry (§34.2, Rule 4)
├── scene/
│   ├── Moon.tsx               icosphere + baked maps from the worker
│   ├── Starfield.tsx          Points, 8k vertices, seeded
│   ├── Sun.tsx                billboard + corona shell
│   ├── Earth.tsx              sphere + atmosphere shell
│   ├── Outposts.tsx           instanced by part type across all 8
│   ├── Boulders.tsx           InstancedMesh, 400 instances
│   ├── Craft.tsx              player craft, merged by material
│   └── Lighting.tsx           exactly four lights (§16.1)
├── instanced/
│   ├── EnemyInstances.tsx     one InstancedMesh per archetype
│   ├── ProjectileInstances.tsx
│   ├── MissileInstances.tsx
│   ├── ParticleInstances.tsx  camera-facing quads, one draw call
│   └── DrainBeams.tsx
├── effects/
│   ├── CameraRig.tsx          §24 — spring, look-ahead, speed FOV, trauma shake
│   └── PostProcessing.tsx     SelectiveBloom + Vignette only (§17.5)
├── materials/
│   └── registry.ts            shared material definitions, created once
└── geometry/
    ├── icosphere.ts           recursive subdivision
    └── shapes.ts              craft, enemies, outposts from primitives
```

Plus `src/workers/terrainWorker.ts`.

---

## 2. The hard constraints

These are not style preferences. Each one is a build-failing acceptance
criterion in §42.

### 2.1 React must never re-render during gameplay (§17.2)

- **Zero `setState` in any code path reachable from `useFrame`.** Not throttled,
  not debounced. Zero.
- **Exactly one `useFrame`** in the whole render tree, in `RenderBridge.tsx`. It
  drives the simulation and writes every instance buffer. Do not add a second
  one, and do not start your own `requestAnimationFrame` loop — two clocks is a
  named failure mode (§25.3).
- R3F declares the *static* scene: moon, lights, outposts, camera rig, post
  stack. Those mount once and never re-render.
- All dynamic, high-count entities are imperative pools writing into
  `InstancedMesh` via refs.

An automated test asserts zero component re-renders during 10 s of `Playing`.

### 2.2 Zero allocation in the hot path (Rule 3)

No `new`, no object literals, no array literals, no closures inside anything
called every frame.

- Pre-allocate every `Vector3`, `Quaternion`, `Matrix4`, `Color` at module scope
  or in a `useMemo` that runs once, and reuse them.
- `Object3D` used as a matrix-composition dummy: one instance, reused.
- No `.forEach` in the frame path — it allocates a closure. Use indexed `for`.
- Mark hot functions `/** @hot-path */`.

Target: **zero heap growth during play**, verified by a 5-minute soak
(§34.1). V1 leaked continuously because it allocated per-bullet and per-particle
and disposed nothing. That is the specific failure being engineered out.

### 2.3 Dispose everything (Rule 4)

Every geometry, material, texture and render target is owned by
`src/render/disposal.ts` and released on teardown. **Never call `scene.remove()`
without disposing what you removed.**

Write `disposal.ts` first. Signature to implement:

```ts
export class ResourceRegistry {
  track<T extends { dispose(): void }>(resource: T): T
  disposeAll(): void
  get size(): number   // for the leak test
}
```

Every `new THREE.BufferGeometry()`, `new THREE.Material()`, `new THREE.Texture()`
in your code passes through `track()`. A test asserts `size === 0` after
unmount. V1's total absence of disposal is documented in §2.2 — do not reproduce
it.

### 2.4 The render layer may read simulation state, never mutate it (§30.2)

`src/render/**` may import from `src/game/core/`, `src/game/data/` and
`src/game/math/`. It may **not** import from `src/game/systems/` — that
restriction is lint-enforced. Reading `world.craft.position` is correct; writing
it is a bug.

### 2.5 Fixed timestep and interpolation (§18.2)

`RenderBridge` owns the `Loop` (already written, `src/game/core/Loop.ts`) and
calls it with the frame delta:

```ts
const alpha = loop.advance(delta, (dt) => stepWorld(world, dt))
```

`alpha` is the interpolation factor. **Every transform you write must be the
lerp between `prevX/prevY/prevZ` and `x/y/z` by `alpha`** — `BodyStore` already
stores both. Reading the live position instead discards up to 8.3 ms of motion
per frame on a 60 Hz display and reads as judder at speed.

Any per-frame smoothing you write uses the exact form (§21.4, Rule 5):

```ts
// WRONG — framerate dependent, this is V1's bug class
x += (target - x) * 0.05
// RIGHT — exact at any dt
x = target + (x - target) * Math.exp(-lambda * dt)
```

Helpers already exist in `src/game/physics/springs.ts` (`damp`, `dampVec3`,
`dampAngle`). Use them.

---

## 3. The budgets — you must measure, not assume (Rule 11)

### Draw calls, §17.3 — total **≤ 120**, target ≈ 39

| Group | Calls | Technique |
|---|---|---|
| Moon | 1 | single icosphere, baked maps |
| Star field | 1 | `Points`, 8k vertices |
| Sun + corona | 2 | billboard + shell |
| Earth | 2 | sphere + atmosphere shell |
| Boulders | 1 | `InstancedMesh`, 400 instances |
| Outposts | 3 | **instanced by part type across all 8** |
| Landing pads | 1 | `InstancedMesh` |
| Player craft | 3 | **merged by material** |
| Enemies | 3 | one `InstancedMesh` per archetype |
| Player projectiles | 1 | instanced |
| Enemy projectiles | 1 | instanced |
| Missiles + trails | 2 | instanced |
| Debris/particles | 1 | instanced |
| Drain beams | 1 | instanced |
| Shadow pass | ~10 | |
| Post-processing | ~6 | bloom mips + composite |

The prior attempt used **40 draw calls for the 8 outposts alone** by building
each one as 5 separate meshes with per-outpost materials. Instance by part type.

### Triangles, §17.4 — total ≤ 350k, target ≈ 159k

| Element | Triangles |
|---|---|
| Moon icosphere (subdiv 6) | 81,920 |
| Boulders (400 × 44) | 17,600 |
| Outposts (8 × ~2,000) | 16,000 |
| Player craft | ~4,000 |
| Enemies (48 × ~600) | 28,800 |
| Projectiles/debris (quads) | ~2,600 |
| Earth + sun | ~8,000 |

**Warning, verified against three@0.185.1:** `IcosahedronGeometry(R, detail)`
produces `20 × (detail+1)²` triangles, **not** `20 × 4^detail`. `detail: 5`
gives **720 triangles**, not 82k. The prior attempt used `detail: 5` and its
craters were below mesh resolution. Write your own recursive subdivider in
`geometry/icosphere.ts` — subdivision level 6 = 20 × 4⁶ = 81,920 triangles — and
unit-test the triangle count.

Projectiles must be **camera-facing quads**, not spheres. The prior attempt used
`SphereGeometry(0.7, 8, 8)` × 256 = 28,672 triangles for bullets alone.

### Frame budget, §34.1

| Metric | Desktop 1080p | Mobile |
|---|---|---|
| Frame rate | 60 fps sustained | 30–60 fps |
| GPU | ≤ 10 ms | ≤ 20 ms |
| Draw calls | ≤ 120 | ≤ 60 |
| Texture memory | ≤ 48 MB | ≤ 24 MB |

Report `renderer.info.render.calls` and `renderer.info.render.triangles` from
the dev overlay. **Never claim a target is met without showing the number.**

---

## 4. Subsystem specifics

### 4.1 The terrain worker (§33.2) — build this early

At Boot, a worker generates three **1024×512** equirectangular maps from seeded
noise plus an explicit crater list:

1. **Albedo** — regolith base with darker maria
2. **Normal** — craters, ridges, fine roughness
3. **AO** — crater interiors and structural shadowing

Budget ~1.4 s on a mid-range device, off the main thread, transferred as
`ImageBitmap` (zero-copy).

**The Loading screen's honesty depends on you.** It must report *genuine*
progress from real stage callbacks, not a fake timer. Post progress messages as
you complete real work:

```ts
type TerrainProgress =
  | { type: 'progress'; stage: 'albedo' | 'normal' | 'ao'; fraction: number }
  | { type: 'done'; albedo: ImageBitmap; normal: ImageBitmap; ao: ImageBitmap }
  | { type: 'error'; message: string }
```

Use the seeded PRNG from `src/game/core/Random.ts` — the worker may import it,
because it is pure. **Do not use `Math.random()`**; terrain must be reproducible
from the run seed. Low tier bakes at 512×256 (§43 R8).

Craters are **baked into the normal map, not geometry** — this alone removes
~1,400 of V1's draw calls.

### 4.2 Lighting (§16.1) — exactly four lights

| Light | Type | Intensity | Purpose |
|---|---|---|---|
| Sun | Directional | 4.5 | key, sharp shadows, near-white slightly warm |
| Earthshine | Hemisphere | 0.35 | night-side fill, cool blue |
| Ambient | Ambient | **0.04** | prevents pure black crush only |
| Craft | SpotLight | 1.2 | forward-facing, on the craft |

**Four. Not five.** V1 had two ambient lights fighting each other plus a
`PointLight` per bullet, which forced continuous shader recompiles. Do not add a
`PointLight` per anything.

Shadows: one shadow-casting light (Sun), 2048×2048 on a **tight orthographic
frustum that follows the player**, covering ~180 u. V1's frustum spanned the
whole moon, so resolution was spread too thin to see. Low tier: shadows off,
replaced by a projected blob shadow under the craft.

### 4.3 Night-side readability (§16.3) — the R4 risk

All gameplay-critical entities are **emissive**: enemies, projectiles, outpost
beacons. They emit rather than reflect, so they read equally in blazing day and
total night. Terrain is *allowed* to go dark.

If emissive-only proves insufficient in playtest, add a **subtle rim light**.
**Do not raise ambient.** That is exactly what V1 did (`game.js:1067` appended
`scene.add(new THREE.AmbientLight(0xffffff, 0.5))` at the bottom of the file)
and it flattened the entire lighting scheme.

### 4.4 Camera (§24)

- Chase rig, base offset **22 u back, 7 u up** in craft-local space.
- Position: critically damped spring, **ω_n = 6 rad/s** — use `dampVec3`.
- Look-ahead: aim point leads the craft by `v · 0.15 s` — *velocity-scaled*, not
  a constant offset.
- Speed FOV: **62° at rest → 74° at boost**, eased.
- Roll: follows craft bank at **40%** magnitude.
- **Up vector is always the local `û`.** This is what keeps spherical flight
  from being nauseating.

Shake, §24.3 — additive decaying trauma:

```
trauma  ← clamp(trauma + amount, 0, 1)
shake    = trauma²                            squared: small hits barely register
offset   = shake · A · perlinNoise(t · f)     smooth noise, not random jitter
trauma  ← trauma · e^(−1.8·Δt)
```

`world.craft.trauma` is already maintained by the simulation — you read it and
apply the offset. Apply it as a **transient post-transform, never accumulated
into the rig's state**. V1 added random X offsets to `cameraOffset` and only
restored `.y` (`game.js:784`, `:903`), so the camera drifted permanently after
damage. Structuring it as a post-transform makes that bug impossible.

Use Perlin/simplex noise, not `Math.random()` — random gives a vibrating jitter,
noise gives smooth camera motion. Write a small 1D noise function; do not add a
dependency.

Disabled entirely under reduced motion, replaced by a brief edge flash (§35.3).

### 4.5 Post-processing (§17.5) — bloom and vignette, nothing else

- **SelectiveBloom** on emissive gameplay entities. Justified because
  emissive-equals-important is the core readability mechanism; bloom reinforces
  it and it is what sells the night side.
- **Vignette**, subtle, static.

Explicitly rejected, do not add: depth of field (blurs the distant threats
triage depends on), motion blur (same harm, plus nausea, plus it fights
reduced-motion), SSAO (invisible against near-black shadows), volumetric
god-rays (**the Moon has no atmosphere** — faking scattering contradicts the art
direction's own premise), chromatic aberration, film grain.

The game must remain fully playable with post off; Low tier proves it. Lazy-load
this chunk (`post` in `vite.config.ts` already splits it).

### 4.6 Quality tiers (§17.6)

| | High | Medium | Low |
|---|---|---|---|
| Moon subdivision | 6 (82k) | 5 (20k) | 5 (20k) |
| Shadows | 2048 | 1024 | off (blob) |
| Bloom | full | half-res | off |
| Boulders | 400 | 200 | 80 |
| Max particles | 1024 | 512 | 192 |
| DPR cap | 2.0 | 1.5 | 1.0 |

Detect at Boot from renderer string, `deviceMemory`, `hardwareConcurrency`, and
a 2-second startup frame-time probe. If measured frame time exceeds budget for 3
consecutive seconds, drop one tier and emit a non-blocking toast explaining why.
Expose tier via a callback prop; **do not** import the zustand store directly
from inside `useFrame`.

### 4.7 Materials (§16.4)

PBR throughout, created **once** during Loading so no shader compiles mid-game.

| Surface | Roughness | Metalness | Note |
|---|---|---|---|
| Regolith | 0.95 | 0.0 | near-Lambertian, correct for dust |
| Craft hull | 0.35 | 0.6 | |
| Enemies | 0.4 | — | strong emissive accents |
| Outposts | 0.25 | 0.8 | emissive windows are the "is this alive?" signal |

Normal maps come from the worker. **No roughness or metalness maps** — uniform
per-material values are sufficient at our scale and save memory and bandwidth.

### 4.8 WebGL context loss (§38.5)

Handle `webglcontextlost` / `webglcontextrestored` with automatic recovery and a
clear message. A hard-fail path renders a static "your browser doesn't support
WebGL2" page with specifics, never a blank canvas. There is **no WebGL1
fallback** — that is a deliberate scope decision (§43 R10).

---

## 5. The API you code against

Already written and stable. Do not modify these files.

```ts
// src/game/core/World.ts
import { createWorld, type World, EnemyKind, EnemyPhase } from '@/game/core/World'

world.craft.position          // Vec3 { x, y, z }
world.craft.previousPosition  // lerp between these two by alpha
world.craft.frame             // { up, forward, right } — orthonormal, rebuilt every step
world.craft.bank              // radians
world.craft.trauma            // 0..1

world.enemies.pool.dense      // Int32Array of live slot indices
world.enemies.pool.count      // how many are live
world.enemies.body.x[slot]    // Float64Array SoA — also .y .z .vx .vy .vz
world.enemies.body.prevX[slot]
world.enemies.kind[slot]      // EnemyKind.Harvester | Interceptor | Sentinel
world.enemies.phase[slot]     // EnemyPhase.Inbound | Landing | Draining | Pursuing | Guarding
world.enemies.headingX[slot]  // facing, for orienting the instance
world.enemies.shieldAngle[slot]

world.playerProjectiles       // ProjectileStore — .pool, .body, .life
world.enemyProjectiles
world.missiles                // .pool, .body, .life, .target
world.particles               // .pool, .body, .life, .maxLife, .size, .r, .g, .b

world.outposts                // Outpost[8] — .position .direction .integrity .status .drainers
world.events                  // EventQueue — read .count, then .type[i], .x[i] etc.
```

Iterate pools like this — indexed, no closures:

```ts
/** @hot-path */
const { pool, body } = world.enemies
for (let i = 0; i < pool.count; i++) {
  const slot = pool.dense[i] as number
  const x = (body.prevX[slot] as number) + ((body.x[slot] as number) - (body.prevX[slot] as number)) * alpha
  // …compose into the shared dummy, write instance matrix
}
```

Constants come from `@/game/data/constants` — `R`, `ALT_MIN`, `ALT_MAX`,
`MAX_ENEMIES`, `MAX_PARTICLES`, `CAM_BACK`, `CAM_UP`, `CAM_OMEGA`,
`CAM_LOOKAHEAD`, `FOV_REST`, `FOV_BOOST`, `TRAUMA_DECAY`, and the rest.

Outpost positions come from `@/game/data/outposts` (`OUTPOSTS`), already placed
on a Fibonacci lattice.

---

## 6. What you must NOT touch

- `src/game/**` — the simulation. If you need something from it that isn't
  exposed, say so; do not add it yourself.
- `src/ui/**`, `src/state/**`, `src/styles/**` — Task 2 owns these.
- `src/App.tsx`, `src/main.tsx` — the orchestrator owns these.
- `package.json` — **do not install anything.** The approved stack is §28.2. If
  you believe you need a dependency, state what breaks without it, its gzipped
  cost, the alternatives, and stop.

---

## 7. What the prior attempt got right — reuse this

From `docs/reference/ui-builder/src/game/GameScene.tsx`:

- **Module-scoped scratch objects** (`scratch` at :150-160, memoised `dummy` at
  :194) give a genuinely allocation-free `useFrame`. Keep this pattern.
- **Camera damping** at :357 — `camPos.current.lerp(desired, 1 - Math.exp(-6 * delta))`
  is the exact §21.4 form with λ = 6 matching §24.2. Correct; carry it over.
- **Shake structure** at :358 vs :369-371 — offset applied to `camera.position`
  after the rig state is copied in, never fed back. V1's drift bug is
  structurally impossible. Keep the structure; replace `Math.random()` with
  noise.
- **Instancing setup** — `DynamicDrawUsage`, `frustumCulled = false`, `count = 0`
  initially then updated with `needsUpdate` per frame. Textbook.
- **`mergeGeometries` for the craft hull and the three enemy archetypes** — this
  is what makes the enemy instancing possible.
- **No per-bullet `PointLight`.** V1's shader-recompile churn already avoided.

## 8. What the prior attempt got wrong — do not carry over

| Defect | Location | Fix |
|---|---|---|
| 8 outposts × 5 meshes with per-outpost materials = 40 draw calls | `buildOutpost` :110-124 | instance by part type → 3 calls |
| `IcosahedronGeometry(R, 5)` = 720 triangles | :22 | own subdivider, level 6 = 81,920 |
| `SphereGeometry(0.7, 8, 8)` bullets = 28,672 triangles | :257 | camera-facing quads |
| **`dispose` appears nowhere in the entire codebase** | — | `disposal.ts`, tracked, tested |
| Whole scene built in one `useMemo` with no cleanup | :196-272 | registry + teardown |
| `Math.random()` for craters and stars | :19, :24, :25, :61, :64-65 | seeded `Random` |
| Terrain displacement on the main thread at mount | :30-46 | the worker |
| Second `requestAnimationFrame` loop for input | :312-327 | one `useFrame` |
| `pc.fov += (target - fov) * Math.min(1, delta * 4)` — raw frame delta | :364 | `damp()` |
| Per-frame `.forEach` closure | :375 | indexed `for` |
| Beacon pulse from `performance.now()` | :380 | drive from `world.time` |
| No render interpolation — reads live `game.pos` | :348 | lerp by `alpha` |
| `dpr={[1,2]}` hardcoded, no tiers | `PlayScreen.tsx:39` | §17.6 detection |

---

## 9. Acceptance criteria — verify each, show the measurement

- [ ] `npm run build` clean: zero TypeScript errors, zero lint warnings
- [ ] `npm run lint` passes — including the rule that blocks a `three` import
      inside `src/game/`
- [ ] Draw calls **≤ 120** at peak load (48 enemies + 256 projectiles + 1024
      particles). Report `renderer.info.render.calls`.
- [ ] Triangles ≤ 350k. Report `renderer.info.render.triangles`.
- [ ] 60 fps sustained at 1080p on a reference desktop. Report p95 frame time.
- [ ] Terrain bake < 3 s, off the main thread, with **real** progress callbacks
- [ ] Enemies clearly readable on the **night side** (§16.3) — screenshot it
- [ ] `ResourceRegistry.size === 0` after unmount
- [ ] Zero React re-renders during 10 s of `Playing` (React DevTools profiler)
- [ ] Heap growth < 5 MB over a 5-minute soak (DevTools memory timeline)
- [ ] Icosphere unit test asserts exactly 81,920 triangles at level 6
- [ ] No `new` anywhere inside `useFrame` — grep it and show the result

## 10. How to work

- Small, focused commits. Present tense, imperative, referencing the spec:
  `Add instanced outpost rendering (gameplan §17.3)`.
- Branch `phase-5-visual-systems`. **Never commit to `main`.**
- Instance from the start — retrofitting instancing is significantly more work
  than building with it.
- Build brute-force/simple first, verify it is correct, *then* optimise.
  Optimising before you have a correct reference leaves you no way to tell
  whether the optimisation broke something.
- Report honestly. If a criterion fails, say so plainly and show the output. A
  phase that is 90% done is not done.
- If you are stuck after three genuine attempts, stop and report what you tried,
  what you ruled out, and what you think is happening.
