/**
 * Key identity (§8).
 *
 * Bindings are `KeyboardEvent.code`, not `.key`, and these tests pin down the
 * three reasons why — each of which was a live bug at some point in this
 * project's history.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { defaultKeybinds } from '../../src/state/persistence'

import {
  MOD_ALT,
  MOD_CONTROL,
  MOD_NONE,
  MOD_SHIFT,
  bindingMatches,
  bindingRejection,
  codeFromLegacyKey,
  codeLabel,
  formatBinding,
  isBindable,
  parseBinding,
  setChordModifiers,
  translateChord,
} from '@/platform/keys'

describe('bindings survive modifiers and layouts', () => {
  it('a letter key is the same binding with or without Shift', () => {
    // The bug: holding Shift to boost while steering delivered `.key === 'A'`
    // rather than `'a'`, so the steering binding stopped matching mid-turn.
    // `.code` is `KeyA` either way, which is the whole point.
    expect(bindingMatches('KeyA', 'KeyA')).toBe(true)
  })

  it('left and right modifiers are interchangeable', () => {
    // A player who bound boost with the left Shift means *Shift*. Being told
    // their right Shift does nothing is a bug report, not a feature.
    expect(bindingMatches('ShiftLeft', 'ShiftRight')).toBe(true)
    expect(bindingMatches('ControlRight', 'ControlLeft')).toBe(true)
    expect(bindingMatches('AltLeft', 'AltRight')).toBe(true)
  })

  it('does not confuse arrow keys or brackets with modifiers', () => {
    // The side-stripping rule has to apply only to modifiers, or `ArrowLeft`
    // and `ArrowRight` collapse into one binding and the player loses an axis.
    expect(bindingMatches('ArrowLeft', 'ArrowRight')).toBe(false)
    expect(bindingMatches('BracketLeft', 'BracketRight')).toBe(false)
  })

  it('distinct keys never match', () => {
    expect(bindingMatches('KeyW', 'KeyS')).toBe(false)
    expect(bindingMatches('Space', 'Enter')).toBe(false)
  })
})

describe('labels are readable and platform-aware', () => {
  it('names the modifiers the way each platform does', () => {
    expect(codeLabel('ControlLeft', 'windows')).toBe('Ctrl')
    expect(codeLabel('ControlLeft', 'macos')).toBe('⌃')
    expect(codeLabel('AltLeft', 'macos')).toBe('⌥')
    expect(codeLabel('AltLeft', 'windows')).toBe('Alt')
    expect(codeLabel('ShiftLeft', 'macos')).toBe('⇧')
  })

  it('never shows a raw code to the player', () => {
    // Space was previously stored as `' '` and rendered as an empty button,
    // which is indistinguishable from "unbound".
    expect(codeLabel('Space')).toBe('Space')
    expect(codeLabel('KeyW')).toBe('W')
    expect(codeLabel('Digit3')).toBe('3')
    expect(codeLabel('Mouse0')).toBe('LMB')
    expect(codeLabel('Mouse2')).toBe('RMB')
    expect(codeLabel('Escape')).toBe('Esc')
  })

  it('labels every arrow distinctly', () => {
    const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].map((code) => codeLabel(code))
    expect(new Set(arrows).size).toBe(4)
  })
})

describe('keys the browser owns cannot be bound', () => {
  it('rejects the ones that would be unrecoverable', () => {
    // Binding an action to F5 or Cmd means the player cannot press it without
    // the browser acting first — and cannot get back to Settings to undo it.
    expect(isBindable('F5')).toBe(false)
    expect(isBindable('MetaLeft')).toBe(false)
    expect(isBindable('F12')).toBe(false)
  })

  it('allows ordinary keys', () => {
    expect(isBindable('KeyQ')).toBe(true)
    expect(isBindable('Space')).toBe(true)
    expect(isBindable('ShiftLeft')).toBe(true)
  })
})

describe('v3 saves translate rather than reset', () => {
  it('maps every default the old schema shipped', () => {
    // These are the exact strings in the v3 default table. If any of them fails
    // to translate, an existing player loses that control on upgrade.
    expect(codeFromLegacyKey('w')).toBe('KeyW')
    expect(codeFromLegacyKey('s')).toBe('KeyS')
    expect(codeFromLegacyKey('a')).toBe('KeyA')
    expect(codeFromLegacyKey('d')).toBe('KeyD')
    expect(codeFromLegacyKey(' ')).toBe('Space')
    expect(codeFromLegacyKey('Control')).toBe('ControlLeft')
    expect(codeFromLegacyKey('Shift')).toBe('ShiftLeft')
    expect(codeFromLegacyKey('Tab')).toBe('Tab')
    expect(codeFromLegacyKey('Escape')).toBe('Escape')
    expect(codeFromLegacyKey('r')).toBe('KeyR')
    expect(codeFromLegacyKey('Mouse0')).toBe('Mouse0')
    expect(codeFromLegacyKey('Mouse2')).toBe('Mouse2')
    expect(codeFromLegacyKey('Mouse')).toBe('Mouse')
  })

  it('handles rebound keys a player might plausibly have chosen', () => {
    expect(codeFromLegacyKey('i')).toBe('KeyI')
    expect(codeFromLegacyKey('K')).toBe('KeyK')
    expect(codeFromLegacyKey('5')).toBe('Digit5')
    expect(codeFromLegacyKey('/')).toBe('Slash')
    expect(codeFromLegacyKey(';')).toBe('Semicolon')
  })

  it('returns null for anything with no physical equivalent', () => {
    // The caller falls back to the default for these. Keeping an
    // untranslatable binding would leave a control the player cannot press.
    expect(codeFromLegacyKey('€')).toBeNull()
    expect(codeFromLegacyKey('SomethingElse')).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* Chords                                                              */
/* ------------------------------------------------------------------ */

describe('a chord is exclusive, and a non-chord modifier is transparent', () => {
  beforeEach(() => {
    // Declares which modifiers participate in matching. The input layer does
    // this from the live binding table; here it is explicit.
    setChordModifiers(['KeyA', 'Alt+KeyA', 'ShiftLeft'])
  })

  it('the modified key does not also fire the bare one', () => {
    // The whole reason the modifier scheme needs exact matching. If `KeyA` also
    // matched while Alt was held, every slide would simultaneously be a turn and
    // the two verbs would be indistinguishable at the point of use.
    expect(bindingMatches('Alt+KeyA', 'KeyA', MOD_ALT)).toBe(true)
    expect(bindingMatches('KeyA', 'KeyA', MOD_ALT)).toBe(false)
  })

  it('the bare key does not fire the chord', () => {
    expect(bindingMatches('KeyA', 'KeyA', MOD_NONE)).toBe(true)
    expect(bindingMatches('Alt+KeyA', 'KeyA', MOD_NONE)).toBe(false)
  })

  it('a modifier nothing chords with is invisible to matching', () => {
    // Missile lock is bound to Shift. Holding it to lock a target while turning
    // delivers `KeyA` with the Shift bit set — and under a *fully* exact
    // comparison that would match nothing, so steering would die the instant a
    // player held lock. Same class of bug as `.key` bindings, different door.
    expect(bindingMatches('KeyA', 'KeyA', MOD_SHIFT)).toBe(true)
    expect(bindingMatches('Alt+KeyA', 'KeyA', MOD_ALT | MOD_SHIFT)).toBe(true)
  })

  it('left and right modifier keys still interchange inside a chord', () => {
    expect(bindingMatches('Alt+ShiftLeft', 'ShiftRight', MOD_ALT)).toBe(true)
  })
})

describe('chords are labelled the way each platform writes them', () => {
  it('abuts glyphs on macOS and joins with a plus elsewhere', () => {
    expect(codeLabel('Control+KeyW', 'macos')).toBe('⌃W')
    expect(codeLabel('Alt+KeyW', 'windows')).toBe('Alt+W')
    expect(codeLabel('Control+Shift+KeyR', 'windows')).toBe('Ctrl+Shift+R')
  })

  it('round-trips through parse and format', () => {
    const binding = formatBinding(MOD_CONTROL | MOD_SHIFT, 'KeyR')
    const parsed = parseBinding(binding)
    expect(parsed.code).toBe('KeyR')
    expect(parsed.modifiers).toBe(MOD_CONTROL | MOD_SHIFT)
  })
})

describe('chords the browser owns are refused, with a reason', () => {
  it('rejects Ctrl+W on Windows and Linux because it closes the tab', () => {
    // Not a style rule. `preventDefault` cannot stop this, so a control bound
    // here would *quit the game* when pressed — and the player would have no
    // idea why.
    expect(bindingRejection('Control+KeyW', 'windows')).toMatch(/close|replace/i)
    expect(bindingRejection('Control+KeyW', 'linux')).not.toBeNull()
  })

  it('allows Ctrl+W on macOS, where the tab shortcut is Command+W', () => {
    expect(bindingRejection('Control+KeyW', 'macos')).toBeNull()
  })

  it('rejects every Command chord everywhere', () => {
    expect(bindingRejection('Meta+KeyA', 'macos')).not.toBeNull()
    expect(bindingRejection('Meta+KeyA', 'windows')).not.toBeNull()
  })

  it('gives a reason rather than a bare false', () => {
    // A rebind row that silently does nothing is indistinguishable from one
    // that is broken, and here "nothing happened" is the good outcome.
    const reason = bindingRejection('Control+KeyT', 'windows')
    expect(typeof reason).toBe('string')
    expect((reason ?? '').length).toBeGreaterThan(10)
  })

  it('still allows ordinary chords', () => {
    expect(bindingRejection('Alt+KeyA', 'windows')).toBeNull()
    expect(bindingRejection('Control+KeyA', 'macos')).toBeNull()
  })
})

describe('the translate modifier avoids the browser on every platform', () => {
  it('picks a chord that is bindable wherever it is used', () => {
    // The chord targets are the **arrow keys** since v7. Checking the keys the
    // scheme actually binds rather than the ones it used to: `Ctrl+W` is still
    // correctly rejected on Windows, and nothing binds it any more.
    for (const on of ['windows', 'macos', 'linux', 'touch'] as const) {
      for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
        expect(bindingRejection(translateChord(key, on), on), `${key} on ${on}`).toBeNull()
      }
    }
  })

  it('still refuses the chords the browser owns', () => {
    // The reason the modifier is platform-split in the first place. If this ever
    // passes as `null`, someone has widened the table and a control that closes
    // the tab is one rebind away.
    expect(bindingRejection('Control+KeyW', 'windows')).not.toBeNull()
    expect(bindingRejection('Control+KeyT', 'windows')).not.toBeNull()
  })

  it('KeyW matches with MOD_SHIFT under default keybinds', () => {
    const keybinds = defaultKeybinds()
    const all: string[] = []
    for (const list of Object.values(keybinds)) {
      all.push(...(list as string[]))
    }
    setChordModifiers(all)

    expect(bindingMatches('KeyW', 'KeyW', MOD_SHIFT)).toBe(true)
  })
})
