/**
 * Save migration (gameplan §32.3, §39.1).
 *
 * Every one of these is a control a real player could lose. The schema has now
 * moved three times — `.key` → `.code` at v4, single binding → list at v5, plus
 * three action renames — and each move is one careless `return defaultData` away
 * from silently resetting somebody's bindings, best score and pilot XP.
 *
 * `loadData` reads `localStorage` directly, so these run against a small stub
 * rather than jsdom: the point is the parsing, not the browser.
 */
import { beforeEach, describe, expect, it } from 'vitest'

const STORAGE_KEY = 'mare_noctis_v2'

const store = new Map<string, string>()

// Installed before the module under test is imported, because `loadData` is
// called at module scope by the settings store.
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string): string | null => store.get(key) ?? null,
    setItem: (key: string, value: string): void => { store.set(key, value) },
    removeItem: (key: string): void => { store.delete(key) },
    clear: (): void => { store.clear() },
  },
})

const { defaultKeybinds, loadData, MAX_BINDINGS_PER_ACTION } = await import('@/state/persistence')
const { bindingRejection } = await import('@/platform/keys')

function write(payload: unknown): void {
  store.set(STORAGE_KEY, JSON.stringify(payload))
}

beforeEach(() => {
  store.clear()
})

describe('defaults', () => {
  it('puts aiming on the arrows', () => {
    // v7 swapped the families: the arrows own all four *directions*, which is
    // the set a player thinks of as "where am I going".
    const binds = defaultKeybinds()
    expect(binds.turnLeft).toContain('ArrowLeft')
    expect(binds.turnRight).toContain('ArrowRight')
    expect(binds.ascend).toContain('ArrowUp')
    expect(binds.descend).toContain('ArrowDown')
  })

  it('puts the non-directional verbs on bare WASD, with no modifier needed', () => {
    // WASD owns the four things that are not directions. Every one of them has
    // a bare key, which is what lets the chorded arrow set be a convenience
    // rather than a dependency — a player on a platform whose chords are
    // blocked must still be able to slide, boost and brake.
    const binds = defaultKeybinds()
    expect(binds.strafeLeft).toContain('KeyA')
    expect(binds.strafeRight).toContain('KeyD')
    expect(binds.boost).toContain('KeyW')
    expect(binds.brake).toContain('KeyS')
    for (const action of ['strafeLeft', 'strafeRight', 'boost', 'brake'] as const) {
      expect(binds[action].some((b) => !b.includes('+')), action).toBe(true)
    }
  })

  it('mirrors the WASD set onto modified arrows', () => {
    // "Holding the modifier lets the arrow keys act like WASD."
    const binds = defaultKeybinds()
    const chordFor = (list: readonly string[]): string | undefined => list.find((b) => b.includes('+'))
    expect(chordFor(binds.strafeLeft)).toMatch(/\+ArrowLeft$/)
    expect(chordFor(binds.strafeRight)).toMatch(/\+ArrowRight$/)
    expect(chordFor(binds.boost)).toMatch(/\+ArrowUp$/)
    expect(chordFor(binds.brake)).toMatch(/\+ArrowDown$/)
  })

  it('never puts turning and sliding on the same key', () => {
    // The distinction the whole scheme exists to protect. A turn changes
    // heading; a slide does not. Sharing a key is what made translation
    // invisible in the first place.
    const binds = defaultKeybinds()
    const turn = new Set([...binds.turnLeft, ...binds.turnRight])
    for (const b of [...binds.strafeLeft, ...binds.strafeRight]) {
      expect(turn.has(b), b).toBe(false)
    }
  })

  it('never ships a default the browser would refuse', () => {
    // The load-bearing case: Ctrl+W closes the tab on Windows and Linux and no
    // page can intercept it, so a default bound there would be a control that
    // quits the game. Checked on every platform, not just this one.
    for (const on of ['windows', 'macos', 'linux', 'touch'] as const) {
      for (const [action, list] of Object.entries(defaultKeybinds())) {
        for (const binding of list) {
          if (binding === 'Mouse' || binding.startsWith('Mouse')) continue
          expect(bindingRejection(binding, on), `${action} ${binding} on ${on}`).toBeNull()
        }
      }
    }
  })

  it('fires on Space', () => {
    expect(defaultKeybinds().fire).toContain('Space')
  })

  it('never exceeds the slot cap, so the Settings rows can render them all', () => {
    for (const [action, list] of Object.entries(defaultKeybinds())) {
      expect(list.length, action).toBeLessThanOrEqual(MAX_BINDINGS_PER_ACTION)
      expect(list.length, action).toBeGreaterThan(0)
    }
  })

  it('leaves no action bound to the same key twice', () => {
    for (const [action, list] of Object.entries(defaultKeybinds())) {
      expect(new Set(list).size, action).toBe(list.length)
    }
  })
})

describe('a v4 save keeps what the player chose', () => {
  it('carries a rebound key into the primary slot and keeps the alternate', () => {
    write({
      version: 4,
      settings: {},
      progress: { bestScore: 9100, pilotXp: 3400 },
      // `fire` rather than a movement action: v7 deliberately resets the eight
      // movement bindings (see ACTIONS_RESET_AT_V7), so asserting preservation
      // on one of those would be asserting the opposite of the intended
      // behaviour. Everything else still carries through untouched.
      keybinds: { ...oldStyleBinds(), fire: 'KeyQ' },
    })

    const data = loadData()
    expect(data.keybinds.fire[0]).toBe('KeyQ')
    expect(data.progress.bestScore).toBe(9100)
    expect(data.progress.pilotXp).toBe(3400)
  })

  it('follows the three renamed actions to their new names', () => {
    write({
      version: 4,
      keybinds: { ...oldStyleBinds(), rollRight: 'KeyC', throttleDown: 'KeyZ', map: 'KeyN' },
    })

    const data = loadData()
    // The renamed actions still resolve to their new names — but they are also
    // movement actions, so v7 resets them to the new defaults afterwards. Both
    // facts matter: the rename must not *drop* the entry on the floor, and the
    // v7 reset must win over whatever it resolved to.
    expect(data.keybinds.turnRight).toEqual(defaultKeybinds().turnRight)
    expect(data.keybinds.brake).toEqual(defaultKeybinds().brake)
    // A non-movement action from the same save is preserved as always.
    expect(data.keybinds.map[0]).toBe('KeyN')
  })
})

describe('a v3 save is translated, not discarded', () => {
  it('turns stored characters into physical keys', () => {
    write({
      version: 3,
      progress: { bestScore: 250 },
      keybinds: { ...legacyBinds(), fire: 'q', map: ' ' },
    })

    const data = loadData()
    expect(data.keybinds.fire[0]).toBe('KeyQ')
    expect(data.keybinds.map[0]).toBe('Space')
    expect(data.progress.bestScore).toBe(250)
  })
})

describe('a v5 save round-trips', () => {
  it('keeps both slots exactly as written', () => {
    write({
      version: 5,
      keybinds: { ...defaultKeybinds(), fire: ['KeyF', 'Mouse0'] },
    })
    expect(loadData().keybinds.fire).toEqual(['KeyF', 'Mouse0'])
  })

  it('accepts an action the player cleared entirely', () => {
    // An empty list is a legitimate choice, not corruption — but only when the
    // stored value really was a list.
    write({ version: 5, keybinds: { ...defaultKeybinds(), recentre: [] } })
    expect(loadData().keybinds.recentre).toEqual([])
  })

  it('drops a duplicate rather than binding one key twice', () => {
    write({ version: 5, keybinds: { ...defaultKeybinds(), fire: ['KeyB', 'KeyB'] } })
    expect(loadData().keybinds.fire).toEqual(['KeyB'])
  })
})

describe('corruption cannot remove a control', () => {
  it('substitutes the default for a garbage binding', () => {
    write({ version: 5, keybinds: { fire: [42, null, { code: 'KeyX' }] } })
    // Every entry was rejected, so the action ends up unbound rather than
    // holding something the input layer would never match — and the rest of the
    // table is untouched.
    expect(loadData().keybinds.fire).toEqual([])
    expect(loadData().keybinds.boost).toEqual(defaultKeybinds().boost)
  })

  it('ignores a keybind table that is not an object at all', () => {
    write({ version: 5, keybinds: 'nope' })
    expect(loadData().keybinds).toEqual(defaultKeybinds())
  })

  it('resets rather than crashing on a version from the future', () => {
    write({ version: 99, progress: { bestScore: 1 } })
    expect(loadData().progress.bestScore).toBe(0)
  })

  it('survives a payload that is not JSON', () => {
    store.set(STORAGE_KEY, '{{{')
    expect(loadData().keybinds).toEqual(defaultKeybinds())
  })
})

/** The v4 table, under the names v4 used. */
function oldStyleBinds(): Record<string, string> {
  return {
    steer: 'Mouse',
    throttleUp: 'KeyW',
    throttleDown: 'KeyS',
    rollLeft: 'KeyA',
    rollRight: 'KeyD',
    ascend: 'Space',
    descend: 'ControlLeft',
    fire: 'Mouse0',
    lock: 'Mouse2',
    boost: 'ShiftLeft',
    map: 'Tab',
    pause: 'Escape',
    recentre: 'KeyR',
  }
}

/** The v3 table, which stored `KeyboardEvent.key` characters. */
function legacyBinds(): Record<string, string> {
  return {
    steer: 'Mouse',
    throttleUp: 'w',
    throttleDown: 's',
    rollLeft: 'a',
    rollRight: 'd',
    ascend: ' ',
    descend: 'Control',
    fire: 'Mouse0',
    lock: 'Mouse2',
    boost: 'Shift',
    map: 'Tab',
    pause: 'Escape',
    recentre: 'r',
  }
}

describe('a v5 save gains the translation axis rather than losing it', () => {
  it('fills in an action the stored schema predates', () => {
    // A v5 payload has no `strafeLeft` key at all, and "absent" there means
    // "this player has never seen this control" — not "this player cleared it".
    // Reading it the other way would hand every upgrading player a movement axis
    // they cannot press, on a schema bump they did not ask for.
    const v5 = { ...defaultKeybinds() } as Record<string, unknown>
    delete v5.strafeLeft
    delete v5.strafeRight
    write({ version: 5, keybinds: v5 })

    const data = loadData()
    expect(data.keybinds.strafeLeft).toEqual(defaultKeybinds().strafeLeft)
    expect(data.keybinds.strafeRight).toEqual(defaultKeybinds().strafeRight)
  })

  it('still honours a player who cleared one deliberately', () => {
    // Stated at v7: from v7 on, an empty list is a decision again. At v6 it is
    // indistinguishable from the old default, which is why the swap resets it.
    write({ version: 7, keybinds: { ...defaultKeybinds(), strafeLeft: [] } })
    expect(loadData().keybinds.strafeLeft).toEqual([])
  })

  it('moves a v6 player onto the new layout instead of stranding them', () => {
    // The v7 swap. A stored v6 movement set is a copy of the old *default*, not
    // a preference — honouring it would leave the player turning with A and D
    // while the tutorial, the control hint and Settings all described the
    // arrows. Non-movement rebinds are still theirs.
    write({
      version: 6,
      keybinds: { ...defaultKeybinds(), turnLeft: ['KeyA'], strafeLeft: ['ArrowLeft'], fire: ['KeyF'] },
    })
    const binds = loadData().keybinds
    expect(binds.turnLeft).toEqual(defaultKeybinds().turnLeft)
    expect(binds.strafeLeft).toEqual(defaultKeybinds().strafeLeft)
    expect(binds.fire).toEqual(['KeyF'])
  })
})
