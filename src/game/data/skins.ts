/**
 * Craft skins — cosmetic livery, zero gameplay effect.
 *
 * No skin here may appear in `PartModifiers` or touch `LoadoutModifiers`; if a
 * skin ever changes a number, it has stopped being a skin and become a part
 * (`parts.ts` owns that decision, and it is not this file's to make). Keeping
 * cosmetics and capability in separate files is what lets the Hangar show a
 * skin preview without running it through the loadout resolver at all.
 *
 * Colours are plain hex numbers (`0x7fe8ff`, not `'#7fe8ff'`) because the
 * render layer builds them straight into `THREE.Color` — this file cannot
 * import `three` itself (Rule 2), so the numeric literal is the one format
 * that costs the consumer nothing to use. Values are drawn from the palette
 * in `src/styles/tokens.css` (§15.2) so a painted hull reads as part of the
 * same instrument-lit world as the HUD, not a sticker on top of it.
 */

/**
 * Either unlocked by pilot level (checked against `progression.ts`) or by a
 * one-off achievement condition, never both. A union rather than a nullable
 * `unlockLevel` field for the same reason `WeaponState` and `LockState` in
 * `core/World.ts` are unions: a skin cannot be honestly "level 12 or maybe an
 * achievement," so the type should not be able to express both at once.
 */
export type SkinUnlock =
  | { readonly kind: 'level'; readonly level: number }
  | { readonly kind: 'achievement'; readonly id: AchievementId; readonly condition: string }

/**
 * The achievement keys, declared here rather than in the persistence layer.
 *
 * The direction matters: `state/persistence.ts` already imports this module to
 * validate a stored skin id, and the game layer may not import the state layer
 * at all (§32.1). Putting the union here means the stored profile's shape is
 * derived from the skin table, so adding an achievement skin cannot leave a
 * flag undeclared — the compiler makes it impossible.
 */
export type AchievementId = 'cleanSweep' | 'deadEye' | 'trophyIron'

export interface Skin {
  readonly id: string
  readonly name: string
  readonly unlock: SkinUnlock
  /** One line of in-world flavour, shown under the name in the Hangar. */
  readonly description: string
  /** Base hull colour, hex. */
  readonly hull: number
  /** Secondary/trim colour, hex. */
  readonly trim: number
  /** Engine and weapon glow colour, hex. */
  readonly emissive: number
}

/**
 * Twelve liveries. Index 0 is the unpainted default every profile starts
 * with; the rest split roughly 3:1 between level milestones (predictable, so
 * a pilot can see the next one coming) and performance achievements
 * (unpredictable, so the Hangar has a reason to be revisited after level 30
 * stops moving).
 */
export const SKINS: readonly Skin[] = [
  {
    id: 'skin-factory',
    name: 'Factory Grey',
    unlock: { kind: 'level', level: 1 },
    description: 'Unpainted composite straight off the line. Every pilot starts here.',
    hull: 0xb8b4ad,
    trim: 0x4a5058,
    emissive: 0x7fe8ff,
  },
  {
    id: 'skin-void',
    name: 'Void Black',
    unlock: { kind: 'level', level: 5 },
    description: 'Matte enough to swallow the running lights of anything behind you.',
    hull: 0x05060a,
    trim: 0xb8b4ad,
    emissive: 0x7fe8ff,
  },
  {
    id: 'skin-hazard',
    name: 'Hazard Band',
    unlock: { kind: 'level', level: 8 },
    description: 'Outpost maintenance colours, repurposed. Technicians will see you coming before Command does.',
    hull: 0x4a5058,
    trim: 0xffc857,
    emissive: 0xffc857,
  },
  {
    id: 'skin-deepcycle',
    name: 'Deep Cycle',
    unlock: { kind: 'level', level: 12 },
    description: 'Named for the boost cell it shipped alongside, not the finish. The finish just stuck.',
    hull: 0x2a3f5f,
    trim: 0xb8b4ad,
    emissive: 0x7fe8ff,
  },
  {
    id: 'skin-whiteout',
    name: 'Whiteout',
    unlock: { kind: 'level', level: 16 },
    description: 'Full-albedo coating meant for the far side. Out here it just makes you easy to find.',
    hull: 0xffffff,
    trim: 0x4a5058,
    emissive: 0x7fe8ff,
  },
  {
    id: 'skin-longwatch',
    name: 'Long Watch',
    unlock: { kind: 'level', level: 20 },
    description: 'Issued to rotations that pull the graveyard shift over the pole. Nobody requests it twice voluntarily.',
    hull: 0x05060a,
    trim: 0x2a3f5f,
    emissive: 0x7fe8ff,
  },
  {
    id: 'skin-firstlight',
    name: 'First Light',
    unlock: { kind: 'level', level: 24 },
    description: "The livery Command signs off on the day you're rated to fly a rotation with nobody watching.",
    hull: 0xb8b4ad,
    trim: 0x7fe8ff,
    emissive: 0xffffff,
  },
  {
    id: 'skin-standingorder',
    name: 'Standing Order',
    unlock: { kind: 'level', level: 28 },
    description: "Command-tier trim, worn by pilots who've stopped needing the Briefing screen.",
    hull: 0x2a3f5f,
    trim: 0xffc857,
    emissive: 0x7fe8ff,
  },
  {
    id: 'skin-fullmuster',
    name: 'Full Muster',
    unlock: { kind: 'level', level: 30 },
    description: 'The finish reserved for a pilot who has run out of ranks to earn. Loud on purpose.',
    hull: 0xffffff,
    trim: 0x7fe8ff,
    emissive: 0x7fe8ff,
  },
  {
    id: 'skin-cleansweep',
    name: 'Clean Sweep',
    unlock: { kind: 'achievement', id: 'cleanSweep', condition: 'Finish a run with all 8 outposts still standing.' },
    description: "Command doesn't have a form for this result. This livery is the closest thing to one.",
    hull: 0x05060a,
    trim: 0x7fe8ff,
    emissive: 0xffffff,
  },
  {
    id: 'skin-deadeye',
    name: 'Dead-Eye',
    unlock: { kind: 'achievement', id: 'deadEye', condition: 'Finish a run at 80% accuracy or better.' },
    description: "Every round on this hull's service record went somewhere it was aimed.",
    hull: 0x4a5058,
    trim: 0xffc857,
    emissive: 0x7fe8ff,
  },
  {
    id: 'skin-trophyiron',
    name: 'Trophy Iron',
    unlock: { kind: 'achievement', id: 'trophyIron', condition: 'Clear wave 12 — Sea of Night.' },
    description: 'Panelling salvaged from whatever was still moving after the last wave. Nocturne Arsenal calls it bad taste. It flies fine.',
    hull: 0x2a3f5f,
    trim: 0xff8a3d,
    emissive: 0xffc857,
  },
]

/** Lookup by id, built once. */
const SKIN_INDEX = new Map<string, Skin>(SKINS.map((skin) => [skin.id, skin]))

export function skinById(id: string): Skin | undefined {
  return SKIN_INDEX.get(id)
}

/** The unpainted default — the fallback for an unknown or locked id. */
export function defaultSkin(): Skin {
  const first = SKINS[0]
  if (first === undefined) throw new Error('skins: SKINS is empty')
  return first
}

/** Every valid skin id, for validating a persisted profile. */
export function allSkinIds(): string[] {
  return SKINS.map((skin) => skin.id)
}

/**
 * Whether a livery is available to a pilot.
 *
 * Takes the earned achievements as a plain record rather than reaching for the
 * profile store, because this module is in the game layer and may not import
 * state (§32.1). The caller passes what it already has.
 */
export function isSkinUnlocked(
  skin: Skin,
  pilotLevel: number,
  achievements: Readonly<Record<AchievementId, boolean>>,
): boolean {
  return skin.unlock.kind === 'level'
    ? pilotLevel >= skin.unlock.level
    : achievements[skin.unlock.id]
}

/** One line explaining what a locked livery costs, for the Hangar card. */
export function unlockRequirement(skin: Skin): string {
  return skin.unlock.kind === 'level' ? `Reach level ${skin.unlock.level}` : skin.unlock.condition
}
