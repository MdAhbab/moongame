/**
 * Screen and run state (gameplan §11, §32.1).
 *
 * zustand holds **meta state only** — which screen is showing, which wave, the
 * run summary. It never holds simulation state. Simulation lives in plain
 * mutable objects and typed arrays, and React learns about it through a
 * throttled sync (§32.2). Putting per-frame values here would re-render every
 * subscriber sixty times a second, which is precisely the failure §17.2 exists
 * to prevent.
 */
import { create } from 'zustand'
import type { RunSummary, WaveSummary, MetaSnapshot, OutpostSnapshot } from '../game/core/readModel.ts'

/**
 * The twelve canonical states of §11, spelled exactly as the spec spells them.
 *
 * §11: "These exact names are used in all documents and in code." A
 * discriminated union rather than free strings, so an invalid screen is not
 * representable (Rule 7).
 */
export type Screen =
  | 'Boot'
  | 'Loading'
  | 'Title'
  | 'Settings'
  | 'Tutorial'
  | 'Briefing'
  | 'Playing'
  | 'Paused'
  | 'WaveClear'
  | 'LegendaryChoice'
  | 'Debrief'
  | 'Results'
  | 'Credits'
  | 'Hangar'
  | 'Profile'
  /**
   * Sign-in and cloud save. Owned by the backend track (TASK-5); the union
   * member, the router case and the entry point are scaffolded here so two
   * agents never edit `App.tsx` at the same time.
   */
  | 'Account'
  /** Replay-verified leaderboards. Same ownership note as `Account`. */
  | 'Leaderboard'

interface GameState {
  screen: Screen
  /**
   * Where Settings should return to.
   *
   * §11 requires that any state can reach Settings and that Settings always
   * returns to its caller, and that `Esc` in a submenu goes back one level
   * rather than all the way out. A stack rather than a single slot, so
   * Title → Settings → (sub-tab) unwinds correctly.
   */
  history: Screen[]

  runSeed: string
  wave: number
  waveSummary: WaveSummary | null
  runSummary: RunSummary | null

  // MetaSnapshot event-driven fields (§2.1)
  outposts: OutpostSnapshot[]
  survivingOutposts: number
  alert: string | null
  respawning: boolean
  respawnRemaining: number
  tutorialBeat: number

  /** Real terrain-bake progress in [0, 1] (§33.2). Never a timer. */
  loadProgress: number
  loadStage: string

  goto: (screen: Screen) => void
  push: (screen: Screen) => void
  back: () => void
  setRunSeed: (seed: string) => void
  setWave: (wave: number) => void
  setWaveSummary: (summary: WaveSummary | null) => void
  setRunSummary: (summary: RunSummary | null) => void
  setLoadProgress: (fraction: number, stage: string) => void
  
  // Throttle-updated from render bridge
  setMetaSnapshot: (snapshot: MetaSnapshot) => void

  toast: { tone: 'info' | 'warning'; message: string } | null
  setToast: (toast: { tone: 'info' | 'warning'; message: string } | null) => void

  /**
   * Whether the next run continues past wave 12 (§9).
   *
   * Lives here rather than on the World because the *choice* is a UI one — the
   * player makes it on the Title screen — and `App` writes it into
   * `simulation.startRun()` at the moment a run begins, exactly as it does with
   * the difficulty sliders and the equipped loadout.
   */
  endless: boolean
  setEndless: (endless: boolean) => void
}

export const useGameStore = create<GameState>((set) => ({
  screen: 'Boot',
  history: [],
  runSeed: '',
  wave: 0,
  waveSummary: null,
  runSummary: null,
  
  outposts: [],
  survivingOutposts: 8,
  alert: null,
  respawning: false,
  respawnRemaining: 0,
  tutorialBeat: -1,
  
  loadProgress: 0,
  loadStage: '',
  toast: null,
  endless: false,

  /** Replaces the current screen. Use for forward navigation. */
  goto: (screen) => set({ screen }),

  /** Enters a screen that must return to where it was opened from. */
  push: (screen) => set((state) => ({ screen, history: [...state.history, state.screen] })),

  back: () =>
    set((state) => {
      const history = state.history.slice()
      const previous = history.pop()
      return previous === undefined ? { screen: 'Title', history: [] } : { screen: previous, history }
    }),

  setRunSeed: (runSeed) => set({ runSeed }),
  setWave: (wave) => set({ wave }),
  setWaveSummary: (waveSummary) => set({ waveSummary }),
  setRunSummary: (runSummary) => set({ runSummary }),
  setLoadProgress: (loadProgress, loadStage) => set({ loadProgress, loadStage }),
  setToast: (toast) => set({ toast }),
  setEndless: (endless) => set({ endless }),
  
  /**
   * Copies the snapshot in rather than storing it.
   *
   * `projectMeta` writes into one pre-allocated `MetaSnapshot` and reuses its
   * outpost entry objects every tick, deliberately, so the 10 Hz sync costs no
   * garbage. Storing that array by reference would put a live, mutating object
   * into React state: the array identity would never change, so subscribers
   * would never re-render, and the values they *did* read would shift
   * underneath them mid-render. Cloning eight small objects ten times a second
   * is the cheap half of that trade.
   */
  setMetaSnapshot: (snapshot) =>
    set({
      wave: snapshot.wave,
      outposts: snapshot.outposts.map((o) => ({ ...o })),
      survivingOutposts: snapshot.survivingOutposts,
      alert: snapshot.alert,
      respawning: snapshot.respawning,
      respawnRemaining: snapshot.respawnRemaining,
      tutorialBeat: snapshot.tutorialBeat,
    })
}))

/**
 * True while the simulation should be advancing (§11's Sim column).
 *
 * `WaveClear` used to be in here and is not, because `App` never agreed: it
 * gates stepping on `Playing || Tutorial` directly. Two predicates for one fact,
 * disagreeing, is how the world came to run behind the untimed Debrief — a bug
 * whose fix was to stop the world on menus, and which this function then quietly
 * contradicted for anyone who read it instead of the gate.
 */
export function screenRunsSimulation(screen: Screen): boolean {
  return screen === 'Playing' || screen === 'Tutorial'
}

/**
 * True on the menus that show the attract loop behind them (§11).
 *
 * Separate from `screenRunsSimulation` because these screens advance the world
 * *without* it being a run: no enemies, no drain, no clock. The distinction
 * matters to everything downstream — the phase poll must not route from here,
 * and the HUD must not appear.
 */
export function screenAnimatesAttract(screen: Screen): boolean {
  return (
    screen === 'Title' ||
    screen === 'Hangar' ||
    screen === 'Credits' ||
    screen === 'Profile' ||
    screen === 'Leaderboard' ||
    screen === 'Account'
  )
}

/** True while the 3D scene should be mounted and rendering (§11's Render column). */
export function screenRendersScene(screen: Screen): boolean {
  return screen !== 'Boot' && screen !== 'Loading'
}
