# Mare Noctis

**A 3D orbital defense game that runs in a browser tab. On a sphere, you cannot be everywhere.**

### ▶ [Play it now — mare-noctis.vercel.app](https://mare-noctis.vercel.app)

No install, no account, no loading screen worth the name. It runs on a laptop.

---

## The story

Eight outposts sit on a small moon called **Mare Noctis** — the Sea of Night. VEGA,
CASSINI, KEPLER, TYCHO, HADLEY, AITKEN, RILLE, NECTARIS. They are named rather than
numbered, because by the end of a run you will remember which one you let go.

Something is descending on all of them at once. Harvesters come in over the horizon,
land beside an outpost, and deploy a beam that takes its integrity down at 0.8% a
second each. They do not attack you. They do not need to.

You fly one craft. There is no second pilot, no relief rotation, and no way to be in
two places at the same time — and **the far side of a sphere is genuinely far away**:
twelve seconds at cruise, which is longer than an outpost under four beams has left.

So the game never asks you to win a fight. It asks you which one you are willing to
lose. Every second spent defending here is a second you did not spend defending
there, and by wave 10 there are four fronts and one of you. Lose all eight and the
run is over. Hold anything at all through wave 12 and the night is yours.

---

## What makes it interesting

**Enemies are beaten, not just survived.** An Interceptor stalks you, then winds up
for just over a second — it stops manoeuvring, lines up, and visibly flares. Then it
commits to a straight-line dive it *cannot* correct. Break that line as it commits
and it blows past you into two full seconds of exposed overshoot, taking 2.5×
damage and unable to shoot. Trading fire head-on is the losing move; reading the
tell is the winning one.

**Six archetypes, and the last three change what you do rather than how hard you
fight.** Difficulty rises along axes you can perceive and adapt to — how many
outposts are threatened at once, how far apart, what is in the sky — never by
quietly inflating enemy health.

| | Role | |
|---|---|---|
| **Harvester** | the clock | Lands and drains. Everything else exists to stop you reaching it. |
| **Interceptor** | the pressure | Hunts *you*, so travel is never free. |
| **Sentinel** | the wall | A directional shield you must fly around. Turns a time problem into a positioning one. |
| **Sapper** | the deadline | Runs flat and fast at an outpost and detonates. One hit kills it and it arms visibly first — but there is no arriving late. |
| **Warden** | the priority | A radial field makes every *other* hostile inside it immune. A Sentinel says *move*; a Warden says *shoot me first*. |
| **Carrier** | the source | Parks high and unarmed, launching a fresh Harvester every 11 seconds. Clearing the outpost beneath it does not finish it. |

**Damage lands on a system, not just a number.** A hit degrades your engine, your
weapon bay or your stabiliser. A hurt engine loses thrust and misfires; a hurt bay
fires slower and jams; a hurt stabiliser pulls your nose one consistent way that you
fly against, by hand, for the rest of the wave. Fly through an outpost's resupply
radius and everything is repaired — which is one more reason the outposts are worth
holding.

**The escort drones are an ability with a ladder.** Press `H` and the bay launches
drones that fly your wing and engage on their own. Bring the formation home alive
and the next sortie is one drone bigger and five seconds longer, up to four. Lose
even one and you start again from a single drone. A formation of four is something
you earned across four careful sorties — and it is at its most valuable exactly when
it is most likely to die.

**Dying costs the build, not the run.** Destruction strips every perk you have
drafted, and then offers you **three legendaries, of which you fit one**. The lowest
point in a run is also the biggest decision in it.

---

## Features

**Campaign** — 12 authored waves with a designed arc and a real ending. Wave 3 is
deliberately winnable so you learn the *shape* of a triage decision before wave 5
gives you one with no good answer. Clear wave 12 with anything standing and you win.

**Endless mode** — unlocked after a victory. Not the campaign on a loop: pressure
keeps climbing along the same axes, with hard caps so triage stays a choice rather
than a lottery.

**Three worlds** — Mare Noctis (Luna), Thule (an ice moon, low gravity, long floaty
climbs) and Ashfall (volcanic, heavier, and the haze drags at everything). Each has
its own gravity, drag, terrain and palette.

**18 perks**, drafted one-of-three between waves and persisting for the whole run.
Every card carries a **HOW** line, because roughly half of them re-arm a control you
already have.

**A hangar with 30 parts** across 6 slots from 5 manufacturers, plus set bonuses.
Every non-stock part carries a genuine buff *and* a genuine nerf, so parts are
lateral choices — a level-30 pilot is differently equipped, not more powerful. Stock
is free, and stock is the balanced tuning, so a first run is never a handicapped one.

**Credits and a store.** Kills pay bounties and surviving outposts pay dividends. A
good campaign affords roughly a quarter of the catalogue, so *which* slots to spend
on is the question. Credits are earned only — there is nothing to buy them with, no
daily rewards, no energy timers, no loot boxes.

**30 pilot levels**, 7 ranks and 12 cosmetic liveries, four of them earned by
specific achievements rather than by grinding.

**A replay-verified leaderboard** (optional). Every run is a seed plus an input log,
so the server replays your inputs through the identical simulation and checks the
score falls out. A score you cannot reproduce is a score that does not count.

**Accessibility, as sliders rather than presets** — enemy damage, drain rate, enemy
speed, aim assist, infinite boost, reduced motion, and a difficulty-assist system
that is bounded to ±15% and disclosed in Settings rather than hidden. Full keyboard
rebinding, gamepad and touch. The game is **fully playable muted**: every sound has
a visual channel carrying the same fact.

---

## Controls

| | |
|---|---|
| Shoot | `Space` / left mouse |
| Turn | `←` `→`, or the mouse |
| Slide | `A` `D` — translation without turning |
| Climb / dive | `↑` `↓` |
| Boost | `W` — 3 s, then 6 s to recharge |
| Brake | `S` — neutral throttle is already cruise |
| Weapon mode | `Q` / `Tab` — pulse cannon or guided missiles |
| Missile lock | `Shift` / right mouse — hold to acquire, it holds for 4 s |
| Heavy bomb bay | `V` / `B` — the ring on the ground is where it lands |
| Flares | `X` |
| Escort drones | `H` |
| Engine cut | `C` — coast on momentum and pivot freely |
| Orbital map | `M` (held) |
| Pause | `Esc` |

Everything is rebindable in Settings → Controls. Keyboard, mouse, gamepad and touch
**combine** rather than replacing one another, so a laptop with a touchscreen can be
flown with both hands on the keys and a thumb on the glass. Full reference in
[`docs/CONTROLS.md`](docs/CONTROLS.md).

---

## Built with

| | |
|---|---|
| **Language** | TypeScript 5.7 — strict, `noUncheckedIndexedAccess`, zero `any` |
| **Rendering** | [Three.js](https://threejs.org) r185 on WebGL2, via [React Three Fiber](https://r3f.docs.pmnd.rs) 9 |
| **Post-processing** | `postprocessing` + `@react-three/postprocessing` — bloom, god rays, vignette |
| **UI** | React 19, CSS Modules, design tokens |
| **State** | [Zustand](https://zustand.docs.pmnd.rs) 5 — meta state only, never simulation state |
| **Simulation** | Plain TypeScript. No engine, no physics library, no framework |
| **Noise / terrain** | `simplex-noise`, baked in a Web Worker off the main thread |
| **Build** | [Vite](https://vite.dev) 7 |
| **Tests** | [Vitest](https://vitest.dev) (358 unit + integration) and [Playwright](https://playwright.dev) (e2e against the production build) |
| **Backend** *(optional)* | Vercel Functions, [Neon](https://neon.tech) Postgres, [Drizzle ORM](https://orm.drizzle.team), SimpleWebAuthn passkeys, `jose` JWTs |
| **Hosting** | [Vercel](https://vercel.com) — static build, CSP and cache headers in [`vercel.json`](vercel.json) |

### 🚀 Deployed at **[mare-noctis.vercel.app](https://mare-noctis.vercel.app)**

The cloud features — accounts, cloud saves and the verified leaderboard — are
**entirely optional**. With no environment variables set the client detects the API
is absent and the game plays normally, offline and local. To enable them, set the
variables in [`.env.example`](.env.example).

---

## Under the hood

A few decisions that shaped everything else:

- **Fixed 120 Hz simulation, interpolated rendering.** The world advances in constant
  steps and nothing reads a clock or counts frames, so the game plays identically on a
  60 Hz laptop and a 144 Hz monitor.
- **Zero React re-renders during play.** Per-frame values go straight to DOM nodes
  through refs; React only hears about event-driven state, at 10 Hz. The HUD carries
  gauges, an altitude ladder, a combo meter and up to 56 threat markers without
  re-rendering the tree.
- **No allocation in the frame path.** Entities live in pre-allocated pools over typed
  arrays, so the garbage collector never runs mid-fight.
- **Everything instanced and disposed.** One `InstancedMesh` per archetype, and every
  geometry, material and texture passes through a disposal registry.
- **Seeded and deterministic.** Same seed plus same inputs equals same state, asserted
  at 10,000 steps — which is what makes the verified leaderboard possible at all.
- **The interface never lies.** Bullets travel exactly along the nose ray; aim assist
  moves the *crosshair*, visibly, and never the shot. The bomb's impact marker is the
  trajectory run forward through the same integrator the bomb itself uses.
- **No art files for the world.** The moon's albedo, normal and AO maps are generated
  procedurally in a worker at load; every hostile is built from primitives in code.

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) covers the layering.
[`docs/gameplan.md`](docs/gameplan.md) is the long-form design document the whole
thing is built against.

---

## The story behind the build

**→ [`STORY.md`](STORY.md)** — what inspired the game, how it was built,
the challenges along the way, and what I learned, with the actual maths behind the
flight model, the guidance law, the continuous collision test and the outpost
lattice.

A taste of it: the whole design falls out of one number, the time to fly to the far
side of the moon at cruise.

$$T_{\text{crossing}} = \frac{\pi R}{v_{\text{cruise}}} = \frac{\pi \cdot 100}{26.02} \approx 12.1\ \text{s}$$

Twelve seconds to cross. An outpost under four drain beams has about thirty. Every
deadline in the game is quoted in units of that number rather than in seconds, so
retuning the moon's radius or the craft's speed moves the whole design with it
instead of quietly breaking it.

---

## Running it locally

```bash
npm install
npm run dev          # http://localhost:5173
```

Or use the cross-platform runner, which checks prerequisites and installs for you:

```bash
python run.py            # dev server
python run.py --prod     # build and serve the production bundle
python run.py --verify   # lint, test and build
```

| Script | |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck, then production build to `dist/` |
| `npm test` | Unit and integration tests |
| `npm run lint` | ESLint, zero warnings allowed |
| `npm run verify` | Lint, test and build together |
| `npm run docs:controls` | Regenerates `docs/CONTROLS.md` from the control table |

End-to-end tests live in `tests/e2e` and run under Playwright (`npx playwright test`;
browsers install once via `npx playwright install chromium`). They boot the
**production** build through `vite preview`, so they catch the failures that only
exist in built output — a chunk that will not load, a CSP violation, a minifier
changing behaviour.

---

## Layout

```
src/
├── game/          the simulation — headless, deterministic, no framework
│   ├── core/      World, Simulation, Loop, Pool, Random, step, readModel
│   ├── systems/   flight, AI, collision, spawn, weapons, drain, score, HUD
│   ├── entities/  per-archetype spawn and behaviour
│   ├── physics/   integration, drag, gravity, springs, tangent frame, collision
│   ├── math/      vec3, spherical
│   └── data/      every tuning constant, waves, enemies, parts, worlds, skins
├── platform/      keyboard, pointer, trackpad, gamepad, touch
├── render/        R3F scene, one useFrame, instanced pools, disposal registry
├── audio/         graph, director, synth voices, spatialisation, music
├── state/         zustand meta state, HUD refs, versioned persistence
├── ui/            screens, HUD components, accessibility
├── workers/       terrain baking, off the main thread
└── styles/        design tokens

api/               Vercel Functions: auth, save, score verification
db/                Drizzle schema and migrations
tests/             unit · integration · e2e
docs/              gameplan, architecture, controls, asset credits
```

---

## Credits

Built by **Md Ahbab**. Third-party assets and their licences are listed in
[`docs/CREDITS-ASSETS.md`](docs/CREDITS-ASSETS.md).

## Licence

All rights reserved.
