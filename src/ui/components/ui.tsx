import { useEffect, useState, type ReactNode } from 'react'
import styles from './ui.module.css'
import { captureNextBinding, codeLabel } from '../../platform/deviceInput'
import { uiClick, uiHover } from '../../audio/uiBus'
import type { Binding } from '../../state/persistence'

/**
 * The shared button — and the single place UI audio is armed.
 *
 * Wiring the bus here rather than at each call site is the whole point: there
 * are forty-odd buttons across sixteen screens, and a convention that every one
 * of them remembers to play a click is a convention that will be broken by the
 * next screen somebody adds. The sound is a property of *being a button*.
 *
 * A disabled button stays silent. Clicking one is a non-event, and answering it
 * with the same confirmation tone as a real press would tell the player
 * something happened when nothing did — which is the one thing feedback must
 * never do (§13.4).
 */
export function Button({
  label,
  primary,
  disabled,
  onClick,
  full,
}: {
  label: string
  primary?: boolean
  disabled?: boolean
  onClick?: () => void
  full?: boolean
}) {
  let className = `${styles.button} ${full ? styles.buttonFull : ''}`
  if (primary && !disabled) className += ` ${styles.buttonPrimary}`

  return (
    <button
      onClick={() => {
        if (disabled) return
        uiClick()
        onClick?.()
      }}
      // Pointer-only, not focus. Keyboard navigation moves focus through every
      // control between two points, so playing this on focus turns one arrow
      // press into a burst of tones and makes the quietest sound in the game
      // the most frequent one.
      onPointerEnter={() => {
        if (!disabled) uiHover()
      }}
      disabled={disabled}
      className={className}
    >
      {label}
    </button>
  )
}

export function Slider({
  label,
  description,
  value,
  min = 0,
  max = 100,
  suffix = '%',
  onChange,
}: {
  label: string
  /**
   * One line on what the setting does.
   *
   * `Toggle` has always had one and `Slider` has not, which left the sliders —
   * the settings that change the *rules* rather than the presentation — as the
   * only ones the player had to guess at.
   */
  description?: string
  value: number
  min?: number
  max?: number
  suffix?: string
  onChange?: (v: number) => void
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <label className={styles.sliderLabel}>
      <div className={styles.sliderHeader}>
        <span>{label}</span>
        <span className={styles.sliderValue}>
          {value}{suffix}
        </span>
      </div>
      {description !== undefined && <span className={styles.toggleDescription}>{description}</span>}
      <div className={styles.sliderTrackContainer}>
        <div className={styles.sliderTrackBg} />
        <div className={styles.sliderTrackFill} style={{ width: `${pct}%` }} />
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange?.(Number(e.target.value))}
          className={styles.sliderInput}
          aria-label={label}
        />
      </div>
    </label>
  )
}

export function Toggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string
  description?: string
  value: boolean
  onChange?: (v: boolean) => void
}) {
  return (
    <div className={styles.toggleContainer}>
      <div className={styles.toggleText}>
        <div className={styles.toggleLabel}>{label}</div>
        {description && <p className={styles.toggleDescription}>{description}</p>}
      </div>
      <button
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange?.(!value)}
        className={`${styles.toggleSwitch} ${value ? styles.toggleSwitchOn : ''}`}
      >
        <span className={styles.toggleThumb} />
      </button>
    </div>
  )
}

export function Tabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div className={styles.tabsContainer} role="tablist">
      {tabs.map((t) => (
        <button
          key={t}
          role="tab"
          aria-selected={active === t}
          onClick={() => onChange(t)}
          className={`${styles.tab} ${active === t ? styles.tabActive : ''}`}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

/**
 * One rebindable control.
 *
 * The capture is delegated to `platform/deviceInput`, not implemented here with
 * a local `keydown` listener, and that is the whole point of the component. The
 * input layer already owns a global `keydown` handler that turns keystrokes
 * into flight commands; a second listener in React would race it, so binding
 * Escape to pause would also pause, and binding a movement key would fly the
 * craft. `captureNextBinding` instead makes the input layer swallow the next
 * key outright and hand it back.
 */
export function KeyBindingRow({
  action,
  bindings,
  slots = 2,
  onRebind,
  onClear,
}: {
  action: string
  bindings: readonly Binding[]
  /** How many binding slots to offer. Every slot is live simultaneously. */
  slots?: number
  onRebind: (slot: number, binding: Binding) => void
  onClear: (slot: number) => void
}) {
  /** Which slot is waiting for a keystroke, or -1. */
  const [capturing, setCapturing] = useState(-1)
  /**
   * Why the last attempt was refused.
   *
   * Shown rather than swallowed. A rebind row that simply does nothing when you
   * press Ctrl+W is indistinguishable from one that is broken — and the reason
   * matters here, because that particular chord would close the browser tab, so
   * "nothing happened" is the *good* outcome the player cannot see.
   */
  const [rejected, setRejected] = useState<string | null>(null)

  // A capture left open would eat the player's next keystroke anywhere in the
  // app, so unmounting — switching tabs, closing Settings — must cancel it.
  useEffect(() => {
    if (capturing < 0) return
    const slot = capturing
    return captureNextBinding((next, rejection) => {
      setCapturing(-1)
      setRejected(rejection)
      if (rejection === null) onRebind(slot, next)
    })
  }, [capturing, onRebind])

  return (
    <div className={styles.keyBindRow}>
      <span className={styles.keyBindAction}>
        {action}
        {rejected !== null && <span className={styles.keyBindError}>{rejected}</span>}
      </span>
      <div className={styles.keyBindSlots}>
        {Array.from({ length: slots }, (_, slot) => {
          const binding = bindings[slot]
          const label = binding === undefined ? '+' : codeLabel(binding)
          const description =
            binding === undefined
              ? `${action}: slot ${String(slot + 1)} unbound. Activate to bind a key.`
              : `${action}: slot ${String(slot + 1)} bound to ${label}. Activate to rebind, or use the clear button.`
          return (
            <span key={slot} className={styles.keyBindSlot}>
              <button
                type="button"
                onClick={() => { setRejected(null); setCapturing(slot) }}
                aria-label={description}
                className={[
                  styles.keyBindButton,
                  capturing === slot ? styles.keyBindButtonRebinding : '',
                  binding === undefined ? styles.keyBindButtonEmpty : '',
                ].join(' ')}
              >
                {capturing === slot ? 'PRESS A KEY…' : label}
              </button>
              {binding !== undefined && slot > 0 && (
                <button
                  type="button"
                  onClick={() => { onClear(slot) }}
                  aria-label={`Clear the alternate binding for ${action}`}
                  className={styles.keyBindClear}
                >
                  ×
                </button>
              )}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export function Toast({ children, tone = 'info', icon }: { children: ReactNode; tone?: 'info' | 'warning'; icon?: string }) {
  return (
    <div className={`${styles.toast} ${tone === 'warning' ? styles.toastWarning : styles.toastInfo}`}>
      {icon && <span>{icon}</span>}
      <span>{children}</span>
    </div>
  )
}
