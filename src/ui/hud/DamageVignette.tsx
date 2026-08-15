import { hudRefs } from '../../state/hudRefs'
import styles from './DamageVignette.module.css'

export function DamageVignette() {
  return (
    <div 
      className={styles.vignette}
      ref={(el) => { hudRefs.damageVignette = el }}
    />
  )
}
