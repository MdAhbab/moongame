import { useGameStore } from '../../state/useGameStore'
import styles from './OutpostRoster.module.css'

export function OutpostRoster() {
  const outposts = useGameStore((s) => s.outposts)

  if (!outposts || outposts.length === 0) return null

  // Mobile optimization: If window is small, collapse to a count + most urgent.
  // We'll handle the responsive hiding in CSS instead of JS to avoid re-renders on resize.

  return (
    <div className={styles.rosterContainer}>
      <h3 className={styles.rosterHeader}>OUTPOSTS</h3>
      <ul className={styles.rosterList}>
        {outposts.map((op) => {
          const isLost = op.status === 'Lost'
          const isThreatened = op.status === 'Threatened' || op.status === 'Draining' || op.status === 'Critical'
          
          let icon = '◆'
          if (isLost) icon = '◇'
          else if (isThreatened) icon = '◈'

          let statusText = `${Math.ceil(op.integrity)}%`
          if (isLost) statusText = 'LOST'

          let rowClass = styles.row
          if (isLost) rowClass += ` ${styles.rowLost}`
          else if (op.status === 'Critical') rowClass += ` ${styles.rowCritical}`
          else if (isThreatened) rowClass += ` ${styles.rowThreatened}`

          return (
            <li key={op.index} className={rowClass}>
              <span className={styles.icon}>{icon}</span>
              <span className={styles.name}>{op.name}</span>
              <span className={styles.status}>
                {statusText}
                {op.status === 'Draining' && <span className={styles.drainIcon}>▼</span>}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
