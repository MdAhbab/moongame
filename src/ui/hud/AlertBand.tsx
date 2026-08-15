import { useGameStore } from '../../state/useGameStore'
import styles from './AlertBand.module.css'

export function AlertBand() {
  // Alert is event-driven through zustand, updated <=10Hz
  const alertText = useGameStore((s) => s.alert)

  if (!alertText) return null

  return (
    <div className={styles.band}>
      <div className={styles.alertContent}>
        {alertText}
      </div>
    </div>
  )
}
