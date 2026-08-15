# 2D art brief — generation prompts

> **Status: delivered and placed (2026-08-11).** All eight images were generated
> and are live. Full-resolution originals are in `art-source/` (outside
> `public/`, git-ignored); the shipped derivatives are listed in
> `docs/CREDITS-ASSETS.md`. The prompts below are kept so any slot can be
> regenerated in the same style.


Every slot below is **already wired in code** and **already optional**: each
`<img>` carries an `onError` handler that hides the element, so a missing file
costs nothing and a delivered file appears with no code change. Drop the PNG in
at the exact path and it is live on the next reload.

Filenames are load-bearing. `BriefingScreen.tsx` builds its path from
`archetype.name.toLowerCase()`, so `Harvester` → `/enemies/harvester.png` and
nothing else will resolve.

---

## 0. The house style — paste this at the top of every prompt

The existing `loading-art.png` sets it: photoreal, airless, near-monochrome.
Anything painterly, cel-shaded or neon-cyberpunk will read as a different game.

> **Style:** photorealistic hard science fiction, rendered like a NASA
> photograph. Airless vacuum — no atmospheric haze, no light bloom in the sky,
> no god rays. Sky is pure black (#05060A) with sparse, small, unglowing stars.
> Lighting is a single hard sun from one side: blown highlights, near-black
> shadows with only faint bounce light from grey regolith. Surfaces are dusty,
> scuffed, matte, engineering-real — not glossy chrome.
>
> **Palette, strictly:** regolith grey `#B8B4AD`, shadow `#0A0C10`, void
> `#05060A`. Exactly two accent colours, used sparingly as emissive light only:
> **cyan `#7FE8FF` for friendly/player**, **amber-orange `#FF8A3D` for
> hostile/enemy**. No other saturated colour anywhere. No purple, no teal, no
> lens flare, no colour grading toward blue.
>
> **No text, no numbers, no logos, no watermark, no UI overlay, no frame or
> border.**

---

## Set A — Threat cards (3 files) · `public/enemies/`

Shown on the Briefing screen at **64 × 64 px** beside the name and role.
Generate at **512 × 512**, transparent background if your tool supports it;
otherwise flat `#05060A` and I'll key it out.

The design constraint that matters more than the rendering: **these three must
be distinguishable by outline alone at 40 px.** That rule is `gameplan.md`
§35.1 and it exists so colour-blind players lose no information. If you squint
and two of them look alike, regenerate rather than accept it.

| File | Prompt |
|---|---|
| `harvester.png` | *[house style]* Three-quarter view of a squat hexagonal industrial mining drone, wider than it is tall, standing on **four thick articulated landing legs** splayed outward. Heavy, deliberate, agricultural rather than military. Pitted grey-brown armour plating, an amber `#FF8A3D` emissive intake glowing on the underside. Centred, isolated on black, filling ~80% of the frame. |
| `interceptor.png` | *[house style]* Three-quarter view of a **narrow swept-back dart** fighter craft — long, thin, aggressive, wings raked hard backward to a sharp point. Nothing bulky, no legs. Dark charcoal hull with amber `#FF8A3D` engine glow at the rear and a thin amber sensor line along the nose. Reads as fast even standing still. Centred, isolated on black, filling ~80% of the frame. |
| `sentinel.png` | *[house style]* Front three-quarter view of a **broad flat angular plate** — a hovering weapons platform, wide and slab-like, with a large hexagonal **directional shield panel across its front face**, faintly lit amber `#FF8A3D` at the edges. Immobile and fortress-like. No wings, no legs. Centred, isolated on black, filling ~80% of the frame. |

**The silhouette test, in one line:** Harvester = wide + legs. Interceptor =
thin + pointed. Sentinel = flat slab + shield face.

---

## Set B — Tutorial beats (3 files) · `public/tutorial/`

Shown at **96 × 96 px** with a 2 px corner radius on a `#05060A` panel, beside
the instruction text. Generate at **512 × 512**, square, opaque, background
`#05060A` — transparency is not needed here.

At 96 px these are read in under a second, so each must have **one** clear
subject. Wide vistas turn to mush; think icon-with-depth, not concept art.

| File | Prompt |
|---|---|
| `beat-fly.png` | *[house style]* A single sleek cyan-accented spacecraft **banking hard to the left**, seen from behind and slightly above, over a strongly curved grey lunar horizon. A short cyan `#7FE8FF` exhaust ribbon trails behind it and curves with the turn. The curvature of the moon is exaggerated and obvious. Craft occupies the centre third of the frame. |
| `beat-shoot.png` | *[house style]* View **down the nose of the player craft**: a dark drone silhouette dead centre in the middle distance, with two thin cyan `#7FE8FF` tracer bolts streaking toward it. The drone is a clean dark shape against black. Simple, centred, unmistakably an act of aiming. |
| `beat-defend.png` | *[house style]* Two squat four-legged amber-lit **harvester drones descending** onto a low **hexagonal outpost structure** on grey lunar ground, seen from a low three-quarter angle. Thin amber `#FF8A3D` drain beams reach from the drones down to the outpost. The outpost itself is lit faintly cyan `#7FE8FF`. Threatening, imminent. |

> **Note:** `public/tutorial/` currently holds `beat-boost.png`,
> `beat-lock.png` and `beat-outpost.png` from an earlier version of the
> tutorial. Nothing references them — the beats were renamed to
> fly/shoot/defend. Safe to delete once the new three land.

---

## Set C — Cinematic backdrops (optional replacements) · `public/`

Both already exist at 1024 × 1024 and are decent. Regenerate only if you want
them stronger; **generate at 1920 × 1080** this time, since both are used
full-bleed and the current square crops badly on wide screens.

| File | Prompt |
|---|---|
| `loading-art.png` | *[house style]* Wide cinematic view across a cratered grey lunar plain at night, camera low near the surface. Three small hexagonal outposts sit spread along the horizon, each lit by a faint amber `#FF8A3D` glow, one emitting a thin vertical amber beam into the black sky. A crescent Earth hangs in the upper right, small and photoreal. Vast, quiet, and slightly ominous. Deep empty black across the top half for text overlay. |
| `credits-art.png` | *[house style]* A single spacecraft with cyan `#7FE8FF` engine glow departing a grey lunar surface, seen from behind as it climbs toward a distant crescent Earth in the upper third. Long slow diagonal composition. Melancholy, resolved, end-of-story. Large areas of pure black for scrolling text. |

---

## Delivery

```
public/
├── enemies/          ← create this folder
│   ├── harvester.png
│   ├── interceptor.png
│   └── sentinel.png
├── tutorial/
│   ├── beat-fly.png
│   ├── beat-shoot.png
│   └── beat-defend.png
├── loading-art.png   (optional replacement)
└── credits-art.png   (optional replacement)
```

Keep them under ~150 KB each after export — they load on screens that must not
stall. If a PNG comes out large, run it through `pngquant` or hand them over and
I'll compress and, for Set A, key the background out.

Record anything generated by a model in `docs/CREDITS-ASSETS.md` with the tool
and date, same as the third-party assets.
