import { Button } from '../game/ui'

// Four seconds before each wave, skippable. The flattened moon map lets the
// player form a plan — this is what turns the wave into a decision, not a reaction.
// Threatened outposts and their separation must be immediately obvious.
const OUTPOSTS = [
  { name: 'VEGA', x: 22, y: 30, threat: false },
  { name: 'KEPLER', x: 48, y: 20, threat: false },
  { name: 'CASSINI', x: 78, y: 34, threat: true },
  { name: 'TYCHO', x: 64, y: 62, threat: false },
  { name: 'HADLEY', x: 18, y: 68, threat: true },
  { name: 'AITKEN', x: 40, y: 78, threat: false },
  { name: 'RILLE', x: 86, y: 70, threat: false },
  { name: 'NECTARIS', x: 54, y: 46, threat: false },
]

export default function BriefingScreen({ wave = 6, onStart }: { wave?: number; onStart?: () => void }) {
  const threatened = OUTPOSTS.filter((o) => o.threat)
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center bg-void px-8 py-10">
      <div className="flex items-center gap-3">
        <span className="hud-label" style={{ color: 'var(--color-hostile)' }}>Wave {wave} · Incoming</span>
        <span className="font-hud text-[14px] tabular-nums pulse-slow" style={{ color: 'var(--color-text-secondary)' }}>4s</span>
      </div>

      <div className="mt-6 grid w-full max-w-3xl gap-8 md:grid-cols-[1.5fr_1fr]">
        {/* flattened map */}
        <div className="relative aspect-[3/2] w-full" style={{ border: '1px solid rgba(139,151,166,0.22)', background: 'linear-gradient(180deg, #10151d, #0a0d13)', borderRadius: 2 }}>
          <span className="absolute left-2 top-2 hud-label opacity-50">Surface Map · Equatorial</span>
          <svg viewBox="0 0 100 66" className="h-full w-full">
            {/* grid */}
            {[16.5, 33, 49.5].map((y) => <line key={y} x1={0} y1={y} x2={100} y2={y} stroke="rgba(139,151,166,0.1)" strokeWidth={0.3} />)}
            {[25, 50, 75].map((x) => <line key={x} x1={x} y1={0} x2={x} y2={66} stroke="rgba(139,151,166,0.1)" strokeWidth={0.3} />)}
            {/* separation line between the two threatened outposts */}
            {threatened.length === 2 && (
              <line x1={threatened[0].x} y1={threatened[0].y * 0.66} x2={threatened[1].x} y2={threatened[1].y * 0.66}
                stroke="var(--color-hostile)" strokeWidth={0.5} strokeDasharray="2 2" opacity={0.7} />
            )}
            {OUTPOSTS.map((o) => (
              <g key={o.name} transform={`translate(${o.x} ${o.y * 0.66})`} className={o.threat ? 'pulse-slow' : ''}>
                {o.threat && <circle r={4} fill="none" stroke="var(--color-hostile)" strokeWidth={0.6} opacity={0.6} />}
                <path d="M0 -2.4 L2.1 0 L0 2.4 L-2.1 0 Z" fill={o.threat ? 'var(--color-hostile)' : 'var(--color-friendly)'} />
                <text x={0} y={6} textAnchor="middle" fontSize={2.6} fill={o.threat ? 'var(--color-hostile)' : 'var(--color-text-secondary)'} className="font-hud">{o.name}</text>
              </g>
            ))}
          </svg>
        </div>

        {/* composition */}
        <div className="flex flex-col justify-center gap-5">
          <div>
            <div className="hud-label mb-2" style={{ color: 'var(--color-hostile)' }}>Under Attack</div>
            <div className="font-hud text-[24px] font-semibold">Cassini &amp; Hadley</div>
            <p className="mt-1 text-[14px]" style={{ color: 'var(--color-text-secondary)' }}>Opposite hemispheres — ~9s apart. You likely save one.</p>
          </div>
          <div>
            <div className="hud-label mb-2">Incoming Composition</div>
            <ul className="flex flex-col gap-1 font-hud text-[15px]">
              <li className="flex justify-between"><span>Harvesters</span><span className="tabular-nums">×6</span></li>
              <li className="flex justify-between"><span>Interceptors</span><span className="tabular-nums">×3</span></li>
              <li className="flex justify-between"><span>Sentinels</span><span className="tabular-nums">×1</span></li>
            </ul>
          </div>
          <Button label="LAUNCH →" primary onClick={onStart} />
        </div>
      </div>
    </div>
  )
}
