/**
 * WaveClearScreen — the wave breakdown and the between-wave perk draft
 * (gameplan §11, §14.3).
 *
 * Shows what the wave paid, what it earned, and offers one of three perks
 * before the next one starts.
 *
 * ## Why the counters are written through refs
 *
 * This screen used to run **five concurrent `requestAnimationFrame` loops**, one
 * per counter, each calling `setState` on every tick. That is roughly three
 * hundred React renders a second, on the one screen where the 3D scene is still
 * mounted and drawing at full DPR behind a translucent overlay — so the compositor
 * was doing its most expensive work at exactly the moment the main thread was
 * busiest. It read as the game locking up between waves, which is precisely what
 * it was: the tab had no idle time left to service input with.
 *
 * §17.2's rule is written for `Playing`, but the reasoning is not specific to it —
 * *per-frame values do not belong in React state on any screen*. So this file
 * follows `hudRefs.ts`: one driver, one `rAF`, values written straight to DOM
 * nodes. React sees three state transitions for the whole screen (`stats` →
 * `total` → `ready`), which are genuine events rather than samples of an
 * animation.
 *
 * Reduced motion skips the count entirely and prints the finished numbers. A
 * player who has asked the system to stop animating things has not asked for
 * a shorter animation.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useGameStore } from '../../state/useGameStore'
import { useSettingsStore } from '../../state/useSettingsStore'
import { Button } from '../components/ui'
import { uiConfirm } from '../../audio/uiBus'
import { drawRandomPerks, type Perk } from '../../game/data/perks'
import { summaryKills } from '../../game/core/readModel'
import styles from './WaveClearScreen.module.css'

const LINE_COUNT = 4
const LINE_DELAY = 160
const TOTAL_DELAY = LINE_COUNT * LINE_DELAY + 350
const READY_DELAY = TOTAL_DELAY + 500

/** Milliseconds a single stat line takes to count up, once it starts. */
const LINE_COUNT_MS = 500
/** The wave total counts for longer, because it is the number that matters. */
const TOTAL_COUNT_MS = 700

/** Cubic ease-out. Fast first, so the number is readable long before it settles. */
function eased(t: number): number {
  const p = t < 0 ? 0 : t > 1 ? 1 : t
  return 1 - Math.pow(1 - p, 3)
}

interface Line {
  label: string
  value: number
  hero: boolean
}

export function WaveClearScreen({
  activePerks = [],
  onSelectPerk,
}: {
  activePerks?: string[]
  onSelectPerk?: (perkId: string) => void
}): React.JSX.Element {
  const goto = useGameStore((s) => s.goto)
  const waveSummary = useGameStore((s) => s.waveSummary)
  const addCredits = useSettingsStore((s) => s.addCredits)
  const reducedMotion = useSettingsStore((s) => s.settings.accessibility.reducedMotion)

  const [phase, setPhase] = useState<'stats' | 'total' | 'ready'>('stats')
  const [perkOptions, setPerkOptions] = useState<Perk[]>([])
  const [selectedPerkId, setSelectedPerkId] = useState<string | null>(null)

  /**
   * The DOM nodes the counters write into.
   *
   * A plain array rather than one ref per line, so adding a line is a change to
   * `lines` and nothing else.
   */
  const valueRefs = useRef<(HTMLSpanElement | null)[]>([])
  const totalRef = useRef<HTMLSpanElement | null>(null)

  /**
   * The wave this screen has already settled.
   *
   * Keyed on the wave *number*, not on a mounted flag. The 4 Hz phase poller in
   * `App` can land one more tick after it has routed here — clearing an interval
   * does not un-queue a callback already due — and each tick writes a **fresh**
   * `waveSummary` object. A guard that tracked "have I run yet" on a ref would
   * survive that, but a guard on the *identity* of the summary would not, and the
   * effect below used to depend on the whole object: the perk draft was re-rolled
   * under the player's finger, and a card they had reached for became a different
   * card. Comparing wave numbers is the only version that is stable against both
   * a late tick and a remount.
   */
  const settledWave = useRef(-1)

  const wave = waveSummary?.wave ?? -1

  /**
   * The breakdown, in the terms the scoring model actually uses.
   *
   * Every line here is a number `settleWave` paid. The previous version showed
   * `kills x 100`, `outpostsSaved x 700` and `wave x 300` — none of which are
   * terms in the model — and printed `accuracyBonus`, which is a *multiplier*
   * between 1.0 and 2.5, as a points value with a plus sign in front of it. So a
   * player who shot well saw "+2" and four rows that did not add up to the total
   * underneath them. §12 rules out an interface that lies about the game.
   *
   * These four plus the kill score are exactly `waveTotal`, so the rows sum to
   * the number below them, which is the only version of this screen worth
   * showing.
   */
  const summaryLines = useCallback((): Line[] => {
    if (!waveSummary) return []
    const s = waveSummary
    const lines: Line[] = [
      { label: `Kills ×${summaryKills(s)}`, value: s.score, hero: false },
      { label: `Accuracy ${Math.round(s.accuracy * 100)}%`, value: s.accuracyBonusApplied, hero: false },
      { label: `Outposts Held · ${s.outpostsSaved}`, value: s.survivalPoints, hero: true },
    ]
    // The two conditional bonuses only appear when they were earned. A row
    // reading "+0" is worse than no row: it draws the eye to a thing that did
    // not happen.
    if (s.noDamage > 0) lines.push({ label: 'Flawless', value: s.noDamage, hero: false })
    else if (s.allIntact > 0) lines.push({ label: 'Perfect Defense', value: s.allIntact, hero: false })
    return lines
  }, [waveSummary])

  /* ---- per-wave settlement: credits, perk draft, reveal choreography ---- */
  useEffect(() => {
    if (wave < 0 || settledWave.current === wave) return
    settledWave.current = wave
    setSelectedPerkId(null)
    setPerkOptions(drawRandomPerks(activePerks, undefined, 3))

    // The wave's real earnings: sector revenue plus every bounty banked since
    // it began. This used to read `creditsEarned ?? outpostsSaved * 150`, and
    // the left side was structurally always zero — so the fallback was the only
    // branch that ever ran, and the profile was credited a number the
    // simulation had never computed while every combat bounty was discarded.
    const summary = useGameStore.getState().waveSummary
    if (summary) addCredits(summary.creditsEarned)
    // `activePerks` is the live array off the world and is mutated in place, so
    // its identity never changes and it cannot re-trigger this. It is read here
    // rather than listed as a dependency for exactly that reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wave, addCredits])

  /* ---- reveal choreography: three transitions, not three hundred ---- */
  useEffect(() => {
    if (wave < 0) return
    if (reducedMotion) {
      setPhase('ready')
      return
    }
    setPhase('stats')
    const timers = [
      window.setTimeout(() => { setPhase('total') }, TOTAL_DELAY),
      window.setTimeout(() => { setPhase('ready') }, READY_DELAY),
    ]
    return () => { for (const t of timers) clearTimeout(t) }
  }, [wave, reducedMotion])

  /* ---- one driver for every counter on the screen ---- */
  useEffect(() => {
    if (wave < 0) return
    const lines = summaryLines()
    // The sum of the rows, not `score` — which is the kill total alone and
    // would have printed less than the lines above it added up to.
    const total = lines.reduce((sum, line) => sum + line.value, 0)

    const write = (node: HTMLSpanElement | null, value: number, prefix: string): void => {
      if (node !== null) node.textContent = prefix + Math.round(value).toLocaleString()
    }

    // Reduced motion, or a screen that has already finished its reveal: print
    // the finished numbers and never schedule a frame.
    if (reducedMotion) {
      for (let i = 0; i < lines.length; i++) write(valueRefs.current[i] ?? null, lines[i]?.value ?? 0, '+')
      write(totalRef.current, total, '')
      return
    }

    const start = performance.now()
    let raf = 0
    const tick = (now: number): void => {
      const elapsed = now - start
      let done = true

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line === undefined) continue
        const t = (elapsed - i * LINE_DELAY) / LINE_COUNT_MS
        if (t < 1) done = false
        write(valueRefs.current[i] ?? null, line.value * eased(t), '+')
      }

      const totalT = (elapsed - TOTAL_DELAY) / TOTAL_COUNT_MS
      if (totalT < 1) done = false
      write(totalRef.current, total * eased(totalT), '')

      if (!done) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf) }
  }, [wave, reducedMotion, summaryLines, waveSummary])

  if (!waveSummary) {
    return (
      <div className={styles.container}>
        <div className={styles.waveBadge}>WAVE CLEARED</div>
      </div>
    )
  }

  const s = waveSummary
  const lines = summaryLines()
  const creditsEarned = s.creditsEarned

  function handleSelectPerk(perk: Perk): void {
    if (selectedPerkId !== null) return
    setSelectedPerkId(perk.id)
    uiConfirm()
    onSelectPerk?.(perk.id)
  }

  return (
    <div className={styles.container}>
      <div className={styles.panel}>
        <div className={styles.waveBadge}>WAVE {s.wave} CLEARED</div>

        {s.noDamage > 0 && <div className={styles.bonusBadge}>FLAWLESS — NO DAMAGE TAKEN</div>}
        {s.allIntact > 0 && s.noDamage === 0 && <div className={styles.bonusBadge}>PERFECT DEFENSE</div>}

        <div className={styles.lines}>
          {lines.map((line, i) => (
            <div
              key={line.label}
              className={`${styles.statLine} ${styles.statLineVisible} ${line.hero ? styles.statLineHero : ''}`}
              style={reducedMotion ? undefined : { animationDelay: `${String(i * LINE_DELAY)}ms` }}
            >
              <span className={styles.statLabel}>{line.label}</span>
              <span
                className={styles.statValue}
                ref={(node) => { valueRefs.current[i] = node }}
              >
                +0
              </span>
            </div>
          ))}
        </div>

        {/* Sector Defense Dividends */}
        <div className={styles.creditsRow}>
          <span className={styles.creditsLabel}>SECTOR DEFENSE REVENUE</span>
          <span className={styles.creditsValue}>+{creditsEarned.toLocaleString()} CR</span>
        </div>

        {/* Total Score. The rows above sum to exactly this. */}
        <div className={`${styles.totalRow} ${phase !== 'stats' ? styles.totalRowVisible : ''}`}>
          <span className={styles.totalLabel}>WAVE SCORE</span>
          <span className={styles.totalValue} ref={totalRef}>0</span>
        </div>

        {/* One-of-three perk draft */}
        {perkOptions.length > 0 && (
          <div className={styles.perkSection}>
            <div className={styles.perkHeader}>
              {selectedPerkId === null ? 'SELECT TACTICAL UPGRADE' : 'UPGRADE FITTED'}
            </div>
            <div className={styles.perkGrid}>
              {perkOptions.map((perk) => {
                const isSelected = selectedPerkId === perk.id
                const rarityClass =
                  perk.rarity === 'legendary'
                    ? styles.rarityLegendary
                    : perk.rarity === 'epic'
                      ? styles.rarityEpic
                      : perk.rarity === 'rare'
                        ? styles.rarityRare
                        : styles.rarityCommon

                return (
                  <button
                    key={perk.id}
                    className={`${styles.perkCard} ${rarityClass} ${isSelected ? styles.perkCardSelected : ''}`}
                    onClick={() => { handleSelectPerk(perk) }}
                    // A draft is one pick. Leaving the others live after a
                    // choice invites a second click that silently does nothing,
                    // which reads as the screen having frozen.
                    disabled={selectedPerkId !== null && !isSelected}
                    aria-pressed={isSelected}
                    type="button"
                  >
                    <div className={styles.perkTop}>
                      <span className={styles.perkIcon}>{perk.icon}</span>
                      <span className={styles.rarityBadge}>{perk.rarity.toUpperCase()}</span>
                    </div>
                    <div className={styles.perkTitle}>{perk.name}</div>
                    <div className={styles.perkDesc}>{perk.description}</div>
                    {/* What to press. Half these perks re-arm a control the
                        player already has, and the card used to end on a
                        flavour line instead of saying so. */}
                    <div className={styles.perkHowTo}>
                      <span className={styles.perkHowToLabel}>HOW</span>
                      {perk.howToUse}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className={`${styles.actions} ${phase === 'ready' ? styles.actionsVisible : ''}`}>
          <Button
            label={selectedPerkId ? 'NEXT WAVE →' : 'CONTINUE →'}
            primary
            onClick={() => {
              /*
               * Straight to the Briefing when the wave cost nothing.
               *
               * The Debrief exists to answer §12.2's P2 — "why did I lose?" —
               * with a timeline and a one-sentence cause. When nothing was lost
               * there is no such question, and the screen degrades to "All
               * outposts secured" over an empty chart: a third full-screen
               * interstitial, and a third click, between one wave and the next.
               * Skipping it when it has nothing to say is what keeps the
               * between-wave beat a beat rather than a menu tree.
               *
               * `cause` is the whole test, and deliberately not `outpostsLost`.
               * That field is the run's cumulative total — outposts stay lost
               * for the run — so gating on it would show the Debrief for every
               * wave after the first loss, including the ones held perfectly.
               * `describeCause` is scoped to this wave, so a null cause means
               * exactly "this wave cost you nothing".
               */
              goto(s.cause === null ? 'Briefing' : 'Debrief')
            }}
            full
          />
        </div>
      </div>
    </div>
  )
}
