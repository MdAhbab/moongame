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
  /**
   * The verb, in the player's hands.
   *
   * `description` says what the perk *is*; this says what to do about it, and
   * they are genuinely different questions. "Flying above 42 u charges a solar
   * lance" is an accurate sentence that leaves a player holding a legendary
   * they never fire, because nothing on the card tells them the trigger is the
   * ordinary fire key in cannon mode. Half these perks arm a control the player
   * already has and change what it does; a card that omits that is a card that
   * sells an ability and withholds the instructions.
   *
   * Passive perks say so plainly rather than inventing an action, because
   * "nothing to press" is itself the thing worth knowing.
   */
  readonly howToUse: string
  readonly quote: string
}

export const PERKS: readonly Perk[] = [
  {
    id: 'nanite_regen',
    name: 'Nanite Self-Repair',
    rarity: 'rare',
    category: 'defense',
    icon: '✚',
    description: 'Repairs 2% of maximum hull per second, and slowly rebuilds damaged engine, weapon and control systems.',
    howToUse:
      'Passive. Nothing to press — just disengage. It out-heals a Harvester beam, so break contact and let it work.',
    quote: 'Molecular scaffolds weaving steel in hard vacuum.',
  },
  {
    id: 'magnetic_tether',
    name: 'Magnetic Tractor Layer',
    rarity: 'epic',
    category: 'utility',
    icon: '🧲',
    description: 'Drags every hostile within 45u toward you — including the ones drilling into an outpost.',
    howToUse:
      'Passive, and it aims itself. Fly *over* a besieged outpost to rip the drills off it, then turn and shoot what you dragged out.',
    quote: 'Rip the parasites straight off the regolith.',
  },
  {
    id: 'orbital_bombs',
    name: 'Orbital Saturation Bay',
    rarity: 'rare',
    category: 'offense',
    icon: '💣',
    description: 'Heavy bombs gain +60% blast radius and scatter four cluster sub-munitions across the crater on impact.',
    howToUse:
      'Use your bomb key. The ground ring grows to the new radius, so aim by the ring — the clusters fill it.',
    quote: 'Total surface cratering.',
  },
  {
    id: 'chain_lightning',
    name: 'Plasma Arc Capacitors',
    rarity: 'epic',
    category: 'offense',
    icon: '⚡',
    description: 'A kill arcs plasma to up to two hostiles within 30u, for 15 damage each.',
    howToUse:
      'Passive, but it rewards grouping. Shoot into a cluster rather than picking off strays, and one kill finishes two more.',
    quote: 'Conductive ionized air in the trace lunar atmosphere.',
  },
  {
    id: 'plasma_afterburner',
    name: 'Thermal Afterburner Nova',
    rarity: 'common',
    category: 'mobility',
    icon: '🔥',
    description: 'Boost recharges twice as fast, and the plume burns anything chasing within 16u while it runs.',
    howToUse:
      'Boost *through* whatever is chasing you. The plume burns anything within 16u behind, so being tailed is now the good case.',
    quote: 'Burn them in your wake.',
  },
  {
    id: 'kinetic_railgun',
    name: 'Heavy Railgun Slugs',
    rarity: 'rare',
    category: 'offense',
    icon: '🎯',
    description: 'Cannon rounds punch through up to two further targets, and hit landed enemies for +50%.',
    howToUse:
      'Just fire. Line up so two hostiles overlap and one round takes both; landed drillers take an extra 50%.',
    quote: 'Dense tungsten at Mach 8.',
  },
  {
    id: 'thermal_siphon',
    name: 'Cryo-Thermal Siphon',
    rarity: 'common',
    category: 'offense',
    icon: '❄',
    description: 'Every kill vents 50 weapon heat and returns 10% of the boost charge.',
    howToUse:
      'Passive. It changes how you hold the trigger: a kill dumps 50 heat, so a full burst into a nearly-dead target costs you nothing.',
    quote: 'Recycle their destruction into cooling cycles.',
  },
  {
    id: 'singularity_bomb',
    name: 'Singularity Vortex Core',
    rarity: 'legendary',
    category: 'offense',
    icon: '🌀',
    description: 'A bomb blast drags everything it catches into the epicentre instead of throwing it clear.',
    howToUse:
      'Use your bomb key. Aim short of a scattered group — the blast pulls them together instead of apart, so it gathers rather than clears.',
    quote: 'An inescapable gravitational collapse.',
  },
  {
    id: 'aegis_shield',
    name: 'Aegis Kinetic Barrier',
    rarity: 'rare',
    category: 'defense',
    icon: '🛡',
    description: 'A 35-point overshield soaks hits before the hull does, rebuilding at 4 per second.',
    howToUse:
      'Passive. Watch the shield bar, not the hull. It refills in about nine seconds, so trade a hit, break off, come back.',
    quote: 'Solid-light deflector matrix online.',
  },
  {
    id: 'bounty_protocol',
    name: 'Corporate Bounty Protocol',
    rarity: 'common',
    category: 'economy',
    icon: '₡',
    description: 'Kill bounties and end-of-wave sector dividends both pay +50%.',
    howToUse:
      'Passive. Nothing to press. Saving outposts pays the dividend, so it is worth more the more you defend.',
    quote: 'Security contract hazard bonus approved.',
  },
  {
    id: 'emp_flares',
    name: 'EMP Burst Countermeasures',
    rarity: 'epic',
    category: 'defense',
    icon: '◈',
    description: 'Flares also fire an EMP burst: every hostile gun goes silent for 3.5 seconds.',
    howToUse:
      'Use your flare key. As well as burning incoming rounds it silences every hostile gun for 3.5s — a window to reposition, not just to survive.',
    quote: 'Blind their targeting sensors completely.',
  },
  {
    id: 'high_orbit_spotter',
    name: 'Apex Orbital Optics',
    rarity: 'common',
    category: 'utility',
    icon: '🔭',
    description: 'Doubles lock range, and cannon rounds fired from above 38u altitude hit for +35%.',
    howToUse:
      'Climb. Above 38u your cannon hits 35% harder, and lock range doubles at any altitude — so fight high and lock early.',
    quote: 'Death from the high frontier.',
  },
  {
    id: 'swarm_missiles',
    name: 'Micro-Swarm Pods',
    rarity: 'epic',
    category: 'offense',
    icon: '🚀',
    description: 'Each missile launch is a volley of three, all guiding on the same lock.',
    howToUse:
      'Lock and fire missiles as normal. One launch is three, all tracking the same lock, so it is your answer to a Sentinel.',
    quote: 'Saturate the airspace with guidance vectors.',
  },
  {
    id: 'ghost_ecm',
    name: 'Ghost ECM Cloak',
    rarity: 'rare',
    category: 'defense',
    icon: '👻',
    description: 'Hostile aim degrades badly against you, and with the engine cut they cannot shoot at you at all.',
    howToUse:
      'Cut the engine to become untargetable — they cannot fire at you at all while you float. Use it to cross open ground.',
    quote: 'A phantom on lunar radar scopes.',
  },
  {
    id: 'rapid_ordnance',
    name: 'Rapid Autoloader Bay',
    rarity: 'common',
    category: 'offense',
    icon: '⏱',
    description: 'Bomb bay reloads 35% faster, and you carry two more flares.',
    howToUse:
      'Passive on both counts: the bomb bay simply comes back sooner, and you start with seven flares instead of five.',
    quote: 'Chamber another round before the dust settles.',
  },
  {
    id: 'solar_beam',
    name: 'Helios Solar Lance',
    rarity: 'legendary',
    category: 'offense',
    icon: '☀️',
    description: 'Flying above 42u charges a solar lance. Once charged, your next shot fires it: 9 damage down a narrow 260u beam, straight through Sentinel shields.',
    howToUse:
      'Climb above 42u to charge it — watch the ☀ readout. Once it reads READY, your next **cannon shot** fires the beam instead. Straight through Sentinel shields.',
    quote: 'Harness the unshielded glare of the sun.',
  },
  {
    id: 'seismic_shock',
    name: 'Seismic Regolith Rupture',
    rarity: 'rare',
    category: 'utility',
    icon: '💥',
    description: 'A bomb impact throws every enemy it catches clear of the crater floor.',
    howToUse:
      'Use your bomb key. It lifts landed enemies off the surface, which interrupts every drain beam in the blast at once.',
    quote: 'Shake the very bedrock of the Mare.',
  },
  {
    id: 'emergency_warp',
    name: 'Sub-Space Emergency Warp',
    rarity: 'legendary',
    category: 'defense',
    icon: '🌌',
    description: 'The blow that would destroy you instead jumps the craft clear at 25 hull. Once per run.',
    howToUse:
      'Passive, and once only. It spends itself on the hit that would have killed you and drops you clear at 25 hull — so it buys one mistake, not a playstyle.',
    quote: 'Fold space when all else fails.',
  },
]

export const PERKS_BY_ID = new Map<string, Perk>(PERKS.map((p) => [p.id, p]))

import { Random } from '../core/Random.ts'

const defaultPerkRng = new Random(1337)

/**
 * Draws distinct randomized perks for the post-wave draft screen.
 */
export function drawRandomPerks(
  existingPerkIds: readonly string[] = [],
  rng: { range: (min: number, max: number) => number } = defaultPerkRng,
  count = 3,
): Perk[] {
  // Nothing stacks any more. The one perk that did was the drone bay, and it
  // is an ability on a key now — see `entities/Drone.ts` for why.
  const available = PERKS.filter((p) => !existingPerkIds.includes(p.id))
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
