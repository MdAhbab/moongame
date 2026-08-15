import { useEffect, useState } from 'react'

// Real progress, not an indeterminate spinner — the moon is genuinely generated
// at load. A wireframe sphere assembles itself as the named stages advance.
const STAGES = ['GENERATING TERRAIN', 'MAPPING CRATERS', 'PLACING OUTPOSTS', 'INITIALISING SYSTEMS']

export default function LoadingScreen({ onComplete }: { onComplete?: () => void }) {
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const id = setInterval(() => {
      setProgress((p) => (p >= 100 ? (onComplete ? 100 : 0) : p + 1))
    }, 40)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (progress >= 100 && onComplete) {
      const t = setTimeout(onComplete, 350)
      return () => clearTimeout(t)
    }
  }, [progress, onComplete])
  const stage = Math.min(STAGES.length - 1, Math.floor((progress / 100) * STAGES.length))
  const slow = progress > 70

  // Wireframe sphere: latitude/longitude lines revealed proportionally to progress.
  const lats = 7
  const longs = 12
  const visibleLat = Math.ceil((progress / 100) * lats)
  const visibleLong = Math.ceil((progress / 100) * longs)

  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-void p-8">
      <svg viewBox="-60 -60 120 120" width={220} height={220} className="spin-sweep" style={{ animation: 'ring-sweep 24s linear infinite' }}>
        <circle r={50} fill="none" stroke="var(--color-friendly)" strokeWidth={0.5} opacity={0.35} />
        {Array.from({ length: lats }).map((_, i) => {
          const y = -50 + ((i + 1) * 100) / (lats + 1)
          const rx = Math.sqrt(Math.max(0, 2500 - y * y))
          return (
            <ellipse key={`lat${i}`} cx={0} cy={y} rx={rx} ry={rx * 0.28} fill="none"
              stroke="var(--color-friendly)" strokeWidth={0.4} opacity={i < visibleLat ? 0.5 : 0.08} />
          )
        })}
        {Array.from({ length: longs }).map((_, i) => {
          const rot = (i * 180) / longs
          return (
            <ellipse key={`long${i}`} cx={0} cy={0} rx={50 * Math.abs(Math.cos((rot * Math.PI) / 180)) + 0.001} ry={50}
              fill="none" stroke="var(--color-friendly)" strokeWidth={0.4} opacity={i < visibleLong ? 0.45 : 0.08} />
          )
        })}
      </svg>

      <div className="mt-10 w-full max-w-sm">
        <div className="flex items-baseline justify-between">
          <span className="hud-label" style={{ color: 'var(--color-friendly)' }}>{STAGES[stage]}</span>
          <span className="font-hud text-[14px] tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{progress}%</span>
        </div>
        <div className="mt-2 h-1 w-full" style={{ background: 'rgba(139,151,166,0.16)' }}>
          <div className="h-full transition-[width] duration-100" style={{ width: `${progress}%`, background: 'var(--color-friendly)' }} />
        </div>
        <div className="mt-3 flex gap-3">
          {STAGES.map((s, i) => (
            <span key={s} className="hud-label text-[11px]" style={{ color: i <= stage ? 'var(--color-friendly)' : 'var(--color-inert)', letterSpacing: '0.08em' }}>
              {i + 1}
            </span>
          ))}
        </div>
        {slow && (
          <p className="mt-6 text-[14px]" style={{ color: 'var(--color-text-secondary)' }}>
            Generating terrain — this happens once.
          </p>
        )}
      </div>
    </div>
  )
}
