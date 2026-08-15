import { useState } from 'react'
import WorldBackdrop from '../game/WorldBackdrop'

const BEATS = [
  { verb: 'FLY', prompt: 'Hold W to accelerate. Steer with the mouse.' },
  { verb: 'SHOOT', prompt: 'Left click to fire.' },
  { verb: 'DEFEND', prompt: 'Destroy the harvesters before they drain the outpost.' },
]

export default function TutorialScreen({ onDone }: { onDone?: () => void }) {
  const [beat, setBeat] = useState(0)
  const [complete, setComplete] = useState(false)
  const advance = () => {
    setComplete(true)
    setTimeout(() => {
      setComplete(false)
      if (beat >= BEATS.length - 1) onDone?.()
      else setBeat((b) => b + 1)
    }, 700)
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <WorldBackdrop />

      {/* beat indicator + skip */}
      <div className="absolute left-[5%] top-[5%] flex items-center gap-2">
        {BEATS.map((_, i) => (
          <span key={i} className="h-1 w-8" style={{ background: i <= beat ? 'var(--color-friendly)' : 'rgba(139,151,166,0.3)' }} />
        ))}
        <span className="hud-label ml-2">{beat + 1}/3</span>
      </div>
      <button onClick={onDone} className="absolute right-[5%] top-[5%] hud-label" style={{ color: 'var(--color-text-secondary)' }}>SKIP →</button>

      {/* beat-complete confirmation — brief, satisfying, non-blocking */}
      {complete && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="enter-overshoot flex h-16 w-16 items-center justify-center" style={{ border: '2px solid var(--color-friendly)', borderRadius: '50%' }}>
            <svg width={26} height={26} viewBox="0 0 26 26"><path d="M5 13 L11 19 L21 7" fill="none" stroke="var(--color-friendly)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
        </div>
      )}

      {/* in-world prompt, lower third */}
      <div className="absolute bottom-[14%] left-0 right-0 flex flex-col items-center px-8 text-center">
        <div className="text-scrim absolute inset-0" />
        <div className="relative">
          <div className="hud-label" style={{ color: 'var(--color-friendly)' }}>{BEATS[beat].verb}</div>
          <p className="mt-3 font-hud text-[28px] font-semibold leading-snug" style={{ letterSpacing: '0.01em' }}>{BEATS[beat].prompt}</p>
          <button onClick={advance} className="mt-6 px-6 py-2.5 font-hud text-[15px] font-semibold" style={{ border: '1px solid var(--color-friendly)', background: 'rgba(127,232,255,0.14)', color: 'var(--color-friendly)', borderRadius: 2, letterSpacing: '0.06em' }}>
            {complete ? 'GOOD' : 'DID IT'}
          </button>
        </div>
      </div>
    </div>
  )
}
