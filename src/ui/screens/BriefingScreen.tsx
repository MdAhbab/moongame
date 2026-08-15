/**
 * Briefing — four seconds of orientation before the pressure starts
 * (gameplan §11, §14.3).
 *
 * "Gives the player a plan before the pressure starts, which is what turns the
 * wave into a decision rather than a reaction."
 *
 * Every number here is real: the wave's authored briefing, the outposts it
 * actually targets, the composition it will actually send, and the drain window
 * those Harvesters will actually open. Fake telemetry trains players to ignore
 * the interface, and this screen exists specifically to be trusted.
 */
import { useEffect, useState } from 'react'
import { useGameStore } from '../../state/useGameStore'
import { Button } from '../components/ui'
import { waveAt, waveDefinition, waveEnemyCount, drainDuration, type WaveDefinition } from '../../game/data/waves'
import { ARCHETYPES } from '../../game/data/enemies'
import { OUTPOSTS } from '../../game/data/outposts'
import { BRIEFING_DURATION, DRAIN_RATE_PER_HARVESTER } from '../../game/data/constants'
import styles from './BriefingScreen.module.css'

export function BriefingScreen() {
  const goto = useGameStore((s) => s.goto)
  const waveNumber = useGameStore((s) => s.wave)
  const endless = useGameStore((s) => s.endless)
  // Past wave 12 in Endless the definition is synthesised, so the Briefing must
  // ask for it the same way the spawner does — otherwise it would fall back to
  // wave 1 and brief the player on a wave they are not about to fly.
  const wave = waveDefinition(waveNumber, endless) ?? waveAt(1)

  const [remaining, setRemaining] = useState(BRIEFING_DURATION)

  /**
   * Auto-advances after four seconds, and is skippable at any point (§14.3).
   *
   * A countdown rather than a bare timer because the player should be able to
   * see how long they have to read — a screen that vanishes without warning
   * teaches them not to read the next one.
   */
  useEffect(() => {
    const started = performance.now()
    let handle = 0
    const tick = (): void => {
      const left = BRIEFING_DURATION - (performance.now() - started) / 1000
      if (left <= 0) {
        goto('Playing')
        return
      }
      setRemaining(left)
      handle = window.setTimeout(tick, 100)
    }
    handle = window.setTimeout(tick, 100)
    return () => window.clearTimeout(handle)
  }, [goto])

  if (wave === undefined) return null

  const drainSeconds = drainDuration(wave, DRAIN_RATE_PER_HARVESTER)

  // The roster comes from the 10 Hz meta sync, which is driven by the render
  // frame — so on the very first Briefing of a session it can still be empty,
  // and `filter(...).length` on an empty array reads "0 of 8 outposts still
  // standing" to a player who has not yet lost anything. An unsynced roster
  // means "no losses recorded", not "everything is gone".
  const roster = useGameStore.getState().outposts
  const standing = roster.length === 0 ? OUTPOSTS.length : roster.filter((o) => o.status !== 'Lost').length

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <h2 className={styles.title}>
          WAVE {wave.number} — {wave.title}
        </h2>

        <p className={styles.description}>{wave.briefing}</p>

        {wave.newElement !== null && (
          <div className={styles.newElement}>
            ⚠ NEW THREAT: {wave.newElement}
          </div>
        )}

        <dl className={styles.stats}>
          <div>
            <dt>THREATENED</dt>
            <dd>{wave.threatened} outposts</dd>
          </div>
          <div>
            <dt>SPREAD</dt>
            <dd>{wave.spread}</dd>
          </div>
          <div>
            <dt>INBOUND</dt>
            <dd>{waveEnemyCount(wave)} contacts</dd>
          </div>
          <div>
            <dt>DRAIN WINDOW</dt>
            <dd>{drainSeconds.toFixed(0)}s / outpost</dd>
          </div>
        </dl>

        <p className={styles.composition}>
          {wave.harvestersPerOutpost * wave.threatened} Harvesters
          {wave.interceptors > 0 ? ` · ${wave.interceptors} Interceptors` : ''}
          {wave.sentinels > 0 ? ` · ${wave.sentinels} Sentinels` : ''}
        </p>

        <ThreatCards wave={wave} />

        <p className={styles.roster}>
          {standing} of {OUTPOSTS.length} outposts still standing
        </p>

        <div className={styles.actions}>
          <Button label={`LAUNCH (${remaining.toFixed(0)}s)`} primary onClick={() => goto('Playing')} full />
        </div>
      </div>
    </div>
  )
}

/**
 * What is coming, what it does, and what it looks like.
 *
 * The Briefing already counted the contacts, and a count is not an
 * explanation — "12 Harvesters" tells a new player nothing about why they
 * should care, which is exactly the reported confusion: *the enemies sit on
 * bases, but then what?* Each archetype already carries a one-line `role` and a
 * `silhouette` written for precisely this, and neither had ever been shown
 * anywhere in the running game.
 *
 * Only the archetypes this wave actually sends appear, so wave 1 introduces one
 * threat rather than three, and each new one arrives on the wave that adds it.
 *
 * The artwork is optional by construction. A missing file hides its own image
 * and the card falls back to the `silhouette` description, so the screen is
 * complete either way rather than showing a broken-image icon.
 */
function ThreatCards({ wave }: { wave: WaveDefinition }): React.JSX.Element | null {
  const present = ARCHETYPES.filter((archetype) => {
    if (archetype.name === 'Harvester') return wave.harvestersPerOutpost > 0
    if (archetype.name === 'Interceptor') return wave.interceptors > 0
    return wave.sentinels > 0
  })
  if (present.length === 0) return null

  return (
    <ul className={styles.threats}>
      {present.map((archetype) => (
        <li key={archetype.name} className={styles.threatCard}>
          <img
            src={`/enemies/${archetype.name.toLowerCase()}.png`}
            alt=""
            aria-hidden="true"
            className={styles.threatArt}
            width={64}
            height={64}
            onError={(event) => { event.currentTarget.style.display = 'none' }}
          />
          <div className={styles.threatText}>
            <span className={styles.threatName}>{archetype.name}</span>
            <span className={styles.threatRole}>{archetype.role}</span>
            <span className={styles.threatSilhouette}>{archetype.silhouette}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}
