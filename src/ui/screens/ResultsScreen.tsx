import { useEffect, useRef } from 'react'
import { useGameStore } from '../../state/useGameStore'
import { useSettingsStore } from '../../state/useSettingsStore'
import { Button } from '../components/ui'
import styles from './ResultsScreen.module.css'
import { xpFromRun, levelForXp, xpForLevel, MAX_LEVEL } from '../../game/data/progression.ts'

export function ResultsScreen() {
  const goto = useGameStore(s => s.goto)
  const runSummary = useGameStore(s => s.runSummary)
  const bestScore = useSettingsStore(s => s.progress.bestScore)
  const pilotXp = useSettingsStore(s => s.progress.pilotXp)
  const updateProgress = useSettingsStore(s => s.updateProgress)
  const addPilotXp = useSettingsStore(s => s.addPilotXp)
  const addCredits = useSettingsStore(s => s.addCredits)
  const unlockAchievement = useSettingsStore(s => s.unlockAchievement)
  const awardedRef = useRef(false)

  // Award XP and PB exactly once when the screen mounts.
  // Must be unconditional (before the early return) to follow hooks rules.
  useEffect(() => {
    if (!runSummary) return
    if (awardedRef.current) return
    awardedRef.current = true

    const pbDelta = runSummary.finalScore - bestScore
    if (pbDelta > 0) {
      updateProgress(p => ({
        ...p,
        bestScore: runSummary.finalScore,
        bestWave: Math.max(p.bestWave, runSummary.waveReached),
      }))
    }
    addPilotXp(xpFromRun(runSummary))

    /*
     * Credits are banked here, with the XP, rather than per wave.
     *
     * They used to be awarded by `WaveClearScreen`, which is the one screen a
     * run does not always reach: a run that ends in defeat goes to the Debrief,
     * a victory and an abort both come straight here, and none of those three
     * paths pass through a wave-clear. So the wave that actually killed you —
     * usually the longest and most lucrative one — paid nothing, and an aborted
     * run paid nothing at all, contradicting `settleIfNeeded`'s own note that an
     * aborted wave "still owes the player whatever it earned".
     *
     * Summing `waves` also makes this the single place a run pays out, on the
     * same terms as XP and the personal best: the run is the unit. And it is
     * idempotent by the same `awardedRef` that already guards those two, rather
     * than needing a second, differently-scoped guard on another screen.
     */
    addCredits(runSummary.waves.reduce((sum, wave) => sum + wave.creditsEarned, 0))

    // Achievement liveries (§9). Evaluated here rather than in the simulation
    // because they are profile facts, not world facts — the world has no idea a
    // profile exists, and §32.1 keeps it that way. `unlockAchievement` is
    // idempotent, so re-earning one is a no-op rather than a duplicate write.
    if (runSummary.outpostsRemaining === 8) unlockAchievement('cleanSweep')
    if (runSummary.accuracy >= 0.8) unlockAchievement('deadEye')
    if (runSummary.victory) unlockAchievement('trophyIron')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A screen with nothing to show still has to be a screen.
  //
  // This returned `null` — which does not mean "nothing to show", it means "no
  // UI at all": a transparent layer over the live 3D scene, with no buttons and
  // no route out, on a screen `goto` pushed no history for. Every dead end this
  // game has ever had has been an early return like this one, so the fallback is
  // a real panel with a real way back.
  if (!runSummary) {
    return (
      <div className={styles.container}>
        <div className={styles.content}>
          <h2 className={styles.title}>RUN ENDED</h2>
          <p className={styles.fallbackNote}>No flight record was captured for this run.</p>
          <div className={styles.actions}>
            <Button label="RETURN TO MENU" primary onClick={() => goto('Title')} full />
          </div>
        </div>
      </div>
    )
  }

  const isVictory = runSummary.victory
  const pbDelta = runSummary.finalScore - bestScore
  const earnedXp = xpFromRun(runSummary)
  const levelBefore = levelForXp(pilotXp)
  const xpAfter = pilotXp + earnedXp
  const levelAfter = levelForXp(xpAfter)
  const leveledUp = levelAfter > levelBefore && levelBefore < MAX_LEVEL
  const nextLevelXp = levelAfter < MAX_LEVEL ? xpForLevel(levelAfter + 1) : null
  const thisLevelXp = xpForLevel(levelAfter)
  const xpProgress = nextLevelXp !== null
    ? Math.min(1, (xpAfter - thisLevelXp) / (nextLevelXp - thisLevelXp))
    : 1

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <h2 className={styles.title}>{isVictory ? 'VICTORY' : 'MISSION FAILED'}</h2>

        <div className={styles.stats}>
          <div className={styles.statRow}>
            <span>WAVES COMPLETED</span>
            <strong>{runSummary.waveReached}</strong>
          </div>
          <div className={styles.statRow}>
            <span>FINAL SCORE</span>
            <strong>{runSummary.finalScore.toLocaleString()}</strong>
          </div>
          {pbDelta > 0 && (
            <div className={styles.statRow}>
              <span>NEW PERSONAL BEST</span>
              <strong>+{pbDelta.toLocaleString()}</strong>
            </div>
          )}
          <div className={styles.statRow}>
            <span>ENEMIES DESTROYED</span>
            <strong>{runSummary.totalKills}</strong>
          </div>
          <div className={styles.statRow}>
            <span>ACCURACY</span>
            <strong>{Math.round(runSummary.accuracy * 100)}%</strong>
          </div>
          <div className={styles.statRow}>
            <span>OUTPOSTS SAVED</span>
            <strong>{runSummary.outpostsRemaining}</strong>
          </div>
          <div className={styles.statRow}>
            <span>SEED</span>
            <strong className={styles.seed}>{runSummary.seed}</strong>
          </div>
        </div>

        {/* XP award panel */}
        <div className={styles.xpPanel}>
          <div className={styles.xpHeader}>
            <span className={styles.xpLabel}>PILOT XP  +{earnedXp}</span>
            {leveledUp && <span className={styles.levelUp}>▲ LEVEL UP → {levelAfter}</span>}
          </div>
          <div className={styles.xpBar} role="progressbar" aria-valuenow={Math.round(xpProgress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className={styles.xpFill} style={{ width: `${xpProgress * 100}%` }} />
          </div>
          <div className={styles.xpFooter}>
            <span>LVL {levelAfter}</span>
            {nextLevelXp !== null ? (
              <span>{xpAfter - thisLevelXp} / {nextLevelXp - thisLevelXp} XP to next</span>
            ) : (
              <span>MAX LEVEL</span>
            )}
          </div>
        </div>

        <div className={styles.actions}>
          <Button label="HANGAR" onClick={() => goto('Hangar')} full />
          <Button label="RETURN TO MENU" primary onClick={() => goto('Title')} full />
        </div>
      </div>
    </div>
  )
}
