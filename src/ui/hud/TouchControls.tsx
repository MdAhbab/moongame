import { useEffect, useRef } from 'react'
import { hudRefs } from '../../state/hudRefs'
import { touchState, hasTouch, latchPress } from '../../platform/deviceInput'
import { useGameStore } from '../../state/useGameStore'
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
/** Horizontal travel in px for full lateral deflection on the slide rocker. */
const SLIDE_RANGE = 44

type Role = 'stick' | 'throttle' | 'fire' | 'boost' | 'lock' | 'flare' | 'bomb' | 'switchWeapon' | 'engineCut' | 'climb' | 'slide'

interface Assignment {
  role: Role
  originX: number
  originY: number
}

export function TouchControls() {
  const containerRef = useRef<HTMLDivElement>(null)
  const stickBaseRef = useRef<HTMLDivElement>(null)
  const push = useGameStore((s) => s.push)

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
        const named = button?.getAttribute('data-touch-role') as Role | null
        if (
          named === 'fire' || named === 'boost' || named === 'lock' || named === 'flare' ||
          named === 'bomb' || named === 'switchWeapon' || named === 'engineCut' ||
          named === 'throttle' || named === 'climb' || named === 'slide'
        ) {
          return named
        }
      }
      // Anywhere else on the left half is the floating stick. It floats rather
      // than sitting in a fixed place so the player never has to look down to
      // find it — wherever the thumb lands *is* centre.
      return x < window.innerWidth / 2 ? 'stick' : 'throttle'
    }

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
      touchState.steerX = knobX / STICK_RANGE
      touchState.steerY = knobY / STICK_RANGE
    }

    const applyThrottle = (assignment: Assignment, x: number, y: number): void => {
      // Vertical sets throttle, horizontal trims altitude — §8.3's right-thumb
      // control, and the two are independent so one thumb does both.
      const dy = assignment.originY - y
      const dx = x - assignment.originX
      const throttle = Math.max(0, Math.min(1, 0.65 + dy / THROTTLE_RANGE))
      touchState.throttle = throttle
      touchState.climb = Math.max(-1, Math.min(1, dx / THROTTLE_RANGE))

      if (hudRefs.touchThrottle !== null) {
        hudRefs.touchThrottle.style.transform = `translateY(${-Math.max(-THROTTLE_RANGE, Math.min(THROTTLE_RANGE, dy))}px)`
      }
    }

    /**
     * The slide rocker: horizontal only, springs back to centre.
     *
     * Deliberately *not* folded into the stick. On a keyboard, turning and
     * sliding are separated by a modifier; on glass they are separated by being
     * two widgets, because a single stick cannot express both — a thumb pushed
     * left has to mean one thing, and if it meant both the two verbs would be
     * indistinguishable exactly where the player most needs to choose.
     */
    const applySlide = (assignment: Assignment, x: number): void => {
      const dx = x - assignment.originX
      const clamped = Math.max(-SLIDE_RANGE, Math.min(SLIDE_RANGE, dx))
      if (hudRefs.touchSlide !== null) {
        hudRefs.touchSlide.style.transform = `translateX(${clamped}px)`
      }
      touchState.strafe = clamped / SLIDE_RANGE
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
          applyThrottle(assignment, event.clientX, event.clientY)
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
        // The four act buttons latch as well as hold. A quick tap can begin and
        // end between two fixed steps, and without the latch the simulation
        // never sees it — the button would work when pressed deliberately and
        // do nothing when tapped, which is the worst kind of unreliable.
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
        case 'climb':
          touchState.climb = event.clientY < window.innerHeight / 2 ? 1 : -1
          break
        case 'slide':
          applySlide(assignment, event.clientX)
          break
      }
    }

    const onPointerMove = (event: PointerEvent): void => {
      const assignment = assignments.get(event.pointerId)
      if (assignment === undefined) return
      wake()
      if (assignment.role === 'stick') applyStick(assignment, event.clientX, event.clientY)
      else if (assignment.role === 'throttle') applyThrottle(assignment, event.clientX, event.clientY)
      else if (assignment.role === 'slide') applySlide(assignment, event.clientX)
    }

    const onPointerUp = (event: PointerEvent): void => {
      const assignment = assignments.get(event.pointerId)
      if (assignment === undefined) return
      assignments.delete(event.pointerId)
      wake()

      switch (assignment.role) {
        case 'stick': {
          if (stickBaseRef.current !== null) stickBaseRef.current.style.display = 'none'
          if (hudRefs.touchStick !== null) hudRefs.touchStick.style.transform = 'translate(0px, 0px)'
          touchState.steerX = 0
          touchState.steerY = 0
          break
        }
        case 'throttle':
          touchState.throttle = 0
          touchState.climb = 0
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
        case 'climb':
          touchState.climb = 0
          break
        case 'slide':
          touchState.strafe = 0
          if (hudRefs.touchSlide !== null) hudRefs.touchSlide.style.transform = 'translateX(0px)'
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

      {/* Left edge: the slide rocker. Its own widget rather than a second axis
          on the stick — see `applySlide`. */}
      {/* `data-touch-role` is this file's own dispatch attribute and means
          nothing to ARIA, so the `aria-label` here was sitting on a roleless
          div — the same violation axe caught in the Hangar. The audit never
          reached it because these controls only mount on a touch device.
          `group` rather than `slider`: the zone is driven by touch alone, with
          no tabIndex and no key handler, and `slider` would promise a keyboard
          contract that does not exist. */}
      <div className={styles.slideZone} data-touch-role="slide" role="group" aria-label="Slide left or right">
        <div className={styles.slideTrack}>
          <div className={styles.slideKnob} ref={(el) => { hudRefs.touchSlide = el }} />
          <span className={styles.slideLabel}>SLIDE</span>
        </div>
      </div>

      {/* Left utility buttons: Drift Float & Weapon Mode */}
      <div className={styles.leftActionCluster}>
        <button type="button" className={styles.actionButton} data-touch-role="engineCut" aria-label="Engine Cut Float">FLOAT</button>
        <button type="button" className={styles.actionButton} data-touch-role="switchWeapon" aria-label="Switch Weapon">⇋</button>
      </div>

      {/* Right thumb: throttle vertically, altitude trim horizontally. */}
      <div className={styles.throttleZone} data-touch-role="throttle">
        <div className={styles.throttleBase}>
          <div className={styles.throttleKnob} ref={(el) => { hudRefs.touchThrottle = el }} />
          <span className={styles.throttleLabel}>THR</span>
        </div>
      </div>

      {/* Action buttons. Each is its own pointer role, so any combination of
          them can be held together with the stick and the throttle. */}
      <div className={styles.actionCluster}>
        <button type="button" className={styles.actionButton} data-touch-role="bomb" aria-label="Drop Heavy Bomb">💣</button>
        <button type="button" className={styles.actionButton} data-touch-role="lock" aria-label="Missile lock">⌖</button>
        <button type="button" className={`${styles.actionButton} ${styles.actionFire}`} data-touch-role="fire" aria-label="Fire">◉</button>
        <button type="button" className={styles.actionButton} data-touch-role="boost" aria-label="Boost">⚡</button>
        <button type="button" className={styles.actionButton} data-touch-role="flare" aria-label="Flares">◈</button>
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
