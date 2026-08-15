import { useEffect, useState } from 'react'
import WorldBackdrop from '../game/WorldBackdrop'
import { Button } from '../game/ui'

export type WaveSummary = { wave: number; kills: number; accuracy: number; saved: number; total: number }

function useCountUp(target: number, run: boolean, ms = 400) {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (!run) { setV(0); return }
    const start = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms)
      const eased = 1 - Math.pow(1 - p, 3)
      setV(Math.round(target * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, run, ms])
  return v
}

function Line({ label, value, hero, run }: { label: string; value: number; hero: boolean; run: boolean }) {
  const v = useCountUp(value, run)
  return (
    <div className={`flex items-baseline justify-between border-b py-2 ${run ? 'enter-overshoot' : 'opacity-0'}`} style={{ borderColor: 'rgba(139,151,166,0.12)' }}>
      <span className={hero ? 'font-hud text-[20px] font-semibold' : 'hud-label'} style={{ color: hero ? 'var(--color-friendly)' : undefined }}>{label}</span>
      <span className="font-hud font-bold tabular-nums" style={{ fontSize: hero ? 28 : 18, color: hero ? 'var(--color-friendly)' : 'var(--color-text-primary)' }}>+{v.toLocaleString()}</span>
    </div>
  )
}

export default function WaveClearScreen({ summary, onContinue }: { summary?: WaveSummary; onContinue?: () => void }) {
  const s = summary ?? { wave: 5, kills: 12, accuracy: 61, saved: 7, total: 12480 }
  const lines = [
    { label: 'Kills', value: s.kills * 100, hero: false },
    { label: `Accuracy ${s.accuracy}%`, value: Math.round(s.kills * s.accuracy * 2), hero: false },
    { label: `Outposts Saved · ${s.saved}`, value: s.saved * 700, hero: true },
    { label: 'Wave Bonus', value: s.wave * 300, hero: false },
  ]
  const [step, setStep] = useState(0)
  useEffect(() => {
    setStep(0)
    const timers = lines.map((_, i) => setTimeout(() => setStep(i + 1), 200 + i * 200))
    const total = setTimeout(() => setStep(lines.length + 1), 200 + lines.length * 200 + 200)
    return () => { timers.forEach(clearTimeout); clearTimeout(total) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.wave])
  const total = useCountUp(s.total, step > lines.length)

  return (
    <div className="relative h-full w-full overflow-hidden">
      <WorldBackdrop dimmed />
      <div className="absolute inset-0 flex items-center justify-center px-8">
        <div className="w-full max-w-md">
          <div className="hud-label text-center" style={{ color: 'var(--color-friendly)' }}>Wave {s.wave} Cleared</div>
          <div className="mt-6 flex flex-col">
            {lines.map((l, i) => <Line key={l.label} {...l} run={step > i} />)}
          </div>
          <div className={`mt-4 flex items-baseline justify-between ${step > lines.length ? 'enter-overshoot' : 'opacity-0'}`}>
            <span className="hud-label">Total</span>
            <span className="font-hud text-[36px] font-bold tabular-nums">{total.toLocaleString()}</span>
          </div>
          {onContinue && (
            <div className="mt-8 flex justify-center"><Button label="NEXT WAVE →" primary onClick={onContinue} /></div>
          )}
        </div>
      </div>
    </div>
  )
}
