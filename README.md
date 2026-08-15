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

**Damage lands on a system, not just a number.** A hit degrades the engine, the
weapon bay or the stabiliser. A hurt engine loses thrust and misfires; a hurt bay
fires slower, runs hotter and jams; a hurt stabiliser costs turn authority and
pulls the nose one consistent way, which you fly against by hand. Three pips on
the HUD say which. Flying through an outpost's resupply radius repairs
everything, and a respawn is a new airframe.

**Perks stack across a run and are drafted one-of-three between waves.** All
nineteen do exactly what they say — there is a test that walks the source and
fails if any perk id is unreachable from code. Escort Drone Bay is the stackable
one: each pick adds an autonomous drone, up to four, that holds formation on your
wing and engages on its own.

**Dying costs the build, not the run.** Death strips your perks and hands back a
single legendary to restart from.

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
(`npx playwright test`); they need browsers installed via `npx playwright install`.

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
