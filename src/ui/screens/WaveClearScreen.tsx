/**
 * WaveClearScreen — 3-second staggered breakdown + Roguelike Holographic Perk Draft (gameplan §11, §14.3).
 *
 * Displays:
 * 1. Wave completion achievements and combat scoring stats.
 * 2. Sector Defense Dividends Revenue (Credits earned).
 * 3. 1-of-3 Holographic Perk Cards Draft Selection before moving to next wave.
 */
import { useEffect, useRef, useState } from 'react'
import { useGameStore } from '../../state/useGameStore'
import { useSettingsStore } from '../../state/useSettingsStore'
import { Button } from '../components/ui'
import { drawRandomPerks, type Perk } from '../../game/data/perks'
import styles from './WaveClearScreen.module.css'

/** Eased count-up using rAF. Correct cleanup on unmount and target change. */
function useCountUp(target: number, run: boolean, ms = 500): number {
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (!run) { setValue(0); return }
    const start = performance.now()
    let raf = 0
    const tick = (now: number): void => {
      const p = Math.min(1, (now - start) / ms)
      const eased = 1 - Math.pow(1 - p, 3)   // cubic ease-out
      setValue(Math.round(target * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, run, ms])
  return value
}

interface StatLineProps {
  label: string
  value: number
  hero?: boolean
  run: boolean
  delay: number
}

function StatLine({ label, value, hero, run, delay }: StatLineProps): React.JSX.Element {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!run) { setVisible(false); return }
    const t = setTimeout(() => setVisible(true), delay)
    return () => clearTimeout(t)
  }, [run, delay])
  const counted = useCountUp(value, visible)

  return (
    <div
      className={`${styles.statLine} ${visible ? styles.statLineVisible : ''} ${hero ? styles.statLineHero : ''}`}
    >
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>+{counted.toLocaleString()}</span>
    </div>
  )
}

const LINE_COUNT = 4
const LINE_DELAY = 160
const TOTAL_DELAY = LINE_COUNT * LINE_DELAY + 350
const READY_DELAY = TOTAL_DELAY + 500

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

  const [phase, setPhase] = useState<'stats' | 'total' | 'ready'>('stats')
  const [perkOptions, setPerkOptions] = useState<Perk[]>([])
  const [selectedPerkId, setSelectedPerkId] = useState<string | null>(null)
  const timersRef = useRef<number[]>([])
  const creditedRef = useRef(false)

  useEffect(() => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    setPhase('stats')

    // Generate 3 random holographic perks for this wave clear draft
    const drafted = drawRandomPerks(activePerks, undefined, 3)
    setPerkOptions(drafted)

    timersRef.current.push(
      window.setTimeout(() => setPhase('total'), TOTAL_DELAY),
      window.setTimeout(() => setPhase('ready'), READY_DELAY),
    )

    // Award sector revenue dividends once per wave summary mount
    if (waveSummary && !creditedRef.current) {
      creditedRef.current = true
      const credits = waveSummary.creditsEarned ?? waveSummary.outpostsSaved * 150
      addCredits(credits)
    }

    return () => timersRef.current.forEach(clearTimeout)
  }, [waveSummary?.wave, activePerks, addCredits, waveSummary])

  if (!waveSummary) {
    return (
      <div className={styles.container}>
        <div className={styles.waveBadge}>WAVE CLEARED</div>
      </div>
    )
  }

  const s = waveSummary
  const totalKills = s.killsHarvester + s.killsInterceptor + s.killsSentinel
  const killScore = totalKills * 100
  const accuracyScore = Math.round(s.accuracyBonus)
  const outpostScore = s.outpostsSaved * 700
  const waveBonus = s.wave * 300
  const creditsEarned = s.creditsEarned ?? s.outpostsSaved * 150

  const lines: { label: string; value: number; hero: boolean }[] = [
    { label: `Kills ×${totalKills}`, value: killScore, hero: false },
    { label: `Accuracy ${Math.round(s.accuracy * 100)}%`, value: accuracyScore, hero: false },
    { label: `Outposts Saved · ${s.outpostsSaved}`, value: outpostScore, hero: true },
    { label: `Wave ${s.wave} Bonus`, value: waveBonus, hero: false },
  ]

  function handleSelectPerk(perk: Perk) {
    setSelectedPerkId(perk.id)
    onSelectPerk?.(perk.id)
  }

  return (
    <div className={styles.container}>
      <div className={styles.panel}>
        <div className={styles.waveBadge}>WAVE {s.wave} CLEARED</div>

        {s.noDamage > 0 && <div className={styles.bonusBadge}>FLAWLESS — NO DAMAGE TAKEN</div>}
        {s.allIntact > 0 && s.noDamage === 0 && <div className={styles.bonusBadge}>PERFECT DEFENSE</div>}

        <div className={styles.lines} aria-live="polite">
          {lines.map((line, i) => (
            <StatLine
              key={line.label}
              label={line.label}
              value={line.value}
              hero={line.hero}
              run={phase !== 'stats' || i === 0}
              delay={i * LINE_DELAY}
            />
          ))}
        </div>

        {/* Sector Defense Dividends */}
        <div className={styles.creditsRow}>
          <span className={styles.creditsLabel}>
            <span>💳</span> SECTOR DEFENSE REVENUE
          </span>
          <span className={styles.creditsValue}>+{creditsEarned.toLocaleString()} CR</span>
        </div>

        {/* Total Score */}
        <div className={`${styles.totalRow} ${phase !== 'stats' ? styles.totalRowVisible : ''}`}>
          <span className={styles.totalLabel}>WAVE SCORE</span>
          <span className={styles.totalValue}>
            <TotalCount target={s.score} run={phase !== 'stats'} />
          </span>
        </div>

        {/* Roguelike Perk Selection Draft */}
        {perkOptions.length > 0 && (
          <div className={styles.perkSection}>
            <div className={styles.perkHeader}>SELECT TACTICAL UPGRADE</div>
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
                    onClick={() => handleSelectPerk(perk)}
                    type="button"
                  >
                    <div className={styles.perkTop}>
                      <span className={styles.perkIcon}>{perk.icon}</span>
                      <span className={styles.rarityBadge}>{perk.rarity.toUpperCase()}</span>
                    </div>
                    <div className={styles.perkTitle}>{perk.name}</div>
                    <div className={styles.perkDesc}>{perk.description}</div>
                    <div className={styles.perkBuffText}>{perk.quote}</div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className={`${styles.actions} ${phase === 'ready' ? styles.actionsVisible : ''}`}>
          <Button
            label={selectedPerkId ? "NEXT WAVE →" : "CONTINUE →"}
            primary
            onClick={() => {
              timersRef.current.forEach(clearTimeout)
              goto('Debrief')
            }}
            full
          />
        </div>
      </div>
    </div>
  )
}

/** Separate component so the count-up only starts when `run` becomes true. */
function TotalCount({ target, run }: { target: number; run: boolean }): React.JSX.Element {
  const v = useCountUp(target, run, 700)
  return <>{v.toLocaleString()}</>
}
