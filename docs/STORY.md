# Mare Noctis — the story behind the build

> **[Play it](https://mare-noctis.vercel.app)** · [Source](https://github.com/MdAhbab/moongame) · [Architecture](ARCHITECTURE.md) · [Design doc](gameplan.md)

---

## Inspiration

Almost every arena defense game is played on a plane. The map is flat, it is
bounded, and if you are in the wrong place you turn around and you are back. Distance
in those games is a number that decays to zero on its own.

I wanted distance to be a **decision**, so I put the map on the outside of a sphere.

That one change does something a flat map cannot. On a sphere there is no edge to back
against and no shortcut across the middle — the shortest path between two points is an
arc over the surface, and the furthest point from you is not a corner, it is the
antipode. Eight outposts on a small moon, one craft, and the geometry writes the
game's whole thesis by itself:

$$
T_{\text{crossing}} \;=\; \frac{\pi R}{v_{\text{cruise}}} \;=\; \frac{\pi \cdot 100}{26.02} \;\approx\; 12.1\ \text{s}
$$

Twelve seconds to reach the far side. An outpost under four drain beams has about
thirty. So you can save that one, or the other one, and the arithmetic makes the
choice for you before your reflexes ever get involved.

**The game never asks you to win a fight. It asks you which one you are willing to
lose.** Every mechanic in it is downstream of that sentence, and every deadline in the
game is quoted in units of $T_{\text{crossing}}$ rather than in seconds, so that
retuning the moon's radius or the craft's speed moves every deadline with it instead
of silently breaking the design.

---

## How I built it

### The architecture, in one paragraph

A **deterministic, framework-free simulation** runs on a fixed 120 Hz timestep in plain
objects and typed arrays. Around it sit four adapters that may *read* it and must never
*own* it: a renderer, an audio director, an input layer and a React shell.

```
                 ┌─────────────────────────────────────────┐
                 │  src/game/**   THE SIMULATION            │
                 │  no React · no three · no DOM · no clock │
                 │  fixed 120 Hz · seeded · headless        │
                 └──────────────────┬──────────────────────┘
    ┌─────────────────┬─────────────┼─────────────┬─────────────────┐
    ▼                 ▼             ▼             ▼                 ▼
src/render/**   src/audio/**  src/platform/**  src/state/**   api/** (server)
three · R3F     Web Audio     DOM input        zustand +      replays it to
one useFrame    one director  device profiles  localStorage   verify a score
```

The rules are enforced mechanically rather than by convention. `src/game/**` cannot
import React, three, zustand, `window` or `document` — that is an ESLint
`no-restricted-imports` rule, not a code review comment. It cannot read a wall clock;
every function takes $\Delta t$. It cannot call `Math.random()`; there is one seeded
PRNG per world.

That discipline is what lets the entire simulation run headless in Node, which is why
all 369 unit and integration tests run without a browser — and it is what makes a
replay-verified leaderboard possible at all.

### The physics is written, not imported

There is no physics engine. Flight is a quadratic-drag model integrated
semi-implicitly, which gives an **emergent** terminal velocity rather than a clamped
one:

$$
m\,\dot{\mathbf v} \;=\; \mathbf F_{\text{thrust}} \;-\; k\lVert \mathbf v\rVert\,\mathbf v
\qquad\Longrightarrow\qquad
v_{\text{term}} \;=\; \sqrt{\frac{F}{k}}
$$

With $F_{\text{cruise}} = 88$ and $k = 0.13$ that is $26.02$ u/s. Boost is exactly
$2F$, so boost speed is $\sqrt{2}$ times cruise — $36.80$ u/s — a ratio the test suite
asserts rather than trusts.

Altitude hold is a **critically damped** PD controller, tuned by solving for the
damping rather than by feel:

$$
\omega_n = \sqrt{\frac{k_p}{m}} = \sqrt{25} = 5\ \text{rad/s},
\qquad
k_d = 2m\omega_n = 10
$$

which puts the damping ratio at exactly $\zeta = 1$ — the craft settles onto an
altitude in minimum time with no overshoot and no oscillation. One number wrong in
either direction and the ship either bobs or feels like treacle.

The eight outposts are placed on a **Fibonacci lattice** so they are near-uniformly
spread with no clustering at the poles, using the golden angle
$\gamma = \pi(3-\sqrt5) \approx 2.3999$:

$$
y_i = 1 - \frac{2i}{n-1}, \qquad
r_i = \sqrt{1 - y_i^2}, \qquad
\theta_i = \gamma i
$$

$$
\hat{\mathbf p}_i = (\,r_i\cos\theta_i,\; y_i,\; r_i\sin\theta_i\,)
$$

Missiles use **proportional navigation**, the same guidance law real munitions use,
which makes them lead rather than chase:

$$
\boldsymbol\lambda' = \frac{\mathbf r \times (\mathbf v_t - \mathbf v_m)}{\mathbf r \cdot \mathbf r},
\qquad
\mathbf a_{\text{cmd}} = N \lVert v_{\text{closing}} \rVert \, \boldsymbol\lambda',
\qquad N = 3.5
$$

The missile accelerates to null the line-of-sight rotation rate, which produces an
interception arc instead of a tail-chase. It is three lines of vector math and it is
the difference between a weapon and a homing sprite.

### Everything is instanced, pooled and disposed

Entities live in **structure-of-arrays over typed arrays** in fixed-capacity pools with
an $O(1)$ free list. Nothing in the frame path allocates — no `new`, no object
literals, no closures, no `.forEach`. The garbage collector never runs mid-fight,
verified by a soak test asserting a flat heap.

On the GPU, each of the six enemy archetypes is a single `InstancedMesh` with two
material groups, so 48 concurrent hostiles cost at most 13 draw calls against a budget
of 120 — and an archetype with no instances alive costs zero, because three returns
before it counts the call. Every geometry, material and texture passes through a
disposal registry and is released on teardown.

The moon's albedo, normal and ambient-occlusion maps are **generated procedurally in a
Web Worker** at load, from simplex noise, so the terrain is a few kilobytes of code
rather than megabytes of texture — and the surface relief is reconstructed in the
shader by Mikkelsen's derivative bump, which needs no tangent frame and no UVs:

$$
\mathbf n' \;=\; \text{normalize}\!\left(\mathbf n - \frac{\partial h/\partial x \,(\partial \mathbf p/\partial y \times \mathbf n) + \partial h/\partial y\,(\mathbf n \times \partial \mathbf p/\partial x)}{\partial \mathbf p/\partial x \cdot (\partial \mathbf p/\partial y \times \mathbf n)}\right)
$$

---

## Challenges I ran into

### 1. A game that ran at different speeds on different monitors

The first version integrated per *frame*: `speed += ACCELERATION`. On a 144 Hz display
that is 2.4× the acceleration of a 60 Hz one, so the game was literally a different
game depending on your hardware.

The fix is a fixed timestep with an accumulator, and interpolated rendering:

$$
A \mathrel{+}= \Delta t_{\text{real}}, \qquad
\textbf{while } A \ge h: \;\; \text{step}(h),\; A \mathrel{-}= h, \qquad h = \tfrac{1}{120}
$$

$$
\alpha = \frac{A}{h}, \qquad
\mathbf p_{\text{drawn}} = \mathbf p_{\text{prev}} + \alpha\,(\mathbf p_{\text{curr}} - \mathbf p_{\text{prev}})
$$

Skipping the interpolation and drawing the live position throws away up to 8.3 ms of
motion per frame, which reads as judder even though the simulation is correct. The
accumulator is clamped at 0.25 s so a backgrounded tab cannot queue thousands of
substeps and freeze on return.

### 2. Bullets that passed through enemies

Discrete distance checks once per frame, with rounds moving faster than the target is
wide, means fast shots teleport through. Players reported it as "shooting doesn't work",
and they were right.

Solved analytically with a **swept-sphere continuous test** — a ray-sphere intersection
across the substep. For a projectile at $\mathbf p$ with velocity $\mathbf v$ against a
target at $\mathbf c$ with combined radius $r$, let $\mathbf m = \mathbf p - \mathbf c$:

$$
a = \mathbf v \cdot \mathbf v, \qquad
b = 2\,(\mathbf m \cdot \mathbf v), \qquad
C = \mathbf m \cdot \mathbf m - r^2
$$

$$
t = \frac{-b - \sqrt{b^2 - 4aC}}{2a}, \qquad \text{hit if } 0 \le t \le \Delta t
$$

Three dot products and a quadratic solve, and tunnelling stops being possible rather
than becoming unlikely.

### 3. A 60 Hz HUD in React

The HUD carries a hull gauge, a heat gauge, an altitude ladder, a speed readout, a
combo meter and up to 56 threat markers. Routing those through React state re-renders
the tree sixty times a second to move some text.

So per-frame values never touch React at all. They are projected into pre-allocated
buffers and written **straight to DOM nodes through refs**; only event-driven state
reaches the store, throttled to 10 Hz. The result is **zero re-renders during play**.

The lesson generalised badly at first — I applied the rule to gameplay and not to the
menus, and the wave-clear screen ended up running five concurrent `requestAnimationFrame`
loops each calling `setState` per tick. That is ~300 renders a second, on the one screen
where the 3D scene is *still drawing at full resolution* behind a translucent overlay.
It read as the game freezing between waves. Per-frame values do not belong in React
state on any screen.

### 4. Determinism, because the leaderboard depends on it

A submitted score is a **seed plus an input log**. The server replays those inputs
through the identical simulation and checks the claimed score falls out; a run that
cannot be reproduced does not rank. That makes forgery a matter of finding a genuine
input sequence, which is just… playing the game.

It also means determinism is not a nice property, it is the security model. Every
source of nondeterminism had to go:

- input sampled inside the fixed step, never per frame — otherwise a 60 Hz and a
  144 Hz client feed the world different histories over the same ten seconds;
- one seeded PRNG, reseeded per wave from the run seed, so wave $N$ is reproducible
  regardless of how wave $N-1$ went;
- no wall clock anywhere below the presentation layer.

Asserted at 10,000 steps. A twelve-wave run is ~14,400 frames, which packs to about
74 KB and verifies in ~640 ms.

### 5. The renderer and the simulation quietly disagreeing

This is the class of bug that cost me the most time, and none of it was caught by unit
tests, because every individual unit was correct.

The enemy models were scaled by a hand-tuned constant in the render layer while
collision used radii from the tuning file. Measured, the hulls on screen were **8× to
18× larger** than the spheres being tested. You aimed at a hostile filling the screen
and fired through empty space. The fix was to stop declaring the scale and start
deriving it — every model is now fitted so its furthest vertex sits at
$r \times 1.35$, and a test compares the two so they cannot drift apart again.

The same shape of bug kept reappearing:

- Two `useFrame` loops writing the *same* shader uniform from two different clocks —
  one wall-clock, one simulation-time — with whichever ran last winning the frame.
- The audio director reading craft state on screens where the world was frozen, so the
  engine roared at the last cruise velocity over the pause menu indefinitely.
- Thirty ship parts with an *optional* `cost` field that not one of them set, so every
  part was free, `spendCredits(0)` always succeeded, and the entire store was
  unreachable code.
- Two wave bonuses computed by a function that was guarded against double-awarding —
  and since the guard always hit on the normal path, both bonuses were structurally
  always zero. The FLAWLESS and PERFECT DEFENSE badges could never appear.

Every one of those passed the test suite and shipped.

### 6. Making six enemy types legible

Three archetypes are easy to tell apart. Six is the point where "you can tell them
apart" stops being self-evident and needs to be engineered.

The rule is **silhouette and behaviour first, colour second**, so a player with any
colour vision deficiency loses no information. The three late archetypes are sized to
be distinct at a glance — a test asserts the full ordering and a minimum 10%
separation between every pair — and on the threat ring each new glyph is drawn as a
*variation* on the early one it rhymes with. A filled chevron is unmistakably "a
Harvester, but more so", which is exactly what a Carrier is. Six archetypes cost the
player three shapes to learn.

---

## What I learned

**Composition bugs are the expensive ones.** Nearly every serious defect in this
project sat in the seam *between* two correct components. Unit tests cannot see them by
construction. What catches them is end-to-end tests that drive the built game in a real
browser and assert on *observable state* — instrument readings, visible buttons,
`localStorage` — rather than on which functions were called.

**Derive, don't declare.** Every duplicated constant in this codebase eventually
disagreed with itself. A hand-tuned model scale disagreed with the collision radius. A
credits-per-outpost constant existed in two files with a 4× difference and the wrong
one was live. An optional price field was never filled in by anything. The fix is
always the same shape: make it impossible to forget by computing it from the one place
the truth lives.

**An interface that lies is worse than one that says nothing.** The wave-clear
breakdown showed `kills × 100` and `outposts × 700` — numbers that appear nowhere in
the scoring model — above a real total they did not sum to, and printed a multiplier
between 1.0 and 2.5 as a points value, so a good run displayed "+2". Aim assist is the
positive version of the same principle: it moves the *crosshair*, visibly, and never
the shot, so the reticle is never lying about where the round will go.

**Test the property, not the number.** Assertions like "every non-stock part costs more
than zero", "price is monotonic in unlock level", and "a full run buys some of the
catalogue but not all of it" survive every retune. Assertions on specific figures fail
the moment you balance anything, and get deleted.

**Constraints are a design tool.** Capping the enemy pool at 48 was a performance
decision that turned out to be a *design* decision: spawns beyond the cap queue rather
than drop, so difficulty stays authored instead of emerging from whatever the frame
budget happened to allow. Endless mode's caps do the same job — simultaneity stops at
five of eight outposts, because with nothing safe there is no triage, only a lottery.

---

## Accomplishments I'm proud of

- **It plays identically on any refresh rate.** Same seed, same inputs, same state —
  asserted at 10,000 steps and across 60 / 120 / 144 Hz and deliberately awkward
  non-integer rates.
- **Zero React re-renders during play**, with a HUD that carries 56 live markers.
- **A leaderboard that cannot be forged**, because the server re-plays your run.
- **The game is fully playable muted.** Every sound names the visual channel carrying
  the same fact — audio is always the second channel, never the only one.
- **369 tests** across 27 files, zero lint warnings, and a whole game — engine,
  scene, audio synthesis, UI and simulation — that ships in about 494 KB gzipped,
  Three.js included.

---

## What's next

- Ghost replays — the data is already there; a run is a seed and an input log, so
  racing a previous attempt is a rendering problem, not a simulation one.
- Daily seeds, since wave composition is already a pure function of
  $\text{hash}(\text{runId}, N)$.
- More worlds. The environment is three numbers — gravity, drag, terrain — and the
  balance harness already checks any world stays inside the ±6% cruise band that every
  stated deadline assumes.
