import { hudRefs } from '../../state/hudRefs'
import styles from './AltitudeLadder.module.css'

export function AltitudeLadder() {
  return (
    <div className={styles.ladder}>
      <div className={styles.trend} ref={(el) => { hudRefs.altitudeTrend = el }}>─</div>
      <div className={styles.value} ref={(el) => { hudRefs.altitudeText = el }}>25</div>
      <div className={styles.label}>ALT</div>
    </div>
  )
}
