/**
 * World-space aim points → screen pixels (gameplan §8.4, §32.2).
 *
 * The split of labour here is the whole point. `WeaponSystem` decides *where*
 * the crosshair, the lead pip, the lock and the bomb impact are, in world space,
 * using the same physics the weapons themselves run. This file only asks the
 * camera where those points land on the glass. Nothing here invents a position,
 * and nothing in the simulation knows a camera exists (§30.2).
 *
 * Everything is preallocated: this runs once per rendered frame for the whole
 * life of a run.
 */
import * as THREE from 'three'
import type { World } from '../game/core/World.ts'
import { GameEvent } from '../game/core/World.ts'
import {
  Aim,
  trackedTarget,
} from '../game/core/view.ts'
import { archetypeOf } from '../game/data/enemies.ts'
import { LOCK_TIME } from '../game/data/constants.ts'
import type { AimFrame } from '../state/hudRefs.ts'

const point = new THREE.Vector3()
const cameraSpace = new THREE.Vector3()

/** How fast the hit and kill flashes fade, s⁻¹. Fast: this is a tick, not a glow. */
const PULSE_DECAY = 6.5

/**
 * Projects a world point onto the screen.
 *
 * Returns the distance from the camera, or -1 when the point is behind it.
 * Behind matters: `Vector3.project` divides by a negative `w` for anything
 * behind the lens and happily returns a *mirrored* on-screen position, which
 * would put the bomb marker on the opposite side of the display from the crater
 * it belongs to.
 */
function project(
  worldX: number,
  worldY: number,
  worldZ: number,
  camera: THREE.Camera,
  width: number,
  height: number,
  out: { x: number; y: number },
): number {
  cameraSpace.set(worldX, worldY, worldZ).applyMatrix4(camera.matrixWorldInverse)
  // Camera space looks down -Z, so anything with z >= 0 is level with or behind
  // the lens. The small epsilon keeps a point grazing the plane from projecting
  // to infinity.
  if (cameraSpace.z > -0.05) return -1
  const distance = cameraSpace.length()

  point.set(worldX, worldY, worldZ).project(camera)
  out.x = (point.x * 0.5 + 0.5) * width
  out.y = (-point.y * 0.5 + 0.5) * height
  return distance
}

/**
 * Apparent radius, in pixels, of a sphere of `radius` at `distance`.
 *
 * The standard perspective relation: half the viewport height subtends
 * `tan(fov/2)` at unit distance, so a world radius maps to
 * `radius / distance · (height/2) / tan(fov/2)`. An orthographic camera has no
 * such falloff, and the game never uses one, so the perspective case is the only
 * one handled — with a benign fallback rather than a lie.
 */
function apparentRadius(radius: number, distance: number, camera: THREE.Camera, height: number): number {
  if (!(camera instanceof THREE.PerspectiveCamera) || distance <= 0) return 24
  const halfFov = (camera.fov * Math.PI) / 360
  return (radius / distance) * (height / 2 / Math.tan(halfFov))
}

const scratchPoint = { x: 0, y: 0 }

/** Keeps a caption clear of both edges, with room for its own line height. */
function clampToView(y: number, height: number): number {
  return Math.max(16, Math.min(height - 16, y))
}

/**
 * Fills `out` with this frame's reticle geometry.
 *
 * `dt` drives the hit and kill flashes, which decay in wall-clock time because
 * they are feedback for the player's eye rather than state in the world — the
 * one class of value §25.3 allows to read the frame delta.
 * @hot-path
 */
export function projectAim(
  world: Readonly<World>,
  camera: THREE.Camera,
  width: number,
  height: number,
  dt: number,
  out: AimFrame,
): void {
  // Feedback pulses first, so they decay even on the frames where the rest of
  // the reticle is switched off.
  const decay = Math.exp(-PULSE_DECAY * dt)
  out.hitPulse = out.hitPulse > 1e-3 ? out.hitPulse * decay : 0
  out.killPulse = out.killPulse > 1e-3 ? out.killPulse * decay : 0

  const events = world.events
  for (let i = 0; i < events.count; i++) {
    const type = events.type[i]
    if (type === GameEvent.ProjectileHit) out.hitPulse = 1
    else if (type === GameEvent.EnemyKilled) out.killPulse = 1
  }

  const craft = world.craft
  // The attract loop flies itself; drawing a crosshair over the title screen
  // would advertise a control the player does not have yet.
  out.active = craft.alive && world.phase.kind !== 'Attract'
  if (!out.active) {
    out.crosshairVisible = false
    out.leadVisible = false
    out.lockVisible = false
    out.bombVisible = false
    return
  }

  out.magnetised = Aim.reticleMagnetised
  out.overheated = craft.weapon.kind === 'Overheated'

  // ---- crosshair ----
  {
    const distance = project(Aim.reticle.x, Aim.reticle.y, Aim.reticle.z, camera, width, height, scratchPoint)
    out.crosshairVisible = distance > 0
    out.crosshairX = scratchPoint.x
    out.crosshairY = scratchPoint.y
  }

  // ---- lead pip ----
  //
  // Suppressed in missile mode: the missile does its own leading, and a pip
  // telling the player to aim off-target for a weapon that steers itself would
  // be advice the weapon ignores.
  if (Aim.leadValid && craft.activeWeaponMode === 'cannon') {
    const distance = project(Aim.lead.x, Aim.lead.y, Aim.lead.z, camera, width, height, scratchPoint)
    // Hidden when it would sit on top of the crosshair: two marks a few pixels
    // apart read as a rendering fault, not as a lead.
    const dx = scratchPoint.x - out.crosshairX
    const dy = scratchPoint.y - out.crosshairY
    out.leadVisible = distance > 0 && out.crosshairVisible && dx * dx + dy * dy > 14 * 14
    out.leadX = scratchPoint.x
    out.leadY = scratchPoint.y
  } else {
    out.leadVisible = false
  }

  // ---- lock box ----
  const target = trackedTarget(world)
  const lock = craft.lock
  if (target >= 0 && world.enemies.pool.active[target] === 1 && lock.kind !== 'Idle') {
    const ex = world.enemies.body.x[target] as number
    const ey = world.enemies.body.y[target] as number
    const ez = world.enemies.body.z[target] as number
    const distance = project(ex, ey, ez, camera, width, height, scratchPoint)
    out.lockVisible = distance > 0
    out.lockX = scratchPoint.x
    out.lockY = scratchPoint.y
    out.locked = lock.kind === 'Locked'
    out.lockProgress = lock.kind === 'Acquiring' ? lock.progress : 1
    // A box the size of the target it is on, floored so a distant Interceptor
    // still gets a mark you can see and ceilinged so a Sentinel at ramming
    // range does not fill the screen with brackets.
    const radius = archetypeOf(world.enemies.kind[target] as number).radius
    out.lockRadius = Math.max(18, Math.min(160, apparentRadius(radius * 1.9, distance, camera, height)))
    out.lockLabelY = clampToView(out.lockY - out.lockRadius - 12, height)
  } else {
    out.lockVisible = false
    out.locked = false
    out.lockProgress = 0
  }

  // ---- bomb impact ----
  if (Aim.bombImpactValid) {
    const distance = project(Aim.bombImpact.x, Aim.bombImpact.y, Aim.bombImpact.z, camera, width, height, scratchPoint)
    out.bombVisible = distance > 0
    out.bombX = scratchPoint.x
    out.bombY = scratchPoint.y
    out.bombTime = Aim.bombImpactTime
    // Only for placing the caption clear of the glyph — the footprint itself is
    // a scene object now, so the HUD no longer needs its apparent size.
    out.bombRadius = 28
    out.bombLabelY = clampToView(out.bombY + out.bombRadius + 8, height)
  } else {
    out.bombVisible = false
  }
}

/** Re-exported so the HUD can label the lock timer without a second import. */
export { LOCK_TIME }
