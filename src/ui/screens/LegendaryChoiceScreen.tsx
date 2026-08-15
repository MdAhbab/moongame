/**
 * The salvage draft — what you get to keep after being destroyed (§10).
 *
 * ## Why this screen exists
 *
 * Perks persist for a whole run, so by wave nine a player is flying a build
 * they spent nine drafts assembling. Losing the craft wipes it. That is the
 * right cost — it is the same currency every other consequence in this game is
 * denominated in — but the *replacement* used to be a single legendary chosen
 * at random and pushed into the run silently. The worst moment in a run was
 * therefore the one moment the player had no agency in at all: you watched your
 * build vanish and watched something arbitrary take its place.
 *
 * Three cards turns that into the most consequential decision of the run. You
 * have nothing, so whatever you take here defines everything after it — and it
 * is a legendary, so it is genuinely a hand worth playing rather than a
 * consolation.
 *
 * ## Why the offer comes from the simulation
 *
 * `world.legendaryOffer` is drawn in `step.ts` from the run's seeded RNG, so
 * the same seed always faces the same three cards. The *pick* is made here and
 * pushed into `world.activePerks`, which is exactly how the post-wave draft has
 * always worked — React owns the choice, the simulation owns the offer.
 */
import { useGameStore } from '../../state/useGameStore'
import { PERKS_BY_ID, type Perk } from '../../game/data/perks'
import { Button } from '../components/ui'
import styles from './WaveClearScreen.module.css'

export function LegendaryChoiceScreen({
  offer,
  onResolve,
}: {
  offer: readonly string[]
  /** Called with the pick, or `null` when the player declines all three. */
  onResolve: (perkId: string | null) => void
}): React.JSX.Element {
  const goto = useGameStore((s) => s.goto)

  const cards = offer
    .map((id) => PERKS_BY_ID.get(id))
    .filter((perk): perk is Perk => perk !== undefined)

  // Resolving *clears the offer* as well as applying it. Leaving it set would
  // put the router straight back here on the next poll, which is a loop the
  // player cannot escape.
  const take = (perkId: string | null): void => {
    onResolve(perkId)
    goto('Playing')
  }

  return (
    <div className={styles.container}>
      <div className={styles.waveBadge}>AIRFRAME LOST</div>

      <p className={styles.salvageNote}>
        The build went with the hull. Salvage recovered three legendary systems from the
        wreck — <strong>you may fit one</strong>.
      </p>

      <div className={styles.perkSection}>
        <div className={styles.perkHeader}>SELECT SALVAGED SYSTEM</div>
        <div className={styles.perkGrid}>
          {cards.map((perk) => (
            <button
              key={perk.id}
              className={`${styles.perkCard} ${styles.rarityLegendary}`}
              onClick={() => { take(perk.id) }}
              type="button"
            >
              <div className={styles.perkTop}>
                <span className={styles.perkIcon}>{perk.icon}</span>
                <span className={styles.rarityBadge}>LEGENDARY</span>
              </div>
              <div className={styles.perkTitle}>{perk.name}</div>
              <div className={styles.perkDesc}>{perk.description}</div>
              <div className={styles.perkHowTo}>
                <span className={styles.perkHowToLabel}>HOW</span>
                {perk.howToUse}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/*
        A way out that is not a card. Refusing is a legitimate read — none of
        the three may suit how the run has been going — and a modal with no
        exit but "choose" is a modal that can strand a player who dislikes all
        three.
      */}
      <div className={`${styles.actions} ${styles.actionsVisible}`}>
        <Button label="FLY WITHOUT ONE →" onClick={() => { take(null) }} />
      </div>
    </div>
  )
}
