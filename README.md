# Mare Noctis

**A 3D orbital defense game for the browser. On a sphere, you cannot be everywhere.**

Eight outposts are spread across a small moon. Harvesters descend on them, land, and
drain them. You fly one craft. The whole game is the consequence of that arithmetic:
every second spent defending one outpost is a second not spent defending another, and
the sphere means the far side is always genuinely far away.

```bash
npm install
npm run dev      # http://localhost:5173
```

## Playing

| | |
|---|---|
| Shoot | `Space` / left mouse |
| Turn | `←` `→`, or the mouse |
| Slide | `A` `D` — translation without turning |
| Climb / dive | `↑` `↓` |
| Boost | `W` — 3 s, then 6 s to recharge |
| Brake | `S` — neutral throttle is already cruise |
| Weapon mode | `Q` / `Tab` — pulse cannon or guided missiles |
| Missile lock | `Shift` / right mouse — hold to acquire, it keeps itself for 4 s |
| Heavy bomb bay | `V` / `B` — the ring on the ground is where it lands |
| Flares | `X` |
| **Escort drones** | **`H` — call the formation. See below.** |
| Engine cut | `C` — coast on momentum and pivot freely |
| Orbital map | `M` (held) |
| Pause | `Esc` |

Everything is rebindable in Settings → Controls. Gamepad and touch are supported and
**combine** with the keyboard rather than replacing it — a laptop with a touchscreen can
be flown with both hands on the keys and a thumb on the glass. The full generated
reference is in [`docs/CONTROLS.md`](docs/CONTROLS.md).

## The fight

**Interceptors can be beaten, not just survived.** One stalks you, then winds up
for just over a second — it stops manoeuvring, lines up, and visibly flares. Then
it commits to a straight-line dive it *cannot* correct. Break that line as it
commits and it blows past you into two seconds of exposed overshoot, where it
takes 2.5× damage and cannot shoot. Flares during the wind-up abort the run
outright. Trading fire head-on is the losing move.

**Six archetypes, and the last three change what you do rather than how hard
you fight.** Harvesters are the clock, Interceptors make travel dangerous, and
Sentinels turn a time problem into a positioning one. Then the back third of the
campaign arrives:

| | |
|---|---|
| **Sapper** (wave 8) | Runs flat and fast at an outpost and detonates for 14 integrity in one stroke. One hit kills it, it never fires, and it arms visibly first — but there is no arriving late. Every other threat is a clock; this one is a deadline. |
| **Warden** (wave 9) | A radial field that makes every *other* hostile inside it immune. A Sentinel says *move*, because flanking beats a directional shield. A Warden says *shoot me first*, because nothing else gets through. |
| **Carrier** (wave 11) | Parks high and unarmed, and launches a fresh Harvester every 11 s forever. Clear the outpost beneath it and it is threatened again before you reach the next one — the only kill that prevents future work. |

**Damage lands on a system, not just a number.** A hit degrades the engine, the
weapon bay or the stabiliser. A hurt engine loses thrust and misfires; a hurt bay
fires slower, runs hotter and jams; a hurt stabiliser costs turn authority and
pulls the nose one consistent way, which you fly against by hand. Three pips on
the HUD say which. Flying through an outpost's resupply radius repairs
everything, and a respawn is a new airframe.

**The escort drones are an ability with a ladder, not a passive.** Press `H` and
the bay launches drones that hold formation on your wing and engage anything
within 110 u on their own. The first sortie is one drone for 20 seconds; then the
bay is cold for 30. What makes it a decision rather than a cooldown is what
happens next:

| | |
|---|---|
| Sortie flies its full clock | Next launch is **one drone bigger and five seconds longer** |
| Any drone is shot down | The ladder **resets to a single drone** |

So a formation of four is something you have earned across four careful sorties,
and it is at its most valuable exactly when it is most likely to die. Whether to
push the advantage or fly conservatively to bank the next tier is the question
the ability exists to ask. The HUD pip shows all three states — flying with its
clock, recharging with its clock, or `×N READY`.

**Perks persist for the whole run and are drafted one-of-three between waves.**
All eighteen do exactly what they say — there is a test that walks the source and
fails if any perk id is unreachable from code, and another that fails if any card
ships without instructions. Every card carries a **HOW** line, because roughly
half the perks re-arm a control you already have: Helios Solar Lance charges by
altitude and fires on your ordinary cannon key, and a card that omitted that sold
an ability while withholding the instructions.

**Dying costs the build, not the run.** Destruction strips every perk — and then
offers you **three legendaries, of which you fit one**. The worst moment in a run
is therefore also the one with the highest-stakes decision in it, rather than
something you watch happen to you.

**Kills and surviving outposts pay credits, and credits buy parts in the
Hangar.** A good campaign affords maybe a quarter of the catalogue, so which
slots to spend on is the question — and since every part carries a real nerf
beside its buff, none of them is the answer. Stock is free and stock is the
balanced tuning, so a first run is never a handicapped one. Credits are earned
only; there is nothing to buy them with.

## What is worth knowing about the build

- **Fixed 120 Hz simulation, interpolated rendering.** The world advances in constant
  steps and nothing reads a clock or counts frames, so the game is identical on a 60 Hz
  laptop and a 144 Hz monitor. The renderer interpolates between steps.
- **Zero React re-renders during play.** Per-frame values are written straight to DOM
  refs; React only hears about event-driven state, at 10 Hz.
- **The interface never lies about the weapon.** Bullets travel exactly along the nose
  ray; aim assist moves the *crosshair*, visibly, and never the shot. The bomb's impact
  marker is the trajectory run forward through the same integrator the bomb itself
  uses, not an approximation of it.
- **Seeded and deterministic.** A run is a seed plus an input log, which is what makes
  the replay-verified leaderboard possible: the server replays your inputs through the
  same simulation and checks the score falls out.
- **No allocation in the frame path.** Entities live in pre-allocated pools over typed
  arrays, so the garbage collector never runs mid-fight.

`docs/ARCHITECTURE.md` covers the layering; `docs/gameplan.md` is the long-form design
document the whole thing is built against.

## Scripts

| | |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck, then production build to `dist/` |
| `npm test` | Unit and integration tests (Vitest) |
| `npm run lint` | ESLint, zero warnings allowed |
| `npm run verify` | Lint, test and build together — run this before pushing |
| `npm run docs:controls` | Regenerates `docs/CONTROLS.md` from the control table |

End-to-end tests live in `tests/e2e` and run under Playwright
(`npx playwright test`); they need browsers installed once via
`npx playwright install chromium`. The suite boots the **production** build
through `vite preview`, so it catches the failures that only exist in built
output — a chunk that will not load, a CSP violation, a minifier changing
behaviour.

One note on `playwright.config.ts`: the preview server is started with an
explicit `--host 127.0.0.1`. Vite's default preview host is `localhost`, which
Node 17+ resolves in system order — on macOS that is `::1` first, so the server
binds IPv6 loopback *only* while Playwright polls the IPv4 address in `url`. The
suite then fails on a webServer timeout before running a single test.

## Deploying

The project is a static Vite build and deploys to Vercel as-is — framework preset
**Vite**, output directory `dist`, no configuration needed beyond what
[`vercel.json`](vercel.json) already carries (CSP, cache headers).

Two notes on that config, both learned the hard way:

- `script-src` carries `'wasm-unsafe-eval'` because three's GLTF loader decodes
  the craft model through a WebAssembly decompressor. Without it the model fails
  to instantiate on any host that actually sends the header — which means every
  local run looks perfect, since no CSP is sent locally, and the deployed build
  dies on the Title screen.
- [`.vercelignore`](.vercelignore) excludes `api/`, because those thirteen
  serverless functions exceed the Hobby plan's limit of twelve. The game is
  unaffected: it detects the API is absent and runs entirely locally.

The optional cloud features — accounts, saves and the verified leaderboard — are
serverless functions under `api/` backed by Neon Postgres. They are **entirely
optional**: with no environment variables set, the client detects the API is
unavailable and the game plays normally, offline and local. To enable them, set the
variables listed in [`.env.example`](.env.example).

## Licence

All rights reserved.
