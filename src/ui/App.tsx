/**
 * The application root — where the simulation, the scene and the HUD meet
 * (gameplan §11, §31.3, §32.2).
 *
 * Responsibilities, and nothing else:
 *
 *  1. Own the single `Simulation` for the run.
 *  2. Mount the 3D scene, which owns the only `useFrame` (§17.2).
 *  3. Route between the twelve canonical screens of §11.
 *  4. Project the simulation into the HUD once per frame.
 *
 * **This component must not re-render during Playing.** It subscribes to the
 * screen and nothing else. Per-frame values are projected into pre-allocated
 * buffers and written straight to DOM refs inside the render bridge's frame
 * callback — never through state (§17.2, §32.2).
 */
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Simulation, makeRunSeed } from '../game/core/Simulation.ts'
import { hashString } from '../game/core/Random.ts'
import { bindDeviceInput, releasePointer } from '../platform/deviceInput.ts'
import { HapticsDirector } from '../platform/haptics.ts'
import type { TerrainProgress } from '../workers/terrainWorker.ts'
import { warn } from '../debug/logger.ts'
import { Suspense, lazy } from 'react'
import { createHudFrame, createMapMarkers, createMarkers, createMetaSnapshot } from '../game/core/readModel.ts'
import { projectHudFrame, projectMap, projectMarkers, projectMeta } from '../game/systems/HudSystem.ts'
import { useGameStore, screenAnimatesAttract, screenRendersScene, screenRunsSimulation } from '../state/useGameStore.ts'
import { useSettingsStore } from '../state/useSettingsStore.ts'
import { hudRefs, writeHud, writeMap } from '../state/hudRefs.ts'
const Canvas = lazy(() => import('../render/Canvas.tsx').then(m => ({ default: m.Canvas })))
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { LiveRegion } from './a11y/LiveRegion.tsx'
import { Toast } from './components/ui.tsx'
import { FrameTimeMonitor } from '../game/core/Clock.ts'

import { BootScreen } from './screens/BootScreen.tsx'
import { LoadingScreen } from './screens/LoadingScreen.tsx'
import { TitleScreen } from './screens/TitleScreen.tsx'
import { SettingsScreen } from './screens/SettingsScreen.tsx'
import { TutorialScreen } from './screens/TutorialScreen.tsx'
import { BriefingScreen } from './screens/BriefingScreen.tsx'
import { PlayingScreen } from './screens/PlayingScreen.tsx'
import { PausedScreen } from './screens/PausedScreen.tsx'
import { WaveClearScreen } from './screens/WaveClearScreen.tsx'
import { LegendaryChoiceScreen } from './screens/LegendaryChoiceScreen.tsx'
import { DebriefScreen } from './screens/DebriefScreen.tsx'
import { ResultsScreen } from './screens/ResultsScreen.tsx'
import { CreditsScreen } from './screens/CreditsScreen.tsx'
import { HangarScreen } from './screens/HangarScreen.tsx'
import { ProfileScreen } from './screens/ProfileScreen.tsx'
import { AccountScreen } from './screens/AccountScreen.tsx'
import { LeaderboardScreen } from './screens/LeaderboardScreen.tsx'
import { defaultWorld, worldById } from '../game/data/worlds.ts'
import { encodeReplay } from '../game/core/InputRecorder.ts'
import { cloudAvailable, getAccount, submitScore } from '../net/apiClient.ts'
import { AudioDirector } from '../audio/index.ts'
import { registerUiAudio } from '../audio/uiBus.ts'
import { resolveInitialTier, type QualityTier } from '../render/qualityTier.ts'

/** §32.2 — event-driven state syncs at 10 Hz. Per-frame values never come here. */
const META_SYNC_INTERVAL = 0.1

/**
 * The p95 frame time above which the renderer drops a quality tier (§17.6).
 *
 * 33.3 ms is two missed frames at 60 Hz — the point where the stutter is
 * unambiguous rather than a scheduling blip. Deliberately not the 16.7 ms
 * budget itself: shedding quality the first time a frame runs long would make
 * the game look worse on hardware that was coping.
 */
const FRAME_BUDGET_MS = 33.3

/**
 * A frame so slow that waiting for statistics is itself the bug (§17.6).
 *
 * 120 ms is under 9 fps — long past "stuttering" and into "the input the player
 * just gave will be acted on next week". The windowed p95 test below is the
 * right instrument for marginal stutter and completely the wrong one here: at
 * the 1.4 fps a phone was measured at on High tier, a 180-frame window takes
 * over two minutes to fill, and filling it drops exactly one tier.
 *
 * So anything this far out of budget skips the statistics entirely.
 */
const FRAME_EMERGENCY_MS = 120

/**
 * Consecutive emergency frames before dropping. Small, because the whole point
 * is speed — but not one, because the first frame after a tab regains focus,
 * a shader compiles or a wave spawns in is legitimately slow and recovers on
 * its own. Three in a row is a device that cannot draw this scene.
 */
const FRAME_EMERGENCY_STREAK = 3

/** How long a transient toast stays up before dismissing itself. */
const TOAST_DURATION_MS = 5000

/**
 * Submits a finished run to the replay-verified leaderboard.
 *
 * Fire-and-forget. Failure is a toast, not a block: the leaderboard is a
 * bonus on top of a game that is complete without it, and a network fault
 * must not delay the Debrief. Success is still the only claim worth naming
 * as verified, because a rank the server replayed is a different claim from
 * a number the client asserted.
 *
 * Sends `encodeReplay`'s packed form rather than the JSON: run-length encoding
 * does almost nothing for a mouse player — the virtual stick decays
 * continuously, so the quantised axis changes on most steps — and a twelve-wave
 * run is ~14k frames, which is megabytes as JSON and ~74 KB packed.
 *
 * Only completed runs go up. An abort ends a run honestly, but a leaderboard of
 * runs somebody quit is noise.
 */
function submitRun(simulation: Simulation, finalScore: number): void {
  const replay = simulation.buildReplay()
  if (replay === null || finalScore <= 0) return

  void (async () => {
    try {
      // Both are cheap: the availability probe is cached for the session, and
      // the account call is the same request the Account screen makes.
      if (!(await cloudAvailable())) return
      if ((await getAccount()) === null) return

      const result = await submitScore({
        seed:         replay.seed,
        simVersion:   replay.simVersion,
        inputLog:     encodeReplay(replay),
        claimedScore: finalScore,
        // From the replay, not from the store. The store is what is equipped
        // *now*; the replay is what was flown, and a player who changes parts on
        // the Debrief screen must not invalidate the run they just finished.
        worldId:      replay.context.worldId,
        equipped:     replay.context.equipped,
        endless:      replay.endless,
      })
      useGameStore.getState().setToast({
        tone:    'info',
        message: result.personalBest
          ? `Run verified — rank ${String(result.rank)}, a personal best.`
          : `Run verified — rank ${String(result.rank)}.`,
      })
    } catch {
      useGameStore.getState().setToast({
        tone: 'warning',
        message: 'Could not verify this run. The score is still yours locally.',
      })
    }
  })()
}

function Router({
  onAbort,
  simulation,
}: {
  onAbort: () => void
  simulation: Simulation
}): React.JSX.Element {
  const screen = useGameStore((s) => s.screen)

  switch (screen) {
    case 'Boot':
      return <BootScreen />
    case 'Loading':
      return <LoadingScreen />
    case 'Title':
      return <TitleScreen />
    case 'Settings':
      return <SettingsScreen />
    case 'Tutorial':
      return <TutorialScreen />
    case 'Briefing':
      return <BriefingScreen />
    case 'Playing':
      return <PlayingScreen />
    case 'Paused':
      return <PausedScreen onAbort={onAbort} />
    case 'LegendaryChoice':
      return (
        <LegendaryChoiceScreen
          offer={simulation.world.legendaryOffer}
          onResolve={(perkId) => {
            simulation.resolveLegendary(perkId)
          }}
        />
      )
    case 'WaveClear':
      return (
        <WaveClearScreen
          activePerks={simulation.world.activePerks}
          onSelectPerk={(perkId) => {
            // Perks persist for the whole run and nothing stacks, so a card is
            // takeable exactly once. The drone bay used to be the exception; it
            // is an ability on a key now.
            simulation.selectPerk(perkId)
          }}
        />
      )
    case 'Debrief':
      return <DebriefScreen />
    case 'Results':
      return <ResultsScreen />
    case 'Credits':
      return <CreditsScreen />
    case 'Hangar':
      return <HangarScreen />
    case 'Profile':
      return <ProfileScreen />
    case 'Account':
      return <AccountScreen />
    case 'Leaderboard':
      return <LeaderboardScreen />
    default:
      return <TitleScreen />
  }
}

export function App(): React.JSX.Element {
  const screen = useGameStore((s) => s.screen)
  const setRunSeed = useGameStore((s) => s.setRunSeed)
  const setMetaSnapshot = useGameStore((s) => s.setMetaSnapshot)
  const toast = useGameStore((s) => s.toast)
  const setToast = useGameStore((s) => s.setToast)

  const skinId = useSettingsStore((s) => s.progress.skinId)
  const worldId = useSettingsStore((s) => s.progress.worldId)
  const activeWorld = useMemo(() => worldById(worldId) ?? defaultWorld(), [worldId])
  const qualitySetting = useSettingsStore((s) => s.settings.display.quality)
  /**
   * §10.5 — read here and passed down, because the scene must not subscribe.
   *
   * The camera rig has accepted this since it was written; the render bridge
   * passed a hardcoded `false` under a comment saying it "would come from
   * settings". So the trauma shake — the most motion-sickness-inducing effect in
   * the game — ignored the one setting that exists to turn it off.
   */
  const reducedMotion = useSettingsStore((s) => s.settings.accessibility.reducedMotion)
  /**
   * The starting quality tier (§17.6).
   *
   * `resolveInitialTier` is where the device gets a say. It used to be
   * `qualitySetting === 'high' ? 'High' : 'Low'` against a setting that shipped
   * defaulted to `'high'`, so **every device started on High** — and High on a
   * phone was measured at 1.4 fps against Low's 30 on the same handset, with no
   * CPU throttling involved. That is fill rate: a 1.38-megapixel backbuffer, a
   * full-resolution bloom, god rays and a 2048² shadow map.
   *
   * Computed lazily so the WebGL probe inside detection runs once, at mount,
   * rather than on every render of this component.
   */
  const [tier, setTier] = useState<QualityTier>(() => resolveInitialTier(qualitySetting))

  useEffect(() => {
    setTier(resolveInitialTier(qualitySetting))
  }, [qualitySetting])

  const monitorRef = useRef<FrameTimeMonitor | null>(null)
  if (monitorRef.current === null) {
    monitorRef.current = new FrameTimeMonitor(180)
  }
  const monitor = monitorRef.current
  /**
   * Consecutive frames over `FRAME_EMERGENCY_MS`, for the fast path below.
   *
   * The 180-frame window is the right instrument for *marginal* stutter and the
   * wrong one for a device that cannot draw the scene at all: at 1.4 fps a
   * window takes over two minutes to fill, and it drops one tier when it does.
   * Reaching Low from High that way is four minutes of slideshow, which is
   * several minutes after the player has closed the tab.
   */
  const emergencyRef = useRef(0)
  const lastFrameTimeRef = useRef<number>(0)
  const mapWasOpenRef = useRef(false)

  useEffect(() => {
    if (screen === 'Playing') {
      monitor.reset()
      lastFrameTimeRef.current = 0
    }
  }, [screen, monitor])

  /**
   * The simulation lives in a ref, created once.
   *
   * Holding it in state would remount the scene on every wave — rebuilding the
   * moon, the star field and all eight outposts twelve times a run — which is
   * exactly what the UI Builder prototype did with a changing `key`, while
   * disposing none of it.
   */
  const simulationRef = useRef<Simulation | null>(null)
  if (simulationRef.current === null) {
    simulationRef.current = new Simulation(makeRunSeed(Math.floor(Date.now() % 0xffffffff)))
  }
  const simulation = simulationRef.current

  /**
   * A handle on the running world, in development only.
   *
   * The simulation is deliberately unreachable from anywhere but this component,
   * which is right for the shipped game and miserable for diagnosing "the key
   * does nothing": there is no way to ask whether the input arrived, whether the
   * step saw it, or what the craft did with it. Guarded by `import.meta.env.DEV`,
   * so the production bundle has no such handle and nothing to attack.
   */
  if (import.meta.env.DEV) {
    ;(globalThis as unknown as { __mareNoctis?: unknown }).__mareNoctis = simulation
  }

  const audioDirectorRef = useRef<AudioDirector | null>(null)
  if (audioDirectorRef.current === null) {
    audioDirectorRef.current = new AudioDirector()
  }
  const audioDirector = audioDirectorRef.current

  /**
   * Rumble, on the same footing as audio: a third feedback channel that reads
   * the world and never writes to it. Created once; a player with no gamepad
   * pays nothing for it.
   */
  const hapticsRef = useRef<HapticsDirector | null>(null)
  if (hapticsRef.current === null) {
    hapticsRef.current = new HapticsDirector()
  }
  const haptics = hapticsRef.current

  /**
   * Baked terrain maps, held in a ref rather than state.
   *
   * They arrive once, and putting an `ImageBitmap` triple into React state
   * would re-render the whole tree at the moment the scene mounts.
   */
  const terrainRef = useRef<{ albedo: ImageBitmap; normal: ImageBitmap; ao: ImageBitmap } | null>(null)
  /** The world the current maps were baked for, so a re-bake happens once. */
  const bakedWorldRef = useRef<string | null>(null)
  /** Bumps when new maps land so Canvas sees them without putting bitmaps in state. */
  const [terrainEpoch, setTerrainEpoch] = useState(0)

  /** Pre-allocated read-model buffers. Created once, mutated in place (Rule 3). */
  const buffers = useMemo(
    () => ({
      hud: createHudFrame(),
      markers: createMarkers(),
      map: createMapMarkers(),
      meta: createMetaSnapshot(),
      metaAccumulator: 0,
    }),
    [],
  )

  useEffect(() => {
    setRunSeed(simulation.world.runSeed)
  }, [simulation, setRunSeed])

  /** Binds keyboard, mouse, gamepad and pointer lock to the simulation (§8). */
  useEffect(() => {
    return bindDeviceInput(simulation)
  }, [simulation])

  /**
   * The one path by which real time reaches the world.
   *
   * Handed to the render bridge so that its single `useFrame` drives the
   * `Simulation` rather than calling `stepWorld` behind its back — which is
   * what silently bypassed `sampleInput` and made the game ignore every
   * control the player touched.
   */
  const advanceSimulation = useCallback((delta: number) => simulation.advance(delta), [simulation])

  /**
   * Ends the run from the pause menu and shows the player what they achieved.
   *
   * The summaries are captured here, before navigating, because `ResultsScreen`
   * renders entirely from `runSummary` — and an abort that navigated without
   * producing one is exactly how that screen came to render as a blank, buttonless
   * overlay with the game still running behind it.
   */
  const abortRun = useCallback(() => {
    simulation.abortRun()
    const store = useGameStore.getState()
    store.setWaveSummary(simulation.captureWaveSummary())
    store.setRunSummary(simulation.buildRunSummary())
    store.goto('Results')
  }, [simulation])

  /**
   * Cuts every sounding voice when a run ends.
   *
   * `AudioDirector.reset()` has always existed, with a docstring promising it
   * runs "for run restarts and hard screen changes, where the alternative is the
   * previous run's explosion ringing out over the Title screen". **Nothing ever
   * called it.** The Title screen is the one place a run is torn down — see
   * `resetRun` below — so it is the one place the tail of that run has to be
   * cut, along with the duck the last critical alert left in the mix.
   *
   * The continuous voices are released by `update`'s `live` gate a frame later
   * anyway; what this adds is the *one-shots* already in flight, which a gate
   * cannot reach because they are scheduled ahead on the audio clock.
   */
  useEffect(() => {
    if (screen === 'Title') audioDirector.reset()
  }, [screen, audioDirector])

  /**
   * Discards accumulated time whenever the world stops.
   *
   * The bridge used to reset its own accumulator on the frames it skipped.
   * Now that the `Simulation` owns the clock, the reset has to happen where the
   * decision is made, or an unpaused game would replay the whole pause as a
   * catch-up burst of substeps.
   */
  useEffect(() => {
    if (screen !== 'Playing' && screen !== 'Tutorial') simulation.resetAccumulator()
  }, [screen, simulation])

  /**
   * Hands the cursor back whenever play stops.
   *
   * Without this the pointer stays locked over the pause menu and the Debrief,
   * so the player can see the buttons and cannot click them.
   */
  useEffect(() => {
    if (screen !== 'Playing' && screen !== 'Tutorial') releasePointer()
  }, [screen])

  /** Toasts are transient by definition; nothing else should have to clear them. */
  useEffect(() => {
    if (toast === null) return
    const timer = setTimeout(() => { setToast(null) }, TOAST_DURATION_MS)
    return () => { clearTimeout(timer) }
  }, [toast, setToast])

  /** Synchonises settings to the mutable world simulation (§10) and audio system. */
  useEffect(() => {
    return useSettingsStore.subscribe((state) => {
      const acc = state.settings.accessibility
      simulation.world.difficulty.aimAssist = acc.aimAssist / 100
      simulation.world.difficulty.enemyDamage = acc.enemyDamage / 100
      simulation.world.difficulty.drainRate = acc.drainRate / 100
      simulation.world.difficulty.enemySpeed = acc.enemySpeed / 100
      if (!acc.ddaEnabled) simulation.world.ddaFactor = 1.0

      // Rumble follows reduced motion. A player who has asked the system to
      // stop moving things has not asked for the controller to shake instead.
      haptics.setEnabled(!acc.reducedMotion)

      const aud = state.settings.audio
      audioDirector.engine.setMasterVolume(aud.master / 100)
      audioDirector.engine.setSfxVolume(aud.sfx / 100)
      audioDirector.engine.setUiVolume(aud.ui / 100)
      audioDirector.engine.setMusicVolume(aud.music / 100)
    })
  }, [simulation, audioDirector.engine, haptics])

  /**
   * Arms the buttons.
   *
   * The director is owned by the ref above and reachable from nowhere else, so
   * without this every button in the game is silent — which is how it shipped.
   * Cleared on teardown so StrictMode's remount and the ErrorBoundary's "Try
   * again" cannot leave the bus pointing at a director whose `AudioContext` has
   * already been replaced.
   */
  useEffect(() => {
    registerUiAudio(audioDirector)
    return () => { registerUiAudio(null) }
  }, [audioDirector])

  /** Initialize AudioContext on first interaction */
  useEffect(() => {
    const initAudio = () => {
      audioDirector.unlock()
      
      // Seed initial volume
      const aud = useSettingsStore.getState().settings.audio
      audioDirector.engine.setMasterVolume(aud.master / 100)
      audioDirector.engine.setSfxVolume(aud.sfx / 100)
      audioDirector.engine.setUiVolume(aud.ui / 100)
      audioDirector.engine.setMusicVolume(aud.music / 100)

      document.removeEventListener('click', initAudio)
      document.removeEventListener('keydown', initAudio)
      document.removeEventListener('touchstart', initAudio)
    }
    document.addEventListener('click', initAudio)
    document.addEventListener('keydown', initAudio)
    document.addEventListener('touchstart', initAudio)
    return () => {
      document.removeEventListener('click', initAudio)
      document.removeEventListener('keydown', initAudio)
      document.removeEventListener('touchstart', initAudio)
    }
  }, [audioDirector])

  /**
   * Bakes the terrain maps, then opens the Title screen (§33.2).
   *
   * Progress reported here is the worker's real stage callbacks, which is what
   * lets `LoadingScreen` be honest — Persona A's stated frustration is "loading
   * screens with no progress", and a fake bar is worse than none.
   *
   * A worker failure is *not* fatal. The moon renders untextured, which is
   * ugly, but Rule 10's principle holds: nothing should stop someone playing.
   *
   * `bakedWorldRef` is set only on success. Setting it at the start of the bake
   * meant a failed worker marked the world as done forever, and Hangar could
   * never retry. Old ImageBitmaps are closed only after the new ones land, so
   * a swap never shows a bare sphere.
   */
  useEffect(() => {
    const isBoot = screen === 'Loading'
    if (!isBoot && bakedWorldRef.current === activeWorld.id) return

    const store = useGameStore.getState()
    let cancelled = false
    let worker: Worker | null = null

    const finish = (): void => {
      if (cancelled) return
      if (!isBoot) return
      store.setLoadProgress(1, 'READY')
      useGameStore.getState().goto('Title')
    }

    const closeMaps = (maps: { albedo: ImageBitmap; normal: ImageBitmap; ao: ImageBitmap } | null): void => {
      if (maps === null) return
      maps.albedo.close()
      maps.normal.close()
      maps.ao.close()
    }

    try {
      worker = new Worker(new URL('../workers/terrainWorker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<TerrainProgress>): void => {
        if (cancelled) return
        const message = event.data
        if (message.type === 'progress') {
          if (!isBoot) return
          const stageIndex = message.stage === 'albedo' ? 0 : message.stage === 'normal' ? 1 : 2
          store.setLoadProgress((stageIndex + message.fraction) / 3, message.stage.toUpperCase())
        } else if (message.type === 'done') {
          const previous = terrainRef.current
          terrainRef.current = { albedo: message.albedo, normal: message.normal, ao: message.ao }
          bakedWorldRef.current = activeWorld.id
          closeMaps(previous)
          setTerrainEpoch((n) => n + 1)
          finish()
        } else {
          warn('Terrain bake failed; continuing untextured', message.message)
          finish()
        }
      }
      worker.onerror = (event) => {
        warn('Terrain worker error; continuing untextured', event.message)
        finish()
      }
      const bakeTier: 'High' | 'Medium' | 'Low' = qualitySetting === 'high' ? 'High' : 'Low'
      worker.postMessage({
        seed: hashString(simulation.world.runSeed),
        tier: bakeTier,
        terrain: activeWorld.terrain,
        palette: activeWorld.palette,
      })
    } catch (error) {
      warn('Could not start the terrain worker; continuing untextured', error)
      finish()
    }

    return () => {
      cancelled = true
      worker?.terminate()
    }
  }, [screen, simulation, activeWorld, qualitySetting])

  /**
   * Whether the world is allowed to advance.
   *
   * Only while the player is actually looking at it. Menus freeze the world
   * rather than letting it run on behind them — the Debrief in particular is
   * untimed, and a world that keeps ticking there spawns the next wave into an
   * empty room.
   *
   * Taken from `screenRunsSimulation` rather than spelled out again here. It was
   * spelled out here, and the two disagreed — the predicate said `WaveClear`
   * also runs, this gate said it does not — which is how §11's Sim column came
   * to have two contradictory implementations, one of which nothing called.
   *
   * Declared above `onFrame` because the audio director needs it too: the frame
   * callback runs on every screen that mounts the canvas, but the world only
   * moves on some of them, and the continuous voices have to know the difference
   * (see `AudioDirector.update`).
   */
  const stepping = screenRunsSimulation(screen) || screenAnimatesAttract(screen)

  /**
   * Called at the end of the render bridge's `useFrame`, after the world has
   * been stepped and the instance buffers written.
   *
   * `writeHud` mutates DOM nodes directly. Nothing here calls `setState`, which
   * is why Playing records zero re-renders (§37.6). The 10 Hz meta sync is the
   * one path that reaches React, and it carries only event-driven values.
   *
   * @hot-path
   */
  const onFrame = useCallback(
    (_alpha: number) => {
      const world = simulation.world

      // Real elapsed time, not an assumed 60 Hz.
      //
      // Everything downstream of this callback is wall-clock work — the 10 Hz
      // meta sync and the audio director's envelopes — and feeding it a
      // hardcoded 1/60 makes both run 2.4× slow on a 144 Hz display and fast on
      // a 30 Hz one. That is Rule 5's failure mode arriving through the back
      // door, in the one layer that is actually allowed to read a clock.
      const now = performance.now()
      const frameMs = lastFrameTimeRef.current > 0 ? now - lastFrameTimeRef.current : 1000 / 60
      lastFrameTimeRef.current = now
      // A backgrounded tab returns a delta of seconds. Clamp, or the audio
      // director advances its envelopes through a gap the player never saw.
      const frameSeconds = Math.min(frameMs, 100) / 1000

      projectHudFrame(world, buffers.hud)
      projectMarkers(world, buffers.markers)
      writeHud(buffers.hud, buffers.markers)

      // The map is a held overlay, so it only costs anything while it is up.
      if (hudRefs.mapOpen || mapWasOpenRef.current) {
        if (hudRefs.mapOpen) projectMap(world, buffers.map)
        writeMap(buffers.map)
        // One extra pass after closing, so the fade-out runs against a hidden
        // root rather than leaving the last frame's symbols frozen on screen.
        mapWasOpenRef.current = hudRefs.mapOpen
      }

      buffers.metaAccumulator += frameSeconds
      if (buffers.metaAccumulator >= META_SYNC_INTERVAL) {
        buffers.metaAccumulator = 0
        projectMeta(world, buffers.meta)
        setMetaSnapshot(buffers.meta)
      }

      // `stepping` rather than an assumed true: a frozen world must not be
      // sonified as a moving one. Without it the engine roars on at the last
      // cruise velocity over WaveClear, Paused, Debrief and Results, and a lock
      // caught mid-acquisition drones on one pitch until the player clicks
      // through.
      audioDirector.update(world, frameSeconds, stepping)
      haptics.update(world)

      // Consumers have had their look; clear so the next frame starts empty.
      world.events.clear()

      // ---- adaptive quality ----
      //
      // The one place this callback is allowed to reach React, and it does so at
      // most twice per run: a downgrade is a discrete event, not a per-frame
      // value, so it belongs in state by the same §32.2 rule that keeps hull and
      // heat out of it. Gated on p95 rather than the mean because a mean hides
      // exactly the stutter the player feels, and on a full window so a single
      // slow frame during wave spawn-in cannot trigger it.
      //
      // Only on `'auto'`. `'low'` and `'high'` are the player overruling
      // detection, and a setting the game quietly undoes is not a setting: a
      // player who picks High on a phone to see the bloom got three slow frames
      // and a toast telling them it had been taken away again, with no way to
      // insist. Auto adapts; an explicit choice is honoured until they change
      // it. Same rule as `resolveInitialTier`, which is where they disagreed.
      if (screen === 'Playing' && tier !== 'Low' && qualitySetting === 'auto') {
        // Fast path: catastrophically slow frames drop straight to Low rather
        // than stepping down one tier per window. A device drawing at 1.4 fps
        // is not going to be rescued by Medium, and making it prove that
        // through another two-minute window is the difference between a game
        // that recovers in half a second and one the player has already left.
        if (frameMs > FRAME_EMERGENCY_MS) {
          emergencyRef.current++
          if (emergencyRef.current >= FRAME_EMERGENCY_STREAK) {
            emergencyRef.current = 0
            monitor.reset()
            setTier('Low')
            setToast({ tone: 'warning', message: 'Frame rate is very low — graphics reduced to Low.' })
          }
        } else {
          emergencyRef.current = 0
        }

        monitor.push(frameMs)
        if (monitor.full) {
          if (monitor.p95 > FRAME_BUDGET_MS) {
            const next = tier === 'High' ? 'Medium' : 'Low'
            setTier(next)
            setToast({ tone: 'warning', message: `Frame rate is low — graphics reduced to ${next}.` })
          }
          monitor.reset()
        }
      }
    },
    [simulation, buffers, setMetaSnapshot, audioDirector, haptics, tier, screen, setToast, monitor, stepping, qualitySetting],
  )

  /**
   * Maps screen transitions onto the run's lifecycle.
   *
   * The router and the simulation are separate state machines on purpose — one
   * is what the player is looking at, the other is what the world is doing —
   * but something has to marry them, and this is that seam. Without it the
   * screens navigate perfectly while the world never starts a wave.
   */
  useEffect(() => {
    if (screen === 'Briefing') {
      // The run's physical context — which world, which parts — in one call.
      //
      // This used to be four lines here that resolved the loadout and copied the
      // environment across by hand. The verifier had no equivalent, so it
      // replayed every run under Luna gravity with stock parts and rejected any
      // honest run flown otherwise. One method now serves both callers; see
      // `Simulation.applyRunContext`.
      simulation.applyRunContext({
        worldId:  useSettingsStore.getState().progress.worldId,
        equipped: useSettingsStore.getState().progress.equippedLoadout,
      })

      const phase = simulation.world.phase
      // `RunOver` is included as a belt-and-braces case: the Title screen resets
      // the run on the way past, so a finished world should never reach here.
      // If one ever does, starting a fresh run is the only sane reading of
      // "the player pressed Start" — the alternative is what used to happen,
      // which was a Briefing for a run that was already over.
      if (simulation.world.wave.number === 0 || phase.kind === 'RunOver') {
        simulation.startRun(useGameStore.getState().endless)
      } else if (phase.kind === 'WaveClear') {
        // The world is parked on the cleared wave because stepping is gated on
        // the screen, so nothing advanced it while the player read the Debrief.
        // Advancing here is what makes "continue" mean continue.
        simulation.advanceWave()
      }
      useGameStore.getState().setWave(simulation.world.wave.number)
    } else if (screen === 'Tutorial') {
      if (simulation.world.wave.number === 0) simulation.startTutorial()
      simulation.skipBriefing()
      simulation.resetAccumulator()
    } else if (screen === 'Playing') {
      simulation.skipBriefing()
      simulation.resetAccumulator()
    } else if (screen === 'Title') {
      // The Title screen is where a run ends, whatever ended it — victory,
      // defeat, abort, or backing out of the tutorial. Resetting here rather
      // than at each of those exits means there is one place that has to be
      // right, instead of five that all have to be remembered.
      //
      // Without it the game was single-use per page load: `startRun` only fires
      // when `wave.number === 0`, so the second "START RUN" of a session found a
      // world parked on `RunOver` with its outposts still in ruins, and bounced
      // the player straight back to the Debrief for a run they never flew.
      simulation.resetRun()
      simulation.enterAttract()
    } else if (screen === 'Paused' || screen === 'Settings') {
      // §11 — the accumulator is reset on resume, so unpausing never produces
      // a catch-up burst of queued substeps.
      simulation.resetAccumulator()
    }
  }, [screen, simulation, worldId])

  /**
   * Seed of the run already submitted to the leaderboard.
   *
   * A seed rather than a boolean, because a new run brings a new seed and the
   * guard resets itself. The 4 Hz poller below can observe `RunOver` more than
   * once — routing away tears down its interval, but not before the next tick
   * can land — and a run must be submitted exactly once.
   */
  const submittedSeed = useRef<string | null>(null)

  /**
   * Watches the simulation's own phase and routes when the world decides
   * something has ended.
   *
   * Polled at 4 Hz rather than pushed from the frame callback, because routing
   * is a React state change and the frame callback is the one path that must
   * never touch React (§17.2).
   */
  useEffect(() => {
    if (screen !== 'Playing' && screen !== 'Tutorial') return

    const id = window.setInterval(() => {
      const phase = simulation.world.phase
      const store = useGameStore.getState()

      // The tutorial ends when the player has demonstrated all three verbs —
      // and it has to end *somewhere*. It previously did not: reaching the third
      // gate incremented the beat past the last card and left the player flying
      // in a world with nothing in it and no indication they had finished.
      if (screen === 'Tutorial') {
        if (simulation.tutorialComplete) {
          useSettingsStore.getState().updateProgress((p) => ({ ...p, tutorialCompleted: true }))
          store.setToast({ tone: 'info', message: 'Training complete. You can fly, shoot and defend — the campaign is open.' })
          store.goto('Title')
        }
        return
      }

      // A pending salvage offer outranks everything: it is posted the instant
      // the respawn completes, and the world is frozen behind it until the
      // player answers.
      if (simulation.world.legendaryOffer.length > 0 && screen === 'Playing') {
        store.goto('LegendaryChoice')
      } else if (phase.kind === 'WaveClear') {
        store.setWaveSummary(simulation.captureWaveSummary())
        store.goto('WaveClear')
      } else if (phase.kind === 'RunOver') {
        store.setWaveSummary(simulation.captureWaveSummary())
        const summary = simulation.buildRunSummary()
        store.setRunSummary(summary)
        if (submittedSeed.current !== summary.seed) {
          submittedSeed.current = summary.seed
          submitRun(simulation, summary.finalScore)
        }
        store.goto(phase.victory ? 'Results' : 'Debrief')
      }
    }, 250)

    return () => window.clearInterval(id)
  }, [screen, simulation])

  /**
   * §11 — the scene stays mounted behind menus, so the Title screen has a live
   * moon and returning from Settings does not tear down and rebuild the WebGL
   * context. Only Boot and Loading render without it.
   */
  const showScene = screenRendersScene(screen)

  /**
   * Escape backs out of a menu. **This is the only handler for it.**
   *
   * There were three: this one, `PausedScreen`'s, and the `pause` binding in
   * the input layer — all on `window`, all firing on the same keystroke, each
   * reading the state the previous one had just written. Pressing Escape during
   * play therefore pushed `Paused` and then immediately read the new state,
   * saw a menu, and called `back()` — landing back on `Playing` in the same
   * keystroke. The pause menu was unreachable, and with it Settings, Abort and
   * every other route out of a run.
   *
   * The split now is by responsibility rather than by screen. Opening the pause
   * menu belongs to the input layer, because `pause` is a *rebindable action*
   * and a player who binds it to `p` must get pause from `p`. Closing a menu
   * belongs here, because it is shell navigation and every screen shares it.
   * The `defaultPrevented` guard is what keeps the two from overlapping on the
   * one key that is both: the input layer consumes the keystroke when it acts.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const state = useGameStore.getState()
      if (state.screen === 'Playing' || state.screen === 'Tutorial') return
      if (state.history.length > 0) state.back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <ErrorBoundary screen={screen}>
      <main>
        {showScene ? (
          <div className="scene-layer" aria-hidden="true">
            <Suspense fallback={null}>
              <Canvas
                world={simulation.world}
                tier={tier}
                albedoMap={terrainEpoch >= 0 ? terrainRef.current?.albedo : undefined}
                normalMap={terrainEpoch >= 0 ? terrainRef.current?.normal : undefined}
                aoMap={terrainEpoch >= 0 ? terrainRef.current?.ao : undefined}
                onFrame={onFrame}
                stepping={stepping}
                skinId={skinId}
                palette={activeWorld.palette}
                starDensity={activeWorld.starDensity}
                reducedMotion={reducedMotion}
                advance={advanceSimulation}
              />
            </Suspense>
          </div>
        ) : null}
        {/*
          StrictMode covers the UI and stops at the scene.

          Its double-invoked effects are worth having: they are what surfaces a
          listener that never detaches or a subscription that leaks, and every
          screen, store and form below this line gets that pressure.

          They are also fatal to the renderer. R3F disposes its `WebGLRenderer`
          on unmount, which calls three's `forceContextLoss()`, and StrictMode's
          simulated unmount therefore destroys the context of the canvas React
          goes on to reuse. It does not come back on its own, so `npm run dev`
          drew a black scene behind a working menu — while the production build,
          where React does not double-invoke, was completely fine. That is the
          worst shape a bug can have: invisible to every test, visible only to
          the person trying to work on it.

          So the boundary sits here rather than at the root. The scene above is
          mounted once and stays mounted, which is what §11 wants anyway.
        */}
        <StrictMode>
          <div className="ui-layer">
            <Router onAbort={abortRun} simulation={simulation} />
            {toast && <Toast tone={toast.tone}>{toast.message}</Toast>}
          </div>
        </StrictMode>
      </main>
      <LiveRegion />
    </ErrorBoundary>
  )
}

/** Exposed so screens can drive the run without prop-drilling the instance. */
export function useSimulationRefs(): typeof hudRefs {
  return hudRefs
}
