import { useEffect, useRef, useState } from 'react'
import { useGameStore } from '../../state/useGameStore'
import { Button } from '../components/ui'
import styles from './PausedScreen.module.css'

export function PausedScreen({ onAbort }: { onAbort?: () => void }) {
  const goto = useGameStore(s => s.goto)
  const push = useGameStore(s => s.push)
  const [confirmingAbort, setConfirmingAbort] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Move focus to the menu on mount
    menuRef.current?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape is handled once, in `App` — see the comment there. A second
      // handler here raced the first and cancelled the pause it had just
      // opened.

      // Focus trap — keep Tab cycling within the dialog
      if (e.key === 'Tab' && menuRef.current) {
        const focusable = menuRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (!first || !last) return

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault()
            last.focus()
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault()
            first.focus()
          }
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => { window.removeEventListener('keydown', handleKeyDown) }
  }, [])

  return (
    <div
      className={styles.container}
      role="dialog"
      aria-modal="true"
      aria-labelledby="paused-title"
    >
      <div className={styles.menu} ref={menuRef} tabIndex={-1}>
        <h2 id="paused-title" className={styles.title}>PAUSED</h2>
        <div className={styles.buttons}>
          <Button label="RESUME [ESC]" primary onClick={() => goto('Playing')} full />
          <Button label="SETTINGS" onClick={() => push('Settings')} full />
          {/*
            Abort ends the run before it navigates. Sending the player to
            `Results` without telling the simulation anything left that screen
            with no summary to render, so it returned `null` — a blank overlay
            with no buttons, over a live scene, on a screen `goto` pushes no
            history for. There was no way out but a page reload.

            Two steps, because a mis-click here throws away a whole run.
          */}
          {confirmingAbort ? (
            <>
              <Button label="CONFIRM — END THE RUN" onClick={() => { onAbort?.() }} full />
              <Button label="KEEP FLYING" onClick={() => { setConfirmingAbort(false) }} full />
            </>
          ) : (
            <Button label="ABORT RUN" onClick={() => { setConfirmingAbort(true) }} full />
          )}
        </div>
      </div>
    </div>
  )
}
