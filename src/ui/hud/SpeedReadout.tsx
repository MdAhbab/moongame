import { hudRefs } from '../../state/hudRefs'
import styles from './SpeedReadout.module.css'

/**
 * Airspeed, in world units per second.
 *
 * `writeHud` has written this value every frame since the HUD was built, but
 * nothing ever claimed the ref, so the number went nowhere. It matters more
 * here than in most flight games: every deadline the game states — the
 * Briefing's seconds-to-outpost, the Debrief's "you were six seconds away" —
 * is derived from cruise velocity, and without a speed readout the player has
 * no way to tell whether they are actually making it.
 */
export function SpeedReadout() {
  return (
    <div className={styles.readout}>
      <div className={styles.value} ref={(el) => { hudRefs.speedText = el }}>0</div>
      <div className={styles.label}>U/S</div>
    </div>
  )
}
