/**
 * HangarScreen — ship customization, parts store, calibration tuning & pilot progression (gameplan §9).
 *
 * Features:
 * - Credits balance & Store purchases
 * - Part Tiers (Mk.I - Mk.IV)
 * - Real-time Slot Calibration Sliders (Thrust vs Agility, Fire-Rate vs Heat, etc.)
 * - Pilot Rank & XP progression
 * - Livery and World selection
 */
import { useState, useMemo } from 'react'
import { useGameStore } from '../../state/useGameStore'
import { useSettingsStore } from '../../state/useSettingsStore'
import { Button } from '../components/ui'
import styles from './HangarScreen.module.css'
import {
  SLOTS,
  PARTS_BY_SLOT,
  FIELD_LABELS,
  isBuff,
  type Slot,
  type Part,
} from '../../game/data/parts.ts'
import {
  resolveLoadout,
  availableParts,
  stockLoadout,
  type EquippedLoadout,
} from '../../game/systems/LoadoutSystem.ts'
import {
  levelForXp,
  xpForLevel,
  titleForLevel,
  MAX_LEVEL,
} from '../../game/data/progression.ts'
import {
  SKINS,
  isSkinUnlocked,
  unlockRequirement,
} from '../../game/data/skins.ts'
import { WORLDS, cruiseFactor, isWorldUnlocked } from '../../game/data/worlds.ts'
import type { LoadoutModifiers } from '../../game/core/World.ts'

const LIVERY_TAB = 'Livery'
const WORLD_TAB = 'World'
type HangarTab = Slot | typeof LIVERY_TAB | typeof WORLD_TAB

const SLOT_LABELS: Record<Slot, string> = {
  Hull: 'HULL',
  Engine: 'ENGINE',
  Weapon: 'WEAPON',
  Targeting: 'TARGETING',
  Support: 'SUPPORT',
  Frame: 'FRAME',
}

const TUNING_LABELS: Partial<Record<Slot, { title: string; left: string; right: string }>> = {
  Engine: {
    title: 'Engine Calibration',
    left: '◀ High Thrust / Velocity',
    right: 'Agile Handling / Turn ▶',
  },
  Weapon: {
    title: 'Capacitor Tuning',
    left: '◀ Rapid Fire / Overclock',
    right: 'Heat Vent / Cryo Cooling ▶',
  },
  Hull: {
    title: 'Armor Plating Balance',
    left: '◀ Reinforced Composite (+HP)',
    right: 'Lightweight Aero (Fast) ▶',
  },
  Targeting: {
    title: 'Guidance Optimization',
    left: '◀ Fast Lock Acquisition',
    right: 'Heavy Warhead Payload ▶',
  },
}

function cssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`
}

function formatDelta(field: keyof LoadoutModifiers, current: number, candidate: number): {
  text: string
  positive: boolean
  neutral: boolean
} {
  const delta = candidate - current
  if (Math.abs(delta) < 0.001) return { text: '—', positive: false, neutral: true }
  const pct = Math.round(delta * 100)
  const sign = pct > 0 ? '+' : ''
  const text = `${sign}${pct}%`
  const positive = isBuff(field, candidate / (current || 1))
  return { text, positive, neutral: false }
}

export function HangarScreen(): React.JSX.Element {
  const back = useGameStore((s) => s.back)
  const goto = useGameStore((s) => s.goto)

  const pilotXp = useSettingsStore((s) => s.progress.pilotXp)
  const credits = useSettingsStore((s) => s.progress.credits)
  const equippedLoadout = useSettingsStore((s) => s.progress.equippedLoadout)
  const unlockedParts = useSettingsStore((s) => s.progress.unlockedParts)
  const partTuning = useSettingsStore((s) => s.progress.partTuning)
  const setEquippedPart = useSettingsStore((s) => s.setEquippedPart)
  const setPartTuning = useSettingsStore((s) => s.setPartTuning)
  const spendCredits = useSettingsStore((s) => s.spendCredits)
  const unlockPart = useSettingsStore((s) => s.unlockPart)

  const skinId = useSettingsStore((s) => s.progress.skinId)
  const achievements = useSettingsStore((s) => s.progress.achievements)
  const setSkin = useSettingsStore((s) => s.setSkin)
  const worldId = useSettingsStore((s) => s.progress.worldId)
  const setWorld = useSettingsStore((s) => s.setWorld)

  const [activeTab, setActiveTab] = useState<HangarTab>('Hull')
  const [hoveredPartId, setHoveredPartId] = useState<string | null>(null)

  const activeSlot: Slot = activeTab === LIVERY_TAB || activeTab === WORLD_TAB ? 'Hull' : activeTab

  const pilotLevel = levelForXp(pilotXp)
  const pilotTitle = titleForLevel(pilotLevel)
  const nextLevelXp = pilotLevel < MAX_LEVEL ? xpForLevel(pilotLevel + 1) : null
  const thisLevelXp = xpForLevel(pilotLevel)
  const xpProgress =
    nextLevelXp !== null ? Math.min(1, (pilotXp - thisLevelXp) / (nextLevelXp - thisLevelXp)) : 1

  const currentResolved = useMemo(
    () =>
      resolveLoadout(
        Object.keys(equippedLoadout).length > 0 ? equippedLoadout : stockLoadout(),
        partTuning,
      ),
    [equippedLoadout, partTuning],
  )

  const candidateResolved = useMemo(() => {
    if (hoveredPartId === null) return currentResolved
    const candidate: EquippedLoadout = { ...equippedLoadout, [activeSlot]: hoveredPartId }
    return resolveLoadout(
      Object.keys(candidate).length > 0 ? candidate : stockLoadout(),
      partTuning,
    )
  }, [hoveredPartId, activeSlot, equippedLoadout, currentResolved, partTuning])

  const partsInSlot = useMemo(
    () => availableParts(activeSlot, pilotLevel),
    [activeSlot, pilotLevel],
  )

  const lockedParts = useMemo(() => {
    const all = PARTS_BY_SLOT[activeSlot] ?? []
    return all.filter((p) => p.unlockLevel > pilotLevel)
  }, [activeSlot, pilotLevel])

  const equippedIdInSlot = equippedLoadout[activeSlot]
  const currentSlotTuning = partTuning[activeSlot] ?? 0

  const deltaFields = useMemo((): Array<{
    field: keyof LoadoutModifiers
    current: number
    candidate: number
  }> => {
    const current = currentResolved.modifiers
    const candidate = candidateResolved.modifiers
    return (Object.keys(FIELD_LABELS) as (keyof LoadoutModifiers)[])
      .map((field) => ({ field, current: current[field], candidate: candidate[field] }))
      .filter(({ current, candidate }) => Math.abs(current - candidate) > 0.001)
  }, [currentResolved, candidateResolved])

  function handleEquip(part: Part): void {
    const isOwned = !part.cost || unlockedParts.includes(part.id)
    if (!isOwned) {
      if (spendCredits(part.cost ?? 0)) {
        unlockPart(part.id)
        setEquippedPart(activeSlot, part.id)
      }
      return
    }

    if (part.id === equippedIdInSlot) {
      setEquippedPart(activeSlot, undefined)
    } else {
      setEquippedPart(activeSlot, part.id)
    }
  }

  const slotTuningMeta = TUNING_LABELS[activeSlot]

  return (
    <div className={styles.container}>
      {/* ── Left panel: pilot card + credits + set bonuses + stat deltas ── */}
      <aside className={styles.sidebar}>
        {/* Pilot identity */}
        <div className={styles.pilotCard}>
          <div className={styles.pilotRank}>{pilotTitle.title.toUpperCase()}</div>
          <div className={styles.pilotLevel}>LVL {pilotLevel}</div>
          <p className={styles.pilotDesc}>{pilotTitle.description}</p>
          <div
            className={styles.xpBar}
            role="progressbar"
            aria-label={`XP progress: ${Math.round(xpProgress * 100)}%`}
            aria-valuenow={Math.round(xpProgress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className={styles.xpFill} style={{ width: `${xpProgress * 100}%` }} />
          </div>
          {nextLevelXp !== null ? (
            <div className={styles.xpText}>
              {pilotXp - thisLevelXp} / {nextLevelXp - thisLevelXp} XP
            </div>
          ) : (
            <div className={styles.xpText}>MAX LEVEL</div>
          )}
        </div>

        {/* Credits Balance */}
        <div className={styles.creditsCard}>
          <div className={styles.creditsLabel}>
            <span>💳</span> CREDITS
          </div>
          <div className={styles.creditsValue}>{credits.toLocaleString()} CR</div>
        </div>

        {/* Cruise speed note */}
        <div className={styles.cruiseCard}>
          <div className={styles.cruiseLabel}>CRUISE SPEED</div>
          <div className={styles.cruiseValue}>
            {currentResolved.cruiseVelocity.toFixed(1)} u/s
            {currentResolved.speedClamped && (
              <span className={styles.clamped}> (band-clamped)</span>
            )}
          </div>
        </div>

        {/* Active set bonuses */}
        {currentResolved.activeSets.length > 0 && (
          <div className={styles.setBonuses}>
            <div className={styles.setBonusTitle}>SET BONUSES</div>
            {currentResolved.activeSets.map((bonus) => (
              <div key={bonus.manufacturer} className={styles.setBonus}>
                <div className={styles.setBonusName}>
                  {bonus.manufacturer} ({bonus.pieces}pc)
                </div>
                <div className={styles.setBonusLabel}>{bonus.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Live delta preview */}
        {deltaFields.length > 0 && (
          <div className={styles.deltaPanel}>
            <div className={styles.deltaPanelTitle}>PREVIEW CHANGES</div>
            {deltaFields.map(({ field, current, candidate }) => {
              const { text, positive, neutral } = formatDelta(field, current, candidate)
              return (
                <div key={field} className={styles.deltaRow}>
                  <span className={styles.deltaField}>{FIELD_LABELS[field]}</span>
                  <span
                    className={`${styles.deltaValue} ${neutral ? '' : positive ? styles.deltaPositive : styles.deltaNegative}`}
                  >
                    {text}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        <div className={styles.sidebarActions}>
          <Button label="BACK" onClick={back} full />
          <Button label="FLY" primary onClick={() => goto('Briefing')} full />
        </div>
      </aside>

      {/* ── Right panel: slot tabs + calibration + part grid ── */}
      <section className={styles.main} aria-label="Part selection">
        <h1 className={styles.heading}>HANGAR</h1>

        {/* Slot tab bar */}
        <div className={styles.slotTabs} role="tablist" aria-label="Ship slots">
          {SLOTS.map((slot) => (
            <button
              key={slot}
              id={`hangar-tab-${slot.toLowerCase()}`}
              role="tab"
              aria-selected={activeTab === slot}
              aria-controls={`hangar-panel-${slot.toLowerCase()}`}
              className={`${styles.slotTab} ${activeTab === slot ? styles.slotTabActive : ''}`}
              onClick={() => {
                setActiveTab(slot)
                setHoveredPartId(null)
              }}
            >
              <span className={styles.slotTabLabel}>{SLOT_LABELS[slot]}</span>
              {equippedLoadout[slot] && (
                <span className={styles.slotTabDot} aria-hidden="true" />
              )}
            </button>
          ))}
          <button
            id="hangar-tab-world"
            role="tab"
            aria-selected={activeTab === WORLD_TAB}
            aria-controls="hangar-panel-world"
            className={`${styles.slotTab} ${activeTab === WORLD_TAB ? styles.slotTabActive : ''}`}
            onClick={() => {
              setActiveTab(WORLD_TAB)
              setHoveredPartId(null)
            }}
          >
            <span className={styles.slotTabLabel}>WORLD</span>
          </button>
          <button
            id="hangar-tab-livery"
            role="tab"
            aria-selected={activeTab === LIVERY_TAB}
            aria-controls="hangar-panel-livery"
            className={`${styles.slotTab} ${activeTab === LIVERY_TAB ? styles.slotTabActive : ''}`}
            onClick={() => {
              setActiveTab(LIVERY_TAB)
              setHoveredPartId(null)
            }}
          >
            <span className={styles.slotTabLabel}>LIVERY</span>
          </button>
        </div>

        {/* Interactive Calibration Tuning Slider */}
        {activeTab !== LIVERY_TAB && activeTab !== WORLD_TAB && slotTuningMeta && (
          <div className={styles.tuningSection}>
            <div className={styles.tuningHeader}>
              <span className={styles.tuningTitle}>{slotTuningMeta.title}</span>
              <span className={styles.tuningValueLabel}>
                OFFSET: {currentSlotTuning > 0 ? `+${Math.round(currentSlotTuning * 100)}%` : currentSlotTuning < 0 ? `${Math.round(currentSlotTuning * 100)}%` : 'BALANCED'}
              </span>
            </div>
            <div className={styles.tuningTrackWrapper}>
              {/* The visible title is a `span`, so it names this slider for a
                  sighted reader and for nobody else. `aria-valuetext` matters
                  as much as the label: without it a screen reader announces
                  "0.35", a number that appears nowhere on screen, instead of
                  the offset the UI actually shows. */}
              <input
                type="range"
                min="-1"
                max="1"
                step="0.05"
                value={currentSlotTuning}
                onChange={(e) => setPartTuning(activeSlot, parseFloat(e.target.value))}
                className={styles.tuningSlider}
                aria-label={`${slotTuningMeta.title} — ${slotTuningMeta.left} to ${slotTuningMeta.right}`}
                aria-valuetext={
                  currentSlotTuning > 0
                    ? `+${Math.round(currentSlotTuning * 100)}% toward ${slotTuningMeta.right}`
                    : currentSlotTuning < 0
                      ? `${Math.round(Math.abs(currentSlotTuning) * 100)}% toward ${slotTuningMeta.left}`
                      : 'Balanced'
                }
              />
              <div className={styles.tuningAxisLabels}>
                <span>{slotTuningMeta.left}</span>
                <span>{slotTuningMeta.right}</span>
              </div>
            </div>
          </div>
        )}

        {/* World cards */}
        {activeTab === WORLD_TAB ? (
          <div
            id="hangar-panel-world"
            role="tabpanel"
            aria-labelledby="hangar-tab-world"
            className={styles.partGrid}
          >
            {WORLDS.map((world) => {
              const unlocked = isWorldUnlocked(world, pilotLevel)
              const selected = world.id === worldId
              const cruise = Math.round((cruiseFactor(world.environment) - 1) * 100)
              const gravity = Math.round((world.environment.gravity - 1) * 100)

              if (!unlocked) {
                return (
                  <div
                    key={world.id}
                    className={`${styles.partCard} ${styles.partCardLocked}`}
                    aria-label={`${world.name}, locked. Reach level ${world.unlockLevel}`}
                    aria-disabled="true"
                  >
                    <div className={styles.partCardTop}>
                      <div className={styles.partName}>{world.name}</div>
                      <span className={styles.lockedBadge}>LVL {world.unlockLevel}</span>
                    </div>
                    <div className={styles.partManufacturer}>{world.subtitle}</div>
                    <p className={styles.partDesc}>{world.description}</p>
                  </div>
                )
              }

              return (
                <button
                  key={world.id}
                  className={`${styles.partCard} ${selected ? styles.partCardEquipped : ''}`}
                  onClick={() => {
                    setWorld(world.id)
                  }}
                  aria-pressed={selected}
                  aria-label={`${world.name}${selected ? ', selected' : ''}`}
                >
                  <div className={styles.partCardTop}>
                    <div className={styles.partName}>{world.name}</div>
                    {selected && <span className={styles.equippedBadge}>SELECTED</span>}
                  </div>
                  <div className={styles.partManufacturer}>{world.subtitle}</div>
                  <p className={styles.partDesc}>{world.description}</p>
                  <div className={styles.modifiers}>
                    <span
                      className={`${styles.modPill} ${gravity <= 0 ? styles.modBuff : styles.modNerf}`}
                    >
                      GRAVITY {gravity >= 0 ? '+' : ''}
                      {gravity}%
                    </span>
                    <span
                      className={`${styles.modPill} ${cruise >= 0 ? styles.modBuff : styles.modNerf}`}
                    >
                      CRUISE {cruise >= 0 ? '+' : ''}
                      {cruise}%
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        ) : activeTab === LIVERY_TAB ? (
          <div
            id="hangar-panel-livery"
            role="tabpanel"
            aria-labelledby="hangar-tab-livery"
            className={styles.partGrid}
          >
            {SKINS.map((skin) => {
              const unlocked = isSkinUnlocked(skin, pilotLevel, achievements)
              const selected = skin.id === skinId

              if (!unlocked) {
                return (
                  <div
                    key={skin.id}
                    className={`${styles.partCard} ${styles.partCardLocked}`}
                    aria-label={`${skin.name}, locked. ${unlockRequirement(skin)}`}
                    aria-disabled="true"
                  >
                    <div className={styles.partCardTop}>
                      <div className={styles.partName}>{skin.name}</div>
                      <span className={styles.lockedBadge}>LOCKED</span>
                    </div>
                    <p className={styles.partDesc}>{unlockRequirement(skin)}</p>
                  </div>
                )
              }

              return (
                <button
                  key={skin.id}
                  className={`${styles.partCard} ${selected ? styles.partCardEquipped : ''}`}
                  onClick={() => {
                    setSkin(skin.id)
                  }}
                  aria-pressed={selected}
                  aria-label={`${skin.name}${selected ? ', currently worn' : ''}`}
                >
                  <div className={styles.partCardTop}>
                    <div className={styles.partName}>{skin.name}</div>
                    {selected && <span className={styles.equippedBadge}>WORN</span>}
                  </div>
                  <div className={styles.swatchRow} aria-hidden="true">
                    <span className={styles.swatch} style={{ background: cssColor(skin.hull) }} />
                    <span className={styles.swatch} style={{ background: cssColor(skin.trim) }} />
                    <span
                      className={styles.swatch}
                      style={{
                        background: cssColor(skin.emissive),
                        boxShadow: `0 0 8px ${cssColor(skin.emissive)}`,
                      }}
                    />
                  </div>
                  <p className={styles.partDesc}>{skin.description}</p>
                </button>
              )
            })}
          </div>
        ) : (
          /* Part cards */
          <div
            id={`hangar-panel-${activeSlot.toLowerCase()}`}
            role="tabpanel"
            aria-labelledby={`hangar-tab-${activeSlot.toLowerCase()}`}
            className={styles.partGrid}
          >
            {partsInSlot.map((part) => {
              const isEquipped = part.id === equippedIdInSlot
              const isStock = part.manufacturer === null
              const isHovered = part.id === hoveredPartId
              const isOwned = isStock || !part.cost || unlockedParts.includes(part.id)
              const canAfford = credits >= (part.cost ?? 0)

              return (
                <div
                  key={part.id}
                  id={`hangar-part-${part.id}`}
                  className={`${styles.partCard} ${isEquipped ? styles.partCardEquipped : ''} ${isHovered ? styles.partCardHovered : ''}`}
                  onMouseEnter={() => setHoveredPartId(part.id)}
                  onMouseLeave={() => setHoveredPartId(null)}
                  onFocus={() => setHoveredPartId(part.id)}
                  onBlur={() => setHoveredPartId(null)}
                  onClick={() => isOwned && handleEquip(part)}
                  style={{ cursor: isOwned ? 'pointer' : 'default' }}
                >
                  <div className={styles.partCardTop}>
                    <div className={styles.partName}>{part.name}</div>
                    {part.tier && <span className={styles.tierBadge}>{part.tier}</span>}
                    {isEquipped && <span className={styles.equippedBadge}>EQUIPPED</span>}
                    {isStock && !isEquipped && <span className={styles.stockBadge}>STOCK</span>}
                  </div>
                  {part.manufacturer && (
                    <div className={styles.partManufacturer}>{part.manufacturer}</div>
                  )}
                  <p className={styles.partDesc}>{part.description}</p>

                  {/* Modifier pills.
                      `role="list"` is what makes the `aria-label` legal: an
                      unadorned div has no role, and ARIA forbids naming
                      something that is not anything. The pills genuinely are a
                      list of modifiers, so the honest role also fixes the
                      violation.
                      Guarded on emptiness because the six stock parts carry
                      `modifiers: {}` — an announced but childless list is a
                      promise of content that isn't there, and axe only lets it
                      pass by grading empty lists "incomplete" rather than
                      failing them. */}
                  {Object.keys(part.modifiers).length > 0 && (
                    <div className={styles.modifiers} role="list" aria-label="Part modifiers">
                      {(
                        Object.entries(part.modifiers) as [keyof LoadoutModifiers, number][]
                      ).map(([field, value]) => {
                        const pct = Math.round((value - 1) * 100)
                        const sign = pct > 0 ? '+' : ''
                        const buff = isBuff(field, value)
                        return (
                          <span
                            key={field}
                            role="listitem"
                            className={`${styles.modPill} ${buff ? styles.modBuff : styles.modNerf}`}
                            title={FIELD_LABELS[field]}
                          >
                            {FIELD_LABELS[field]} {sign}
                            {pct}%
                          </span>
                        )
                      })}
                    </div>
                  )}

                  {!isOwned && (
                    <button
                      className={`${styles.buyBtn} ${canAfford ? '' : styles.buyBtnDisabled}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleEquip(part)
                      }}
                      disabled={!canAfford}
                    >
                      BUY FOR {part.cost} CR
                    </button>
                  )}
                </div>
              )
            })}

            {/* Locked parts */}
            {lockedParts.map((part) => (
              <div
                key={part.id}
                className={`${styles.partCard} ${styles.partCardLocked}`}
                aria-label={`${part.name}, unlocks at level ${part.unlockLevel}`}
                aria-disabled="true"
              >
                <div className={styles.partCardTop}>
                  <div className={styles.partName}>{part.name}</div>
                  <span className={styles.lockedBadge}>LVL {part.unlockLevel}</span>
                </div>
                {part.manufacturer && (
                  <div className={styles.partManufacturer}>{part.manufacturer}</div>
                )}
                <p className={styles.partDesc}>{part.description}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
