import { hudRefs } from '../../state/hudRefs'
import styles from './ComboMeter.module.css'

export function ComboMeter() {
  return (
    <div className={styles.container}>
      <div className={styles.scoreRow}>
        SCORE <span ref={(el) => { hudRefs.scoreText = el }}>0</span>
      </div>
      <div className={styles.comboRow}>
        <span ref={(el) => { hudRefs.comboText = el }}>×0</span> COMBO
      </div>
    </div>
  )
}
