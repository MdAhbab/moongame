/**
 * Device → simulation input adapter (gameplan §8, §30.2).
 *
 * This file lives in `src/platform/` and not in `src/game/` for the same
 * structural reason `src/audio/` does: it is built entirely out of DOM APIs —
 * `window`, `document`, pointer lock, pointer events, the Gamepad API — and
 * §30.2 requires the simulation to run headless in Node.
 *
 * The contract with the simulation is one function pointer. `Simulation.
 * sampleInput` is invoked at the head of **every fixed step**, not once per
 * frame, which is what stops a 60 Hz and a 144 Hz machine from feeding the
 * world different input histories over the same ten seconds (§31.1, §37.3).
 * Everything here does the same thing: device events write into plain module
 * state, and `sampleInput` folds that state into `world.input`.
 *
 * ## Every device at once
 *
 * Four sources — keyboard, mouse, gamepad, touch — are **combined**, not
 * ranked. An earlier version let each override the last, so a finger resting on
 * the virtual stick pinned steering to whatever the finger said and the
 * keyboard stopped working; on a laptop with a touchscreen that meant the game
 * silently ignored half the controls the player was using. Axes now sum and
 * clamp, buttons OR together, and a player can steer with a thumbstick,
 * throttle on the keyboard and fire on the glass in the same instant.
 *
 * ## Keys are physical
 *
 * Bindings are `KeyboardEvent.code`. See `keys.ts` for why `.key` cannot work —
 * in short, holding Shift changes it, and so does a French keyboard.
 */
import { useSettingsStore } from '../state/useSettingsStore'
import { useGameStore } from '../state/useGameStore'
import { hudRefs } from '../state/hudRefs'
import type { Simulation } from '../game/core/Simulation'
import { FIXED_DT } from '../game/data/constants'
import {
  MOD_NONE,
  bindingMatches,
  bindingRejection,
  formatBinding,
  modifiersOf,
  platform,
  setChordModifiers,
  type Binding,
} from './keys'
import { activeProfile, observeWheel } from './deviceProfile'
import type { Action, BindingList } from '../state/persistence'

export { bindingsLabel, codeLabel, isBindable, platform, hasTouch, hasKeyboard } from './keys'
export type { Binding, Platform } from './keys'
export { detectedPointer, resetPointerDetection, type PointerKind } from './deviceProfile'

/* ------------------------------------------------------------------ */
/* Tuning                                                              */
/* ------------------------------------------------------------------ */

/**
 * Mouse steering is a *rate* control, not a cursor.
 *
 * Movement pushes a virtual stick; the stick decays back to centre, so holding
 * the mouse still means "fly straight". The decay is exponential in the fixed
 * timestep rather than a per-call factor: `sampleInput` runs once per step, so
 * a bare `stick *= 0.9` would recentre at 12.6 s⁻¹ at 120 Hz and 6.3 s⁻¹ at
 * 60 Hz — a control that feels different on different hardware, which is the
 * exact failure this rewrite exists to remove.
 *
 * `MOUSE_GAIN` follows from the equilibrium of that decay: sustained movement
 * of `v` px/s settles at `v · gain / recentre`, so 750 px/s — a firm but
 * comfortable sweep — reaches full deflection at 100% sensitivity.
 */
const REFERENCE_RECENTRE = 6.0
const MOUSE_GAIN = REFERENCE_RECENTRE / 750

/**
 * How fast two-finger scroll commands altitude on a trackpad.
 *
 * The gesture people already reach for, and the one thing a trackpad can do
 * that a mouse cannot do as well. Scaled so a comfortable two-finger swipe is a
 * full-rate climb; `deltaY` is inverted because scrolling *down* should point
 * the craft down.
 */
const SCROLL_CLIMB_PER_PX = -1 / 220

/** How fast a scroll-driven climb command decays back to neutral, s^-1. */
const SCROLL_DECAY = 7

/** Clamp helper used on every axis before it reaches the world. */
function clamp1(value: number): number {
  return value < -1 ? -1 : value > 1 ? 1 : value
}

/**
 * Keys the browser acts on first, and which the game therefore has to claim
 * while play is in progress.
 *
 * All five are bound by default. Space scrolls the page, Tab walks focus off the
 * canvas and into the HUD, and the arrows scroll — so without this, pressing
 * "climb" would also scroll the document out from under the canvas, and the very
 * first thing a player tried would appear to break the game.
 */
const SWALLOWED_DURING_PLAY = new Set([
  'Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
])

/** The modifier keys themselves — never a binding's final key. */
const MODIFIER_CODES = new Set([
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
])

/**
 * Deadzone plus a response curve, in that order.
 *
 * The deadzone is *rescaled* rather than subtracted: past the threshold the
 * axis still reaches ±1, so raising it does not quietly cost the player their
 * top turn rate. The curve then shapes what is left — `magnitude ** exponent` —
 * where an exponent above 1 gives finer control near centre at the cost of a
 * sharper edge, which is what "precise" means on a stick.
 */
function shapeAxis(value: number, deadzone: number, exponent: number): number {
  const magnitude = Math.abs(value)
  if (magnitude <= deadzone) return 0
  const scaled = (magnitude - deadzone) / (1 - deadzone)
  const curved = exponent === 1 ? scaled : Math.pow(scaled, exponent)
  return value < 0 ? -curved : curved
}

/** Maps the response setting onto the exponent `shapeAxis` uses. */
function responseExponent(response: string): number {
  switch (response) {
    case 'precise':
      return 1.6
    case 'sharp':
      return 0.75
    default:
      return 1
  }
}

/* ------------------------------------------------------------------ */
/* Module state                                                        */
/* ------------------------------------------------------------------ */

/** Physical keys currently held, by `KeyboardEvent.code`. */
const heldKeys = new Set<string>()
/** Mouse buttons currently held, as `Mouse<button>`. */
const heldButtons = new Set<string>()

let mouseDx = 0
let mouseDy = 0
let stickX = 0
let stickY = 0
/** Altitude command accumulated from trackpad scroll, decaying to zero. */
let scrollClimb = 0

/** Latched by `toggleFire`; ignored when the setting is off. */
let fireLatched = false

/**
 * The four *act* controls, remembered from the moment they are pressed until
 * the simulation has had one step to notice.
 *
 * Without this, a press shorter than a frame is simply lost. `sampleInput` runs
 * at the head of each fixed step and reads what is *currently* held, so a tap
 * that begins and ends between two steps never appears in `world.input` at all —
 * and the fixed step only advances when the browser hands out a frame, so a
 * hitch during a wave spawn, a backgrounded tab, or a fast enough finger all
 * produce the same symptom: the weapon does not switch and nothing explains why.
 *
 * Held controls need no such treatment. Steering and firing are *states*, and a
 * state that lasted less than 8 ms did not happen.
 */
const pressLatch = { switchWeapon: false, engineCut: false, bomb: false, flare: false }
export type LatchedAction = keyof typeof pressLatch

/**
 * Records a press of an act control, to be consumed by the next fixed step.
 *
 * Exported for `TouchControls`, whose buttons have exactly the same problem: a
 * quick tap on the glass is a `pointerdown`/`pointerup` pair that can fall
 * entirely between two steps.
 */
export function latchPress(action: LatchedAction): void {
  pressLatch[action] = true
}

/**
 * A specific enemy the player has asked to lock, or -1.
 *
 * Written by a tap on a Threat Ring marker, consumed by `WeaponSystem`'s
 * `findLockTarget`, and cleared as soon as the lock is no longer being held —
 * a stale request would silently override the player's aim on the *next* lock
 * they tried to take with the nose.
 */
let requestedLockTarget = -1

/** Asks the weapon system to prefer this enemy slot for the next lock. */
export function requestLockOn(slot: number): void {
  requestedLockTarget = slot
}

/** Open while the Controls tab is waiting for a keystroke. */
let captureHandler: ((binding: Binding, rejection: string | null) => void) | null = null

/**
 * Touch state, keyed by role rather than by pointer.
 *
 * `TouchControls` owns the widgets and writes here; several roles can be live
 * at once because each is driven by its own `pointerId`. That is the whole
 * point — steering, throttle and firing are three fingers, not three turns.
 */
export interface TouchState {
  steerX: number
  steerY: number
  /** Lateral translation, -1..1. Its own widget, usable while steering. */
  strafe: number
  throttle: number
  climb: number
  firing: boolean
  boosting: boolean
  locking: boolean
  flaring: boolean
  bombing: boolean
  switchWeapon: boolean
  engineCut: boolean
}

export const touchState: TouchState = {
  steerX: 0,
  steerY: 0,
  strafe: 0,
  throttle: 0,
  climb: 0,
  firing: false,
  boosting: false,
  locking: false,
  flaring: false,
  bombing: false,
  switchWeapon: false,
  engineCut: false,
}

interface PadState {
  connected: boolean
  steerX: number
  steerY: number
  strafe: number
  climb: number
  throttle: number
  firing: boolean
  locking: boolean
  boosting: boolean
  flaring: boolean
  bombing: boolean
  switchWeapon: boolean
  engineCut: boolean
}

const pad: PadState = {
  connected: false,
  steerX: 0,
  steerY: 0,
  strafe: 0,
  climb: 0,
  throttle: 0,
  firing: false,
  locking: false,
  boosting: false,
  flaring: false,
  bombing: false,
  switchWeapon: false,
  engineCut: false,
}

export function gamepadConnected(): boolean {
  return pad.connected
}

/** Cached rather than read per step — `sampleInput` runs 120 times a second. */
let keybinds: Record<Action, BindingList> = useSettingsStore.getState().keybinds
let controls = useSettingsStore.getState().settings.controls
refreshChordModifiers()

/**
 * Modifiers currently held, as a bitmask.
 *
 * Read from the last keyboard or mouse event rather than tracked as keys in
 * `heldKeys`, because the browser tells us the truth on every event — including
 * after a window switch, where a modifier released off-screen would otherwise
 * stay latched forever.
 */
let heldModifiers = MOD_NONE

/** Recomputes which modifiers participate in matching. See `keys.ts`. */
function refreshChordModifiers(): void {
  const all: Binding[] = []
  for (const list of Object.values(keybinds)) all.push(...list)
  setChordModifiers(all)
}

/**
 * True when *any* of the action's bindings is currently held.
 *
 * Every binding in the list is live simultaneously, which is what makes "WASD or
 * the arrows" a fact rather than a setting, and what lets a player hold W with
 * one hand and ↑ with the other without the game deciding one of them wins.
 *
 * Modifier state is part of the match, which is what makes `A` and `⌥A` two
 * different controls rather than one control fired twice.
 */
function isHeld(action: Action): boolean {
  for (const binding of keybinds[action]) {
    if (binding.startsWith('Mouse')) {
      if (heldButtons.has(binding)) return true
      continue
    }
    for (const code of heldKeys) {
      if (bindingMatches(binding, code, heldModifiers)) return true
    }
  }
  return false
}

/** True when `code`, with `modifiers` held, is one of the bindings for `action`. */
function matchesAction(action: Action, code: string, modifiers: number): boolean {
  for (const binding of keybinds[action]) {
    if (bindingMatches(binding, code, modifiers)) return true
  }
  return false
}

/**
 * Clears every held control.
 *
 * Called on blur, on pointer-lock exit, on pause, and when a Meta key is
 * released. That last case is macOS-specific and not optional: while Command is
 * down the system swallows `keyup` for every other key, so a player who does
 * ⌘-Tab mid-flight comes back with the throttle still held and no event ever
 * arriving to release it.
 */
export function releaseAllInput(): void {
  heldKeys.clear()
  heldButtons.clear()
  heldModifiers = MOD_NONE
  hudRefs.mapOpen = false
  mouseDx = 0
  mouseDy = 0
  stickX = 0
  stickY = 0
  scrollClimb = 0
  fireLatched = false
  requestedLockTarget = -1
  pressLatch.switchWeapon = false
  pressLatch.engineCut = false
  pressLatch.bomb = false
  pressLatch.flare = false
  touchState.steerX = 0
  touchState.steerY = 0
  touchState.strafe = 0
  touchState.throttle = 0
  touchState.climb = 0
  touchState.firing = false
  touchState.boosting = false
  touchState.locking = false
  // The other four were left held. A finger resting on the bomb button when the
  // pause menu opened kept `bombing` true for the rest of the session, and the
  // bay fired on its own the moment play resumed.
  touchState.flaring = false
  touchState.bombing = false
  touchState.switchWeapon = false
  touchState.engineCut = false
}

/* ------------------------------------------------------------------ */
/* Binding                                                             */
/* ------------------------------------------------------------------ */

export function bindDeviceInput(simulation: Simulation): () => void {
  const unsubscribe = useSettingsStore.subscribe((state) => {
    keybinds = state.keybinds
    controls = state.settings.controls
    refreshChordModifiers()
  })

  const isPlaying = (): boolean => {
    const screen = useGameStore.getState().screen
    return screen === 'Playing' || screen === 'Tutorial'
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    const code = event.code
    heldModifiers = modifiersOf(event)

    // A rebind capture consumes the keystroke whole, so binding Escape to pause
    // does not also close the dialog on the way through. A chord is captured as
    // a chord: pressing ⌥ and then A binds `Alt+KeyA`, not `AltLeft`.
    if (captureHandler !== null) {
      event.preventDefault()
      if (MODIFIER_CODES.has(code)) return // still waiting for the real key
      const handler = captureHandler
      captureHandler = null
      const binding = formatBinding(heldModifiers, code)
      // The rejection travels with the binding rather than silently dropping
      // it. A rebind row that simply does nothing when you press Ctrl+W is
      // indistinguishable from one that is broken; the player pressed a key and
      // is owed the reason it cannot be used.
      handler(binding, bindingRejection(binding))
      return
    }

    // Auto-repeat must not re-trigger edge actions. The key is already in the
    // held set, so held actions are unaffected.
    if (event.repeat) return
    heldKeys.add(code)

    if (matchesAction('pause', code, heldModifiers) && isPlaying()) {
      event.preventDefault()
      releaseAllInput()
      useGameStore.getState().push('Paused')
      return
    }

    if (isPlaying()) {
      // Keys the browser acts on before the game sees them. Space scrolls, Tab
      // moves focus off the canvas, and the arrows scroll too — all are bound to
      // gameplay actions now, so all have to be claimed.
      if (SWALLOWED_DURING_PLAY.has(code)) event.preventDefault()
      if (matchesAction('map', code, heldModifiers)) hudRefs.mapOpen = true
      if (controls.toggleFire && matchesAction('fire', code, heldModifiers)) fireLatched = !fireLatched
      // Recentre: drop the mouse stick back to neutral and level the nose.
      // Bound since the first commit and inert until now — with rate-based
      // mouse steering there is a real state to clear, and no other way to
      // clear it without stopping.
      if (matchesAction('recentre', code, heldModifiers)) {
        stickX = 0
        stickY = 0
        mouseDx = 0
        mouseDy = 0
      }

      // The act controls are latched here, on the edge the browser gives us,
      // rather than being inferred from what is still held when a step happens.
      if (matchesAction('switchWeapon', code, heldModifiers)) latchPress('switchWeapon')
      if (matchesAction('engineCut', code, heldModifiers)) latchPress('engineCut')
      if (matchesAction('bomb', code, heldModifiers)) latchPress('bomb')
      if (matchesAction('flare', code, heldModifiers)) latchPress('flare')
    }
  }

  const onKeyUp = (event: KeyboardEvent): void => {
    const code = event.code
    heldModifiers = modifiersOf(event)
    heldKeys.delete(code)
    // Checked without modifiers: the map closes when Tab is released, whatever
    // the player happens to be holding at that instant. A held control that can
    // only be *released* under the same modifier state it was pressed under is a
    // control that sticks.
    if (matchesAction('map', code, MOD_NONE) || matchesAction('map', code, heldModifiers)) {
      hudRefs.mapOpen = false
    }

    // See `releaseAllInput` — macOS suppresses keyup while Command is held, so
    // everything held at that moment would otherwise stay held forever.
    if (platform === 'macos' && (code === 'MetaLeft' || code === 'MetaRight')) {
      heldKeys.clear()
    }
  }

  const onMouseDown = (event: MouseEvent): void => {
    const binding = `Mouse${event.button}`

    if (captureHandler !== null) {
      event.preventDefault()
      const handler = captureHandler
      captureHandler = null
      handler(binding, null)
      return
    }

    if (!isPlaying()) return
    // A click on a HUD control is a click, not a trigger pull.
    if (event.target instanceof Element && event.target.closest('button, a, input, [role="button"]')) return

    heldButtons.add(binding)
    if (controls.toggleFire && keybinds.fire.includes(binding)) fireLatched = !fireLatched

    if (document.pointerLockElement !== document.body) {
      void document.body.requestPointerLock()
    }
  }

  const onMouseUp = (event: MouseEvent): void => {
    heldButtons.delete(`Mouse${event.button}`)
  }

  const onMouseMove = (event: MouseEvent): void => {
    if (!isPlaying()) return
    mouseDx += event.movementX
    mouseDy += event.movementY
  }

  /** The right button is the missile lock; without this it opens a menu. */
  const onContextMenu = (event: MouseEvent): void => {
    if (isPlaying()) event.preventDefault()
  }

  /**
   * Scroll and pinch.
   *
   * Three jobs, and the second two are defensive:
   *
   *  1. **Feed the detector.** Every wheel event is a sample of what kind of
   *     pointing device this is. Passive — the player is never asked.
   *  2. **Two-finger scroll commands altitude** on a trackpad. It is the gesture
   *     people already reach for and the one thing a trackpad does better than
   *     a mouse.
   *  3. **Swallow pinch-zoom.** A trackpad pinch arrives as a wheel event with
   *     `ctrlKey` set, and the browser's default is to zoom the *page* — which
   *     on a full-bleed canvas game leaves the HUD half off-screen with no
   *     obvious way back. `passive: false` is required for `preventDefault` to
   *     work on a wheel listener at all.
   */
  const onWheel = (event: WheelEvent): void => {
    observeWheel({ deltaMode: event.deltaMode, deltaX: event.deltaX, deltaY: event.deltaY })

    const pinching = event.ctrlKey
    if (!isPlaying()) {
      // Outside play the page may legitimately scroll — a long Settings list —
      // but a pinch would still zoom the whole app, so that one is always taken.
      if (pinching) event.preventDefault()
      return
    }

    event.preventDefault()
    if (pinching) return

    // Line-mode deltas are a few units where pixel-mode deltas are hundreds, so
    // they are converted rather than applied raw.
    const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
    scrollClimb = clamp1(scrollClimb + pixels * SCROLL_CLIMB_PER_PX)
  }

  const onPointerLockChange = (): void => {
    if (document.pointerLockElement === document.body) return
    releaseAllInput()
    // Escape is the only exit from pointer lock the page cannot intercept, so
    // losing the lock during play is the player asking to pause.
    if (isPlaying()) useGameStore.getState().push('Paused')
  }

  const onBlur = (): void => {
    releaseAllInput()
  }

  /**
   * A hidden tab is a paused game.
   *
   * `blur` already drops held input, which stops the craft flying into the
   * ground while the player answers a message — but the world kept running:
   * Harvesters landed, outposts drained, and the run could be *lost* on a screen
   * nobody was looking at. The frame delta is clamped, so a long absence does
   * not fast-forward, but ten seconds of real spawning still happened.
   *
   * Pausing is the honest reading of "the player is not here". It is also the
   * only one that keeps §7.2's promise that an outpost is lost to a decision.
   */
  const onVisibilityChange = (): void => {
    if (document.visibilityState !== 'hidden') return
    releaseAllInput()
    if (isPlaying()) useGameStore.getState().push('Paused')
  }

  const onGamepadConnected = (): void => {
    pad.connected = true
  }
  const onGamepadDisconnected = (): void => {
    pad.connected = navigator.getGamepads().some((entry) => entry !== null)
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('mousedown', onMouseDown)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('blur', onBlur)
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('gamepadconnected', onGamepadConnected)
  window.addEventListener('gamepaddisconnected', onGamepadDisconnected)
  document.addEventListener('contextmenu', onContextMenu)
  // Not passive: the pinch and scroll defaults both have to be preventable.
  window.addEventListener('wheel', onWheel, { passive: false })
  document.addEventListener('pointerlockchange', onPointerLockChange)

  /**
   * The pad is polled once per animation frame, not once per fixed step.
   * `navigator.getGamepads()` allocates a fresh array on every call, and at 120
   * steps a second that is 120 throwaway arrays for a snapshot that only
   * changes at the display's rate.
   */
  let padFrame = 0
  const pollGamepad = (): void => {
    padFrame = requestAnimationFrame(pollGamepad)
    if (!pad.connected) return

    const source = navigator.getGamepads().find((entry) => entry !== null)
    if (source === undefined) return

    const deadzone = controls.deadzone / 100
    const exponent = responseExponent(controls.steerResponse)
    const axis = (index: number): number => shapeAxis(source.axes[index] ?? 0, deadzone, exponent)
    const button = (index: number): boolean => source.buttons[index]?.pressed === true
    const trigger = (index: number): number => source.buttons[index]?.value ?? 0

    pad.steerX = axis(0)
    pad.steerY = axis(1)
    // Right stick: horizontal slides, vertical climbs. The left stick turns and
    // aims, so the two families sit on two sticks — the pad equivalent of the
    // keyboard's bare-versus-modified split.
    pad.strafe = axis(2)
    pad.climb = -axis(3)
    pad.throttle = Math.max(trigger(7), button(0) ? 1 : 0)
    pad.firing = trigger(7) > 0.5 || button(0)
    pad.locking = trigger(6) > 0.5 || button(1)
    pad.boosting = button(10) || button(2)
    // The four act controls. Every one of these fields existed, was summed into
    // `world.input` below, and was never assigned here — so on a pad the bomb
    // bay, the weapon toggle and the engine cut were simply absent, whatever
    // the control sheet said. Laid out by hand position: the face buttons carry
    // the two that change what the ship *is* doing, the shoulders the two that
    // are spent.
    pad.flaring = button(5)
    pad.bombing = button(3)
    pad.switchWeapon = button(4)
    pad.engineCut = button(11)

    if (button(9) && isPlaying()) {
      releaseAllInput()
      useGameStore.getState().push('Paused')
    }
  }
  padFrame = requestAnimationFrame(pollGamepad)

  /* ---------------------------------------------------------------- */

  simulation.sampleInput = (world): void => {
    const input = world.input
    const deadzone = controls.deadzone / 100
    const exponent = responseExponent(controls.steerResponse)
    // Re-read per step rather than cached: the detector can change its mind
    // mid-session the first time the player scrolls, and the tuning has to
    // follow immediately rather than at the next screen change.
    const profile = activeProfile(controls.pointer, platform === 'touch')
    const decayPerStep = Math.exp(-profile.recentre * FIXED_DT)

    // ---- keyboard ----
    let climb = 0
    if (isHeld('ascend')) climb += 1
    if (isHeld('descend')) climb -= 1

    // A/← and D/→ steer. They used to feed a roll axis that `FlightSystem`
    // assigned to `craft.bank` and then overwrote from measured angular velocity
    // two lines later, so the keys were bound, listed in Settings, and inert.
    let steerX = 0
    if (isHeld('turnLeft')) steerX -= 1
    if (isHeld('turnRight')) steerX += 1
    let steerY = 0

    // Translation — a separate axis from steering, and separate on purpose.
    // Turning changes where the nose points; sliding does not. Summing them into
    // one axis would make the two verbs indistinguishable at the point of use,
    // which is exactly what a modifier scheme exists to keep apart.
    let strafe = 0
    if (isHeld('strafeLeft')) strafe -= 1
    if (isHeld('strafeRight')) strafe += 1

    // Neutral is *cruise*, not idle. Every deadline the game quotes is derived
    // from `V_CRUISE = √(F/k)`, the terminal velocity at full throttle, so a
    // craft that coasted to a stop on key release would make all of them lies.
    // That is also why there is no "full throttle" key: it would be a control
    // whose only effect is to undo the brake.
    //
    // The brake floor is 0.3 rather than 0: a dead stop on a drain clock is a
    // trap, not a manoeuvre. Thrust is quadratic in speed, so 0.3 throttle
    // settles at √0.3 ≈ 0.55× cruise — slow enough to turn inside an
    // Interceptor, never slow enough to strand you.
    let throttle = 1
    if (isHeld('brake')) throttle = 0.3

    let firing = controls.autoFire || (controls.toggleFire ? fireLatched : isHeld('fire'))
    let locking = isHeld('lock')
    // A latched press reads as held for this one step, which is exactly what the
    // simulation's edge detector needs to see. See `pressLatch`.
    let flaring = isHeld('flare') || pressLatch.flare
    let bombing = isHeld('bomb') || pressLatch.bomb
    let switchWeapon = isHeld('switchWeapon') || pressLatch.switchWeapon
    let engineCutToggle = isHeld('engineCut') || pressLatch.engineCut
    let boosting = isHeld('boost')

    // ---- mouse ----
    if (keybinds.steer.includes('Mouse')) {
      const sensitivity = (controls.mouseSensitivity / 100) * profile.gain
      stickX = stickX * decayPerStep + mouseDx * MOUSE_GAIN * sensitivity
      stickY = stickY * decayPerStep + mouseDy * MOUSE_GAIN * sensitivity
      mouseDx = 0
      mouseDy = 0
      stickX = clamp1(stickX)
      stickY = clamp1(stickY)
      const shapedX = shapeAxis(stickX, deadzone, exponent)
      const shapedY = shapeAxis(stickY, deadzone, exponent)
      steerX += shapedX
      steerY += shapedY
      climb += -shapedY
    }

    // ---- gamepad ----
    if (pad.connected) {
      steerX += pad.steerX
      steerY += pad.steerY
      climb += pad.climb
      strafe += pad.strafe
      if (pad.throttle > 0.05) throttle = pad.throttle
      firing = firing || pad.firing
      locking = locking || pad.locking
      boosting = boosting || pad.boosting
      flaring = flaring || pad.flaring
      bombing = bombing || pad.bombing
      switchWeapon = switchWeapon || pad.switchWeapon
      engineCutToggle = engineCutToggle || pad.engineCut
    }

    // ---- touch ----
    //
    // Added, not substituted. The previous version replaced the steering axis
    // whenever a finger was on the glass, so on a touchscreen laptop the
    // keyboard stopped working the moment anyone touched the screen.
    steerX += shapeAxis(touchState.steerX, deadzone, exponent)
    steerY += shapeAxis(touchState.steerY, deadzone, exponent)
    climb += touchState.climb
    strafe += shapeAxis(touchState.strafe, deadzone, exponent)
    if (touchState.throttle !== 0) throttle = touchState.throttle
    firing = firing || touchState.firing
    locking = locking || touchState.locking
    boosting = boosting || touchState.boosting
    flaring = flaring || touchState.flaring
    bombing = bombing || touchState.bombing
    switchWeapon = switchWeapon || touchState.switchWeapon
    engineCutToggle = engineCutToggle || touchState.engineCut

    // ---- trackpad scroll ----
    //
    // Decays rather than latching, so lifting the fingers levels the craft off.
    // Added to the keyboard's climb rather than replacing it, by the same rule
    // as every other source here.
    if (scrollClimb !== 0) {
      climb += scrollClimb
      scrollClimb *= Math.exp(-SCROLL_DECAY * FIXED_DT)
      if (Math.abs(scrollClimb) < 1e-3) scrollClimb = 0
    }

    input.steerX = clamp1(steerX)
    input.steerY = controls.invertY ? -clamp1(steerY) : clamp1(steerY)
    input.strafe = clamp1(strafe)
    input.climb = clamp1(climb)
    input.throttle = throttle
    input.firing = firing
    input.locking = locking
    input.flaring = flaring
    input.bombing = bombing
    input.switchWeapon = switchWeapon
    input.engineCutToggle = engineCutToggle
    input.boosting = boosting

    // A tapped target is a request, not a mode. It survives only while the
    // player is actually holding lock; releasing drops it, so the next lock
    // starts from wherever the nose is pointing rather than from a target the
    // player tapped a minute ago.
    input.requestLockTarget = requestedLockTarget
    if (!locking) requestedLockTarget = -1

    // Consumed. Cleared *after* the write, so the step that runs next sees the
    // press exactly once however long the frame that delivered it was.
    pressLatch.switchWeapon = false
    pressLatch.engineCut = false
    pressLatch.bomb = false
    pressLatch.flare = false
  }

  return () => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('mousedown', onMouseDown)
    window.removeEventListener('mouseup', onMouseUp)
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('blur', onBlur)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('gamepadconnected', onGamepadConnected)
    window.removeEventListener('gamepaddisconnected', onGamepadDisconnected)
    document.removeEventListener('contextmenu', onContextMenu)
    window.removeEventListener('wheel', onWheel)
    document.removeEventListener('pointerlockchange', onPointerLockChange)
    cancelAnimationFrame(padFrame)
    unsubscribe()
    releaseAllInput()
    simulation.sampleInput = null
  }
}

/**
 * Opens a one-shot capture for the Controls tab. The next key or mouse button
 * becomes the binding and is swallowed rather than acted on.
 */
export function captureNextBinding(
  onBound: (binding: Binding, rejection: string | null) => void,
): () => void {
  captureHandler = onBound
  return () => {
    if (captureHandler === onBound) captureHandler = null
  }
}

/** Releases pointer lock, e.g. when the pause menu opens. */
export function releasePointer(): void {
  if (document.pointerLockElement !== null) document.exitPointerLock()
}
