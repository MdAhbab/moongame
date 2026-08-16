/**
 * Projects the simulation into the read model (gameplan §31.3, §32.2).
 *
 * Two channels with different update rates: `HudFrame` is written every frame
 * and goes straight to DOM refs, `MetaSnapshot` is event-driven and goes through
 * zustand at ≤10 Hz. Both write into caller-owned objects and allocate nothing,
 * so the HUD costs no garbage even at 120 Hz.
 *
 * The bearing maths lives here rather than in the UI so the tangent basis
 * (§20.1) is never rebuilt outside the simulation — one place computes it, one
 * place can be wrong.
 */
import { EnemyKind, EnemyPhase, type World } from '../core/World.ts'
import type { HudFrame, MapMarker, MarkerKind, MetaSnapshot, ThreatMarker } from '../core/readModel.ts'
import { type Vec3, create, dot, length } from '../math/vec3.ts'
import { bearingTo } from '../physics/tangentFrame.ts'
import { tutorialProgressFraction } from './TutorialSystem.ts'
import { assistTarget } from './WeaponSystem.ts'
import { Aim } from '../core/view.ts'
import { archetypeOf } from '../data/enemies.ts'
import { LOCK_TIME, R, THREAT_RING_MAX_RANGE } from '../data/constants.ts'

const scratch: Vec3 = create()
const point: Vec3 = create()

/** @hot-path */
export function projectHudFrame(world: Readonly<World>, out: HudFrame): void {
  const craft = world.craft

  out.hull = craft.hull
  out.heat = craft.heat
  out.overheated = craft.weapon.kind === 'Overheated'
  out.score = world.score.total
  out.combo = world.score.combo
  out.speed = length(craft.velocity)
  out.altitude = length(craft.position) - R
  out.altitudeRate = dot(craft.velocity, craft.frame.up)
  out.altitudeTarget = craft.altitudeTarget
  out.boostCharge = craft.boostCharge
  out.boostActive = craft.boostActive
  out.bank = craft.bank
  out.trauma = craft.trauma
  out.lastHitBearing = craft.lastHitBearing
  out.throttle = craft.throttle
  out.runTime = world.time
  out.wave = world.wave.number

  out.lockProgress =
    craft.lock.kind === 'Acquiring' ? craft.lock.progress : craft.lock.kind === 'Locked' ? 1 : 0

  // §12.2 P3 — the artificial horizon is referenced to the local tangent plane,
  // which is exactly what `frame` already is. Pitch is the nose's elevation
  // above that plane; roll is the craft's bank.
  out.horizonPitch = craft.pitch
  out.horizonRoll = craft.bank

  out.bombCooldown = craft.bombCooldown
  out.weaponMode = craft.activeWeaponMode
  out.engineCut = craft.engineCut
  out.aegisShield = craft.aegisShield
  out.flaresRemaining = craft.flaresRemaining

  out.missileCooldown = craft.missileCooldown
  out.bombFallTime = Aim.bombImpactValid ? Aim.bombImpactTime : 0
  out.engineIntegrity = craft.systems.engine
  out.weaponIntegrity = craft.systems.weapon
  out.controlIntegrity = craft.systems.control
  out.drones = world.drones.pool.count
  out.droneRemaining = world.droneBay.remaining > 0 ? world.droneBay.remaining : 0
  out.droneCooldown = world.droneBay.cooldown
  out.droneTier = world.droneBay.tier
  out.lanceCharge = craft.lanceCharge
  out.underAttackRun = anyAttackRun(world)
  projectTarget(world, out)
}

/**
 * True while any Interceptor is winding up or committed to a run.
 *
 * One flag rather than a per-enemy list: the HUD's job here is to make the
 * player *look up*, and the thing to look at is already glowing.
 * @hot-path
 */
function anyAttackRun(world: Readonly<World>): boolean {
  const { pool, phase } = world.enemies
  for (let i = 0; i < pool.count; i++) {
    const slot = pool.dense[i] as number
    const p = phase[slot] as number
    if (p === EnemyPhase.Winding || p === EnemyPhase.Diving) return true
  }
  return false
}

/**
 * Fills the target readout: what is being tracked, how far, how hurt.
 *
 * The tracked target is the lock's if there is one, and otherwise whatever the
 * reticle is nearest to — the thing the player is about to shoot. Reporting one
 * and drawing the other would put the interface back in the business of
 * asserting something the weapon does not do (§8.4).
 * @hot-path
 */
function projectTarget(world: Readonly<World>, out: HudFrame): void {
  const lock = world.craft.lock
  out.lockState = lock.kind === 'Locked' ? 2 : lock.kind === 'Acquiring' ? 1 : 0

  const slot = lock.kind === 'Idle' ? assistTarget : lock.target
  if (slot < 0 || world.enemies.pool.active[slot] !== 1) {
    out.lockRange = 0
    out.lockHealth = 0
    out.lockKind = null
    return
  }

  const kind = world.enemies.kind[slot] as number
  point.x = (world.enemies.body.x[slot] as number) - world.craft.position.x
  point.y = (world.enemies.body.y[slot] as number) - world.craft.position.y
  point.z = (world.enemies.body.z[slot] as number) - world.craft.position.z

  out.lockRange = length(point)
  out.lockHealth = Math.max(0, Math.min(1, (world.enemies.hp[slot] as number) / archetypeOf(kind).health))
  out.lockKind = enemyMarkerKind(kind)
}

/**
 * Fills the Threat Ring marker array (§12.2 P1, §20.7).
 *
 * Returns the number of live markers. Entries beyond that are left with
 * `active: false` rather than being removed, so the ring's SVG nodes are
 * created once at mount and only ever have their transforms updated.
 *
 * Ordering matters: outposts are written *after* enemies so a critical outpost
 * paints over a passing enemy rather than under it.
 * @hot-path
 */
export function projectMarkers(world: Readonly<World>, markers: ThreatMarker[]): number {
  const craft = world.craft
  let n = 0

  const { pool } = world.enemies
  for (let i = 0; i < pool.count && n < markers.length; i++) {
    const slot = pool.dense[i] as number
    const marker = markers[n]
    if (marker === undefined) break

    point.x = world.enemies.body.x[slot] as number
    point.y = world.enemies.body.y[slot] as number
    point.z = world.enemies.body.z[slot] as number

    const range = Math.sqrt(
      (point.x - craft.position.x) ** 2 +
        (point.y - craft.position.y) ** 2 +
        (point.z - craft.position.z) ** 2,
    )

    marker.id = slot
    marker.kind = enemyMarkerKind(world.enemies.kind[slot] as number)
    marker.bearing = bearingTo(craft.frame, craft.position, point, scratch)
    marker.proximity = Math.min(1, range / THREAT_RING_MAX_RANGE)
    marker.hostile = true
    marker.extinguished = false
    // An Interceptor on a run is critical at *any* range — that is the whole
    // point of the tell, and a marker that only turns red inside 90 u would
    // announce the threat after the moment to react to it has passed.
    const ePhase = world.enemies.phase[slot] as number
    const attacking = ePhase === EnemyPhase.Winding || ePhase === EnemyPhase.Diving
    marker.urgency = attacking || range < 90 ? 'critical' : range < 190 ? 'threatened' : 'safe'
    marker.active = true
    n++
  }

  for (let i = 0; i < world.outposts.length && n < markers.length; i++) {
    const outpost = world.outposts[i]
    const marker = markers[n]
    if (outpost === undefined || marker === undefined) break

    const range = Math.sqrt(
      (outpost.position.x - craft.position.x) ** 2 +
        (outpost.position.y - craft.position.y) ** 2 +
        (outpost.position.z - craft.position.z) ** 2,
    )

    marker.id = 10_000 + outpost.index
    marker.kind = 'Outpost'
    marker.bearing = bearingTo(craft.frame, craft.position, outpost.position, scratch)
    marker.proximity = Math.min(1, range / THREAT_RING_MAX_RANGE)
    marker.hostile = false
    marker.extinguished = outpost.status === 'Lost'
    marker.urgency =
      outpost.status === 'Critical' || outpost.status === 'Draining'
        ? 'critical'
        : outpost.status === 'Threatened'
          ? 'threatened'
          : 'safe'
    marker.active = true
    n++
  }

  for (let i = n; i < markers.length; i++) {
    const marker = markers[i]
    if (marker !== undefined) marker.active = false
  }

  return n
}

function enemyMarkerKind(kind: number): MarkerKind {
  switch (kind) {
    case EnemyKind.Interceptor:
      return 'Interceptor'
    case EnemyKind.Sentinel:
      return 'Sentinel'
    case EnemyKind.Sapper:
      return 'Sapper'
    case EnemyKind.Warden:
      return 'Warden'
    case EnemyKind.Carrier:
      return 'Carrier'
    default:
      return 'Harvester'
  }
}

/**
 * Fills the ≤10 Hz snapshot.
 *
 * Reuses the outpost entry objects across calls: this runs ten times a second
 * for the whole run, and rebuilding eight objects each time is 4,800 short-lived
 * allocations a minute against a "≈0 MB/min heap growth" target (§34.1).
 */
export function projectMeta(world: Readonly<World>, out: MetaSnapshot): void {
  out.wave = world.wave.number

  let surviving = 0
  for (let i = 0; i < world.outposts.length; i++) {
    const outpost = world.outposts[i]
    if (outpost === undefined) continue
    if (outpost.status !== 'Lost') surviving++

    let entry = out.outposts[i]
    if (entry === undefined) {
      entry = { index: outpost.index, name: outpost.name, integrity: 100, status: 'Nominal', drainers: 0 }
      out.outposts[i] = entry
    }
    entry.index = outpost.index
    entry.name = outpost.name
    entry.integrity = outpost.integrity
    entry.status = outpost.status
    entry.drainers = outpost.drainers
  }

  out.survivingOutposts = surviving
  out.respawning = world.phase.kind === 'Respawning'
  out.respawnRemaining = world.phase.kind === 'Respawning' ? world.phase.remaining : 0
  out.alert = currentAlert(world)
  out.tutorialBeat = world.tutorialBeat
  out.tutorialProgress = tutorialProgressFraction(world)
}

/**
 * §13.2 — one alert at a time, chosen by priority.
 *
 * Simultaneous alerts are a known cause of players noticing none, so this
 * resolves to a single string rather than a list. Ordered most urgent first.
 */
function currentAlert(world: Readonly<World>): string | null {
  if (world.phase.kind === 'Respawning') {
    const s = Math.ceil(world.phase.remaining)
    return `CRAFT DESTROYED — RESPAWNING IN ${s}S`
  }
  if (!world.craft.alive) return 'CRAFT DESTROYED'

  // Above overheat, and deliberately: an attack run is a two-second window with
  // a right answer (break the line), while overheating is a wait. The alert
  // names the counter rather than just the threat, because a warning the player
  // cannot act on is only anxiety.
  if (anyAttackRun(world)) return 'ATTACK RUN INBOUND — BREAK LEFT OR RIGHT'

  if (world.craft.weapon.kind === 'Overheated') return 'WEAPON OVERHEAT'

  const systems = world.craft.systems
  if (systems.engine <= 0.25) return 'ENGINE FAILING — REACH AN OUTPOST'
  if (systems.control <= 0.25) return 'STABILISER FAILING — REACH AN OUTPOST'
  if (systems.weapon <= 0.25) return 'WEAPON BAY FAILING — REACH AN OUTPOST'

  let critical: string | null = null
  let draining: string | null = null
  for (const outpost of world.outposts) {
    if (outpost.status === 'Critical') {
      critical ??= `${outpost.name} CRITICAL`
    } else if (outpost.status === 'Draining') {
      draining ??= `${outpost.name} DRAINING`
    }
  }
  if (critical !== null) return critical

  if (world.craft.hull < 25) return 'HULL CRITICAL'

  if (world.craft.inRepairZone) return 'SAFE CHECKPOINT — REPAIRING HULL'

  const altitude = length(world.craft.position) - R
  if (altitude < 8) return 'TERRAIN PROXIMITY'

  return draining
}

/** Lock time, re-exported so the HUD can label the reticle without a second import. */
export { LOCK_TIME }

/* ------------------------------------------------------------------ */
/* Orbital Map (§12.4)                                                 */
/* ------------------------------------------------------------------ */

const mapNormal: Vec3 = create()
const mapTangent: Vec3 = create()

/** Maps an outpost's status onto the small integer the map symbols switch on. */
function statusCode(status: string): number {
  switch (status) {
    case 'Threatened':
      return 1
    case 'Draining':
      return 2
    case 'Critical':
      return 3
    case 'Lost':
      return 4
    default:
      return 0
  }
}

/**
 * Projects the whole sphere onto the Orbital Map, azimuthal equidistant and
 * centred on the craft (§12.4). Returns the number of live markers.
 *
 * Only called while the map is actually open — it is a held overlay, not a
 * permanent HUD element, so paying for 56 projections on every frame of every
 * run to feed a panel nobody is looking at would be the kind of quiet waste
 * §17.4 exists to prevent.
 *
 * The maths, once:
 *
 *   n  = p̂, the point as a unit vector from the moon's centre
 *   θ  = acos(n · û)        great-circle angle from the craft, 0…π
 *   t  = n − û(n · û)       the component in the craft's tangent plane
 *   β  = atan2(t · r̂, t · f̂)   bearing, 0 dead ahead
 *   x  = (θ/π)·sin β,  y = −(θ/π)·cos β
 *
 * `û`, `f̂` and `r̂` come straight from the craft's tangent frame, which the
 * simulation already re-orthonormalises every step — so the map cannot drift
 * out of agreement with the flight model, because it is reading the flight
 * model's own basis.
 * @hot-path
 */
export function projectMap(world: Readonly<World>, markers: MapMarker[]): number {
  const craft = world.craft
  const frame = craft.frame
  let n = 0

  const place = (marker: MapMarker, x: number, y: number, z: number): void => {
    const inverse = 1 / Math.max(1e-6, Math.sqrt(x * x + y * y + z * z))
    mapNormal.x = x * inverse
    mapNormal.y = y * inverse
    mapNormal.z = z * inverse

    const cosine = Math.min(1, Math.max(-1, dot(mapNormal, frame.up)))
    const theta = Math.acos(cosine)

    mapTangent.x = mapNormal.x - frame.up.x * cosine
    mapTangent.y = mapNormal.y - frame.up.y * cosine
    mapTangent.z = mapNormal.z - frame.up.z * cosine

    const bearing = Math.atan2(dot(mapTangent, frame.right), dot(mapTangent, frame.forward))
    const radius = theta / Math.PI
    marker.x = radius * Math.sin(bearing)
    marker.y = -radius * Math.cos(bearing)
  }

  // Outposts first: they are the map's subject, and drawing them under a swarm
  // of enemy pips would invert what the player opened it to see.
  for (const outpost of world.outposts) {
    const marker = markers[n]
    if (marker === undefined) break
    marker.kind = 'Outpost'
    marker.status = statusCode(outpost.status)
    marker.outpost = outpost.index
    marker.active = true
    place(marker, outpost.position.x, outpost.position.y, outpost.position.z)
    n++
  }

  const { pool, body, kind } = world.enemies
  for (let i = 0; i < pool.count && n < markers.length; i++) {
    const slot = pool.dense[i] as number
    const marker = markers[n]
    if (marker === undefined) break
    marker.kind = enemyMarkerKind(kind[slot] as number)
    marker.status = 0
    marker.outpost = -1
    marker.active = true
    place(marker, body.x[slot] as number, body.y[slot] as number, body.z[slot] as number)
    n++
  }

  for (let i = n; i < markers.length; i++) {
    const marker = markers[i]
    if (marker !== undefined) marker.active = false
  }
  return n
}
