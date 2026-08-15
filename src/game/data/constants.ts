/**
 * Every tuning value in the game, in one file (gameplan §30.1, Rule 8).
 *
 * Game feel is produced by these numbers, so they live together and nowhere
 * else. A magic number anywhere under `src/game/` is a bug.
 *
 * Values are for a *scaled fictional body*, not Luna at 1:1 (§22).
 */

/* ------------------------------------------------------------------ */
/* §18.2 — Fixed timestep                                              */
/* ------------------------------------------------------------------ */

/**
 * The identity of this physics build.
 *
 * A recorded run is only meaningful against the physics it was recorded under.
 * The server verifies a leaderboard score by *replaying* the submitted inputs
 * through this simulation and checking that the claimed score falls out — which
 * only works if both sides agree on what "this simulation" means.
 *
 * **Bump this whenever any value in this file, `waves.ts`, `enemies.ts` or
 * `parts.ts` changes, or whenever a system's behaviour changes.** Replays under
 * a superseded version are retired rather than migrated: there is no honest way
 * to re-interpret an input log against physics it never ran on.
 *
 *   1 — the original tuning (cruise 44.7 u/s)
 *   2 — retuned flight (cruise 26 u/s), drain and enemy speeds rescaled
 *   3 — lateral translation axis added
 *   4 — press-edge acts (weapon mode, engine cut, bomb, flare), sticky lock,
 *       bombs inherit full carrier velocity, area damage routed through the
 *       kill path
 */
export const SIM_VERSION = 4

/** 120 Hz: a clean multiple of 60, and stable for the spring stiffnesses below. */
export const FIXED_DT = 1 / 120

/** Ceiling on accumulated real time, so a backgrounded tab cannot queue thousands of substeps. */
export const MAX_ACCUM = 0.25

/** Derived: 30. The most substeps a single frame may ever run. */
export const MAX_SUBSTEPS = Math.round(MAX_ACCUM / FIXED_DT)

/* ------------------------------------------------------------------ */
/* §22.1 — Physics constants                                           */
/* ------------------------------------------------------------------ */

/** Moon radius. */
export const R = 100

/** Surface gravity, u/s². "Down" is radial (§22.2). */
export const G = 12

/** Craft mass, normalised. Forces are therefore applied directly as accelerations. */
export const CRAFT_MASS = 1.0

/**
 * Cruise thrust, u/s².
 *
 * ## Why the craft is slower than §22.1's original 90
 *
 * The first tuning put cruise at √(90/0.045) = 44.7 u/s on a moon of radius 100.
 * That is a full circumnavigation in 14 seconds, and it plays exactly as badly
 * as it sounds: the horizon arrives faster than the player can read it, every
 * outpost is an overshoot, and the sphere — the one idea the whole game is built
 * on — never has time to register as a place. "Too fast" was the single most
 * consistent thing anyone said about it.
 *
 * Speed is now 26 u/s, a 24-second lap, with the drag coefficient raised rather
 * than thrust alone lowered. That distinction is the difference between slower
 * and *worse*: v = √(F/k), so either would reach 26, but cutting thrust alone
 * would triple the time to reach it and leave the craft feeling waterlogged.
 * Raising `k` alongside keeps the acceleration constant τ ≈ v/F at 0.30 s —
 * shorter than the 0.50 s it was — so the craft is slower and *sharper*, and
 * turns now bleed speed the way flying should.
 *
 * Everything that races the craft moved with it, by the same factor, in the same
 * commit: `DRAIN_RATE_PER_HARVESTER` and every enemy speed in `enemies.ts`. The
 * balance harness checks travel time against drain deadlines rather than either
 * in isolation, which is why it still passes — the ratios are the design, the
 * absolute numbers are only their units.
 */
export const F_CRUISE = 88

/**
 * Boost thrust, u/s².
 *
 * Exactly 2.0× cruise, so v_boost/v_cruise = √2 — the ratio §22.3 derives and
 * `physics.test.ts` asserts. §7.4's prose says "2.4× thrust", which is
 * inconsistent with §22.1 and §22.3 both; the load-bearing constant wins.
 */
export const F_BOOST = 176

/** Quadratic drag coefficient (§22.3). See `F_CRUISE` for why it rose. */
export const K_DRAG = 0.13

/**
 * Lateral thrust, u/s² — the translation axis (§8.1).
 *
 * Flight had exactly one way to avoid something: turn. Turning costs heading,
 * heading is the thing you are spending to reach an outpost, so every dodge was
 * paid for in the currency the whole game is about. Translation is the second
 * verb — you can slide out of a lead without giving up where you were going.
 *
 * 0.45 × cruise thrust, so lateral terminal speed is √0.45 ≈ 0.67 × cruise:
 * quick enough to break a firing solution, never quick enough to make strafing a
 * way of *travelling*. If it reached cruise, the correct way to cross the moon
 * would be sideways, and the flight model would have a dominant strategy that
 * looks like a bug.
 *
 * **No separate damping is needed.** Drag is quadratic on the whole velocity
 * vector, so lateral speed bleeds off on its own the instant the key is
 * released, and the tangent frame is re-orthonormalised every step so a sideways
 * velocity stays in the tangent plane by construction.
 */
export const F_STRAFE = 0.45 * F_CRUISE

/** Altitude-hold proportional gain (§22.4). ω_n = √(k_p/m) = 5 rad/s. */
export const K_P_ALT = 25.0

/** Altitude-hold derivative gain. k_d = 2·m·ω_n = 10 → exactly critically damped. */
export const K_D_ALT = 10.0

/** Debris restitution (§20.3, §22.1). */
export const RESTITUTION = 0.35

/** Derived terminal velocities, v = √(F/k) (§22.3). Verified by test, not trusted. */
export const V_CRUISE = Math.sqrt(F_CRUISE / K_DRAG) // ≈ 26.02 u/s
export const V_BOOST = Math.sqrt(F_BOOST / K_DRAG) // ≈ 36.80 u/s

/**
 * Seconds to fly from any point to its antipode at cruise — the longest journey
 * the sphere can ask for, and the unit every deadline in the game is quoted in.
 *
 * Derived rather than written down, because it is the number that ties `R` and
 * `V_CRUISE` together: the Orbital Map's range rings, the endless-mode drain
 * ceiling and the balance harness all price themselves against it, and each of
 * them was silently wrong at some point for having hardcoded a figure that had
 * stopped being true.
 */
export const CROSSING_TIME = (Math.PI * R) / V_CRUISE // ≈ 12.1 s

/* ------------------------------------------------------------------ */
/* §7.1 — The playable shell                                           */
/* ------------------------------------------------------------------ */

export const ALT_MIN = 8
export const ALT_MAX = 70
export const ALT_CRUISE = 25

/** Below this altitude the craft strikes the surface (§22.6). */
export const ALT_CRASH = 4

/** Terrain-proximity warning threshold. */
export const ALT_WARN = ALT_MIN

/**
 * Player-commanded altitude change rate, u/s.
 *
 * Held at ~0.58× cruise, the same ratio it had at the old speed, so a full climb
 * from the deck to the ceiling still costs roughly the same fraction of a
 * crossing. Climb that is fast relative to forward flight turns the shell into a
 * lift shaft and makes the ground irrelevant.
 */
export const ALT_COMMAND_RATE = 18

/* ------------------------------------------------------------------ */
/* §22.5, §24 — Attitude and camera                                    */
/* ------------------------------------------------------------------ */

/** Attitude spring natural frequency, rad/s. Stiffer than altitude: steering must feel immediate (§8.5). */
export const ATTITUDE_OMEGA = 12

/** Yaw/pitch authority, rad/s at full deflection. */
export const TURN_RATE = 1.5

/** Bank coefficient: bank = clamp(−k·(ω·û), ±BANK_MAX) (§20.4). */
export const BANK_GAIN = 0.85
export const BANK_MAX = (60 * Math.PI) / 180

/* ---- Reading a translation as a translation --------------------------- */
/*
 * lateral velocity, exactly as `updateBank` derives bank from measured angular
 * velocity. Deriving from the key instead would look right until the first
 * explosion shoved the craft sideways and the animation stayed level.
 */

/** Roll into the slide, radians at full lateral speed. */
export const SLIP_ROLL = (22 * Math.PI) / 180

/** Crab against the slide, radians at full lateral speed. Small on purpose. */
export const SLIP_CRAB = (9 * Math.PI) / 180

/**
 * Nose pitch from measured climb rate, radians at full command rate.
 *
 * Without this a keyboard climb happens with the craft perfectly level, which
 * reads as an elevator rather than as flight. Pitch was previously driven only
 * by mouse Y, so players who climbed with a key got no visual confirmation at
 * all that the input had registered.
 */
export const PITCH_FROM_CLIMB = (16 * Math.PI) / 180

/**
 * Camera rig offset in craft-local space (§24.1).
 *
 * Pulled in from 22/7. The craft is 3.5 u wing to wing, so a 22 u standoff put
 * it six body-lengths away — a dot over a landscape. Closer reads as a craft you
 * are flying rather than a marker you are dragging, and at the new cruise speed
 * the horizon no longer needs the extra room to stay legible.
 */
export const CAM_BACK = 17
export const CAM_UP = 5.5

/** Camera position spring, rad/s (§24.2). */
export const CAM_OMEGA = 6

/** Look-ahead time: the aim point leads the craft by v·t (§24.2). */
export const CAM_LOOKAHEAD = 0.25

/** Camera roll follows craft bank at this fraction (§24.2). */
export const CAM_ROLL_FRACTION = 0.4

/**
 * How far the camera lags a lateral slide, as a fraction of the craft's offset.
 *
 * Without this, translation is invisible. The rig is anchored to the craft, so
 * craft and camera move together and *nothing on screen changes* during a
 * strafe — the player presses a key, the physics respond correctly, and the
 * frame looks identical. Letting the camera trail lets the craft slide within
 * the frame, which is the whole cue.
 */
export const CAM_LATERAL_LAG = 0.55

/** Rate the field of view settles toward its target, s⁻¹. ~250 ms. */
export const CAM_FOV_OMEGA = 4

/** Speed FOV, degrees (§24.2). */
export const FOV_REST = 62
export const FOV_BOOST = 74

/** Trauma decay rate, s⁻¹. shake = trauma², so light hits barely register (§24.3). */
export const TRAUMA_DECAY = 1.8
export const TRAUMA_MAX_OFFSET = 1.6

/* ------------------------------------------------------------------ */
/* §7.4 — Weapons                                                      */
/* ------------------------------------------------------------------ */

/**
 * Tracer speed and life, chosen together — their product is the gun's range.
 *
 * 170 × 1.25 s = 212 u, about two-thirds of a hemisphere. Kept deliberately fast
 * relative to the craft's 26 u/s so that leading a target stays a small
 * correction rather than a mortar problem: the moment bullets travel at flight
 * speed, aiming becomes prediction and the gun stops feeling like a gun.
 */
export const BULLET_SPEED = 170
export const BULLET_LIFE = 1.25
export const BULLET_DAMAGE = 1

/** Heat instead of ammo (§7.4). */
export const HEAT_PER_SHOT = 4
export const HEAT_DECAY_PER_S = 30
export const HEAT_DECAY_DELAY = 0.4
export const HEAT_LOCKOUT_S = 1.5
export const HEAT_MAX = 100

/** Minimum interval between shots, s. */
export const FIRE_INTERVAL = 0.11

/** §7.4 — Lock Missile & Rockets. */
export const LOCK_CONE_HALF_ANGLE = (26 * Math.PI) / 180
export const LOCK_TIME = 0.7
/**
 * How far off the nose a *held* lock may drift before it breaks.
 *
 * Wider than the acquisition cone on purpose. Acquiring is a deliberate act and
 * should cost aim; keeping what you already earned should not evaporate the
 * instant you bank to avoid a Sentinel. The gap between the two angles is the
 * manoeuvre room the mechanic exists to give.
 */
export const LOCK_BREAK_HALF_ANGLE = (52 * Math.PI) / 180
/** Beyond this, nothing can be locked or held. Matches the missile's reach. */
export const LOCK_RANGE = 450
/**
 * Seconds a lock survives after the lock control is released.
 *
 * Long enough to let go, settle the nose and shoot; short enough that a lock is
 * still a *commitment* rather than a permanent tag on whatever you last looked
 * at. Missile flight time is 6 s, so this cannot chain into a free kill.
 */
export const LOCK_MEMORY = 4.0
export const MISSILE_COOLDOWN = 2.0
export const MISSILE_SPEED = 95
export const MISSILE_LIFE = 6
export const MISSILE_TURN_ACCEL = 170
/** Proportional-navigation gain N (§20.6). */
export const PRONAV_N = 3.5
export const MISSILE_DAMAGE = 3

/** Countermeasures / Flares (§7.4). */
export const FLARE_COOLDOWN = 5.0
export const FLARE_DURATION = 2.2
export const FLARE_COUNT = 5

/* ------------------------------------------------------------------ */
/* §7.3 — The Interceptor's attack run                                 */
/* ------------------------------------------------------------------ */

/**
 * The tell, in seconds.
 *
 * Long enough to see, name and answer. Human reaction to an unexpected visual
 * cue is ~250 ms and *deciding* what to do about it costs more, so anything
 * under about a second would be a tell in name only — the player would learn
 * that the glow means they have already been hit.
 */
export const WINDUP_TIME = 1.15

/** How long the committed run lasts before it is spent. */
export const DIVE_TIME = 1.6

/** Speed multiplier during the run. Fast enough that it cannot be out-flown. */
export const DIVE_SPEED_SCALE = 2.3

/**
 * The reward window, in seconds.
 *
 * Two full seconds because the player has just spent their attention on *not
 * being hit* and needs time to reacquire, turn and shoot. A window shorter than
 * the manoeuvre that earns it is not a reward.
 */
export const EXPOSED_TIME = 2.0

/** Damage multiplier on an Interceptor caught in its overshoot. */
export const EXPOSED_DAMAGE_MULTIPLIER = 2.5

/** Seconds between one attack run and the next from the same Interceptor. */
export const RUN_COOLDOWN = 7.5

/** It will not start a run from further out than this. */
export const RUN_TRIGGER_RANGE = 140

/* ------------------------------------------------------------------ */
/* §7.6 — Subsystem damage                                             */
/* ------------------------------------------------------------------ */

/**
 * Integrity lost per point of hull damage taken.
 *
 * A 4-damage Interceptor round costs about 6% of one system, so shrugging off a
 * burst leaves a craft that flies noticeably worse without being crippled by a
 * single unlucky exchange. A resupply pass restores everything.
 */
export const SYSTEM_DAMAGE_PER_HULL = 0.016

/** Below this, a system is *faulted*: the HUD says so and the effects bite. */
export const SYSTEM_FAULT_THRESHOLD = 0.6

/** Yaw the stabiliser pulls at zero integrity, rad/s — the flight anomaly. */
export const CONTROL_DRIFT_RATE = 0.42

/* ------------------------------------------------------------------ */
/* §10 — Perk effects with tuning of their own                         */
/* ------------------------------------------------------------------ */

/** EMP Burst Countermeasures: seconds of hostile weapon shutdown. */
export const EMP_DURATION = 3.5

/** Helios Solar Lance: altitude above which the lance charges. */
export const LANCE_CHARGE_ALTITUDE = 42
/** Fraction of a full charge gained per second at the top of the band. */
export const LANCE_CHARGE_RATE = 0.11
/** Damage the discharge deals to everything in its cone. Deletes a Sentinel. */
export const LANCE_DAMAGE = 9
/** Reach of the beam, u. Longer than the cannon, shorter than the horizon. */
export const LANCE_RANGE = 260

/** Heavy Railgun Slugs: how many extra targets a slug punches through. */
export const RAILGUN_PIERCE = 2
/** Its bonus multiplier against a landed, grounded enemy. */
export const RAILGUN_GROUND_BONUS = 1.5

/** Apex Orbital Optics: lock range multiplier, and the high-dive crit bonus. */
export const SPOTTER_LOCK_SCALE = 2
export const SPOTTER_CRIT_ALTITUDE = 38
export const SPOTTER_CRIT_MULTIPLIER = 1.35

/* ------------------------------------------------------------------ */
/* §7.4 — Escort drones                                                */
/* ------------------------------------------------------------------ */

/** Formation radius around the craft, u. Inside the camera's frame at cruise. */
export const DRONE_ORBIT_RADIUS = 7.5
/** How fast the formation rotates, rad/s. Slow — this is a hover, not a spin. */
export const DRONE_ORBIT_RATE = 0.55
/** Spring rate with which a drone chases its formation slot, s⁻¹. */
export const DRONE_FOLLOW_OMEGA = 7
/** Engagement range, u. Well inside the player's own, so it never out-ranges you. */
export const DRONE_RANGE = 110
export const DRONE_FIRE_INTERVAL = 0.85
export const DRONE_BULLET_SPEED = 130
/**
 * Damage per drone round.
 *
 * One third of the player's, so four drones are roughly a second cannon rather
 * than a replacement for aiming. The perk is meant to cover your back while you
 * commit to something, not to play the game for you.
 */
export const DRONE_DAMAGE = 0.34

/** §7.4 — Boost. */
export const BOOST_DURATION = 3
export const BOOST_RECHARGE = 6

/** Heavy Bomber Bay (§7.4). */
export const BOMB_BASE_COOLDOWN = 20.0
export const BOMB_BLAST_RADIUS = 20.0
export const BOMB_DAMAGE = 65.0
/**
 * Ejection speed away from the belly, u/s.
 *
 * Only the *ejection*. A released bomb also keeps the whole of the craft's
 * velocity, which at cruise is 26 u/s of downrange momentum — so a bomb dropped
 * from cruise altitude lands roughly 35 u ahead of where it left the bay, not
 * underneath it. That is the physics, and pretending otherwise (the old 0.7
 * inheritance factor) made the bay unaimable: the payload landed somewhere
 * between what momentum said and what the picture said, and neither the player
 * nor a predictor could be right about it.
 */
export const BOMB_SPEED = 12.0
/**
 * Gravity multiplier for released ordnance.
 *
 * Bombs fall harder than the craft flies. A dead-weight payload on the same `G`
 * as a powered craft hangs in frame for four seconds, which reads as a balloon;
 * 1.5× puts a drop from cruise altitude at a little over a second, fast enough
 * to feel like mass and slow enough to watch.
 */
export const BOMB_GRAVITY_SCALE = 1.5
/** Radial clearance at which a bomb counts as having struck the surface. */
export const BOMB_SURFACE_CLEARANCE = 0.8
/** Seconds a bomb flies before self-destructing. */
export const BOMB_LIFE = 12

/** Orbital Saturation Bay (perk): sub-munitions thrown out by each impact. */
export const CLUSTER_COUNT = 4
/** How fast they scatter along the surface, u/s. */
export const CLUSTER_SPREAD_SPEED = 16
/** Their fuse, s. Short — they are meant to walk outward, not fly away. */
export const CLUSTER_FUSE = 1.1
/** Each one's share of the parent's damage. */
export const CLUSTER_DAMAGE_SHARE = 0.45

/** Combat Economy & Sector Revenue. */
export const CREDITS_PER_HARVESTER = 80
export const CREDITS_PER_INTERCEPTOR = 50
export const CREDITS_PER_SENTINEL = 120
export const CREDITS_PER_OUTPOST_PERCENT = 2.0

/** §8.4 — Aim assist is visible reticle magnetism, never bullet redirection. */
export const ASSIST_DEFAULT_DESKTOP = 0.35
export const ASSIST_DEFAULT_TOUCH = 0.7
export const ASSIST_MAX_ANGLE = (7 * Math.PI) / 180

/* ------------------------------------------------------------------ */
/* §7.2, §7.5, §7.6 — Outposts, resupply, hull                         */
/* ------------------------------------------------------------------ */

export const OUTPOST_COUNT = 8

/**
 * Integrity drained per landed Harvester, %/s (§7.3).
 *
 * Moved with `F_CRUISE`. The drain clock only means anything relative to how
 * long it takes to fly there, so slowing the craft without slowing the clock
 * would have turned every authored wave into a loss — the balance harness would
 * have caught it, but the point is that the two numbers are one decision.
 */
export const DRAIN_RATE_PER_HARVESTER = 0.8

export const OUTPOST_CRITICAL_INTEGRITY = 25

/** §7.5 — resupply & safe checkpoint healing aura. */
export const RESUPPLY_RADIUS = 30
export const RESUPPLY_HULL = 20
export const RESUPPLY_COOLDOWN = 15
export const REPAIR_RATE_PER_S = 12

/** §7.6 — hull. */
export const HULL_MAX = 100
export const RESPAWN_HULL = 50
export const RESPAWN_TIME = 4

/** §22.7 — impulse on hit. Felt as feedback, never enough to take control away. */
export const HIT_IMPULSE = 4

/* ------------------------------------------------------------------ */
/* §23.1 — Collision radii                                             */
/* ------------------------------------------------------------------ */

/**
 * Player collision radius.
 *
 * Deliberately smaller than the craft looks. The rendered hull reaches 2.5 u at
 * the nose and 1.75 u at the wingtips (a 14 u model at `CRAFT_MODEL_SCALE`), so
 * a 3.0 sphere put the hitbox 20% past the nose and 71% past the wings — the
 * player took hits from visibly empty space, which reads as the game cheating.
 *
 * 1.9 sits just inside the wingspan. A player craft should be *forgiving*: a
 * near-miss that looks like a near-miss should be a miss. Enemy radii in §23.1
 * are unchanged, so this only affects what can hit you, never what you can hit.
 */
export const RADIUS_CRAFT = 1.9

/**
 * Uniform scale applied to the craft model.
 *
 * Lives here rather than in the render layer because it is what ties the
 * rendered size to `RADIUS_CRAFT` above — change one and the other has to move.
 * A 14 u wingspan at 0.25 gives 3.5 u tip to tip.
 */
export const CRAFT_MODEL_SCALE = 0.25

/**
 * Distance from the craft's centre to the furthest point of its rendered hull.
 *
 * The render layer scales whatever model it loaded until its nose sits here, so
 * this number — not the model file — decides how big the craft looks. That
 * makes the three constants in this block a single statement: the hull reaches
 * 2.5 u, the hitbox is 1.9 u (76% of it, forgiving as described above), and the
 * muzzle at 2.6 u sits just past the tip.
 */
export const CRAFT_MODEL_REACH = 2.5

/**
 * Distance from the craft's centre to the muzzle.
 *
 * Was `RADIUS_CRAFT`, which conflated two unrelated jobs: how big the craft is
 * for collision, and where its gun sits. Shrinking the collision radius would
 * otherwise have spawned tracers inside the hull, so the nose length is now
 * stated on its own terms — just past the visible tip at 2.5 u.
 */
export const CRAFT_MUZZLE_OFFSET = 2.6
export const RADIUS_HARVESTER = 3.2
export const RADIUS_INTERCEPTOR = 1.8
export const RADIUS_SENTINEL = 4.0

/**
 * How far a hostile's rendered hull may reach past its collision sphere.
 *
 * Every enemy model is scaled so its furthest vertex sits at `radius ×
 * ENEMY_MODEL_SLACK`, which is the only thing keeping what you shoot at and
 * what the simulation tests the same object. Without it the two were set
 * independently — a hand-tuned `scale(6, 6, 6)` in the render layer against
 * these radii — and the hulls ended up between 8 and 18 times oversized. Shots
 * that visibly struck a hostile passed through it, which reads as the game
 * being broken, and is.
 *
 * 1.35 rather than 1.0 because a hitbox slightly inside the silhouette is
 * *forgiving*: the worst case is a shot clipping the outermost 35% of a wingtip
 * and missing, which looks like a graze. Going the other way — a hitbox larger
 * than the model — would mean being hit by nothing, which is the version
 * players notice and resent (see `RADIUS_CRAFT`, where the same argument runs
 * in the player's favour).
 */
export const ENEMY_MODEL_SLACK = 1.35
export const RADIUS_PROJECTILE = 0.3
export const RADIUS_OUTPOST_TRIGGER = 15.0

/* ------------------------------------------------------------------ */
/* §23.3 — Broadphase bucket grid                                      */
/* ------------------------------------------------------------------ */

export const BUCKET_LON = 24
export const BUCKET_LAT = 12
export const BUCKET_RADIAL = 3
export const BUCKET_COUNT = BUCKET_LON * BUCKET_LAT * BUCKET_RADIAL

/** Outer edge of the playable shell, used to band entities radially. */
export const SHELL_OUTER = R + ALT_MAX

/* ------------------------------------------------------------------ */
/* §31.2 — Pool capacities. Caps are gameplay decisions as much as      */
/* performance ones: bounded population keeps difficulty authored.      */
/* ------------------------------------------------------------------ */

export const MAX_ENEMIES = 48
export const MAX_PLAYER_PROJECTILES = 256
export const MAX_ENEMY_PROJECTILES = 128
export const MAX_MISSILES = 8
export const MAX_PARTICLES = 1024

/* ------------------------------------------------------------------ */
/* §7.7 — Scoring                                                      */
/* ------------------------------------------------------------------ */

export const SCORE_HARVESTER_AIRBORNE = 150
export const SCORE_HARVESTER_LANDED = 80
export const SCORE_INTERCEPTOR = 100
export const SCORE_SENTINEL = 250
export const SCORE_OUTPOST_SURVIVED = 400
export const SCORE_WAVE_ALL_INTACT = 800
export const SCORE_NO_DAMAGE_WAVE = 300

/** Combo is capped: skill expression, not exponential inflation (§7.7). */
export const COMBO_MAX = 5
export const COMBO_WINDOW = 2.5

export const ACCURACY_BONUS_MIN = 1.0
export const ACCURACY_BONUS_MAX = 2.5

/* ------------------------------------------------------------------ */
/* §10 — Difficulty                                                    */
/* ------------------------------------------------------------------ */

export const WAVE_COUNT = 12

/** §10.3 — DDA is bounded and disclosed. Never touches damage or health. */
export const DDA_MAX_ADJUST = 0.15

/** §11 — Briefing runs 4 s, WaveClear 3 s. */
export const BRIEFING_DURATION = 4
export const WAVE_CLEAR_DURATION = 3

/* ------------------------------------------------------------------ */
/* §26.3 — Particle effects                                            */
/* ------------------------------------------------------------------ */

export const PARTICLES_MUZZLE = 4
export const PARTICLES_IMPACT = 12
export const PARTICLES_KILL = 28
export const PARTICLES_OUTPOST_LOST = 60
export const PARTICLE_DRAG = 0.4

/* ------------------------------------------------------------------ */
/* §12.2 P1 — Threat Ring                                              */
/* ------------------------------------------------------------------ */

/**
 * Beyond this range a marker sits at the extreme of the ring.
 *
 * The maximum great-circle separation on the surface is πR ≈ 314 u, so 340
 * keeps the far side inside the mapped band instead of clamping every distant
 * marker onto one indistinguishable pile.
 */
export const THREAT_RING_MAX_RANGE = 340
