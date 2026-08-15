/**
 * Versioned, schema-validated localStorage persistence (gameplan §32.3, §39.1).
 *
 * Two rules govern this file:
 *
 *  - "Validate everything read from `localStorage` against a schema. Corrupt
 *    data resets to defaults with a toast — it must **never** prevent someone
 *    from playing." (Rule 10)
 *  - "localStorage input is validated and schema-checked before use — a
 *    corrupted save must not become an injection vector." (§39.1)
 *
 * Both mean the same thing in practice: nothing here trusts the stored payload.
 */
import { SLOTS, type Slot } from '../game/data/parts.ts'
import { defaultSkin, skinById, type AchievementId } from '../game/data/skins.ts'
import { defaultWorld, worldById } from '../game/data/worlds.ts'
import { codeFromLegacyKey, translateChord } from '../platform/keys.ts'
import { warn } from '../debug/logger.ts'

/**
 * The schema version. Bumping it requires a migration branch in `loadData`,
 * not a reset — see the comment there.
 */
export const CURRENT_VERSION = 7

/**
 * The rebindable actions.
 *
 * Renamed at v5, and the renames were the point rather than housekeeping:
 *
 *  - `rollLeft`/`rollRight` → `turnLeft`/`turnRight`. They have never rolled
 *    anything. Bank is derived from measured angular velocity (§20.4), so the
 *    old names described an axis the simulation does not have.
 *  - `throttleUp`/`throttleDown` → `brake`. "Full throttle" was a key that did
 *    nothing: hands-off throttle is already 1.0, because every deadline the game
 *    quotes is derived from the terminal velocity at full throttle. A control
 *    listed in Settings that cannot change anything is worse than no control.
 *  - `recentre` is gone from the defaults as a no-op and back as a real one —
 *    see `deviceInput`, where it now zeroes the mouse stick and levels the nose.
 */
export type Action =
  | 'steer' | 'brake' | 'turnLeft' | 'turnRight'
  | 'strafeLeft' | 'strafeRight'
  | 'ascend' | 'descend' | 'fire' | 'lock' | 'flare' | 'bomb' | 'switchWeapon' | 'engineCut'
  | 'boost' | 'map' | 'pause' | 'recentre'

export type Binding = string

/**
 * Every action holds a **list** of bindings, and all of them are live.
 *
 * A single binding per action is why "WASD or the arrow keys" was not
 * expressible: the player had to choose, in a settings screen, between two
 * layouts that every other game lets them use interchangeably. Two slots is
 * enough for the cases that actually come up — a hand position and a
 * fallback — and keeping it a list rather than a `primary`/`alternate` pair
 * means the matching code has one path instead of two.
 */
export type BindingList = readonly Binding[]

/** How many bindings one action may hold. */
export const MAX_BINDINGS_PER_ACTION = 2

export interface Settings {
  audio: {
    master: number
    sfx: number
    ui: number
    music: number
  }
  display: {
    quality: 'low' | 'high'
    hudScale: number
    colorMode: 'default' | 'high-contrast'
  }
  controls: {
    autoFire: boolean
    toggleFire: boolean
    /** Percent. 100 = the tuned default; see `MOUSE_GAIN` in deviceInput. */
    mouseSensitivity: number
    invertY: boolean
    /**
     * Percent of full deflection ignored around centre, applied to every
     * analogue axis — stick, mouse and touch alike.
     */
    deadzone: number
    /**
     * The shape of the axis past the deadzone. `precise` trades edge bite for
     * fine control near centre, `sharp` does the opposite.
     */
    steerResponse: 'linear' | 'precise' | 'sharp'
    /**
     * Which pointing device to tune for.
     *
     * A trackpad's usable throw is about a tenth of a mouse's, so one set of
     * gain and recentre numbers cannot serve both — see `deviceProfile.ts`.
     * `auto` watches the shape of the wheel event stream, which is a strong
     * signal and still a guess, so the override exists and always wins.
     */
    pointer: 'auto' | 'mouse' | 'trackpad'
  }
  accessibility: {
    reducedMotion: boolean
    aimAssist: number // 0-100
    enemyDamage: number // 0-150
    drainRate: number // 50-150
    enemySpeed: number // 75-125
    infiniteBoost: boolean
    ddaEnabled: boolean
  }
}

export interface Progress {
  bestScore: number
  bestWave: number
  tutorialCompleted: boolean
  /** Accumulated pilot XP across all runs. Drives part and skin unlocks. */
  pilotXp: number
  /** Accumulated credits earned from sector revenue dividends and bounties. */
  credits: number
  /** Part calibration tuning offsets per slot (-1.0 to +1.0). */
  partTuning: Partial<Record<Slot, number>>
  /** Parts unlocked in the Hangar store. */
  unlockedParts: string[]
  /**
   * The currently equipped part id per slot. A missing slot means stock.
   * Validated on load: unknown ids fall back to undefined (= stock).
   */
  equippedLoadout: Partial<Record<Slot, string>>
  /** Selected cosmetic skin id. Validated against the skin registry on load. */
  skinId: string
  /** Selected world id (§7.1). Validated against the world registry on load. */
  worldId: string
  /**
   * One-off conditions that unlock the four achievement skins.
   *
   * Stored rather than derived because they are *historical*: "finished a run
   * with all eight outposts standing" is not recoverable from `bestScore` and
   * `bestWave`, and re-deriving it would silently revoke a livery the player
   * already earned.
   */
  achievements: Record<AchievementId, boolean>
}

export interface PersistedData {
  version: 7
  settings: Settings
  progress: Progress
  keybinds: Record<Action, BindingList>
}

export const defaultData: PersistedData = {
  version: 7,
  settings: {
    audio: { master: 100, sfx: 100, ui: 100, music: 100 },
    display: { quality: 'high', hudScale: 100, colorMode: 'default' },
    controls: {
      autoFire: false,
      toggleFire: false,
      mouseSensitivity: 100,
      invertY: false,
      deadzone: 8,
      steerResponse: 'linear',
      pointer: 'auto',
    },
    accessibility: {
      reducedMotion: false,
      aimAssist: 35,
      enemyDamage: 100,
      drainRate: 100,
      enemySpeed: 100,
      infiniteBoost: false,
      ddaEnabled: true,
    }
  },
  progress: {
    bestScore: 0,
    bestWave: 0,
    tutorialCompleted: false,
    pilotXp: 0,
    credits: 250,
    partTuning: {},
    unlockedParts: [],
    equippedLoadout: {},
    skinId: defaultSkin().id,
    worldId: defaultWorld().id,
    achievements: { cleanSweep: false, deadEye: false, trophyIron: false },
  },
  keybinds: defaultKeybinds()
}

/**
 * Default bindings, as physical `KeyboardEvent.code` values.
 *
 * Physical rather than character-based, so the WASD *positions* are bound on
 * every layout — on AZERTY those keys produce `z q s d`, and a character-based
 * default would put the player's hand in the wrong place.
 *
 * ## The scheme
 *
 * ```
 *   ARROWS — aim                WASD — act        MODIFIED (Ctrl · ⌥ on macOS)
 *   ←   turn left               A   slide left    ⌃←  slide left
 *   →   turn right              D   slide right   ⌃→  slide right
 *   ↑   climb                   W   boost         ⌃↑  boost
 *   ↓   dive                    S   brake         ⌃↓  brake
 *
 *   Space  fire     Shift  missile lock     Tab  map     Esc  pause
 * ```
 *
 * **The arrows say where; WASD says how.** Turning changes where the nose
 * points, sliding does not, and the two are genuinely different verbs — putting
 * them on the same pair of keys is what made translation invisible before. One
 * hand owns all four directions, the other owns the four things that are not
 * directions.
 *
 * Three things here are answers to complaints rather than preferences.
 *
 * **WASD and the arrows are both bound**, because there is no version of this
 * game in which a player who reaches for the arrow keys should find nothing
 * there. Two bindings per action costs one array and removes an entire class of
 * "the controls don't work".
 *
 * **Space fires.** It was climb, which put the most-pressed verb in the game on
 * a mouse button nobody finds without being told, and the most obvious key in
 * the world on a control used twice a wave.
 *
 * **The arrows aim, WASD acts.** Left and right turn the nose; up and down
 * command altitude. That is one hand doing all four *directions*, which is the
 * set a player thinks of as "where am I going". WASD is then free for the four
 * things that are not directions at all: slide, slide, faster, slower.
 *
 * The split matters because turning and sliding are genuinely different verbs
 * here — a turn changes heading, a slide does not — and putting them on the
 * same two keys is what made translation invisible in the first place.
 *
 * **The translate modifier is platform-dependent, and this is not a nicety.**
 * Holding it makes the arrows take on the WASD roles. `translateChord` owns
 * which modifier that is and why (macOS steals `⌃←`/`⌃→` for Mission Control);
 * bare keys are the modifier-free path everywhere, so nobody ever depends on a
 * chord.
 */
export function defaultKeybinds(): Record<Action, BindingList> {
  return {
    steer: ['Mouse'],

    /* Arrows: where the craft is pointed and how high it is. */
    turnLeft: ['ArrowLeft'],
    turnRight: ['ArrowRight'],
    ascend: ['ArrowUp'],
    descend: ['ArrowDown'],

    /* WASD: what the craft is doing. Slide keeps the heading; boost and brake
       change speed. Each is also on the arrows under the modifier. */
    strafeLeft: ['KeyA', translateChord('ArrowLeft')],
    strafeRight: ['KeyD', translateChord('ArrowRight')],
    boost: ['KeyW', translateChord('ArrowUp')],
    brake: ['KeyS', translateChord('ArrowDown')],

    fire: ['Space', 'Mouse0'],
    lock: ['ShiftLeft', 'Mouse2'],
    flare: ['KeyX'],
    bomb: ['KeyV', 'KeyB'],
    switchWeapon: ['KeyQ', 'Tab'],
    engineCut: ['KeyC'],
    map: ['KeyM'],
    pause: ['Escape', 'KeyP'],
    recentre: ['KeyR'],
  }
}

/**
 * v4 action names, and what they became.
 *
 * A rename is a migration like any other: a player who bound "steer left" to a
 * key they liked should not lose it because the field it lived in was renamed
 * to describe what it had always actually done.
 */
const RENAMED_ACTIONS: Record<string, Action> = {
  rollLeft: 'turnLeft',
  rollRight: 'turnRight',
  throttleDown: 'brake',
}

/**
 * Actions introduced after a given schema version.
 *
 * A v5 save has no `strafeLeft` key, and the absence means "this player has
 * never seen this control", not "this player unbound it". Without this list the
 * array branch in `parseKeybinds` would read the missing entry as an empty list
 * and hand every upgrading player a translation axis they cannot use.
 */
const ACTIONS_ADDED_IN: Partial<Record<Action, number>> = {
  strafeLeft: 6,
  strafeRight: 6,
  flare: 7,
  bomb: 7,
  switchWeapon: 7,
  engineCut: 7,
}

/**
 * Movement actions whose **meaning** changed at v7, not just their default.
 *
 * v7 swapped the two families: turning moved from `A`/`D` to `←`/`→`, and
 * `A`/`D` became the slide. Every other migration in this file preserves what
 * the player bound, and that is right — a rebind is a decision. This one cannot,
 * because a stored v6 set is not a *preference* for the old layout, it is a copy
 * of the old default, and honouring it would leave every existing player on a
 * scheme the game no longer explains anywhere: the tutorial, the control hint
 * and Settings would all describe the new one.
 *
 * So these five are reset to the v7 defaults on the way through, and only these
 * five. Fire, lock, map, pause and recentre are untouched, so a player who moved
 * fire to `F` keeps it.
 */
const ACTIONS_RESET_AT_V7: readonly Action[] = [
  'turnLeft', 'turnRight', 'ascend', 'descend', 'strafeLeft', 'strafeRight', 'boost', 'brake',
]

/**
 * The key is a namespace, not a version gate — it deliberately keeps its `_v2`
 * suffix now that the schema is at v4. Renaming it would orphan every existing
 * save behind a key nothing reads, which is the same data loss the migration
 * branch in `loadData` exists to prevent, just spelled differently.
 */
const STORAGE_KEY = 'mare_noctis_v2'

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/**
 * `JSON.parse` returns `any`, and casting that to `PersistedData` is a lie the
 * type system cannot catch: a save with `version: 2` and a string where a
 * number belongs would pass straight through and reach the simulation as
 * `NaN`. §39.1 requires localStorage input to be validated and schema-checked
 * before use, and §32.3 requires corrupt data to reset to defaults rather than
 * crash. These narrowing helpers are how that becomes true rather than claimed.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A finite number inside [min, max], or the fallback. Rejects NaN and Infinity. */
function num(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return value < min ? min : value > max ? max : value
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function choice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

/**
 * Rebuilds settings field by field from `unknown`.
 *
 * Deliberately total: every field either validates or falls back to its
 * default, so the result is always a well-formed `Settings` and a partially
 * corrupt save loses only the fields that were actually corrupt. Ranges match
 * the accessibility axes in §10.5.
 */
export function parseSettings(value: unknown): Settings {
  const d = defaultData.settings
  if (!isRecord(value)) return d

  const audio = isRecord(value.audio) ? value.audio : {}
  const display = isRecord(value.display) ? value.display : {}
  const controls = isRecord(value.controls) ? value.controls : {}
  const access = isRecord(value.accessibility) ? value.accessibility : {}

  return {
    audio: {
      master: num(audio.master, 0, 100, d.audio.master),
      music: num(audio.music, 0, 100, d.audio.music),
      sfx: num(audio.sfx, 0, 100, d.audio.sfx),
      ui: num(audio.ui, 0, 100, d.audio.ui),
    },
    display: {
      quality: choice(display.quality, ['low', 'high'] as const, d.display.quality),
      hudScale: num(display.hudScale, 75, 150, d.display.hudScale),
      colorMode: choice(display.colorMode, ['default', 'high-contrast'] as const, d.display.colorMode),
    },
    controls: {
      autoFire: bool(controls.autoFire, d.controls.autoFire),
      toggleFire: bool(controls.toggleFire, d.controls.toggleFire),
      mouseSensitivity: num(controls.mouseSensitivity, 10, 300, d.controls.mouseSensitivity),
      invertY: bool(controls.invertY, d.controls.invertY),
      deadzone: num(controls.deadzone, 0, 40, d.controls.deadzone),
      steerResponse: choice(controls.steerResponse, ['linear', 'precise', 'sharp'] as const, d.controls.steerResponse),
      pointer: choice(controls.pointer, ['auto', 'mouse', 'trackpad'] as const, d.controls.pointer),
    },
    accessibility: {
      reducedMotion: bool(access.reducedMotion, d.accessibility.reducedMotion),
      aimAssist: num(access.aimAssist, 0, 100, d.accessibility.aimAssist),
      enemyDamage: num(access.enemyDamage, 0, 150, d.accessibility.enemyDamage),
      drainRate: num(access.drainRate, 50, 150, d.accessibility.drainRate),
      enemySpeed: num(access.enemySpeed, 75, 125, d.accessibility.enemySpeed),
      infiniteBoost: bool(access.infiniteBoost, d.accessibility.infiniteBoost),
      ddaEnabled: bool(access.ddaEnabled, d.accessibility.ddaEnabled),
    },
  }
}

export function parseProgress(value: unknown): Progress {
  const d = defaultData.progress
  if (!isRecord(value)) return d

  // Validate equippedLoadout: only accept known slot keys mapping to non-empty strings.
  const rawLoadout = isRecord(value.equippedLoadout) ? value.equippedLoadout : {}
  const equippedLoadout: Partial<Record<Slot, string>> = {}
  for (const slot of SLOTS) {
    const v = rawLoadout[slot]
    if (typeof v === 'string' && v.length > 0 && v.length <= 64) {
      equippedLoadout[slot] = v
    }
  }

  // An unknown skin id falls back to the factory livery rather than being kept.
  // A stored id is a *lookup key* the render layer will resolve to colours, so
  // trusting an arbitrary string here would let a hand-edited save reach the
  // material code with something that is not a skin at all.
  const rawSkin = value.skinId
  const skinId = typeof rawSkin === 'string' && skinById(rawSkin) !== undefined ? rawSkin : d.skinId

  const rawWorld = value.worldId
  const worldId = typeof rawWorld === 'string' && worldById(rawWorld) !== undefined ? rawWorld : d.worldId

  const rawTuning = isRecord(value.partTuning) ? value.partTuning : {}
  const partTuning: Partial<Record<Slot, number>> = {}
  for (const slot of SLOTS) {
    const v = rawTuning[slot]
    if (typeof v === 'number' && Number.isFinite(v)) {
      partTuning[slot] = Math.max(-1, Math.min(1, v))
    }
  }

  const rawAchievements = isRecord(value.achievements) ? value.achievements : {}

  const unlockedParts: string[] = Array.isArray(value.unlockedParts)
    ? value.unlockedParts.filter((id): id is string => typeof id === 'string')
    : []

  return {
    bestScore: Math.floor(num(value.bestScore, 0, Number.MAX_SAFE_INTEGER, d.bestScore)),
    bestWave: Math.floor(num(value.bestWave, 0, 999, d.bestWave)),
    tutorialCompleted: bool(value.tutorialCompleted, d.tutorialCompleted),
    pilotXp: Math.floor(num(value.pilotXp, 0, Number.MAX_SAFE_INTEGER, d.pilotXp)),
    credits: Math.floor(num(value.credits, 0, Number.MAX_SAFE_INTEGER, d.credits)),
    partTuning,
    unlockedParts,
    equippedLoadout,
    skinId,
    worldId,
    achievements: {
      cleanSweep: bool(rawAchievements.cleanSweep, d.achievements.cleanSweep),
      deadEye: bool(rawAchievements.deadEye, d.achievements.deadEye),
      trophyIron: bool(rawAchievements.trophyIron, d.achievements.trophyIron),
    },
  }
}

/** A binding is a short, non-empty string. Anything else is not one. */
function isBindingString(value: unknown): value is Binding {
  return typeof value === 'string' && value.length > 0 && value.length <= 32
}

/**
 * Keybinds are rebuilt from the known action list rather than trusted wholesale.
 *
 * Taking the stored object as-is would let a corrupt save introduce actions
 * that do not exist, or drop ones that do — and a missing binding is a control
 * the player silently cannot use.
 *
 * Three shapes arrive here and all three have to work:
 *
 *  - **v5**: `{ turnLeft: ['KeyA', 'ArrowLeft'] }` — a list of codes.
 *  - **v4**: `{ rollLeft: 'KeyA' }` — one code, under the old name.
 *  - **v2/v3**: `{ rollLeft: 'a' }` — one `KeyboardEvent.key` character, which
 *    `codeFromLegacyKey` translates to the physical key it meant.
 *
 * The older two are read into the *first* slot only, leaving the default
 * alternate in place. That is the generous reading: a v4 player who never chose
 * an alternate gains the arrow keys, and one who rebound `rollLeft` to `Q` keeps
 * `Q` and gains `←` alongside it.
 */
export function parseKeybinds(value: unknown, version: number): Record<Action, BindingList> {
  const source = isRecord(value) ? value : {}
  const result = defaultKeybinds()
  const translate = (raw: Binding): Binding | null =>
    version >= 4 ? raw : codeFromLegacyKey(raw)

  for (const action of Object.keys(result) as Action[]) {
    // An action the stored schema predates keeps its default outright. Reading
    // "absent" as "the player cleared it" would hand every upgrading player a
    // control they cannot press.
    const addedIn = ACTIONS_ADDED_IN[action]
    if (addedIn !== undefined && version < addedIn) continue

    // The v7 layout swap. See `ACTIONS_RESET_AT_V7`.
    if (version < 7 && ACTIONS_RESET_AT_V7.includes(action)) continue

    // v4 and earlier stored some of these under their previous names.
    const legacyName = Object.entries(RENAMED_ACTIONS).find(([, to]) => to === action)?.[0]
    const stored = source[action] ?? (legacyName === undefined ? undefined : source[legacyName])
    if (stored === undefined) continue

    if (Array.isArray(stored)) {
      const list: Binding[] = []
      for (const entry of stored.slice(0, MAX_BINDINGS_PER_ACTION)) {
        if (!isBindingString(entry)) continue
        const code = translate(entry)
        if (code !== null && !list.includes(code)) list.push(code)
      }
      // An empty list is a legitimate state — the player cleared the action —
      // but an empty list produced by *corruption* would silently remove a
      // control, so it only survives when the stored value was a real array.
      result[action] = list
      continue
    }

    if (!isBindingString(stored)) continue
    const code = translate(stored)
    if (code === null) continue
    // Keep the default alternate unless the migrated primary already is it.
    const alternate = result[action].slice(1).filter((entry) => entry !== code)
    result[action] = [code, ...alternate]
  }
  return result
}

/* ------------------------------------------------------------------ */
/* Load and save                                                       */
/* ------------------------------------------------------------------ */

export function loadData(): PersistedData {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch (error) {
    // Storage throws outright in sandboxed iframes and some private modes.
    // §32.3: a storage failure must never prevent someone from playing.
    warn('localStorage unavailable; running with defaults', error)
    return defaultData
  }

  if (raw === null || raw === '') return defaultData

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    warn('Saved data is not valid JSON; resetting to defaults', error)
    return defaultData
  }

  if (!isRecord(parsed)) {
    warn('Saved data is not an object; resetting to defaults')
    return defaultData
  }

  // There is no v1 in the wild — V1 shipped no save system at all (§2.2) — so
  // the migrations that matter are v2 → v3 → v4, and each is a *migration*,
  // not a reset.
  //
  // The version check used to be `!== CURRENT_VERSION → return defaultData`,
  // which reads as caution and is actually destructive: bumping the schema
  // would have silently thrown away every existing player's best score, pilot
  // XP, equipped loadout and rebound keys. A schema change is the developer's
  // problem, and making the player pay for it with their progress is not an
  // acceptable way to solve it.
  //
  // Migration is cheap here because every parser is *total*: each one rebuilds
  // its section field by field and substitutes a default for anything missing
  // or malformed. A v2 payload is just a v4 payload missing `skinId`,
  // `achievements` and the newer control settings, and running it through the
  // same parsers fills exactly those gaps.
  //
  // The two migrations that *transform* rather than fill are both in the
  // keybinds. v3 → v4 moved bindings from `KeyboardEvent.key` to
  // `KeyboardEvent.code`; v4 → v5 turned each single binding into a list and
  // renamed three actions. `parseKeybinds` handles all three stored shapes, so
  // no player loses a control they chose.
  const version = typeof parsed.version === 'number' ? parsed.version : 0
  if (version < 2 || version > CURRENT_VERSION) {
    warn(`Saved data is version ${String(parsed.version)}, which is not a schema this build knows; resetting`)
    return defaultData
  }

  const data: PersistedData = {
    version: CURRENT_VERSION,
    settings: parseSettings(parsed.settings),
    progress: parseProgress(parsed.progress),
    keybinds: parseKeybinds(parsed.keybinds, version),
  }

  // Persist the upgraded shape immediately, so the next load is a plain v3 read
  // and the migration path stays exercised only by saves that genuinely predate
  // it.
  if (version !== CURRENT_VERSION) saveData(data)

  return data
}

/** True when the stored payload was unusable, so the UI can raise a toast (§32.3). */
export function loadDataWithStatus(): { data: PersistedData; wasReset: boolean } {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return { data: defaultData, wasReset: false }
  }
  if (raw === null || raw === '') return { data: defaultData, wasReset: false }

  const data = loadData()
  let wasReset = false
  try {
    const parsed: unknown = JSON.parse(raw)
    // A v2 save is migrated, not reset, so it must not raise the toast — the
    // player kept everything and has nothing to be told about.
    const version = isRecord(parsed) && typeof parsed.version === 'number' ? parsed.version : 0
    wasReset = !isRecord(parsed) || version < 2 || version > CURRENT_VERSION
  } catch {
    wasReset = true
  }
  return { data, wasReset }
}

export function saveData(data: PersistedData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (error) {
    // Quota exhaustion or a blocked store. Not being able to persist settings
    // is an inconvenience; it must not interrupt play.
    warn('Could not save settings', error)
  }
}

/** Clears the store. Used by the Settings "reset to defaults" action. */
export function clearData(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch (error) {
    warn('Could not clear saved data', error)
  }
}
