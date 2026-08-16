import { useEffect, useRef } from 'react'
import { hudRefs } from '../../state/hudRefs'
import { touchState, hasTouch, latchPress } from '../../platform/deviceInput'
import { useGameStore } from '../../state/useGameStore'
import { useSettingsStore } from '../../state/useSettingsStore'
import styles from './TouchControls.module.css'

/**
 * On-glass controls (gameplan §8.3).
 *
 * ## Genuinely multitouch
 *
 * Every widget is driven by its own `pointerId`, and a pointer keeps the role
 * it was given when it went down until it goes up. That is what lets a player
 * hold the throttle, steer, and fire at the same time — three fingers, three
 * independent roles, no arbitration.
 *
 * The previous version had two bugs that made the controls unusable together.
 * It tracked one stick pointer and one throttle pointer with no notion of what
 * else was on screen, and separately watched `touchstart` for a second finger
 * to trigger pause — so the *instant* a player reached for the throttle while
 * steering, the game paused. There is now an explicit pause button, and a
 * second finger means a second control.
 *
 * ## One stick, four directions
 *
 * The stick used to be a *turn* control only. Its vertical axis wrote `steerY`,
 * which in `FlightSystem` aims the nose and nothing else — altitude lives on
 * `input.climb`, which on glass was reachable only by dragging the throttle
 * column *sideways*. So the most natural gesture on a touchscreen, pushing the
 * stick up, made the craft look like it was climbing without changing its
 * altitude by a metre, and the control that actually flew the ship was an
 * undiscoverable horizontal scrub on a widget labelled THR.
 *
 * Now the stick's Y axis commands altitude, which is what a player pushing up
 * is asking for, and the separate altitude control is gone. See `applyStick`
 * for why it writes a little aim as well.
 *
 * ## Combined with the keyboard, not substituting for it
 *
 * This writes into `touchState`, which `deviceInput` **adds** to the keyboard,
 * mouse and gamepad axes. A touchscreen laptop can be flown with both hands on
 * the keys and a thumb on the glass, and neither cancels the other.
 *
 * Nothing here re-renders. Widgets are positioned by mutating style on refs and
 * intents are written to a plain object the simulation samples, so the whole
 * control surface costs React nothing during play (§17.2).
 */

/** Radius in px at which the virtual stick reads full deflection. */
const STICK_RANGE = 46
/** Vertical travel in px for full throttle range. */
const THROTTLE_RANGE = 58

/**
 * How much of the stick's vertical axis is spent aiming rather than climbing.
 *
 * Not zero, and not one. Altitude is a *commanded* quantity — the PD controller
 * flies to it over the better part of a second — so a stick that only wrote
 * `climb` would feel like it had a hold before anything moved. Pitch is damped
 * far faster, so a modest aim term makes the nose answer on the same frame the
 * thumb moves and the altitude follow behind it.
 *
 * Kept well under 1 because `FlightSystem` already pitches the nose from
 * *measured* climb rate (`PITCH_FROM_CLIMB`). The two add, and at 1.0 a gentle
 * climb pinned the nose at the pitch limit.
 */
const STICK_AIM_FROM_Y = 0.45

type Role =
  | 'stick'
  | 'throttle'
  | 'fire'
  | 'boost'
  | 'lock'
  | 'flare'
  | 'bomb'
  | 'switchWeapon'
  | 'engineCut'
  | 'deployDrones'

const ROLES = new Set<string>([
  'fire', 'boost', 'lock', 'flare', 'bomb',
  'switchWeapon', 'engineCut', 'deployDrones', 'throttle',
])

interface Assignment {
  role: Role
  originX: number
  originY: number
}

export function TouchControls() {
  const containerRef = useRef<HTMLDivElement>(null)
  const stickBaseRef = useRef<HTMLDivElement>(null)
  const push = useGameStore((s) => s.push)

  /*
   * A subscription, not a `getState()` read, and it does not violate §17.2.
   *
   * The rule is zero re-renders *during play*, and this value can only change
   * on the Settings screen — which is not play. Reading it once at mount would
   * be wrong in the other direction: the player toggles auto-lock, returns to a
   * paused run, and finds the button they just asked for is missing.
   */
  const autoLock = useSettingsStore((s) => s.settings.controls.autoLock)

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return

    /** Live pointers and what each one is doing. */
    const assignments = new Map<number, Assignment>()

    let fadeTimer = 0
    const wake = (): void => {
      container.style.opacity = '1'
      window.clearTimeout(fadeTimer)
      fadeTimer = window.setTimeout(() => {
        container.style.opacity = '0.34'
      }, 3200)
    }

    /** The role a pointer takes, decided once from where it landed. */
    const roleFor = (target: EventTarget | null, x: number): Role => {
      if (target instanceof Element) {
        const button = target.closest('[data-touch-role]')
        const named = button?.getAttribute('data-touch-role')
        if (named !== null && named !== undefined && ROLES.has(named)) return named as Role
      }
      // Anywhere else on the left half is the floating stick. It floats rather
      // than sitting in a fixed place so the player never has to look down to
      // find it — wherever the thumb lands *is* centre.
      return x < window.innerWidth / 2 ? 'stick' : 'throttle'
    }

    /**
     * Turn on X, altitude on Y.
     *
     * Screen Y grows downward, so a thumb pushed *up* is a negative `knobY` and
     * has to become a positive climb — hence the sign flip. `steerY` keeps the
     * screen's sign because that is the convention `FlightSystem` reads for aim
     * (it negates internally), and it is the same pairing the mouse path uses:
     * `steerY += shapedY` alongside `climb += -shapedY`.
     */
    const applyStick = (assignment: Assignment, x: number, y: number): void => {
      const dx = x - assignment.originX
      const dy = y - assignment.originY
      const distance = Math.hypot(dx, dy)
      const clamped = Math.min(distance, STICK_RANGE)
      const scale = distance > 0 ? clamped / distance : 0
      const knobX = dx * scale
      const knobY = dy * scale

      if (hudRefs.touchStick !== null) {
        hudRefs.touchStick.style.transform = `translate(${knobX}px, ${knobY}px)`
      }
      const normalisedY = knobY / STICK_RANGE
      touchState.steerX = knobX / STICK_RANGE
      touchState.steerY = normalisedY * STICK_AIM_FROM_Y
      touchState.climb = -normalisedY
    }

    /**
     * The right column: throttle only.
     *
     * It used to trim altitude on its horizontal axis, which is where the
     * altitude control hid. That axis is now the stick's, and this widget does
     * the one job its label claims.
     */
    const applyThrottle = (assignment: Assignment, y: number): void => {
      const dy = assignment.originY - y
      touchState.throttle = Math.max(0, Math.min(1, 0.65 + dy / THROTTLE_RANGE))

      if (hudRefs.touchThrottle !== null) {
        const travel = Math.max(-THROTTLE_RANGE, Math.min(THROTTLE_RANGE, dy))
        hudRefs.touchThrottle.style.transform = `translateY(${-travel}px)`
      }
    }

    const releaseStick = (): void => {
      if (stickBaseRef.current !== null) stickBaseRef.current.style.display = 'none'
      if (hudRefs.touchStick !== null) hudRefs.touchStick.style.transform = 'translate(0px, 0px)'
      touchState.steerX = 0
      touchState.steerY = 0
      touchState.climb = 0
    }

    const onPointerDown = (event: PointerEvent): void => {
      wake()
      const role = roleFor(event.target, event.clientX)
      const assignment: Assignment = { role, originX: event.clientX, originY: event.clientY }
      assignments.set(event.pointerId, assignment)

      // Claim the pointer so the browser does not start a scroll or a
      // long-press selection halfway through a turn.
      if (event.target instanceof Element) event.target.setPointerCapture?.(event.pointerId)

      switch (role) {
        case 'stick':
          if (stickBaseRef.current !== null) {
            stickBaseRef.current.style.display = 'block'
            stickBaseRef.current.style.left = `${event.clientX - STICK_RANGE}px`
            stickBaseRef.current.style.top = `${event.clientY - STICK_RANGE}px`
          }
          applyStick(assignment, event.clientX, event.clientY)
          break
        case 'throttle':
          applyThrottle(assignment, event.clientY)
          break
        case 'fire':
          touchState.firing = true
          break
        case 'boost':
          touchState.boosting = true
          break
        case 'lock':
          touchState.locking = true
          break
        // The act buttons latch as well as hold. A quick tap can begin and end
        // between two fixed steps, and without the latch the simulation never
        // sees it — the button would work when pressed deliberately and do
        // nothing when tapped, which is the worst kind of unreliable.
        case 'flare':
          touchState.flaring = true
          latchPress('flare')
          break
        case 'bomb':
          touchState.bombing = true
          latchPress('bomb')
          break
        case 'switchWeapon':
          touchState.switchWeapon = true
          latchPress('switchWeapon')
          break
        case 'engineCut':
          touchState.engineCut = true
          latchPress('engineCut')
          break
        case 'deployDrones':
          touchState.deployDrones = true
          latchPress('deployDrones')
          break
      }
    }

    const onPointerMove = (event: PointerEvent): void => {
      const assignment = assignments.get(event.pointerId)
      if (assignment === undefined) return
      wake()
      if (assignment.role === 'stick') applyStick(assignment, event.clientX, event.clientY)
      else if (assignment.role === 'throttle') applyThrottle(assignment, event.clientY)
    }

    const onPointerUp = (event: PointerEvent): void => {
      const assignment = assignments.get(event.pointerId)
      if (assignment === undefined) return
      assignments.delete(event.pointerId)
      wake()

      switch (assignment.role) {
        case 'stick':
          releaseStick()
          break
        case 'throttle':
          touchState.throttle = 0
          if (hudRefs.touchThrottle !== null) hudRefs.touchThrottle.style.transform = 'translateY(0px)'
          break
        case 'fire':
          touchState.firing = false
          break
        case 'boost':
          touchState.boosting = false
          break
        case 'lock':
          touchState.locking = false
          break
        case 'flare':
          touchState.flaring = false
          break
        case 'bomb':
          touchState.bombing = false
          break
        case 'switchWeapon':
          touchState.switchWeapon = false
          break
        case 'engineCut':
          touchState.engineCut = false
          break
        case 'deployDrones':
          touchState.deployDrones = false
          break
      }
    }

    container.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    wake()

    return () => {
      window.clearTimeout(fadeTimer)
      container.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      assignments.clear()
      // A finger still down when the run ends would otherwise leave the axes
      // pinned, and the next run would start mid-turn.
      releaseStick()
      touchState.throttle = 0
    }
  }, [])

  // A device with no touch support at all gets nothing — but a laptop with a
  // touchscreen gets both these and its keyboard, because they now combine.
  if (!hasTouch) return null

  return (
    <div className={styles.container} ref={containerRef}>
      {/* Floating stick, centred wherever the thumb lands. */}
      <div className={styles.stickBase} ref={stickBaseRef} style={{ display: 'none' }}>
        <div className={styles.stickKnob} ref={(el) => { hudRefs.touchStick = el }} />
      </div>

      {/* Left: the two mode controls. Short glyph-led labels — this cluster sits
          over the outpost roster on a phone, and every character of it was
          competing with information the player actually reads. */}
      <div className={styles.leftActionCluster}>
        <button type="button" className={styles.modeButton} data-touch-role="engineCut" aria-label="Engine cut — Newtonian drift">
          ◇<span className={styles.modeText}>DRIFT</span>
        </button>
        <button type="button" className={styles.modeButton} data-touch-role="switchWeapon" aria-label="Switch weapon mode">
          ⇋<span className={styles.modeText}>WPN</span>
        </button>
      </div>

      {/* Right thumb: throttle. Vertical only — altitude is on the stick now. */}
      <div className={styles.throttleZone} data-touch-role="throttle">
        <div className={styles.throttleBase}>
          <div className={styles.throttleKnob} ref={(el) => { hudRefs.touchThrottle = el }} />
          <span className={styles.throttleLabel}>THR</span>
        </div>
      </div>

      {/* Action buttons. Each is its own pointer role, so any combination of
          them can be held together with the stick and the throttle. */}
      <div className={styles.actionCluster}>
        <button type="button" className={styles.actionButton} data-touch-role="bomb" aria-label="Drop heavy bomb">💣</button>
        {/* Only when the player is doing their own locking. With auto-lock on,
            this button is a control that is already held for them, and a button
            that does nothing is worse than no button at all. */}
        {!autoLock && (
          <button type="button" className={styles.actionButton} data-touch-role="lock" aria-label="Missile lock">⌖</button>
        )}
        <button type="button" className={`${styles.actionButton} ${styles.actionFire}`} data-touch-role="fire" aria-label="Fire">◉</button>
        <button type="button" className={styles.actionButton} data-touch-role="boost" aria-label="Boost">⚡</button>
        <button type="button" className={styles.actionButton} data-touch-role="flare" aria-label="Countermeasure flares">◈</button>
        <button type="button" className={styles.actionButton} data-touch-role="deployDrones" aria-label="Launch escort drones">🛰</button>
      </div>

      <button
        type="button"
        className={styles.pauseButton}
        onClick={() => push('Paused')}
        aria-label="Pause"
      >
        ❚❚
      </button>
    </div>
  )
}
