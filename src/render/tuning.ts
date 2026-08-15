/**
 * Render-side tuning, in one place.
 *
 * `game/data/constants.ts` opens with "a magic number anywhere under
 * `src/game/` is a bug", and the reasoning holds just as well one layer out:
 * these numbers decide how the game *reads*, and tuning them meant hunting
 * literals across four files and guessing which of two similar-looking values
 * was the one on screen.
 *
 * Only values that were actually tuned by eye live here. A number that follows
 * from geometry — the radius of a lock ring in its own SVG units, say — belongs
 * next to the geometry it describes, because moving it here would separate it
 * from the only thing that explains it.
 */

/* ------------------------------------------------------------------ */
/* Tracers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Calibre of a tracer, u.
 *
 * The visual round is much thinner than its collision radius, and that gap is
 * intentional: the streak is *light*, and a bolt as fat as its hitbox would
 * make near misses look like hits and turn the screen into a wall of glow at
 * nine rounds a second.
 */
export const TRACER_RADIUS = 0.085

/**
 * The frame rate the streak length is quoted against, Hz.
 *
 * Length is `speed / TRACER_REFERENCE_HZ`, *not* speed × the real frame delta.
 * Using the real delta is more photographically honest and looks wrong: the
 * streak grows and shrinks as the frame time wanders, which the eye reads as
 * the rounds changing size rather than as motion, and after any stall it draws
 * bars longer than the craft. A fixed reference keeps every round the same
 * length at the same speed, on every machine.
 *
 * Was 70 Hz, chosen from screenshots on the reasoning that it put a 170 u/s
 * round at 2.4 u — two-thirds of the craft's length. Flying it showed why that
 * reasoning was too generous to itself: 2.4 u is two-thirds of the craft only
 * *at the muzzle*, and a round is never seen there. By the time one is clear of
 * the hull it is tens of units downrange and projects to under ten pixels, so
 * a burst read as a few sparse specks rather than a stream. The spacing makes
 * it worse — `FIRE_INTERVAL` 0.11 s at 170 u/s puts 18.7 u between rounds, so
 * at 2.4 u the line was only 13% lit and the gaps carried the image.
 *
 * 45 Hz puts the same round at 3.8 u: a fifth of the gap rather than an
 * eighth, still comfortably under `TRACER_MAX_LENGTH`, and still nowhere near
 * a solid line — the gap is four times the dash. It also lifts the Interceptor
 * (76 u/s) to 1.7 u, off the floor it used to sit on, so enemy rounds again
 * differ in length by how fast they actually travel.
 */
export const TRACER_REFERENCE_HZ = 45

/** Floor, so a slow round is still a dash rather than a dot. */
export const TRACER_MIN_LENGTH = 1.5
/** Ceiling, so nothing ever draws a beam across the frame. */
export const TRACER_MAX_LENGTH = 4.0

/* ------------------------------------------------------------------ */
/* Escort drones                                                       */
/* ------------------------------------------------------------------ */

/**
 * How fast a drone's station-keeping glow breathes, rad/s, and how deep.
 *
 * Slow and shallow. A drone is a companion, not an alarm: it should be legible
 * as *alive* in peripheral vision without ever competing with a threat for
 * attention.
 *
 * The old 6 rad/s × 0.3 did not match that description. 6 rad/s is 0.95 Hz —
 * a pulse a second, nearer a warning light than a breath — and a depth of 0.3
 * drives the scale between 0.4 and 1.0, a two-and-a-half-fold swing. Four
 * drones each phase-offset by 1.7 rad turned the formation into a shimmer at
 * the edge of vision, which is the one thing the paragraph above rules out.
 *
 * 2.4 rad/s is 0.38 Hz, a ~2.6 s cycle that reads as breathing, and 0.16 keeps
 * the scale in 0.68–1.0, where the eye reads a change in brightness rather
 * than a change in size.
 */
export const DRONE_GLOW_RATE = 2.4
export const DRONE_GLOW_DEPTH = 0.16

/* ------------------------------------------------------------------ */
/* Missiles                                                            */
/* ------------------------------------------------------------------ */

/** Motor plume flicker rate, rad/s. Fast — this is combustion, not a pulse. */
export const MISSILE_FLAME_RATE = 47
/** How much of the plume's length the flicker modulates. */
export const MISSILE_FLAME_DEPTH = 0.28

/* ------------------------------------------------------------------ */
/* The attack-run tell (§7.3)                                          */
/* ------------------------------------------------------------------ */

/** How much an Interceptor swells while winding up, at full commit. */
export const WINDUP_SWELL = 0.22
/** Its warning flash rate, rad/s. Fast enough to catch the eye off-centre. */
export const WINDUP_FLASH_RATE = 26
/** Scale during the dive — stretched slightly, which reads as speed. */
export const DIVE_SWELL = 1.12
/** Scale while exposed. Smaller and dimmer: visibly the moment to shoot it. */
export const EXPOSED_SHRINK = 0.88
