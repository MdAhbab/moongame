import { useCallback, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { PCFShadowMap } from 'three'
import { Game, type HudSnapshot } from '../game/engine'
import GameScene from '../game/GameScene'
import TouchControls from '../game/TouchControls'
import ThreatRing from '../game/ThreatRing'
import { SegmentedGauge, OutpostRoster, ComboMeter, Alert, AltitudeLadder } from '../game/hud-parts'

const IS_TOUCH = typeof window !== 'undefined' && (('ontouchstart' in window) || (window.matchMedia?.('(pointer: coarse)').matches ?? false))

export default function PlayScreen({
  game,
  onWaveClear,
  onGameOver,
  onPause,
  paused,
}: {
  game: Game
  onWaveClear: (g: Game) => void
  onGameOver: (g: Game) => void
  onPause: () => void
  paused: boolean
}) {
  const [snap, setSnap] = useState<HudSnapshot | null>(null)
  const onSnapshot = useCallback((s: HudSnapshot) => setSnap(s), [])

  // Esc pauses (pointer-lock is released by the browser on Esc automatically).
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onPause() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onPause])

  return (
    <div className="relative h-full w-full overflow-hidden bg-void">
      <Canvas
        shadows={{ type: PCFShadowMap }}
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ fov: 62, near: 0.5, far: 4000, position: [0, 40, 120] }}
        onCreated={({ gl }) => gl.setClearColor(0x05060a, 1)}
        style={{ position: 'absolute', inset: 0, cursor: paused || IS_TOUCH ? 'default' : 'none' }}
      >
        <fog attach="fog" args={[0x05060a, 260, 1400]} />
        <GameScene game={game} paused={paused} touch={IS_TOUCH} onSnapshot={onSnapshot} onWaveClear={onWaveClear} onGameOver={onGameOver} />
      </Canvas>

      {IS_TOUCH && !paused && <TouchControls game={game} onPause={onPause} />}

      {snap?.damageDir != null && (
        <div className="pointer-events-none absolute inset-0" style={{
          background: `radial-gradient(circle at ${50 + Math.sin(snap.damageDir) * 50}% ${50 - Math.cos(snap.damageDir) * 50}%, rgba(255,138,61,0.4), transparent 42%)`,
        }} />
      )}

      {snap && (
        <div className="pointer-events-none absolute inset-0 p-[4%]">
          <div className="flex items-start justify-between">
            <div className="flex flex-col gap-2">
              <SegmentedGauge label="Hull" value={snap.hull} tone="hull" />
              <SegmentedGauge label="Heat" value={snap.heat} tone="heat" />
            </div>
            <div className="text-center">
              <div className="hud-label">Wave</div>
              <div className="font-hud text-[28px] font-bold leading-none">{snap.wave}</div>
            </div>
            <div className="text-right">
              <div className="hud-label">Score</div>
              <div className="font-hud text-[20px] font-semibold tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{snap.score.toLocaleString()}</div>
            </div>
          </div>

          {snap.alert && <div className="mt-4 flex justify-center"><Alert text={snap.alert.text} severity={snap.alert.severity} /></div>}

          <div className="absolute left-[4%] top-[24%]"><OutpostRoster outposts={snap.outposts} /></div>
          <div className="absolute right-[4%] top-[22%]"><AltitudeLadder altitude={snap.altitude} /></div>

          <div className="absolute bottom-[4%] left-[4%] flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="hud-label w-[52px]" style={{ color: 'var(--color-text-secondary)' }}>Throttle</span>
              <div className="flex gap-[3px]">
                {Array.from({ length: 10 }).map((_, i) => (
                  <span key={i} className="h-2.5 w-2" style={{ background: i < Math.round(snap.throttle * 10) ? 'var(--color-text-primary)' : 'transparent', border: '1px solid rgba(139,151,166,0.5)', opacity: i < Math.round(snap.throttle * 10) ? 1 : 0.35, borderRadius: 1 }} />
                ))}
              </div>
              <span className="font-hud text-[13px] tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{Math.round(snap.speed)} u/s</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="hud-label w-[52px]" style={{ color: 'var(--color-friendly)' }}>⚡ Boost</span>
              <div className="flex gap-[3px]">
                {Array.from({ length: 10 }).map((_, i) => (
                  <span key={i} className="h-2.5 w-2" style={{ background: i < Math.round(snap.boost / 10) ? 'var(--color-friendly)' : 'transparent', border: '1px solid var(--color-friendly)', opacity: i < Math.round(snap.boost / 10) ? 1 : 0.35, borderRadius: 1 }} />
                ))}
              </div>
            </div>
          </div>
          {!IS_TOUCH && (
            <div className="absolute bottom-[4%] right-[4%] hud-label opacity-60">Move mouse to steer · W/S throttle · Space/Ctrl climb · Shift boost · hold click to fire · Esc pause</div>
          )}
        </div>
      )}

      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
        <div className="relative">
          <ThreatRing markers={snap?.markers ?? []} size={300} />
          {/* fixed aiming crosshair */}
          <svg className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" width={44} height={44} viewBox="-22 -22 44 44">
            <circle r={2} fill="var(--color-friendly)" />
            <path d="M-18 0 H-8 M18 0 H8 M0 -18 V-8 M0 18 V8" stroke="var(--color-friendly)" strokeWidth={1.2} opacity={0.85} />
          </svg>
          {/* flight-director: shows live steer/climb input */}
          {snap && !IS_TOUCH && (
            <div
              className="absolute left-1/2 top-1/2 h-3 w-3 rounded-full"
              style={{
                transform: `translate(calc(-50% + ${snap.turn * 62}px), calc(-50% + ${-snap.climb * 62}px))`,
                border: '1.5px solid var(--color-caution)',
                transition: 'transform 90ms linear',
              }}
            />
          )}
        </div>
        <div className="mt-2">{snap && <ComboMeter combo={snap.combo} />}</div>
      </div>
    </div>
  )
}
