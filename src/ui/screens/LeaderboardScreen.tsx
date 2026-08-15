/**
 * LeaderboardScreen — verified scores, not trusted numbers (TASK-5 §6).
 *
 * Stat layout follows ResultsScreen; tabs and focus follow SettingsScreen.
 * Display names are rendered as text nodes — never innerHTML.
 *
 * Must never render nothing. Always renders a panel with a BACK button.
 */
import { useState, useEffect, useRef } from 'react'
import { useGameStore } from '../../state/useGameStore.ts'
import { Button } from '../components/ui.tsx'
import styles from './LeaderboardScreen.module.css'
import { cloudAvailable, getLeaderboard, type LeaderboardEntry } from '../../net/apiClient.ts'
import { WORLDS } from '../../game/data/worlds.ts'
import { OUTPOST_COUNT } from '../../game/data/constants.ts'

const PAGE_SIZE = 50

export function LeaderboardScreen(): React.JSX.Element {
  const back     = useGameStore((s) => s.back)
  const setToast = useGameStore((s) => s.setToast)

  const [worldId, setWorldId]   = useState(WORLDS[0]?.id ?? 'luna')
  const [endless, setEndless]   = useState(false)
  const [entries, setEntries]   = useState<LeaderboardEntry[]>([])
  const [offset, setOffset]     = useState(0)
  const [loading, setLoading]   = useState(false)
  const [hasMore, setHasMore]   = useState(true)
  /**
   * `offline` is a first-class state, not an error. A static build has no
   * `/api/*` behind it, and telling a player that plainly beats toasting them
   * a 404 they cannot act on.
   */
  const [offline, setOffline]   = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    containerRef.current?.focus()
  }, [])

  // Reload when world/mode changes.
  useEffect(() => {
    setEntries([])
    setOffset(0)
    setHasMore(true)
  }, [worldId, endless])

  // Fetch current page.
  useEffect(() => {
    setLoading(true)
    void (async () => {
      if (!(await cloudAvailable())) {
        setOffline(true)
        setHasMore(false)
        setLoading(false)
        return
      }
      try {
        const page = await getLeaderboard(worldId, endless, PAGE_SIZE, offset)
        if (offset === 0) {
          setEntries(page)
        } else {
          setEntries((prev) => [...prev, ...page])
        }
        setHasMore(page.length === PAGE_SIZE)
      } catch {
        // The backend is up but this request failed — a transient fault, worth
        // a toast. The raw error is not: it tells a player nothing.
        setToast({ tone: 'warning', message: 'Could not load the leaderboard. Try again shortly.' })
      }
      setLoading(false)
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId, endless, offset])

  return (
    <div className={styles.container} ref={containerRef} tabIndex={-1}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>LEADERBOARD</h2>
          <p className={styles.subtitle}>Scores verified by replaying the run server-side</p>
        </div>

        {/* World + mode selector */}
        <div className={styles.filters}>
          <div className={styles.filterGroup}>
            {WORLDS.map((w) => (
              <button
                key={w.id}
                className={`${styles.filterBtn} ${worldId === w.id ? styles.filterBtnActive : ''}`}
                onClick={() => { setWorldId(w.id) }}
                aria-pressed={worldId === w.id}
              >
                {w.name.toUpperCase()}
              </button>
            ))}
          </div>
          <div className={styles.filterGroup}>
            <button
              className={`${styles.filterBtn} ${!endless ? styles.filterBtnActive : ''}`}
              onClick={() => { setEndless(false) }}
              aria-pressed={!endless}
            >
              CAMPAIGN
            </button>
            <button
              className={`${styles.filterBtn} ${endless ? styles.filterBtnActive : ''}`}
              onClick={() => { setEndless(true) }}
              aria-pressed={endless}
            >
              ENDLESS
            </button>
          </div>
        </div>

        {/* Table */}
        <div className={styles.scrollArea}>
          {offline ? (
            <p className={styles.empty}>
              Leaderboards are not enabled in this build. Scores are verified by
              replaying the run on a server, and this copy of the game is running
              without one — everything else works exactly as it should.
            </p>
          ) : entries.length === 0 && !loading ? (
            <p className={styles.empty}>No verified scores yet for this mode. Be the first.</p>
          ) : (
            <table className={styles.table} aria-label="Leaderboard">
              <thead>
                <tr className={styles.tableHead}>
                  <th className={styles.thRank}>#</th>
                  <th className={styles.thPilot}>PILOT</th>
                  <th className={styles.thScore}>SCORE</th>
                  <th className={styles.thWave}>WAVE</th>
                  <th className={styles.thOutposts}>OUTPOSTS</th>
                  <th className={styles.thSeed}>SEED</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={`${entry.rank}-${entry.displayName}`} className={styles.tableRow}>
                    <td className={styles.tdRank}>{entry.rank}</td>
                    {/* Text node — never innerHTML. */}
                    <td className={styles.tdPilot}>{entry.displayName}</td>
                    <td className={styles.tdScore}>{entry.score.toLocaleString()}</td>
                    <td className={styles.tdWave}>{entry.wave}</td>
                    <td className={styles.tdOutposts}>{entry.outpostsRemaining}/{OUTPOST_COUNT}</td>
                    <td className={styles.tdSeed}>{entry.seed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {loading && <p className={styles.loadingNote}>Loading…</p>}

          {!loading && hasMore && entries.length > 0 && (
            <div className={styles.loadMore}>
              <Button label="LOAD MORE" onClick={() => { setOffset((o) => o + PAGE_SIZE) }} />
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <Button label="BACK [ESC]" onClick={back} />
        </div>
      </div>
    </div>
  )
}
