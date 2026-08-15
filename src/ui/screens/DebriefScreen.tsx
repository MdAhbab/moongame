import { useGameStore } from '../../state/useGameStore'
import { Button } from '../components/ui'
import styles from './DebriefScreen.module.css'

export function DebriefScreen() {
  const goto = useGameStore(s => s.goto)
  const waveSummary = useGameStore(s => s.waveSummary)
  const runSummary = useGameStore(s => s.runSummary)
  const isDefeat = runSummary !== null && !runSummary.victory
  
  // Never `null` — see the note in `ResultsScreen`. An empty render here is a
  // transparent, buttonless overlay the player cannot leave.
  if (!waveSummary) {
    return (
      <div className={styles.container}>
        <div className={styles.content}>
          <h2 className={styles.title}>DEBRIEF</h2>
          <p className={styles.successText}>No wave record was captured.</p>
          <div className={styles.actions}>
            <Button label="RETURN TO MENU" primary onClick={() => goto('Title')} full />
          </div>
        </div>
      </div>
    )
  }

  const duration = Math.max(1, waveSummary.duration)

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <h2 className={styles.title}>WAVE {waveSummary.wave} DEBRIEF</h2>
        
        {/* The Cause - One sentence explaining what went wrong if something was lost */}
        {waveSummary.cause ? (
          <p className={styles.cause}>{waveSummary.cause}</p>
        ) : (
          <p className={styles.successText}>All outposts secured.</p>
        )}
        
        {/* Timeline Strip */}
        <div className={styles.timelineContainer}>
          <div className={styles.timelineHeader}>TIMELINE</div>
          {waveSummary.timeline.map((entry, idx) => {
            return (
              <div key={idx} className={styles.timelineRow}>
                <span className={entry.survived ? styles.timelineName : styles.timelineNameLost}>
                  {entry.name}
                </span>
                <div className={styles.timelineTrack}>
                  {entry.threatenedAt > -1 && (
                    <div 
                      className={styles.threatSpan}
                      style={{ 
                        left: `${Math.max(0, Math.min(100, (entry.threatenedAt / duration) * 100))}%`,
                        right: entry.survived ? '0%' : `${Math.max(0, Math.min(100, 100 - (entry.lostAt / duration) * 100))}%`
                      }}
                    />
                  )}
                  {!entry.survived && (
                    <div 
                      className={styles.lostMarker}
                      style={{ left: `${Math.max(0, Math.min(100, (entry.lostAt / duration) * 100))}%` }}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className={styles.statsGrid}>
          <div className={styles.statItem}>
            <span>ACCURACY</span>
            <strong>{Math.round(waveSummary.accuracy * 100)}%</strong>
          </div>
          <div className={styles.statItem}>
            <span>HARVESTERS</span>
            <strong>{waveSummary.killsHarvester}</strong>
          </div>
          <div className={styles.statItem}>
            <span>INTERCEPTORS</span>
            <strong>{waveSummary.killsInterceptor}</strong>
          </div>
          <div className={styles.statItem}>
            <span>SENTINELS</span>
            <strong>{waveSummary.killsSentinel}</strong>
          </div>
        </div>

        <div className={styles.actions}>
          {isDefeat ? (
            <Button label="MISSION RESULTS" primary onClick={() => goto('Results')} full />
          ) : (
            <Button label="CONTINUE" primary onClick={() => goto('Briefing')} full />
          )}
        </div>
      </div>
    </div>
  )
}
