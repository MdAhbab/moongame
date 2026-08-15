import WorldBackdrop from '../game/WorldBackdrop'
import { Button } from '../game/ui'

export type RunSummary = {
  score: number
  best: number
  wave: number
  saved: number
  kills: number
  accuracy: number
  duration: string
  seed: string
  victory: boolean
}

// End of run. Personal-best delta is honest motivation. Victory (all 12 waves)
// is a distinct, celebratory variant.
export default function ResultsScreen({
  victory = false,
  summary,
  onPlayAgain,
}: {
  victory?: boolean
  summary?: RunSummary
  onPlayAgain?: () => void
}) {
  const s: RunSummary =
    summary ?? { score: victory ? 61240 : 47680, best: 48920, wave: victory ? 12 : 9, saved: victory ? 8 : 5, kills: 68, accuracy: 64, duration: '6:18', seed: 'NX-7742-K', victory }
  const isVictory = s.victory || victory
  const delta = s.score - s.best
  const accent = isVictory ? 'var(--color-caution)' : 'var(--color-friendly)'
  const items = [
    ['Kills', String(s.kills)],
    ['Accuracy', `${s.accuracy}%`],
    ['Wave Reached', isVictory ? '12 · CLEARED' : String(s.wave)],
    ['Run Duration', s.duration],
  ]

  return (
    <div className="relative h-full w-full overflow-auto">
      <WorldBackdrop dimmed lit={isVictory} />
      <div className="relative mx-auto flex min-h-full max-w-xl flex-col justify-center gap-8 px-8 py-14">
        <div>
          <div className="hud-label" style={{ color: accent }}>{isVictory ? 'Moon Secured · All 12 Waves' : 'Run Complete'}</div>
          <h2 className="mt-2 font-hud font-bold leading-none" style={{ fontSize: isVictory ? 56 : 44, letterSpacing: '-0.02em', color: isVictory ? accent : 'var(--color-text-primary)' }}>
            {s.score.toLocaleString()}
          </h2>
          <p className="mt-2 font-hud text-[16px]" style={{ color: delta >= 0 ? 'var(--color-friendly)' : 'var(--color-caution)' }}>
            {delta >= 0 ? `+${delta.toLocaleString()} over your best` : `${Math.abs(delta).toLocaleString()} short of your best`}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-x-10 gap-y-4">
          {items.map(([k, v]) => (
            <div key={k}><div className="hud-label">{k}</div><div className="font-hud text-[22px] font-bold tabular-nums">{v}</div></div>
          ))}
        </div>

        <div className="flex items-baseline gap-8">
          <div>
            <div className="hud-label">Outposts Saved</div>
            <div className="font-hud text-[28px] font-bold tabular-nums" style={{ color: accent }}>
              {s.saved}<span className="text-[18px]" style={{ color: 'var(--color-text-secondary)' }}> / 8</span>
            </div>
          </div>
          <div><div className="hud-label">Run Seed</div><div className="font-hud text-[16px] tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{s.seed}</div></div>
        </div>

        <div className="flex gap-3">
          <Button label="PLAY AGAIN" primary onClick={onPlayAgain} />
        </div>
      </div>
    </div>
  )
}
