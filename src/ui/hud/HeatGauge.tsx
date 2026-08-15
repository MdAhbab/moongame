import { hudRefs } from '../../state/hudRefs'
import styles from './Gauges.module.css'

export function HeatGauge() {
  return (
    <div className={styles.gaugeContainer}>
      <div className={styles.label}>
        HEAT <span ref={(el) => { hudRefs.heatText = el }}>0</span>
      </div>
      <div className={styles.track}>
        <div 
          className={styles.heatFill} 
          ref={(el) => { hudRefs.heatFill = el }}
          style={{ transform: 'scaleX(0)' }}
        />
      </div>
    </div>
  )
}
