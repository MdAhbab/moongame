// THREAT RING — the signature component.
// On a sphere you cannot be everywhere; this ring answers "where is it, and how
// far?" for every threat at once, even those behind you or over the horizon.
//
// Four independent, colour-blind-safe channels:
//   angle from 12 o'clock  -> bearing (12 = ahead, 6 = directly behind)
//   distance from centre   -> proximity (outer edge = far, near centre = close)
//   marker shape           -> entity type
//   pulse rate             -> urgency
// Colour only reinforces. Everything must read in greyscale.

export type Urgency = 'safe' | 'threatened' | 'critical'
export type Kind = 'harvester' | 'interceptor' | 'sentinel' | 'outpost'

export type Marker = {
  id: string
  bearing: number // degrees, 0 = ahead
  proximity: number // 0 = at crosshair, 1 = far edge
  kind: Kind
  urgency: Urgency
  hostile: boolean
  lost?: boolean
}

function pulseClass(u: Urgency) {
  if (u === 'critical') return 'pulse-fast'
  if (u === 'threatened') return 'pulse-slow'
  return ''
}

// Each glyph is drawn in its own local space, then translated + rotated so it
// orients along the bearing. Behind-markers additionally get an inward arrow.
function Glyph({ kind, color, lost }: { kind: Kind; color: string; lost?: boolean }) {
  const stroke = lost ? 'var(--color-inert)' : color
  const common = { stroke, strokeWidth: 1.4, fill: 'none', strokeLinejoin: 'round' as const }
  switch (kind) {
    case 'harvester': // chevron
      return <path d="M -5 3 L 0 -4 L 5 3" {...common} />
    case 'interceptor': // dart
      return <path d="M 0 -5 L 4 4 L 0 1.5 L -4 4 Z" {...common} fill={stroke} />
    case 'sentinel': // bar
      return <rect x={-5} y={-1.6} width={10} height={3.2} {...common} fill={stroke} />
    case 'outpost': // hexagon
      return (
        <path
          d="M 0 -5 L 4.3 -2.5 L 4.3 2.5 L 0 5 L -4.3 2.5 L -4.3 -2.5 Z"
          {...common}
          fill={lost ? 'none' : stroke}
          fillOpacity={lost ? 0 : 0.9}
        />
      )
  }
}

export default function ThreatRing({
  markers,
  size = 300,
  reticleLock,
}: {
  markers: Marker[]
  size?: number
  reticleLock?: number // 0..1 converging bracket progress, undefined = no lock
}) {
  const c = 50 // viewBox centre
  const outer = 44 // ring radius
  const innerClear = 15 // keep interior clear for the crosshair

  return (
    <svg
      viewBox="0 0 100 100"
      style={{ width: size, height: size }}
      className="overflow-visible"
      role="img"
      aria-label="Threat ring: bearing and proximity of nearby threats and outposts"
    >
      {/* idle ring — thin, low opacity */}
      <circle cx={c} cy={c} r={outer} fill="none" stroke="var(--color-friendly)" strokeWidth={0.6} opacity={0.22} />
      {/* rear hemisphere marker: a faint tick at 6 o'clock reminds you it wraps */}
      <line x1={c} y1={c + outer - 3} x2={c} y2={c + outer + 3} stroke="var(--color-text-secondary)" strokeWidth={0.5} opacity={0.4} />
      {/* cardinal ticks */}
      {[0, 90, 180, 270].map((a) => {
        const rad = ((a - 90) * Math.PI) / 180
        return (
          <line
            key={a}
            x1={c + Math.cos(rad) * (outer - 2)}
            y1={c + Math.sin(rad) * (outer - 2)}
            x2={c + Math.cos(rad) * (outer + 1)}
            y2={c + Math.sin(rad) * (outer + 1)}
            stroke="var(--color-friendly)"
            strokeWidth={0.5}
            opacity={0.3}
          />
        )
      })}

      {/* Crosshair — the ship's nose, exact centre. Shots go where it points. */}
      {reticleLock === undefined ? (
        <g stroke="var(--color-friendly)" strokeWidth={0.8}>
          <line x1={c - 6} y1={c} x2={c - 2.5} y2={c} />
          <line x1={c + 2.5} y1={c} x2={c + 6} y2={c} />
          <line x1={c} y1={c - 6} x2={c} y2={c - 2.5} />
          <line x1={c} y1={c + 2.5} x2={c} y2={c + 6} />
          <circle cx={c} cy={c} r={1} fill="var(--color-friendly)" stroke="none" />
        </g>
      ) : (
        // Locking: converging bracket that closes over the target (spatial, not %).
        <g stroke="var(--color-hostile)" strokeWidth={1} className={reticleLock >= 1 ? '' : 'pulse-slow'}>
          {[
            [1, 1],
            [-1, 1],
            [1, -1],
            [-1, -1],
          ].map(([sx, sy], i) => {
            const spread = 10 - 6 * reticleLock
            const x = c + sx * spread
            const y = c + sy * spread
            return (
              <path
                key={i}
                d={`M ${x} ${y + sy * 3.5} L ${x} ${y} L ${x + sx * 3.5} ${y}`}
                fill="none"
                strokeLinecap="round"
              />
            )
          })}
        </g>
      )}

      {markers.map((m) => {
        const rad = ((m.bearing - 90) * Math.PI) / 180
        const r = innerClear + (outer - innerClear) * m.proximity
        const x = c + Math.cos(rad) * r
        const y = c + Math.sin(rad) * r
        const color = m.hostile ? 'var(--color-hostile)' : 'var(--color-friendly)'
        const behind = m.bearing > 100 && m.bearing < 260
        return (
          <g key={m.id} transform={`translate(${x} ${y}) scale(0.62)`} className={pulseClass(m.urgency)}>
            {/* threatened/critical halo */}
            {m.urgency !== 'safe' && !m.lost && (
              <circle r={7} fill="none" stroke={m.urgency === 'critical' ? 'var(--color-critical)' : color} strokeWidth={0.8} opacity={0.5} />
            )}
            <g transform={`rotate(${m.hostile ? m.bearing : 0})`}>
              <Glyph kind={m.kind} color={m.urgency === 'critical' ? 'var(--color-critical)' : color} lost={m.lost} />
            </g>
            {/* inward arrow for anything behind the player */}
            {behind && (
              <path d="M -2 9 L 0 6 L 2 9" fill="none" stroke={color} strokeWidth={1.2} strokeLinejoin="round" />
            )}
          </g>
        )
      })}
    </svg>
  )
}
