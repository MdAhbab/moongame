// src/state/useSettingsStore.ts
import { create } from 'zustand'
import { loadData, saveData, defaultData, MAX_BINDINGS_PER_ACTION, type PersistedData, type Settings, type Progress, type Action, type Binding } from './persistence'
import { applyDisplaySettings } from './applyDisplaySettings.ts'
import type { Slot } from '../game/data/parts.ts'

interface SettingsState extends PersistedData {
  updateSettings: (updater: (prev: Settings) => Settings) => void
  updateProgress: (updater: (prev: Progress) => Progress) => void
  /**
   * Writes one slot of an action's binding list.
   *
   * `slot` is an index rather than a `'primary' | 'alternate'` flag so that the
   * store never has to know how many an action holds — the cap lives in one
   * place, in `persistence`.
   */
  setKeybind: (action: Action, slot: number, binding: Binding) => void
  /** Clears one slot. An action may legitimately end up with no bindings. */
  clearKeybind: (action: Action, slot: number) => void
  resetToDefaults: () => void
  /** Equip a part by slot id. Pass undefined to go back to stock for that slot. */
  setEquippedPart: (slot: Slot, partId: string | undefined) => void
  /** Award XP after a run and persist it. */
  addPilotXp: (xp: number) => void
  /** Select a cosmetic livery. Unknown ids are rejected by the loader on reload. */
  setSkin: (skinId: string) => void
  /** Marks an achievement earned. Idempotent — an already-earned one is a no-op. */
  unlockAchievement: (key: keyof Progress['achievements']) => void
  /** Choose the world the next run is flown over. */
  setWorld: (worldId: string) => void
  /** Set continuous tuning offset for a part slot in [-1, 1]. */
  setPartTuning: (slot: Slot, value: number) => void
  /** Add credits from run dividends/bounties. */
  addCredits: (amount: number) => void
  /** Spend credits on a part upgrade. */
  spendCredits: (amount: number) => boolean
  /** Unlock a part in the store permanently. */
  unlockPart: (partId: string) => void
}

const initialData = loadData()

export const useSettingsStore = create<SettingsState>((set) => ({
  ...initialData,
  
  updateSettings: (updater) => set((state) => {
    const newSettings = updater(state.settings)
    const newData = { ...state, settings: newSettings }
    saveData(newData)
    applyDisplaySettings(newSettings)
    return { settings: newSettings }
  }),
  
  updateProgress: (updater) => set((state) => {
    const newProgress = updater(state.progress)
    const newData = { ...state, progress: newProgress }
    saveData(newData)
    return { progress: newProgress }
  }),
  
  setKeybind: (action, slot, binding) => set((state) => {
    const next = state.keybinds[action].slice(0, MAX_BINDINGS_PER_ACTION)
    // Binding a key that this action already holds in the other slot would give
    // it the same key twice and quietly cost the player their alternate.
    const duplicate = next.indexOf(binding)
    if (duplicate >= 0 && duplicate !== slot) next.splice(duplicate, 1)
    while (next.length < Math.min(slot, MAX_BINDINGS_PER_ACTION - 1)) next.push('')
    next[Math.min(slot, MAX_BINDINGS_PER_ACTION - 1)] = binding

    const newKeybinds = { ...state.keybinds, [action]: next.filter((entry) => entry !== '') }
    const newData = { ...state, keybinds: newKeybinds }
    saveData(newData)
    return { keybinds: newKeybinds }
  }),

  clearKeybind: (action, slot) => set((state) => {
    const next = state.keybinds[action].filter((_, index) => index !== slot)
    const newKeybinds = { ...state.keybinds, [action]: next }
    const newData = { ...state, keybinds: newKeybinds }
    saveData(newData)
    return { keybinds: newKeybinds }
  }),
  
  resetToDefaults: () => {
    saveData(defaultData)
    applyDisplaySettings(defaultData.settings)
    set({ ...defaultData })
  },

  setEquippedPart: (slot, partId) =>
    set((state) => {
      const next = { ...state.progress.equippedLoadout }
      if (partId === undefined) {
        delete next[slot]
      } else {
        next[slot] = partId
      }
      const newProgress = { ...state.progress, equippedLoadout: next }
      const newData = { ...state, progress: newProgress }
      saveData(newData)
      return { progress: newProgress }
    }),

  setPartTuning: (slot, value) =>
    set((state) => {
      const clamped = Math.max(-1, Math.min(1, value))
      const nextTuning = { ...state.progress.partTuning, [slot]: clamped }
      const newProgress = { ...state.progress, partTuning: nextTuning }
      const newData = { ...state, progress: newProgress }
      saveData(newData)
      return { progress: newProgress }
    }),

  addCredits: (amount) =>
    set((state) => {
      const newCredits = Math.max(0, state.progress.credits + amount)
      const newProgress = { ...state.progress, credits: newCredits }
      const newData = { ...state, progress: newProgress }
      saveData(newData)
      return { progress: newProgress }
    }),

  spendCredits: (amount) => {
    let success = false
    set((state) => {
      if (state.progress.credits >= amount) {
        success = true
        const newProgress = { ...state.progress, credits: state.progress.credits - amount }
        saveData({ ...state, progress: newProgress })
        return { progress: newProgress }
      }
      return {}
    })
    return success
  },

  unlockPart: (partId) =>
    set((state) => {
      if (state.progress.unlockedParts.includes(partId)) return {}
      const newUnlocked = [...state.progress.unlockedParts, partId]
      const newProgress = { ...state.progress, unlockedParts: newUnlocked }
      const newData = { ...state, progress: newProgress }
      saveData(newData)
      return { progress: newProgress }
    }),

  addPilotXp: (xp) =>
    set((state) => {
      const newProgress = { ...state.progress, pilotXp: state.progress.pilotXp + xp }
      const newData = { ...state, progress: newProgress }
      saveData(newData)
      return { progress: newProgress }
    }),

  setWorld: (worldId) =>
    set((state) => {
      const newProgress = { ...state.progress, worldId }
      saveData({ ...state, progress: newProgress })
      return { progress: newProgress }
    }),

  setSkin: (skinId) =>
    set((state) => {
      const newProgress = { ...state.progress, skinId }
      const newData = { ...state, progress: newProgress }
      saveData(newData)
      return { progress: newProgress }
    }),

  unlockAchievement: (key) =>
    set((state) => {
      if (state.progress.achievements[key]) return {}
      const newProgress = {
        ...state.progress,
        achievements: { ...state.progress.achievements, [key]: true },
      }
      const newData = { ...state, progress: newProgress }
      saveData(newData)
      return { progress: newProgress }
    }),
}))
