import { useGameStore } from '../../state/useGameStore'
import { useSettingsStore } from '../../state/useSettingsStore'
import { levelForXp, titleForLevel } from '../../game/data/progression.ts'
import { Button } from '../components/ui'
import styles from './TitleScreen.module.css'

export function TitleScreen() {
  const goto = useGameStore(s => s.goto)
  const push = useGameStore(s => s.push)
  const setEndless = useGameStore(s => s.setEndless)
  const pilotXp = useSettingsStore(s => s.progress.pilotXp)
  const trophyIron = useSettingsStore(s => s.progress.achievements.trophyIron)
  const tutorialCompleted = useSettingsStore(s => s.progress.tutorialCompleted)
  const pilotLevel = levelForXp(pilotXp)

  /**
   * Endless is gated on the same fact that awards the Trophy Iron livery:
   * clearing wave 12. Reusing the achievement rather than adding a second flag
   * keeps "have you finished the campaign" a single stored truth — two flags
   * would eventually disagree, and the one the player could see would be the
   * one that was wrong.
   */
  const endlessUnlocked = trophyIron

  const startRun = (endless: boolean) => {
    setEndless(endless)
    goto('Briefing')
  }

  return (
    <div className={styles.container}>
      {/* 3D Scene is rendering the moon in the background behind this UI */}
      <div className={styles.menu}>
        <h1 className={styles.title}>MARE NOCTIS</h1>
        {pilotLevel > 1 && (
          <p className={styles.level}>
            {titleForLevel(pilotLevel).title.toUpperCase()} · PILOT LVL {pilotLevel}
          </p>
        )}
        <div className={styles.buttons}>
          <Button label="START RUN" primary onClick={() => { startRun(false) }} full />
          {endlessUnlocked && (
            <Button label="ENDLESS" onClick={() => { startRun(true) }} full />
          )}
          <Button label="HANGAR" onClick={() => push('Hangar')} full />
          {/* Highlighted until it has been flown. The single most common thing
              a new player says about this game is that they do not know what to
              do, and the answer is three minutes long and already written. */}
          <Button
            label={tutorialCompleted ? 'TUTORIAL' : 'TUTORIAL — START HERE'}
            primary={!tutorialCompleted}
            onClick={() => goto('Tutorial')}
            full
          />
          <Button label="PILOT RECORD" onClick={() => push('Profile')} full />
          <Button label="LEADERBOARD" onClick={() => push('Leaderboard')} full />
          {/* `Account` was a union member with a router case and no way in.
              A screen nothing navigates to is a screen nobody has ever seen,
              which means nobody has ever seen it fail either. */}
          <Button label="ACCOUNT" onClick={() => push('Account')} full />
          <Button label="SETTINGS" onClick={() => push('Settings')} full />
          <Button label="CREDITS" onClick={() => push('Credits')} full />
        </div>
      </div>
    </div>
  )
}
