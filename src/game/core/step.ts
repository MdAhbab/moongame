/**
 * One fixed simulation step (gameplan §31.1).
 *
 * The order is fixed and it matters:
 *
 *   input before flight        — no one-frame lag on the player's own controls
 *   collision after integration— every position is final when contacts resolve
 *   spawn after collision      — deaths are counted in the step that caused them
 *
 * Nothing in here reads a clock or a frame delta; `dt` is always the constant
 * from §18.2. That is what makes the simulation identical at 60, 120 and 144 Hz
 * (§37.3) and what makes it runnable headless in a test (§37.2).
 */
import { GameEvent, createDroneBay, survivingOutposts, type World } from './World.ts'
import { stepInput } from '../systems/InputSystem.ts'
import { stepFlight } from '../systems/FlightSystem.ts'
import { stepAI } from '../systems/AISystem.ts'
import { stepWeapons } from '../systems/WeaponSystem.ts'
import { stepCollision } from '../systems/CollisionSystem.ts'
import { stepDrain } from '../systems/DrainSystem.ts'
import { stepSpawn, startWave, updateDDA, isFinalWave } from '../systems/SpawnSystem.ts'
import { stepScore, settleWave } from '../systems/ScoreSystem.ts'
import { stepParticles, emitBurst } from '../systems/ParticleSystem.ts'
import { stepTutorial } from '../systems/TutorialSystem.ts'
import { stepAttract } from '../systems/AttractSystem.ts'
import { stepBombs } from '../entities/Bomb.ts'
import { length, normalize, copy, scale, create, type Vec3 } from '../math/vec3.ts'
import {
  ALT_CRUISE,
  HULL_MAX,
  PARTICLES_OUTPOST_LOST,
  R,
  RESPAWN_HULL,
  RESPAWN_TIME,
  RESUPPLY_COOLDOWN,
  WAVE_CLEAR_DURATION,
  BRIEFING_DURATION,
} from '../data/constants.ts'
import { Random, waveSeed } from './Random.ts'
import { PERKS } from '../data/perks.ts'

const scratch: Vec3 = create()

/** @hot-path */
export function stepWorld(world: World, dt: number): void {
  world.time += dt
  world.steps++


  switch (world.phase.kind) {
    case 'Attract':
      // Steering and flight only. No AI, no drain, no spawner, no scoring and
      // no clock — a menu the player could lose would be a menu they have to
      // attend to.
      stepAttract(world)
      stepInput(world)
      stepFlight(world, dt)
      stepParticles(world, dt)
      return
    case 'Briefing': {
      const remaining = world.phase.remaining - dt
      world.phase = remaining <= 0 ? { kind: 'Playing' } : { kind: 'Briefing', remaining }
      return
    }
    case 'WaveClear': {
      const remaining = world.phase.remaining - dt
      if (remaining <= 0) advanceWave(world)
      else world.phase = { kind: 'WaveClear', remaining }
      return
    }
    case 'RunOver':
      // Particles keep running so the final explosion plays out rather than
      // freezing mid-burst the instant the run ends.
      stepParticles(world, dt)
      return
    case 'Respawning':
      stepRespawn(world, dt)
      stepAI(world, dt)
      // Ordnance already in the air belongs to the world, not to the pilot. A
      // bomb released a moment before the craft died used to hang motionless
      // for the four seconds of the respawn and then resume its fall out of
      // nowhere, because the only thing that stepped it was the weapon system.
      stepBombs(world, dt)
      stepCollision(world, dt)
      stepDrain(world, dt)
      stepSpawn(world, dt)
      stepParticles(world, dt)
      checkRunEnd(world)
      return
    case 'Playing':
      break
  }

  stepInput(world)
  stepFlight(world, dt)
  stepAI(world, dt)
  stepWeapons(world, dt)
  stepCollision(world, dt)
  stepDrain(world, dt)
  stepSpawn(world, dt)
  stepScore(world, dt)
  stepParticles(world, dt)

  // §12.3 — beats gate on demonstrated success, never on elapsed time.
  stepTutorial(world, dt)

  emitOutpostLossEffects(world)

  if (!world.craft.alive) {
    // The escort goes down with the craft, *here* rather than when the respawn
    // completes. Nothing steps `stepWeapons` during `Respawning`, so drones
    // left in the pool would hang motionless in the sky for the full four
    // seconds and then blink out — the same artefact the bomb comment above
    // describes, for the same reason.
    world.drones.pool.reset()
    world.droneBay = createDroneBay()
    world.phase = { kind: 'Respawning', remaining: RESPAWN_TIME }
  } else if (world.wave.cleared) {
    settleWave(world)
    world.events.emit(GameEvent.WaveCleared, world.wave.number, world.score.waveScore, 0, 0, 0)
    world.phase = { kind: 'WaveClear', remaining: WAVE_CLEAR_DURATION }
  }

  checkRunEnd(world)
}

/**
 * §7.6 — destruction costs 4 seconds, not the run.
 *
 * In a triage game the worst punishment is not death, it is being unable to be
 * where you are needed. Denominating the cost in time keeps every consequence
 * in the same currency as everything else.
 */
function stepRespawn(world: World, dt: number): void {
  if (world.phase.kind !== 'Respawning') return

  const remaining = world.phase.remaining - dt
  if (remaining > 0) {
    world.phase = { kind: 'Respawning', remaining }
    return
  }

  const craft = world.craft
  const outpost = nearestSurvivingOutpost(world)

  if (outpost === null) {
    // Nothing left to respawn at: the run is over anyway (§7.2).
    world.phase = { kind: 'RunOver', victory: false }
    world.events.emit(GameEvent.RunEnded, 0, world.score.total, 0, 0, 0)
    return
  }

  // §10 — dying costs the run's build, not the run.
  //
  // Perks accumulate across a run, so a player who dies on wave nine came back
  // with nine waves of compounding advantage into a wave they had just proved
  // they could not fly. Death now wipes the loadout and hands back a single
  // legendary: enough to still feel like *your* run, not enough to be the run
  // you were having. It is the same currency every other consequence in this
  // game is denominated in — you lose what you built, not your seat.
  resetPerksOnDeath(world)

  copy(scratch, outpost.direction)
  normalize(scratch)
  scale(craft.position, scratch, R + ALT_CRUISE)
  copy(craft.previousPosition, craft.position)
  craft.velocity.x = 0
  craft.velocity.y = 0
  craft.velocity.z = 0
  // Respawn hull scales with the loadout's max, so a heavy hull comes back
  // proportionally intact rather than always at a flat 50.
  craft.hull = Math.min(HULL_MAX * world.loadout.hullMax, RESPAWN_HULL * world.loadout.hullMax)
  craft.heat = 0
  craft.weapon = { kind: 'Ready' }
  craft.lock = { kind: 'Idle' }
  craft.lockHold = 0
  // A respawn is a *new airframe*, so it arrives whole. Coming back with the
  // engine that had just been shot to pieces would mean the four-second penalty
  // was really a permanent one, and the player would be flying a wreck they
  // never had the chance to repair.
  craft.systems.engine = 1
  craft.systems.weapon = 1
  craft.systems.control = 1
  craft.driftBias = 1
  craft.empTimer = 0
  craft.lanceCharge = 0
  craft.altitudeTarget = ALT_CRUISE
  craft.boostCharge = 1
  craft.boostActive = false
  craft.trauma = 0
  craft.alive = true
  outpost.resupplyCooldown = RESUPPLY_COOLDOWN

  world.phase = { kind: 'Playing' }
  world.events.emit(
    GameEvent.Respawned,
    outpost.index,
    0,
    craft.position.x,
    craft.position.y,
    craft.position.z,
  )
}

/**
 * Strips every perk and offers three legendaries to replace them.
 *
 * It used to hand back one legendary at random, which made the single most
 * consequential moment in a run — losing everything you had built — a moment
 * the player watched rather than played. Three cards turns the low point into
 * a decision, and a decision is something you can be proud of surviving.
 *
 * The *offer* is drawn from `world.rng` rather than `Math.random`, so a seeded
 * run reproduces the same three cards. The *pick* is made in React and pushed
 * into `activePerks`, exactly as the post-wave draft has always worked.
 *
 * The escort formation goes with the perks: any sortie in the air is wiped and
 * the bay's ladder resets, because dying is precisely the case the ladder is
 * supposed to punish.
 */
function resetPerksOnDeath(world: World): void {
  world.activePerks.length = 0
  world.drones.pool.reset()
  world.droneBay = createDroneBay()

  const legendaries = PERKS.filter((perk) => perk.rarity === 'legendary')
  const pool = legendaries.map((perk) => perk.id)
  const offer: string[] = []

  // Draw without replacement, so the player is never offered the same card
  // twice out of three.
  while (offer.length < 3 && pool.length > 0) {
    const index = Math.floor(world.rng.range(0, pool.length))
    const [picked] = pool.splice(index, 1)
    if (picked !== undefined) offer.push(picked)
  }

  world.legendaryOffer = offer
}

function nearestSurvivingOutpost(world: Readonly<World>): World['outposts'][number] | null {
  let best: World['outposts'][number] | null = null
  let bestDistance = Infinity

  for (const outpost of world.outposts) {
    if (outpost.status === 'Lost') continue
    scratch.x = outpost.position.x - world.craft.position.x
    scratch.y = outpost.position.y - world.craft.position.y
    scratch.z = outpost.position.z - world.craft.position.z
    const distance = length(scratch)
    if (distance < bestDistance) {
      bestDistance = distance
      best = outpost
    }
  }
  return best
}

/**
 * Spawns the mourning burst for any outpost lost this step.
 *
 * Driven off the event queue rather than the status transition so the effect
 * fires exactly once even though `refreshStatus` may be reached from more than
 * one path in a step.
 */
function emitOutpostLossEffects(world: World): void {
  const events = world.events
  for (let i = 0; i < events.count; i++) {
    if (events.type[i] !== GameEvent.OutpostLost) continue
    emitBurst(
      world,
      events.x[i] as number,
      events.y[i] as number,
      events.z[i] as number,
      PARTICLES_OUTPOST_LOST,
      14,
      2.0,
      0.5,
      'inert',
      1,
      null,
      true,
    )
  }
}

/**
 * Advances to the next wave, or ends the run in victory.
 *
 * Exported because the UI drives this now. The world used to advance itself on
 * a timer, which raced the untimed Debrief screen: while the player read it,
 * the WaveClear and Briefing timers kept running behind the menu and wave 2
 * spawned unattended. Stepping is gated on the screen, so this is called
 * explicitly when the player chooses to continue.
 */
export function advanceWave(world: World): void {
  if (world.wave.damageTakenThisWave <= 0) world.cleanWaveStreak++
  else world.cleanWaveStreak = 0

  updateDDA(world)

  if (isFinalWave(world.wave.number, world.endless)) {
    world.phase = { kind: 'RunOver', victory: survivingOutposts(world) > 0 }
    world.events.emit(GameEvent.RunEnded, 1, world.score.total, 0, 0, 0)
    return
  }

  world.rng = new Random(waveSeed(world.runSeed, world.wave.number + 1))
  startWave(world, world.wave.number + 1)
  world.phase = { kind: 'Briefing', remaining: BRIEFING_DURATION }
}

/** Losing all eight outposts ends the run — the fail state (§7.2). */
function checkRunEnd(world: World): void {
  if (world.phase.kind === 'RunOver') return
  if (survivingOutposts(world) > 0) return

  world.phase = { kind: 'RunOver', victory: false }
  world.events.emit(GameEvent.RunEnded, 0, world.score.total, 0, 0, 0)
}
