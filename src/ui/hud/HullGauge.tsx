import { hudRefs } from '../../state/hudRefs'
import styles from './Gauges.module.css'

export function HullGauge() {
  return (
    <div className={styles.gaugeContainer}>
      <div className={styles.label}>
        HULL <span ref={(el) => { hudRefs.hullText = el }}>100</span>
      </div>
      <div className={styles.track}>
        {/* We use a solid fill here instead of segments for simplicity, but we can style it segmented if needed via repeating-linear-gradient in CSS */}
        <div 
          className={styles.hullFill} 
          ref={(el) => { hudRefs.hullFill = el }}
          style={{ transform: 'scaleX(1)' }}
        />
      </div>
    </div>
  )
}
