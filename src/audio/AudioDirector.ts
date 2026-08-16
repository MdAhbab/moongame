/**
 * The bridge: world state and the event queue in, sound out (gameplan §27, §31.3).
 *
 * This is the audio counterpart of the render bridge. It reads `World` — the
 * event ring buffer for one-shots, the craft for the continuous voices — and it
 * **never mutates either**. In particular it does *not* call `events.clear()`:
 * the queue is drained by the simulation loop once every consumer has read it,
 * and an audio layer that cleared it would silently starve the HUD (§32.2) and
 * the particle system (§26) of the same frame's events.
 *
 * ── THE GAME IS FULLY PLAYABLE MUTED (§13.4, §27.4) ──────────────────────
 *
 * Verified by walking every sound this file can produce and naming the visual
 * channel that carries the same fact. Audio is always the *second* channel:
 *
 *   Shot fired ......... muzzle flash, recoil kick, heat tick        §13.4
 *   Hit registered ..... impact flash + spark burst at the point     §13.4
 *   Kill ............... debris burst, 28 particles, 0.9 s           §26.3
 *   Player hit ......... directional damage vignette + hull gauge    §13.4
 *   Player destroyed ... respawn timer, hull at zero                 §7.6
 *   Respawned .......... craft returns, timer clears                 §11
 *   Drain started ...... roster flips amber, drain beam appears      §13.4
 *   Outpost lost ....... surface lights die, roster greys to `◇`     §13.4
 *   Outpost saved ...... roster entry, WaveClear breakdown           §11
 *   Lock progress ...... reticle converges; `LOCK 0.8s` readout      §14.2
 *   Lock acquired ...... reticle snaps                               §13.4
 *   Heat rising ........ heat gauge, present from zero               §14.2
 *   Heat lockout ....... lockout glyph on the reticle, HUD flash     §13.4
 *   Boost engaged ...... boost meter drains, FOV shift               §24.2
 *   Missile away ....... missile is on screen; cooldown readout      §14.2
 *   Terrain scrape ..... altitude ladder warning band, dust          §26.3
 *   Resupply ........... hull gauge rises, heat purges               §7.5
 *   Wave cleared ....... the WaveClear screen                        §11
 *   Engine speed ....... the world moves past; altitude ladder       §14.2
 *   Enemy behind you ... Threat Ring marker at that bearing          §12.2 P1
 *
 * The last row is the one worth being careful about, because §27.3's whole
 * claim is that a spatialised Interceptor is "audible before it is visible".
 * That is still true, and it is still not exclusive: the Threat Ring already
 * shows every hostile's bearing regardless of the horizon (§12.2 P1). Spatial
 * audio makes the bearing available *without a glance*, which is a change in
 * cost, not in availability — precisely the §13.4 relationship, where audio
 * reinforces rather than carries.
 *
 * Nothing above is audio-only. A muted player loses convenience and atmosphere
 * and no information at all.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ── Rule 3 in `update` ───────────────────────────────────────────────────
 *
 * `update` runs every frame and allocates nothing: no object or array
 * literals, no closures, no `forEach`, no iterators, indexed `for` only, and
 * every value it needs already exists — the voices are pooled in `synth.ts`,
 * and this class's own state is four numbers.
 */
import { GameEvent, type World } from '../game/core/World.ts'
import { HEAT_MAX, OUTPOST_CRITICAL_INTEGRITY } from '../game/data/constants.ts'
import { clamp, damp } from '../game/physics/springs.ts'
import { AudioEngine } from './AudioEngine.ts'
import { hasPosition, isNearField } from './spatial.ts'
import {
  DUCK_EPSILON,
  HIT_LEVEL_MAX,
  HIT_LEVEL_MIN,
  HIT_LEVEL_PER_DAMAGE,
  KILL_LEVEL_MAX,
  KILL_LEVEL_MIN,
  KILL_LEVEL_PER_SCORE,
  LOCK_IDLE,
  MUSIC_DUCK_GAIN,
  MUSIC_DUCK_HOLD_S,
  MUSIC_DUCK_LAMBDA,
} from './audioConstants.ts'

export class AudioDirector {
  readonly engine: AudioEngine

  public onCaption?: (text: string) => void

  /** Seconds of duck remaining, refreshed by each critical alert (§27.2). */
  private duckHold = 0
  /** Smoothed duck multiplier, 1 = unducked. */
  private duckLevel = 1
  /** Last value actually written to the engine, so a settled mix schedules nothing. */
  private appliedDuck = 1

  private targetTension = 0
  private tension = 0
  private targetCombat = 0
  private combat = 0
  private targetAlarm = 0
  private alarm = 0

  private wasCritical = false
  private lastStrafe = 0

  constructor(engine: AudioEngine = new AudioEngine()) {
    this.engine = engine
  }

  private getDirectionSuffix(craft: World['craft'], x: number, y: number, z: number): string {
    const dx = x - craft.position.x
    const dy = y - craft.position.y
    const dz = z - craft.position.z
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (dist < 5) return ''

    const r = dx * craft.frame.right.x + dy * craft.frame.right.y + dz * craft.frame.right.z
    const f = dx * craft.frame.forward.x + dy * craft.frame.forward.y + dz * craft.frame.forward.z

    if (f < -0.5 * dist) return ', behind'
    if (r < -0.3 * dist) return ', left'
    if (r > 0.3 * dist) return ', right'
    return ''
  }

  /**
   * Brings audio up. **Call from a real user gesture** — a pointerdown on the
   * Title screen, the first keypress, anything trusted (§27.4).
   *
   * Idempotent and safe to wire to several listeners at once.
   */
  unlock(): void {
    this.engine.unlock()
  }

  /**
   * One frame of audio (§27).
   *
   * Ordering matters: the listener moves before any one-shot is placed, so a
   * sound emitted this frame is panned against this frame's craft attitude
   * rather than the previous one — at boost that is a 1 u / 3° error, which is
   * small but free to avoid.
   *
   * @hot-path
   * @param world The simulation. Read only; never mutated, never drained.
   * @param dt Real seconds since the previous call — the *render* delta, not
   *   the fixed step: audio is a presentation concern and runs once per frame
   *   however many simulation substeps happened (§18.2).
   * @param live Whether the world is actually advancing this frame. See below.
   */
  update(world: Readonly<World>, dt: number, live = true): void {
    const synth = this.engine.synth
    if (synth === null) return

    const craft = world.craft
    synth.setListener(craft.position, craft.frame)

    /*
     * Is the player in that craft, or is it scenery?
     *
     * Two independent questions, and conflating them was a shipped bug.
     *
     * **Is this a run?** The Title screen flies the craft on autopilot through
     * the *real* flight model — that is the whole point of `AttractSystem`, and
     * it is why the menu cannot drift from how the game actually looks. It also
     * means the engine was running at cruise thrust behind every menu, so
     * opening the game greeted you with a full-throated engine roar over the
     * title. Attract is presentation, not a run: the ambience and the score
     * belong to it, the cockpit does not. That question the *phase* answers, so
     * it cannot disagree with what the world is actually doing.
     *
     * **Is the world moving?** The phase cannot answer this one, and assuming it
     * could is what made the wave-clear screen unbearable. This callback runs on
     * every screen that mounts the canvas, but the world only advances on a few
     * of them — so on WaveClear, Paused, Debrief and Results the craft's state
     * is *frozen* while the continuous voices carry on reading it. The engine
     * held a full-throated roar at the last cruise velocity, the heat whine held
     * at the last heat value, and a lock that happened to be mid-acquisition
     * when the wave ended sat on one pitch and droned until the player clicked
     * through. None of it decayed, because nothing was moving to decay it.
     *
     * That question belongs to the shell, which is the same place `stepping`
     * already lives (`RenderBridge`: "Owned by the UI, not inferred from
     * `world.phase`"). A frozen world gets silence from every state-driven
     * voice, which is what "the world is not moving" should sound like.
     */
    const inCockpit = live && world.phase.kind !== 'Attract'

    /* Continuous voices, driven by state rather than by events (§27.1). */
    const vx = craft.velocity.x
    const vy = craft.velocity.y
    const vz = craft.velocity.z
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz)
    synth.setEngineParams(inCockpit ? speed : 0, inCockpit && craft.boostActive)
    synth.setHeatLevel(inCockpit ? craft.heat / HEAT_MAX : 0)

    const lock = craft.lock
    const lockProgress = lock.kind === 'Acquiring' ? lock.progress : lock.kind === 'Locked' ? 1 : LOCK_IDLE
    synth.setLockProgress(inCockpit ? lockProgress : LOCK_IDLE)

    const strafe = inCockpit ? world.input.strafe : 0
    if (strafe !== 0 && this.lastStrafe === 0) {
      const offset = strafe < 0 ? -2 : 2
      const tx = craft.position.x + craft.frame.right.x * offset
      const ty = craft.position.y + craft.frame.right.y * offset
      const tz = craft.position.z + craft.frame.right.z * offset
      synth.strafeThruster(tx, ty, tz)
      this.caption(strafe < 0 ? '[Strafe left]' : '[Strafe right]')
    }
    this.lastStrafe = strafe

    /* One-shots. */
    this.duckHold = this.duckHold > dt ? this.duckHold - dt : 0

    // One-shots are muted on the menu for the same reason the engine is. The
    // autopilot does not fire, but a respawn or a terrain graze still emits, and
    // a menu that occasionally thumps is worse than one that does not.
    const events = world.events
    const count = inCockpit ? events.count : 0
    for (let i = 0; i < count; i++) {
      /*
       * Typed-array reads are asserted rather than checked, the convention
       * `World.ts` sets for exactly this situation: the arrays are fixed-length
       * and zero-initialised, `i < count <= EVENT_CAPACITY`, and a branch here
       * would be dead code in a per-frame loop.
       */
      const type = events.type[i] as number
      const magnitude = events.b[i] as number
      const x = events.x[i] as number
      const y = events.y[i] as number
      const z = events.z[i] as number

      /*
       * Spatialise only when the event carries a real position *and* it is far
       * enough away for a bearing to mean anything (§27.3). `a` is deliberately
       * not read: its meaning is per-emitter, whereas `type`, `b` and the
       * position are contracted by `EventQueue` itself.
       */
      const far = hasPosition(x, y, z) && !isNearField(craft.position, x, y, z)
      
      let doppler = 1
      if (far) {
        const dx = x - craft.position.x
        const dy = y - craft.position.y
        const dz = z - craft.position.z
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (dist > 0.001) {
          const v_closing = (craft.velocity.x * dx + craft.velocity.y * dy + craft.velocity.z * dz) / dist
          // c = 150 u/s for doppler effect
          doppler = 150 / Math.max(10, 150 - v_closing)
          doppler = Math.max(0.5, Math.min(2.0, doppler))
        }
      }

      switch (type) {
        case GameEvent.ShotFired:
          synth.pulseCannon(x, y, z, far, doppler)
          {
            const suffix = far ? this.getDirectionSuffix(craft, x, y, z) : ''
            this.caption(`[Shot fired${suffix}]`)
          }
          break

        case GameEvent.ProjectileHit:
          synth.impact(x, y, z, far, doppler)
          {
            const suffix = far ? this.getDirectionSuffix(craft, x, y, z) : ''
            this.caption(`[Projectile hit${suffix}]`)
          }
          break

        case GameEvent.EnemyKilled:
          synth.explosion(
            x,
            y,
            z,
            far,
            clamp(KILL_LEVEL_MIN + magnitude * KILL_LEVEL_PER_SCORE, KILL_LEVEL_MIN, KILL_LEVEL_MAX),
            doppler
          )
          {
            const suffix = far ? this.getDirectionSuffix(craft, x, y, z) : ''
            this.caption(`[Enemy destroyed${suffix}]`)
          }
          break

        case GameEvent.PlayerHit:
          synth.playerHit(
            clamp(HIT_LEVEL_MIN + magnitude * HIT_LEVEL_PER_DAMAGE, HIT_LEVEL_MIN, HIT_LEVEL_MAX),
          )
          this.caption('[Hull damage]')
          break

        case GameEvent.DrainStarted:
          synth.drainStarted(x, y, z, far, doppler)
          this.duckHold = MUSIC_DUCK_HOLD_S
          {
            const suffix = far ? this.getDirectionSuffix(craft, x, y, z) : ''
            this.caption(`[Drain started${suffix}]`)
          }
          break

        case GameEvent.OutpostLost:
          synth.outpostLost(x, y, z, far, doppler)
          this.duckHold = MUSIC_DUCK_HOLD_S
          {
            const suffix = far ? this.getDirectionSuffix(craft, x, y, z) : ''
            this.caption(`[Outpost lost${suffix}]`)
          }
          break

        case GameEvent.OutpostSaved:
          synth.outpostSaved()
          this.caption('[Outpost saved]')
          break

        case GameEvent.LockAcquired:
          synth.lockConfirm()
          this.caption('[Lock acquired]')
          break

        case GameEvent.HeatLockout:
          synth.heatLockout()
          this.duckHold = MUSIC_DUCK_HOLD_S
          this.caption('[Heat lockout]')
          break

        case GameEvent.Resupply:
          synth.resupply()
          this.caption('[Resupply]')
          break

        case GameEvent.WaveCleared:
          synth.waveCleared()
          this.caption('[Wave cleared]')
          break

        case GameEvent.MissileFired:
          synth.missileLaunch()
          this.caption('[Missile away]')
          break

        case GameEvent.PlayerDestroyed:
          synth.playerDestroyed()
          this.duckHold = MUSIC_DUCK_HOLD_S
          this.caption('[Craft destroyed]')
          break

        case GameEvent.Respawned:
          synth.respawned()
          break

        case GameEvent.TerrainImpact:
          synth.terrainScrape(x, y, z, far, doppler)
          {
            const suffix = far ? this.getDirectionSuffix(craft, x, y, z) : ''
            this.caption(`[Terrain scrape${suffix}]`)
          }
          break

        case GameEvent.RunEnded:
          synth.runEnded()
          this.duckHold = MUSIC_DUCK_HOLD_S
          break

        case GameEvent.BoostEngaged:
          synth.boostEngage()
          this.caption('[Boost engaged]')
          break

        case GameEvent.TutorialBeatCleared:
          synth.uiConfirm()
          break

        case GameEvent.FlareDeployed:
          synth.flareLaunch()
          this.caption('[Flares deployed]')
          break

        case GameEvent.BombDropped:
          synth.bombDrop()
          this.caption('[Heavy bomb away]')
          break

        case GameEvent.EngineCutToggled:
          synth.engineCut()
          this.caption('[Engine cut - momentum float]')
          break

        case GameEvent.PerkSelected:
          synth.uiConfirm()
          this.caption('[Tactical upgrade acquired]')
          break

        case GameEvent.WeaponSwitched: {
          const toMissiles = (events.a[i] as number) === 1
          synth.weaponSwitch(toMissiles)
          this.caption(toMissiles ? '[Missiles selected]' : '[Cannon selected]')
          break
        }

        case GameEvent.LockLost:
          synth.lockLost()
          this.caption('[Lock lost]')
          break

        case GameEvent.AttackRun:
          synth.attackRun(x, y, z, far)
          {
            const suffix = far ? this.getDirectionSuffix(craft, x, y, z) : ''
            this.caption(`[Interceptor attack run${suffix}]`)
          }
          break

        case GameEvent.Exposed:
          // The reward, announced. A player who has just dodged needs to be
          // told they succeeded, at the moment the window opens rather than
          // after they have already flown away from it.
          synth.lockConfirm()
          this.caption('[Interceptor exposed — hit it now]')
          break

        case GameEvent.SystemDamaged:
          synth.systemFault()
          {
            const system = (events.a[i] as number) === 0 ? 'Engine' : (events.a[i] as number) === 1 ? 'Weapon bay' : 'Stabiliser'
            this.caption(`[${system} damaged]`)
          }
          break

        case GameEvent.SystemsRepaired:
          synth.resupply()
          this.caption('[Systems repaired]')
          break

        /*
         * §7.3 — a Sapper has armed. The one late archetype that gets a voice.
         *
         * It reuses `attackRun` deliberately rather than getting a sound of its
         * own: both events mean "something has committed and cannot now be
         * steered away from", and a player who has learned that sound at wave 4
         * should not have to learn a second one at wave 8 for the same fact. It
         * is spatialised, because *which* outpost is the entire question.
         */
        case GameEvent.SapperArmed:
          synth.attackRun(x, y, z, far)
          {
            const suffix = far ? this.getDirectionSuffix(craft, x, y, z) : ''
            this.caption(`[Sapper armed${suffix}]`)
          }
          break

        /*
         * The other two late archetypes are deliberately **silent**.
         *
         * `WardenAbsorbed` fires once per blocked round, which at cannon rates is
         * ten times a second — a sound there would be the loudest thing in the
         * mix and would say nothing the inert grey sparks at the impact point do
         * not already say. The Sentinel's shield block is silent for exactly the
         * same reason and has been since it shipped.
         *
         * `CarrierLaunch` is genuinely important, and it is still silent, because
         * the fact it carries arrives twice over on its own: the launched
         * Harvester is visible on the Threat Ring immediately and emits
         * `DrainStarted` when it lands. Announcing it a third time would be
         * noise dressed as information.
         *
         * Both keep captions, because a caption costs nothing to a hearing player
         * and is the only channel a deaf one has for the event log.
         */
        case GameEvent.WardenAbsorbed:
          this.caption('[Shot absorbed — kill the Warden first]')
          break

        case GameEvent.CarrierLaunch:
          this.caption('[Carrier launched a Harvester]')
          break

        case GameEvent.SapperDetonated:
          // The blast is already carried by `PlayerHit` when it catches the
          // craft, and by the outpost's own integrity drop when it does not.
          this.caption('[Sapper detonated on an outpost]')
          break

        default:
          break
      }
    }

    /*
     * Adaptive score threats (§27.2)
     */
    let anyThreatened = false
    let anyCritical = false
    for (let i = 0; i < world.outposts.length; i++) {
      const op = world.outposts[i]
      if (!op) continue
      if (op.status === 'Threatened' || op.status === 'Draining' || op.status === 'Critical') anyThreatened = true
      if (op.status !== 'Lost' && op.integrity < OUTPOST_CRITICAL_INTEGRITY) anyCritical = true
    }

    let minHostileDistSq = Infinity
    const nEnemies = world.enemies.pool.capacity
    for (let i = 0; i < nEnemies; i++) {
      if (world.enemies.pool.active[i] === 1) {
        const ex = world.enemies.body.x[i] as number
        const ey = world.enemies.body.y[i] as number
        const ez = world.enemies.body.z[i] as number
        const dx = ex - craft.position.x
        const dy = ey - craft.position.y
        const dz = ez - craft.position.z
        const distSq = dx * dx + dy * dy + dz * dz
        if (distSq < minHostileDistSq) {
          minHostileDistSq = distSq
        }
      }
    }
    
    // Engagement range is ~80u
    const inCombat = minHostileDistSq < 6400

    /*
     * The adaptive stems follow the same rule as the cockpit voices: they
     * describe a situation that is *unfolding*, so a frozen world has none.
     *
     * The alarm stem is the one that made this urgent. It is driven by outpost
     * integrity, which does not move while the world is stopped — so clearing a
     * wave with an outpost still under 25% left the alarm layer pinned at full
     * over the wave-clear screen, for as long as the player took to read it.
     * The music is meant to be scoring a crisis; between waves there is no
     * crisis to score, and letting the mix relax is what makes the *next* wave's
     * alarm mean something again.
     */
    this.targetTension = live && anyThreatened ? 1 : 0
    this.targetCombat = live && inCombat ? 1 : 0
    this.targetAlarm = live && anyCritical ? 1 : 0

    if (live && anyCritical && !this.wasCritical) {
      this.caption('[Outpost integrity critical]')
    }
    // Latched on the *fact*, not on `live && fact`. Clearing it while the world
    // is frozen means every resume from a pause or a wave-clear re-announces a
    // condition that has not changed — the caption is for the transition, and a
    // menu is not a transition.
    this.wasCritical = anyCritical

    const THREAT_LAMBDA = 0.5 // ~1.4s half-life
    this.tension = damp(this.tension, this.targetTension, THREAT_LAMBDA, dt)
    this.combat = damp(this.combat, this.targetCombat, THREAT_LAMBDA, dt)
    this.alarm = damp(this.alarm, this.targetAlarm, THREAT_LAMBDA, dt)

    this.engine.updateStems(this.tension, this.combat, this.alarm)

    /*
     * §27.2 — music ducks 6 dB under critical alerts.
     *
     * `damp` is the analytic exponential approach, so the duck behaves
     * identically at 30 and 144 fps (Rule 5) — the naive lerp would duck
     * roughly twice as fast on a high-refresh display.
     *
     * `PlayerHit` deliberately does not duck: at Interceptor fire rates it
     * would pump the bed continuously, and a duck that is always on is not a
     * duck. The events that trigger it are the ones that change the state of
     * the run.
     */
    this.duckLevel = damp(this.duckLevel, this.duckHold > 0 ? MUSIC_DUCK_GAIN : 1, MUSIC_DUCK_LAMBDA, dt)
    if (Math.abs(this.duckLevel - this.appliedDuck) > DUCK_EPSILON) {
      this.appliedDuck = this.duckLevel
      this.engine.setMusicDuck(this.duckLevel)
    }
  }

  private caption(text: string): void {
    if (this.onCaption) this.onCaption(text)
  }

  /**
   * Silences everything and clears the duck.
   *
   * For run restarts and hard screen changes, where the alternative is the
   * previous run's explosion ringing out over the Title screen.
   */
  reset(): void {
    this.engine.synth?.silenceAll()
    this.duckHold = 0
    this.duckLevel = 1
    this.appliedDuck = 1
    this.engine.setMusicDuck(1)
    this.wasCritical = false
    this.lastStrafe = 0
  }

  /* ---------------------------------------------------------------- */
  /* UI bus (§14.3) — called from React, not from the frame path       */
  /* ---------------------------------------------------------------- */

  /** A button press. No-op before unlock. */
  uiClick(): void {
    this.engine.synth?.uiClick()
  }

  /** Focus or hover moved. No-op before unlock. */
  uiHover(): void {
    this.engine.synth?.uiHover()
  }

  /** A choice committed. No-op before unlock. */
  uiConfirm(): void {
    this.engine.synth?.uiConfirm()
  }

  /** A screen dismissed. No-op before unlock. */
  uiBack(): void {
    this.engine.synth?.uiBack()
  }
}
