// No React hook imports needed — component uses ref callbacks and no state
import { hudRefs } from '../../state/hudRefs'
import { MAX_MARKERS } from '../../game/core/readModel'
import type { MarkerKind } from '../../game/core/readModel'
import { requestLockOn } from '../../platform/deviceInput'
import styles from './ThreatRing.module.css'

/**
 * Tap a hostile marker to lock onto that specific target.
 *
 * `InputState.requestLockTarget` has existed since the first commit, is
 * documented as "set by touch tap-a-target", is read by `findLockTarget`, and
 * had never been written by anything. This is the thing that was missing.
 *
 * It matters most on glass, where there is no way to point the nose precisely
 * enough to pick one Harvester out of four stacked over the same outpost — but
 * it is bound for the mouse too, because being able to say *that one* is useful
 * with any pointer.
 *
 * The slot is read from the DOM rather than from React state because the
 * marker → entity mapping changes every frame as the pool churns, and §17.2
 * forbids re-rendering to track it. `writeHud` stamps the current slot on each
 * group as it positions it.
 */
function onMarkerPointerDown(event: React.PointerEvent<SVGGElement>): void {
  const slot = Number(event.currentTarget.dataset.lockSlot ?? '-1')
  if (Number.isFinite(slot) && slot >= 0) {
    event.stopPropagation()
    requestLockOn(slot)
  }
}

// Pre-allocated at module scope — not recreated on every render
const markerIndices = Array.from({ length: MAX_MARKERS }, (_, i) => i)

function Glyph({ kind }: { kind: MarkerKind }) {
  const common = { strokeWidth: 1.4, fill: 'none', strokeLinejoin: 'round' as const }
  switch (kind) {
    case 'Harvester': // chevron
      return <path d="M -5 3 L 0 -4 L 5 3" {...common} />
    case 'Interceptor': // dart
      return <path d="M 0 -5 L 4 4 L 0 1.5 L -4 4 Z" {...common} />
    case 'Sentinel': // bar
      return <rect x={-5} y={-1.6} width={10} height={3.2} {...common} />
    case 'Outpost': // hexagon
      return (
        <path
          d="M 0 -5 L 4.3 -2.5 L 4.3 2.5 L 0 5 L -4.3 2.5 L -4.3 -2.5 Z"
          {...common}
        />
      )
  }
}

export function ThreatRing({ size = 300 }: { size?: number }) {
  const c = 50 // viewBox centre
  const outer = 44 // ring radius

  return (
    <svg
      viewBox="0 0 100 100"
      style={{ width: size, height: size }}
      className={styles.ring}
      role="img"
      aria-label="Threat ring: bearing and proximity of nearby threats and outposts"
    >
      {/* idle ring — thin, low opacity */}
      <circle cx={c} cy={c} r={outer} fill="none" stroke="var(--friendly)" strokeWidth={0.6} opacity={0.22} />
      
      {/* rear hemisphere marker: a faint tick at 6 o'clock reminds you it wraps */}
      <line x1={c} y1={c + outer - 3} x2={c} y2={c + outer + 3} stroke="var(--text-secondary)" strokeWidth={0.5} opacity={0.4} />
      
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
            stroke="var(--friendly)"
            strokeWidth={0.5}
            opacity={0.3}
          />
        )
      })}

      {/*
        The ring's centre is *the craft*, not the aim point.

        It used to carry a crosshair and a lock bracket drawn at exactly this
        spot, which was a claim the game could not keep: the camera sits behind
        and above the craft, so the nose ray lands well up the screen from the
        ring, and the pitch axis moves it further with every input. Both marks
        are now drawn where they actually are, by `Reticle.tsx`. What is left
        here is a plain pip that means "you are here" — which is the only thing
        the middle of a relative-bearing display can honestly mean.
      */}
      <circle cx={c} cy={c} r={1.4} fill="var(--friendly)" stroke="none" opacity={0.75} />

      {/* Pre-allocated Markers */}
      {markerIndices.map((i) => (
        <g
          key={i}
          ref={(el) => { hudRefs.threatMarkers[i] = el }}
          style={{ display: 'none' }}
          className={styles.markerGroup}
          onPointerDown={onMarkerPointerDown}
        >
          {/* An invisible, generous hit area. The glyphs are 10 units across,
              which is well under the 44 px minimum touch target once the ring
              is scaled down (§35). */}
          <circle className="hit" r={11} fill="transparent" stroke="none" />
          {/* We rely on CSS classes (e.g. pulse-fast) and inline strokes being updated 
              if needed. Since we only pre-allocate nodes, we might need a way to change 
              the shape dynamically if the pool is reused.
              However, SVG doesn't easily let us change the 'd' attribute via simple DOM 
              without complex React logic. 
              Actually, §2.1 says "Pre-create MAX_MARKERS <g> nodes at mount and update 
              their transform and visibility attributes imperatively."
              Wait, the kind/colour/lost can change per marker slot. If we must change 
              kind imperatively, we might need nested elements toggled via display:none, 
              or we must write to the DOM manually inside writeHud.
              Let's create all shapes inside the <g> and toggle their display! */}
          <g className="glyph-harvester" style={{ display: 'none' }}>
             <Glyph kind="Harvester" />
          </g>
          <g className="glyph-interceptor" style={{ display: 'none' }}>
             <Glyph kind="Interceptor" />
          </g>
          <g className="glyph-sentinel" style={{ display: 'none' }}>
             <Glyph kind="Sentinel" />
          </g>
          <g className="glyph-outpost" style={{ display: 'none' }}>
             <Glyph kind="Outpost" />
          </g>
          {/* Halo for threatened/critical */}
          <circle className="halo" r={7} fill="none" strokeWidth={0.8} opacity={0.5} style={{ display: 'none' }} />
          {/* Inward arrow for behind */}
          <path className="arrow-behind" d="M -2 9 L 0 6 L 2 9" fill="none" strokeWidth={1.2} strokeLinejoin="round" style={{ display: 'none' }} />
        </g>
      ))}
    </svg>
  )
}
