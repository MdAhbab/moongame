/**
 * Roguelike Perk & Buff System (gameplan §10).
 *
 * Between waves, the player is presented with a 1-of-3 holographic draft
 * of tactical upgrades that stack across the run.
 */

export type PerkRarity = 'common' | 'rare' | 'epic' | 'legendary'

export type PerkCategory = 'offense' | 'defense' | 'mobility' | 'economy' | 'utility'

export interface Perk {
  readonly id: string
  readonly name: string
  readonly rarity: PerkRarity
  readonly category: PerkCategory
  readonly icon: string
  /**
   * What it does, in the terms the code actually implements.
   *
   * Six of these described effects that did not exist, and several others
   * overstated what they did. A description is a promise the simulation has to
   * keep: if it says 40%, `grep` should find a 0.4.
   */
  readonly description: string
  readonly quote: string
  /**
   * True when the perk may be drafted more than once, stacking each time.
   *
   * Only the escort drone is stackable. Everything else is a switch — taking
   * "hull repairs itself" twice would either do nothing or silently double a
   * rate, and both are worse than not offering it.
   */
  readonly stackable?: boolean
}

export const PERKS: readonly Perk[] = [
  {
    id: 'nanite_regen',
    name: 'Nanite Self-Repair',
    rarity: 'rare',
    category: 'defense',
    icon: '✚',
    description: 'Repairs 2% of maximum hull per second, and slowly rebuilds damaged engine, weapon and control systems.',
    quote: 'Molecular scaffolds weaving steel in hard vacuum.',
  },
  {
    id: 'magnetic_tether',
    name: 'Magnetic Tractor Layer',
    rarity: 'epic',
    category: 'utility',
    icon: '🧲',
    description: 'Drags every hostile within 45u toward you — including the ones drilling into an outpost.',
    quote: 'Rip the parasites straight off the regolith.',
  },
  {
    id: 'orbital_bombs',
    name: 'Orbital Saturation Bay',
    rarity: 'rare',
    category: 'offense',
    icon: '💣',
    description: 'Heavy bombs gain +60% blast radius and scatter four cluster sub-munitions across the crater on impact.',
    quote: 'Total surface cratering.',
  },
  {
    id: 'chain_lightning',
    name: 'Plasma Arc Capacitors',
    rarity: 'epic',
    category: 'offense',
    icon: '⚡',
    description: 'A kill arcs plasma to up to two hostiles within 30u, for 15 damage each.',
    quote: 'Conductive ionized air in the trace lunar atmosphere.',
  },
  {
    id: 'plasma_afterburner',
    name: 'Thermal Afterburner Nova',
    rarity: 'common',
    category: 'mobility',
    icon: '🔥',
    description: 'Boost recharges twice as fast, and the plume burns anything chasing within 16u while it runs.',
    quote: 'Burn them in your wake.',
  },
  {
    id: 'kinetic_railgun',
    name: 'Heavy Railgun Slugs',
    rarity: 'rare',
    category: 'offense',
    icon: '🎯',
    description: 'Cannon rounds punch through up to two further targets, and hit landed enemies for +50%.',
    quote: 'Dense tungsten at Mach 8.',
  },
  {
    id: 'thermal_siphon',
    name: 'Cryo-Thermal Siphon',
    rarity: 'common',
    category: 'offense',
    icon: '❄',
    description: 'Every kill vents 50 weapon heat and returns 10% of the boost charge.',
    quote: 'Recycle their destruction into cooling cycles.',
  },
  {
    id: 'singularity_bomb',
    name: 'Singularity Vortex Core',
    rarity: 'legendary',
    category: 'offense',
    icon: '🌀',
    description: 'A bomb blast drags everything it catches into the epicentre instead of throwing it clear.',
    quote: 'An inescapable gravitational collapse.',
  },
  {
    id: 'aegis_shield',
    name: 'Aegis Kinetic Barrier',
    rarity: 'rare',
    category: 'defense',
    icon: '🛡',
    description: 'A 35-point overshield soaks hits before the hull does, rebuilding at 4 per second.',
    quote: 'Solid-light deflector matrix online.',
  },
  {
    id: 'bounty_protocol',
    name: 'Corporate Bounty Protocol',
    rarity: 'common',
    category: 'economy',
    icon: '₡',
    description: 'Kill bounties and end-of-wave sector dividends both pay +50%.',
    quote: 'Security contract hazard bonus approved.',
  },
  {
    id: 'emp_flares',
    name: 'EMP Burst Countermeasures',
    rarity: 'epic',
    category: 'defense',
    icon: '◈',
    description: 'Flares also fire an EMP burst: every hostile gun goes silent for 3.5 seconds.',
    quote: 'Blind their targeting sensors completely.',
  },
  {
    id: 'high_orbit_spotter',
    name: 'Apex Orbital Optics',
    rarity: 'common',
    category: 'utility',
    icon: '🔭',
    description: 'Doubles lock range, and cannon rounds fired from above 38u altitude hit for +35%.',
    quote: 'Death from the high frontier.',
  },
  {
    id: 'swarm_missiles',
    name: 'Micro-Swarm Pods',
    rarity: 'epic',
    category: 'offense',
    icon: '🚀',
    description: 'Each missile launch is a volley of three, all guiding on the same lock.',
    quote: 'Saturate the airspace with guidance vectors.',
  },
  {
    id: 'ghost_ecm',
    name: 'Ghost ECM Cloak',
    rarity: 'rare',
    category: 'defense',
    icon: '👻',
    description: 'Hostile aim degrades badly against you, and with the engine cut they cannot shoot at you at all.',
    quote: 'A phantom on lunar radar scopes.',
  },
  {
    id: 'rapid_ordnance',
    name: 'Rapid Autoloader Bay',
    rarity: 'common',
    category: 'offense',
    icon: '⏱',
    description: 'Bomb bay reloads 35% faster, and you carry two more flares.',
    quote: 'Chamber another round before the dust settles.',
  },
  {
    id: 'solar_beam',
    name: 'Helios Solar Lance',
    rarity: 'legendary',
    category: 'offense',
    icon: '☀️',
    description: 'Flying above 42u charges a solar lance. Once charged, your next shot fires it: 9 damage down a narrow 260u beam, straight through Sentinel shields.',
    quote: 'Harness the unshielded glare of the sun.',
  },
  {
    id: 'seismic_shock',
    name: 'Seismic Regolith Rupture',
    rarity: 'rare',
    category: 'utility',
    icon: '💥',
    description: 'A bomb impact throws every enemy it catches clear of the crater floor.',
    quote: 'Shake the very bedrock of the Mare.',
  },
  {
    id: 'escort_drone',
    name: 'Escort Drone Bay',
    rarity: 'rare',
    category: 'offense',
    icon: '🛰',
    description:
      'Releases an autonomous drone that holds formation on your wing and engages anything within 110u. Stacks — take it again for another, up to four.',
    quote: 'You are no longer flying alone.',
    stackable: true,
  },
  {
    id: 'emergency_warp',
    name: 'Sub-Space Emergency Warp',
    rarity: 'legendary',
    category: 'defense',
    icon: '🌌',
    description: 'The blow that would destroy you instead jumps the craft clear at 25 hull. Once per run.',
    quote: 'Fold space when all else fails.',
  },
]

export const PERKS_BY_ID = new Map<string, Perk>(PERKS.map((p) => [p.id, p]))

import { Random } from '../core/Random.ts'
import { MAX_DRONES } from '../core/World.ts'

const defaultPerkRng = new Random(1337)

/**
 * Draws distinct randomized perks for the post-wave draft screen.
 */
export function drawRandomPerks(
  existingPerkIds: readonly string[] = [],
  rng: { range: (min: number, max: number) => number } = defaultPerkRng,
  count = 3,
): Perk[] {
  // A stackable perk stays in the pool as long as the run is under its cap, so
  // "another drone" keeps being offerable while "hull repairs itself, again"
  // does not.
  const droneStacks = existingPerkIds.filter((id) => id === 'escort_drone').length
  const available = PERKS.filter((p) => {
    if (p.id === 'escort_drone') return droneStacks < MAX_DRONES
    return !existingPerkIds.includes(p.id)
  })
  if (available.length <= count) return [...available]

  const pool = [...available]
  const drawn: Perk[] = []

  for (let i = 0; i < count && pool.length > 0; i++) {
    const index = Math.floor(rng.range(0, pool.length))
    const [chosen] = pool.splice(index, 1)
    if (chosen !== undefined) {
      drawn.push(chosen)
    }
  }

  return drawn
}
