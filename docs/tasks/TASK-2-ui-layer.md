# TASK 2 — The UI Layer: Screens, HUD, State, Styles

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
**Scope:** `src/ui/**`, `src/state/**`, `src/styles/**` — **nothing else**
**Repo root:** `moon-game-v2/`
**Corresponds to:** gameplan.md Phase 6 (§40), milestone M6

---

## 0. Read these first, in this order

1. `docs/gameplan.md` §11 (Game States — the twelve canonical names), §12
   (UX/HCD Principles, especially §12.2's five problems), §13 (Psychological
   Design), §14 (UI/UX Specification), §15 (Art Direction), §32 (State
   Management), §35 (Accessibility), §36 (Responsive Strategy).
2. `src/styles/tokens.css` — **already written. Use these tokens; do not invent
   colours.**
3. `src/game/core/readModel.ts` — the two channels through which you receive
   simulation data. Read it completely; it is your entire contract.
4. `docs/reference/ui-builder/src/` — a prior attempt at this layer. Several
   pieces are genuinely good and should be carried over close to verbatim (§8);
   others conflict with the spec (§9).

`gameplan.md` is the single source of truth. Where this brief and the gameplan
disagree, **the gameplan wins** — raise it rather than silently choosing.

---

## 1. What you are building

Twelve screens, a HUD that never re-renders, and the state layer beneath them.

```
src/ui/
├── screens/
│   ├── BootScreen.tsx         capability detection, WebGL2 check
│   ├── LoadingScreen.tsx      REAL worker progress, never a timer
│   ├── TitleScreen.tsx        live moon behind the menu
│   ├── SettingsScreen.tsx     four tabs, overlay, returns to caller
│   ├── TutorialScreen.tsx     three beats, one verb each
│   ├── BriefingScreen.tsx     4 s, skippable, the plan before the pressure
│   ├── PlayingScreen.tsx      HUD host — note the name
│   ├── PausedScreen.tsx       dialog semantics, focus trap
│   ├── WaveClearScreen.tsx    3 s, staggered breakdown
│   ├── DebriefScreen.tsx      the honest one — timeline + cause
│   ├── ResultsScreen.tsx      final score, PB delta, seed
│   └── CreditsScreen.tsx
├── hud/
│   ├── ThreatRing.tsx         THE signature element — build this FIRST
│   ├── OutpostRoster.tsx
│   ├── HullGauge.tsx
│   ├── HeatGauge.tsx
│   ├── LockReticle.tsx
│   ├── ComboMeter.tsx
│   ├── AltitudeLadder.tsx
│   ├── Horizon.tsx            artificial horizon, local tangent plane
│   ├── DamageVignette.tsx
│   ├── AlertBand.tsx
│   └── TouchControls.tsx
├── components/
│   ├── Button.tsx  Slider.tsx  Toggle.tsx  Tabs.tsx  KeyBindRow.tsx  Toast.tsx
│   └── ErrorBoundary.tsx
└── a11y/
    └── LiveRegion.tsx         aria-live announcements

src/state/
├── useGameStore.ts            zustand: screen, wave, run summary
├── useSettingsStore.ts        zustand: persisted settings
├── persistence.ts             versioned, schema-validated localStorage
└── hudRefs.ts                 the DOM-ref registry for per-frame values

src/styles/
├── tokens.css                 ALREADY WRITTEN — do not redefine tokens
├── base.css                   reset, focus rings, reduced-motion
└── fonts.css                  self-hosted @font-face
```

---

## 2. The hard constraints

### 2.1 Zero React re-renders during Playing (§17.2, §32.2)

This is the single most important architectural constraint in the project, and
it is verified by an automated test that fails the build.

Three kinds of state, three mechanisms — get the routing right:

| Kind | Mechanism | Frequency | Example |
|---|---|---|---|
| **Simulation** | plain mutable objects, typed arrays | 120 Hz | positions, health |
| **Meta/UI** | zustand | on event | current screen, wave number |
| **Persistent** | zustand + localStorage | rarely | settings, PB, keybinds |

Concretely, for the HUD:

- **Per-frame values — hull, heat, score, combo, speed, altitude, boost, lock
  progress, bank, trauma — are written DIRECTLY TO DOM REFS.** They never touch
  React. Not `useState`, not zustand, not Context. Write
  `element.style.transform`, `element.textContent`, `element.style.width`.
- **Event-driven values — outpost status, wave number, alerts — go through
  zustand at ≤10 Hz.**

Implement `src/state/hudRefs.ts` as a plain registry the render bridge writes
into each frame:

```ts
export interface HudRefs {
  hullFill: HTMLElement | null
  hullText: HTMLElement | null
  heatFill: HTMLElement | null
  // …one per per-frame value
  threatMarkers: (SVGGElement | null)[]   // MAX_MARKERS, pre-allocated
}
export const hudRefs: HudRefs = { /* nulls */ }
```

Components register their refs on mount. The render bridge (Task 1) calls a
single `writeHud(frame, markers)` function you export, which mutates the DOM
directly. No React involvement, no diffing, no reconciliation.

**The Threat Ring in particular must be fed every frame, not at 10 Hz.** Bearing
is the fastest-changing quantity on screen — a hard bank sweeps every marker
across the ring — and 100 ms steps read as stuttering on precisely the element
the player is meant to trust for spatial awareness. Pre-create `MAX_MARKERS`
(56) `<g>` nodes at mount and update their `transform` and `visibility`
attributes imperatively.

### 2.2 No Tailwind. Scoped CSS Modules (§29)

§29's Rejected table: *"Tailwind — a game UI is bespoke components, not utility
composition; scoped CSS modules fit better."* It is not installed and must not
be.

Every component gets a `Component.module.css`. All colour, spacing and type come
from the tokens in `src/styles/tokens.css` via `var(--token)`. For translucency
use the pre-declared RGB triples: `rgb(var(--friendly-rgb) / 0.2)`, never a
re-typed hex literal.

### 2.3 Fonts are self-hosted and subset (§15.3, §33.1, §39.1)

Two variable fonts, ~34 KB total: **Chakra Petch** (HUD, numerals, headings —
with **tabular figures**, so score and hull don't jitter as digits change) and
**Inter** (body, settings, Debrief prose).

**No CDN.** The prior attempt began `src/index.css` with
`@import url('https://fonts.googleapis.com/css2?…')`, which violates §15.3
(self-hosted), §33.1 (no CDN dependency), and §39.1's `default-src 'self'` CSP —
under which the request is simply blocked and the game silently renders in
fallback faces. Place `.woff2` files in `public/fonts/` and declare `@font-face`
in `src/styles/fonts.css` with `font-display: swap`.

### 2.4 Text sizes (§15.3, §35.7)

**16px minimum body. 14px absolute floor for incidental labels.** No exceptions.

The prior attempt used a 12px `.hud-label` in **46 places** plus 11px and 13px
text, because a pasted design brief specified 12px. `gameplan.md` overrides it.
`--text-label: 14px` is the smallest step in the scale and there is deliberately
no 12px token.

### 2.5 Exact terminology (Rule 8, §11)

The twelve states are `Boot`, `Loading`, `Title`, `Settings`, `Tutorial`,
`Briefing`, `Playing`, `Paused`, `WaveClear`, `Debrief`, `Results`, `Credits`.
Use these exact strings in the zustand union type and name the component
`PlayingScreen.tsx`, not `PlayScreen.tsx`. Never `GameOver`, never `Base`,
never `Station`. In-game nouns are `Harvester`, `Interceptor`, `Sentinel`,
`Outpost`, `ThreatRing`.

---

## 3. The Threat Ring — build this FIRST (§12.2 P1, §20.7, risk R6)

It is the most novel component, the highest-risk one, and the answer to the
game's hardest perceptual problem: *on a sphere, threats are off-screen and over
the horizon.* Prototype it early and test comprehension; do not polish it last.

A compass ring concentric with the reticle at screen centre. Every threat and
outpost is a marker at its true bearing relative to heading.

| Channel | Encodes |
|---|---|
| **Angular position** | bearing — the spatial fact that matters most |
| **Distance from ring centre** | proximity — **nearer = further out on the ring** |
| **Marker shape** | type: chevron = Harvester, dart = Interceptor, bar = Sentinel, hexagon = Outpost |
| **Pulse rate** | urgency |
| **Colour** | allegiance — and colour is *never* the only carrier (§35.1) |

Markers for objects **behind** the player draw on the lower half with a subtle
inward arrow.

Note the proximity direction: the prior implementation inverted it (near =
centre) and documented the inversion in its own header comment. **Follow the
spec**: nearer is further out, which keeps the urgent things at the ring's edge
where peripheral motion detection is strongest (§13.1).

You receive markers already computed — the bearing maths lives in the
simulation, not here:

```ts
import type { ThreatMarker } from '@/game/core/readModel'
// bearing: radians on (-π, π], 0 = dead ahead
// proximity: 0 at the player, 1 at max range
// urgency: 'safe' | 'threatened' | 'critical'
// kind, hostile, extinguished, active
```

Render as inline SVG in a `0 0 100 100` viewBox. Give it `role="img"` and a
descriptive `aria-label`. §36.2: on mobile it **grows relative to the screen** —
it is the most important element on a small display, so it gets proportionally
*more* space, not less.

Fallback if comprehension tests below 70% (§43 R6): edge-of-screen arrows — less
elegant, well proven.

---

## 4. Screen-by-screen requirements

### HUD layout, §14.2

```
┌─────────────────────────────────────────────────────────────┐
│ ▓▓▓▓▓▓▓▓░░ HULL 78          WAVE 5          SCORE 12,480    │
│ ▓▓▓░░░░░░░ HEAT 31                          ×3 COMBO        │
│  OUTPOSTS                        ╭───────────╮          ▲   │
│  ◆ VEGA      100%               │     ·     │          70  │
│  ◆ KEPLER     94%               │  ╭─────╮  │          ─   │
│  ◈ CASSINI    41% ▼             │  │  ✛  │  │          ─   │
│  ◆ TYCHO     100%               │  ╰─────╯  │          25  │  ALTITUDE
│  ◇ HADLEY      — LOST           │     ·  ◂  │          ─   │  LADDER
│  ◆ AITKEN    100%               ╰───────────╯          ─   │
│  ◆ RILLE      88%                THREAT RING            8   │
│  ◆ NECTARIS  100%                                       ▼   │
│                    ───────  horizon  ───────                 │
│ ⚡ BOOST ▓▓▓▓▓▓░░░░              ⌖ LOCK 0.8s                │
└─────────────────────────────────────────────────────────────┘
```

Information hierarchy (§14.1): **Tier 1** Hull + Threat Ring (largest, highest
contrast, most stable position) · **Tier 2** Outpost Roster, drain warnings ·
**Tier 3** Heat, boost, lock · **Tier 4** score, combo, wave, timer —
*deliberately* least prominent, because score is not what a player should be
looking at during a decision.

Cognitive load, §12.4 — working memory holds about four items under stress:
**always visible (4):** Hull · Heat · Threat Ring · Outpost Roster.
**Conditional:** lock reticle only while locking, combo only above ×2, wave
banner 3 s at wave start, warnings only when relevant.

Never obstruct gameplay (§14.4): no modal ever appears during `Playing`; alerts
occupy the upper-centre band, never over the reticle or the ring; damage
vignettes are edge-only, capped at **40%** opacity; a Minimal preset reduces the
HUD to Hull + Threat Ring.

**Only one crosshair.** The prior attempt drew two on top of each other.

### Debrief — the screen that has to work (§12.2 P2, M6)

Its one job: the player can say *why* they lost. Round 2 user testing asks
exactly that, and ≥80% must answer correctly (§42).

- **The cause, in one sentence**, e.g.
  *"Lost Cassini at 2:41 — 3 Harvesters landed while you were on the far side."*
  You receive it as `WaveSummary.cause`.
- **A timeline strip** of the wave showing where the player was when each outpost
  came under threat. Data arrives as `OutpostTimelineEntry[]`.
- Accuracy, kills by type, and the run seed.

Failure becomes a lesson about the sphere rather than an insult.

### Briefing (§14.3)

4 s, skippable. The sphere unrolled, threatened outposts marked, incoming
composition listed. This is what turns a wave into a *decision* rather than a
reaction. **All data comes from props** — the prior attempt hard-coded
"Cassini & Hadley" and a fixed enemy composition regardless of the actual wave.

### Loading (§11, §33.2)

Real progress from the terrain worker's stage callbacks. The prior attempt used
`setInterval(() => setProgress(p => p + 1), 40)` — a fixed 4-second fake. Persona
A's stated frustration is "loading screens with no progress"; a fake bar is
worse than none.

### Settings (§14.3) — four tabs, all controls live

Controls (live remapping with conflict detection) · Display (quality tier, HUD
scale 75–150%, colour mode) · Audio (master/music/SFX, separate) · Accessibility
(reduced motion, aim assist, difficulty axes, DDA toggle, high contrast).

Every control must be **wired and persisted**. In the prior attempt all eleven
were dead `useState` discarded on unmount.

Difficulty is **independent axes, not presets** (§10.5, §35.4): Enemy Damage
0–150% · Drain Rate 50–150% · Enemy Speed 75–125% · Aim Assist 0–100% ·
Infinite Boost. Independent because disabilities are not a single dimension — a
player with a motor impairment may want slower enemies at full damage; a player
with a visual impairment the opposite.

DDA is **disclosed here and switchable off** (§10.3). Hiding difficulty
manipulation is manipulative; offering it as a comfort feature is not.

### Transitions (§11)

Every transition ≤ 400 ms and interruptible. Pause is instantaneous. Any state
can reach Settings and Settings always returns to its caller. **`Esc` in a
submenu goes back one level, never all the way out** — the prior attempt
rendered the label "Esc resumes" on the pause screen and it did nothing.

---

## 5. Accessibility — design input, not a compliance pass (§35)

- **Colour:** amber `#FF8A3D` vs cyan `#7FE8FF`, never red vs green. Redundant
  encoding is **mandatory** — allegiance is carried by colour *and* silhouette
  *and* motion *and* audio. Removing any one channel must lose no information.
  `--critical` is pure white **and always animated**, so it never depends on hue.
- **Contrast:** all HUD text meets WCAG **AA (4.5:1)** against its actual
  background *including the game behind it* — guarantee it with a semi-opaque
  scrim behind text regions. Critical alerts meet **AAA (7:1)**.
- **Reduced motion (§35.3):** honour `prefers-reduced-motion` and offer a manual
  toggle. Remove camera shake (substitute an edge flash carrying the same
  information), camera roll, speed FOV, particle drift, UI overshoot. **Keep**
  everything gameplay-informative: enemy motion, projectiles, drain beams, ring
  markers, beacon pulses. *Reduced motion must not mean reduced information* —
  pair every removal with a static substitute for the same signal.
- **Input (§35.5):** full remapping; a complete keyboard-only path (arrows steer,
  `Enter` fires, `M` locks); toggle-fire as an alternative to hold-fire; no timed
  chords; no double-taps.
- **Screen readers (§35.6):** menus, settings and results fully navigable —
  semantic HTML, correct roles, visible focus rings, logical tab order. The 3D
  canvas is **not** presented as screen-reader-playable; claiming otherwise would
  be dishonest. It does get an `aria-live="polite"` region announcing outpost
  lost, wave cleared, run ended, and final score, so a screen-reader user always
  knows the game's state. Build this as `ui/a11y/LiveRegion.tsx`.
- **Focus management:** move focus to the new screen's heading on every
  transition. `PausedScreen` needs `role="dialog"`, `aria-modal`, a focus trap,
  and focus restoration on close. The prior attempt had zero `aria-live`, zero
  `.focus()`, and no dialog semantics anywhere.
- Zero axe-core violations on non-canvas UI (§42).

---

## 6. Responsive — not just scaled down (§36)

| Class | Width | Input | HUD |
|---|---|---|---|
| Desktop | ≥ 1280 | mouse+kb, gamepad | full |
| Laptop | 1024–1279 | mouse+kb | full, 90% scale |
| Tablet | 768–1023 | touch | simplified, larger targets |
| Mobile | < 768 | touch | minimal |

**Mobile changes what it shows, not merely how big it is:**

- Outpost Roster collapses from eight rows to a count plus the most-urgent entry
- Altitude ladder becomes a compact bar
- Combo and score merge into one compact top line
- **Threat Ring grows relative to the screen**
- All touch targets ≥ **44 px**, inside `env(safe-area-inset-*)`

Touch controls (§8.3), purpose-built rather than a scaled desktop UI: left thumb
is a **floating** virtual stick appearing where you press; right thumb is a
vertical throttle slider, dragged left/right to trim altitude; **auto-fire ON by
default** because precise aiming on touch is unfair and the game is about
decisions; tap a target to begin missile lock; two-finger tap pauses. Controls
sit at 35% opacity after 3 s of no input.

**Critical:** `TouchControls` must drive its visual knob through **DOM refs, not
`useState`.** The prior attempt called `setStick({x, y})` on every `pointermove`
— a React render per pointer event, continuously, throughout mobile gameplay, on
the platform with the tightest budget. Write the engine intents into the input
struct and the knob position into `element.style.transform`.

Portrait (§36.3) shows a rotate prompt with a **"play anyway"** option, never a
hard block — blocking is hostile when a device is orientation-locked for
accessibility reasons.

---

## 7. Persistence (§32.3)

```ts
{ version: 2,
  settings:  { audio, display, controls, accessibility },
  progress:  { bestScore, bestWave, tutorialCompleted },
  keybinds:  Record<Action, Binding> }
```

Versioned with forward migration. **Validate everything read from
`localStorage` against a schema.** Corrupt or unparseable data resets to
defaults with a toast — it must *never* prevent someone from playing. Wrap all
access in `try/catch`: storage throws in sandboxed iframes and private mode.

Test: v1 → v2 migration preserves data; corrupt input yields defaults.

---

## 8. What the prior attempt got right — carry this over

From `docs/reference/ui-builder/src/`:

- **`game/ThreatRing.tsx`** is close to spec-complete. Four glyphs matching the
  spec table item-for-item, the behind-you inward arrow, the 6-o'clock wrap tick,
  the converging lock bracket (spatial progress, not a percentage readout),
  `role="img"` + `aria-label`. **Reuse the glyph paths and structure nearly
  verbatim.** Change: the proximity direction (§3 above) and the feed (refs, not
  props at 10 Hz).
- **`screens/DebriefScreen.tsx` lines 41-79**, the timeline strip — four outpost
  lanes plus a distinct "You" presence lane, threat windows as spans with a hard
  left border at onset, a marker at the loss moment, lost outposts struck through.
  This is exactly the §12.2 P2 artifact. It needs real data, not a redesign.
- **`screens/WaveClearScreen.tsx`** — `useCountUp` is a clean rAF easing hook with
  correct `cancelAnimationFrame` cleanup, and every stagger timer is cleared.
  `Outposts Saved` is rendered as the hero line at 28px in `--friendly` while
  other lines are 18px, reinforcing what the game is actually about.
- **`index.css` lines 95-101**, the reduced-motion block — it substitutes a
  *static opacity encoding the same urgency level* rather than deleting the
  animation. That is §35.3 implemented literally. Carry the idea into `base.css`.
- **`game/hud-parts.tsx`** — `SegmentedGauge`'s countable segments (with the
  rationale in a comment: countable reads faster than a proportional fill under
  pressure), and `OutpostGlyph`'s five distinct silhouettes so state survives
  greyscale.
- **`screens/PlayScreen.tsx`** HUD proportions — a faithful §14.2 layout. Keep
  the layout; replace the data plumbing.
- **`game/ui.tsx`** — Button, Slider, Toggle, Tabs, KeyBindingRow, Toast are the
  exact six §30.1 names with a consistent visual grammar and correct roles
  (`role="switch"` + `aria-checked`, `aria-label` on sliders).
- **`App.tsx` lines 21-27** — `localStorage` wrapped in try/catch with the
  comment "Storage can throw in sandboxed iframes / private mode — never let it
  block play."
- **`screens/BootScreen.tsx`** — the WebGL2 failure state names the actual cause,
  three specific browsers, and hardware acceleration.

## 9. What to fix — do not carry over

| Defect | Where | Fix |
|---|---|---|
| Tailwind: 756 utility uses, 107 arbitrary values | everywhere | CSS Modules + tokens |
| Google Fonts CDN `@import` | `index.css:1` | self-hosted subset woff2 |
| 12px `.hud-label` in 46 places; 11px and 13px text | `index.css:50` etc. | 14px floor, 16px body |
| Ten `useState` in `App.tsx` for screen state | `App.tsx:38-47` | zustand |
| `setSnap(snapshot)` at 10 Hz re-renders the whole HUD | `PlayScreen.tsx:25-26` | DOM refs |
| `setStick()` / `setThr()` on every pointermove | `TouchControls.tsx:36,52` | DOM refs |
| Fake loading bar | `LoadingScreen.tsx:10-12` | real worker progress |
| Hard-coded Briefing and Debrief data over real props | `BriefingScreen:6-15`, `DebriefScreen:8-18` | props |
| All 11 Settings controls dead | `SettingsScreen.tsx:8-17` | wire + persist |
| No `aria-live`, no focus management, no dialog semantics | everywhere | §35.6 |
| Two crosshairs drawn on top of each other | `ThreatRing:98-105` + `PlayScreen:108-111` | one `LockReticle` |
| Static white `--critical` with no animation | `DebriefScreen.tsx:58` | always animated |
| No artificial horizon, no orbit trail | — | §12.2 P3 |
| Three responsive utilities in the entire codebase | — | §36.2 |
| No safe-area insets | — | `env(safe-area-inset-*)` |
| Touch targets at 24–40px | `ui.tsx:23,122,144` | ≥ 44px |

Also: `src/imports/pasted_text/mare-noctis-hud.md` was a **second, conflicting
source of truth** shipped inside `src/`. It is the origin of the 12px labels and
of four colour tokens that are not in §15.2. Ignore it; `gameplan.md` wins.

---

## 10. What you must NOT touch

- `src/game/**` — the simulation. Read `readModel.ts`; if you need a value that
  isn't exposed, say so rather than adding it yourself.
- `src/render/**`, `src/workers/**` — Task 1 owns these.
- `src/App.tsx`, `src/main.tsx` — the orchestrator owns these.
- `src/styles/tokens.css` — already written. Add new files; don't redefine tokens.
- `package.json` — **do not install anything.** GSAP `^3` is already approved and
  present, for DOM/UI timelines only; it must never touch the scene graph
  (§25.3). Everything else needs justification against §29 first.

---

## 11. Real strings — no lorem ipsum

Outposts, in roster order: **VEGA, CASSINI, KEPLER, TYCHO, HADLEY, AITKEN,
RILLE, NECTARIS**. Import from `@/game/data/outposts`; never re-type them.

Tutorial, three beats, one verb each (§12.3):
1. **FLY** (~25 s) — empty sky, no threats. *"Hold W. Steer with the mouse."*
   Gate: complete one half-orbit. This beat exists to deliver the "I'm orbiting
   a small world" moment before anything competes for attention.
2. **SHOOT** (~20 s) — three inert drones. *"Left click."* Gate: destroy all three.
3. **DEFEND** (~40 s) — one outpost, two Harvesters. Gate: save the outpost.

Skippable, and the skip is remembered. Each beat individually replayable from
Settings.

---

## 12. Acceptance criteria — verify each, show the evidence

- [ ] All 12 states reachable; all transitions correct and ≤ 400 ms
- [ ] **Zero React re-renders during 10 s of `Playing`** — React DevTools
      profiler screenshot
- [ ] `npm run build` clean: zero TypeScript errors, zero lint warnings
- [ ] Zero axe-core violations on non-canvas UI
- [ ] WCAG AA on all HUD text; AAA on critical alerts — report contrast ratios
- [ ] Full keyboard-only run completes, start to finish
- [ ] All information still available with colour, motion, or audio each removed
      individually
- [ ] Settings persist across reload; corrupt localStorage resets safely with a
      toast
- [ ] Touch targets ≥ 44 px, inside safe-area insets — verify on a real phone
- [ ] Threat Ring comprehension ≥ 70% in informal testing (§43 R6)
- [ ] No Tailwind, no CDN request of any kind — check the Network tab
- [ ] No text below 14px anywhere — grep the CSS modules

## 13. How to work

- Branch `phase-6-ui-ux`. Small, focused commits, present tense, imperative,
  referencing the spec: `Add Threat Ring bearing markers (gameplan §12.2)`.
  **Never commit to `main`.**
- **Build the Threat Ring first.** Prototype it early and test comprehension
  rather than polishing it last — it is R6, the highest-risk UI item.
- Report honestly. If a criterion fails, say so plainly and show the output.
- If you are stuck after three genuine attempts, stop and report what you tried,
  what you ruled out, and what you think is happening.
