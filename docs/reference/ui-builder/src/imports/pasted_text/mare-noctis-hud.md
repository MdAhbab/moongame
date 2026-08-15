Design the complete interface for MARE NOCTIS, a browser-based 3D orbital defense game.
Read this entire brief before designing anything. The individual screens only make sense once you understand what the player is doing and why. Do not begin with the main menu. Begin by understanding the moment-to-moment experience, because the HUD is the most important artifact here and every other screen exists to support it.

PART 1 — WHAT THIS PRODUCT IS
The premise
The player pilots a single spacecraft in low orbit around a small moon. Eight research outposts sit on the moon's surface. Alien harvesters descend from space, land beside the outposts, and drain them. A fully drained outpost goes dark permanently for that run.

The player flies around the sphere destroying harvesters before the drain completes.

The one idea that matters
On a sphere, you cannot be everywhere.

Threats appear at multiple points on the moon simultaneously. Flying from one side to the other takes roughly nine seconds. A drain completes in about twenty. So when two outposts are attacked at once on opposite sides, the arithmetic often does not close — and the player must decide which outpost to save and which to accept losing.

That decision is the game. Not the shooting. The shooting is how you execute a decision you already made.

Every design choice in this interface must serve that decision. The player needs to know, at a glance and under time pressure:

Where am I?
What is threatened?
How long do I have?
How far away is it?
If the interface answers those four questions instantly, it succeeds. If it looks beautiful and answers them slowly, it fails.

The emotional target
Tense, clean, and slightly lonely. The player is one pilot responsible for eight fragile places, and they will not save all of them. When an outpost is lost, the lights go out on the surface and stay out. The interface should feel like a precision instrument — calm, technical, and trustworthy — so that the drama comes from the situation rather than from the UI shouting.

Reference feel: the cockpit instrumentation of a spacecraft. Thin strokes, luminous data on darkness, generous negative space, nothing decorative. Not a consumer app. Not a neon cyberpunk arcade cabinet.

Who plays it
Competition judges — technically literate, playing for 90 seconds to 3 minutes, evaluating many entries in a row. The interface must be self-explanatory. There is no manual and no patience for one.
Casual visitors on a phone — arrived from a link, no context, will leave if the first screen is confusing.
Enthusiast players — want mastery, want to see exactly how they scored and why they lost.
Players with colour vision deficiency or motion sensitivity — must get the full game, not a reduced version.
What the player physically does
Desktop: the mouse steers the craft, so the crosshair is the ship's nose. W/S throttle. A/D roll. Space/Ctrl change altitude. Left mouse fires. Right mouse locks a missile. Shift boosts. Tab opens an orbital map. Esc pauses.

Touch: left thumb is a floating virtual stick that steers; right thumb is a vertical throttle slider; firing is automatic by default.

PART 2 — THE CRITICAL CONSTRAINT ABOUT WHAT YOU ARE DESIGNING
You are designing the 2D interface layer only. You are not designing the 3D scene.

The game world — the moon, the spacecraft, the enemies, the stars — is rendered by a separate real-time 3D engine underneath your interface. Wherever the game world appears, represent it as a placeholder region: a dark surface with a subtle suggestion of a curved lunar horizon and a star field, clearly a stand-in.

Your job is everything drawn on top of and around that region: the HUD, all menus, all screens, all overlays, all transitions.

Design the HUD as a transparent overlay layer. The 3D world must remain visible through it. Never place an opaque panel over the centre of the screen during gameplay.

PART 3 — DESIGN SYSTEM
Define these as reusable tokens/variables and use them consistently everywhere.

Colour
The palette is functional before it is aesthetic. Colour carries meaning, and the meanings are fixed.

Token	Hex	Meaning — never use for anything else
void	#05060A	Space, deepest background
surface	#0D1117	Panel backgrounds
surface-raised	#151B24	Elevated panels, modals
regolith	#B8B4AD	Sunlit lunar terrain (warm grey)
earthshine	#2A3F5F	Night-side fill, cool blue
friendly	#7FE8FF	The player, healthy outposts, the player's own fire. Cyan.
hostile	#FF8A3D	Every enemy and every enemy projectile. Amber.
critical	#FFFFFF	Highest urgency only. Always animated, never static.
caution	#FFC857	Draining outposts, heat warning
inert	#4A5058	Lost outposts, disabled controls
text-primary	#E8EDF2	
text-secondary	#8B97A6	
Non-negotiable rules:

Never use red-versus-green to distinguish anything. Threat coding is amber versus cyan. Amber and cyan differ in both brightness and blue–yellow opponency, so they stay distinguishable for all three common types of colour blindness. Red/green does not, and roughly 6% of men cannot reliably tell them apart.
Colour is never the only carrier of meaning. Anything distinguished by colour must also be distinguished by shape, position, or animation. Design every state so it still reads correctly in greyscale — then check it.
critical white is reserved for genuine emergencies and always pulses. If white appears without motion, it is the wrong token.
Typography
Two typefaces only.

Chakra Petch — HUD, numerals, headings, buttons, all game-facing text. Technical character, high legibility at small sizes. Use tabular/monospaced figures for all numbers. Score, hull, heat, and timers change constantly; proportional figures make them jitter and shift, which is distracting and looks unprofessional.
Inter — settings, descriptions, debrief prose, any paragraph text. Chosen because settings must be readable; display faces are not.
Role	Size	Weight	Tracking
Display (title)	64 / 48 mobile	700	−0.02em
Screen heading	32	600	−0.01em
Section heading	24	600	0
HUD primary numeral	28	700	0.02em
HUD label	12	500	0.12em, uppercase
Body	16	400	0
Caption	14	400	0
16px minimum for body text. 14px is the absolute floor for any label. The previous version used 11px grey text on black, which was unreadable — do not repeat this.

Wide letter-spacing on uppercase HUD labels is what makes them read as instrumentation rather than as web copy.

Spacing and layout
8px base unit. Scale: 4, 8, 12, 16, 24, 32, 48, 64, 96. All HUD elements sit within a 90% safe area. Touch targets are minimum 44×44px, and must respect device safe-area insets on mobile.

Elevation
The world is at the bottom. There is no drop shadow anywhere — there is no atmosphere in this game, and soft shadows would contradict the entire art direction. Separate layers with luminosity, thin 1px strokes at 12% opacity, and background blur instead.

Layers, bottom to top: 3D world → HUD overlay → alerts → screen overlays → modals.

Shape
Panels: 2px radius. Nearly sharp. This is instrumentation, not a consumer app.
Strokes: 1px standard, 2px emphasis.
Buttons: 2px radius, 1px stroke, transparent fill; filled only for the single primary action on a screen.
No gradients except one specific case: a subtle vertical scrim behind text that overlays the 3D world, to guarantee contrast.
Motion
Motion communicates causality and state. It is never decoration.

Purpose	Duration	Easing
UI element enters	180ms	cubic-bezier(0.2, 0.8, 0.2, 1)
UI element exits	240ms	cubic-bezier(0.4, 0, 1, 1)
Screen transition	320ms	cubic-bezier(0.2, 0.8, 0.2, 1)
Value change (numbers)	400ms count-up	easeOutCubic
Alert entry	180ms with slight overshoot	cubic-bezier(0.34, 1.4, 0.64, 1)
Urgency pulse	600ms loop (slow) → 200ms loop (critical)	easeInOut
Things arrive quickly and leave calmly. Pulse rate encodes urgency — this is a data channel, not an effect, so it must be consistent everywhere it appears.

Design a reduced-motion variant of every animated element. In that variant, animation is replaced with a static state change that carries identical information. Reduced motion must never mean reduced information.

PART 4 — THE HUD
This is the most important thing you will design. The player looks at it under time pressure while flying.

Information hierarchy
Four tiers. Tier 1 is largest and most stable in position; tier 4 is deliberately quiet.

Survival — Hull, Threat Ring
Objective — Outpost Roster, drain warnings
Tactical — Heat, boost charge, lock state
Ambient — score, combo, wave number
Score is tier 4 on purpose. During a decision, score is the least useful thing on screen, and making it prominent would pull attention away from the choice that matters.

Desktop layout
┌──────────────────────────────────────────────────────────────┐
│ ▓▓▓▓▓▓▓▓░░ HULL 78           WAVE 5           SCORE 12,480   │
│ ▓▓▓░░░░░░░ HEAT 31                            ×3 COMBO       │
│                                                               │
│  OUTPOSTS                         ╭───────────╮          ▲   │
│  ◆ VEGA      100%                │     ·      │          70  │
│  ◆ KEPLER     94%                │   ╭────╮   │          ─   │
│  ◈ CASSINI    41% ▼              │   │  ✛ │   │          ─   │
│  ◆ TYCHO     100%                │   ╰────╯   │          25  │
│  ◇ HADLEY      — LOST            │     ·   ◂  │          ─   │
│  ◆ AITKEN    100%                ╰───────────╯          ─   │
│  ◆ RILLE      88%                 THREAT RING            8   │
│  ◆ NECTARIS  100%                                        ▼   │
│                                                               │
│                   ───────  horizon  ───────                   │
│  ⚡ BOOST ▓▓▓▓▓▓░░░░                ⌖ LOCK 0.8s              │
└──────────────────────────────────────────────────────────────┘
Component: THREAT RING ← the signature element
Design this first. It is the most novel and most important component, and everything else is easier once it exists.

The problem it solves. The player is on a sphere. Threats are frequently behind them, or beyond the horizon, or on the far side of the moon entirely. A conventional minimap fails here because the space is curved and the player's orientation constantly changes. Without this component the game is unplayable.

What it is. A thin circular ring surrounding the crosshair at screen centre. Each threat and outpost appears as a marker on or inside the ring.

How it encodes information — four independent channels:

Channel	Encodes	Detail
Angular position on the ring	Bearing	12 o'clock = directly ahead. 6 o'clock = directly behind. This is the primary information.
Distance from ring centre	Proximity	Closer to the outer edge = further away. Markers for very close threats sit near the crosshair.
Marker shape	Entity type	Chevron = Harvester · Dart = Interceptor · Bar = Sentinel · Hexagon = Outpost
Pulse rate	Urgency	Still = safe · slow = threatened · fast = critical
Colour reinforces (amber hostile, cyan friendly) but is never the sole carrier — shape and pulse must fully convey the situation in greyscale.

Design requirements:

The ring must not obscure the crosshair or the centre of the screen. Keep the interior clear.
Markers for threats behind the player sit on the lower half and carry a small inward-pointing arrow.
Markers must remain legible at 16px.
The ring is thin — 1 to 2px stroke, low opacity when idle.
This component grows proportionally larger on mobile, not smaller. On a small screen it is the single most important element and deserves more relative space.
Design these states: idle (no threats) · one threat · several threats at varied bearings · a critical threat behind the player · a lost outpost marker.

Component: OUTPOST ROSTER
Eight entries, left edge, always in the same fixed order so the player builds spatial memory. Each shows a status glyph, the name, and integrity percentage.

Outposts have names, not numbers — Vega, Kepler, Cassini, Tycho, Hadley, Aitken, Rille, Nectaris. This matters: "Lost Cassini" is memorable and personal in a way "Lost Outpost 3" is not, and the end-of-run debrief depends on it landing emotionally.

States, each visually distinct without relying on colour:

State	Glyph	Treatment
Nominal	◆ filled diamond	Cyan, static
Threatened	◆ filled + outline halo	Amber, slow pulse
Draining	◈ diamond with inner line	Amber, fast pulse, percentage counts down visibly, small ▼
Critical (<25%)	◈	White, rapid pulse, entry shifts 2px right
Lost	◇ hollow	Inert grey, name struck through, "— LOST"
On mobile this collapses to a single line: a count of healthy outposts plus the most urgent entry in full.

Component: HULL and HEAT gauges
Horizontal segmented bars, top-left. Segments rather than smooth fills, because segments are countable at a glance under pressure — the player can read "three left" without processing a proportion.

Hull: cyan when healthy, amber below 40%, white and pulsing below 20%. Damage causes a brief flash and the bar visibly drops.
Heat: fills as the weapon fires, drains when released. At 100% the weapon locks out — design an unmistakable lockout state, since being unable to fire without knowing why is the most frustrating thing that can happen. Show a distinct lockout glyph on the crosshair as well.
Component: CROSSHAIR and LOCK RETICLE
The crosshair sits at exact screen centre and indicates the ship's nose. Shots always travel exactly where the crosshair points. The interface must never imply otherwise.

Design a visible aim-assist behaviour: when the crosshair passes near a valid target, the crosshair itself is gently pulled toward it with visible eased motion. The player should see the assist happen. This is deliberate — assistance the player can observe is honest; assistance hidden behind the interface is not.

States: neutral · near a target (magnetised, slightly enlarged) · firing (brief bloom) · heat lockout (distinct glyph, unmistakable) · locking a missile (a converging bracket that closes over 1.2 seconds around the world-space target — a spatial progress indicator, not a percentage readout) · locked (snapped, ready).

Component: ARTIFICIAL HORIZON
A thin line across the lower third indicating the local horizontal relative to the moon's surface. Because "up" is different at every point on a sphere, this is the player's primary orientation anchor. Subtle, low-opacity, always present.

Component: ALTITUDE LADDER
Right edge, vertical. Marks the floor (8) and ceiling (70) with the current altitude highlighted. A small arrow shows whether the player is climbing or descending. A warning zone near the terrain floor.

Component: COMBO METER
Appears only above ×2. Sits below the Threat Ring, small. Caps at ×5 — design it to visibly reach a maximum, since an unbounded number would imply infinite scaling and make score meaningless.

Component: ALERTS
Upper-centre band, never over the crosshair or the Threat Ring.

Only one alert is visible at a time — simultaneous alerts reliably result in the player noticing none of them. Queue by priority.

Examples: OUTPOST VEGA UNDER ATTACK · CASSINI CRITICAL · OUTPOST HADLEY LOST · WEAPON OVERHEAT · TERRAIN PROXIMITY

Design three severity levels with distinct treatments. Entry has slight overshoot; exit is a calm fade.

Component: DAMAGE VIGNETTE
When the player is hit, an edge glow appears on the side the damage came from — so the player learns where the threat is, not merely that they were hurt. Maximum 40% opacity, edges only, never obscuring the centre. 90ms in, 400ms out.

PART 5 — ALL TWELVE SCREENS
These exact names are used throughout the project. Use them.

1. BOOT
Momentary. Wordmark on void. If the browser lacks WebGL2, this becomes a clear explanatory message naming the actual problem and suggesting specific browsers — never a blank screen or a generic error.

2. LOADING
The game genuinely generates its entire moon at load time — terrain, craters, and textures are computed, not downloaded. So show real, specific progress, not an indeterminate spinner.

Progress bar with named stages: GENERATING TERRAIN → MAPPING CRATERS → PLACING OUTPOSTS → INITIALISING SYSTEMS.

Design this as a moment of anticipation, not dead time. A wireframe sphere assembling itself as progress advances would be ideal.

3. TITLE
Live 3D moon slowly rotating behind (placeholder region). Wordmark upper-left or centred. Menu: PLAY · TUTORIAL · SETTINGS · CREDITS. Personal best displayed small and quietly.

Design two variants: a first-time visitor, where TUTORIAL is the visually primary action, and a returning player, where PLAY is primary.

Keep this screen sparse. The moon behind it is the selling image — do not bury it.

4. SETTINGS
Overlay reachable from Title and Paused, with the world dimmed and blurred behind. Four tabs:

CONTROLS — every binding listed and remappable. Show a live rebinding state ("press a key…") and clear conflict warnings inline. Show gamepad and touch schemes on their own devices.
DISPLAY — quality tier (Auto / High / Medium / Low), HUD scale slider (75–150%), high-contrast toggle, FPS counter toggle.
AUDIO — master, music, and SFX as independent sliders, each with a mute. The game must be fully playable muted.
ACCESSIBILITY — reduced motion · aim assist (0–100% slider, not an on/off toggle) · enemy damage · drain rate · enemy speed · infinite boost · an adaptive-difficulty toggle with a plain-language explanation of what it does.
That last item matters: the game quietly adjusts difficulty by up to 15% based on performance, and this is disclosed rather than hidden. Design the explanatory text to be honest and unembarrassed about it.

Accessibility settings are not presented as a "reduced" or "assisted" mode. They are ordinary options, presented with the same visual weight as everything else.

5. TUTORIAL
Three beats, each teaching exactly one verb, each with an in-world prompt rather than a text wall.

FLY — "Hold W to accelerate. Steer with the mouse."
SHOOT — "Left click to fire."
DEFEND — "Destroy the harvesters before they drain the outpost."
Prompts appear in the lower third, are large and legible, and fade once the action is performed. A subtle beat indicator (1/3, 2/3, 3/3) and a persistent but unobtrusive SKIP.

Design a "beat complete" confirmation — brief, satisfying, non-blocking.

6. BRIEFING
Four seconds before each wave, skippable. Shows the moon as a flattened map with threatened outposts marked and incoming enemy composition listed.

This screen exists so the player can form a plan. It is what turns the wave into a decision rather than a reaction. Make the threatened outposts and their separation immediately obvious.

7. PLAYING
The HUD from Part 4. No modal ever appears here.

8. PAUSED
World frozen, dimmed, blurred. Centred panel: RESUME · SETTINGS · RESTART WAVE · QUIT TO TITLE. Show current wave and score. Esc resumes.

Design this to feel like a genuine stop — calm, quiet, with the tension visibly suspended.

9. WAVECLEAR
Three-second celebration between waves. Score breakdown counts up in a staggered sequence: kills, accuracy multiplier, outposts saved, wave bonus, then the total.

Outposts saved is the largest and most prominent line, because it is the highest-value score source and the interface should reinforce what the game is actually about.

A deliberate moment of relief. The player has been at high alert; give them a breath.

10. DEBRIEF ← the most important non-gameplay screen
Shown after a wave in which something was lost, and at the end of a run.

Its job is to make failure understandable rather than frustrating. A player who does not know why they lost feels cheated. A player who knows exactly why feels they can do better — and plays again.

It must contain:

A one-sentence plain-language cause, displayed prominently:

"Lost Cassini at 2:41 — 3 harvesters landed while you were on the far side."

This single line is the heart of the screen. Design it as the primary element. Make it feel like a flight recorder readout: factual, unemotional, not accusatory.

A timeline strip of the wave showing when each outpost came under threat, when the player arrived where, and when losses occurred. The player should be able to see the moment the decision was made.

Accuracy, kills by enemy type, outposts saved versus lost.

The run seed, so the player can replay the identical scenario.

CONTINUE / RETRY.

Tone: never blame the player. State what happened. The player will draw their own conclusion, and that conclusion is the lesson.

11. RESULTS
End of run. Final score with full itemised breakdown. Personal best comparison with an explicit delta — "+1,240 over your best" or "340 short of your best."

Being 340 points short is powerful motivation to play again, and it is honest — it arises from the player's own record rather than from artificial scarcity.

Wave reached, outposts saved out of eight, run duration, seed. PLAY AGAIN as the primary action, returning to gameplay in under a second.

Design a distinct victory variant for clearing all 12 waves — genuinely celebratory, clearly different from an ordinary run ending.

12. CREDITS
Attribution, technology notes, a short paragraph on the procedural generation. Design it to be scannable. Judges read this.

PART 6 — TRANSITIONS
All screen transitions: 320ms, fade plus 8px vertical rise. Interruptible.
Entering Paused: world dims and blurs over 200ms; the panel arrives at 180ms with slight overshoot.
Entering Playing: HUD elements stagger in over 400ms — Threat Ring first, then gauges, then roster. This teaches the hierarchy on the very first play through order of appearance alone.
WaveClear breakdown: staggered timeline, 2.4s total, each line 200ms apart with numbers counting up.
Never a full-screen white flash or a hard cut. Motion should feel like instruments settling.
PART 7 — RESPONSIVE BEHAVIOUR
Four breakpoints. Mobile is not the desktop layout scaled down — it shows different things.

Desktop ≥1280	Laptop 1024–1279	Tablet 768–1023	Mobile <768
HUD	Full	Full, 90% scale	Simplified	Minimal
Outpost Roster	8 rows	8 rows	8 compact rows	1 line: count + most urgent
Threat Ring	Standard	Standard	Larger	Largest relative to screen
Altitude ladder	Full	Full	Compact	Compact bar
Score/combo	Separate	Separate	Combined	Single small line
Controls	None on screen	None	Touch overlay	Touch overlay
Touch controls
Design these explicitly — they are a real part of the interface, not an afterthought.

Left thumb: floating virtual stick that appears wherever the player first presses. Semi-transparent, showing a base ring and a movable inner handle.
Right thumb: vertical throttle slider, with horizontal drag on it trimming altitude.
Firing is automatic by default on touch. Precise aiming on a touchscreen is unfair, and this game is about decisions rather than twitch aim. Design a small manual-fire button for players who switch it on.
Boost button, pause button.
Controls fade to 35% opacity after 3 seconds without input and return instantly on touch.
All targets ≥44px, inside safe-area insets, never under a thumb resting position.
Orientation
Landscape strongly preferred. In portrait, show a rotate prompt — but include a "play anyway" option with a compressed HUD. Never hard-block, since some users have orientation locked for accessibility reasons.

PART 8 — ACCESSIBILITY REQUIREMENTS
Not a separate mode. Built into every component you design.

All HUD text meets WCAG AA (4.5:1) against the actual game behind it. Since the moon is bright and the sky is black, text contrast varies with what is behind it — use a subtle scrim behind any text that overlays the world. Critical alerts meet AAA (7:1).
Every state readable in greyscale. Design in colour, then verify in greyscale. If two states become identical, add a shape or motion difference.
Reduced-motion variant for every animated element, replacing motion with an equally informative static treatment.
Visible focus indicators on every interactive element — a 2px cyan outline with 2px offset. Every screen must be fully navigable by keyboard alone.
Minimum 16px body text. HUD scales 75–150% via a setting.
Touch targets ≥44px.
Never communicate anything by colour alone, by motion alone, or by sound alone.
PART 9 — ERROR, EMPTY, AND EDGE STATES
Design these. They are usually forgotten and always noticed.

State	Treatment
WebGL2 unsupported	Explain the actual problem, name specific browsers that work. Not a blank canvas.
WebGL context lost	"Rendering interrupted — recovering…" with automatic retry. Reassuring, not alarming.
Slow load (>5s)	Reassurance text: "Generating terrain — this happens once."
Performance auto-reduced	Non-blocking toast: "Graphics quality reduced to maintain smooth play." Dismissible, with a link to Settings.
No personal best yet	Title shows "NO RECORD YET — PLAY YOUR FIRST RUN," not an empty space or a zero.
All outposts lost	Run ends. This is the primary fail state and must feel significant, not like an error.
Corrupt saved settings	Silently reset to defaults with a small toast. Never block play.
Gamepad connected mid-game	Brief toast; HUD glyphs swap to gamepad symbols live.
Tab regains focus	Auto-pause on blur; resume requires an explicit action so the player is never dropped back into danger.
PART 10 — WHAT TO AVOID
Explicit anti-requirements. These are common defaults that would actively damage this product.

No red-versus-green for anything. Ever.
No opaque panels over the centre of the screen during gameplay.
No drop shadows. There is no atmosphere in this game; soft shadows contradict the entire art direction. Use luminosity and thin strokes.
No neon cyberpunk styling. This is precision instrumentation, not an arcade cabinet.
No decorative animation. Every movement means something.
No text below 14px.
No modal dialogs during gameplay.
No fake-technical decoration — no meaningless scrolling data, no random hex readouts, no fictional telemetry. Every number displayed is a real value the player can act on. Fake data trains players to ignore the interface.
No progress bars that do not reflect real progress.
No dark patterns. No fake urgency, no artificial scarcity, no manipulative streak mechanics.
PART 11 — DELIVERABLES
Design, in this order of priority:

The Threat Ring, in all its states. Do this first — it is the hardest and most novel component, and it determines much of the rest.
The complete gameplay HUD at desktop and mobile, with an active-combat example showing multiple threats and one outpost draining.
Debrief, because it is the most important non-gameplay screen.
Title, both variants.
All remaining screens from Part 5.
The component library: buttons, sliders, tabs, toggles, key-binding rows, toasts, gauges, markers.
Touch control overlay.
Reduced-motion and high-contrast variants of the HUD.
Use the exact colour tokens, type scale, and component names given above. Consistency across screens matters more than any individual screen being clever.

Remember throughout: this interface exists to help a player decide which outpost to save when they cannot save both. Judge every decision you make against that.