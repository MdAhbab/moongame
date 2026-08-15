/**
 * Key identity, platform detection and human labels (gameplan §8).
 *
 * WHY BINDINGS ARE `KeyboardEvent.code` AND NOT `.key`
 * ----------------------------------------------------
 * `.key` is the *character produced*, which depends on modifiers and on the
 * keyboard layout. Three consequences, all of which were live bugs:
 *
 *  - **Shift breaks every binding.** Holding Shift to boost and pressing A
 *    delivers `.key === 'A'`, not `'a'`. Lower-casing hides that for letters
 *    and not for anything else: Shift+1 is `'!'`, Shift+`/` is `'?'`. A player
 *    who boosts while steering was pressing keys the game had never heard of.
 *  - **Non-QWERTY layouts get the wrong physical keys.** On AZERTY the WASD
 *    positions produce `z q s d`, so the default binding lands the player's
 *    hand somewhere else entirely.
 *  - **Space is ambiguous.** `.key` is `' '`, a single space character, which
 *    is invisible in a settings screen and trivially mistaken for "unbound".
 *
 * `.code` is the *physical key*: `KeyW` is the key where W sits on QWERTY, on
 * every layout and under every modifier. That is what a game binding means.
 *
 * The cost is that a label has to be derived rather than displayed, which is
 * what `codeLabel` is for — and that turns out to be a feature, because the
 * label a player should see is platform-dependent anyway (`Ctrl` on Windows,
 * `⌃` on a Mac).
 */

/* ------------------------------------------------------------------ */
/* Platform                                                            */
/* ------------------------------------------------------------------ */

export type Platform = 'windows' | 'macos' | 'linux' | 'touch'

/**
 * Detected once. Touch wins over the operating system when the device has no
 * fine pointer at all — a Surface with both reports as Windows, which is right,
 * because it has a keyboard.
 */
export const platform: Platform = detectPlatform()

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'windows'

  const coarseOnly =
    typeof matchMedia === 'function' &&
    matchMedia('(pointer: coarse)').matches &&
    !matchMedia('(any-pointer: fine)').matches
  if (coarseOnly) return 'touch'

  // `userAgentData.platform` where it exists; `userAgent` is the fallback and
  // `navigator.platform` is deprecated everywhere.
  const brands = (navigator as { userAgentData?: { platform?: string } }).userAgentData
  const name = (brands?.platform ?? navigator.userAgent).toLowerCase()

  if (name.includes('mac') || name.includes('iphone') || name.includes('ipad')) return 'macos'
  if (name.includes('win')) return 'windows'
  if (name.includes('linux') || name.includes('android') || name.includes('cros')) return 'linux'
  return 'windows'
}

/** True when the device can take touch input at all, regardless of platform. */
export const hasTouch =
  typeof navigator !== 'undefined' && (navigator.maxTouchPoints > 0 || 'ontouchstart' in globalThis)

/** True when a physical keyboard is plausibly present. */
export const hasKeyboard = platform !== 'touch'

/* ------------------------------------------------------------------ */
/* Bindings                                                            */
/* ------------------------------------------------------------------ */

/**
 * A binding is a `KeyboardEvent.code`, a `Mouse<button>` string, a `Pad<index>`
 * string, or any of those prefixed with modifiers: `"Alt+KeyW"`,
 * `"Control+Shift+KeyR"`. One flat namespace, stored as a plain string, so the
 * persisted shape did not have to change when chords arrived.
 */
export type Binding = string

/* ---- Modifiers -------------------------------------------------------- */

export const MOD_NONE = 0
export const MOD_SHIFT = 1
export const MOD_CONTROL = 2
export const MOD_ALT = 4
export const MOD_META = 8

const MODIFIER_BITS: Record<string, number> = {
  Shift: MOD_SHIFT,
  Control: MOD_CONTROL,
  Alt: MOD_ALT,
  Meta: MOD_META,
}

/** The modifier bitmask an event carries. */
export function modifiersOf(event: {
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
}): number {
  return (
    (event.shiftKey ? MOD_SHIFT : 0) |
    (event.ctrlKey ? MOD_CONTROL : 0) |
    (event.altKey ? MOD_ALT : 0) |
    (event.metaKey ? MOD_META : 0)
  )
}

/** Splits `"Alt+KeyW"` into its modifier mask and its physical code. */
export function parseBinding(binding: Binding): { modifiers: number; code: string } {
  if (!binding.includes('+')) return { modifiers: MOD_NONE, code: binding }
  const parts = binding.split('+')
  const code = parts[parts.length - 1] ?? binding
  let modifiers = MOD_NONE
  for (let i = 0; i < parts.length - 1; i++) {
    modifiers |= MODIFIER_BITS[parts[i] ?? ''] ?? 0
  }
  return { modifiers, code }
}

/** Builds the canonical stored form. Order is fixed so two equal chords compare equal. */
export function formatBinding(modifiers: number, code: string): Binding {
  let prefix = ''
  if (modifiers & MOD_CONTROL) prefix += 'Control+'
  if (modifiers & MOD_ALT) prefix += 'Alt+'
  if (modifiers & MOD_SHIFT) prefix += 'Shift+'
  if (modifiers & MOD_META) prefix += 'Meta+'
  return prefix + code
}

/**
 * Does this binding match this physical key, given the modifiers held?
 *
 * ## Why the modifier comparison is masked rather than exact
 *
 * A chord has to be *exclusive*: while the strafe modifier is held, `A` must
 * mean strafe-left and must **not** also mean turn-left, or every strafe would
 * simultaneously be a turn and the two verbs would be indistinguishable. That
 * argues for comparing the full modifier state exactly.
 *
 * Exactly is too strong, and the counter-example is in the default bindings.
 * Missile lock is bound to Shift. Holding Shift to lock a target while turning
 * with `A` produces `KeyA` with the Shift bit set — which under an exact
 * comparison matches nothing, so steering would die the instant a player held
 * lock. That is the same class of bug that `.code` bindings were introduced to
 * kill, arriving through a different door.
 *
 * So the comparison is exact *over the modifiers that are actually used as chord
 * modifiers somewhere in the binding table*, and blind to the rest.
 * `setChordModifiers` is how the input layer declares that set. With only Alt in
 * use: `Alt+A` is unambiguously strafe, `Shift+A` is turn-with-lock-held, and
 * both are right.
 */
export function bindingMatches(binding: Binding, code: string, modifiers: number = MOD_NONE): boolean {
  const parsed = parseBinding(binding)
  if (!codeMatches(parsed.code, code)) return false
  return (modifiers & chordModifierMask) === (parsed.modifiers & chordModifierMask)
}

/**
 * Which modifiers participate in matching.
 *
 * Recomputed by the input layer whenever the binding table changes. Defaults to
 * none, so a table with no chords behaves exactly as it did before chords
 * existed.
 */
let chordModifierMask = MOD_NONE

/** Declares the modifiers used as chord prefixes anywhere in the binding table. */
export function setChordModifiers(bindings: Iterable<Binding>): void {
  let mask = MOD_NONE
  for (const binding of bindings) mask |= parseBinding(binding).modifiers
  chordModifierMask = mask
}

/** For tests and for the Settings screen's conflict check. */
export function chordModifiers(): number {
  return chordModifierMask
}

/**
 * Left and right modifiers count as the same key.
 *
 * A player who binds "boost" by pressing left Shift means *Shift*, and being
 * told their right Shift does nothing would be a bug report, not a feature.
 * Applied at match time rather than at bind time, so the stored value still
 * records which one they actually pressed.
 */
function codeMatches(binding: string, code: string): boolean {
  if (binding === code) return true
  return stripSide(binding) === stripSide(code)
}

function stripSide(code: string): string {
  return code.replace(/(Left|Right)$/, (match, _m, offset: number) =>
    // Only strip from the modifiers, never from `ArrowLeft` or `BracketRight`.
    /^(Shift|Control|Alt|Meta)$/.test(code.slice(0, offset)) ? '' : match,
  )
}

/**
 * Why a binding cannot be used, or `null` if it can.
 *
 * Returns a *reason* rather than a boolean because a control that silently
 * refuses to bind is indistinguishable from one that is broken. The player
 * pressed a key; they are owed an explanation.
 */
export function bindingRejection(binding: Binding, on: Platform = platform): string | null {
  const { modifiers, code } = parseBinding(binding)

  if (UNBINDABLE.has(code)) return `${codeLabel(code, on)} is reserved by the browser.`

  // Chords the browser acts on before any page sees them. `preventDefault` does
  // not help — Ctrl+W is not interceptable, and binding a flight control to it
  // would mean pressing that control *quits the game*.
  const withMeta = (modifiers & MOD_META) !== 0
  if (withMeta) return 'Chords using the Command key are reserved by the system.'

  const isMac = on === 'macos'
  const closesTab = !isMac && (modifiers & MOD_CONTROL) !== 0 && TAB_CHORD_KEYS.has(code)
  if (closesTab) {
    return `Ctrl+${codeLabel(code, on)} is a browser shortcut on this platform — it would close or replace the tab.`
  }

  const isFindOrPrint = (modifiers & MOD_CONTROL) !== 0 && FIND_CHORD_KEYS.has(code) && !isMac
  if (isFindOrPrint) return `Ctrl+${codeLabel(code, on)} is a browser shortcut on this platform.`

  return null
}

/** True for bindings the browser or OS does not own. */
export function isBindable(binding: Binding, on: Platform = platform): boolean {
  return bindingRejection(binding, on) === null
}

const UNBINDABLE = new Set([
  'MetaLeft', 'MetaRight', 'ContextMenu',
  'F5', 'F11', 'F12',
  'BrowserBack', 'BrowserForward', 'BrowserRefresh',
])

/**
 * Keys that, chorded with Ctrl on Windows and Linux, close or replace the tab.
 *
 * This list is the whole reason the strafe modifier is platform-dependent: on
 * macOS these are ⌘ chords and ⌃W is free, so the game uses Control there and
 * Alt everywhere else. Getting this wrong does not degrade the controls — it
 * ships a keybinding that quits the game.
 */
const TAB_CHORD_KEYS = new Set(['KeyW', 'KeyT', 'KeyN', 'KeyQ', 'KeyR', 'Tab'])

/** Chords Windows and Linux browsers claim for find, print and save. */
const FIND_CHORD_KEYS = new Set(['KeyF', 'KeyP', 'KeyS', 'KeyO', 'KeyJ', 'KeyH'])

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

const NAMED: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Escape: 'Esc',
  Tab: 'Tab',
  Backspace: '⌫',
  CapsLock: 'Caps',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Minus: '−',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  Mouse: 'Mouse',
  Mouse0: 'LMB',
  Mouse1: 'MMB',
  Mouse2: 'RMB',
  Mouse3: 'Mouse 4',
  Mouse4: 'Mouse 5',
}

/**
 * Modifier names differ by platform, and using the wrong one is the kind of
 * small wrongness that tells a Mac player the game was not built for them.
 */
const MODIFIERS: Record<string, Record<Platform, string>> = {
  Shift: { windows: 'Shift', macos: '⇧', linux: 'Shift', touch: 'Shift' },
  Control: { windows: 'Ctrl', macos: '⌃', linux: 'Ctrl', touch: 'Ctrl' },
  Alt: { windows: 'Alt', macos: '⌥', linux: 'Alt', touch: 'Alt' },
  Meta: { windows: 'Win', macos: '⌘', linux: 'Super', touch: 'Meta' },
}

/**
 * The label to print for a binding, on this platform.
 *
 * Chords render the way each platform writes them: `⌃W` on a Mac, where
 * modifier glyphs abut the key, and `Alt+W` on Windows, where they are joined by
 * a plus. Getting this backwards is the kind of small wrongness that tells a
 * player the game was built for somebody else.
 */
export function codeLabel(binding: Binding, on: Platform = platform): string {
  const { modifiers, code } = parseBinding(binding)
  const key = plainLabel(code, on)
  if (modifiers === MOD_NONE) return key

  const parts: string[] = []
  if (modifiers & MOD_CONTROL) parts.push(MODIFIERS.Control?.[on] ?? 'Ctrl')
  if (modifiers & MOD_ALT) parts.push(MODIFIERS.Alt?.[on] ?? 'Alt')
  if (modifiers & MOD_SHIFT) parts.push(MODIFIERS.Shift?.[on] ?? 'Shift')
  if (modifiers & MOD_META) parts.push(MODIFIERS.Meta?.[on] ?? 'Meta')
  parts.push(key)
  return on === 'macos' ? parts.join('') : parts.join('+')
}

function plainLabel(binding: string, on: Platform): string {
  const base = stripSide(binding)
  const modifier = MODIFIERS[base]
  if (modifier !== undefined) return modifier[on]

  const named = NAMED[binding]
  if (named !== undefined) return named

  if (binding.startsWith('Key')) return binding.slice(3)
  if (binding.startsWith('Digit')) return binding.slice(5)
  if (binding.startsWith('Numpad')) return `Num ${binding.slice(6)}`
  if (binding.startsWith('Pad')) return `Pad ${binding.slice(3)}`
  return binding
}

/**
 * The modifier that makes the arrow keys take on the WASD roles.
 *
 * **Control, on every platform.** This was briefly split — Option on macOS, to
 * dodge Mission Control's `⌃←`/`⌃→` — and the split was worse than the problem
 * it solved: on macOS the Option bit does not reliably arrive with an arrow
 * keydown, so `⌥↑` was delivered as a bare `ArrowUp` and climbed instead of
 * boosting. A modifier that is silently dropped is far more confusing than one
 * the window server visibly steals.
 *
 * The macOS caveat stands and is acceptable: a player with more than one
 * desktop may find `⌃←`/`⌃→` switching spaces instead of sliding. It costs them
 * nothing, because **the chord is only ever the second binding** — `A` and `D`
 * slide with no modifier at all, on every platform. Nobody is ever dependent on
 * a chord, which is the property that makes this a caveat rather than a bug.
 *
 * The chord targets moved from WASD to the arrows in v7, which also retires the
 * older hazard: `Ctrl+W` closes the tab, and nothing binds it any more.
 *
 * Exported because the default binding table and the Settings screen both need
 * it, and a second copy of this decision is a second place to get it wrong.
 */
export const TRANSLATE_MODIFIER: number = MOD_CONTROL

/** `"Control+ArrowLeft"`, on every platform. */
export function translateChord(code: string, on: Platform = platform): Binding {
  void on
  return formatBinding(MOD_CONTROL, code)
}

/**
 * Every key bound to one action, printed the way a player would say it.
 *
 * "W / ↑" rather than "W", because both really are live and showing only the
 * first would make the second look like it was not working. An unbound action
 * prints an em dash rather than an empty string, so "nothing is bound" is
 * visibly a state rather than a rendering failure — the exact confusion that
 * made Space, stored as `' '`, unreadable in this screen for months.
 */
export function bindingsLabel(bindings: readonly Binding[], on: Platform = platform): string {
  if (bindings.length === 0) return '—'
  return bindings.map((binding) => codeLabel(binding, on)).join(' / ')
}

/**
 * Migration from the v3 schema, which stored `KeyboardEvent.key`.
 *
 * Existing players have `'w'`, `' '` and `'Control'` in their saves. Dropping
 * those and resetting to defaults would silently un-bind every key they had
 * customised, so each is translated to the physical key it almost certainly
 * meant. Anything unrecognised falls back to the caller's default rather than
 * being kept, because an untranslatable binding is one the player cannot press.
 */
export function codeFromLegacyKey(key: string): Binding | null {
  if (key.startsWith('Mouse') || key === 'Mouse') return key

  const direct: Record<string, string> = {
    ' ': 'Space',
    Control: 'ControlLeft',
    Shift: 'ShiftLeft',
    Alt: 'AltLeft',
    Meta: 'MetaLeft',
    Escape: 'Escape',
    Enter: 'Enter',
    Tab: 'Tab',
    ArrowUp: 'ArrowUp',
    ArrowDown: 'ArrowDown',
    ArrowLeft: 'ArrowLeft',
    ArrowRight: 'ArrowRight',
  }
  const mapped = direct[key]
  if (mapped !== undefined) return mapped

  if (key.length === 1) {
    const lower = key.toLowerCase()
    if (lower >= 'a' && lower <= 'z') return `Key${lower.toUpperCase()}`
    if (lower >= '0' && lower <= '9') return `Digit${lower}`
    const punctuation: Record<string, string> = {
      '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight',
      '\\': 'Backslash', ';': 'Semicolon', "'": 'Quote', ',': 'Comma',
      '.': 'Period', '/': 'Slash', '`': 'Backquote',
    }
    return punctuation[lower] ?? null
  }
  return null
}
