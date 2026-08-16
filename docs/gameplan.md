# MARE NOCTIS — Moon Game V2

## Master Technical & Design Specification

**Status:** v2.0.0 — Approved baseline
**Document role:** Single source of truth. Where any other document, prompt, or implementation disagrees with this file, **this file wins.**
**Codename rationale:** *Mare Noctis* — "Sea of Night." Lunar maria are real surface features (V1 already generated five of them), and the name anchors the art direction's defining beat: the day/night terminator you cross every orbit.

---

## Table of Contents

| # | Section | # | Section |
|---|---|---|---|
| 1 | Executive Summary | 24 | Camera System |
| 2 | Game Vision | 25 | Animation System |
| 3 | Design Philosophy | 26 | Particle System |
| 4 | Target Audience | 27 | Audio System |
| 5 | Player Personas | 28 | Technology Stack |
| 6 | Core Gameplay Loop | 29 | Library Selection |
| 7 | Game Mechanics | 30 | Frontend Architecture |
| 8 | Controls | 31 | Game Architecture |
| 9 | Progression | 32 | State Management |
| 10 | Difficulty | 33 | Asset Pipeline |
| 11 | Game States | 34 | Performance Budget |
| 12 | UX/HCD Principles | 35 | Accessibility |
| 13 | Psychological Design Principles | 36 | Responsive Strategy |
| 14 | UI/UX Specification | 37 | Testing Strategy |
| 15 | Art Direction | 38 | Deployment Strategy |
| 16 | Lighting | 39 | Security Considerations |
| 17 | Rendering Architecture | 40 | Development Phases |
| 18 | Physics Architecture | 41 | Milestones |
| 19 | Mathematical Models | 42 | Acceptance Criteria |
| 20 | Vector Mathematics | 43 | Risk Register |
| 21 | Calculus Applications | 44 | Competition Strategy |
| 22 | Physics Equations | 45 | Future Expansion |
| 23 | Collision Systems | 46 | Version History |

---

# 1. Executive Summary

**Mare Noctis** is a browser-based 3D orbital defense game. The player pilots a single craft in low orbit around a small moon, defending eight surface outposts from alien harvesters that descend to drain them.

The central design idea is a constraint that emerges from the geometry itself: **on a sphere, you cannot be everywhere.** Threats appear at multiple longitudes simultaneously, and the time it takes to fly around the curve is the game's core resource. Every wave forces a triage decision — *which outpost do I save, and which do I accept losing?*

That single constraint is what separates this from V1 (an endless score shooter with no stakes) and from the large field of browser space-shooters generally. The sphere stops being scenery and becomes the mechanic.

**Technical shape.** React 19 + TypeScript on Vite 7, rendering through React Three Fiber v9 over three r185. A hand-written physics core — fixed 120 Hz timestep, symplectic Euler, radial gravity, swept-sphere continuous collision — replaces both V1's framerate-dependent frame-counting and the off-the-shelf physics engines that assume a uniform down-vector we don't have. All content is procedurally generated at runtime: no textures, no models, no audio files ship in the bundle.

**Quality bar.** 60 fps at 1080p within a 120 draw-call budget, full touch support with a purpose-built control scheme, and accessibility treated as a design input rather than a compliance pass.

**Scope.** Solo developer, 7+ weeks, no fixed deadline. Features are tiered Essential / High-value / Optional / Experimental (§44) so that scope reduction remains a deliberate decision rather than an emergency.

---

# 2. Game Vision

## 2.1 What V1 was

V1 ("Lunar Patrol") is ~1,500 lines of vanilla JavaScript across four files, using three r160 loaded from a CDN import map. The player orbits a moon of radius 100 and shoots green jetpack aliens that rise from the surface. There is score, a combo timer, four power-up types, missile lock-on, and an upgrade level that ticks up every 1,000 points.

**Its real strengths, which V2 preserves:**

- **The spherical setting.** Flying around a small world reads instantly and is genuinely uncommon. V1's implementation — rotating a world-space pivot rather than moving the ship — is a clever trick that sidesteps a lot of frame math.
- **100% procedural content.** V1 ships zero art assets beyond a webfont. Every crater, boulder, outpost, and the ship itself is generated from code. This is a serious competitive advantage (tiny bundle, no asset hosting, nothing to license) and V2 elevates it from an accident to a stated pillar.
- **The X-59 craft silhouette** — long pointed nose, delta wings, twin canted tails. A real identity anchor worth rebuilding rather than discarding.
- **Missile lock-on** as a secondary weapon with a commitment cost. Good bones, poor presentation.

## 2.2 What was broken

These are recorded with file and line because they are the evidence base for V2's decisions. "We changed it because it was measurably broken" is a stronger position than "we redesigned it."

### Correctness

| Defect | Location | Consequence |
|---|---|---|
| **No delta-time anywhere.** `speed += ACCELERATION`, `frameCount % ENEMY_SPAWN_RATE`, `shieldTimer--`, `life--` are all per-frame | throughout `game.js` | A 144 Hz display runs the game **2.4× faster** than 60 Hz. Physics, spawn rate, cooldowns, and power-up durations all scale with refresh rate. Root cause of most "feel" problems. |
| **Camera drift.** Damage adds random X offset to `cameraOffset`; only `.y` is restored each frame | `game.js:784`, `:903` | X accumulates permanently. After several hits the camera is visibly off-centre for the rest of the run. |
| **Projectile tunneling.** Discrete `distanceTo` checks with `BULLET_SPEED = 5` against ~2-unit targets | `game.js:730` | Fast shots teleport past enemies. Explains "shots that should have hit." |
| **The crosshair lies.** Fire direction is lerped 60% toward an auto-aim target while the reticle sits at screen centre | `game.js:510` | The interface asserts precision aiming; the system does something else. A direct violation of feedback honesty. |
| **Level colour undefined past level 3.** A 4-entry array indexed by `upgradeLevel`, capped at 10 | `game.js:676` | HUD silently loses colour mid-run. |
| Dead code: `GRAVITY`/`DRAG` declared, never used | `game.js:66-67` | There is no gravity in V1 despite the constant. |
| Dead code: `UPGRADE_THRESHOLD_1/2/3` never referenced | `game.js:24-26` | — |
| Ambient light added **twice** | `game.js:163`, `:1067` | The second is a "why is it dark" patch appended at the bottom of the file. Together they wash out all lighting and destroy the contrast that makes airless-body lighting dramatic. |

### Performance

| Defect | Location | Consequence |
|---|---|---|
| **A `PointLight` per bullet**, plus a `setTimeout` muzzle-flash light per shot | `game.js:546`, `:559` | Three.js recompiles shader programs when light counts change. At rapid-fire this thrashes continuously. |
| **Nothing is ever disposed.** `scene.remove()` without `.dispose()` on per-bullet and per-particle geometry and materials | throughout | Unbounded GPU memory growth. Guaranteed degradation over a few minutes of play. |
| **~2,000 draw calls of static moon**: a 512×512 `SphereGeometry` (~525k triangles, CPU-displaced at load), 200 crater groups, 400 boulders each with a *uniquely mutated* geometry, 8 bases, 6 landing pads. Zero instancing. | `moon.js` | Multi-second blocking load and an enormous per-frame cost before any gameplay is drawn. |
| **Unbounded enemies** — spawn every 120 frames forever, no cap, no despawn, ~16 meshes each | `game.js:1009` | 300 aliens after ten minutes ≈ 4,800 extra draw calls. Death spiral. |
| Per-frame `new THREE.Vector3()` inside every loop | `game.js` passim | Sustained garbage generation → GC hitching. |
| Shadow map covering the entire moon with a default frustum | `game.js:113-115` | Resolution spread so thin that shadows are effectively absent where the player is. |

### Design

- Enemies rise radially, stop at r + 50, and hover forever. No threat model, no pressure, no reason for the player to move.
- Combo is uncapped within its 150-frame window → score inflation rather than skill expression.
- Missiles fire in pairs at a single target; the first kills it, so the second is **always** wasted.
- `alert()` followed by `location.reload()` is the entire game-over experience. Blocking modal, full page reload, all state destroyed.
- No menu, no pause, no settings, no tutorial, no audio, no mobile support, no accessibility features of any kind.
- `H`/`L` for altitude is undiscoverable. Instructions are 11px `#666` text on black.

### The missed opportunity

`moon.js:233` builds eight detailed habitat domes with corridors, solar arrays, and comms dishes. `moon.js:349` builds six landing pads with markings and edge lights. **All of it is purely decorative.** The game has a setting with stakes built into it and never uses them.

That is the seed of V2.

## 2.3 The V2 pivot

The outposts become the point.

Alien harvesters descend, land beside an outpost, and drain it. A drained outpost is lost for the rest of the run. The player must reach threats and clear them before the drain completes — and because threats spawn at multiple longitudes at once, they **cannot save everything**.

This converts the loop from *"shoot things until you die"* to *"decide what to save."* It costs no new art (the outposts already exist), and it makes the spherical setting load-bearing rather than aesthetic.

## 2.4 Retain / Redesign / Remove / Rebuild

| Verdict | Item | Note |
|---|---|---|
| **Retain** | Spherical orbital flight *concept* | The idea, not the implementation |
| **Retain** | 100% procedural, zero-asset content | Elevated to a stated pillar |
| **Retain** | X-59 craft silhouette | Rebuilt as merged, material-batched geometry |
| **Retain** | Lock-on secondary weapon | Now with a world-space reticle and a single missile |
| **Redesign** | Combo system | Capped at ×5; rewards accuracy, not just rate |
| **Redesign** | Missile lock UX | World-space reticle on the target, not a text percentage |
| **Redesign** | Difficulty progression | Wave-authored, along readable axes (§10) |
| **Remove** | Auto-aim that redirects bullets | Replaced by visible reticle magnetism (§8.4) |
| **Remove** | Random power-up drops | Replaced by outpost-linked resupply (§7.5) |
| **Remove** | `alert()` / `location.reload()` | Replaced by the Debrief screen (§11) |
| **Remove** | `H`/`L` altitude keys | Replaced by Space/Ctrl |
| **Rebuild** | Entire physics core | Fixed timestep, radial gravity, CCD (§18) |
| **Rebuild** | Entire render pipeline | Instancing, baked maps, ≤120 draw calls (§17) |
| **Rebuild** | Moon generation | Icosphere + Web Worker baked maps (§33) |
| **Rebuild** | All UI | Twelve real screens, HUD with a Threat Ring (§14) |
| **New** | Audio, accessibility, touch, settings, tutorial, save system | Absent entirely in V1 |

---

# 3. Design Philosophy

Ten principles. Where two conflict, the lower number wins.

1. **Gameplay first.** Visual effects never compensate for weak gameplay. If an effect were removed and the game got *better to play*, it should not exist.
2. **UX before decoration.** Every interface element earns its pixels by answering a question the player is actually asking.
3. **Performance is a feature.** A dropped frame during a triage decision costs more than any shader gains.
4. **Mathematics must have a purpose.** Every equation in this document is load-bearing. Nothing appears to look sophisticated. Where a simpler method suffices (§18.3, on rejecting RK4), the simpler method is used and the rejection is documented.
5. **Complexity must be justified.** The simplest architecture that achieves the result. Every dependency in §29 states what breaks without it.
6. **Browser constraints matter.** This is designed for a browser tab on a mid-range laptop with other tabs open, not a dedicated GPU.
7. **Build incrementally.** The game is playable at the end of every phase in §40. There is no "it'll come together at the end."
8. **Avoid feature creep.** §44 tiers every feature. The Experimental tier is explicitly permitted to be cut without consequence.
9. **Accessibility is design.** Decided at specification time (§35), not retrofitted.
10. **Every major decision needs a rationale.** Including the decisions *not* to do something.

---

# 4. Target Audience

**Primary:** Competition judges and portfolio reviewers. Technically literate, time-constrained, evaluating many entries in sequence. They will play for **90 seconds to 3 minutes**. The game must communicate its idea inside the first 30 seconds without a manual.

**Secondary:** Casual browser players, 16–35, arriving from a link with no context and no installed anything. They expect to click and play. They will leave if the first interaction is confusing.

**Tertiary:** Fellow developers inspecting the source. They judge architecture, not just output.

**Design consequences:**

- The **first 30 seconds must contain the core idea.** The tutorial's first beat is free flight around the sphere, because the "oh, I'm orbiting a small world" moment is the hook and must not be buried behind menus.
- **No dependency on a manual.** Controls are discoverable in-context.
- **Sessions are 3–8 minutes.** A run must be completable in a judging window. No 40-minute campaigns.
- **Immediately impressive on a phone**, because a judge will open the link on whatever is in their hand.

---

# 5. Player Personas

### Persona A — "Mira," the judge (primary)

Evaluating 40 entries in an afternoon. Opens the link, plays 2 minutes, forms a judgment.

- **Goals:** Understand the idea fast. See technical and design competence. Find something memorable.
- **Frustrations:** Loading screens with no progress. Tutorials that lecture. Games where she can't tell what's happening or why she lost.
- **Skill:** Competent gamer, not an expert at this game.
- **Design response:** Loading shows real progress from actual work being done. Tutorial is playable within 8 seconds. Debrief explains the loss in one sentence.

### Persona B — "Dan," the casual visitor (secondary)

Clicked a link on a phone during a commute.

- **Goals:** Quick fun, no commitment.
- **Frustrations:** Desktop UI shrunk onto a phone. Controls needing three fingers. Text he can't read.
- **Skill:** Plays mobile games; no flight-sim vocabulary.
- **Design response:** Purpose-built touch scheme with auto-fire on by default (§8.3). Device-tier detection. Minimum 16px body text.

### Persona C — "Sam," the enthusiast (secondary)

Plays for score, wants mastery.

- **Goals:** A skill ceiling. Optimise routes. Beat a personal best.
- **Frustrations:** Aim assist he can't turn off. Randomness that decides runs. Uncapped combos that make score meaningless.
- **Skill:** High.
- **Design response:** Assist is a 0–100% slider. Combo capped at ×5. Wave composition is seeded and deterministic (§10.4). Score breakdown is fully itemised.

### Persona D — "Ana," the accessibility-dependent player

Has deuteranopia and finds heavy screen motion uncomfortable.

- **Goals:** Play the actual game, not a degraded version.
- **Frustrations:** Red-vs-green threat coding. Screen shake she can't disable. "Accessibility modes" that remove content.
- **Design response:** Threat coding is amber-vs-cyan, redundantly encoded by shape, motion, and audio (§35.1). Reduced motion removes shake but keeps every piece of gameplay-informative motion. Difficulty is split into independent axes rather than one preset.

---

# 6. Core Gameplay Loop

The brief requires this to be concrete rather than abstract. Here is one full cycle with real numbers.

```
INPUT      Mouse steers the craft. W holds throttle.
             The crosshair IS the nose direction — always.
   ↓
ACTION     Player banks toward the Vega outpost, 40° of arc away.
   ↓
FEEDBACK   Engine pitch rises with velocity. The horizon rolls.
             Threat Ring: two amber wedges — one at bearing 015°
             (near), one at 200° (far side, behind the curve).
   ↓
CHALLENGE  Both outposts are being drained, 3 Harvesters each.
             Drain rate = 3 × 0.8%/s = 2.4%/s. Clearing 3 ≈ 3.9 s.

             Vega:    55% drained → 45% left → falls in 18.8 s · 7 s away
             Cassini: 45% drained → 55% left → falls in 22.9 s · 15 s away

             Vega first:    4.0 + 3.9 = 7.9 s   → SAVED (2.8 s spare)
                            then 8 s to Cassini, cleared at 19.8 s
                            vs. its 13.1 s deadline → LOST
             Cassini first: 9.0 + 3.9 = 12.9 s  → SAVED (0.2 s spare)
                            Vega falls at 10.7 s, unreachable → LOST

             Each is savable alone. Neither route saves both.
   ↓
DECISION   ── THE CORE OF THE GAME ──
             Take the safe save and lose the one you could have had?
             Or commit to the 0.2-second window and lose the easy one?
   ↓
CONSEQUENCE Player commits to Vega. Clears 3 Harvesters in 3.9 s.
             Vega survives at 22% integrity.
             At 0:47 Cassini's drain completes. The outpost goes
             dark — visibly, on the surface, permanently for this run.
   ↓
REWARD     +450 Outpost Saved (Vega)
             +300 kills · ×2.4 accuracy bonus
             Vega now resupplies: hull repair + Heat purge on pass
   ↓
PROGRESSION Wave 4 begins. Seven outposts remain.
             Interceptors are introduced — they chase, so standing
             still is no longer safe.
   ↓
REPEAT     with one fewer resupply point and one more threat type.
```

**Why this works psychologically.** The decision is genuinely uncomfortable and genuinely *the player's*. Losing Cassini is not a punishment handed down by the system — it is the visible consequence of a choice the player made and understood at the time. That is the difference between a loss that teaches and a loss that frustrates (§13.4).

---

# 7. Game Mechanics

## 7.1 The Moon

A scaled fictional body, not Luna to scale. **Radius R = 100 world units.** The playable shell is a spherical annulus:

| Parameter | Value | Note |
|---|---|---|
| Surface radius `R` | 100 u | |
| Minimum altitude `h_min` | 8 u | Below this, terrain proximity warning; at 4 u, crash |
| Maximum altitude `h_max` | 70 u | Above this, thrust cuts out — a soft ceiling, not a wall |
| Nominal cruise altitude | 25 u | |
| Circumference at cruise | 2π(125) ≈ 785 u | |

**Travel-time budget** (this number *is* the game's difficulty dial):

- Cruise speed 26.0 u/s → full circumnavigation **24.2 s**, antipode **12.1 s**
- Boost speed 36.8 u/s → circumnavigation **17.1 s**, antipode **8.5 s**

A drain takes 31–42 s depending on Harvester count. So the antipode is *reachable but expensive* — exactly the tension the design needs.

**"Tune drain rate, never travel speed" was the original rule here, and it was
wrong.** Travel speed is not sacred — it is one half of a ratio, and the first
tuning got the *absolute* value badly enough wrong that the game was unreadable
at 44.7 u/s. What must be preserved is the ratio of travel time to drain
deadline, and the way to preserve it is to move both together, in the same
commit, with the balance harness checking the relationship rather than either
number. See §22.3.

## 7.2 Outposts

Eight, at fixed positions distributed by a Fibonacci sphere lattice so no two are trivially close. Each has a name (Vega, Cassini, Kepler, Tycho, Hadley, Aitken, Rille, Nectaris) so the Debrief can refer to them specifically — *"Lost Cassini"* is memorable in a way *"Outpost 3"* is not.

| State | Integrity | Visual | Audio |
|---|---|---|---|
| **Nominal** | 100% | Cyan beacon, slow pulse | Silent |
| **Threatened** | Harvesters inbound | Amber beacon, medium pulse | Distant alert chirp |
| **Draining** | falling | Amber, fast pulse; visible drain beam | Rising urgency tone |
| **Critical** | < 25% | White strobe | Insistent, ducks music |
| **Lost** | 0% | Goes dark. Structure stays, unlit | One-shot power-down |

Lost outposts stay lost for the run. **Losing all eight ends the run** — this is the fail state, replacing V1's hull-based death. Hull damage still matters (§7.6) but destruction sends you to a respawn with a time penalty rather than ending the run, because a time penalty is the currency this game is actually about.

**Design note.** Making hull loss a *time* cost rather than a run-ending event is deliberate. In a triage game, the worst punishment is not death — it is being unable to be where you're needed. This keeps every consequence denominated in the same currency.

## 7.3 Enemies

Six archetypes. Distinguished by **silhouette and behaviour first**, colour second (§35.1).

The first three are the teaching arc and carry waves 1–7 unchanged. The last three arrive one per wave from 8, and each exists because **the first three cannot ask its question**: the Harvester is a clock you can arrive late to, the Interceptor is a fight, the Sentinel is a position. Adding more of any of them past a handful is volume, not difficulty.

### Harvester — the objective threat
- **Silhouette:** Squat, hexagonal, four legs. Slow, deliberate.
- **Behaviour:** Spawns on a ballistic arc from beyond the horizon, lands beside an outpost, deploys a drain beam. Does not attack the player.
- **Health:** 3 hits. **Threat:** Drains 0.8% integrity/second while landed.
- **Counter:** Kill it before it lands (harder, no drain) or after (easier, drain already ticking).
- **Role:** The clock. Everything else exists to stop you reaching them.

### Interceptor — the pressure
- **Silhouette:** Narrow dart, swept back. Fast, jittery.
- **Behaviour:** Pursues the player with a steering-force model (§20.5). Fires short bursts with lead prediction.
- **Health:** 2 hits. **Threat:** 6 hull damage per hit.
- **Counter:** Outmanoeuvre or kill. Ignoring them is viable briefly, then costly.
- **Role:** Makes travel dangerous, so triage isn't purely arithmetic.

### Sentinel — the wall
- **Silhouette:** Broad, angular, front-facing shield plate. Rotates slowly.
- **Behaviour:** Parks in orbit over an outpost. Directional shield blocks fire from the front arc. Must be flanked.
- **Health:** 6 hits to the body; shield is immune.
- **Threat:** Area denial; slow heavy shots.
- **Counter:** Flank it — which costs time, the scarce resource.
- **Role:** Converts a time problem into a *positioning* problem. Introduced Wave 6.

### Sapper — the deadline

- **Silhouette:** Small forward-swept wedge, no cockpit, trailing a hard bright line. Comes in *under* the traffic at 16 u, so it reads as a different kind of movement rather than as a Harvester in a hurry.
- **Behaviour:** Runs flat and fast at one outpost, arms for 0.9 s where everything can see it, then commits straight down and detonates on the surface. Never fires. Never steers once armed.
- **Health:** 1 hit. **Threat:** 14 integrity in one stroke, plus 16 hull to the craft inside an 18 u blast.
- **Counter:** See it and shoot it. One hit is always enough.
- **Role:** The deadline. Every other objective threat is a clock you can arrive late to — reaching a Harvester with eight seconds left still saves eight seconds. A Sapper has **no partial credit**, so the only way to lose to one is to have been somewhere else, which is the game's subject. Introduced Wave 8.

**A detonation is not a kill.** It bypasses the kill path entirely: no score, no bounty, no combo. A Sapper reaching its target is a failure, and paying the player for it would say otherwise.

### Warden — the priority

- **Silhouette:** Three-armed ring on a slim column, the field hanging off the arms. Stations at 52 u — above the Sentinel, below the Carrier.
- **Behaviour:** Parks over an outpost and projects a **radial** field of 46 u that makes every *other* hostile inside it immune. Fires slow heavy shots like a Sentinel.
- **Health:** 8 hits. It is never shielded — not by itself, and not by another Warden. Two of them covering each other would be unkillable, which is the emergent lock a "protects nearby allies" rule produces if nobody writes the exception down.
- **Threat:** 7 hull per hit, plus everything it is currently covering.
- **Counter:** Kill it first. Positioning does nothing.
- **Role:** The priority, and the Sentinel's question from the other side. A Sentinel says *move*, because its shield is directional and flanking beats it. A Warden says *retarget*, because no amount of positioning gets damage through. It is the only archetype that changes what to shoot rather than where to stand. Introduced Wave 9.

The field is **drawn**, and every absorbed round says so where it landed. Damage silently failing is the exact fault the Sentinel's visible shield arc was rebuilt to remove, and a radial field has no silhouette of its own to make its boundary legible.

### Carrier — the source

- **Silhouette:** Broad slab hull with an open launch bay underneath. The biggest thing in the sky, parked at 72 u.
- **Behaviour:** Holds high station over an outpost and launches a fresh Harvester every 11 s, indefinitely. **Unarmed.**
- **Health:** 14 hits. **Threat:** Not to the craft — to work already done.
- **Counter:** Kill it, or out-clear it. Both are legitimate. One costs seconds now; the other costs seconds on every future trip to that outpost.
- **Role:** The source, and the sharpest triage question in the game. Clear the outpost beneath a live Carrier and it is threatened again before you have reached the next one — the only hostile whose existence *undoes* work. It does not shoot precisely so that the cost of going after it is only the seconds, never a fight. Introduced Wave 11.

**Population cap: 48 concurrent.** Spawns beyond the cap queue rather than dropping, so difficulty stays authored rather than emergent. This directly fixes V1's unbounded growth. A Carrier's launches draw from the same pool and **defer** rather than drop when it is full, by the same rule.

Six types do not fit inside 48 at the old ceilings, so Endless was re-cut: 25 Harvesters (untouched — they are the drain clock, and the whole difficulty of a deep wave is how fast integrity falls), then 10 Interceptors (was 14), 4 Sentinels (was 8), 4 Sappers, 3 Wardens, 2 Carriers. Cutting the first two rather than shaving all six evenly is the point: past a handful, more Interceptors or Sentinels adds volume without adding a decision, while a Carrier or a Warden changes what the player has to *do*. A deep Endless wave is harder than it was with fewer things in it.

## 7.4 Weapons

### Primary — Pulse Cannon
- Hitscan-adjacent fast projectiles, 220 u/s, with **swept-sphere CCD** (§23.2) so they cannot tunnel.
- **Fires exactly along the nose ray. Always.** No hidden redirection.
- **Heat instead of ammo.** Each shot adds 4% heat; heat decays 30%/s after a 0.4 s delay. At 100% the weapon locks out for 1.5 s with an unmistakable audio-visual cue.

**Why heat, not ammo.** Ammo requires pickups, which requires spawning them, which pulls attention away from the outposts. Heat is self-regulating, needs no world objects, and creates a rhythm — burst, reposition, burst — that fits flying. It also makes the "hold the button forever" strategy self-defeating without punishing the player with scarcity.

### Secondary — Lock Missile
- Hold RMB with a target inside the lock cone (18° half-angle) for **1.2 s** to acquire. A world-space reticle converges on the target — the feedback is spatial, not a text percentage.
- **One missile per lock**, not V1's wasteful pair.
- Proportional-navigation guidance (§20.6), not naive lerp-toward-target.
- 3 s cooldown. One-shots Harvesters and Interceptors; two are needed for a Sentinel.
- **Role:** A commitment. Locking costs you 1.2 s of attention you could spend flying.

### Boost
- 2.4× thrust for up to 3 s, 6 s recharge. The tool that makes a far outpost *reachable* — and the decision to spend it is part of triage.

## 7.5 Resupply

Surviving outposts are useful, not merely scoreable. Flying within 15 u of a nominal outpost triggers a resupply pass: **+18 hull, full Heat purge, boost recharged**, 20 s cooldown per outpost.

**Why.** It makes outposts instrumentally valuable, not just point-scoring. Losing one degrades your future capability, so the stakes are felt mechanically rather than just narratively. It also replaces V1's random power-up drops with something spatially meaningful — you route *through* your territory.

## 7.6 Hull

100 hull, no regeneration outside resupply. At 0: the craft is destroyed, and after a 4 s respawn you return at the nearest surviving outpost with 50 hull. **The cost is the 4 seconds**, denominated in the same currency as everything else.

## 7.7 Scoring

| Source | Points | Rationale |
|---|---|---|
| Harvester killed **before landing** | 150 | Rewards proactivity |
| Harvester killed after landing | 80 | Still useful, less optimal |
| Interceptor | 100 | |
| Sentinel | 250 | |
| Sapper **shot down** | 120 | A Sapper that *detonates* pays nothing at all — see §7.3 |
| Warden | 300 | |
| Carrier | 450 | The largest kill, because it is the only one that prevents future work |
| **Outpost survives a wave** | **400** | The largest single source — rewards the *decision layer* |
| Wave cleared with all outposts intact | 800 | |
| Accuracy bonus | ×(1.0 – 2.5) | Hits ÷ shots, applied at wave end |
| Combo | ×1 – ×5, **capped** | Skill expression, not exponential inflation |
| No-damage wave | 300 | |

Outposts saved outscore kills by design. A player who optimises for score is thereby optimising for the thing the game is actually about.

---

# 8. Controls

> **Rewritten August 2026.** The original table in this section described a
> scheme the game no longer has, and had been wrong in three separate ways for
> months: it listed a "Roll" axis the simulation does not have, a "Throttle up"
> key whose only possible effect was to undo the brake, and bindings stored as
> `KeyboardEvent.key`. `src/platform/controlScheme.ts` is now the canonical
> table; this section explains the *reasoning*, and `docs/CONTROLS.md` prints the
> current bindings.

## 8.1 The organising idea

**Bare WASD are flight verbs. Modified WASD and the arrow keys are translation
verbs.**

```
  BARE                  MODIFIED (⌃ macOS · Alt elsewhere)   ARROWS
  W   boost             ⌃W  climb                            ↑   climb
  S   brake             ⌃S  dive                             ↓   dive
  A   turn left         ⌃A  slide left                       ←   slide left
  D   turn right        ⌃D  slide right                      →   slide right

  Space  fire     Shift  missile lock     Tab  orbital map     Esc  pause
  Mouse / trackpad  aim          R  recentre aim
```

**Turning changes where the nose points; sliding does not.** That distinction is
the reason the translation axis exists. Before it, flight had exactly one way to
avoid something — turn — and turning costs heading, which is the currency every
decision in this game is priced in. Every dodge was therefore paid for with the
outpost you were flying towards.

Keeping the two families on separate rows, or behind a modifier, is what stops
them being confused for each other at the moment the player most needs to choose.

## 8.2 Three rules the bindings obey

**Bindings are physical keys.** `KeyboardEvent.code`, never `.key`. `.key` is the
*character produced*, so holding a modifier changes it (`A` rather than `a`), a
French keyboard changes it, and Space is the invisible string `' '`. All three
were live bugs.

**Every action holds a list, and all of it is live.** "WASD or the arrows" is not
a setting a player should have to find; both work, always. Two slots per action.

**A chord is exclusive, but only over the modifiers that are chords.** While the
translate modifier is held, `A` must mean slide and must *not* also mean turn.
But comparing the *whole* modifier state exactly would be a bug in the other
direction: lock is bound to Shift, so holding it to lock a target while turning
delivers `KeyA` with the Shift bit set, and steering would die the instant a
player held lock. Matching is therefore exact over the modifiers used as chord
prefixes somewhere in the table, and blind to the rest.

## 8.3 Why the translate modifier differs by platform

**`Ctrl+W` closes the tab on Windows and Linux, and no page can intercept it.**
Binding "climb" there would ship a control that quits the game. On macOS that
shortcut is `⌘W`, leaving `⌃W` free — so the game uses Control there and Alt
everywhere else, and Settings refuses browser-owned chords with a stated reason
rather than silently doing nothing.

The arrow keys are the modifier-free path on every platform, so no player ever
depends on a chord being available.

## 8.4 Pointing devices

A trackpad is not a mouse and cannot share its tuning. Mouse steering is a rate
control whose gain is derived so a sustained 750 px/s sweep reaches full
deflection — a comfortable movement on a desk, and one a 3 cm trackpad cannot
make at all. The same gesture produced a third of the turn, and winding the
sensitivity slider up does not fix it: it makes small corrections unusable,
because the curve was shaped for a device with ten times the resolution.

Two profiles, chosen by watching the shape of the `wheel` event stream — notched
wheels emit large quantised deltas, trackpads emit dense runs of small fractional
ones, and `deltaMode: DOM_DELTA_LINE` is conclusive on its own. That is a strong
signal and still a guess, so `Pointer: Auto / Mouse / Trackpad` exists in Settings
and always wins.

Trackpad two-finger scroll commands altitude. Pinch is swallowed during play: its
default is to zoom the *page*, which on a full-bleed canvas leaves the HUD half
off-screen with no obvious way back.

## 8.5 Gamepad

Standard twin-stick via the Gamepad API. Left stick turns and aims, right stick
slides and climbs — the pad's equivalent of the keyboard's bare-versus-modified
split. Triggers throttle, A fires, B locks, LS-click boosts, Start pauses.

Rumble via `vibrationActuator` for hits, terrain impacts, lock acquisition and
outpost loss, rate-limited so a firefight is a series of distinct hits rather
than one continuous buzz, and disabled under Reduced Motion — a player who has
asked the system to stop moving things has not asked for the controller to shake
instead. Like audio, it is always a *third* channel and never load-bearing.

## 8.6 Touch

Purpose-built, not a scaled desktop UI, and genuinely multitouch: every widget
owns its own `pointerId` and keeps its role until that pointer lifts, so
steering, throttle and firing are three fingers rather than three turns.

- **Left thumb:** a floating stick that appears wherever the thumb lands.
- **Left edge:** a slide rocker — its own widget, because a single stick cannot
  express turning and sliding at once. A thumb pushed left has to mean one thing.
- **Right thumb:** vertical throttle; drag sideways to trim altitude.
- **Action buttons:** fire, boost, lock, pause — all usable while steering.
- **Tap a threat marker** on the Threat Ring to lock that specific target. This
  is the only way to pick one Harvester out of four stacked over an outpost when
  there is no pointer to aim with.
- **Auto-fire is available** but off by default; precise aiming on glass is
  unfair, and the game is about decisions.
- Controls sit inside safe-area insets and fade to 34% after 3 s of no input.

**Two-finger tap no longer pauses.** It fired the instant a player reached for
the throttle while steering, which on a multitouch surface is constantly. There
is an explicit pause button.

## 8.7 Aim assist — the honesty rule

**V1's crosshair lied** (`game.js:510`). V2's cannot.

- Bullets always travel exactly along the nose ray.
- Assist is expressed as **visible reticle magnetism**: when the reticle passes near a valid target, the reticle itself is pulled toward it with visible, eased motion. The player *sees* the assist happen. Bullets still go exactly where the reticle points.
- Strength is a **0–100% slider**, defaulting to 35% on desktop, 70% on touch.

This is the only honest way to implement aim assist: the system may help, but it may never contradict what the interface asserts.

## 8.8 Control feel requirements

- Input → visible response: **< 50 ms**. Never buffer input across frames.
- Craft rotation uses a critically damped spring toward the input target (§22.4) — responsive without twitchiness.
- 8% mouse deadzone at centre to prevent drift.
- Every action has a distinct audio signature, so the player can play partly by ear.

---

# 9. Progression

> **August 2026.** The system below is built and, until this pass, was almost
> entirely invisible: thirty levels, a title every five, thirty parts and four
> earned liveries, all of it surfacing as one line on the Title screen and a bar
> on the Results panel. A player could not answer "how far am I", "what have I
> earned" or "what is next" without reading the source. `ProfileScreen` is where
> that lives now.
>
> The line this section draws is unchanged and non-negotiable: **no currency, no
> daily rewards, no energy timers, no randomised loot boxes, no login streaks.**
> Every one of those exists to bring a lapsed player back on a schedule the game
> controls. XP is a receipt for a run that already happened, not a hook to start
> another one.

> **Amendment, August 2026 — this section has been superseded in part.**
>
> The original rule below forbade all meta-progression. The project owner has
> since asked for pilot levels, unlockable ship parts, an assembler and cosmetic
> liveries, and that instruction supersedes this section. What follows records
> both the original reasoning and what actually shipped, because the argument
> against meta-progression was a real one and the implementation is shaped by
> taking it seriously rather than by discarding it.
>
> **What shipped:** 30 pilot levels earned from run performance; 30 ship parts
> across six slots, each with a genuine buff *and* a genuine nerf; set bonuses at
> two and four matching manufacturers; twelve cosmetic liveries; Endless mode
> after a wave-12 victory.
>
> **What the original objection bought us.** "It would gate content behind
> repetition — hostile to a judge who plays once" is answered structurally, not
> waved away:
>
> - **The stock loadout is exactly the tuning in `constants.ts`.** Slot 0 of
>   every slot is neutral, asserted by `tests/integration/balance.test.ts`. A
>   first-time player is playing the balanced game, not a handicapped one.
> - **No part is strictly better.** Every non-stock part carries both a buff and
>   a nerf, again machine-checked. Parts are lateral choices, so a level-30
>   pilot is differently equipped, not more powerful.
> - **Cruise speed is clamped to ±8%.** No stack of parts can escape the band
>   that all the game's stated deadlines are computed from.
> - **Every triage wave keeps at least two viable routes at every extreme of the
>   loadout space,** which is the invariant the whole game exists to produce.
> - **No currency, no daily rewards, no energy timers, no randomised loot.** XP
>   comes from performance only.
>
> The rest of this section still describes the *within-a-run* design, which is
> unchanged.

> **Amendment, 2026-08-16 — one line of the amendment above is now false.**
>
> Both blocks above promise **"no currency, no daily rewards, no energy timers,
> no randomised loot."** There is a currency. It is called credits, it is earned
> from kill bounties and from sector revenue at wave end, it persists at schema
> v7, and it is spent in the Hangar to buy ship parts. Saying so plainly is the
> point of this block: the clause was written down as a guarantee, and a
> guarantee that quietly stops holding is worse than one that was never made.
>
> **What is true now:**
>
> - Credits are **earned only**. There is no way to buy them, and there is
>   nothing in the game or outside it that sells them. The project has nothing
>   to monetise.
> - **No daily rewards, no energy timers, no login streaks, no randomised loot
>   boxes, no timed offers, nothing time-gated.** Every other clause in both
>   lists above stands, unqualified. Nothing in this game happens on a schedule
>   the game controls.
> - Credits are spent on the same thirty parts the level table already gated.
>   They add a second axis to an existing choice; they do not add a new kind of
>   thing to want.
>
> **Why the original objection is still answered.** The argument against
> meta-progression was never really about the word *currency* — it was about two
> concrete harms, and both are still structurally prevented:
>
> - *"It would gate content behind repetition — hostile to a judge who plays
>   once."* Stock is slot 0 of every slot, it is exactly the tuning in
>   `constants.ts`, and `partCost` returns **0** for it, forever, for everyone.
>   A first-time player is playing the balanced game, complete, at full price of
>   nothing. `tests/unit/economy.test.ts` asserts it, alongside the property that
>   every non-stock part costs more than zero — so the failure that produced this
>   amendment cannot recur silently.
> - *"It exists to bring a lapsed player back on a schedule the game controls."*
>   A currency you can only obtain by playing well, in a game with nothing to
>   sell, has no schedule to enforce. It is the same receipt XP is, denominated
>   differently.
>
> **What it honestly costs.** A well-played twelve-wave campaign pays roughly
> 15,000 credits against a catalogue that costs far more, so one run kits out
> most of one build and no run kits out all of them. That *is* a form of content
> behind repetition, and pretending otherwise would be the dishonest version of
> this note. The defence is that what repetition buys is **lateral**: every part
> carries a real nerf beside its buff, cruise speed stays clamped to ±8%, and
> every triage wave keeps two viable routes at every extreme of the loadout
> space. A level-30 pilot with a full catalogue is differently equipped, not more
> powerful — so the thing a second run unlocks is a different question to answer,
> not a higher number to answer it with.
>
> One line changed. The rest of the guarantee is intact, and the parts of it that
> the original argument was actually defending are the parts that held.

Progression is **within a run**, not across runs. There is no unlock grind, no persistent upgrade tree, no currency. A run is a self-contained 6–10 minute arc, which suits a judging window and respects the player's time.

**Across runs, only these persist:** personal best score, furthest wave, settings, keybindings, tutorial-completed flag. *(Amended: also pilot XP, credits, purchased parts, the equipped loadout and its per-slot tuning, the selected livery and world, and the achievement flags. See `src/state/persistence.ts`, schema v7.)*

**Why no meta-progression.** It would gate content behind repetition — a dark pattern in a competition context, and actively hostile to a judge who plays once. The game must be fully itself on the first run.

**Within a run**, escalation comes from wave composition (§10), not from player stat growth. The player's capability is constant; the situation gets harder. This keeps the skill expression honest.

**Waves 1–12** form a designed arc with a defined ending (§10.2). Clearing Wave 12 with outposts remaining is a **victory**, with a distinct Results presentation. Endless Mode unlocks afterward for Persona C.

---

# 10. Difficulty

## 10.1 The axes

Difficulty rises along axes the player can *perceive and adapt to*:

1. **Simultaneity** — how many outposts are threatened at once. **The primary axis**, because it directly stresses the triage decision.
2. **Composition** — which archetypes, in what mix.
3. **Drain rate** — how fast the clock runs.
4. **Spatial spread** — how far apart threats are (arc distance between threatened outposts).

Enemy *health* and *damage* are held nearly constant. Inflating those makes a game feel unfair; inflating simultaneity and spread makes it feel *demanding*, which is the goal.

## 10.2 The wave arc

| Wave | Threatened at once | New element | Intent |
|---|---|---|---|
| 1 | 1 | Harvesters | Teach the drain and the kill |
| 2 | 1 | — | Build confidence |
| 3 | **2, adjacent** | — | First triage — but both are savable. A rehearsal. |
| 4 | 2 | Interceptors | Travel becomes dangerous |
| 5 | 2, spread | — | Real triage: you will lose one |
| 6 | 2 | **Sentinels** | Positioning problem |
| 7 | 3 | — | Overload begins |
| 8 | 3, wide spread | **Sappers** | Worse geometry, plus the first threat with no partial credit |
| 9 | 3 | **Wardens** | The composition itself is the difficulty — and one thing in it changes what to shoot |
| 10 | 4 | — | Peak pressure |
| 11 | 3 | **Carriers** | Fewer fronts, harder ones — and the first threat that undoes work already done |
| 12 | 4, full spread | All six archetypes | Finale |

**Wave 3 is deliberately winnable.** The player's first taste of triage should be one they can solve, so they learn the *shape* of the decision before they face one with no good answer at Wave 5. Teaching a mechanic and testing it in the same beat is a common design error.

**Waves 1–7 are untouched by the late archetypes.** They are the teaching arc, and letting a Sapper or a Warden leak backwards into them would test a mechanic before it was taught — the same error the Wave 3 / Wave 5 pairing exists to avoid, made one layer up. The back third had nothing new to say with three archetypes; it was varying simultaneity and spread over a composition the player had fully understood since Wave 6, which is volume rather than difficulty.

## 10.3 Dynamic difficulty adjustment — bounded and disclosed

DDA exists, and it is **capped at ±15%** on spawn interval and drain rate only.

- If a player loses 2 outposts in 2 waves, intervals lengthen up to +15%.
- If a player clears 3 waves untouched, they shorten up to −15%.
- **It never touches enemy damage or health**, so the moment-to-moment feel stays honest.
- **It is disclosed in Settings and can be switched off.** Hiding difficulty manipulation from players is manipulative; offering it as an accessibility and comfort feature is not.

## 10.4 Determinism

Wave composition is generated from a **seeded PRNG** (`seed = hash(runId, waveNumber)`). Two players with the same seed face identical waves. This makes runs comparable, makes bugs reproducible, and gives Persona C something to optimise against. The seed is shown on the Debrief screen and can be entered manually for practice.

## 10.5 Accessibility difficulty axes

Independent sliders, not presets (§35.4): Enemy Damage (0–150%), Drain Rate (50–150%), Enemy Speed (75–125%), Aim Assist (0–100%), Infinite Boost (on/off). Scores from modified runs are flagged in the locally stored personal-best record rather than hidden — the player's achievement is real, and comparability is preserved.

---

# 11. Game States

Twelve canonical states. **These exact names are used in all documents and in code.**

```
                         ┌──────────┐
                         │   Boot   │  feature detection, WebGL2 check
                         └────┬─────┘
                              ↓
                         ┌──────────┐
                         │ Loading  │  worker bakes maps · REAL progress
                         └────┬─────┘
                              ↓
        ┌────────────────►┌──────────┐◄──────────────┐
        │                 │  Title   │               │
        │                 └────┬─────┘               │
        │      ┌───────────────┼───────────┬─────────┴──┐
        │      ↓               ↓           ↓            │
        │ ┌──────────┐   ┌──────────┐ ┌─────────┐ ┌──────────┐
        │ │ Settings │   │ Tutorial │ │ Credits │ │ Briefing │
        │ └────┬─────┘   └────┬─────┘ └────┬────┘ └────┬─────┘
        │      └──────────────┴────────────┘           ↓
        │                                        ┌──────────┐
        │                              ┌────────►│ Playing  │◄──┐
        │                              │         └────┬─────┘   │
        │                              │              │         │
        │                        ┌─────┴─────┐   ┌────┴────┐    │
        │                        │ WaveClear │   │ Paused  │────┘
        │                        └───────────┘   └────┬────┘
        │                              ▲              │ quit
        │                              └──────────────┼─────┐
        │                                             ↓     │
        │                                       ┌──────────┐│
        │                                       │ Debrief  ││ per-wave or run end
        │                                       └────┬─────┘│
        │                                            ↓      │
        │                                       ┌──────────┐│
        └───────────────────────────────────────│ Results  │◄┘
                                                └──────────┘
```

| State | Purpose | Sim | Render |
|---|---|---|---|
| **Boot** | Capability detection, tier selection | ✗ | ✗ |
| **Loading** | Worker generates terrain maps; real progress | ✗ | Loading visual only |
| **Title** | Entry. Live moon behind the menu. | Idle orbit | ✓ |
| **Settings** | Overlay. Reachable from Title and Paused. | frozen | ✓ dimmed |
| **Tutorial** | Three-beat onboarding (§12.3) | ✓ scripted | ✓ |
| **Briefing** | 4 s pre-wave orientation: which outposts, what's coming | ✗ | ✓ |
| **Playing** | The game | ✓ | ✓ |
| **Paused** | Frozen. Accumulator reset on resume. | ✗ | ✓ dimmed + blurred |
| **WaveClear** | 3 s celebration + score breakdown | slow-mo | ✓ |
| **Debrief** | Post-wave/run analysis. **Explains what happened.** | ✗ | ✓ dimmed |
| **Results** | Final score, breakdown, PB comparison, seed | ✗ | ✓ |
| **Credits** | Attribution, tech notes | ✗ | ✓ |

**Transition rules:**
- Every transition is ≤ 400 ms and interruptible.
- Pause is instantaneous and resets the physics accumulator, so unpausing never produces a catch-up burst.
- Any state can reach Settings; Settings always returns to its caller.
- `Esc` in a submenu goes *back one level*, never all the way out.

---

# 12. UX/HCD Principles

## 12.1 The HCD cycle applied

| Stage | Applied here |
|---|---|
| **Understand the player** | §4–5. Judge with 2 minutes; casual on a phone; enthusiast; player with CVD and motion sensitivity. |
| **Identify needs** | Understand fast · know where threats are on a sphere · understand why I lost · play with my hands/eyes/device |
| **Define usability problems** | P1 Off-screen threats on a sphere · P2 Loss feels arbitrary · P3 Sphere flight disorients · P4 Which outpost is which · P5 Airless lighting hurts readability |
| **Ideate** | Threat Ring · itemised Debrief · persistent horizon + orbit trail · named outposts + Orbital Map · emissive gameplay entities |
| **Prototype** | Phase 2 grey-box (§40) |
| **Test** | 5 users after Phase 3, 5 more after Phase 6 (§37.8) |
| **Analyse** | Time-to-first-kill, wave-3 comprehension, loss attribution |
| **Iterate** | Phase 10 reserved for exactly this |
| **Validate** | Acceptance criteria in §42 |
| **Polish** | Phase 10 |

## 12.2 The five problems and their solutions

### P1 — Threats on a sphere are off-screen and over the horizon
**The Threat Ring.** A compass ring around the reticle. Every threat and outpost is a marker on the ring at its true bearing relative to heading.

- **Angular position** = bearing (the spatial fact that matters most)
- **Distance from ring centre** = proximity (nearer = further out on the ring)
- **Marker shape** = type (chevron = Harvester, dart = Interceptor, bar = Sentinel, hexagon = outpost)
- **Pulse rate** = urgency
- **Colour** = allegiance, and colour is *never the only carrier* (§35.1)

Markers for objects behind the player are drawn on the lower half of the ring with a subtle inward arrow. This solves the game's single hardest perceptual problem, and it is the signature UI element.

### P2 — "Why did I lose?"
**The Debrief names the cause in one sentence:**
> *"Lost Cassini at 2:41 — 3 Harvesters landed while you were on the far side."*

Plus a timeline strip of the wave showing where the player was when each outpost came under threat. Failure becomes a lesson about the sphere rather than an insult.

### P3 — Spherical flight disorients
- A **persistent artificial horizon** in the HUD, referenced to the local tangent plane.
- A faint **orbit trail** behind the craft showing the path just flown.
- **Altitude ladder** on the right edge with the terrain floor marked.
- Camera roll is damped and always returns to level-relative-to-local-up.

### P4 — Which outpost is which?
Names, not numbers. Fixed positions across all runs, so spatial memory builds. The Orbital Map (`Tab`) shows the whole sphere unrolled with all eight and their states.

### P5 — Airless lighting destroys readability on the night side
Resolved in §16.3.

## 12.3 Onboarding — three beats, one verb each

Progressive, in-context, no wall of text. Each beat gates on a success condition.

1. **FLY** (~25 s). Empty sky, no threats. *"Hold W. Steer with the mouse."* The player circles the moon once. **This beat exists to deliver the "I'm orbiting a small world" moment before anything competes for attention.** Gate: complete one half-orbit.
2. **SHOOT** (~20 s). Three inert drones. *"Left click."* Teaches the reticle-magnetism assist visibly. Gate: destroy all three.
3. **DEFEND** (~40 s). One outpost, two Harvesters. Introduces the drain bar and the Threat Ring. Gate: save the outpost.

Then Wave 1 proper. **The first true triage is Wave 3, deliberately after the tutorial** — teach the verbs first, test the decision later.

Skippable, and the skip is remembered. Each beat is individually replayable from Settings.

## 12.4 Cognitive load

Working memory holds roughly four items under stress. The HUD is budgeted accordingly.

**Always visible (4):** Hull · Heat · Threat Ring · Outpost Roster
**Conditional:** Lock reticle (only while locking) · Combo (only above ×2) · Wave banner (3 s at wave start) · Warnings (only when relevant)
**On demand:** Orbital Map (`Tab`), full score breakdown (WaveClear/Debrief)

Nothing requires memorisation. Every relevant number is on screen when it matters and absent when it isn't.

---

# 13. Psychological Design Principles

## 13.1 Perception

- **Pre-attentive processing.** Threat markers use motion and orientation, which are processed pre-attentively — the player registers "something appeared behind me" without directing attention at it.
- **Contrast hierarchy.** Gameplay-critical elements have the highest local contrast on screen. Terrain is deliberately low-contrast so it recedes.
- **Luminance over hue.** All critical distinctions differ in *luminance* as well as hue, so they survive every form of colour vision deficiency and poor phone screens in daylight.
- **Peripheral awareness.** The Threat Ring sits in the near-periphery where motion detection is strongest but detail vision is weak — so it is designed as motion and shape, not text.
- **Depth cues.** Aerial perspective is unavailable (no atmosphere), so depth comes from relative size, occlusion, motion parallax against the star field, and the shadow the craft casts on the terrain.

## 13.2 Attention

- **One alert at a time.** Alerts queue by priority; simultaneous alerts are a known cause of players noticing none.
- **Change blindness countermeasure.** State changes on the Outpost Roster animate rather than cutting, because instantaneous changes during a saccade are routinely missed.
- **Attention restoration.** WaveClear provides a deliberate 3-second low-demand beat. Sustained high alert without relief degrades performance and enjoyment.

## 13.3 Motivation — self-determination, honestly applied

- **Competence:** difficulty rises along perceivable axes; the Debrief teaches; the skill ceiling is real.
- **Autonomy:** the triage decision is genuinely the player's, with no correct answer. Difficulty, assist, and comfort settings are all player-controlled.
- **Relatedness:** the outposts have names and lights that go out. Modest, but it is why losing one lands.

**Explicitly rejected as manipulative:** daily rewards, energy/timers, loss-aversion streak mechanics, artificial scarcity, near-miss illusions on random rewards, any dark pattern. Motivation must come from the game being good.

## 13.4 Feedback — every action, three channels

| Event | Visual | Audio | Haptic |
|---|---|---|---|
| Shot fired | Muzzle flash, recoil kick, heat tick | Sharp transient | Light tick |
| Hit registered | Impact flash + spark burst at the point | Bright confirm | Sharp pulse |
| Kill | Debris burst, brief slow-mo on the final kill of a group | Layered explosion | Medium pulse |
| Player hit | Directional damage vignette showing *where from* | Impact + hull stress | Strong pulse |
| Outpost drain starts | Roster entry flips amber + beam appears | Rising alert | — |
| Outpost lost | Lights die on the surface; roster entry greys | Power-down; music ducks | Long pulse |
| Lock acquired | Reticle converges and snaps | Two-tone confirm | Double tick |
| Heat lockout | Reticle turns to a lockout glyph, HUD flashes | Distinct alarm | Buzz |

**The rule:** feedback is never *only* colour, never *only* audio, never *only* motion. Every critical state is carried by at least two channels, so no accessibility setting removes information.

Damage feedback is **directional** — the vignette indicates the incoming direction, so the player learns where the threat is rather than merely that they are hurt.

## 13.5 Flow

Challenge is kept in the band between anxiety and boredom by the wave arc (§10.2), bounded DDA (§10.3), and clear moment-to-moment goals. Failure states are short — respawn is 4 s, not a menu — because long interruptions break flow and turn setbacks into frustration.

---

# 14. UI/UX Specification

## 14.1 Information hierarchy

**Tier 1 — survival** (largest, highest contrast, most stable position): Hull, Threat Ring
**Tier 2 — objective**: Outpost Roster, active drain warnings
**Tier 3 — tactical**: Heat, boost charge, lock state
**Tier 4 — ambient**: score, combo, wave number, timer

Tier 4 is *deliberately* the least prominent. Score is not what the player should be looking at during a decision.

## 14.2 HUD layout (desktop)

```
┌─────────────────────────────────────────────────────────────┐
│ ▓▓▓▓▓▓▓▓░░ HULL 78          WAVE 5          SCORE 12,480    │
│ ▓▓▓░░░░░░░ HEAT 31                          ×3 COMBO        │
│                                                              │
│  OUTPOSTS                        ╭───────────╮          ▲   │
│  ◆ VEGA      100%               │     ·     │          70  │
│  ◆ KEPLER     94%               │  ╭─────╮  │          ─   │
│  ◈ CASSINI    41% ▼             │  │  ✛  │  │          ─   │
│  ◆ TYCHO     100%               │  ╰─────╯  │          ─   │  ALTITUDE
│  ◇ HADLEY      — LOST           │     ·  ◂  │          25  │  LADDER
│  ◆ AITKEN    100%               ╰───────────╯          ─   │
│  ◆ RILLE      88%                THREAT RING            ─   │
│  ◆ NECTARIS  100%                                       8   │
│                                                         ▼   │
│                    ───────  horizon  ───────                 │
│ ⚡ BOOST ▓▓▓▓▓▓░░░░              ⌖ LOCK 0.8s                │
└─────────────────────────────────────────────────────────────┘
```

- Reticle and Threat Ring are concentric at screen centre — the player's gaze is already there.
- Outpost Roster is left, in fixed order, so position becomes memorable. `◆` nominal, `◈` draining, `◇` lost.
- The artificial horizon spans the lower third.
- All HUD elements sit within a 90% safe area and scale with a HUD Scale setting (75–150%).

## 14.3 Screens

**Title** — live moon rotating behind. Logo, then PLAY / TUTORIAL / SETTINGS / CREDITS. Personal best shown small. First-time visitors get TUTORIAL as the visually primary action; returning players get PLAY.

**Briefing** (4 s, skippable) — the sphere unrolled, threatened outposts marked, incoming composition listed. Gives the player a plan before the pressure starts, which is what turns the wave into a decision rather than a reaction.

**WaveClear** (3 s) — score breakdown counting up, outposts saved highlighted. A deliberate breath.

**Debrief** — the honest one. Timeline strip, the one-sentence cause of any loss, accuracy, kills by type, and the run seed.

**Results** — final score with full itemisation, PB comparison with an explicit delta, wave reached, and a Play Again that returns to Playing in under one second.

**Settings** — four tabs: Controls (with live remapping and conflict detection), Display (quality tier, HUD scale, colour mode), Audio (master/music/SFX, all separate), Accessibility (reduced motion, aim assist, difficulty axes, DDA toggle, high contrast).

## 14.4 Never obstruct gameplay

- No modal ever appears during Playing.
- Alerts occupy the upper-centre band, never over the reticle or the Threat Ring.
- Damage vignettes are edge-only and capped at 40% opacity.
- All HUD elements can be reduced to a Minimal preset (Hull + Threat Ring only) for screenshots and expert play.

---

# 15. Art Direction

## 15.1 Concept

**"Instrument-lit vacuum."** Hard light, black shadows, no atmospheric softening. The world is austere and mostly monochrome; everything the player must act on glows. The visual language is a cockpit instrument panel: precise, technical, luminous, legible.

The defining image is the **terminator** — the knife-edge line between blazing lunar day and black lunar night, crossed twice per orbit.

## 15.2 Colour system

Function first. **Amber vs cyan, not red vs green** — red/green is the worst case for deuteranopia (~6% of males), and V1 used exactly that.

| Token | Hex | Use |
|---|---|---|
| `--void` | `#05060A` | Space |
| `--regolith` | `#B8B4AD` | Sunlit terrain |
| `--regolith-shadow` | `#0A0C10` | Terrain in shadow — nearly black by design |
| `--earthshine` | `#2A3F5F` | Night-side fill |
| `--friendly` | `#7FE8FF` | Player, outposts nominal, own fire |
| `--hostile` | `#FF8A3D` | All enemies and enemy fire |
| `--critical` | `#FFFFFF` | Highest urgency only, always animated |
| `--caution` | `#FFC857` | Draining, heat warning |
| `--inert` | `#4A5058` | Lost outposts, disabled UI |

Amber and cyan differ in both luminance and blue–yellow opponency, so they remain distinguishable under protanopia, deuteranopia, and tritanopia. `--critical` is pure white *and* always animated, so it never depends on hue at all.

## 15.3 Typography

Two self-hosted variable fonts, subset to used glyphs (~34 KB total). This is the one deliberate exception to zero-asset purity, and it is worth it: HUD legibility is a gameplay concern.

- **Chakra Petch** — HUD, numerals, headings. Technical character without Orbitron's ubiquity. **Tabular figures**, so score and hull don't jitter as digits change.
- **Inter** — body text, settings, Debrief prose. Chosen because settings text must be *readable*, and display faces are not.

Minimum 16px body, 14px absolute floor for incidental labels. Type scale 1.25 ratio.

## 15.4 Form language

- **Player:** long nose, delta wings, twin canted tails — V1's silhouette, rebuilt as merged material-batched geometry. Smooth, white, deliberate.
- **Enemies:** faceted, angular, asymmetric. Legible in silhouette alone at 40 px.
- **Outposts:** geodesic domes, orthogonal corridors, civilian and fragile-looking.
- **UI:** thin strokes (1–2 px), sharp corners, generous negative space. Instrument, not chrome.

## 15.5 Motion language

Motion communicates causality, never decorates.

- **UI:** fast in (180 ms, `cubic-bezier(.2,.8,.2,1)`), slower out (240 ms). Things arrive quickly and leave calmly.
- **Craft:** heavy — banking leads turns, momentum is visible, nothing snaps.
- **Enemies:** Harvesters move deliberately, Interceptors jitter, Sentinels rotate slowly. **Motion signature is a threat-identification channel** (§35.1).
- **Impacts:** 60–90 ms, sharp, then gone. Long impact effects obscure the next threat.
- All motion respects `prefers-reduced-motion` (§35.3).

---

# 16. Lighting

## 16.1 The rig — four lights, total

| Light | Type | Intensity | Purpose |
|---|---|---|---|
| **Sun** | Directional | 4.5 | Key. Sharp shadows, near-white slightly warm. |
| **Earthshine** | Hemisphere | 0.35 | Night-side fill, cool blue from the Earth's direction. |
| **Ambient** | Ambient | 0.04 | Barely present. Prevents pure black crush only. |
| **Craft** | SpotLight | 1.2 | Forward-facing, on the craft. The player's own light. |

Four. V1 had two ambient lights fighting each other plus a `PointLight` per bullet.

**Physical basis.** No atmosphere means no scattering, which means no ambient bounce beyond regolith inter-reflection and earthshine. The high key-to-fill ratio is not stylisation — it is what an airless body actually looks like, and it is why the art direction and the physics agree.

## 16.2 Shadows

One shadow-casting light (Sun). 2048×2048 map on a **tight orthographic frustum that follows the player**, covering ~180 u. V1's frustum spanned the whole moon, spreading resolution so thin that shadows were effectively absent where they mattered.

Low tier: shadows off, replaced by a projected blob shadow under the craft — which retains the depth cue that actually matters (*how high am I?*) at almost no cost.

## 16.3 The readability conflict — and its resolution

**Graphics position:** near-black shadows are physically correct and visually striking. Lifting them destroys the identity.
**UX position:** if the player cannot see threats on the night side, the aesthetic is actively costing them the game.

**Resolution — three parts:**

1. **All gameplay-critical entities are emissive.** Enemies, projectiles, outpost beacons, and pickups emit light rather than reflect it, so they are equally readable in blazing day and total night. Their visibility is decoupled from the lighting entirely.
2. **Terrain is allowed to go dark**, because precise terrain reading is never gameplay-critical — only the altitude ladder is, and that is HUD.
3. **The terminator becomes a designed beat.** Crossing it is dramatic, recurring, and readable as a landmark that aids orientation (§12.2 P3) rather than harming it.

The conflict resolves into a feature. This is the pattern the whole document tries to follow: when graphics and UX disagree, look for the resolution that serves both rather than splitting the difference.

## 16.4 Materials

PBR throughout. Regolith: roughness 0.95, metalness 0.0 — near-Lambertian, correct for dust. Craft hull: roughness 0.35, metalness 0.6. Enemies: roughness 0.4 with strong emissive accents. Outposts: roughness 0.25, metalness 0.8, with emissive windows that are the primary "is this alive?" signal.

Normal maps come from the baked terrain generation (§33). No roughness or metalness maps — uniform values per material are sufficient at our scale and save both memory and bandwidth.

---

# 17. Rendering Architecture

## 17.1 API choice — WebGL2, and why not WebGPU

**WebGL2 is the sole shipping path.**

WebGPU is genuinely viable now (three r185 ships `WebGPURenderer` with near-zero configuration, and Safari 26 added support). It was evaluated and deferred:

- `@react-three/postprocessing` targets the WebGL `postprocessing` library. The WebGPU path uses three's TSL-based node post stack — **a completely different API.** Supporting both means maintaining two post-processing implementations.
- Shaders would need writing twice (GLSL and TSL) or a full commitment to TSL.
- **We are not GPU-bound.** At ≤120 draw calls and ~160k triangles, WebGPU's advantages (compute, lower driver overhead, bindless resources) address bottlenecks this game does not have.

Cost: high. Benefit: zero measurable. **Deferred to Future Expansion (§45)** rather than rejected forever.

## 17.2 The non-negotiable rule

> **React must never re-render during gameplay.**

- **R3F declares the static scene:** moon, lights, outposts, camera rig, post-processing stack. These mount once.
- **All dynamic high-count entities are imperative pools** writing into `InstancedMesh` via refs.
- **One `useFrame`** drives the entire simulation. Zero `setState` calls in the frame path.
- HUD reads simulation state via a **throttled ≤10 Hz** subscription, or writes directly to DOM refs for values that must be smooth.

Violating this is the single fastest way to destroy this game's performance, so it is stated as an invariant and tested for (§37.6).

## 17.3 Draw call budget

| Group | Calls | Technique |
|---|---|---|
| Moon | 1 | Single icosphere, baked maps |
| Star field | 1 | `Points`, 8k vertices |
| Sun + corona | 2 | Billboard + shell |
| Earth | 2 | Sphere + atmosphere shell |
| Boulders | 1 | `InstancedMesh`, 400 instances |
| Outposts | 3 | Instanced by part type across all 8 |
| Landing pads | 1 | `InstancedMesh` |
| Player craft | 3 | Merged by material |
| Enemies | 3 | One `InstancedMesh` per archetype |
| Player projectiles | 1 | Instanced |
| Enemy projectiles | 1 | Instanced |
| Missiles + trails | 2 | Instanced |
| Debris/particles | 1 | Instanced |
| Drain beams | 1 | Instanced |
| Shadow pass | ~10 | |
| Post-processing | ~6 | Bloom mips + composite |
| **Total** | **≈ 39** | Budget **≤ 120**, ample headroom |

Craters are **baked into the normal map**, not geometry — this alone removes ~1,400 of V1's draw calls.

## 17.4 Triangle budget

| Element | Triangles |
|---|---|
| Moon icosphere (subdiv 6) | 81,920 |
| Boulders (400 × 44) | 17,600 |
| Outposts (8 × ~2,000) | 16,000 |
| Player craft | ~4,000 |
| Enemies (48 × ~600) | 28,800 |
| Projectiles/debris (quads) | ~2,600 |
| Earth + sun | ~8,000 |
| **Total** | **≈ 159,000** — budget ≤ 350,000 |

An **icosphere**, not `SphereGeometry`: uniform triangle distribution with no pole pinching. V1's 512×512 UV sphere wasted enormous vertex density at the poles and had visible pinching there.

## 17.5 Post-processing — bloom and vignette only

**Included:**
- **SelectiveBloom** on emissive gameplay entities. Justified because emissive-equals-important is the core readability mechanism (§16.3); bloom reinforces it, and it is what sells the night side.
- **Vignette**, subtle, static. Focuses attention centrally at negligible cost.

**Rejected, with reasons:**

| Effect | Why not |
|---|---|
| **Depth of field** | Blurs distant threats — which are *exactly* what the player must see to make triage decisions. Directly harms the core mechanic. |
| **Motion blur** | Same readability harm during fast travel, plus a known nausea trigger, plus it conflicts with reduced-motion. |
| **SSAO** | The harsh directional key already defines form completely. Expensive; near-invisible against near-black shadows. |
| **Volumetric god-rays** | **The Moon has no atmosphere.** Faking scattering would contradict the art direction's own physical premise — the reason the lighting looks the way it does. |
| **Chromatic aberration / film grain** | Decoration with a legibility cost. Fails Principle 2. |

## 17.6 Quality tiers

Auto-detected at Boot, manually overridable.

| | High | Medium | Low |
|---|---|---|---|
| Moon subdivision | 6 (82k) | 5 (20k) | 5 (20k) |
| Shadows | 2048 | 1024 | off (blob) |
| Bloom | full | half-res | off |
| Boulders | 400 | 200 | 80 |
| Max particles | 1024 | 512 | 192 |
| DPR cap | 2.0 | 1.5 | 1.0 |
| Target | 60 fps | 60 fps | 30–60 fps |

Detection uses renderer string, `deviceMemory`, `hardwareConcurrency`, and a 2-second startup frame-time probe. If measured frame time exceeds budget for 3 consecutive seconds, the tier drops one step and a non-blocking toast explains why.

---

# 18. Physics Architecture

## 18.1 No physics engine — the decision

**Rapier, Cannon-es, Ammo.js, and Matter.js are all rejected.**

- **Every one assumes a uniform gravity vector.** Ours is *radial* — "down" points at the moon's centre and differs at every position. Every engine would require per-body custom force application each step, which is the majority of what a physics engine does for you.
- **We have none of the problems they solve.** No stacked rigid bodies, no joints, no resting contacts, no friction, no convex decomposition. Every entity is a point or a sphere.
- **Cost is real:** Rapier's WASM bundle is 500 KB+ — larger than our entire target initial bundle (§34).
- A custom core is roughly 400 lines, fully understood, fully tunable, and directly testable.

**Decision: hand-written physics.** This is Principle 5 in action — the simplest thing that works.

## 18.2 Fixed timestep

The fix for V1's single largest bug class.

```
FIXED_DT       = 1/120 s   (8.333 ms)
MAX_ACCUM      = 0.25 s    (30 substeps max)

accumulator += min(realDeltaTime, MAX_ACCUM)
while accumulator >= FIXED_DT:
    previousState = currentState
    step(FIXED_DT)
    accumulator -= FIXED_DT
alpha = accumulator / FIXED_DT
render(lerp(previousState, currentState, alpha))
```

- **120 Hz** because it is a clean multiple of 60 and gives stable spring behaviour at our stiffness values.
- **`MAX_ACCUM` clamp** prevents the spiral of death after a tab switch — without it, returning to a backgrounded tab queues thousands of substeps and locks the browser.
- **Render interpolation** with `alpha` keeps motion smooth on displays that aren't multiples of 120.
- Simulation is now **identical on 60 Hz, 120 Hz, and 144 Hz displays.**

## 18.3 Integration method — and why not RK4

**Semi-implicit (symplectic) Euler:**

```
v ← v + a·Δt        ← velocity first
p ← p + v·Δt        ← then position, using the NEW velocity
```

The order is what makes it symplectic. It costs exactly the same as explicit Euler and is dramatically more stable for the spring-damper systems in §22.4, conserving energy over long runs instead of drifting.

**RK4 is rejected.** It requires four force evaluations per step instead of one — 4× the cost — to deliver accuracy that is imperceptible in tuned arcade flight. RK4 earns its place in orbital mechanics simulations where long-term trajectory accuracy is the product. Here, the product is *feel*, and feel is determined by tuned constants, not integration error. Using RK4 here would be mathematics as decoration, which Principle 4 forbids.

**Verlet** is used only for the Experimental tether (§45), where position-based distance constraints are genuinely the right tool. If the tether is cut, Verlet goes with it rather than remaining as an unused flourish.

---

# 19. Mathematical Models

Every model below is load-bearing. For each, the gameplay or rendering purpose is stated first.

## 19.1 Coordinate frames

- **World frame** — origin at the moon's centre. The only absolute frame.
- **Local tangent frame** at position **p**: the orthonormal basis `{f̂, r̂, û}` where `û` is radially outward. Flight, banking, and camera all operate here.
- **Screen frame** — for the Threat Ring's bearing projection.

## 19.2 Spherical parameterisation

Position on the sphere is `(θ, φ, h)` — longitude, latitude, altitude — used for spawn placement, the broadphase grid (§23.3), and the Orbital Map. Cartesian is used for all simulation, because trigonometric updates accumulate error and are slower.

**Arc distance** between two surface points (the "how far must I fly?" quantity that drives all triage):

```
d_arc = R · arccos( p̂₁ · p̂₂ )
```

A **dot product** doing real work: it produces the travel-time estimate shown on the Briefing screen and used by the DDA to place threats at a chosen difficulty of spread.

---

# 20. Vector Mathematics

## 20.1 The tangent-plane basis — the heart of the flight model

Given position **p**:

```
û = p / ‖p‖                        radial up (also the exact surface normal)
f  = f_prev − (f_prev · û) û       project forward onto the tangent plane
f̂ = f / ‖f‖
r̂ = f̂ × û                         right-hand basis completion
```

- **`f_prev − (f_prev·û)û` is vector projection**, removing the radial component of the forward vector so the craft's heading always lies in the local tangent plane. Without it, the craft drifts out of the flight surface as it moves around the curve.
- **`f̂ × û` is a cross product** producing the third basis vector. It is also what gives the banking direction its sign.

Re-orthonormalised every step, because floating-point drift over thousands of steps would otherwise skew the basis visibly within a minute.

## 20.2 Surface normals

For a sphere, the normal at **p** is exactly `p̂`. This is free, exact, and used for: terrain collision response, outpost orientation, spawn alignment, and the craft's blob shadow projection.

## 20.3 Reflection — debris bounce

```
v' = v − 2(v · n̂) n̂        then scaled by restitution e
```

Used when explosion debris strikes the surface. `n̂ = p̂` (§20.2), so the reflection is exact rather than approximated.

## 20.4 Banking derived from actual angular velocity

V1 faked bank with `rotation.z = -turnRate * 22`. V2 derives it:

```
ω     = (f̂_now × f̂_prev) / Δt          angular velocity vector
bank  = clamp( −k_bank · (ω · û), ±60° )
```

The `ω · û` **dot product** extracts the yaw component (rotation about local up), which is the only component that should produce bank. The visual is therefore *caused by* the physics rather than correlated with an input, which is why it stays correct during collisions, boosts, and external forces.

## 20.5 Interceptor steering

Classic steering forces, in the tangent frame:

```
desired  = normalize(p_player − p_self) · v_max
steering = clamp(desired − v_self, max_force)
a       += steering / m
```

Produces smooth pursuit with natural overshoot and correction, rather than V1's `lookAt` + straight-line motion, which reads as robotic and is trivially exploitable.

## 20.6 Missile guidance — proportional navigation

Real guided munitions use proportional navigation, and it looks dramatically better than lerp-toward-target because the missile leads rather than chases:

```
LOS   = p_target − p_missile
λ̇     = (LOS × (v_target − v_missile)) / (LOS · LOS)     LOS rotation rate
a_cmd = N · ‖v_closing‖ · λ̇                              N = 3.5
```

The **cross product** yields the line-of-sight rotation rate; the missile accelerates to null it. The result is an interception arc, not a tail-chase — visibly more convincing, and it makes lock-on feel like a real weapon.

## 20.7 Threat Ring bearing

The Threat Ring's whole job is turning a 3D position into a bearing:

```
d      = normalize(p_threat − p_player)
d_tan  = normalize( d − (d · û) û )         project into the tangent plane
bearing = atan2( d_tan · r̂ , d_tan · f̂ )
```

Two **dot products** against the tangent basis give the screen-space angle directly. `atan2` returns the full ±π range, so threats behind the player map correctly to the lower half of the ring. This is §20.1's basis paying for itself a second time.

---

# 21. Calculus Applications

## 21.1 The integration chain

The core relationship, applied every step:

```
a(t) = F(t)/m          →     v(t) = v₀ + ∫a dt     →     p(t) = p₀ + ∫v dt
```

Discretised by semi-implicit Euler (§18.3). Both integrals are approximated numerically because forces depend on state (drag depends on velocity, altitude hold depends on position), so no closed form exists.

## 21.2 Where closed forms *are* used

Where an analytic solution exists, it is used — it is exact and cheaper.

**Projectile flight time to a target** (for Interceptor lead prediction), assuming negligible drag over the short flight:

```
t = ‖p_target − p_shooter‖ / v_projectile
p_aim = p_target + v_target · t
```

**Terminal velocity** (§22.3) is the analytic steady-state solution of the drag equation, not something the game measures.

## 21.3 Derivatives used directly

- **Velocity** is the derivative of position — stored, not differentiated.
- **Altitude rate `ḣ = v · û`** — a **dot product** extracting the radial velocity component. Feeds the PD damping term (§22.4) and the altitude ladder's trend arrow.
- **Closing rate `ṙ = (v_target − v_missile) · L̂OS`** — drives proportional navigation and the lock-on tone's pitch.
- **Angular velocity** (§20.4) — drives bank.

## 21.4 Interpolation and easing

- **Render interpolation** (§18.2): `lerp(prev, curr, alpha)` — first-order, sufficient, and the only thing that keeps 120 Hz simulation smooth on a 60 Hz display.
- **Rotations** use `slerp` (spherical linear interpolation) on quaternions, because component-wise lerp on rotations produces non-uniform angular velocity and visible wobble.
- **Damped springs, not eased tweens**, for anything responding to live input (camera, reticle magnetism, craft attitude). A tween has a fixed duration and must restart when the target changes mid-flight; a spring simply re-converges. For live input, springs are correct and tweens are not.
- **Frame-rate-independent damping.** The naive `x += (target − x) · k` is framerate-dependent — the same bug class as V1's. The correct form:
  ```
  x ← target + (x − target) · e^(−λ·Δt)
  ```
  This is the analytic solution to exponential decay and is *exactly* correct at any Δt.

---

# 22. Physics Equations

All constants are tuned game-feel values for a **scaled fictional body**. This is not Luna at 1:1 — claiming otherwise would be dishonest, and the numbers are chosen for how the game plays.

## 22.1 Constants

| Symbol | Value | Meaning |
|---|---|---|
| `R` | 100 u | Moon radius |
| `g` | 12 u/s² | Surface gravity |
| `m` | 1.0 | Craft mass (normalised) |
| `F_cruise` | 88 u/s² | Cruise thrust |
| `F_boost` | 176 u/s² | Boost thrust (2.0×) |
| `F_strafe` | 39.6 u/s² | Lateral thrust (0.45× cruise) |
| `k_drag` | 0.13 | Quadratic drag coefficient |
| `k_p` | 25.0 | Altitude-hold spring |
| `k_d` | 10.0 | Altitude-hold damping |
| `e` | 0.35 | Debris restitution |

## 22.2 Radial gravity

```
a_gravity = −g · û = −g · (p / ‖p‖)
```

"Down" always points at the centre. **This one line is the entire reason no off-the-shelf physics engine fits** (§18.1).

## 22.3 Drag and emergent terminal velocity

```
a_drag = −k_drag · ‖v‖ · v
```

Quadratic drag (proportional to v², matching real high-Reynolds drag) rather than V1's `Math.min(speed, MAX_SPEED)` clamp. Terminal velocity is then the steady state where thrust balances drag:

```
F = k·v²   →   v_max = √(F / k)

v_cruise = √(88 / 0.13)   ≈ 26.0 u/s
v_boost  = √(176 / 0.13)  ≈ 36.8 u/s
v_strafe = √(39.6 / 0.13) ≈ 17.5 u/s
```

**Retuned August 2026, and the shape of the retune is the interesting part.**
Cruise was 44.7 u/s, which is a full lap of a radius-100 moon in fourteen
seconds — the horizon arrived faster than a player could read it, every outpost
was an overshoot, and the sphere never had time to register as a place. It was
the single most consistent piece of feedback the game received.

Both constants moved, not just thrust. `v = √(F/k)`, so either alone reaches 26 —
but cutting thrust alone would have tripled the time to *get* there and left the
craft waterlogged. Raising `k` alongside keeps the acceleration constant
`τ ≈ v/F` at 0.30 s, shorter than the 0.50 s it was, so the craft is slower
**and sharper**, and turns now bleed speed the way flying should.

Everything that races the craft moved by the same factor in the same commit:
`DRAIN_RATE_PER_HARVESTER` and every enemy speed. The balance harness checks
travel time against drain deadlines rather than either in isolation, which is why
it still passes — **the ratios are the design; the absolute numbers are only
their units.**

**Lateral thrust needs no damping and no clamp.** Drag is quadratic on the whole
velocity vector, so lateral speed bleeds off the instant the key is released, and
the tangent frame is re-orthonormalised every step so a sideways velocity stays
on the shell by construction. At 0.67× cruise it is quick enough to break a
firing solution and never quick enough to make sliding a way of *travelling* —
if it reached cruise, the correct way to cross the moon would be sideways, and
the flight model would have a dominant strategy that looks like a bug.

**Why this matters for feel.** Speed *approaches* the limit asymptotically instead of hitting a wall. Acceleration tapers naturally, so the craft feels like it has mass. And boost gives a real, felt surge because the terminal velocity itself moves. A hard clamp can never produce that.

These two numbers set the travel-time budget in §7.1, which sets the difficulty of every triage decision. The whole design rests on them.

## 22.4 Altitude hold — critically damped PD control

The player commands a *target altitude*; the craft servos toward it.

```
error   = h_target − h
ḣ       = v · û
a_alt   = k_p · error − k_d · ḣ
```

This is a damped harmonic oscillator. With `m = 1`:

```
ω_n = √(k_p/m) = √25 = 5.0 rad/s          natural frequency
critical damping:  k_d = 2·m·ω_n = 10.0   ← our value exactly
settling time (2%): ≈ 4/(ζ·ω_n) = 0.8 s
```

**Critically damped is the correct choice**: fastest possible convergence with *no overshoot*. Underdamped would bob (nauseating, and it would make altitude a fight). Overdamped would feel sluggish and unresponsive. 0.8 s settling gives altitude a satisfying weight without ever feeling like lag.

## 22.5 Attitude control

Craft rotation toward the input target uses the same critically damped spring on the quaternion's axis-angle error, with `ω_n = 12 rad/s` — much stiffer than altitude, because steering must feel immediate (§8.5's <50 ms requirement) while altitude should feel heavy.

## 22.6 Terrain collision

```
if ‖p‖ < R + h_crash:
    p ← p̂ · (R + h_crash)              push out along the exact normal
    v ← v − (v · û) û                   remove radial velocity, keep tangential
    damage ∝ |v · û| before removal     damage from impact speed only
```

Removing only the radial component means grazing the surface at a shallow angle costs little, while flying straight into it hurts — which is both physically right and good game feel.

## 22.7 Impulse on hit

```
Δv = (J / m) · n̂
```

Applied on projectile impacts for visible knock. Small (J ≈ 4) — enough to be felt as feedback, never enough to take control away from the player. Taking control away as a *consequence of being hit* compounds failure, which §13.5 warns against.

---

# 23. Collision Systems

## 23.1 Shapes

Spheres only. Every entity is a point with a radius. This is not a simplification forced by laziness — it is genuinely sufficient here (all entities are small, fast, and roughly convex), and it keeps every test to a few arithmetic operations.

| Entity | Radius |
|---|---|
| Player craft | 3.0 u |
| Harvester | 2.4 u |
| Interceptor | 1.8 u |
| Sentinel | 4.0 u |
| Projectile | 0.3 u |
| Outpost trigger | 15.0 u |

## 23.2 Swept-sphere continuous collision — the V1 tunneling fix

V1 checked `distanceTo` once per frame with projectiles moving 5 u/frame against 2 u targets. Fast shots teleported straight through enemies.

V2 solves the ray-sphere intersection analytically over the substep:

```
Given projectile at p with velocity v over Δt, target at c with radius r_sum:

  m = p − c
  a = v · v
  b = 2 (m · v)
  c₀ = m·m − r_sum²

  discriminant = b² − 4ac
  if discriminant < 0:  no hit
  t = (−b − √discriminant) / (2a)
  hit if 0 ≤ t ≤ Δt          ← t is the exact fraction of the step
```

Three **dot products** and a quadratic solve. The impact point is `p + v·t`, so hit effects appear at the *exact* contact location rather than at the entity centre — a small thing that makes hits feel precise.

**This is the flagship example of mathematics with a real purpose** (Principle 4). It is not here to look rigorous; it fixes a bug that made V1's shooting feel unreliable.

## 23.3 Broadphase — spherical bucket grid

Everything lives in a thin shell between r = 100 and r = 170, which makes uniform 3D grids wasteful (most cells are empty interior).

Instead: bucket by **(longitude cell, latitude cell, radial band)** — 24 × 12 × 3 = 864 buckets. Each entity occupies 1–2 buckets; queries test only the entity's bucket and its neighbours.

**Measured effect:** 48 enemies × 256 projectiles = 12,288 brute-force pairs per step. Bucketing reduces this to roughly 600 — a ~20× reduction, and it is what makes 120 Hz simulation affordable.

Latitude cells are sized by equal *area*, not equal angle, so polar buckets do not become pathologically dense.

## 23.4 Collision matrix

| | Player | Enemy | P.Proj | E.Proj | Outpost | Terrain |
|---|---|---|---|---|---|---|
| **Player** | — | damage both | — | damage | resupply | §22.6 |
| **Enemy** | damage both | — | damage | — | drain trigger | land |
| **P.Proj** | — | damage | — | — | — | despawn |
| **E.Proj** | damage | — | — | — | — | despawn |

Friendly fire is off. Projectile-vs-projectile is off. Both are deliberate: they add nothing and cost broadphase work.

## 23.5 Response

Projectiles despawn on impact and spawn a decal-free spark burst. Entity-entity uses positional correction plus the impulse in §22.7. There is no resting contact anywhere in the game, so no solver iteration is required — another reason a full physics engine would be pure overhead.

---

# 24. Camera System

## 24.1 Rig

Third-person chase, mounted on a rig that tracks the craft in the local tangent frame. Base offset: 22 u back, 7 u up, in craft-local space.

## 24.2 Behaviour

- **Position:** critically damped spring (`ω_n = 6 rad/s`), *not* V1's fixed `lerp(0.05)` which was both framerate-dependent and visibly laggy.
- **Look-ahead:** the aim point leads the craft by `v · 0.15 s`, so the player sees where they are going rather than where they are.
- **Speed FOV:** 62° at rest → 74° at boost, eased. A classic and effective speed cue, and it costs nothing.
- **Roll:** follows craft bank at 40% magnitude — enough to convey banking, damped enough to avoid disorientation.
- **Up vector** is always the local `û`, so "up" stays meaningful anywhere on the sphere. This is what keeps spherical flight from being nauseating.

## 24.3 Shake — done correctly

V1 added random offsets to the camera's position that were **never reset on X** (`game.js:784`), so the camera permanently drifted after damage.

V2 uses an **additive, decaying trauma model**:

```
trauma  ← clamp(trauma + amount, 0, 1)
shake    = trauma²                                  squared: small hits barely register
offset   = shake · A · perlinNoise(t · f)           smooth noise, not random jitter
trauma  ← trauma · e^(−1.8·Δt)                      frame-rate-independent decay
```

The offset is applied as a **transient post-transform**, never accumulated into the rig's state — which is structurally why V1's bug cannot recur. Squaring trauma means light hits shake almost imperceptibly while heavy ones are dramatic. Perlin noise instead of `Math.random()` gives smooth camera motion rather than a vibrating jitter.

Fully disabled under reduced-motion (§35.3), replaced by a brief edge flash carrying the same information.

## 24.4 Other modes

- **Orbital Map (`Tab`):** smooth 400 ms pull-back to a full-sphere view, simulation continues, threats visible as markers. Releasing returns.
- **Respawn:** 1.2 s eased move from the wreck to the respawn outpost — turns dead time into a readable spatial transition.
- **Title:** slow automated orbit, no player control.

---

# 25. Animation System

Three distinct layers, deliberately kept separate.

## 25.1 Simulation-driven (physics)

Craft attitude, banking, enemy motion, projectiles. Emerges from §18–22. **No keyframes anywhere** — if it moves in the world, physics moved it. This is what makes the game feel coherent rather than assembled.

## 25.2 Procedural (code-driven, per-frame)

- Engine glow scales with `‖v‖`
- Landing gear deploys as Harvesters approach the surface
- Sentinel shield rotation
- Outpost beacon pulse rate encodes urgency (a *data-driven* animation — the rate is the information)
- Drain beam intensity tracks drain rate

All driven directly by simulation values, so they are always truthful about game state.

## 25.3 GSAP — DOM and UI only

**GSAP animates HTML/CSS. It never touches the scene graph.**

This boundary is absolute. Scene animation belongs to `useFrame` at a fixed timestep; mixing GSAP's independent rAF ticker into scene transforms would create two clocks and reintroduce framerate coupling.

GSAP's real value here is timeline **sequencing** — the WaveClear score breakdown, where eight elements stagger in with overlapping counts and eases, is genuinely painful to hand-roll and trivial with a timeline.

| Sequence | Duration | Notes |
|---|---|---|
| Screen transitions | 320 ms | Fade + 8px rise |
| WaveClear breakdown | 2.4 s | Staggered timeline, count-ups |
| Alert entry | 180 ms | Overshoot, then settle |
| Menu stagger | 60 ms/item | |
| Damage vignette | 90 ms in, 400 ms out | |

All GSAP timelines respect a global `timeScale` that reduced-motion sets to an instant cut.

---

# 26. Particle System

## 26.1 Architecture

A **single pre-allocated pool** of 1,024 particles (High tier) in a struct-of-arrays layout backed by typed arrays:

```
positions:  Float32Array(1024 × 3)
velocities: Float32Array(1024 × 3)
life:       Float32Array(1024)
size:       Float32Array(1024)
colour:     Float32Array(1024 × 3)
```

Rendered as **one `InstancedMesh`** of camera-facing quads — **1 draw call for every particle in the game.**

V1 created 40 new `SphereGeometry` meshes *plus 40 new materials* per explosion and never disposed any of them. The rewrite is not a micro-optimisation; it is the difference between a game that degrades over five minutes and one that doesn't.

## 26.2 Zero allocation

The pool is allocated once at startup. Spawning takes the next free index from a free-list; expiry returns it. **No allocation occurs in the frame path**, so the garbage collector never runs mid-gameplay — directly addressing V1's GC hitching.

## 26.3 Effects

| Effect | Count | Life | Behaviour |
|---|---|---|---|
| Muzzle flash | 4 | 0.08 s | Fast fade |
| Impact spark | 12 | 0.25 s | Cone spray from the exact CCD contact point |
| Enemy destruction | 28 | 0.9 s | Radial burst, gravity-affected, bounces (§20.3) |
| Outpost lost | 60 | 2.0 s | Slow, dark, deliberately mournful |
| Engine trail | 2/frame | 0.4 s | Velocity-inherited |
| Terrain dust | 8 | 0.6 s | Low-altitude passes only |

Particles are affected by radial gravity and bounce off the surface using the reflection in §20.3 — physically consistent with everything else in the world at negligible cost.

---

# 27. Audio System

## 27.1 Procedural synthesis — native Web Audio, zero files

All SFX are synthesised at runtime from oscillators, noise buffers, and filters. **No audio files ship in the bundle.**

This preserves the zero-asset pillar, adds ~0 KB, eliminates load time and decode cost, and — genuinely useful — lets sounds be **parametric**, so audio can track continuous game state in a way sample playback cannot.

**Howler.js is rejected**: it exists to smooth over sample playback and legacy autoplay quirks. We synthesise rather than play samples, and the native API is entirely adequate.

| Sound | Synthesis |
|---|---|
| Engine | Sawtooth + noise through a lowpass whose cutoff and pitch **track velocity continuously** |
| Pulse cannon | Noise burst + pitched click, 40 ms exponential decay |
| Impact | Bandpass noise, sharp attack |
| Explosion | Lowpassed noise, exponential decay, pitch-dropping sub layer |
| Lock tone | Two oscillators converging in pitch as lock progresses — **the pitch interval *is* the progress bar** |
| Heat warning | Amplitude-modulated square, modulation rate rising with heat |
| Outpost lost | Descending sine pair with a long release |

The lock tone is the clearest example of why synthesis beats samples: the player hears how close the lock is without looking at it, which returns visual attention to flying.

## 27.2 Music

One ambient bed, ~90 s, seamlessly looped. **This is the one audio file** — approximately 400 KB as compressed Opus with an AAC fallback, loaded lazily *after* first interaction so it never blocks time-to-play.

**Why not procedural music.** Procedurally generated music that is genuinely *good* is a research problem, not a feature. Procedural SFX is a solved one. Being honest about that boundary is better than shipping weak generative audio for ideological purity.

Music ducks 6 dB under critical alerts, so alerts always cut through.

## 27.3 Spatial audio

`PannerNode` (HRTF) for enemy and outpost sounds, positioned in the tangent frame with the listener on the craft. Genuinely functional, not decorative: **an Interceptor behind you is audible before it is visible**, which is real information the Threat Ring reinforces rather than duplicates.

Distance model: inverse, ref 20 u, max 400 u.

## 27.4 Mixing and control

Master → three buses (Music / SFX / UI) → limiter. Independent sliders per bus plus a master mute.

Audio initialises only after a user gesture, per browser autoplay policy. **The game is fully playable muted** — audio never carries information that is not also visual (§13.4).

---

# 28. Technology Stack

## 28.1 Framework evaluation

The brief requires evaluating React, Next.js, and Angular rather than defaulting.

### Angular — rejected

- **Zone.js monkey-patches async APIs to trigger change detection.** With a 60 Hz `requestAnimationFrame` loop this is actively harmful. The mitigation is `NgZone.runOutsideAngular()` for the entire game — at which point the framework's central feature is switched off, and it is fair to ask what it is contributing.
- No R3F-equivalent for Three.js integration; the scene graph would be managed manually.
- Larger baseline bundle, DI machinery a single-page game does not need.
- **Verdict:** the wrong tool. Not because it is a bad framework — because its core mechanism opposes this workload.

### Next.js — rejected for the game, noted for a landing page

- **WebGL cannot server-render.** The entire game would be `dynamic(..., { ssr: false })`, which is exactly "turn off the framework's main feature."
- The App Router, RSC, route handlers, and streaming address problems this project doesn't have — one screen, no server data, no auth.
- SEO matters only for a landing page, which can be one static HTML file.
- **Where it would win:** a server-validated global leaderboard. We deliberately don't have one (§39.3).
- **Verdict:** cost without benefit here.

### React + Vite — selected

- **Vite's HMR is the deciding factor.** This project lives or dies on *feel*, and feel comes from tuning constants (§22.1) through hundreds of iterations. Sub-100 ms hot reload that preserves state is a genuine force multiplier for that work.
- React's component model fits the UI layer well — twelve screens, settings, HUD.
- **R3F requires React**, and R3F is the right call for the scene layer (§29).
- Static build output → Vercel deployment is a single command with no adapters.
- **Verdict:** selected. Not because React was requested, but because Vite's iteration speed matters more here than anything Next.js offers, and because R3F is genuinely the best Three.js integration available.

## 28.2 Final stack

| Layer | Choice | Version |
|---|---|---|
| Language | TypeScript | `~5.7` |
| Build | Vite | `^7` |
| UI | React | `^19` |
| 3D | three | `^0.185` |
| Scene | @react-three/fiber | `^9` |
| Helpers | @react-three/drei | `^10` (pinned exact) |
| Post | @react-three/postprocessing | `^3.0` |
| Post core | postprocessing | `^6.37` |
| State | zustand | `^5` |
| UI motion | gsap | `^3` |
| Audio | Web Audio API | native |
| Physics | custom | — |
| Unit test | vitest | `^3` |
| E2E | @playwright/test | `^1` |
| Lint | eslint + typescript-eslint | latest |

---

# 29. Library Selection

Each entry states what breaks without it — Principle 5.

### three `^0.185`
**Subsystem:** all rendering. **Without it:** hand-writing WebGL2 — months of work for no gain. **Alternatives:** Babylon.js (excellent, heavier, weaker React integration); raw WebGL (unjustifiable). **Performance:** we control the cost through instancing and draw-call budgeting. **Mandatory.**

### @react-three/fiber `^9`
**Subsystem:** declarative scene graph, `useFrame` loop, canvas lifecycle.
**Without it:** manual scene management and a hand-rolled bridge between React UI and Three.js. R3F's real value is not the JSX — it is that it solves the React↔Three lifecycle correctly, which is subtle and easy to get wrong.
**Performance:** `useFrame` runs outside React's render cycle; correctly used (§17.2) it has no per-frame cost. Misused it is catastrophic — hence the invariant.
**Alternatives:** vanilla three (loses lifecycle correctness); threlte (Svelte). **Mandatory.**

### @react-three/drei `^10` — pinned exact
**Subsystem:** `<Stats>`, `<AdaptiveDpr>`, `<Preload>`, `<PerspectiveCamera>` helpers.
**Without it:** ~200 lines of well-known utilities re-implemented.
**Risk:** drei has had documented React 19 / R3F v9 compatibility friction. **Therefore pinned to an exact version, and only a small, well-tested surface is used.** If a helper misbehaves, inline it and drop the dependency — this is an explicit risk-register item (§43).
**Optional but recommended.**

### @react-three/postprocessing `^3.0` + postprocessing `^6.37`
**Subsystem:** selective bloom, vignette.
**Without it:** hand-written effect composer; the selective-bloom pass in particular is fiddly to get right.
**Performance:** measured cost ~1.8 ms at 1080p. Disabled entirely on Low tier.
**Alternatives:** three's own `EffectComposer` (less efficient — no effect merging); custom passes.
**Optional** — the game must remain fully playable with post-processing off, and Low tier proves it.

### zustand `^5`
**Subsystem:** UI/meta state only — settings, screen state, progression, run summary.
**Without it:** prop drilling or Context, and Context re-renders every consumer on change, which is exactly what we must avoid.
**Why not Redux:** ceremony we don't need. **Why not Context alone:** the re-render behaviour.
**Critical constraint:** zustand **never** holds per-frame simulation state. Simulation lives in plain mutable objects (§32).
**Mandatory.**

### gsap `^3`
**Subsystem:** DOM/UI timelines only (§25.3).
**Without it:** hand-rolled sequencing for staggered multi-element timelines like the WaveClear breakdown — genuinely painful.
**Alternatives:** Framer Motion (React-idiomatic, weaker at complex timelines); Web Animations API (viable, more verbose).
**Constraint:** never animates the scene graph.
**Optional** — CSS transitions could cover ~70% of the need, and this dependency should be reconsidered if the bundle budget comes under pressure.

### Rejected

| Library | Why not |
|---|---|
| Rapier / Cannon-es / Ammo.js | Uniform-gravity assumption; 500 KB+ WASM; we have none of the problems they solve (§18.1) |
| Matter.js | 2D only |
| Howler.js | We synthesise rather than play samples; native Web Audio suffices (§27.1) |
| Redux / Jotai / Recoil | zustand covers the (small) meta-state need |
| Tailwind | A game UI is bespoke components, not utility composition; scoped CSS modules fit better |
| Framer Motion | Overlaps GSAP; adds bundle for no new capability |
| Leva | Dev-only GUI; a custom debug panel is smaller and won't ship accidentally |
| Any backend SDK | No backend (§39.3) |

---

# 30. Frontend Architecture

## 30.1 Directory structure

```
src/
├── main.tsx
├── App.tsx                        screen router
│
├── game/                          ← ZERO React imports below this line
│   ├── core/
│   │   ├── Loop.ts                fixed-timestep accumulator
│   │   ├── World.ts               entity pools, the mutable world
│   │   ├── Clock.ts
│   │   └── Random.ts              seeded PRNG (§10.4)
│   ├── physics/
│   │   ├── integrate.ts           semi-implicit Euler
│   │   ├── gravity.ts             radial field
│   │   ├── drag.ts
│   │   ├── tangentFrame.ts        §20.1 — the flight basis
│   │   ├── springs.ts             critically damped PD
│   │   └── collision/
│   │       ├── sweptSphere.ts     §23.2 CCD
│   │       ├── broadphase.ts      §23.3 bucket grid
│   │       └── response.ts
│   ├── entities/
│   │   ├── Craft.ts
│   │   ├── Harvester.ts
│   │   ├── Interceptor.ts
│   │   ├── Sentinel.ts
│   │   ├── Projectile.ts
│   │   ├── Missile.ts             §20.6 proportional navigation
│   │   └── Outpost.ts
│   ├── systems/
│   │   ├── InputSystem.ts
│   │   ├── FlightSystem.ts
│   │   ├── WeaponSystem.ts        heat model
│   │   ├── AISystem.ts            §20.5 steering
│   │   ├── SpawnSystem.ts         wave choreography
│   │   ├── DrainSystem.ts         the objective clock
│   │   ├── ScoreSystem.ts
│   │   ├── ParticleSystem.ts      §26
│   │   └── AudioSystem.ts         §27
│   ├── data/
│   │   ├── constants.ts           §22.1 — ALL tuning values, one file
│   │   ├── waves.ts               §10.2
│   │   ├── outposts.ts            names + Fibonacci positions
│   │   └── enemies.ts
│   └── math/
│       ├── vec3.ts                allocation-free operations
│       ├── quat.ts
│       └── spherical.ts
│
├── render/                        ← R3F: bridges game/ to the screen
│   ├── Canvas.tsx
│   ├── scene/                     Moon, Starfield, Sun, Earth, Outposts, Lighting
│   ├── instanced/                 EnemyInstances, ProjectileInstances, ParticleInstances
│   ├── effects/                   PostProcessing, CameraRig
│   └── materials/                 shared material definitions
│
├── ui/
│   ├── screens/                   the 12 states of §11
│   ├── hud/                       ThreatRing, OutpostRoster, HullGauge, HeatGauge,
│   │                              LockReticle, ComboMeter, AltitudeLadder, Horizon
│   └── components/                Button, Slider, Tabs, KeyBindRow, Toast
│
├── state/
│   ├── useGameStore.ts            zustand: screen, run summary
│   ├── useSettingsStore.ts        zustand: persisted settings
│   └── persistence.ts             versioned localStorage
│
├── workers/
│   └── terrainWorker.ts           §33 — bakes moon maps off the main thread
│
└── styles/
```

## 30.2 Layer separation

| Layer | Location | Rule |
|---|---|---|
| **Presentation** | `render/`, `ui/` | May read game state. **Never mutates it.** |
| **Game logic** | `game/systems/`, `game/entities/` | **Zero React, zero Three.js imports.** |
| **Physics** | `game/physics/` | Pure functions. No I/O, no globals. |
| **Data** | `game/data/` | Static config only. No behaviour. |
| **Infrastructure** | `state/`, `workers/` | Persistence, threading. |

`game/` importing from `react` or `three` is a **lint-enforced error** (§37.6). This is what makes the simulation unit-testable in Node with no DOM, and it is the structural guarantee behind the no-re-render invariant.

---

# 31. Game Architecture

## 31.1 The loop

```
requestAnimationFrame
   ↓
accumulate real time (clamped, §18.2)
   ↓
while accumulator ≥ FIXED_DT:
      InputSystem      sample buffered input
      FlightSystem     forces → integrate craft
      AISystem         enemy steering
      WeaponSystem     firing, heat, cooldowns
      PhysicsSystem    integrate all bodies
      CollisionSystem  broadphase → swept narrowphase → response
      DrainSystem      outpost integrity, the objective clock
      SpawnSystem      wave choreography
      ScoreSystem      scoring, combo
      ParticleSystem   pool update
      accumulator -= FIXED_DT
   ↓
alpha = accumulator / FIXED_DT
   ↓
RenderBridge  write interpolated transforms into InstancedMesh buffers
   ↓
AudioSystem   update parametric synth values
   ↓
HUD sync      ≤10 Hz throttle
```

System order matters and is fixed: input before flight (no one-frame lag), collision after all integration (positions are final), spawn after collision (deaths counted this step).

## 31.2 Entity storage

Structure-of-arrays over typed arrays, with a free-list allocator. Fixed capacity per type, allocated once at startup:

| Pool | Capacity |
|---|---|
| Enemies | 48 |
| Player projectiles | 256 |
| Enemy projectiles | 128 |
| Missiles | 8 |
| Particles | 1,024 |
| Outposts | 8 |

Caps are gameplay decisions as much as performance ones: bounded population keeps difficulty *authored* rather than emergent, which is exactly what V1 lost by spawning without limit.

## 31.3 The render bridge

The single point where simulation meets Three.js. Each frame it writes interpolated transforms into instanced-mesh matrix buffers and marks them dirty.

**Nothing else in `render/` reads simulation state.** One boundary, one place to look when something desyncs.

---

# 32. State Management

## 32.1 Three kinds of state, three mechanisms

| Kind | Mechanism | Frequency | Example |
|---|---|---|---|
| **Simulation** | Plain mutable TS objects + typed arrays | 120 Hz | positions, velocities, health |
| **Meta/UI** | zustand | on event | current screen, wave number, run summary |
| **Persistent** | zustand + localStorage | rarely | settings, personal best, keybindings |

**The rule that makes this work:** simulation state is *never* in React. Not in `useState`, not in Context, not in zustand. React learns about the simulation only through a throttled HUD sync.

## 32.2 HUD synchronisation

Values that change every frame (hull, heat, score) are written **directly to DOM refs**, bypassing React's render entirely. Values that change on events (outpost states, wave number) go through zustand at ≤10 Hz.

Result: **zero React re-renders during Playing.** Verified by test (§37.6).

## 32.3 Persistence

```ts
{ version: 2,
  settings:  { audio, display, controls, accessibility },
  progress:  { bestScore, bestWave, tutorialCompleted },
  keybinds:  Record<Action, Binding> }
```

Versioned with forward migration. Corrupt or unparseable data resets to defaults rather than crashing — a saved-state parse error must never prevent someone from playing.

---

# 33. Asset Pipeline

## 33.1 The pillar

**Zero art assets ship.** No textures, no models, no audio samples for SFX. The two exceptions are deliberate and justified: two subset variable fonts (~34 KB) because HUD legibility is a gameplay concern, and one ~400 KB music loop (§27.2) because good procedural music is a research problem.

This is a genuine competitive advantage: a tiny bundle, nothing to host or license, no CDN dependency, and a demonstrable claim that the entire world is code.

## 33.2 Terrain baking — in a Web Worker

At Boot, a worker generates three 1024×512 equirectangular maps from seeded noise plus an explicit crater list:

1. **Albedo** — regolith base with darker maria
2. **Normal** — craters, ridges, fine roughness
3. **AO** — crater interiors and structural shadowing

~1.4 s on a mid-range device, **off the main thread**, transferred as `ImageBitmap` (zero-copy). The Loading screen shows genuine progress from real work — V1 blocked the main thread for seconds with no feedback at all.

**Why bake instead of a runtime displacement shader:** predictable per-frame cost (zero), a much simpler low-tier fallback, and a loading phase that can honestly report progress. A displacement shader would move the cost into every frame forever to save 1.4 seconds once.

## 33.3 Geometry

All generated at startup: icosphere by recursive subdivision; craft, enemies, and outposts from primitives, **merged by material** into few draw calls (V1's craft alone was ~40 separate meshes); boulders from a small set of shared base geometries with per-instance scale and rotation — V1 created 400 *unique* mutated geometries, defeating instancing entirely.

## 33.4 Code splitting

| Chunk | Contents | Load |
|---|---|---|
| `index` | React, UI shell, Title | eager |
| `game` | three, R3F, simulation | on PLAY |
| `post` | postprocessing | on demand, High/Medium only |
| `music` | audio loop | lazy, after first interaction |

Time-to-interactive is bounded by the small `index` chunk, so the Title screen appears fast even on a slow connection.

---

# 34. Performance Budget

## 34.1 Targets

| Metric | Desktop 1080p | Mobile |
|---|---|---|
| Frame rate | 60 fps sustained | 30–60 fps |
| Frame budget | 16.6 ms | 33.3 ms |
| CPU simulation | ≤ 4 ms | ≤ 8 ms |
| GPU | ≤ 10 ms | ≤ 20 ms |
| Draw calls | ≤ 120 | ≤ 60 |
| Triangles | ≤ 350k | ≤ 120k |
| Texture memory | ≤ 48 MB | ≤ 24 MB |
| JS heap (steady) | ≤ 120 MB | ≤ 80 MB |
| **Heap growth during play** | **≈ 0 MB/min** | **≈ 0 MB/min** |
| Initial bundle (gz) | ≤ 400 KB | ≤ 400 KB |
| Time to interactive | < 1.5 s | < 3 s |
| Input latency | < 50 ms | < 50 ms |

**Zero heap growth is the headline number.** It is the direct, measurable refutation of V1's leak, and it is verifiable in a five-minute automated soak test (§37.5).

## 34.2 How each target is met

- **Draw calls** — instancing everywhere (§17.3): ~39 actual against a 120 budget.
- **Zero allocation** — every pool pre-allocated; scratch vectors module-scoped and reused; **no `new` in the frame path.**
- **Disposal** — every geometry, material, and texture is owned by a registry that disposes on scene teardown. V1 disposed nothing.
- **GC pressure** — SoA typed arrays mean the simulation is a handful of large allocations rather than millions of small ones.
- **Shader compilation** — all materials created and compiled during Loading. No mid-game stutter from lazy compilation, and no light-count churn (V1's per-bullet `PointLight` forced recompiles constantly).

## 34.3 Monitoring

A dev-only overlay (`~`) shows frame time, CPU/GPU split, draw calls, triangles, live entity counts, heap size, and physics substeps per frame. Production keeps a lightweight rolling frame-time average, used solely to drive automatic tier reduction (§17.6).

---

# 35. Accessibility

Specified here, at design time — Principle 9.

## 35.1 Colour vision

- **Amber (`#FF8A3D`) vs cyan (`#7FE8FF`)**, never red vs green. V1 used green enemies with a green HUD on grey terrain — the worst case for deuteranopia (~6% of males).
- These differ in **both luminance and blue–yellow opponency**, so they survive protanopia, deuteranopia, and tritanopia.
- **Redundant encoding is mandatory.** Allegiance is carried by colour *and* silhouette *and* motion signature *and* audio. Removing any single channel loses no information.
- Threat Ring markers differ by **shape**, not only colour.
- A **high-contrast mode** increases HUD stroke weight and adds outlines.

## 35.2 Contrast

All HUD text meets **WCAG AA (4.5:1)** against its actual background including the game behind it, guaranteed by a semi-opaque scrim behind text regions. Critical alerts meet AAA (7:1). Nothing relies on thin light text over a bright moon — a real risk in this setting, mitigated deliberately.

## 35.3 Reduced motion

Honours `prefers-reduced-motion` and offers a manual toggle.

**Removed:** camera shake (replaced by an edge flash carrying the same information), camera roll on banking, speed FOV shift, screen-space particle drift, UI overshoot easing.
**Kept:** everything gameplay-informative — enemy motion, projectiles, drain beams, Threat Ring markers, beacon pulses.

**Reduced motion must not mean reduced information.** Every removal is paired with a static or lower-motion substitute for the same signal.

## 35.4 Difficulty as accessibility

Independent axes, not presets (§10.5): Enemy Damage 0–150% · Drain Rate 50–150% · Enemy Speed 75–125% · Aim Assist 0–100% · Infinite Boost.

Independent axes because disabilities are not a single dimension: a player with a motor impairment may want slower enemies but full damage; a player with a visual impairment may want the opposite. A single "Easy" preset serves neither.

## 35.5 Input

Full remapping. Complete keyboard-only path (§8.1). Toggle-fire as an alternative to hold-fire (relevant for RSI and limited dexterity). No timed multi-key chords anywhere. No double-taps required.

## 35.6 Screen readers

Menus, settings, and results are fully navigable: semantic HTML, correct roles, visible focus rings, logical tab order, `aria-live` for state changes.

The 3D canvas is **not** presented as screen-reader-playable — claiming otherwise would be dishonest. What it does have: an `aria-live="polite"` region announcing critical events (outpost lost, wave cleared, run ended, final score), so a screen-reader user always knows the game's state even if they cannot play it directly.

## 35.7 Text

16px minimum body (14px absolute floor for incidental labels). No text baked into textures. HUD scale 75–150%. Inter for prose because it is designed for legibility; display faces are not.

---

# 36. Responsive Strategy

## 36.1 Breakpoints

| Class | Width | Input | Tier | HUD |
|---|---|---|---|---|
| Desktop | ≥ 1280 | mouse+kb, gamepad | High | Full |
| Laptop | 1024–1279 | mouse+kb | High/Med | Full, 90% scale |
| Tablet | 768–1023 | touch | Medium | Simplified, larger targets |
| Mobile | < 768 | touch | Low | Minimal |

## 36.2 Not just scaled down

**Mobile HUD changes what it shows, not merely how big it is:**

- Outpost Roster collapses from eight rows to a single count plus the most-urgent entry
- Altitude ladder becomes a compact bar
- Combo and score move to a single compact top line
- Threat Ring **grows relative to the screen** — it is the most important element on a small display, so it gets proportionally more space, not less
- All touch targets ≥ 44 px, inside safe-area insets

## 36.3 Orientation

Landscape is strongly preferred. Portrait shows a rotate prompt with a "play anyway" option (a compressed HUD) rather than a hard block — blocking is hostile when someone's device is orientation-locked for accessibility reasons.

## 36.4 Canvas sizing

Renders at `min(devicePixelRatio, tierCap)`. Resize is debounced 150 ms. On sustained frame-budget overrun, resolution scales down before quality features are dropped — resolution is the least perceptible lever at speed.

---

# 37. Testing Strategy

## 37.1 Unit — Vitest

Pure functions, no DOM required (which is why `game/` forbids React and Three.js imports).

| Target | Assertion |
|---|---|
| `sweptSphere` | Detects a hit a naive distance check misses at 220 u/s. **Regression test for V1's tunneling.** |
| `tangentFrame` | Basis stays orthonormal over 100k steps (drift < 1e-6) |
| `integrate` | Terminal velocity converges to √(F/k) within 1% |
| `springs` | Critically damped response never overshoots |
| `broadphase` | Identical results to brute force across 10k random configurations |
| `Random` | Same seed → identical wave composition |
| `persistence` | v1 → v2 migration preserves data; corrupt input yields defaults |

Coverage target: **≥ 85% on `game/`**. UI coverage is deliberately not chased — it is better served by E2E.

## 37.2 Gameplay

Headless simulation harness runs the sim with no renderer:
- 12 waves with a scripted "perfect" player → all outposts survive
- 12 waves with a null player → all outposts lost, no crash
- 10,000 steps with random input → no NaN, no unbounded values, pools never exhausted

## 37.3 Physics

- **Determinism:** identical seed and inputs produce bit-identical state after 10,000 steps
- **Framerate independence:** simulating 10 s at 60/120/144 Hz render rates gives identical final state (**the direct V1 regression test**)
- **Energy:** an undriven craft in a stable orbit does not gain energy over 100k steps
- **Tunneling:** no projectile passes through a target at any speed up to 400 u/s

## 37.4 UI — Playwright

All twelve state transitions; settings persist across reload; remapping works and detects conflicts; pause/resume produces no time jump; keyboard-only completion of a full run.

## 37.5 Performance

Automated, in CI, failing the build on regression:
- 5-minute soak → **heap growth < 5 MB** (V1's regression test)
- Draw calls ≤ 120 at peak load
- Frame time p95 ≤ 16.6 ms on the reference machine
- Bundle size ≤ 400 KB gz
- No frame > 50 ms after Loading completes

## 37.6 Architecture invariants — lint-enforced

- `game/**` may not import `react`, `three`, `@react-three/*` (ESLint `no-restricted-imports`)
- No `new` inside functions marked `@hot-path`
- **A React profiler test asserts zero component re-renders during 10 s of Playing** — the §17.2 invariant, mechanically enforced rather than merely documented

## 37.7 Browser matrix

Chrome, Firefox, Safari (desktop, current + previous); iOS Safari; Chrome Android. Full run on each before submission.

## 37.8 User testing

Two rounds of five participants (five surfaces roughly 80% of usability issues; more per round has diminishing returns versus running a second round after fixes).

- **Round 1**, after Phase 3: can they play without instruction? Time-to-first-kill. Do they understand the drain?
- **Round 2**, after Phase 6: **can they articulate why they lost?** This is the single most important question in the study, because §12.2 P2 is the design's central UX claim. If participants cannot answer it, the Debrief has failed and Phase 10 must fix it.

Instrumented metrics: time to first kill, wave-3 triage comprehension, loss attribution accuracy, settings discovery rate.

## 37.9 Accessibility testing

axe-core in CI on all non-canvas UI. Manual: full keyboard-only run; NVDA/VoiceOver on menus; CVD simulation for all three types; reduced-motion verification that no information is lost.

---

# 38. Deployment Strategy

## 38.1 Build

```
vite build   →   dist/   (static, no server runtime)
```

Rollup, Terser, tree-shaking, content-hashed filenames, manual chunks per §33.4.

## 38.2 Vercel

Framework preset **Vite**, output `dist`, zero configuration beyond it. Static hosting only — no serverless functions, no edge middleware, no environment variables required.

Headers: long-lived immutable caching for hashed assets, `no-cache` for `index.html`, plus the security headers in §39.

Preview deployments per branch; production on `main`.

## 38.3 Environments

| | Purpose |
|---|---|
| Local | `vite dev`, debug overlay on |
| Preview | Per-PR, production build, debug accessible |
| Production | `main`, debug stripped, monitoring on |

## 38.4 Monitoring

Vercel Analytics (privacy-preserving, no cookies, no consent banner needed) for page views and Web Vitals. A custom lightweight beacon reports **aggregate, anonymous** performance data: median FPS, tier selected, GPU string. No personal data, no user identifiers, no gameplay tracking. Sends once per session, respects Do Not Track.

## 38.5 Error handling

React error boundaries per screen — a HUD failure must never take down the game. WebGL context-loss handling with automatic recovery and a clear message. A hard-fail path renders a static "your browser doesn't support WebGL2" page with specifics rather than a blank canvas.

---

# 39. Security Considerations

## 39.1 Client-side

Everything runs client-side, so there is no server to attack. Remaining concerns:

- **CSP** (`default-src 'self'`) — no external script or style sources. Because we ship no third-party runtime assets, this is achievable strictly, which is unusually strong for a web app.
- Additional headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` denying camera/microphone/geolocation.
- **No `eval`, no `Function` constructor**, including in the seeded PRNG.
- localStorage input is validated and schema-checked before use — a corrupted save must not become an injection vector.

## 39.2 Dependency hygiene

`npm audit` in CI; exact-pinned versions in `package.json`; lockfile committed; Dependabot on. Every dependency justified in §29 — the smallest attack surface is the dependency you didn't add.

## 39.3 No backend — a security decision as much as an architectural one

A global leaderboard would require server-side score validation, and client-authoritative scores are trivially forgeable. Doing it properly means server-side replay verification — a substantial subsystem serving a feature nobody asked for.

**Local-only persistence eliminates the entire problem class:** no accounts, no PII, no GDPR surface, no rate limiting, no anti-cheat, no attack surface at all.

---

# 40. Development Phases

Twelve phases. **The game is playable at the end of every one from Phase 2 onward** (Principle 7).

### Phase 0 — Discovery ✅ COMPLETE
**Objective:** Understand V1; establish the V2 direction.
**Delivered:** V1 teardown with file:line evidence (§2.2); design pivot (§2.3); this document.
**Acceptance:** Every V2 decision traceable to evidence or explicit rationale.

### Phase 1 — Architecture
**Objective:** A buildable, deployable skeleton.
**Tasks:** Vite + React + TS scaffold · directory structure (§30.1) · ESLint with architecture rules (§37.6) · zustand stores · screen router with all 12 states as stubs · Vercel deploy · CI.
**Dependencies:** none. **Deliverable:** deployed skeleton navigating all 12 screens.
**Acceptance:** `npm run build` clean · deployed · lint blocks a `three` import inside `game/`.
**Risks:** drei/React 19 friction — resolve here, before anything depends on it.

### Phase 2 — Core Prototype ⭐ FIRST PLAYABLE
**Objective:** Fly around a sphere, correctly.
**Tasks:** Fixed-timestep loop (§18.2) · tangent-frame flight (§20.1) · radial gravity + drag (§22) · PD altitude hold (§22.4) · camera rig (§24) · grey-box icosphere · keyboard + mouse input.
**Dependencies:** Phase 1. **Deliverable:** grey-box flight demo.
**Acceptance:** **Identical behaviour at 60/120/144 Hz** · terminal velocity within 1% of √(F/k) · no basis drift over 10 minutes · input latency < 50 ms.
**Risks:** flight feel is the whole game — budget real time for tuning here, not later.

### Phase 3 — Gameplay ⭐ FIRST FUN
**Objective:** The complete loop.
**Tasks:** Outposts + drain (§7.2) · three enemy archetypes · weapons + heat · wave system · scoring · win/lose.
**Dependencies:** Phase 2. **Deliverable:** playable grey-box game, 12 waves.
**Acceptance:** A wave can be won and lost · triage decisions are real (verified by headless harness) · **User Test Round 1**.
**Risks:** if triage isn't compelling in grey-box, no amount of visuals will save it — **this is the go/no-go gate for the design.**

### Phase 4 — Physics & Collision
**Objective:** Correct, fast collision.
**Tasks:** Swept-sphere CCD (§23.2) · bucket broadphase (§23.3) · response · terrain collision · proportional-navigation missiles (§20.6) · steering AI (§20.5).
**Dependencies:** Phase 3. **Deliverable:** robust collision.
**Acceptance:** zero tunneling to 400 u/s · broadphase matches brute force on 10k configs · full physics suite green (§37.3).

### Phase 5 — Visual Systems
**Objective:** The look.
**Tasks:** Terrain worker (§33.2) · icosphere + baked maps · instanced everything · lighting rig (§16) · particle pool (§26) · post-processing (§17.5) · quality tiers.
**Dependencies:** Phase 4. **Deliverable:** the game, looking like itself.
**Acceptance:** ≤ 120 draw calls · 60 fps at 1080p · load < 3 s · **enemies readable on the night side** (§16.3).
**Risks:** the readability conflict — if emissive-only proves insufficient, add a subtle rim light rather than lifting ambient, which would destroy the identity.

### Phase 6 — UI/UX
**Objective:** Every screen, and the HUD.
**Tasks:** All 12 screens · **Threat Ring** · Outpost Roster · gauges · Debrief with cause attribution · Settings (4 tabs) · tutorial (§12.3) · GSAP timelines.
**Dependencies:** Phase 5. **Deliverable:** complete UX.
**Acceptance:** **User Test Round 2 — participants can articulate why they lost** · tutorial completion without help · zero re-renders during Playing (§37.6).
**Risks:** the Threat Ring is novel; prototype it early in the phase and test it, don't polish it last.

### Phase 7 — Audio
**Objective:** Three-channel feedback.
**Tasks:** Web Audio graph · procedural SFX (§27.1) · parametric engine · spatial panning · music bed + ducking · mixer UI.
**Dependencies:** Phase 6. **Deliverable:** full audio.
**Acceptance:** every §13.4 event has a sound · **game fully playable muted** · lock tone conveys progress without looking.

### Phase 8 — Optimisation
**Objective:** Hit every number in §34.
**Tasks:** Profile CPU and GPU · eliminate frame-path allocation · verify disposal · code splitting · adaptive resolution · mobile tuning.
**Dependencies:** Phase 7. **Deliverable:** budget met on all tiers.
**Acceptance:** **5-minute soak, heap growth < 5 MB** · p95 frame ≤ 16.6 ms · bundle ≤ 400 KB gz · mobile ≥ 30 fps.

### Phase 9 — Testing
**Objective:** Verified correctness.
**Tasks:** Complete unit suite · Playwright E2E · browser matrix · axe-core · full accessibility pass.
**Dependencies:** Phase 8. **Deliverable:** green CI.
**Acceptance:** ≥ 85% coverage on `game/` · all browsers pass · zero axe violations · keyboard-only run completes.

### Phase 10 — Polish
**Objective:** Act on what testing found.
**Tasks:** Address user-test findings · tune game feel · refine transitions · balance the wave arc · improve the Debrief · juice.
**Dependencies:** Phase 9. **Deliverable:** the finished game.
**Acceptance:** no known usability issues above minor · balance validated by playthroughs.
**Note:** This phase is reserved for *responding to evidence*, not adding features. Feature work here is scope creep by definition.

### Phase 11 — Competition Build
**Objective:** Submission.
**Tasks:** Final QA · README + architecture notes · 60-second demo video · screenshots · technical writeup · production deploy · **verify the deployed URL on a phone.**
**Dependencies:** Phase 10. **Deliverable:** submission package.
**Acceptance:** live URL works on every target device · documentation complete · video shows the core idea within 15 seconds.

---

# 41. Milestones

| M | Name | After | The question it answers |
|---|---|---|---|
| **M1** | Deployable skeleton | Phase 1 | Does the toolchain work end to end? |
| **M2** | **Flight feels good** | Phase 2 | Is the core interaction enjoyable *by itself*? |
| **M3** | **The game is fun** | Phase 3 | Is triage compelling in grey-box? **Go/no-go.** |
| **M4** | Physics is correct | Phase 4 | Can it be trusted? |
| **M5** | It looks like itself | Phase 5 | Is the identity there, within budget? |
| **M6** | **It is understandable** | Phase 6 | Can a new player learn it unaided? |
| **M7** | It sounds right | Phase 7 | Is feedback complete across channels? |
| **M8** | It is fast | Phase 8 | Are all §34 numbers met? |
| **M9** | It is verified | Phase 9 | Is it correct and accessible? |
| **M10** | It is polished | Phase 10 | Is it competition quality? |
| **M11** | It is submitted | Phase 11 | Done. |

**M2, M3, and M6 are the ones that matter.** If flight isn't enjoyable, nothing downstream helps. If triage isn't compelling in grey-box, the design is wrong and should change before art is built on it. If players can't understand it, judges won't either.

---

# 42. Acceptance Criteria

Measurable, verifiable, project-wide.

### Functional
- All 12 states reachable, all transitions correct
- 12 waves playable; victory and defeat both reachable
- All 3 enemy archetypes behave per §7.3
- All 8 outposts can be threatened, drained, lost, and can resupply
- Settings persist across reload; corrupt data resets safely

### Performance (§34)
- 60 fps sustained, 1080p, reference desktop
- ≥ 30 fps on iPhone 12 / mid-range Android
- ≤ 120 draw calls peak
- **Heap growth < 5 MB over 5 minutes**
- Bundle ≤ 400 KB gz; TTI < 3 s on mid-tier mobile

### Correctness
- **Identical simulation at 60/120/144 Hz**
- No tunneling up to 400 u/s
- Same seed → identical waves
- No NaN over 10,000 random-input steps

### UX
- New player completes the tutorial without external help
- **≥ 80% of testers correctly state why they lost an outpost**
- Time from load to first input < 5 s
- No modal ever interrupts Playing

### Accessibility
- WCAG AA on all HUD text; AAA on critical alerts
- Full keyboard-only completion
- All information available with colour, motion, or audio individually removed
- Zero axe-core violations on non-canvas UI

### Engineering
- ≥ 85% unit coverage on `game/`
- Zero React re-renders during Playing (profiler-verified)
- `game/` contains no React or Three.js imports
- Clean build, zero TypeScript errors, zero lint warnings

---

# 43. Risk Register

| # | Risk | L | I | Mitigation | Trigger |
|---|---|---|---|---|---|
| R1 | **drei / React 19 friction** | Med | Med | Pin exact; use a minimal surface; inline the 3–4 helpers we need if problems appear | Any drei bug in Phase 1 → drop the dependency immediately |
| R2 | **Triage isn't fun in practice** | Low | **Critical** | Grey-box validation at M3 *before* any art investment; User Test Round 1 | If M3 fails → fall back to the polished-arcade design (§2.3 alternative), which shares 90% of the tech |
| R3 | **Mobile thermal throttling** | High | Med | Low tier; adaptive resolution; 30 fps target; shorter sessions suit mobile anyway | Sustained frame time > 33 ms → drop tier |
| R4 | **Night-side readability fails** | Med | High | Emissive entities (§16.3); fallback is a subtle rim light, **never raising ambient** | Phase 5 playtest |
| R5 | **Scope creep via Experimental tier** | Med | Med | §44 tiering; Experimental features are explicitly droppable and touched only after M10 | Any Experimental work before Phase 10 |
| R6 | **Threat Ring is confusing** | Med | High | Prototype early in Phase 6; test in Round 2; fallback is edge-of-screen arrows (less elegant, well-proven) | < 70% comprehension in testing |
| R7 | **Procedural audio sounds cheap** | Med | Low | Careful envelopes; the music bed carries the emotional weight; per-sound A/B | Phase 7 review |
| R8 | **Terrain bake too slow on mobile** | Med | Med | Lower resolution on Low tier (512×256); cache in IndexedDB after first run | Bake > 4 s |
| R9 | **Solo-developer capacity** | Med | High | Phase gating; Essential tier is a complete game on its own; no fixed deadline | Any phase 50% over estimate → cut the next Optional feature |
| R10 | **WebGL2 unavailable** | Low | High | Detect at Boot; clear explanatory page. **No WebGL1 fallback** — a deliberate scope decision, as WebGL2 is >97% supported | Boot detection |

**R2 is the one that matters.** It is why M3 is a hard go/no-go gate before any visual investment: discovering the core design doesn't work *after* building the art is the single most expensive failure available to this project.

---

# 44. Competition Strategy

## 44.1 The differentiator

Most browser game submissions are one of: a graphics demo with thin gameplay, or solid gameplay that looks generic. **Mare Noctis aims to be the entry where a genuine design idea and the technology are the same thing.**

The pitch, in one sentence:

> *On a sphere, you can't be everywhere — so every wave is a decision about what you're willing to lose.*

That is a game design statement, not a technology statement, and it is what makes the spherical setting *necessary* rather than decorative.

## 44.2 Wow factors, ranked by demo value

1. **Flying around a real sphere with correct radial gravity.** Instantly legible in a 10-second clip and self-evidently non-trivial.
2. **The terminator crossing.** A dramatic, recurring visual beat that photographs and films beautifully.
3. **100% procedural content.** "There are no art assets in this game" is a provable, memorable claim.
4. **The Threat Ring.** A novel UI solution to a real perceptual problem, and easy to explain.
5. **Deep accessibility with no aesthetic compromise.** Increasingly a scored criterion, and rarely done well.
6. **Verifiable engineering claims** — zero heap growth, framerate-independent determinism, ≤120 draw calls — all backed by tests in the repo.

## 44.3 Feature tiers

**Essential** — the game does not exist without these:
Spherical flight · outposts + drain · 3 enemy archetypes · primary weapon + heat · wave system · scoring · 12 states · HUD with Threat Ring · tutorial · Debrief · settings · desktop + touch · core accessibility · 60 fps.

**High-value** — strongly differentiating, planned:
Missile lock with proportional navigation · resupply · Orbital Map · procedural audio · terminator lighting · quality tiers · gamepad · seeded determinism · Endless mode.

**Optional** — good if time permits:
Replay of the final wave · screenshot mode · extra enemy variant · outpost specialisations · run seed sharing · colourblind simulator preview in Settings.

**Experimental** — explicitly droppable, touched only after M10:
Tether/grapple (the sole justification for Verlet — cut it and Verlet goes too) · destructible terrain · WebGPU path · procedurally generated music.

**Rule:** no Experimental work begins before Phase 10. This is written down precisely because that is the tier most likely to consume the schedule.

## 44.4 Presentation

- **60-second demo video** — the core idea visible within 15 seconds, terminator crossing at ~25 s, a triage decision with its consequence at ~40 s.
- **README** with architecture diagram, the maths that matters, and the V1→V2 evidence table (§2.2) — showing measured problems and their fixes demonstrates engineering judgment far better than a feature list.
- **Live URL**, verified on a phone, because that is where it will be opened.

---

# 45. Future Expansion

Architected for, not built now.

| Feature | Enabled by | Notes |
|---|---|---|
| **Additional moons** | Data-driven `outposts.ts` + radius constants | Different radii change travel-time budgets, and therefore difficulty, for free |
| **WebGPU path** | Renderer abstraction at the R3F boundary | §17.1 — revisit when the post-processing ecosystem converges |
| **Tether/grapple** | Verlet + distance constraints (§18.3) | Experimental tier; swing around the moon, slingshot to the far side |
| **Co-op** | Deterministic seeded sim (§10.4) | Determinism is already there; only netcode is missing |
| **Level editor** | Data-driven waves (`waves.ts`) | Waves are already pure data |
| **Replay system** | Deterministic sim + input recording | Only inputs need storing — the sim reproduces the rest exactly |
| **Destructible terrain** | Baked map regeneration | Expensive; genuinely experimental |

**The pattern:** determinism and data-driven configuration are load-bearing decisions made now that unlock replay, co-op, level editing, and practice modes later at low cost. That is what "architected for extensibility" actually means, as opposed to leaving hooks that never get used.

---

# 46. Version History

| Version | Date | Change |
|---|---|---|
| 1.0 | Jan 2026 | V1 "Lunar Patrol" — vanilla JS, three r160, endless shooter |
| **2.0.0** | **Aug 2026** | **V2 "Mare Noctis" specification.** Design pivot to outpost defense + triage. Full rewrite: React 19 + Vite 7 + R3F v9 + three r185. Fixed-timestep physics with radial gravity and swept-sphere CCD. Instanced rendering to a 120 draw-call budget. Twelve game states. Procedural audio. Full touch support. Accessibility specified at design time. |

**Change control from here:** any change to §22.1 constants, §28.2 stack, §11 state names, §8 controls, or §34 budgets updates this document **first**, then propagates to `gameprompt.md` and `codePrompt.md`. This document is the source of truth; the others derive from it.

---

*End of specification.*
