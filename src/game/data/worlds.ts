/**
 * Worlds — three bodies to fly the campaign over (gameplan §7.1).
 *
 * ## Why a world changes the environment and not the geometry
 *
 * The obvious way to build a second world is to change `R`. It is also the
 * wrong way here. `R` is read by twenty-four files, and every number the game
 * *states* is derived from it: the Briefing's seconds-to-outpost, the Debrief's
 * "you were six seconds away", the Orbital Map's range rings, and the whole
 * balance harness, which asserts that every triage wave keeps two viable routes
 * at every extreme of the loadout space. Changing the radius per world would
 * silently invalidate all of it, and the failure would show up as waves that
 * are quietly unwinnable rather than as a broken test.
 *
 * So a world varies the *environment* — gravity, atmospheric drag, terrain —
 * through a flat multiplier set, exactly as `difficulty` and `loadout` already
 * do. `World.environment` is written from outside the simulation and read
 * inline at the point of use. The bands are deliberately narrow for the same
 * reason the loadout speed band is: a world that changes how far you can fly in
 * ten seconds has changed the game's subject, not its setting.
 *
 * What actually differs, and what the player will feel:
 *
 *  - **Gravity** shifts how hard the altitude controller works, so a low-gravity
 *    body feels floatier on the climb and a heavy one settles faster.
 *  - **Drag** shifts terminal velocity by √(1/k). Held inside ±6%, which is
 *    tighter than the ±8% the loadout may already have spent.
 *  - **Terrain** is regenerated with different roughness, crater density and
 *    palette, which is most of what makes a world look like somewhere else.
 */

/** Multipliers applied to the flight model. All 1 is the Moon. */
export interface EnvironmentModifiers {
  /** Scales `G`. Higher is heavier. */
  gravity: number
  /** Scales `K_DRAG`. Higher slows the craft; terminal velocity goes as √(1/k). */
  drag: number
}

export interface WorldTerrain {
  /** Vertical exaggeration of the height field. */
  amplitude: number
  /** Base noise frequency — higher is busier ground. */
  frequency: number
  /** Impact craters per steradian, roughly. */
  craterDensity: number
  /** Ridged-noise weight, which reads as mountain chains rather than dunes. */
  ridged: number
}

export interface WorldPalette {
  /** Sunlit regolith. */
  regolith: number
  /** Shadowed regolith and crater floors. */
  shadow: number
  /** Light bounced onto the night side, from the primary. */
  earthshine: number
  /** The rim light opposite the sun. */
  rim: number
  /** Colour of the sun's key light. */
  sun: number
  /** The body hanging in the sky, and its size in degrees. */
  primary: number
  primarySize: number
}

export interface WorldDefinition {
  readonly id: string
  readonly name: string
  /** Where this is, in-world. Shown on the world select. */
  readonly subtitle: string
  readonly description: string
  /** Pilot level at which the world becomes flyable. */
  readonly unlockLevel: number
  readonly environment: EnvironmentModifiers
  readonly terrain: WorldTerrain
  readonly palette: WorldPalette
  /** Star density multiplier — a hazy sky shows fewer. */
  readonly starDensity: number
}

export const WORLDS: readonly WorldDefinition[] = [
  {
    id: 'mare-noctis',
    name: 'Mare Noctis',
    subtitle: 'Luna · Sea of Night',
    description:
      'The body the campaign was written for. Eight outposts on grey regolith, Earth on the horizon, and nothing in the sky to hide behind.',
    unlockLevel: 1,
    // The reference world. Every constant in `constants.ts` is this world at 1.0,
    // and the balance harness is calibrated against exactly these numbers.
    environment: { gravity: 1, drag: 1 },
    terrain: { amplitude: 1, frequency: 1, craterDensity: 1, ridged: 0.35 },
    palette: {
      regolith: 0xb8b4ad,
      shadow: 0x0a0c10,
      earthshine: 0x2a3f5f,
      rim: 0x9dc4ff,
      sun: 0xfff5e6,
      primary: 0x3b6ea8,
      primarySize: 1,
    },
    starDensity: 1,
  },
  {
    id: 'thule',
    name: 'Thule',
    subtitle: 'Outer system · ice moon',
    description:
      'Water ice over a rock core, cracked into ridges by a parent world it never turns away from. Low gravity: the craft floats on the climb and takes its time coming down.',
    unlockLevel: 6,
    // Ice moon: about a fifth less gravity, and a trace exosphere that adds a
    // little drag. Net cruise change is −3%, comfortably inside the band the
    // Briefing's deadlines assume.
    environment: { gravity: 0.82, drag: 1.06 },
    terrain: { amplitude: 1.35, frequency: 1.5, craterDensity: 0.45, ridged: 0.8 },
    palette: {
      regolith: 0xd8e6f0,
      shadow: 0x0b1622,
      earthshine: 0x2f5f7a,
      rim: 0xa8e0ff,
      sun: 0xeaf4ff,
      primary: 0xc9a06a,
      primarySize: 2.6,
    },
    starDensity: 1.25,
  },
  {
    id: 'ashfall',
    name: 'Ashfall',
    subtitle: 'Inner system · volcanic moon',
    description:
      'Tidally cooked and still venting. Heavier than Luna, and the ash haze drags at everything that moves through it. Flying here costs more than flying anywhere else.',
    unlockLevel: 14,
    // Volcanic moon: heavier, and a genuine haze. Drag 1.12 puts terminal
    // velocity at 1/√1.12 = 94.5% of cruise — the largest environmental
    // handicap in the game and still inside the ±6% band.
    environment: { gravity: 1.16, drag: 1.12 },
    terrain: { amplitude: 1.6, frequency: 1.25, craterDensity: 0.7, ridged: 0.95 },
    palette: {
      regolith: 0x8a5a3c,
      shadow: 0x140805,
      earthshine: 0x5a2412,
      rim: 0xff9a52,
      sun: 0xffe4c4,
      primary: 0xd85a28,
      primarySize: 3.4,
    },
    starDensity: 0.55,
  },
]

const WORLD_INDEX = new Map(WORLDS.map((world) => [world.id, world]))

export function worldById(id: string): WorldDefinition | undefined {
  return WORLD_INDEX.get(id)
}

/** The reference world, and the fallback for an unknown or locked id. */
export function defaultWorld(): WorldDefinition {
  const first = WORLDS[0]
  if (first === undefined) throw new Error('worlds: WORLDS is empty')
  return first
}

export function isWorldUnlocked(world: WorldDefinition, pilotLevel: number): boolean {
  return pilotLevel >= world.unlockLevel
}

/** Neutral modifiers — the reference world, and what an unset `World` uses. */
export function createEnvironmentModifiers(): EnvironmentModifiers {
  return { gravity: 1, drag: 1 }
}

/**
 * Terminal velocity relative to the reference world.
 *
 * `v = √(F/k)`, so an environment that scales drag by `k` scales cruise by
 * `1/√k`. Surfaced so the world select can state the cost rather than leaving
 * the player to discover it mid-wave.
 */
export function cruiseFactor(environment: EnvironmentModifiers): number {
  return 1 / Math.sqrt(environment.drag)
}
