/**
 * Wave choreography (gameplan §10, §7.3).
 *
 * Reads the authored campaign in `data/waves.ts` and decides *where* and
 * *when*. The primary difficulty axis is simultaneity — how many outposts are
 * threatened at once — followed by spatial spread, because those are the axes a
 * player can perceive and adapt to. Enemy health and damage stay nearly
 * constant: inflating those makes a game feel unfair, while inflating
 * simultaneity makes it feel demanding (§10.1).
 *
 * Population is capped at 48 concurrent and **spawns beyond the cap queue
 * rather than drop** (§7.3), so difficulty stays authored. V1 spawned every 120
 * frames forever with no cap and no despawn, reaching ~300 aliens after ten
 * minutes — difficulty by accident, and a death spiral.
 */
import { EnemyKind, GameEvent, type World } from '../core/World.ts'
import { type Vec3, create, normalize, scale, cross, length, copy } from '../math/vec3.ts'
import { arcDistance } from '../math/spherical.ts'
import { spawnHarvester } from '../entities/Harvester.ts'
import { spawnInterceptor } from '../entities/Interceptor.ts'
import { spawnSentinel } from '../entities/Sentinel.ts'
import { spawnSapper } from '../entities/Sapper.ts'
import { spawnWarden } from '../entities/Warden.ts'
import { spawnCarrier } from '../entities/Carrier.ts'
import { beginWave as resetOutpostWave } from '../entities/Outpost.ts'
import { beginWaveScoring } from './ScoreSystem.ts'
import { WAVES, waveDefinition, type SpatialSpread } from '../data/waves.ts'
import { ALT_MAX, DDA_MAX_ADJUST, R, WAVE_COUNT } from '../data/constants.ts'

const direction: Vec3 = create()
const tangent: Vec3 = create()
const scratch: Vec3 = create()

const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 }
const WORLD_FORWARD: Vec3 = { x: 0, y: 0, z: 1 }

/** Pending spawn queue, flat and pre-allocated: [kind, outpostIndex] pairs. */
const MAX_QUEUE = 128
const queueKind = new Uint8Array(MAX_QUEUE)
const queueTarget = new Int8Array(MAX_QUEUE)
let queueHead = 0
let queueTail = 0

function queueLength(): number {
  return queueTail - queueHead
}

function enqueue(kind: number, target: number): void {
  if (queueTail >= MAX_QUEUE) return
  queueKind[queueTail] = kind
  queueTarget[queueTail] = target
  queueTail++
}

/**
 * Starts a wave: chooses targets, builds the spawn queue, resets per-wave state.
 *
 * Everything random here draws from the wave-seeded PRNG, so the same run seed
 * produces the same wave for every player (§10.4). That is what makes runs
 * comparable, bugs reproducible, and a shared seed meaningful.
 */
export function startWave(world: World, waveNumber: number): void {
  const definition = waveDefinition(waveNumber, world.endless)
  if (definition === undefined) return

  queueHead = 0
  queueTail = 0

  const wave = world.wave
  wave.number = waveNumber
  wave.elapsed = 0
  wave.cleared = false
  wave.damageTakenThisWave = 0
  wave.settled = false
  wave.survivalPoints = 0
  wave.accuracyBonusApplied = 0
  wave.allIntactBonus = 0
  wave.noDamageBonus = 0
  wave.creditsEarned = 0
  wave.spawnTimer = 1.2
  wave.targets.length = 0

  let survivors = 0
  for (const outpost of world.outposts) {
    resetOutpostWave(outpost)
    if (outpost.status !== 'Lost') survivors++
  }
  wave.outpostsAtStart = survivors

  const targets = chooseTargets(world, definition.threatened, definition.spread)
  for (const index of targets) wave.targets.push(index)

  const spread = Math.max(1, targets.length)

  // Carriers first in the queue, and deliberately so.
  //
  // A Carrier is the wave's *source*: it launches a Harvester every eleven
  // seconds for as long as it lives, so every second it spends waiting in the
  // queue is a Harvester the wave never produces. Releasing it last would make
  // the archetype quietly weaker the longer the queue in front of it was, which
  // is difficulty by accident rather than by authorship — the exact failure the
  // cap-and-queue rule exists to prevent.
  for (let i = 0; i < definition.carriers; i++) {
    enqueue(EnemyKind.Carrier, targets[i % spread] ?? -1)
  }
  // Wardens next, because everything behind them is unkillable while they live.
  for (let i = 0; i < definition.wardens; i++) {
    enqueue(EnemyKind.Warden, targets[i % spread] ?? -1)
  }
  // Harvesters, so the clock starts and the player has something to race.
  for (const index of targets) {
    for (let i = 0; i < definition.harvestersPerOutpost; i++) enqueue(EnemyKind.Harvester, index)
  }
  // One Sentinel per threatened outpost, up to the wave's allowance.
  for (let i = 0; i < definition.sentinels; i++) {
    enqueue(EnemyKind.Sentinel, targets[i % spread] ?? -1)
  }
  // Sappers interleave with the Interceptors rather than arriving as a block: a
  // deadline the player can learn to expect at a fixed point in the wave is a
  // schedule, not a deadline.
  for (let i = 0; i < definition.sappers; i++) {
    enqueue(EnemyKind.Sapper, targets[i % spread] ?? -1)
  }
  for (let i = 0; i < definition.interceptors; i++) enqueue(EnemyKind.Interceptor, -1)

  wave.pending = queueLength()
  wave.plannedHarvesters = definition.harvestersPerOutpost * targets.length
  wave.plannedInterceptors = definition.interceptors
  wave.plannedSentinels = definition.sentinels

  beginWaveScoring(world)
}

/** @hot-path */
export function stepSpawn(world: World, dt: number): void {
  const wave = world.wave
  wave.elapsed += dt

  // The tutorial places its own drones per beat (§12.3). Letting the wave
  // spawner also run would put Harvesters in the sky during FLY, whose entire
  // purpose is an empty sky.
  if (world.tutorialBeat >= 0) {
    wave.pending = 0
    return
  }

  const definition = waveDefinition(wave.number, world.endless)
  if (definition === undefined) return

  if (queueLength() > 0) {
    wave.spawnTimer -= dt
    if (wave.spawnTimer <= 0) {
      // §10.3 — DDA adjusts spawn interval and drain rate only, and only within
      // ±15%. It never touches damage or health, so feel stays honest.
      wave.spawnTimer = definition.spawnInterval * world.ddaFactor
      release(world)
    }
  }

  wave.pending = queueLength()
  wave.cleared = wave.pending === 0 && world.enemies.pool.count === 0
}

/** Releases the next queued enemy, or waits when the population cap is reached. */
function release(world: World): void {
  if (queueLength() <= 0) return
  if (world.enemies.pool.isFull) return // queue, never drop (§7.3)

  const kind = queueKind[queueHead] as number
  const target = queueTarget[queueHead] as number

  const slot = world.enemies.pool.alloc()
  if (slot < 0) return
  queueHead++

  switch (kind) {
    case EnemyKind.Harvester: {
      // Entry angle offsets the approach around the sphere so Harvesters arrive
      // over the horizon from varying directions rather than in a single line.
      const entry = world.rng.range(0.55, 1.15) * (world.rng.next() < 0.5 ? -1 : 1)
      spawnHarvester(world, slot, target, entry)
      break
    }
    case EnemyKind.Sentinel:
      spawnSentinel(world, slot, target)
      break
    case EnemyKind.Warden:
      spawnWarden(world, slot, target)
      break
    case EnemyKind.Carrier:
      spawnCarrier(world, slot, target)
      break
    case EnemyKind.Sapper: {
      // Same entry construction as the Harvester, over a narrower arc: a Sapper
      // comes in flatter and closer to its target, so its approach reads as a
      // run rather than as a patient descent.
      const entry = world.rng.range(0.4, 0.9) * (world.rng.next() < 0.5 ? -1 : 1)
      spawnSapper(world, slot, target, entry)
      break
    }
    default: {
      // Interceptors enter near the player but never on top of them: appearing
      // inside the player's blind spot would be a hit they could not have read.
      randomDirectionNear(world, world.craft.position, 0.5)
      spawnInterceptor(world, slot, direction, world.rng.range(ALT_MAX * 0.45, ALT_MAX * 0.9))
      break
    }
  }
}

/**
 * Chooses which outposts this wave threatens, honouring the spread axis.
 *
 * Picks a seed outpost at random from the survivors, then selects the remaining
 * targets by arc distance from it — the quantity that actually determines
 * whether the player can reach both (§19.2). Lost outposts are never chosen:
 * threatening a dead outpost would produce a threat the player cannot act on.
 */
function chooseTargets(world: World, count: number, spread: SpatialSpread): number[] {
  const available: number[] = []
  for (const outpost of world.outposts) if (outpost.status !== 'Lost') available.push(outpost.index)
  if (available.length === 0) return []

  const wanted = Math.min(count, available.length)
  const chosen: number[] = []

  const firstIndex = Math.floor(world.rng.next() * available.length)
  const first = available[firstIndex] ?? available[0]
  if (first === undefined) return []
  chosen.push(first)

  // Fractions of the maximum possible separation (πR) that each spread targets.
  const preferred =
    spread === 'adjacent' ? 0.22 : spread === 'moderate' ? 0.48 : spread === 'wide' ? 0.74 : 0.97

  while (chosen.length < wanted) {
    let best = -1
    let bestError = Infinity

    for (const candidate of available) {
      if (chosen.includes(candidate)) continue

      const candidateOutpost = world.outposts[candidate]
      if (candidateOutpost === undefined) continue

      // Score against the *nearest* already-chosen target, so a third pick is
      // spaced from the cluster rather than from an arbitrary member of it.
      let nearest = Infinity
      for (const already of chosen) {
        const other = world.outposts[already]
        if (other === undefined) continue
        const arc = arcDistance(candidateOutpost.direction, other.direction, R) / (Math.PI * R)
        if (arc < nearest) nearest = arc
      }

      const error = Math.abs(nearest - preferred)
      if (error < bestError) {
        bestError = error
        best = candidate
      }
    }

    if (best < 0) break
    chosen.push(best)
  }

  return chosen
}

/** A random unit direction within `spreadRadians` of `near`. */
function randomDirectionNear(world: World, near: Readonly<Vec3>, spreadRadians: number): void {
  copy(direction, near)
  normalize(direction)

  cross(tangent, direction, WORLD_UP)
  if (length(tangent) < 1e-6) cross(tangent, direction, WORLD_FORWARD)
  normalize(tangent)
  cross(scratch, direction, tangent)
  normalize(scratch)

  const angle = world.rng.range(0, Math.PI * 2)
  const offset = world.rng.range(spreadRadians * 0.4, spreadRadians)
  const sin = Math.sin(offset)

  direction.x = direction.x * Math.cos(offset) + (tangent.x * Math.cos(angle) + scratch.x * Math.sin(angle)) * sin
  direction.y = direction.y * Math.cos(offset) + (tangent.y * Math.cos(angle) + scratch.y * Math.sin(angle)) * sin
  direction.z = direction.z * Math.cos(offset) + (tangent.z * Math.cos(angle) + scratch.z * Math.sin(angle)) * sin
  normalize(direction)
  scale(direction, direction, 1)
}

/**
 * §10.3 — bounded, disclosed dynamic difficulty.
 *
 * Losing two outposts across two waves lengthens intervals by up to 15%;
 * clearing three waves untouched shortens them by up to 15%. Nothing else moves.
 * Recomputed once per wave rather than continuously, so the player is never
 * fighting a target that shifts mid-decision.
 */
export function updateDDA(world: World): void {
  if (!world.difficulty.ddaEnabled) {
    world.ddaFactor = 1
    return
  }

  if (world.recentLosses >= 2) {
    world.ddaFactor = Math.min(1 + DDA_MAX_ADJUST, world.ddaFactor + 0.07)
    world.recentLosses = 0
    world.cleanWaveStreak = 0
  } else if (world.cleanWaveStreak >= 3) {
    world.ddaFactor = Math.max(1 - DDA_MAX_ADJUST, world.ddaFactor - 0.07)
    world.cleanWaveStreak = 0
  }
}

/**
 * True once the campaign's final wave is behind the player (§9).
 *
 * Endless has no final wave by definition, so it never returns true and the run
 * ends the only other way it can: with every outpost lost. That asymmetry is
 * the mode — the campaign can be *won*, Endless can only be survived.
 */
export function isFinalWave(waveNumber: number, endless = false): boolean {
  if (endless) return false
  return waveNumber >= Math.min(WAVE_COUNT, WAVES.length)
}

/** Clears the queue between runs so a restart cannot inherit pending spawns. */
export function resetSpawner(): void {
  queueHead = 0
  queueTail = 0
}

/** Enemies still waiting to be released. Shown on the Briefing. */
export function pendingSpawns(): number {
  return queueLength()
}

export { GameEvent }
