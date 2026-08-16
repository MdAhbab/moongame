// src/state/hudRefs.ts
import type { HudFrame, MapMarker, ThreatMarker } from '../game/core/readModel'
import { MAX_MAP_MARKERS, MAX_MARKERS } from '../game/core/readModel'
import { OUTPOSTS } from '../game/data/outposts'
import { LOCK_TIME } from '../game/data/constants'

/**
 * The DOM-ref registry for per-frame values (gameplan §17.2, §32.2).
 * 
 * Values that change every frame (hull, heat, speed, bearing) are written
 * DIRECTLY TO DOM REFS. They never touch React.
 */
export interface HudRefs {
  hullFill: HTMLElement | null
  hullText: HTMLElement | null
  heatFill: HTMLElement | null
  heatText: HTMLElement | null
  
  scoreText: HTMLElement | null
  comboText: HTMLElement | null
  waveText: HTMLElement | null
  
  speedText: HTMLElement | null
  altitudeText: HTMLElement | null
  altitudeTrend: HTMLElement | null
  
  boostFill: HTMLElement | null
  lockProgress: HTMLElement | null

  /* ---- the reticle layer (§8.4) ---- */
  reticleLayer: HTMLElement | null
  reticleCrosshair: HTMLElement | null
  reticleLead: HTMLElement | null
  lockBox: HTMLElement | null
  lockRing: SVGCircleElement | null
  lockLabel: HTMLElement | null
  bombMarker: HTMLElement | null
  bombMarkerLabel: HTMLElement | null
  targetReadout: HTMLElement | null
  targetHealthFill: HTMLElement | null

  /* ---- craft condition (§7.6) ---- */
  systemEngine: HTMLElement | null
  systemWeapon: HTMLElement | null
  systemControl: HTMLElement | null
  droneCount: HTMLElement | null
  lanceCharge: HTMLElement | null

  bombText: HTMLElement | null
  bombFill: HTMLElement | null
  weaponModeText: HTMLElement | null
  engineModeText: HTMLElement | null
  flareText: HTMLElement | null
  aegisText: HTMLElement | null
  
  horizon: HTMLElement | null
  damageVignette: HTMLElement | null
  
  touchStick: HTMLElement | null
  touchThrottle: HTMLElement | null
  /** The slide rocker's knob. Its own widget so sliding is not a second stick axis. */
  touchSlide: HTMLElement | null
  
  /** MAX_MARKERS (56) SVG <g> nodes, pre-allocated at mount. */
  threatMarkers: (SVGGElement | null)[]
  drawCallsText: HTMLElement | null

  /* ---- Orbital Map (§12.4) ---- */
  /**
   * Whether the map overlay is up.
   *
   * A plain flag here rather than store state because the map is held open by a
   * key and must not re-render `PlayingScreen` (§17.2) — the input layer writes
   * it, the frame callback reads it, and React never learns it happened.
   */
  mapOpen: boolean
  mapRoot: HTMLElement | null
  /** MAX_MAP_MARKERS (56) SVG <g> nodes, pre-allocated at mount. */
  mapMarkers: (SVGGElement | null)[]
}

export const hudRefs: HudRefs = {
  hullFill: null,
  hullText: null,
  heatFill: null,
  heatText: null,
  
  scoreText: null,
  comboText: null,
  waveText: null,
  
  speedText: null,
  altitudeText: null,
  altitudeTrend: null,
  
  boostFill: null,
  lockProgress: null,

  reticleLayer: null,
  reticleCrosshair: null,
  reticleLead: null,
  lockBox: null,
  lockRing: null,
  lockLabel: null,
  bombMarker: null,
  bombMarkerLabel: null,
  targetReadout: null,
  targetHealthFill: null,

  systemEngine: null,
  systemWeapon: null,
  systemControl: null,
  droneCount: null,
  lanceCharge: null,

  bombText: null,
  bombFill: null,
  weaponModeText: null,
  engineModeText: null,
  flareText: null,
  aegisText: null,
  
  horizon: null,
  damageVignette: null,
  
  touchStick: null,
  touchThrottle: null,
  touchSlide: null,
  
  threatMarkers: [],
  drawCallsText: null,

  mapOpen: false,
  mapRoot: null,
  mapMarkers: [],
}

/**
 * The single function the render bridge (Task 1) calls each frame to mutate the DOM.
 */
export function writeHud(frame: HudFrame, markers: ThreatMarker[]) {
  // Update HUD text values
  if (hudRefs.hullText) hudRefs.hullText.textContent = String(Math.ceil(frame.hull))
  if (hudRefs.heatText) hudRefs.heatText.textContent = String(Math.ceil(frame.heat))
  if (hudRefs.scoreText) hudRefs.scoreText.textContent = frame.score.toLocaleString()
  if (hudRefs.comboText) hudRefs.comboText.textContent = `×${frame.combo}`
  if (hudRefs.speedText) hudRefs.speedText.textContent = String(Math.round(frame.speed))
  if (hudRefs.altitudeText) hudRefs.altitudeText.textContent = String(Math.ceil(frame.altitude))
  if (hudRefs.waveText) hudRefs.waveText.textContent = String(frame.wave)
  
  // Update bars and fills (using transform or width)
  if (hudRefs.hullFill) hudRefs.hullFill.style.transform = `scaleX(${frame.hull / 100})`
  if (hudRefs.heatFill) hudRefs.heatFill.style.transform = `scaleX(${frame.heat / 100})`
  if (hudRefs.boostFill) hudRefs.boostFill.style.transform = `scaleX(${frame.boostCharge})`

  // Bomb Bay Status
  if (hudRefs.bombText) {
    if (frame.bombCooldown <= 0) {
      hudRefs.bombText.textContent = 'READY'
      hudRefs.bombText.style.color = '#38ef7d'
    } else {
      hudRefs.bombText.textContent = `${frame.bombCooldown.toFixed(1)}s`
      hudRefs.bombText.style.color = '#ffaa30'
    }
  }
  if (hudRefs.bombFill) {
    const readyFrac = frame.bombCooldown <= 0 ? 1 : Math.max(0, 1 - frame.bombCooldown / 20)
    hudRefs.bombFill.style.transform = `scaleX(${readyFrac})`
  }

  // Weapon & Engine Mode Status
  if (hudRefs.weaponModeText) {
    hudRefs.weaponModeText.textContent = frame.weaponMode === 'cannon' ? 'PULSE CANNON' : 'HOMING MISSILES'
  }
  if (hudRefs.engineModeText) {
    if (frame.engineCut) {
      hudRefs.engineModeText.textContent = 'DRIFT FLOAT [ENGINE OFF]'
      hudRefs.engineModeText.style.color = '#00e5ff'
    } else {
      hudRefs.engineModeText.textContent = 'PROPULSION [ACTIVE]'
      hudRefs.engineModeText.style.color = 'var(--text-secondary)'
    }
  }
  if (hudRefs.flareText) {
    hudRefs.flareText.textContent = `FLARES: ${frame.flaresRemaining}`
  }
  if (hudRefs.aegisText) {
    if (frame.aegisShield > 0) {
      hudRefs.aegisText.style.display = 'inline-block'
      hudRefs.aegisText.textContent = `AEGIS SHIELD: ${Math.ceil(frame.aegisShield)}`
    } else {
      hudRefs.aegisText.style.display = 'none'
    }
  }
  
  // Altitude trend
  if (hudRefs.altitudeTrend) {
    if (frame.altitudeRate > 2) hudRefs.altitudeTrend.textContent = '▲'
    else if (frame.altitudeRate < -2) hudRefs.altitudeTrend.textContent = '▼'
    else hudRefs.altitudeTrend.textContent = '─'
  }
  
  // Vignette
  if (hudRefs.damageVignette) {
    hudRefs.damageVignette.style.opacity = String(frame.trauma * 0.4) // max 40%
    hudRefs.damageVignette.style.transform = `rotate(${frame.lastHitBearing}rad)`
  }
  
  // Horizon
  if (hudRefs.horizon) {
    hudRefs.horizon.style.transform = `rotate(${-frame.horizonRoll}rad) translateY(${frame.horizonPitch * 50}px)`
  }

  // Lock status line, bottom right.
  if (hudRefs.lockProgress) {
    if (frame.lockState === 1) {
      hudRefs.lockProgress.textContent = `${(LOCK_TIME * (1 - frame.lockProgress)).toFixed(1)}s`
      hudRefs.lockProgress.style.color = 'var(--caution)'
    } else if (frame.lockState === 2) {
      // "ACQUIRED" rather than "LOCKED": the field sits after a static "LOCK"
      // label, and the pair read as "LOCK LOCKED".
      hudRefs.lockProgress.textContent = 'ACQUIRED'
      hudRefs.lockProgress.style.color = 'var(--hostile)'
    } else {
      hudRefs.lockProgress.textContent = '—'
      hudRefs.lockProgress.style.color = 'var(--text-secondary)'
    }
  }

  // Target readout: what is being tracked, how far, how hurt. Sits under the
  // lock line rather than beside the reticle, so reading it never means looking
  // away from the thing you are shooting at.
  if (hudRefs.targetReadout) {
    if (frame.lockKind === null) {
      hudRefs.targetReadout.textContent = 'NO TARGET'
      hudRefs.targetReadout.style.color = 'var(--text-secondary)'
    } else {
      hudRefs.targetReadout.textContent = `${frame.lockKind.toUpperCase()} · ${Math.round(frame.lockRange)}u`
      hudRefs.targetReadout.style.color = frame.lockState === 2 ? 'var(--hostile)' : 'var(--text-primary)'
    }
  }
  if (hudRefs.targetHealthFill) {
    hudRefs.targetHealthFill.style.transform = `scaleX(${frame.lockKind === null ? 0 : frame.lockHealth})`
  }

  // Craft condition. Three pips rather than three bars: the player needs to
  // know *which* system is hurt and roughly how badly, and a bar invites reading
  // a number off it mid-fight, which nobody has time to do.
  writeSystem(hudRefs.systemEngine, frame.engineIntegrity)
  writeSystem(hudRefs.systemWeapon, frame.weaponIntegrity)
  writeSystem(hudRefs.systemControl, frame.controlIntegrity)

  // The bay is always on screen once the run is under way: an ability the
  // player cannot see the state of is one they forget they have, which is
  // exactly what happened when drones were a perk. Three states, one pip —
  // flying (with its clock), recharging (with its clock), or ready.
  if (hudRefs.droneCount) {
    hudRefs.droneCount.style.display = 'inline-block'
    if (frame.drones > 0) {
      hudRefs.droneCount.textContent = `🛰 ${frame.drones} · ${frame.droneRemaining.toFixed(0)}s`
      hudRefs.droneCount.style.color = 'var(--friendly)'
    } else if (frame.droneCooldown > 0) {
      hudRefs.droneCount.textContent = `🛰 ${frame.droneCooldown.toFixed(0)}s`
      hudRefs.droneCount.style.color = 'var(--text-secondary)'
    } else {
      hudRefs.droneCount.textContent = `🛰 ×${frame.droneTier} READY`
      hudRefs.droneCount.style.color = 'var(--caution)'
    }
  }

  if (hudRefs.lanceCharge) {
    if (frame.lanceCharge > 0) {
      hudRefs.lanceCharge.style.display = 'inline-block'
      const ready = frame.lanceCharge >= 1
      hudRefs.lanceCharge.textContent = ready ? '☀ LANCE READY' : `☀ ${Math.round(frame.lanceCharge * 100)}%`
      hudRefs.lanceCharge.style.color = ready ? 'var(--caution)' : 'var(--text-secondary)'
    } else {
      hudRefs.lanceCharge.style.display = 'none'
    }
  }

  // Update Threat Markers
  const c = 50
  const outer = 44
  const innerClear = 15

  for (let i = 0; i < MAX_MARKERS; i++) {
    const el = hudRefs.threatMarkers[i]
    if (!el) continue

    const marker: ThreatMarker | undefined = markers[i]

    if (!marker || !marker.active) {
      el.style.display = 'none'
      continue
    }

    el.style.display = 'inline'
    // The enemy's pool slot, so a tap on the marker can request a lock on that
    // exact target. `-1` for outposts, which are not lockable. Written here
    // because this is the only place that knows which entity a marker slot is
    // currently showing — the mapping changes every frame as the pool churns.
    el.dataset.lockSlot = marker.hostile ? String(marker.id) : '-1'

    // Proximity logic (§12.2 P1: nearer = further out on the ring)
    const prox = 1.0 - marker.proximity // 0 at player -> maps to outer edge
    const r = innerClear + (outer - innerClear) * prox
    const rad = marker.bearing - Math.PI / 2
    
    const x = c + Math.cos(rad) * r
    const y = c + Math.sin(rad) * r
    
    // Rotation applied in the group itself if hostile
    const rot = marker.hostile ? marker.bearing * (180 / Math.PI) : 0
    el.setAttribute('transform', `translate(${x}, ${y}) scale(0.62) rotate(${rot})`)

    // Color logic
    const color = marker.hostile ? 'var(--hostile)' : 'var(--friendly)'
    const strokeColor = marker.extinguished ? 'var(--inert)' : (marker.urgency === 'critical' ? 'var(--critical)' : color)
    el.setAttribute('stroke', strokeColor)

    // Toggle specific shapes
    const children = el.children as HTMLCollectionOf<SVGGraphicsElement>
    for (let j = 0; j < children.length; j++) {
      const child = children[j]
      if (child === undefined) continue
      const cls = child.getAttribute('class') || ''

      if (cls.includes('glyph-harvester')) child.style.display = marker.kind === 'Harvester' ? 'inline' : 'none'
      else if (cls.includes('glyph-interceptor')) child.style.display = marker.kind === 'Interceptor' ? 'inline' : 'none'
      else if (cls.includes('glyph-sentinel')) child.style.display = marker.kind === 'Sentinel' ? 'inline' : 'none'
      else if (cls.includes('glyph-sapper')) child.style.display = marker.kind === 'Sapper' ? 'inline' : 'none'
      else if (cls.includes('glyph-warden')) child.style.display = marker.kind === 'Warden' ? 'inline' : 'none'
      else if (cls.includes('glyph-carrier')) child.style.display = marker.kind === 'Carrier' ? 'inline' : 'none'
      else if (cls.includes('glyph-outpost')) {
        child.style.display = marker.kind === 'Outpost' ? 'inline' : 'none'
        // Outposts draw hollow if extinguished
        child.setAttribute('fill', marker.extinguished ? 'none' : strokeColor)
        child.setAttribute('fill-opacity', marker.extinguished ? '0' : '0.9')
      }
      else if (cls.includes('halo')) {
        const showHalo = marker.urgency !== 'safe' && !marker.extinguished
        child.style.display = showHalo ? 'inline' : 'none'
        if (showHalo) {
          child.setAttribute('stroke', marker.urgency === 'critical' ? 'var(--critical)' : color)
        }
      }
      else if (cls.includes('arrow-behind')) {
        // bearing is on (-π, π]: behind = |bearing| > ~108° i.e. > 0.6π
        const behind = Math.abs(marker.bearing) > Math.PI * 0.6
        child.style.display = behind ? 'inline' : 'none'
        if (behind) {
          child.setAttribute('stroke', color)
        }
      }
    }

    // Pulse animation via class
    if (marker.urgency === 'critical') {
      el.setAttribute('class', 'pulse-fast')
    } else if (marker.urgency === 'threatened') {
      el.setAttribute('class', 'pulse-slow')
    } else {
      el.setAttribute('class', '')
    }
  }
}

/**
 * Paints one system pip by integrity.
 *
 * Colour *and* opacity, so the state survives a colour-blind reading and a
 * glance at the edge of vision alike (§35.1).
 */
function writeSystem(element: HTMLElement | null, integrity: number): void {
  if (element === null) return
  element.style.opacity = String(0.35 + 0.65 * integrity)
  element.style.color =
    integrity >= 0.99
      ? 'var(--text-secondary)'
      : integrity > 0.6
        ? 'var(--caution)'
        : 'var(--hostile)'
}

/* ------------------------------------------------------------------ */
/* The reticle layer (§8.4)                                            */
/* ------------------------------------------------------------------ */

/**
 * Everything the reticle draws, already projected to screen pixels.
 *
 * The *points* are the simulation's (`WeaponSystem` publishes them in world
 * space); the *projection* is the render layer's, because only it holds the
 * camera. This struct is the seam between them, and like every other read model
 * here it is pre-allocated and mutated in place (Rule 3).
 */
export interface AimFrame {
  /** False while there is nothing to aim — dead craft, menus, attract loop. */
  active: boolean

  crosshairVisible: boolean
  crosshairX: number
  crosshairY: number
  /** True while aim assist has pulled the crosshair off the bare nose ray. */
  magnetised: boolean
  /** True while the gun is locked out, so the crosshair can say so. */
  overheated: boolean

  /** The deflection pip: where to aim so a bullet arrives where the target will be. */
  leadVisible: boolean
  leadX: number
  leadY: number

  lockVisible: boolean
  lockX: number
  lockY: number
  /** Apparent radius of the target on screen, px. Drives the box's size. */
  lockRadius: number
  /** 0–1 while acquiring; 1 when held. */
  lockProgress: number
  locked: boolean

  bombVisible: boolean
  bombX: number
  bombY: number
  /** Apparent blast radius on the surface, px. */
  bombRadius: number
  /** Seconds of fall, for the marker's readout. */
  bombTime: number

  /**
   * Where the two captions sit, already kept inside the viewport.
   *
   * Clamped by the projector rather than by CSS, because the natural position —
   * just past the edge of a mark — is off-screen exactly when the mark is
   * largest, which is exactly when the player is closest to using it.
   */
  lockLabelY: number
  bombLabelY: number

  /** Decaying 0–1 pulse the crosshair flashes with when a shot connects. */
  hitPulse: number
  /** Decaying 0–1 pulse for a kill, drawn distinctly from a hit. */
  killPulse: number
}

export function createAimFrame(): AimFrame {
  return {
    active: false,
    crosshairVisible: false,
    crosshairX: 0,
    crosshairY: 0,
    magnetised: false,
    overheated: false,
    leadVisible: false,
    leadX: 0,
    leadY: 0,
    lockVisible: false,
    lockX: 0,
    lockY: 0,
    lockRadius: 24,
    lockProgress: 0,
    locked: false,
    bombVisible: false,
    bombX: 0,
    bombY: 0,
    bombRadius: 30,
    bombTime: 0,
    lockLabelY: 0,
    bombLabelY: 0,
    hitPulse: 0,
    killPulse: 0,
  }
}

/** Base radius of the lock ring in the SVG's own units. See `Reticle.tsx`. */
const LOCK_RING_RADIUS = 44

/**
 * Moves the reticle's four nodes to where the camera says they belong.
 *
 * Transforms only — never `left`/`top`, which would lay out and paint on every
 * frame. Each node is a composited layer that only ever has its transform and
 * opacity written, which is the same discipline the Threat Ring follows and the
 * reason the HUD costs nothing at 120 Hz (§17.2).
 * @hot-path
 */
export function writeAim(aim: AimFrame): void {
  const layer = hudRefs.reticleLayer
  if (layer === null) return

  layer.style.opacity = aim.active ? '1' : '0'
  if (!aim.active) return

  const crosshair = hudRefs.reticleCrosshair
  if (crosshair !== null) {
    if (aim.crosshairVisible) {
      // The hit pulse swells the crosshair a few percent. Small on purpose: it
      // has to register in peripheral vision without moving the thing the
      // player is using to aim.
      const swell = 1 + aim.hitPulse * 0.22 + aim.killPulse * 0.35
      crosshair.style.opacity = '1'
      crosshair.style.transform = `translate3d(${aim.crosshairX}px, ${aim.crosshairY}px, 0) scale(${swell})`
      crosshair.style.color = aim.overheated
        ? 'var(--caution)'
        : aim.killPulse > 0
          ? 'var(--critical)'
          : aim.hitPulse > 0 || aim.magnetised
            ? 'var(--hostile)'
            : 'var(--friendly)'
    } else {
      crosshair.style.opacity = '0'
    }
  }

  const lead = hudRefs.reticleLead
  if (lead !== null) {
    lead.style.opacity = aim.leadVisible ? '0.85' : '0'
    if (aim.leadVisible) {
      lead.style.transform = `translate3d(${aim.leadX}px, ${aim.leadY}px, 0)`
    }
  }

  const box = hudRefs.lockBox
  if (box !== null) {
    if (aim.lockVisible) {
      const scale = Math.max(0.35, aim.lockRadius / LOCK_RING_RADIUS)
      box.style.opacity = '1'
      box.style.transform = `translate3d(${aim.lockX}px, ${aim.lockY}px, 0) scale(${scale})`
      box.style.color = aim.locked ? 'var(--hostile)' : 'var(--caution)'
    } else {
      box.style.opacity = '0'
    }
  }
  if (hudRefs.lockRing !== null) {
    // `pathLength` is 100 on the element, so the dash array is a percentage
    // whatever the radius happens to be.
    const filled = aim.locked ? 100 : aim.lockProgress * 100
    hudRefs.lockRing.setAttribute('stroke-dasharray', `${filled} 100`)
  }
  // The two labels are their own nodes rather than children of the scaled
  // markers: a caption inside a node scaled to a blast radius would be
  // unreadable at one distance and enormous at another.
  const lockLabel = hudRefs.lockLabel
  if (lockLabel !== null) {
    const show = aim.lockVisible && aim.locked
    lockLabel.style.opacity = show ? '1' : '0'
    if (show) {
      lockLabel.style.transform = `translate3d(${aim.lockX}px, ${aim.lockLabelY}px, 0)`
    }
  }

  const bomb = hudRefs.bombMarker
  if (bomb !== null) {
    // Fixed size, unlike the lock box: this marks a *point*, and the area it
    // implies is drawn on the ground by the scene layer at its true extent.
    bomb.style.opacity = aim.bombVisible ? '1' : '0'
    if (aim.bombVisible) {
      bomb.style.transform = `translate3d(${aim.bombX}px, ${aim.bombY}px, 0)`
    }
  }
  const bombLabel = hudRefs.bombMarkerLabel
  if (bombLabel !== null) {
    bombLabel.style.opacity = aim.bombVisible ? '1' : '0'
    if (aim.bombVisible) {
      bombLabel.style.transform = `translate3d(${aim.bombX}px, ${aim.bombLabelY}px, 0)`
      bombLabel.textContent = `IMPACT ${aim.bombTime.toFixed(1)}s`
    }
  }
}

/**
 * Draws the Orbital Map (§12.4). Called only while the overlay is open.
 *
 * Separate from `writeHud` because it runs on a different schedule: the HUD is
 * written every frame of every run, the map only while a key is held. Folding
 * it in would mean either paying for 56 hidden symbols always, or a branch in
 * the middle of the hot path that reads worse than two functions do.
 */
export function writeMap(markers: MapMarker[]): void {
  const root = hudRefs.mapRoot
  if (root === null) return

  const open = hudRefs.mapOpen
  root.style.opacity = open ? '1' : '0'
  root.style.pointerEvents = 'none'
  root.setAttribute('aria-hidden', open ? 'false' : 'true')
  if (!open) return

  // viewBox is 0..100 with the craft at the centre; radius 46 is the antipode,
  // leaving a margin so a symbol exactly opposite is not clipped by the frame.
  const centre = 50
  const span = 46

  for (let i = 0; i < MAX_MAP_MARKERS; i++) {
    const el = hudRefs.mapMarkers[i]
    if (!el) continue

    const marker: MapMarker | undefined = markers[i]
    if (!marker || !marker.active) {
      el.style.display = 'none'
      continue
    }
    el.style.display = 'inline'

    const x = centre + marker.x * span
    const y = centre + marker.y * span
    const scale = marker.kind === 'Outpost' ? 0.62 : 0.4
    el.setAttribute('transform', `translate(${x}, ${y}) scale(${scale})`)

    let color = 'var(--hostile)'
    if (marker.kind === 'Outpost') {
      color =
        marker.status === 4
          ? 'var(--inert)'
          : marker.status >= 2
            ? 'var(--critical)'
            : marker.status === 1
              ? 'var(--caution)'
              : 'var(--friendly)'
    }
    el.setAttribute('stroke', color)

    const children = el.children as HTMLCollectionOf<SVGGraphicsElement>
    for (let j = 0; j < children.length; j++) {
      const child = children[j]
      if (child === undefined) continue
      const cls = child.getAttribute('class') ?? ''
      if (cls.includes('map-outpost')) {
        child.style.display = marker.kind === 'Outpost' ? 'inline' : 'none'
        child.setAttribute('fill', marker.status === 4 ? 'none' : color)
        child.setAttribute('fill-opacity', marker.status === 4 ? '0' : '0.85')
      } else if (cls.includes('map-enemy')) {
        child.style.display = marker.kind === 'Outpost' ? 'none' : 'inline'
      } else if (cls.includes('map-label')) {
        child.style.display = marker.kind === 'Outpost' ? 'inline' : 'none'
        if (marker.kind === 'Outpost') {
          const name = OUTPOSTS[marker.outpost]?.name ?? ''
          if (child.textContent !== name) child.textContent = name
          child.setAttribute('fill', color)
        }
      }
    }
  }
}
