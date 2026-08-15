/**
 * The pilot's career, in one place (gameplan §9).
 *
 * ## Why this screen exists
 *
 * Progression was already real and almost entirely invisible. Pilot XP has
 * accumulated since the first run; there are thirty levels on a power curve,
 * a title every five, thirty parts gated behind them and four liveries earned by
 * achievement. All of it showed up as one line on the Title screen and a bar on
 * the Results panel.
 *
 * A player could not answer "how far am I", "what have I earned", or "what is
 * next" without leaving the game and reading the source. Everything below is
 * data the game already had.
 *
 * ## What it deliberately does not do
 *
 * No currency, no daily rewards, no streaks, no timed offers. XP is a receipt
 * for a run that already happened, not a hook to start another one — the line
 * `progression.ts` states and this screen keeps. The next unlock is shown
 * because it is *information*; there is no countdown attached to it.
 */
import { useGameStore } from '../../state/useGameStore'
import { useSettingsStore } from '../../state/useSettingsStore'
import { Button } from '../components/ui'
import {
  MAX_LEVEL,
  levelForXp,
  titleForLevel,
  xpForLevel,
} from '../../game/data/progression.ts'
import { ALL_PARTS } from '../../game/data/parts.ts'
import { SKINS, isSkinUnlocked, unlockRequirement } from '../../game/data/skins.ts'
import { WORLDS, isWorldUnlocked } from '../../game/data/worlds.ts'
import styles from './ProfileScreen.module.css'

export function ProfileScreen() {
  const back = useGameStore((s) => s.back)
  const progress = useSettingsStore((s) => s.progress)

  const level = levelForXp(progress.pilotXp)
  const title = titleForLevel(level)
  const atMax = level >= MAX_LEVEL

  const thisLevelXp = xpForLevel(level)
  const nextLevelXp = atMax ? thisLevelXp : xpForLevel(level + 1)
  const intoLevel = progress.pilotXp - thisLevelXp
  const levelSpan = Math.max(1, nextLevelXp - thisLevelXp)
  const fraction = atMax ? 1 : Math.min(1, intoLevel / levelSpan)

  const unlockedParts = ALL_PARTS.filter((part) => part.unlockLevel <= level)
  const unlockedSkins = SKINS.filter((skin) =>
    isSkinUnlocked(skin, level, progress.achievements),
  )
  const unlockedWorlds = WORLDS.filter((world) => isWorldUnlocked(world, level))

  /**
   * The next thing that unlocks, whatever kind it is.
   *
   * One answer rather than three lists, because "what is next" is one question.
   * Parts, liveries and worlds are all gated on level, so they compete on the
   * same axis and the nearest one wins.
   */
  const nextUnlock = [
    ...ALL_PARTS.filter((p) => p.unlockLevel > level).map((p) => ({
      level: p.unlockLevel, kind: 'Part', name: p.name,
    })),
    ...SKINS.filter((s) => s.unlock.kind === 'level' && s.unlock.level > level).map((s) => ({
      level: s.unlock.kind === 'level' ? s.unlock.level : 0, kind: 'Livery', name: s.name,
    })),
    ...WORLDS.filter((w) => w.unlockLevel > level).map((w) => ({
      level: w.unlockLevel, kind: 'World', name: w.name,
    })),
  ].sort((a, b) => a.level - b.level)[0]

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>PILOT RECORD</h2>
            <p className={styles.rank}>
              {title.title.toUpperCase()} · LEVEL {level}
            </p>
            <p className={styles.rankNote}>{title.description}</p>
          </div>
          <Button label="BACK [ESC]" onClick={back} />
        </div>

        <div className={styles.xpPanel}>
          <div className={styles.xpHeader}>
            <span>{progress.pilotXp.toLocaleString()} XP</span>
            {atMax ? (
              <span className={styles.xpNext}>MAX LEVEL</span>
            ) : (
              <span className={styles.xpNext}>
                {(nextLevelXp - progress.pilotXp).toLocaleString()} to level {level + 1}
              </span>
            )}
          </div>
          <div
            className={styles.xpBar}
            role="progressbar"
            aria-valuenow={Math.round(fraction * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Progress to level ${String(atMax ? level : level + 1)}`}
          >
            <div className={styles.xpFill} style={{ width: `${fraction * 100}%` }} />
          </div>
          {nextUnlock !== undefined && (
            <p className={styles.nextUnlock}>
              Next at level {nextUnlock.level}: {nextUnlock.kind} — {nextUnlock.name}
            </p>
          )}
        </div>

        <dl className={styles.stats}>
          <Stat label="BEST SCORE" value={progress.bestScore.toLocaleString()} />
          <Stat label="FURTHEST WAVE" value={progress.bestWave === 0 ? '—' : String(progress.bestWave)} />
          <Stat label="PARTS" value={`${String(unlockedParts.length)} / ${String(ALL_PARTS.length)}`} />
          <Stat label="LIVERIES" value={`${String(unlockedSkins.length)} / ${String(SKINS.length)}`} />
          <Stat label="WORLDS" value={`${String(unlockedWorlds.length)} / ${String(WORLDS.length)}`} />
          <Stat label="TRAINING" value={progress.tutorialCompleted ? 'COMPLETE' : 'NOT FLOWN'} />
        </dl>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>COMMENDATIONS</h3>
          <ul className={styles.achievements}>
            {SKINS.filter((skin) => skin.unlock.kind === 'achievement').map((skin) => {
              const earned = isSkinUnlocked(skin, level, progress.achievements)
              return (
                <li
                  key={skin.id}
                  className={`${styles.achievement} ${earned ? styles.achievementEarned : ''}`}
                >
                  <span className={styles.achievementMark} aria-hidden="true">
                    {earned ? '◆' : '◇'}
                  </span>
                  <span className={styles.achievementText}>
                    <strong>{skin.name}</strong>
                    {/* The requirement is shown whether or not it is met. A
                        locked entry with no stated condition is a tease; one
                        with a condition is a goal. */}
                    <span className={styles.achievementHow}>{unlockRequirement(skin)}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <dt className={styles.statLabel}>{label}</dt>
      <dd className={styles.statValue}>{value}</dd>
    </div>
  )
}
