// Real touch controls, wired straight to the engine. Left thumb: a floating
// virtual stick that appears where you first press — X steers, Y climbs/dives.
// Right thumb: a vertical throttle. Boost + pause buttons. Firing is automatic.
import { useEffect, useRef, useState } from 'react'
import type { Game } from './engine'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export default function TouchControls({ game, onPause }: { game: Game; onPause: () => void }) {
  const [stick, setStick] = useState<{ x: number; y: number } | null>(null)
  const [thr, setThr] = useState(game.throttle)
  const [boost, setBoost] = useState(false)

  const stickId = useRef<number | null>(null)
  const origin = useRef({ x: 0, y: 0 })
  const thrRef = useRef<HTMLDivElement>(null)
  const thrId = useRef<number | null>(null)

  // firing is automatic on touch; reset intents on unmount
  useEffect(() => {
    game.firing = true
    return () => { game.firing = false; game.steer = 0; game.climb = 0; game.boosting = false }
  }, [game])

  const MAX = 54
  const padDown = (e: React.PointerEvent) => {
    stickId.current = e.pointerId
    origin.current = { x: e.clientX, y: e.clientY }
    setStick({ x: 0, y: 0 })
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const padMove = (e: React.PointerEvent) => {
    if (e.pointerId !== stickId.current) return
    const x = clamp(e.clientX - origin.current.x, -MAX, MAX)
    const y = clamp(e.clientY - origin.current.y, -MAX, MAX)
    setStick({ x, y })
    game.steer = clamp(x / MAX, -1, 1)
    game.climb = clamp(-y / MAX, -1, 1)
  }
  const padUp = (e: React.PointerEvent) => {
    if (e.pointerId !== stickId.current) return
    stickId.current = null
    setStick(null)
    game.steer = 0
    game.climb = 0
  }

  const thrFromEvent = (clientY: number) => {
    const r = thrRef.current!.getBoundingClientRect()
    const t = clamp((r.bottom - clientY) / r.height, 0, 1)
    game.throttle = t
    setThr(t)
  }
  const thrDown = (e: React.PointerEvent) => { thrId.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); thrFromEvent(e.clientY) }
  const thrMove = (e: React.PointerEvent) => { if (e.pointerId === thrId.current) thrFromEvent(e.clientY) }
  const thrEnd = (e: React.PointerEvent) => { if (e.pointerId === thrId.current) thrId.current = null }

  return (
    <div className="absolute inset-0 select-none" style={{ touchAction: 'none' }}>
      {/* left half: floating steering stick */}
      <div
        className="absolute bottom-0 left-0 top-0 w-1/2"
        onPointerDown={padDown}
        onPointerMove={padMove}
        onPointerUp={padUp}
        onPointerCancel={padUp}
      >
        {stick && (
          <div className="absolute h-[132px] w-[132px] rounded-full" style={{ left: origin.current.x - 66, top: origin.current.y - 66, border: '1px solid rgba(127,232,255,0.45)', background: 'rgba(13,17,23,0.32)' }}>
            <div className="absolute h-[58px] w-[58px] rounded-full" style={{ left: 37 + stick.x, top: 37 + stick.y, border: '1px solid var(--color-friendly)', background: 'rgba(127,232,255,0.22)' }} />
          </div>
        )}
        {!stick && (
          <span className="hud-label absolute bottom-[16%] left-[16%] opacity-60">Touch to steer</span>
        )}
      </div>

      {/* right: vertical throttle */}
      <div className="absolute" style={{ right: '10%', bottom: '14%' }}>
        <div
          ref={thrRef}
          className="relative h-[168px] w-[56px]"
          style={{ border: '1px solid rgba(127,232,255,0.45)', background: 'rgba(13,17,23,0.32)', borderRadius: 3, touchAction: 'none' }}
          onPointerDown={thrDown}
          onPointerMove={thrMove}
          onPointerUp={thrEnd}
          onPointerCancel={thrEnd}
        >
          <div className="absolute bottom-0 w-full" style={{ height: `${thr * 100}%`, background: 'rgba(127,232,255,0.2)' }} />
          <div className="absolute left-0 w-full" style={{ bottom: `${thr * 100}%`, height: 2, background: 'var(--color-friendly)' }} />
          <span className="hud-label absolute -top-6 left-1/2 -translate-x-1/2">Throttle</span>
        </div>
      </div>

      {/* boost (hold) + pause */}
      <button
        className="absolute flex h-16 w-16 items-center justify-center font-hud text-[18px]"
        style={{ right: '32%', bottom: '16%', border: `1px solid var(--color-friendly)`, color: 'var(--color-friendly)', borderRadius: '50%', background: boost ? 'rgba(127,232,255,0.22)' : 'transparent', touchAction: 'none' }}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); game.boosting = true; setBoost(true) }}
        onPointerUp={() => { game.boosting = false; setBoost(false) }}
        onPointerCancel={() => { game.boosting = false; setBoost(false) }}
      >⚡</button>

      <button
        className="absolute flex h-11 w-11 items-center justify-center font-hud text-[16px]"
        style={{ right: '5%', top: '5%', border: '1px solid rgba(139,151,166,0.5)', color: 'var(--color-text-primary)', borderRadius: 2 }}
        onClick={onPause}
      >⏸</button>
    </div>
  )
}
