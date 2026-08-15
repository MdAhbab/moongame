// Smaller HUD instruments. All numerals tabular via .font-hud.

export function SegmentedGauge({
  label,
  value,
  segments = 10,
  tone,
}: {
  label: string
  value: number // 0..100
  segments?: number
  tone: 'hull' | 'heat'
}) {
  const filled = Math.round((value / 100) * segments)
  // Countable segments read faster than a proportional fill under pressure.
  let color = 'var(--color-friendly)'
  let pulse = ''
  if (tone === 'hull') {
    if (value < 20) { color = 'var(--color-critical)'; pulse = 'pulse-fast' }
    else if (value < 40) color = 'var(--color-hostile)'
  } else {
    if (value >= 100) { color = 'var(--color-critical)'; pulse = 'pulse-fast' }
    else if (value > 75) color = 'var(--color-hostile)'
    else color = 'var(--color-caution)'
  }
  const lockout = tone === 'heat' && value >= 100
  return (
    <div className="flex items-center gap-2">
      <div className={`flex gap-[3px] ${pulse}`}>
        {Array.from({ length: segments }).map((_, i) => (
          <span
            key={i}
            className="h-3 w-[7px]"
            style={{
              background: i < filled ? color : 'transparent',
              border: `1px solid ${i < filled ? color : 'rgba(139,151,166,0.3)'}`,
              borderRadius: 1,
            }}
          />
        ))}
      </div>
      <span className="hud-label" style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
      <span className="font-hud text-[20px] font-bold leading-none" style={{ color }}>
        {lockout ? 'LOCK' : Math.round(value)}
      </span>
    </div>
  )
}

type OutpostState = 'nominal' | 'threatened' | 'draining' | 'critical' | 'lost'
export type Outpost = { name: string; integrity: number; state: OutpostState }

function OutpostGlyph({ state }: { state: OutpostState }) {
  const color =
    state === 'lost' ? 'var(--color-inert)'
    : state === 'critical' ? 'var(--color-critical)'
    : state === 'nominal' ? 'var(--color-friendly)'
    : 'var(--color-hostile)'
  const halo = state === 'threatened' || state === 'draining' || state === 'critical'
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" className="shrink-0">
      {halo && (
        <path d="M8 1 L14 8 L8 15 L2 8 Z" fill="none" stroke={color} strokeWidth={0.8} opacity={0.5}
          transform="scale(1.08)" style={{ transformOrigin: 'center' }} />
      )}
      {state === 'lost' ? (
        <path d="M8 2 L13 8 L8 14 L3 8 Z" fill="none" stroke={color} strokeWidth={1.2} />
      ) : state === 'draining' || state === 'critical' ? (
        <>
          <path d="M8 2 L13 8 L8 14 L3 8 Z" fill="none" stroke={color} strokeWidth={1.2} />
          <line x1={4.5} y1={8} x2={11.5} y2={8} stroke={color} strokeWidth={1} />
        </>
      ) : (
        <path d="M8 2 L13 8 L8 14 L3 8 Z" fill={color} stroke={color} strokeWidth={1} />
      )}
    </svg>
  )
}

export function OutpostRoster({ outposts }: { outposts: Outpost[] }) {
  return (
    <div className="w-[210px]">
      <div className="hud-label mb-2">Outposts</div>
      <ul className="flex flex-col gap-[6px]">
        {outposts.map((o) => {
          const pulse = o.state === 'critical' ? 'pulse-fast' : o.state === 'threatened' || o.state === 'draining' ? 'pulse-slow' : ''
          const color =
            o.state === 'lost' ? 'var(--color-inert)'
            : o.state === 'critical' ? 'var(--color-critical)'
            : o.state === 'nominal' ? 'var(--color-text-primary)'
            : 'var(--color-hostile)'
          return (
            <li
              key={o.name}
              className={`flex items-center gap-2 ${pulse}`}
              style={{ transform: o.state === 'critical' ? 'translateX(2px)' : undefined }}
            >
              <span className={pulse}><OutpostGlyph state={o.state} /></span>
              <span
                className="font-hud text-[14px] font-medium tracking-wide"
                style={{ color, textDecoration: o.state === 'lost' ? 'line-through' : undefined }}
              >
                {o.name}
              </span>
              <span className="ml-auto font-hud text-[14px] tabular-nums" style={{ color }}>
                {o.state === 'lost' ? '— LOST' : `${o.integrity}%`}
              </span>
              {(o.state === 'draining' || o.state === 'critical') && (
                <span className="text-[11px]" style={{ color }}>▼</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function AltitudeLadder({ altitude }: { altitude: number }) {
  // floor 8, ceiling 70
  const marks = [70, 60, 50, 40, 30, 20, 10, 8]
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="hud-label mb-1">Alt</div>
      {marks.map((m) => {
        const near = Math.abs(m - altitude) <= 5
        const warn = m <= 12
        const current = Math.round(altitude / 10) * 10 === m || (m === 8 && altitude < 12)
        return (
          <div key={m} className="flex items-center gap-1.5">
            <span
              className="font-hud text-[13px] tabular-nums"
              style={{
                color: current ? 'var(--color-friendly)' : warn ? 'var(--color-caution)' : 'var(--color-text-secondary)',
                opacity: near || current ? 1 : 0.5,
              }}
            >
              {near || current ? (current ? Math.round(altitude) : m) : '—'}
            </span>
            <span
              className="h-px"
              style={{
                width: current ? 18 : 10,
                background: current ? 'var(--color-friendly)' : warn ? 'var(--color-caution)' : 'var(--color-text-secondary)',
                opacity: current ? 1 : 0.4,
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

export function ComboMeter({ combo }: { combo: number }) {
  if (combo < 2) return null
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-hud text-[18px] font-bold" style={{ color: 'var(--color-friendly)' }}>×{combo}</span>
      <span className="hud-label">Combo</span>
      <div className="flex gap-[2px]">
        {[2, 3, 4, 5].map((n) => (
          <span key={n} className="h-1.5 w-1.5 rotate-45"
            style={{ background: combo >= n ? 'var(--color-friendly)' : 'transparent', border: '1px solid var(--color-friendly)', opacity: combo >= n ? 1 : 0.35 }} />
        ))}
      </div>
      {combo >= 5 && <span className="hud-label" style={{ color: 'var(--color-friendly)' }}>MAX</span>}
    </div>
  )
}

export function Alert({ text, severity }: { text: string; severity: 'info' | 'warning' | 'critical' }) {
  const color =
    severity === 'critical' ? 'var(--color-critical)' : severity === 'warning' ? 'var(--color-hostile)' : 'var(--color-friendly)'
  return (
    <div className="enter-overshoot flex items-center gap-3 px-4 py-2"
      style={{ border: `1px solid ${color}`, background: 'rgba(13,17,23,0.72)', backdropFilter: 'blur(6px)', borderRadius: 2 }}>
      <span className={`h-2 w-2 shrink-0 rotate-45 ${severity === 'critical' ? 'pulse-fast' : severity === 'warning' ? 'pulse-slow' : ''}`}
        style={{ background: color }} />
      <span className="font-hud text-[15px] font-semibold tracking-wide" style={{ color, letterSpacing: '0.08em' }}>{text}</span>
    </div>
  )
}
