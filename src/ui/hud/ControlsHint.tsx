/**
 * The card that answers "what am I supposed to be doing, and with which key".
 *
 * Both halves of that question were unanswered anywhere in the running game.
 * The objective lived only in the Briefing, which auto-advances after four
 * seconds; the controls lived only in Settings, which nobody opens before they
 * have a reason to. A player's honest reading of the screen was "enemies land on
 * my bases and then nothing happens", because the one verb that changes that —
 * shoot them — was on a mouse button with no on-screen indication it existed.
 *
 * ## Why there is no state in here
 *
 * §17.2 requires zero React re-renders during Playing, so the dismissal is a CSS
 * animation rather than a timer plus `setState`. The component mounts, the
 * keyframes run, and React never hears from it again. The bindings are read once
 * from the store at mount — not subscribed to — because a player is not rebinding
 * keys while the card is fading.
 */
import { useGameStore } from '../../state/useGameStore'
import { useSettingsStore } from '../../state/useSettingsStore'
import { resolveControls } from '../../platform/controlScheme'
import styles from './ControlsHint.module.css'

export function ControlsHint({ persistent = false }: { persistent?: boolean }) {
  // Read, not subscribed: this component must never re-render during play.
  const keybinds = useSettingsStore.getState().keybinds
  const wave = useGameStore.getState().wave

  // Past the opening waves the card has said everything it has to say, and a
  // reminder that will not stop arriving is worse than no reminder.
  if (!persistent && wave > 2) return null

  // One table, four consumers. See `controlScheme.ts` for why this is not built
  // from `keybinds` inline any more.
  const rows = resolveControls(keybinds, { essentialOnly: true })

  return (
    <div
      className={`${styles.hint} ${persistent ? styles.persistent : ''}`}
      role="note"
      aria-label="How to play"
    >
      <p className={styles.objective}>
        Harvesters land on your outposts and drain them. <strong>Destroy them</strong> before
        the integrity bar empties — you cannot be everywhere, so choose.
      </p>
      <dl className={styles.rows}>
        {rows.map((row) => (
          <div key={row.id} className={styles.row}>
            <dt className={styles.verb}>{row.label.toUpperCase()}</dt>
            <dd className={styles.how}>{row.keys}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
