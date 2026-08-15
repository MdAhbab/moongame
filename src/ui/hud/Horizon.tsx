import { hudRefs } from '../../state/hudRefs'
import styles from './Horizon.module.css'

export function Horizon() {
  return (
    <div className={styles.container}>
      <div 
        className={styles.line} 
        ref={(el) => { hudRefs.horizon = el }}
      >
        <span className={styles.tickLeft}>─</span>
        <span className={styles.center}>horizon</span>
        <span className={styles.tickRight}>─</span>
      </div>
    </div>
  )
}
