import { hudRefs } from '../../state/hudRefs'
import { MAX_MAP_MARKERS } from '../../game/core/readModel'
import { CROSSING_TIME } from '../../game/data/constants'
import styles from './OrbitalMap.module.css'

/** Pre-allocated at module scope — not rebuilt on every render. */
const markerIndices = Array.from({ length: MAX_MAP_MARKERS }, (_, i) => i)

/**
 * The Orbital Map (gameplan §12.4), held open with the `map` binding (Tab).
 *
 * The `map` action has been in the default keybind table since the first
 * commit and has never done anything — a control the player can see, rebind and
 * press, with nothing behind it. This is what it opens.
 *
 * **Azimuthal equidistant, centred on the craft, heading up.** The projection
 * is the design: distance from the middle is proportional to great-circle
 * distance, which is the currency every decision in this game is priced in. The
 * rings are therefore not decoration but a scale — each one is a number of
 * seconds at cruise, so "can I reach Cassini before it falls" is answered by
 * looking rather than by guessing.
 *
 * Mounted once and never re-rendered. Every symbol is positioned by `writeMap`
 * through the refs collected here, so opening the map during play costs zero
 * React work (§17.2).
 */
export function OrbitalMap() {
  // 46 units of the viewBox spans a half-circumference (π·R), so the outer ring
  // is `CROSSING_TIME` seconds away at cruise and each inner one a quarter of
  // that. **Derived, not written down**: the labels used to read 15/30/45/60 s
  // against an outer ring that was actually 7 s away, which made the one HUD
  // element whose entire purpose is answering "can I get there in time" wrong by
  // a factor of eight and a half.
  const rings = [1, 2, 3, 4].map((step) => ({
    radius: (46 * step) / 4,
    label: `${(CROSSING_TIME * step / 4).toFixed(0)}s`,
  }))

  return (
    <div
      className={styles.overlay}
      ref={(el) => { hudRefs.mapRoot = el }}
      aria-hidden="true"
    >
      <div className={styles.panel}>
        <div className={styles.header}>ORBITAL MAP</div>
        <svg viewBox="0 0 100 100" className={styles.chart} role="img" aria-label="Orbital map">
          {/* Range rings, labelled in seconds of flight at cruise. */}
          {rings.map((ring) => (
            <g key={ring.label}>
              <circle
                cx={50}
                cy={50}
                r={ring.radius}
                fill="none"
                stroke="var(--friendly)"
                strokeWidth={0.4}
                opacity={0.24}
              />
              <text
                x={50 - ring.radius * 0.707 + 1.4}
                y={50 + ring.radius * 0.707 - 1}
                className={styles.ringLabel}
                fill="var(--text-secondary)"
              >
                {ring.label}
              </text>
            </g>
          ))}

          {/* Heading cross. Up is where the craft is pointing, always. */}
          <line x1={50} y1={4} x2={50} y2={96} stroke="var(--hairline)" strokeWidth={0.3} opacity={0.5} />
          <line x1={4} y1={50} x2={96} y2={50} stroke="var(--hairline)" strokeWidth={0.3} opacity={0.5} />

          {/* The craft: fixed at the centre, because the map moves, not it. */}
          <path
            d="M 0 -3.4 L 2.4 2.6 L 0 1.2 L -2.4 2.6 Z"
            transform="translate(50, 50)"
            fill="var(--friendly)"
            stroke="none"
          />

          {markerIndices.map((i) => (
            <g
              key={i}
              ref={(el) => { hudRefs.mapMarkers[i] = el }}
              style={{ display: 'none' }}
              strokeWidth={1.4}
              fill="none"
              strokeLinejoin="round"
            >
              <path className="map-outpost" d="M 0 -5 L 4.3 -2.5 L 4.3 2.5 L 0 5 L -4.3 2.5 L -4.3 -2.5 Z" />
              <circle className="map-enemy" cx={0} cy={0} r={3.2} />
              <text className="map-label" x={7} y={2} stroke="none" fontSize={7}>
                {''}
              </text>
            </g>
          ))}
        </svg>
        <div className={styles.footer}>Hold TAB · rings are seconds at cruise</div>
      </div>
    </div>
  )
}
