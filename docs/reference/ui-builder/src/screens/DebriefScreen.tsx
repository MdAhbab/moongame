import WorldBackdrop from '../game/WorldBackdrop'
import { Button } from '../game/ui'

// Timeline of the wave: threat windows, player position arcs, and the losses.
// The player should be able to see the exact moment the decision was made.
type Track = { name: string; threat: [number, number]; lost?: number }
const DURATION = 180 // seconds shown
const TRACKS: Track[] = [
  { name: 'CASSINI', threat: [141, 161], lost: 161 },
  { name: 'RILLE', threat: [96, 132] },
  { name: 'VEGA', threat: [30, 52] },
  { name: 'HADLEY', threat: [8, 40] },
]
// where the player physically was (highlighted arrival windows)
const PRESENCE: [number, number][] = [
  [12, 42],
  [96, 138],
]

function pct(t: number) {
  return (t / DURATION) * 100
}


export type DebriefData = { cause: string; seed: string; saved: number; accuracy: number; kills: number }

export default function DebriefScreen({ data, onContinue, onRetry }: { data?: DebriefData; onContinue?: () => void; onRetry?: () => void }) {
  const d = data
  return (
    <div className="relative h-full w-full overflow-auto">
      <WorldBackdrop dimmed />
      <div className="relative mx-auto flex min-h-full max-w-3xl flex-col justify-center gap-8 px-8 py-16">
        <div className="hud-label" style={{ color: 'var(--color-hostile)' }}>Flight Recorder · Wave 5</div>

        {/* The heart of the screen: one factual, unemotional cause. */}
        <h2 className="font-hud text-[32px] font-semibold leading-tight" style={{ letterSpacing: '-0.01em' }}>
          {d ? d.cause : 'Lost Cassini at 2:41 — 3 harvesters landed while you were on the far side.'}
        </h2>

        {/* Timeline strip */}
        <div className="border p-5" style={{ borderColor: 'rgba(139,151,166,0.22)', background: 'rgba(21,27,36,0.5)', borderRadius: 2 }}>
          <div className="hud-label mb-4">Wave Timeline</div>
          <div className="flex flex-col gap-3">
            {TRACKS.map((t) => (
              <div key={t.name} className="flex items-center gap-3">
                <span className="w-20 font-hud text-[13px] tracking-wide"
                  style={{ color: t.lost ? 'var(--color-inert)' : 'var(--color-text-secondary)', textDecoration: t.lost ? 'line-through' : undefined }}>
                  {t.name}
                </span>
                <div className="relative h-4 flex-1" style={{ background: 'rgba(139,151,166,0.06)' }}>
                  <div className="absolute inset-y-0" style={{
                    left: `${pct(t.threat[0])}%`, width: `${pct(t.threat[1] - t.threat[0])}%`,
                    background: t.lost ? 'rgba(255,138,61,0.25)' : 'rgba(255,138,61,0.4)',
                    borderLeft: '1px solid var(--color-hostile)',
                  }} />
                  {t.lost && (
                    <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-2.5 w-2.5 rotate-45"
                      style={{ left: `${pct(t.lost)}%`, background: 'var(--color-critical)' }} title="lost" />
                  )}
                </div>
              </div>
            ))}
            {/* player presence lane */}
            <div className="flex items-center gap-3">
              <span className="w-20 hud-label" style={{ color: 'var(--color-friendly)' }}>You</span>
              <div className="relative h-4 flex-1" style={{ background: 'rgba(139,151,166,0.06)' }}>
                {PRESENCE.map((p, i) => (
                  <div key={i} className="absolute inset-y-0" style={{
                    left: `${pct(p[0])}%`, width: `${pct(p[1] - p[0])}%`,
                    background: 'rgba(127,232,255,0.28)', borderLeft: '1px solid var(--color-friendly)',
                  }} />
                ))}
              </div>
            </div>
          </div>
          <div className="mt-2 flex justify-between hud-label opacity-60">
            <span>0:00</span><span>1:30</span><span>3:00</span>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-x-10 gap-y-4 sm:grid-cols-4">
          {[
            ['Accuracy', d ? `${d.accuracy}%` : '61%'],
            ['Kills', d ? String(d.kills) : '22'],
            ['Interceptors', '6'],
            ['Sentinels', '2'],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="hud-label">{k}</div>
              <div className="font-hud text-[22px] font-bold tabular-nums">{v}</div>
            </div>
          ))}
        </div>
        <div className="flex items-baseline gap-6">
          <div>
            <div className="hud-label">Outposts Saved</div>
            <div className="font-hud text-[28px] font-bold tabular-nums" style={{ color: 'var(--color-friendly)' }}>{d ? d.saved : 7}<span className="text-[18px]" style={{ color: 'var(--color-text-secondary)' }}> / 8</span></div>
          </div>
          <div>
            <div className="hud-label">Run Seed</div>
            <div className="font-hud text-[16px] tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{d ? d.seed : 'NX-7742-K'}</div>
          </div>
        </div>

        <div className="flex gap-3">
          <Button label="RETRY THIS SEED" onClick={onRetry} />
          <Button label="CONTINUE" primary onClick={onContinue} />
        </div>
      </div>
    </div>
  )
}
