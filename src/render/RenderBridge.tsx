import { useRef, useMemo, Suspense } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Environment } from '@react-three/drei'
import * as THREE from 'three'
import { EnemyKind, EnemyPhase } from '../game/core/World.ts'
import type { World } from '../game/core/World.ts'
import { sentinelShieldNormal } from '../game/entities/Sentinel.ts'
import type { GodRaysEffect } from 'postprocessing'
import { createAimFrame, hudRefs, writeAim } from '../state/hudRefs.ts'
import { projectAim } from './aim.ts'

// Scene imports
import { Moon } from './scene/Moon.tsx'
import { Starfield } from './scene/Starfield.tsx'
import { Sun } from './scene/Sun.tsx'
import { Earth } from './scene/Earth.tsx'
import { Outposts } from './scene/Outposts.tsx'
import { Boulders } from './scene/Boulders.tsx'
import { Craft, type CraftRefs } from './scene/Craft.tsx'
import { Lighting } from './scene/Lighting.tsx'
import { BombTarget, type BombTargetRefs } from './scene/BombTarget.tsx'

// Instanced
import { EnemyInstances, type EnemyRefs } from './instanced/EnemyInstances.tsx'
import { ProjectileInstances, type ProjectileRefs } from './instanced/ProjectileInstances.tsx'
import { MissileInstances, type MissileRefs } from './instanced/MissileInstances.tsx'
import { BombInstances, type BombRefs } from './instanced/BombInstances.tsx'
import { DroneInstances, type DroneRefs } from './instanced/DroneInstances.tsx'
import { ParticleInstances, type ParticleRefs } from './instanced/ParticleInstances.tsx'
import { DrainBeams, type DrainBeamRefs } from './instanced/DrainBeams.tsx'

// Effects
import { CameraRigController } from './effects/CameraRig.tsx'
import { PostProcessing } from './effects/PostProcessing.tsx'
import { EngineTrail, type EngineTrailRefs } from './effects/EngineTrail.tsx'
import { BOMB_BLAST_RADIUS, R, WINDUP_TIME } from '../game/data/constants.ts'
import { bombImpact, bombImpactValid } from '../game/systems/WeaponSystem.ts'
import type { WorldPalette } from '../game/data/worlds.ts'

/**
 * Squared distance above which a frame-to-frame move is a teleport, not flight.
 *
 * 12 u against a worst case of ~3.7 u from boosting through a 100 ms clamped
 * frame, so there is no plausible way for real motion to trip it.
 */
const TRAIL_BREAK_SQ = 12 * 12

/**
 * Points an instance's local **+Y at `up`** and its local **+Z at `facing`**.
 *
 * `setFromUnitVectors` cannot express this. It produces the *minimal* rotation
 * carrying one axis onto another, which leaves the roll about that axis
 * unspecified — fine for a missile, useless for anything whose yaw carries
 * meaning. Building the basis explicitly is the only way to say "up is up
 * **and** the nose is there".
 *
 * `facing` is re-derived from the cross product rather than trusted, because
 * the two inputs arrive from different places — a position interpolated for
 * this frame and a heading sampled at the last fixed step — so they are very
 * nearly, but not exactly, perpendicular. `setFromRotationMatrix` assumes
 * orthonormal columns and silently skews the model if handed anything else.
 *
 * Right-handed by construction: with `side = up × facing`, `side × up` returns
 * `facing`, so `makeBasis(side, up, facing)` has a determinant of +1 and the
 * model is not mirrored.
 */
function orientTo(
  target: THREE.Object3D,
  up: THREE.Vector3,
  facing: THREE.Vector3,
  side: THREE.Vector3,
  basis: THREE.Matrix4,
): void {
  side.crossVectors(up, facing)
  // Degenerate when the heading is parallel to up (a Harvester descending
  // straight down, which is most of its life) or zero (the frame it spawned).
  if (side.lengthSq() < 1e-8) {
    side.set(1, 0, 0).cross(up)
    if (side.lengthSq() < 1e-8) side.set(0, 0, 1).cross(up)
  }
  side.normalize()
  facing.crossVectors(side, up).normalize()

  basis.makeBasis(side, up, facing)
  target.quaternion.setFromRotationMatrix(basis)
  target.updateMatrix()
}

/**
 * Places a tracer as a streak along its own velocity.
 *
 * The length is the distance the round actually covers in this frame — which is
 * what a photograph of it would show — with a floor so a slow round is still a
 * dash rather than a dot, and a ceiling so a long frame does not draw a beam
 * across the sky.
 */
function orientStreak(
  target: THREE.Object3D,
  position: THREE.Vector3,
  vx: number,
  vy: number,
  vz: number,
  dir: THREE.Vector3,
  zAxis: THREE.Vector3,
): void {
  const speed = Math.sqrt(vx * vx + vy * vy + vz * vz)
  target.position.copy(position)
  if (speed > 1e-4) {
    dir.set(vx / speed, vy / speed, vz / speed)
    target.quaternion.setFromUnitVectors(zAxis, dir)
  }
  // Length is the distance covered in a *nominal* frame, not this one. Using
  // the real delta made the streak jump between 2 u and 8 u as the frame time
  // moved, which reads as the rounds changing size rather than as motion — and
  // right after a stall it drew bars longer than the craft.
  const streak = Math.min(3.6, Math.max(1.6, speed * (1 / 90)))
  target.scale.set(1, 1, streak)
  target.updateMatrix()
}

export function RenderBridge({
  world,
  tier,
  albedoMap,
  normalMap,
  aoMap,
  onFrame,
  advance,
  palette,
  starDensity,
  stepping,
}: {
  world: World
  tier: 'High' | 'Medium' | 'Low'
  albedoMap?: ImageBitmap | undefined
  normalMap?: ImageBitmap | undefined
  aoMap?: ImageBitmap | undefined
  /** Called at the end of each frame with the interpolation factor. */
  onFrame?: ((alpha: number) => void) | undefined
  /**
   * Advances the simulation by a real delta and returns `alpha`.
   *
   * Injected rather than performed here, and the distinction is not cosmetic.
   * This component used to own a private `Loop` and call `stepWorld(world, dt)`
   * itself, which stepped the world perfectly and skipped `Simulation` — and
   * with it `Simulation.sampleInput`, the hook that folds keyboard, mouse,
   * gamepad and touch state into `world.input` at the head of every fixed step
   * (§31.1). The result was a game that ran, drained, spawned and scored while
   * ignoring the player completely.
   *
   * There is exactly one fixed-timestep clock in the application and the
   * `Simulation` owns it. The render layer's job is to draw whatever state that
   * clock produced.
   */
  advance: (delta: number) => number
  /** The selected world's colours (§7.1). Presentation only — the simulation
   * never sees them, and no gameplay value is derived from a colour. */
  palette: WorldPalette
  starDensity: number
  /**
   * Whether the world may advance this frame.
   *
   * Owned by the UI, not inferred from `world.phase`. The Debrief screen is
   * untimed, and gating on phase alone let the world's own WaveClear and
   * Briefing timers run behind it — spawning the next wave while the player was
   * still reading why they lost the last one.
   */
  stepping?: boolean | undefined
}) {
  const { camera, gl, size } = useThree()

  // Accumulate draw calls across every pass of the frame rather than letting
  // each `render()` reset the counter. See the read site at the end of useFrame.
  useMemo(() => {
    gl.info.autoReset = false
  }, [gl])
  const camController = useMemo(() => new CameraRigController(camera), [camera])

  /**
   * The craft's position on the previous frame, for teleport detection.
   * Zero-length means "no previous frame yet", which is the first-frame case.
   */
  const lastTrailPos = useMemo(() => new THREE.Vector3(), [])

  /** The reticle's screen geometry. One object for the life of the run (Rule 3). */
  const aim = useMemo(() => createAimFrame(), [])
  
  // Refs to dynamic objects
  const craftRef = useRef<CraftRefs>(null)
  const trailRef = useRef<EngineTrailRefs>(null)
  const enemiesRef = useRef<EnemyRefs>(null)
  const projectilesRef = useRef<ProjectileRefs>(null)
  const missilesRef = useRef<MissileRefs>(null)
  const bombsRef = useRef<BombRefs>(null)
  const particlesRef = useRef<ParticleRefs>(null)
  const drainBeamsRef = useRef<DrainBeamRefs>(null)
  const bombTargetRef = useRef<BombTargetRefs>(null)
  const dronesRef = useRef<DroneRefs>(null)

  // Refs for imperative frame updates
  const sunMeshRef = useRef<THREE.Mesh>(null)
  const sunMaterialRef = useRef<THREE.ShaderMaterial>(null)
  const sunCoronaMaterialRef = useRef<THREE.ShaderMaterial>(null)
  const moonHighRef = useRef<THREE.Mesh>(null)
  const moonLowRef = useRef<THREE.Mesh>(null)
  const godRaysRef = useRef<GodRaysEffect>(null)

  // Pre-allocated scratch objects for zero allocation useFrame
  const scratch = useMemo(() => ({
    dummy: new THREE.Object3D(),
    pos: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    up: new THREE.Vector3(0, 1, 0),
    zAxis: new THREE.Vector3(0, 0, 1),
    facing: new THREE.Vector3(),
    side: new THREE.Vector3(),
    basis: new THREE.Matrix4(),
    q: new THREE.Quaternion(),
    m: new THREE.Matrix4(),
    xcol: new THREE.Vector3(),
    ycol: new THREE.Vector3(),
    color: new THREE.Color(),
    // Post-processing scratch variables
    projScreenMatrix: new THREE.Matrix4(),
    frustum: new THREE.Frustum(),
    viewDir: new THREE.Vector3(),
    sunPos: new THREE.Vector3(),
  }), [])

  useFrame((_, delta) => {
    // 1. Advance the simulation. Both conditions must hold: the UI has to want
    // the world to run (`stepping`) *and* the world has to be in a phase that
    // advances. Either alone was a bug — phase alone let wave 2 spawn behind the
    // untimed Debrief, and `stepping` alone would run the RunOver phase forever.
    // `Respawning` is in this list, and its absence was fatal.
    //
    // Destruction sets the phase to `Respawning`, and this gate then refused to
    // advance the world — so the four-second respawn timer, which is only
    // decremented *by* a step, never ticked. The craft died, the screen froze
    // with the wreck in frame, and there was no way out but the pause menu. The
    // one phase whose entire job is to time itself back to `Playing` was the one
    // phase the clock was withheld from.
    const alpha =
      stepping &&
      (world.phase.kind === 'Playing' ||
        world.phase.kind === 'Respawning' ||
        world.phase.kind === 'WaveClear' ||
        world.phase.kind === 'Briefing' ||
        world.phase.kind === 'Attract')
        ? advance(delta)
        : 0

    const { dummy, pos, dir, up, zAxis, facing, side, basis, xcol, ycol, m, color } = scratch

    // 2. Update Craft
    //
    // Runs whether or not the craft is alive, which it did not used to.
    // Everything below was gated on `world.craft.alive`, and the four seconds
    // between destruction and respawn are the longest a player ever spends
    // looking at this scene without being able to do anything about it — so
    // three faults all landed at once and read, together, as the game hanging:
    //
    //   - the wreck never disappeared, because nothing hid the hull;
    //   - the camera froze, because §3 below aims at `root.position` and that
    //     Vector3 stopped being written while the world kept stepping around it;
    //   - and on respawn the camera swept across the sphere, because the craft
    //     teleports and the rig had no guard for it.
    //
    // The transform is now always current. Only the *effects* of being alive —
    // exhaust, muzzle, the engine ribbon — are conditional.
    //
    // The interpolated position is computed unconditionally, because the camera
    // needs it too and a 120 Hz simulation drawn at 60 fps visibly stair-steps
    // without it.
    {
      const c = world.craft
      pos.x = c.previousPosition.x + (c.position.x - c.previousPosition.x) * alpha
      pos.y = c.previousPosition.y + (c.position.y - c.previousPosition.y) * alpha
      pos.z = c.previousPosition.z + (c.position.z - c.previousPosition.z) * alpha
    }

    if (craftRef.current) {
      const c = world.craft
      const { root, exhaust, muzzle } = craftRef.current
      root.position.copy(pos)

      // Orient obj (following V1 orientObj structure)
      const fwd = dir.set(c.frame.forward.x, c.frame.forward.y, c.frame.forward.z)
      const u = up.set(c.frame.up.x, c.frame.up.y, c.frame.up.z)
      
      xcol.copy(u).cross(fwd).normalize()
      ycol.copy(fwd).cross(xcol).normalize()
      m.makeBasis(xcol, ycol, fwd)
      root.quaternion.setFromRotationMatrix(m)
      root.rotateZ(c.bank)

      // The hull is wreckage the moment the hull reaches zero. `CollisionSystem`
      // already emits a 40-particle burst at this exact position, so hiding the
      // model turns that burst into the ship coming apart instead of a firework
      // going off beside an intact one.
      root.visible = c.alive

      const boosting = c.boostActive
      // §2.2: no Math.random() in hot path — use deterministic sine noise instead
      const t = world.time
      const exhaustFlicker = Math.sin(t * 31.7) * 0.075
      exhaust.scale.setScalar(0.7 + c.throttle * (boosting ? 1.8 : 0.9) + exhaustFlicker)

      // Muzzle flash isn't on world.craft directly as a float usually,
      // but we can toggle visibility based on weapon heat or firing status
      muzzle.visible = c.alive && world.input.firing && c.weapon.kind === 'Ready'

      // Engine ribbon. Fed the *interpolated* position, not the simulation
      // position, so the trail traces the path actually drawn rather than a
      // stepped version of it — at 60 fps against a 120 Hz sim, the stepped
      // path would visibly stair-step on every turn.
      // A teleport must break the ribbon rather than be drawn as flight.
      //
      // The craft jumps position whenever a run starts and whenever it
      // respawns, and the trail has no way to tell that from very fast
      // movement — so it stretched one segment across the entire moon and drew
      // it as a cyan column through the middle of the screen. Made visible by
      // the attract loop, which flies the craft on the menu and therefore
      // guarantees a jump at the moment the player presses Start; the respawn
      // case had the same bug and was rarer, so nobody had caught it.
      //
      // The threshold is well above anything flight can produce: boost tops out
      // at ~36.8 u/s and the frame delta is clamped to 100 ms, so a real frame
      // never moves the craft further than ~3.7 u.
      if (trailRef.current && lastTrailPos.lengthSq() > 0) {
        if (pos.distanceToSquared(lastTrailPos) > TRAIL_BREAK_SQ) trailRef.current.reset()
      }
      lastTrailPos.copy(pos)

      if (trailRef.current && c.alive) {
        // Width is in world units and the craft is ~3.8 u across, so anything
        // past ~1.5 stops reading as an exhaust plume and starts reading as a
        // banner being towed.
        const boostWidth = boosting ? 1.5 : 1.0
        trailRef.current.push(
          pos.x - fwd.x * 3.6,
          pos.y - fwd.y * 3.6,
          pos.z - fwd.z * 3.6,
          xcol.x, xcol.y, xcol.z,
          boostWidth * (0.4 + c.throttle * 0.6),
          // Throttle drives the brightness, so braking visibly cuts the plume
          // rather than leaving a full-strength ribbon behind a coasting craft.
          (boosting ? 0.95 : 0.55) * (0.25 + c.throttle * 0.75),
        )
      }
    }

    // A destroyed craft leaves no exhaust, and keeping the ribbon would stretch
    // it from the wreck to the respawn point across the sphere.
    if (trailRef.current && !world.craft.alive) trailRef.current.reset()

    // 3. Update Camera + shadow frustum follows craft (§16.1)
    //
    // Aimed at the interpolated position computed above, not at
    // `craftRef.current.root.position`. They hold the same value, but sourcing
    // the camera from a render-side ref means any early return in the block
    // above silently freezes the camera — which is exactly how a destroyed craft
    // used to strand it.
    const craftWorldPos = pos
    camController.update(
      delta,
      craftWorldPos,
      world.craft.frame.forward,
      world.craft.frame.up,
      world.craft.velocity,
      world.craft.bank,
      world.craft.trauma,
      world.craft.slip,
      world.craft.boostActive,
      false // reducedMotion flag would come from settings
    )

    // 4. Update Enemies
    //
    // Every archetype is oriented from a facing the *simulation* maintains, not
    // from one re-derived here. Three of these were wrong before, all in the
    // same way — the renderer inventing a frame the rules did not share:
    //
    //  - The Interceptor's nose was aimed at the point on the surface directly
    //    below it, so a hunter dived at the ground while flying level, while
    //    `headingX/Y/Z` — a field whose comment says it exists "so the render
    //    bridge can orient instances without deriving it" — went unread.
    //  - The Sentinel's shield was placed by `setFromUnitVectors` plus a yaw,
    //    which picks the minimal-arc rotation and therefore a different pair of
    //    tangents than `sentinelShieldNormal` builds. The plate pointed one way
    //    and the blocked cone another, so flanking — the entire archetype — was
    //    being taught by a picture that disagreed with the rules.
    //  - The Harvester had no yaw at all and span freely about its axis.
    if (enemiesRef.current) {
      let hCount = 0, iCount = 0, sCount = 0
      const { pool, body, kind, headingX, headingY, headingZ } = world.enemies

      for (let i = 0; i < pool.count; i++) {
        const slot = pool.dense[i] as number
        pos.x = (body.prevX[slot] as number) + ((body.x[slot] as number) - (body.prevX[slot] as number)) * alpha
        pos.y = (body.prevY[slot] as number) + ((body.y[slot] as number) - (body.prevY[slot] as number)) * alpha
        pos.z = (body.prevZ[slot] as number) + ((body.z[slot] as number) - (body.prevZ[slot] as number)) * alpha

        dummy.position.copy(pos)
        dummy.scale.setScalar(1)

        // Local +Y is away from the moon's centre for every archetype.
        up.copy(pos).normalize()

        const k = kind[slot]
        if (k === EnemyKind.Interceptor) {
          facing.set(headingX[slot] as number, headingY[slot] as number, headingZ[slot])

          // §7.3 — the attack run, told in the silhouette itself.
          //
          // Winding up: swells and flares to white, brightening as the commit
          // approaches, so the tell is legible in peripheral vision without
          // reading a HUD element. Diving: full white, stretched along its own
          // axis, which reads as speed. Exposed: dark and small — visibly the
          // moment to shoot it.
          const ePhase = world.enemies.phase[slot] as number
          let swell = 1
          if (ePhase === EnemyPhase.Winding) {
            const heat = 1 - Math.min(1, (world.enemies.timer[slot] as number) / WINDUP_TIME)
            const pulse = 0.5 + 0.5 * Math.sin(world.time * 26)
            const glow = 0.35 + 0.65 * heat
            color.setRGB(1, 0.55 + 0.45 * glow * pulse, 0.3 + 0.7 * glow * pulse)
            swell = 1 + 0.22 * heat
          } else if (ePhase === EnemyPhase.Diving) {
            color.setRGB(1, 1, 1)
            swell = 1.12
          } else if (ePhase === EnemyPhase.Exposed) {
            // Deliberately dimmer than a healthy one: "hurt and drifting".
            const flicker = 0.55 + 0.2 * Math.sin(world.time * 17)
            color.setRGB(flicker, flicker * 0.75, flicker * 0.6)
            swell = 0.88
          } else {
            color.setRGB(1, 1, 1)
          }

          dummy.scale.setScalar(swell)
          orientTo(dummy, up, facing, side, basis)
          enemiesRef.current.interceptor.setMatrixAt(iCount, dummy.matrix)
          enemiesRef.current.interceptor.instanceColor?.setXYZ(iCount, color.r, color.g, color.b)
          iCount++
        } else if (k === EnemyKind.Harvester) {
          facing.set(headingX[slot] as number, headingY[slot] as number, headingZ[slot])
          orientTo(dummy, up, facing, side, basis)
          enemiesRef.current.harvester.setMatrixAt(hCount++, dummy.matrix)
        } else if (k === EnemyKind.Sentinel) {
          // Straight from the rules. A `THREE.Vector3` satisfies `Vec3`, so this
          // writes the simulation's own answer into the scratch vector.
          sentinelShieldNormal(facing, world, slot)
          orientTo(dummy, up, facing, side, basis)
          enemiesRef.current.sentinel.setMatrixAt(sCount++, dummy.matrix)
        }
      }
      
      enemiesRef.current.harvester.count = hCount
      enemiesRef.current.harvester.instanceMatrix.needsUpdate = true
      enemiesRef.current.interceptor.count = iCount
      enemiesRef.current.interceptor.instanceMatrix.needsUpdate = true
      if (enemiesRef.current.interceptor.instanceColor) {
        enemiesRef.current.interceptor.instanceColor.needsUpdate = true
      }
      enemiesRef.current.sentinel.count = sCount
      enemiesRef.current.sentinel.instanceMatrix.needsUpdate = true
    }

    // 5. Update Projectiles
    if (projectilesRef.current) {
      // Player
      let pCount = 0
      const pp = world.playerProjectiles
      for (let i = 0; i < pp.pool.count; i++) {
        const slot = pp.pool.dense[i] as number
        pos.x = (pp.body.prevX[slot] as number) + ((pp.body.x[slot] as number) - (pp.body.prevX[slot] as number)) * alpha
        pos.y = (pp.body.prevY[slot] as number) + ((pp.body.y[slot] as number) - (pp.body.prevY[slot] as number)) * alpha
        pos.z = (pp.body.prevZ[slot] as number) + ((pp.body.z[slot] as number) - (pp.body.prevZ[slot] as number)) * alpha
        
        orientStreak(dummy, pos, pp.body.vx[slot] as number, pp.body.vy[slot] as number, pp.body.vz[slot] as number, dir, zAxis)
        projectilesRef.current.player.setMatrixAt(pCount++, dummy.matrix)
      }
      projectilesRef.current.player.count = pCount
      projectilesRef.current.player.instanceMatrix.needsUpdate = true

      // Enemy
      let eCount = 0
      const ep = world.enemyProjectiles
      for (let i = 0; i < ep.pool.count; i++) {
        const slot = ep.pool.dense[i] as number
        pos.x = (ep.body.prevX[slot] as number) + ((ep.body.x[slot] as number) - (ep.body.prevX[slot] as number)) * alpha
        pos.y = (ep.body.prevY[slot] as number) + ((ep.body.y[slot] as number) - (ep.body.prevY[slot] as number)) * alpha
        pos.z = (ep.body.prevZ[slot] as number) + ((ep.body.z[slot] as number) - (ep.body.prevZ[slot] as number)) * alpha
        
        orientStreak(dummy, pos, ep.body.vx[slot] as number, ep.body.vy[slot] as number, ep.body.vz[slot] as number, dir, zAxis)
        projectilesRef.current.enemy.setMatrixAt(eCount++, dummy.matrix)
      }
      projectilesRef.current.enemy.count = eCount
      projectilesRef.current.enemy.instanceMatrix.needsUpdate = true
    }

    // 6. Update Missiles
    if (missilesRef.current) {
      let mCount = 0
      const ms = world.missiles
      for (let i = 0; i < ms.pool.count; i++) {
        const slot = ms.pool.dense[i] as number
        pos.x = (ms.body.prevX[slot] as number) + ((ms.body.x[slot] as number) - (ms.body.prevX[slot] as number)) * alpha
        pos.y = (ms.body.prevY[slot] as number) + ((ms.body.y[slot] as number) - (ms.body.prevY[slot] as number)) * alpha
        pos.z = (ms.body.prevZ[slot] as number) + ((ms.body.z[slot] as number) - (ms.body.prevZ[slot] as number)) * alpha
        
        dir.x = (ms.body.vx[slot] as number)
        dir.y = (ms.body.vy[slot] as number)
        dir.z = (ms.body.vz[slot] as number)
        dir.normalize()
        
        dummy.position.copy(pos)
        if (dir.lengthSq() > 0) {
          dummy.quaternion.setFromUnitVectors(zAxis, dir)
        }
        dummy.scale.setScalar(1)
        dummy.updateMatrix()
        missilesRef.current.mesh.setMatrixAt(mCount, dummy.matrix)

        // The plume, on the same transform but breathing. Deterministic noise
        // keyed to the slot so two missiles in a volley do not pulse in lockstep.
        const flicker = 0.72 + 0.28 * Math.sin(world.time * 47 + slot * 2.1)
        dummy.scale.set(flicker, flicker, 0.7 + 0.5 * flicker)
        dummy.updateMatrix()
        missilesRef.current.flame.setMatrixAt(mCount, dummy.matrix)
        mCount++
      }
      missilesRef.current.mesh.count = mCount
      missilesRef.current.mesh.instanceMatrix.needsUpdate = true
      missilesRef.current.flame.count = mCount
      missilesRef.current.flame.instanceMatrix.needsUpdate = true
    }

    // 6.5 Update Heavy Bombs
    if (bombsRef.current) {
      let bCount = 0
      const bs = world.bombs
      for (let i = 0; i < bs.pool.count; i++) {
        const slot = bs.pool.dense[i] as number
        pos.x = (bs.body.prevX[slot] as number) + ((bs.body.x[slot] as number) - (bs.body.prevX[slot] as number)) * alpha
        pos.y = (bs.body.prevY[slot] as number) + ((bs.body.y[slot] as number) - (bs.body.prevY[slot] as number)) * alpha
        pos.z = (bs.body.prevZ[slot] as number) + ((bs.body.z[slot] as number) - (bs.body.prevZ[slot] as number)) * alpha

        dir.x = (bs.body.vx[slot] as number)
        dir.y = (bs.body.vy[slot] as number)
        dir.z = (bs.body.vz[slot] as number)
        dir.normalize()

        dummy.position.copy(pos)
        if (dir.lengthSq() > 0) {
          dummy.quaternion.setFromUnitVectors(zAxis, dir)
        }
        dummy.scale.setScalar(1.2)
        dummy.updateMatrix()
        bombsRef.current.mesh.setMatrixAt(bCount++, dummy.matrix)
      }
      bombsRef.current.mesh.count = bCount
      bombsRef.current.mesh.instanceMatrix.needsUpdate = true
    }

    // 6.7 Escort drones
    if (dronesRef.current) {
      let dCount = 0
      const ds = world.drones
      for (let i = 0; i < ds.pool.count; i++) {
        const slot = ds.pool.dense[i] as number
        pos.x = (ds.body.prevX[slot] as number) + ((ds.body.x[slot] as number) - (ds.body.prevX[slot] as number)) * alpha
        pos.y = (ds.body.prevY[slot] as number) + ((ds.body.y[slot] as number) - (ds.body.prevY[slot] as number)) * alpha
        pos.z = (ds.body.prevZ[slot] as number) + ((ds.body.z[slot] as number) - (ds.body.prevZ[slot] as number)) * alpha

        // Face whatever it is shooting at, or straight ahead when idle — a
        // drone that pointed nowhere would read as debris being towed along.
        const target = ds.target[slot] as number
        if (target >= 0 && world.enemies.pool.active[target] === 1) {
          facing.set(
            (world.enemies.body.x[target] as number) - pos.x,
            (world.enemies.body.y[target] as number) - pos.y,
            (world.enemies.body.z[target] as number) - pos.z,
          ).normalize()
        } else {
          facing.set(world.craft.frame.forward.x, world.craft.frame.forward.y, world.craft.frame.forward.z)
        }

        dummy.position.copy(pos)
        dummy.scale.setScalar(1)
        up.copy(pos).normalize()
        orientTo(dummy, up, facing, side, basis)
        dronesRef.current.mesh.setMatrixAt(dCount, dummy.matrix)

        // Station-keeping glow, bobbing per drone so the formation looks alive.
        const pulse = 0.7 + 0.3 * Math.sin(world.time * 6 + slot * 1.7)
        dummy.scale.setScalar(pulse)
        dummy.updateMatrix()
        dronesRef.current.glow.setMatrixAt(dCount, dummy.matrix)
        dCount++
      }
      dronesRef.current.mesh.count = dCount
      dronesRef.current.mesh.instanceMatrix.needsUpdate = true
      dronesRef.current.glow.count = dCount
      dronesRef.current.glow.instanceMatrix.needsUpdate = true
    }

    // 7. Update Particles
    if (particlesRef.current) {
      let ptCount = 0
      const pt = world.particles
      const instColor = particlesRef.current.mesh.instanceColor
      
      for (let i = 0; i < pt.pool.count; i++) {
        const slot = pt.pool.dense[i] as number
        pos.x = (pt.body.prevX[slot] as number) + ((pt.body.x[slot] as number) - (pt.body.prevX[slot] as number)) * alpha
        pos.y = (pt.body.prevY[slot] as number) + ((pt.body.y[slot] as number) - (pt.body.prevY[slot] as number)) * alpha
        pos.z = (pt.body.prevZ[slot] as number) + ((pt.body.z[slot] as number) - (pt.body.prevZ[slot] as number)) * alpha
        
        dummy.position.copy(pos)
        dummy.quaternion.copy(camera.quaternion)
        
        const f = (pt.life[slot] as number) / (pt.maxLife[slot] as number)
        const size = (pt.size[slot] as number)
        dummy.scale.setScalar(size * f)
        dummy.updateMatrix()
        
        particlesRef.current.mesh.setMatrixAt(ptCount, dummy.matrix)
        
        if (instColor) {
          color.setRGB(pt.r[slot] as number, pt.g[slot] as number, pt.b[slot] as number)
          instColor.setXYZ(ptCount, color.r, color.g, color.b)
        }
        ptCount++
      }
      particlesRef.current.mesh.count = ptCount
      particlesRef.current.mesh.instanceMatrix.needsUpdate = true
      if (instColor) instColor.needsUpdate = true
    }


    // 8. Update Drain Beams — stretch from enemy to outpost surface
    if (drainBeamsRef.current) {
      let bCount = 0
      const { pool, body, phase: ePhase } = world.enemies
      for (let i = 0; i < pool.count; i++) {
        const slot = pool.dense[i] as number
        if ((ePhase[slot] as number) !== EnemyPhase.Draining) continue
        pos.x = (body.prevX[slot] as number) + ((body.x[slot] as number) - (body.prevX[slot] as number)) * alpha
        pos.y = (body.prevY[slot] as number) + ((body.y[slot] as number) - (body.prevY[slot] as number)) * alpha
        pos.z = (body.prevZ[slot] as number) + ((body.z[slot] as number) - (body.prevZ[slot] as number)) * alpha

        // Point toward moon centre, scale to gap length
        dir.copy(pos).negate().normalize()
        const len = pos.length() - R
        dummy.position.copy(pos)
        dummy.quaternion.setFromUnitVectors(up.set(0, 1, 0), dir)
        dummy.scale.set(1, len, 1)
        dummy.updateMatrix()
        drainBeamsRef.current.mesh.setMatrixAt(bCount++, dummy.matrix)
      }
      drainBeamsRef.current.mesh.count = bCount
      drainBeamsRef.current.mesh.instanceMatrix.needsUpdate = true
    }

    // 8.5 Imperative updates for Sun, Moon LOD, and Post-processing (to maintain exactly one useFrame loop)
    if (sunMaterialRef.current?.uniforms['uTime']) {
      sunMaterialRef.current.uniforms['uTime'].value = world.time
    }
    if (sunCoronaMaterialRef.current?.uniforms['uTime']) {
      sunCoronaMaterialRef.current.uniforms['uTime'].value = world.time
    }

    const moonAlt = camera.position.length() - R
    const isMoonClose = moonAlt < 250
    if (moonHighRef.current) moonHighRef.current.visible = isMoonClose
    if (moonLowRef.current) moonLowRef.current.visible = !isMoonClose

    if (tier === 'High' && godRaysRef.current && sunMeshRef.current) {
      const { projScreenMatrix, frustum, viewDir, sunPos } = scratch
      projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      frustum.setFromProjectionMatrix(projScreenMatrix)

      const isVisible = frustum.intersectsObject(sunMeshRef.current)

      camera.getWorldDirection(viewDir)
      sunMeshRef.current.getWorldPosition(sunPos)
      sunPos.sub(camera.position).normalize()

      godRaysRef.current.blendMode.opacity.value =
        isVisible && viewDir.dot(sunPos) > 0 ? 1.0 : 0.0
    }

    // 8.55 The bomb's footprint, laid on the ground it will actually cover.
    //
    // Oriented by the surface normal at the impact point, which on a sphere is
    // just the normalised position — so the ring lies flat on the terrain and
    // perspective turns it into the correct ellipse without any special case
    // for viewing angle.
    if (bombTargetRef.current) {
      const { ring, stake } = bombTargetRef.current
      const show = bombImpactValid && world.craft.alive && world.phase.kind !== 'Attract'
      ring.visible = show
      stake.visible = show
      if (show) {
        dir.set(bombImpact.x, bombImpact.y, bombImpact.z).normalize()
        const blast = BOMB_BLAST_RADIUS * (world.activePerks.includes('orbital_bombs') ? 1.6 : 1)

        // Lifted clear of the surface so the ring is not buried in the crater
        // wall it is drawn across.
        ring.position.copy(dir).multiplyScalar(R + 0.6)
        // The ring's own plane is XY with +Z out of it, so pointing +Z along the
        // surface normal lays it flat on the ground.
        ring.quaternion.setFromUnitVectors(zAxis, dir)
        ring.scale.setScalar(blast)

        stake.position.copy(dir).multiplyScalar(R + 3)
        // The stake is a cylinder about +Y, so +Y goes along the normal.
        stake.quaternion.setFromUnitVectors(up.set(0, 1, 0), dir)
      }
    }

    // 8.6 Project the aim marks onto the glass.
    //
    // Here rather than in `App.onFrame` because this is the only place that
    // holds the camera, and after the camera update above so the marks are
    // projected through the matrix this frame will actually be drawn with —
    // projecting through last frame's camera puts the crosshair a frame behind
    // the world at exactly the speeds where that is most visible.
    camera.updateMatrixWorld()
    projectAim(world, camera, size.width, size.height, delta, aim)
    writeAim(aim)

    // 9. Hand the frame to the HUD.
    //
    // Injected from above rather than imported, so the render layer stays
    // unaware of the UI layer (§30.2) while §17.2's "exactly one useFrame"
    // still holds. A second rAF loop in the UI would be the two-clocks problem
    // §25.3 warns against, and would sample the world mid-step.
    // 9. Report the previous frame's draw calls, then start a fresh count.
    //
    // `renderer.info` normally resets itself at the start of every `render()`.
    // With a post-processing composer that is several renders per frame, so
    // reading it here returned the last pass only — it reported "1" while the
    // scene was drawing dozens. Turning `autoReset` off (below, once) makes the
    // counter accumulate across every pass; we read the total and clear it
    // ourselves, exactly once per frame, which is the number the ≤120 budget
    // actually refers to.
    if (hudRefs.drawCallsText !== null) {
      hudRefs.drawCallsText.textContent = String(gl.info.render.calls)
    }
    gl.info.reset()

    onFrame?.(alpha)
  })

  return (
    <>
      {/* Static Scene */}
      <Suspense fallback={null}>
        <Environment files="/hdri/env.hdr" />
      </Suspense>
      <Moon albedoMap={albedoMap ?? undefined} normalMap={normalMap ?? undefined} aoMap={aoMap ?? undefined} tier={tier} highRef={moonHighRef} lowRef={moonLowRef} />
      <Starfield seed={Number(world.runSeed.replace(/\D/g, '')) || 123} density={starDensity} />
      <Sun palette={palette} meshRef={sunMeshRef} materialRef={sunMaterialRef} coronaMaterialRef={sunCoronaMaterialRef} />
      <Earth palette={palette} />
      <Outposts />
      <Boulders tier={tier} seed={Number(world.runSeed.replace(/\D/g, '')) || 123} />
      <Lighting tier={tier} palette={palette} />

      {/* Dynamic Entities */}
      <Craft ref={craftRef} />
      <EngineTrail ref={trailRef} />
      <EnemyInstances ref={enemiesRef} />
      <ProjectileInstances ref={projectilesRef} />
      <MissileInstances ref={missilesRef} />
      <BombInstances ref={bombsRef} />
      <DroneInstances ref={dronesRef} />
      <ParticleInstances ref={particlesRef} />
      <DrainBeams ref={drainBeamsRef} />
      <BombTarget ref={bombTargetRef} />

      {/* Effects */}
      <PostProcessing tier={tier} godRaysRef={godRaysRef} />
    </>
  )
}
