/**
 * What the controls are, in one place (gameplan §8).
 *
 * ## Why this file exists
 *
 * Four things describe the controls to the player: the cheat sheet in Settings,
 * the card the HUD shows on the opening waves, the tutorial's three beats, and
 * `docs/CONTROLS.md`. Each of them built its own strings from `keybinds`, which
 * meant four places to update whenever a control changed and four chances to
 * forget one.
 *
 * They had already drifted. The tutorial told players to "hold Shift to Boost"
 * long after boost had moved; the cheat sheet listed a "Full Throttle" key whose
 * only possible effect was to undo the brake. A player who reads two of them and
 * finds they disagree learns not to read either.
 *
 * So: one table, four consumers, no strings anywhere else.
 *
 * ## Layer
 *
 * Lives in `src/platform/` rather than `src/game/` because it reads the player's
 * bindings and the detected platform, both of which are DOM-side facts (§30.2).
 * It returns data, never JSX — the UI decides how to draw it.
 */
import type { Action, BindingList } from '../state/persistence'
import { bindingsLabel, hasKeyboard, hasTouch, platform } from './keys'

/**
 * How a control is described, and to whom.
 *
 *  - `flight` — moving the craft. Shown first, because it is what a lost player
 *    is trying to do.
 *  - `combat` — shooting things.
 *  - `system` — map, pause, recentre.
 */
export type ControlGroup = 'flight' | 'combat' | 'system'

export interface ControlRow {
  /** Stable id, so the UI can key on it without matching prose. */
  readonly id: string
  readonly group: ControlGroup
  /** The verb, as the player would say it. */
  readonly label: string
  /** Which bindings to print, in order. */
  readonly actions: readonly Action[]
  /** One clause of *why*, or why it behaves unexpectedly. Optional. */
  readonly note?: string
  /** What to print instead of a key on a touch device. */
  readonly touch?: string
  /** True when this row is the answer to "how do I shoot". */
  readonly essential?: boolean
}

/**
 * The canonical table.
 *
 * Ordered by what a new player needs first, not by keyboard layout: shoot, then
 * turn, then the rest. The single most common piece of feedback this game has
 * had is "how do I shoot", and a table that opens with throttle trim is a table
 * that answers the wrong question first.
 */
export const CONTROL_ROWS: readonly ControlRow[] = [
  {
    id: 'fire',
    group: 'combat',
    label: 'Shoot',
    actions: ['fire'],
    note: 'Hold it. The gun has heat rather than ammunition, so it never runs out — it stops.',
    touch: 'the ● button, right side',
    essential: true,
  },
  {
    id: 'turn',
    group: 'flight',
    label: 'Turn',
    actions: ['turnLeft', 'turnRight'],
    note: 'Or move the mouse. Turning changes where the nose points.',
    touch: 'drag the left half of the screen',
    essential: true,
  },
  {
    id: 'strafe',
    group: 'flight',
    label: 'Slide',
    actions: ['strafeLeft', 'strafeRight'],
    note: 'Translation without turning — the way to break a firing solution without giving up your heading.',
    touch: 'the side rocker, left edge',
    essential: true,
  },
  {
    id: 'altitude',
    group: 'flight',
    label: 'Climb / dive',
    actions: ['ascend', 'descend'],
    touch: 'drag the right column up and down',
    essential: true,
  },
  {
    id: 'boost',
    group: 'flight',
    label: 'Boost',
    actions: ['boost'],
    note: '3 seconds, then 6 to recharge. Spend it on the leg that changes the outcome.',
    touch: 'the ⏵⏵ button',
    essential: true,
  },
  {
    id: 'brake',
    group: 'flight',
    label: 'Brake',
    actions: ['brake'],
    note: 'The craft holds cruise by itself, so this is the only throttle control there is.',
    touch: 'drag the right column down',
  },
  {
    id: 'switchWeapon',
    group: 'combat',
    label: 'Weapon mode',
    actions: ['switchWeapon'],
    note: 'Pulse cannon or guided missiles. The mode is named under the crosshair, always.',
    touch: 'the ⇋ switch button',
    essential: true,
  },
  {
    id: 'lock',
    group: 'combat',
    label: 'Missile lock',
    actions: ['lock'],
    note: 'Hold it on a target until the ring closes. The lock then keeps itself for four seconds — let go, fly, and fire when you are ready.',
    touch: 'the ⌖ button',
  },
  {
    id: 'bomb',
    group: 'combat',
    label: 'Heavy bomb bay',
    actions: ['bomb'],
    note: 'The ring on the ground is where it will land, drawn at its true blast radius. A bomb keeps your speed, so it lands well ahead of you.',
    touch: 'the 💣 bomb button',
  },
  {
    id: 'engineCut',
    group: 'flight',
    label: 'Engine Cut / Newtonian Drift',
    actions: ['engineCut'],
    note: 'Cut propulsion and coast on momentum, turning freely. Press again — or boost — to relight.',
    touch: 'the FLOAT button',
  },
  {
    id: 'flare',
    group: 'combat',
    label: 'Countermeasure flares',
    actions: ['flare'],
    note: 'Burns every hostile round within 40 u. Five per run — the answer to being cornered, not to being shot at.',
    touch: 'the ◈ flare button',
  },
  {
    id: 'map',
    group: 'system',
    label: 'Orbital map',
    actions: ['map'],
    note: 'Held, not toggled. The rings are seconds of flight at cruise.',
    touch: 'the map button',
  },
  {
    id: 'recentre',
    group: 'system',
    label: 'Recentre aim',
    actions: ['recentre'],
  },
  {
    id: 'pause',
    group: 'system',
    label: 'Pause',
    actions: ['pause'],
    touch: 'the ❚❚ button',
  },
]

export interface ResolvedControl {
  readonly id: string
  readonly group: ControlGroup
  readonly label: string
  /** Ready to print: `"W / ↑"`, `"⌃A / ←"`, `"drag the left half"`. */
  readonly keys: string
  readonly note: string | undefined
}

/**
 * Resolves the table against the player's actual bindings and device.
 *
 * On a touch-only device the key column would be a list of things the player
 * cannot press, so the touch description replaces it outright. On a device with
 * both — a laptop with a touchscreen, which is the case the input layer was
 * rebuilt to support — both are shown, because both work at once.
 */
export function resolveControls(
  keybinds: Record<Action, BindingList>,
  options: { group?: ControlGroup; essentialOnly?: boolean } = {},
): ResolvedControl[] {
  const rows = CONTROL_ROWS.filter(
    (row) =>
      (options.group === undefined || row.group === options.group) &&
      (options.essentialOnly !== true || row.essential === true),
  )

  return rows.map((row) => {
    const keyed = hasKeyboard
      ? row.actions.map((action) => bindingsLabel(keybinds[action])).join(' · ')
      : ''
    const touched = hasTouch && row.touch !== undefined ? row.touch : ''
    const keys = [keyed, touched].filter((part) => part.length > 0).join('  —  ')
    return {
      id: row.id,
      group: row.group,
      label: row.label,
      keys: keys.length > 0 ? keys : '—',
      note: row.note,
    }
  })
}

/** The platform's own name, for the cheat sheet's header. */
export function platformName(): string {
  switch (platform) {
    case 'macos':
      return 'macOS'
    case 'windows':
      return 'Windows'
    case 'linux':
      return 'Linux'
    default:
      return 'Touch'
  }
}
