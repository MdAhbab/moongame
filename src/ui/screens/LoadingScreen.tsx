/**
 * LoadingScreen — shows real terrain-bake progress (§11, §33.2).
 *
 * "Never a timer" — every update to loadProgress is a genuine milestone
 * from the terrain worker, not an animation playing over a fixed duration.
 * The atmospheric art appears as a full-bleed background while the world
 * generates behind it.
 */
import { useGameStore } from '../../state/useGameStore'
import styles from './LoadingScreen.module.css'

export function LoadingScreen() {
  // REAL worker progress, never a timer (§11, §33.2)
  const loadProgress = useGameStore(s => s.loadProgress)
  const loadStage = useGameStore(s => s.loadStage)

  return (
    <div className={styles.container}>
      {/* Atmospheric art reveals the setting before the game begins */}
      <img
        src="/loading-art.jpg"
        alt=""
        className={styles.backdrop}
        aria-hidden="true"
        draggable={false}
      />
      <div className={styles.scrim} aria-hidden="true" />

      <div className={styles.panel}>
        <h1 className={styles.title}>MARE NOCTIS</h1>
        <p className={styles.tagline}>LUNAR OUTPOST DEFENSE</p>

        <div
          className={styles.progressContainer}
          role="progressbar"
          aria-label={`Loading: ${loadStage || 'Initializing'}`}
          aria-valuenow={Math.round(loadProgress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ transform: `scaleX(${loadProgress})` }} />
          </div>
          <div className={styles.progressText}>
            {loadStage || 'INITIALIZING'}&nbsp;&nbsp;{Math.round(loadProgress * 100)}%
          </div>
        </div>
      </div>
    </div>
  )
}
