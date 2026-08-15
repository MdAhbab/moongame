/**
 * CreditsScreen — cinematic art backdrop with scrolling credits.
 *
 * The generated art (credits-art.png) sits as a full-bleed background
 * image. The credits panel is semi-transparent and centered over it.
 */
import { useGameStore } from '../../state/useGameStore'
import { Button } from '../components/ui'
import styles from './CreditsScreen.module.css'

export function CreditsScreen() {
  const back = useGameStore(s => s.back)

  return (
    <div className={styles.container}>
      {/* Cinematic background art */}
      <img
        src="/credits-art.jpg"
        alt="Spacecraft departing the Moon toward Earth"
        className={styles.backdrop}
        aria-hidden="true"
        draggable={false}
      />
      <div className={styles.scrim} aria-hidden="true" />

      <div className={styles.content}>
        <h2 className={styles.title}>MARE NOCTIS</h2>
        <p className={styles.subtitle}>Sea of Night</p>

        <div className={styles.creditsList}>
          <div className={styles.creditBlock}>
            <div className={styles.role}>DESIGN &amp; DEVELOPMENT</div>
            <div className={styles.name}>Deepmind Antigravity Agent</div>
          </div>

          <div className={styles.creditBlock}>
            <div className={styles.role}>ORIGINAL CONCEPT &amp; DIRECTION</div>
            <div className={styles.name}>Ahbab</div>
          </div>

          <div className={styles.creditBlock}>
            <div className={styles.role}>TYPOGRAPHY</div>
            <div className={styles.name}>Chakra Petch — Cadson Demak</div>
            <div className={styles.name}>Inter — Rasmus Andersson</div>
          </div>

          <div className={styles.creditBlock}>
            <div className={styles.role}>BUILT WITH</div>
            <div className={styles.name}>React · Three.js · Vite · Vitest</div>
          </div>

          <div className={styles.creditBlock}>
            <div className={styles.role}>ZERO ASSETS POLICY</div>
            <div className={styles.name}>
              All terrain is procedurally generated.<br />
              All enemies are code. No art files were harmed.
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          <Button label="BACK [ESC]" onClick={back} />
        </div>
      </div>
    </div>
  )
}
