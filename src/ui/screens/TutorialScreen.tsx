/**
 * The tutorial's overlay — one card per beat, over the live game.
 *
 * ## These cards used to describe a different game
 *
 * `TutorialSystem` runs three beats: FLY (complete a half-orbit), SHOOT
 * (destroy three inert drones), DEFEND (save one outpost from two Harvesters).
 * The cards here described lock-on missiles, boost, and "protect the outposts",
 * in that order, keyed to the same three indices. So beat 1 — three drones
 * hanging in front of you, waiting to be shot — was captioned *"Right-click to
 * acquire a missile lock"*, and a player who followed the instruction sat there
 * holding a lock on a drone while the card refused to advance, because the gate
 * counts kills.
 *
 * A tutorial that tells you to do something other than the thing it is waiting
 * for is worse than no tutorial: it teaches the player that the game's own
 * instructions cannot be trusted. The cards and the gates are now written from
 * the same three verbs, and the gate condition is printed on the card so there
 * is never a question about what the game is waiting for.
 *
 * Key names come from the player's actual bindings and are labelled for their
 * platform, so a Mac reads ⌃ and a rebound key reads as itself.
 */
import { useGameStore } from '../../state/useGameStore'
import { useSettingsStore } from '../../state/useSettingsStore'
import { bindingsLabel, hasKeyboard } from '../../platform/deviceInput'
import { CONTROL_ROWS } from '../../platform/controlScheme'
import { PlayingScreen } from './PlayingScreen'
import { Button } from '../components/ui'
import styles from './TutorialScreen.module.css'

interface BeatInfo {
  headline: string
  body: string
  goal: string
  illustration: string
  alt: string
}

export function TutorialScreen() {
  const goto = useGameStore(s => s.goto)
  const tutorialBeat = useGameStore(s => s.tutorialBeat)
  // Read once per beat change, which is the only time this component renders.
  const keybinds = useSettingsStore.getState().keybinds

  /**
   * Key names come from the canonical table, so a rebind is reflected here and
   * the tutorial cannot drift from Settings. It did drift, badly: these cards
   * once told players to hold Shift to boost long after boost had moved.
   */
  const how = (id: string, actions: readonly (keyof typeof keybinds)[]): string => {
    if (!hasKeyboard) {
      return CONTROL_ROWS.find((row) => row.id === id)?.touch ?? 'the on-screen controls'
    }
    return actions.map((action) => bindingsLabel(keybinds[action])).join(' / ')
  }

  const turn = `${how('turn', ['turnLeft', 'turnRight'])}${hasKeyboard ? ', or the mouse' : ''}`
  const slide = how('strafe', ['strafeLeft', 'strafeRight'])
  const fire = how('fire', ['fire'])
  const climb = how('altitude', ['ascend', 'descend'])
  const boost = how('boost', ['boost'])

  const beats: Record<number, BeatInfo> = {
    0: {
      headline: 'FLY',
      body: `You are in a low orbit around a small moon, and the ground curves away in every direction. Turn with ${turn}. Climb and dive with ${climb}. Hold ${boost} for a burst of speed. ${slide} slides you sideways without turning — it is how you dodge without losing your heading.`,
      goal: 'Fly half way around the moon.',
      illustration: '/tutorial/beat-fly.jpg',
      alt: 'A craft banking over a curved horizon with an exhaust trail',
    },
    1: {
      headline: 'SHOOT',
      body: `Three inert drones are parked ahead of you. Put the crosshair in the middle of the screen on one and hold ${fire}. The gun has no ammunition — it has heat, so it stops if you hold it down forever.`,
      goal: 'Destroy all three drones.',
      illustration: '/tutorial/beat-shoot.jpg',
      alt: 'A targeting reticle centred on a drone silhouette',
    },
    2: {
      headline: 'DEFEND',
      body: 'Two Harvesters are descending on an outpost. Once they land they deploy a drain beam, and the outpost bar on the left starts falling. Killing them stops the drain — landed or not.',
      goal: 'Clear both Harvesters with the outpost still standing.',
      illustration: '/tutorial/beat-defend.jpg',
      alt: 'Harvester craft descending onto a hexagonal outpost',
    },
  }

  const beat = tutorialBeat >= 0 ? beats[tutorialBeat] : undefined

  return (
    <div className={styles.container}>
      {/* The live game runs behind this. Its own controls card is suppressed —
          this one is more specific and occupies the same space. */}
      <PlayingScreen showHint={false} />

      <div className={styles.overlay} aria-live="polite">
        {beat && (
          <div className={styles.beatCard} key={tutorialBeat}>
            {/* Optional by construction: a missing file hides itself rather
                than showing a broken-image icon, so the card is complete with
                or without art. */}
            <img
              src={beat.illustration}
              alt={beat.alt}
              className={styles.illustration}
              width={96}
              height={96}
              onError={(event) => { event.currentTarget.style.display = 'none' }}
            />
            <div className={styles.beatContent}>
              <h2 className={styles.headline}>
                <span className={styles.beatIndex}>{tutorialBeat + 1}/3</span>
                {beat.headline}
              </h2>
              <p className={styles.body}>{beat.body}</p>
              <p className={styles.hint}>▸ {beat.goal}</p>
            </div>
          </div>
        )}

        <div className={styles.actions}>
          <Button
            label="SKIP TRAINING"
            primary
            onClick={() => goto('Title')}
          />
        </div>
      </div>
    </div>
  )
}
