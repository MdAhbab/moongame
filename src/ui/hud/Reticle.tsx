import { hudRefs } from '../../state/hudRefs'
import styles from './Reticle.module.css'

/**
 * The reticle layer (gameplan §8.4, §12.2).
 *
 * ## Why this exists
 *
 * Until now the game had no crosshair. Not a subtle one — none: `reticleAim` was
 * computed every step and read by nobody, `hudRefs.lockReticle` was declared and
 * never attached to an element, and the only sign that a lock existed at all was
 * a four-character text field in the bottom-right corner. A game whose central
 * verb is "shoot the thing in front of you" was asking players to aim at the
 * middle of the screen and hope.
 *
 * Four marks, each answering one question the player is actually asking:
 *
 *  - **crosshair** — *where does the gun point?* On the nose ray, pulled by aim
 *    assist exactly as far as the assist actually helps, so the magnetism is
 *    something you watch rather than something you are told about (§8.4).
 *  - **lead pip** — *where do I aim to hit a moving target?* The solved
 *    intercept point. Deflection shooting stops being folklore.
 *  - **lock box** — *what am I locked onto, and how far along is it?* A ring
 *    that fills as the lock acquires and snaps to amber when it takes.
 *  - **bomb marker** — *where will the bomb land?* The literal predicted impact
 *    point, with the blast radius drawn at its true size on the ground and the
 *    time of fall beside it.
 *
 * ## How it is drawn
 *
 * Nothing here re-renders. The nodes mount once and the frame callback writes
 * `transform` and `opacity` on them (§17.2, §32.2) — the world-space points come
 * from the simulation, the projection from the render bridge's camera, and this
 * component owns only the glyphs.
 *
 * `stroke` is `currentColor` throughout, so a single `style.color` write on the
 * container recolours a whole mark — one property instead of six.
 */
export function Reticle() {
  return (
    <div className={styles.layer} ref={(el) => { hudRefs.reticleLayer = el }} aria-hidden="true">
      {/* Aim point. The gap in the middle is deliberate: a solid dot hides the
          thing you are shooting at, which is the one pixel that matters. */}
      <div className={styles.node} ref={(el) => { hudRefs.reticleCrosshair = el }}>
        <svg viewBox="-32 -32 64 64" width="64" height="64" className={styles.glyph}>
          <circle cx="0" cy="0" r="11" fill="none" stroke="currentColor" strokeWidth="1.25" opacity="0.55" />
          <path d="M0,-22 L0,-14 M0,14 L0,22 M-22,0 L-14,0 M14,0 L22,0" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="0" cy="0" r="1.4" fill="currentColor" />
        </svg>
      </div>

      {/* Lead pip — hollow, so it never competes with the aim point. */}
      <div className={`${styles.node} ${styles.lead}`} ref={(el) => { hudRefs.reticleLead = el }}>
        <svg viewBox="-16 -16 32 32" width="32" height="32" className={styles.glyph}>
          <circle cx="0" cy="0" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2.5" />
        </svg>
      </div>

      {/* Lock box: four corner brackets plus the acquisition ring. */}
      <div className={styles.node} ref={(el) => { hudRefs.lockBox = el }}>
        <svg viewBox="-56 -56 112 112" width="112" height="112" className={styles.glyph}>
          <circle
            ref={(el) => { hudRefs.lockRing = el }}
            cx="0"
            cy="0"
            r="44"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            pathLength="100"
            strokeDasharray="0 100"
            /* -90° so the ring fills from the top, the direction every progress
               dial in the rest of the HUD reads. */
            transform="rotate(-90)"
            opacity="0.9"
          />
          <path
            d="M-44,-30 L-44,-44 L-30,-44 M30,-44 L44,-44 L44,-30 M44,30 L44,44 L30,44 M-30,44 L-44,44 L-44,30"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          />
        </svg>
      </div>
      <span className={styles.label} ref={(el) => { hudRefs.lockLabel = el }}>LOCK</span>

      {/* Bomb impact. Only the point and the time live here — the blast
          footprint is drawn on the ground itself by `BombTarget`, where
          perspective can make it the right shape. */}
      <div className={`${styles.node} ${styles.bomb}`} ref={(el) => { hudRefs.bombMarker = el }}>
        <svg viewBox="-28 -28 56 56" width="56" height="56" className={styles.glyph}>
          <circle cx="0" cy="0" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.8" />
          <path d="M-17,0 L-4,0 M4,0 L17,0 M0,-17 L0,-4 M0,4 L0,17" stroke="currentColor" strokeWidth="2" />
        </svg>
      </div>
      <span className={`${styles.label} ${styles.bombLabel}`} ref={(el) => { hudRefs.bombMarkerLabel = el }} />
    </div>
  )
}
