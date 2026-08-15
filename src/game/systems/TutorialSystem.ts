/**
 * Onboarding — three beats, one verb each (gameplan §12.3).
 *
 *   1. FLY    — empty sky. Gate: complete one half-orbit.
 *   2. SHOOT  — three inert drones. Gate: destroy all three.
 *   3. DEFEND — one outpost, two Harvesters. Gate: save the outpost.
 *
 * **Each beat gates on a success condition, never on a timer.** That distinction
 * is the whole design: a timed tutorial teaches nothing, because it advances
 * identically whether the player understood or was staring at the ceiling. A
 * gated one cannot be completed without demonstrating the verb, so reaching
 * wave 1 is itself evidence the player can fly, shoot and defend.
 *
 * Beat 1 exists to deliver the "I am orbiting a small world" moment before
 * anything competes for attention, which is why it has no threats at all.
 */
import { EnemyPhase, GameEvent, type World } from '../core/World.ts'
import { create, dot, length, sub, type Vec3 } from '../math/vec3.ts'
import { spawnHarvester } from '../entities/Harvester.ts'
import { R } from '../data/constants.ts'

export const TutorialBeat = { Fly: 0, Shoot: 1, Defend: 2, Complete: 3 } as const

/** A half-orbit, in radians of arc travelled. */
const HALF_ORBIT = Math.PI

/** Drones to destroy in beat 2. */
const DRONE_COUNT = 3

/** Harvesters threatening the outpost in beat 3. */
const DEFEND_HARVESTERS = 2

const previous: Vec3 = create()
const delta: Vec3 = create()

/**
 * Advances the tutorial by one step. Returns true when a beat was completed,
 * so the caller can emit the transition once rather than every frame.
 * @hot-path
 */
export function stepTutorial(world: World, dt: number): void {
  if (world.tutorialBeat < 0 || world.tutorialBeat >= TutorialBeat.Complete) return

  switch (world.tutorialBeat) {
    case TutorialBeat.Fly:
      accumulateArc(world, dt)
      if (world.tutorialProgress >= HALF_ORBIT) advance(world)
      break

    case TutorialBeat.Shoot:
      // Kills are counted by the collision system through the event queue, so
      // the gate reads the same number the score does.
      if (world.tutorialProgress >= DRONE_COUNT) advance(world)
      break

    case TutorialBeat.Defend: {
      const outpost = world.outposts[world.wave.targets[0] ?? 0]
      if (outpost === undefined) break

      // Losing the outpost here used to be a dead end: the gate requires it
      // standing, so a player who let it fall flew on forever with no threats
      // left and no way to satisfy a condition that could no longer be met. The
      // tutorial is the one place in the game where failure should not cost
      // anything, so it simply sets the drill up again.
      if (outpost.status === 'Lost') {
        outpost.integrity = 100
        outpost.status = 'Nominal'
        outpost.drainers = 0
        outpost.threats = 0
        outpost.lostAt = -1
        outpost.threatenedAt = -1
        setUpBeat(world)
        break
      }

      const threatsCleared = world.enemies.pool.count === 0 && world.wave.pending === 0
      if (threatsCleared) advance(world)
      break
    }

    default:
      break
  }
}

/**
 * Angular distance travelled along the surface, in radians.
 *
 * Measured from the *tangential* component of movement only. Climbing and
 * diving are not progress toward circling the moon, and counting them would let
 * a player finish the beat by bobbing on the spot — which teaches the wrong
 * thing about a world where travel time is the currency.
 * @hot-path
 */
function accumulateArc(world: World, dt: number): void {
  const craft = world.craft
  sub(delta, craft.position, craft.previousPosition)

  const radial = dot(delta, craft.frame.up)
  delta.x -= craft.frame.up.x * radial
  delta.y -= craft.frame.up.y * radial
  delta.z -= craft.frame.up.z * radial

  const radius = length(craft.position)
  if (radius > 1e-6) world.tutorialProgress += length(delta) / radius

  // `dt` is unused for the arc itself — distance already carries the time — but
  // keeping the signature uniform means every beat is stepped the same way.
  void dt
  void previous
}

/** Counts a kill toward the SHOOT gate. Called from the collision system. */
export function noteTutorialKill(world: World): void {
  if (world.tutorialBeat === TutorialBeat.Shoot) world.tutorialProgress += 1
}

function advance(world: World): void {
  world.events.emit(GameEvent.TutorialBeatCleared, world.tutorialBeat, 0, 0, 0, 0)
  world.tutorialBeat += 1
  world.tutorialProgress = 0
  setUpBeat(world)
}

/**
 * Places whatever the next beat needs.
 *
 * Spawning happens here rather than in `SpawnSystem` because the tutorial is
 * not a wave: it has no composition table, no spatial-spread rule and no DDA,
 * and threading those exceptions through the wave spawner would make the real
 * one harder to read for the sake of three scripted beats.
 */
export function setUpBeat(world: World): void {
  switch (world.tutorialBeat) {
    case TutorialBeat.Shoot: {
      // Inert drones: Harvesters parked in orbit, targeting nothing. They never
      // land and never drain, so the beat is purely about hitting a target.
      const target = world.wave.targets[0] ?? 0
      for (let i = 0; i < DRONE_COUNT; i++) {
        const slot = world.enemies.pool.alloc()
        if (slot < 0) break
        spawnHarvester(world, slot, target, 0.35 + i * 0.22)
        world.enemies.target[slot] = -1
        world.enemies.phase[slot] = EnemyPhase.Inbound
      }
      break
    }

    case TutorialBeat.Defend: {
      const target = world.wave.targets[0] ?? 0
      for (let i = 0; i < DEFEND_HARVESTERS; i++) {
        const slot = world.enemies.pool.alloc()
        if (slot < 0) break
        spawnHarvester(world, slot, target, 0.5 + i * 0.3)
      }
      break
    }

    default:
      break
  }
}

/** Progress through the current beat, 0–1, for the tutorial HUD. */
export function tutorialProgressFraction(world: Readonly<World>): number {
  switch (world.tutorialBeat) {
    case TutorialBeat.Fly:
      return Math.min(1, world.tutorialProgress / HALF_ORBIT)
    case TutorialBeat.Shoot:
      return Math.min(1, world.tutorialProgress / DRONE_COUNT)
    case TutorialBeat.Defend: {
      const outpost = world.outposts[world.wave.targets[0] ?? 0]
      return outpost === undefined ? 0 : 1 - outpost.integrity / 100
    }
    default:
      return 1
  }
}

/** The moon's radius, re-exported so the HUD can label distance in the same terms. */
export { R }
