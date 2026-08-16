# TASK 5 — Accounts, cloud saves, and replay-verified leaderboards

**Owner:** you (agent, Antigravity IDE)
**Scope:** `api/**`, `src/net/**`, `db/**`, `vercel.json` — plus, **in your final phase only**, `src/ui/screens/Account*.tsx` and `src/ui/screens/Leaderboard*.tsx`
**Repo root:** `moon-game-v2/`
**Runs in parallel with:** TASK-3 (presentation), TASK-4 (audio), and the main session
**Status: landed, with drift (August 2026).**

Auth, cloud save, Account/Leaderboard screens and replay-verified score
submit are in `api/` and `src/net/`. `SIM_VERSION` is 5 in
`src/game/data/constants.ts`. The functions are optional: a static host
without `api/` plays locally.

---

## 0. Read these first, in this order

1. `docs/gameplan.md` §9 (Progression), §10.4 (Determinism), §32.3 (Persistence),
   §39 (Security).
2. `src/state/persistence.ts` — the save schema, its validators, and its
   migration history. **You will reuse these functions verbatim on the server.**
3. `src/game/core/Simulation.ts` and `src/game/core/Loop.ts` — the deterministic
   core you will be replaying.
4. `tests/integration/simulation.test.ts` — specifically *"the same seed and
   inputs produce identical state after 10,000 steps"*. That test is the
   foundation this entire task rests on.
5. `vercel.json` — the Content Security Policy.

---

## 1. What you are building, and the one idea that makes it worth building

Accounts, cloud saves and leaderboards. The first two are ordinary. The third is
not, and it is the reason this task is interesting.

**The simulation is deterministic, headless, and framework-free.** It has no
React, no Three.js, no DOM; it runs in Node today, in vitest, at 120 Hz, and a
test asserts that the same seed and the same inputs produce bit-identical state
after ten thousand steps.

That means the server can **replay a submitted run** through the *exact same
code* and check that the claimed score is the score that actually results.

```
  client  ──▶  { seed, simVersion, inputLog, claimedScore }
                          │
  server  ────────────────┴──▶  new Simulation(seed)
                                replay inputLog through stepWorld
                                compare final score, bit for bit
                                accept  ⇢  the run really happened
                                reject  ⇢  it did not
```

A leaderboard that cannot be forged. Almost no browser game ships one, because
almost no browser game has a simulation that could be replayed server-side. This
one does, because of decisions taken long before there was any thought of a
leaderboard: a fixed timestep, a seeded PRNG, input sampled inside the substep
loop, no wall-clock reads in the game layer, and no `Math.random()` anywhere.

**Do not build a "trusted client" leaderboard as a shortcut.** A score endpoint
that accepts a number is a leaderboard of whoever opens devtools first, and it
would waste the one genuinely rare property this codebase has.

---

## 2. Architecture — and why not Next.js

Stay a **static Vite SPA plus Vercel Functions on the same project.**

```
moon-game-v2/
├── src/           ← unchanged Vite app
├── api/           ← Vercel Functions, same origin
│   ├── auth/
│   ├── save.ts
│   └── score.ts
├── db/            ← Drizzle schema + migrations
└── vercel.json    ← CSP already permits this
```

Two reasons this is right and a Next.js migration is not:

1. **The CSP does not have to change.** `connect-src 'self'` already permits
   same-origin `/api/*`. A separate API host would force relaxing it. Check this
   yourself in `vercel.json` before you write a line — if you find yourself
   needing to edit that header, something has gone wrong.
2. **SSR is worthless to a `<canvas>` game**, and the App Router would put a HUD
   whose defining invariant is *zero React re-renders* inside a hydration
   boundary. The migration would move every file to gain nothing.

**Database:** Neon Postgres, Drizzle ORM for schema and migrations. Develop
against a local Postgres; the production URL arrives when you need it.

---

## 3. Phase 1 — auth

**Passkeys (WebAuthn) first, email magic link as fallback. No passwords.**

No passwords means no password hashes to leak, no reset flow, no credential
stuffing, and no "we take security seriously" email later. Use `@simplewebauthn/server`
and `@simplewebauthn/browser`.

- `POST /api/auth/register/options` · `/verify`
- `POST /api/auth/login/options` · `/verify`
- `POST /api/auth/magic-link` · `GET /api/auth/magic-link/verify`
- Session: `HttpOnly`, `Secure`, `SameSite=Lax` cookie. No token in
  `localStorage` — a save file is already read from there and treating it as
  untrusted is the whole posture of `persistence.ts`.

**PII is exactly one field: an email address**, and only for players who choose
the fallback. Passkey users give nothing. Ship `GET /api/account/export` and
`DELETE /api/account` from the start rather than adding them when someone asks —
they are two endpoints on day one and a migration later.

---

## 4. Phase 2 — cloud save

`PersistedData` (`src/state/persistence.ts`) is already versioned, already
schema-validated, and its parsers are already **total** — every field either
validates or falls back, so a partially corrupt payload loses only the corrupt
fields.

That is precisely the property a server needs. **Import and reuse
`parseSettings`, `parseProgress` and `parseKeybinds` directly.** Do not write a
second validator: two validators for one schema will disagree eventually, and the
one the player hits will be the wrong one.

- `GET /api/save` → the stored blob
- `PUT /api/save` → validate, store, return the canonical result
- **Conflict policy: last-write-wins, with the loser surfaced.** Store a
  `savedAt` and a monotonic `revision`. If the client's base revision is stale,
  return `409` with both versions and let the player choose. Silently overwriting
  a session someone played on their phone is how you lose a player permanently.

Progress is the payload that matters: `pilotXp`, `bestScore`, `bestWave`,
`equippedLoadout`, `skinId`, `worldId`, `achievements`. A cleared cache currently
erases a season, and fixing that is the main *player-facing* argument for this
whole task.

---

## 5. Phase 3 — replay verification

The core of the task.

### 5.1 What the main session has already built — read it before designing

All of this exists and is tested. **Do not reimplement any of it.**

- **`src/game/core/InputRecorder.ts`** — `InputRecorder`, `InputPlayer`,
  `runReplay`, `encodeReplay`, `decodeReplayFrames`, `parseReplay`.
- **`SIM_VERSION`** in `src/game/data/constants.ts`, currently **3**. A replay is
  only meaningful against the physics it ran on; there is no honest way to
  migrate one, so a superseded version is *retired*, not reinterpreted.
- **Runs record themselves.** `Simulation.startRun` begins recording;
  `buildReplay()` returns the log. The attract loop and the tutorial are
  deliberately excluded.

**A replay carries a `RunContext`, and it is not optional.** Gravity and drag
come from the world; thrust, drag, hull, turn rate and more come from the
equipped parts. The same seed and the same inputs therefore produce *different*
scores in different contexts, and a verifier that replays with defaults rejects
every honest run flown anywhere but Mare Noctis with stock parts. That was the
state of this endpoint until it was fixed: not a security hole, but something
worse in a quieter way — a feature that appeared to work, for exactly the players
who had unlocked nothing yet.

`Simulation.applyRunContext` is the single method that puts a world into a run's
context, and both callers use it: the shell on the Briefing beat, and
`runReplay` before the first step. It takes **identifiers, never multipliers** —
a world id and a map of slot → part id — so the registries stay the authority and
a client cannot submit a run claiming it flew under a gravity of 0.1. An unknown
world falls back to the default and an unknown part falls back to stock.

Three things about the format that will save you a day each:

1. **Use `runReplay`. Do not write your own loop.** A run is not only input: at
   every wave boundary the *shell* issues commands the world does not issue for
   itself, and `captureWaveSummary` awards the accuracy, no-damage and
   all-intact bonuses as a side effect. A driver that stepped input alone
   finishes a multi-wave replay with a lower score than the run it is verifying,
   and rejects honest submissions as forgeries.
2. **Send `encodeReplay`'s packed form, not the JSON.** Run-length encoding does
   almost nothing for mouse players — the virtual stick decays continuously, so
   the quantised axis changes on ~90% of steps and a twelve-wave run is ~65,000
   frames. As JSON that is several megabytes; packed it is ~8 bytes a frame.
3. **`decodeReplayFrames` takes explicit limits and enforces them.** Replay is
   CPU-bound work on your infrastructure, so an unbounded step count is a
   denial-of-service vector rather than merely bad data. Pass real numbers.

`tests/unit/replay.test.ts` is written as a security suite and is the reference
for what a hostile submission looks like. Extend it rather than starting over.

### 5.2 The endpoint

`POST /api/score` with
`{ seed, simVersion, inputLog, claimedScore, worldId, equipped, endless }`.

`worldId` is checked against the server's own `WORLDS` registry, and `equipped`
goes through `parseRunContext` and then `resolveLoadout`, which already discards
a part that is unknown or in the wrong slot. Between them a client may choose
among real worlds and real parts and nothing else.

**Still open, and it is a policy question rather than a bug:** nothing yet checks
that the submitted parts were *unlocked* at the account's pilot level. Doing it
needs the account's XP at the endpoint and a decision about runs flown before a
part was nerfed. Until then a determined player could submit a legitimate run
flown with parts they had not earned.

1. Reject unknown or retired `simVersion` outright. A replay is only meaningful
   against the physics it was recorded under; a stored replay from an older
   version is **not** migrated, it is retired, and its leaderboard entry is
   archived rather than deleted.
2. Reject an `inputLog` longer than a hard cap. This is a denial-of-service
   surface: replay is CPU-bound, and it runs on your infrastructure.
3. Replay in a **worker with a hard timeout**. Budget: a 10-minute run is 72,000
   steps and completes in well under a second in Node, so a 5 s timeout is
   generous and still bounds the damage.
4. Compare the resulting score, wave and outposts-remaining. Accept only on an
   exact match.
5. Rate-limit per account and per IP.

### 5.3 Storage

Store the `inputLog` for accepted top entries. It costs little and it buys two
things: any leaderboard entry can be re-verified after a bug fix, and any entry
can be **watched** — a ghost replay is a feature you get almost for free once the
data is there. Do not build the ghost viewer in this task; just do not throw away
the data that makes it possible.

---

## 6. Phase 4 — the UI, and only now

Your last phase, and the only point where you touch `src/ui/**`.

You own exactly these new files:

- `src/ui/screens/AccountScreen.tsx` + `.module.css`
- `src/ui/screens/LeaderboardScreen.tsx` + `.module.css`

**The scaffolding is already in place.** `Screen` carries `'Account'` and
`'Leaderboard'`, `App.tsx` routes both, and the Title screen has a LEADERBOARD
entry. They currently render `ComingSoonScreen`; replace those two `case` lines
with your components and change nothing else in `App.tsx`.

`ComingSoonScreen` exists rather than the router simply omitting the cases, and
the reason is worth internalising: a screen that renders `null` is not "nothing
to show", it is a transparent, buttonless overlay over a live game with no route
out. `Results` shipped that, `Debrief` shipped that, and `Abort` walked players
into one. Whatever you build, it must never render nothing.

Follow the existing screens for structure. `SettingsScreen.tsx` is the reference
for tabs and focus handling; `ResultsScreen.tsx` for stat layout. Use the tokens
in `src/styles/tokens.css` — do not invent colours.

Networking lives in `src/net/`, never in a component. Nothing you add may run
during `Playing`: §17.2 requires zero React re-renders there, and a fetch that
resolves mid-wave and calls `setState` breaks it. Sync on screen transitions.

---

## 7. Security

`docs/gameplan.md` §39 applies to you in full, plus:

- **Every input from a client is hostile.** The save blob, the input log, the
  claimed score, the display name. Validate the shape, cap the size, cap the rate.
- **Display names** are user content: length-capped, rendered as text and never as
  HTML, profanity-filtered at submission, and reportable.
- **No secrets in the repository.** Environment variables only, and
  `.env.example` documents the names with no values.
- **Do not relax the CSP.** If you think you need to, stop and say why — it is
  more likely that something is being fetched cross-origin that should not be.
- **Parameterised queries only.** Drizzle gives you this; do not drop to raw SQL
  for convenience.

---

## 8. What you must not touch

`src/game/**` (import only, never edit), `src/render/**`, `src/audio/**`,
`src/platform/**`, `src/state/**`, and any `src/ui/**` file other than the four
listed in §6.

---

## 9. Verification

```bash
npx tsc --noEmit                 # zero
npx eslint . --max-warnings 0    # zero
npx vitest run                   # 149 passing, plus yours
npx vite build                   # zero warnings
npx playwright test              # 26 passing, plus yours
```

Backend-specific, and the third one is the whole task:

- **Round-trip**: save on one client, load on another, assert every progress
  field survives.
- **Conflict**: two clients from the same base revision; the second gets a `409`
  with both versions, not a silent overwrite.
- **Forgery — test this hardest.** Submit a run with a real seed and a real input
  log but an inflated `claimedScore`; it must be rejected. Then submit a truncated
  log, a log with impossible input values, a log from a different seed, and a log
  under a retired `simVersion`. Every one rejected. **A leaderboard is only worth
  having if this suite is thorough**, so write it as a security test, not as a
  happy-path check with one negative case bolted on.
- **Determinism across environments**: the same replay verified in Node and in
  the browser must produce identical state. If it does not, something in the game
  layer is reading a clock or the platform, and that is a bug to report to the
  main session immediately — it would break §10.4 for everyone, not just you.
- **Load**: 100 concurrent replay submissions stay inside the function timeout.
- **Account deletion** actually deletes, including leaderboard entries.

Report: median and p99 replay verification time, the input-log size for a
12-wave run, and the outcome of every forgery case.
