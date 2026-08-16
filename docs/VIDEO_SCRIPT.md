# Mare Noctis — 3-Minute Presentation Script

**For:** web-games hackathon submission video
**Format:** the **NARRATION** blocks are the only text to feed a voice AI. Everything in
`[VISUAL]` lines is direction for the edit and should not be read aloud.
**Total spoken:** 442 words ≈ 3:00 at a measured pace (~150 wpm) with the pauses marked.
Section timings are budgeted at 2.5 words/second and sum to 180 s; the body and the
appendix below are word-for-word identical, so either can be recounted to check drift.

**Accuracy note.** Section 7 is the part of this script that goes stale. An earlier cut
claimed the game ships *no art files at all* — that was false and would have been false on
camera. The true version is narrower and still the interesting one: the **hostiles** are
built at startup from code primitives (`src/render/geometry/shapes.ts`) and the **terrain**
is baked procedurally in a worker (`src/workers/terrainWorker.ts`). The player craft
(Kenney Space Kit, CC0), the HDRI, the loading and credits backdrops, the tutorial stills
and the threat-card icons are all shipped files. `docs/CREDITS-ASSETS.md` is the record —
check it before rewriting this section.

---

## 1 · Cold open (0:00 – 0:16)

`[VISUAL] Black. One beat. Cut to the moon from high orbit, craft entering frame. No HUD.]`

> **NARRATION**
>
> A small moon. Eight outposts. One craft.
>
> Something is descending on all of them at once.
>
> *(pause)*
>
> This is Mare Noctis — and its entire design comes from one piece of arithmetic:
> on a sphere, you cannot be everywhere.

---

## 2 · The core tension (0:16 – 0:38)

`[VISUAL] Orbital map (M) showing two outposts under attack on opposite hemispheres. Then a hard cut to the cockpit view, flying hard toward one of them.]`

> **NARRATION**
>
> Harvesters land on an outpost and drain it. You fly to one — and the far side of the
> world is genuinely far away.
>
> So every second spent defending here is a second not spent defending there. The game
> never asks you to win a fight. It asks which one you are willing to lose.

---

## 3 · Combat that can be read (0:38 – 1:11)

`[VISUAL] An Interceptor stalking. It flares and lines up — hold on the wind-up. The player breaks hard, it blows past, and gets shredded in the overshoot. Then cut to the three system pips as one goes amber, and hold long enough to see the nose drifting off-centre against the crosshair.]`

> **NARRATION**
>
> Enemies are beaten, not just survived.
>
> An Interceptor stalks you, then winds up — it stops manoeuvring, lines up, visibly
> flares, and commits to a dive it cannot correct. Break that line and it blows past you
> into two seconds of exposure, taking two and a half times damage, unable to shoot back.
>
> *(pause)*
>
> Damage lands on a system, not a number. A hurt stabiliser pulls your nose one consistent
> way that you fly against, by hand, for the rest of the wave.

---

## 4 · The back third (1:11 – 1:45)

`[VISUAL] Three beats, one per archetype, each held just long enough to read the silhouette against the sky. Sapper: a hard bright line coming in low, the arming flare, the detonation, and the integrity bar dropping in one step. Warden: rounds vanishing on the field, then the Warden dies and the same rounds land. Carrier: pull up to find it parked high with the bay open, and a Harvester dropping out of it.]`

> **NARRATION**
>
> The back third adds three more, and none is simply tougher.
>
> A Sapper runs flat and fast at an outpost and detonates on it. Every other threat is a
> clock you can arrive late to. A Sapper you stop or you do not — and one hit is enough.
>
> A Warden projects a field that makes everything inside it immune. You cannot flank that.
> You retarget.
>
> A Carrier parks high, launching a fresh Harvester every eleven seconds — the only kill
> that prevents future work.

---

## 5 · The escort ability (1:45 – 2:12)

`[VISUAL] Press H. Drones launch and take formation. Show the HUD pip counting down. Then a later sortie with four drones, and a beat where one is destroyed and the pip resets.]`

> **NARRATION**
>
> Press H and the bay launches an escort that flies your wing and fights on its own.
>
> The first sortie is one drone. Bring the formation home alive and the next is bigger and
> longer, up to four. Lose one and you start again from a single drone.
>
> Four drones is something you earned across four careful sorties — most valuable exactly
> when it is most likely to die.

---

## 6 · Loss as a decision (2:12 – 2:25)

`[VISUAL] The craft is destroyed. Cut to the salvage screen: three legendary cards, player picks one, drops straight back into the fight.]`

> **NARRATION**
>
> Perks build across a run. Being destroyed takes all of them — then offers you three
> legendaries, and lets you fit one.
>
> The lowest point in a run is the biggest decision in it.

---

## 7 · How it is built (2:25 – 2:53)

`[VISUAL] Terrain resolving from smooth to cratered as the worker returns. Then a hostile assembling out of its primitives, wireframe to shaded. Then a clean frame-time graph. Keep cuts fast.]`

> **NARRATION**
>
> The moon is procedural — every crater baked in a worker thread at load. Every hostile
> you just saw is built from code primitives at startup, not loaded from a model file.
>
> Underneath: a fixed 120-hertz simulation with interpolated rendering, identical on any
> monitor. Zero React re-renders while you fly. No allocation in the frame path. Every run
> is a seed and an input log — so any run can be replayed, exactly.

---

## 8 · Close (2:53 – 3:00)

`[VISUAL] Pull back to the full moon, outposts lit. Title card: MARE NOCTIS. URL beneath.]`

> **NARRATION**
>
> Eight outposts. One craft. You cannot be everywhere.
>
> *(pause)*
>
> Mare Noctis. Playable now, in your browser.

---

## Narration-only text

*(Everything below is the same script with direction stripped — paste this straight into a
voice tool.)*

A small moon. Eight outposts. One craft. Something is descending on all of them at once.

This is Mare Noctis — and its entire design comes from one piece of arithmetic: on a
sphere, you cannot be everywhere.

Harvesters land on an outpost and drain it. You fly to one — and the far side of the world
is genuinely far away. So every second spent defending here is a second not spent
defending there. The game never asks you to win a fight. It asks which one you are willing
to lose.

Enemies are beaten, not just survived. An Interceptor stalks you, then winds up — it stops
manoeuvring, lines up, visibly flares, and commits to a dive it cannot correct. Break that
line and it blows past you into two seconds of exposure, taking two and a half times
damage, unable to shoot back.

Damage lands on a system, not a number. A hurt stabiliser pulls your nose one consistent
way that you fly against, by hand, for the rest of the wave.

The back third adds three more, and none is simply tougher.

A Sapper runs flat and fast at an outpost and detonates on it. Every other threat is a
clock you can arrive late to. A Sapper you stop or you do not — and one hit is enough.

A Warden projects a field that makes everything inside it immune. You cannot flank that.
You retarget.

A Carrier parks high, launching a fresh Harvester every eleven seconds — the only kill
that prevents future work.

Press H and the bay launches an escort that flies your wing and fights on its own. The
first sortie is one drone. Bring the formation home alive and the next is bigger and
longer, up to four. Lose one and you start again from a single drone. Four drones is
something you earned across four careful sorties — most valuable exactly when it is most
likely to die.

Perks build across a run. Being destroyed takes all of them — then offers you three
legendaries, and lets you fit one. The lowest point in a run is the biggest decision in
it.

The moon is procedural — every crater baked in a worker thread at load. Every hostile you
just saw is built from code primitives at startup, not loaded from a model file.

Underneath: a fixed 120-hertz simulation with interpolated rendering, identical on any
monitor. Zero React re-renders while you fly. No allocation in the frame path. Every run
is a seed and an input log — so any run can be replayed, exactly.

Eight outposts. One craft. You cannot be everywhere.

Mare Noctis. Playable now, in your browser.
