// MARE NOCTIS — real physics engine for the orbital-defence game.
// The craft flies in the tangent plane of a moon with radial gravity. Integrated
// at a FIXED timestep (semi-implicit Euler) so motion is identical on 60Hz and
// 144Hz displays. The engine owns all state + math; the R3F layer reads pos/
// forward/up each frame and the HUD reads snapshot() at ~10Hz.
import { Vector3 } from 'three'

// ---- flight constants (from spec) ----
export const R = 100 // moon radius
const G = 12 // gravity, units/s^2
const F_THRUST = 72 // cruise thrust (tuned for control)
const F_BOOST = 150 // boost thrust
const K_DRAG = 0.045 // quadratic drag
const KP = 25 // altitude-hold PD gains (critically damped)
const KD = 10
export const ALT_MIN = 8
export const ALT_MAX = 70
export const FIXED_DT = 1 / 120

export const MOON_R = R // back-compat alias for menu backdrops
export const OUTPOST_NAMES = ['VEGA', 'KEPLER', 'CASSINI', 'TYCHO', 'HADLEY', 'AITKEN', 'RILLE', 'NECTARIS'] as const

export type OutpostState = 'nominal' | 'threatened' | 'draining' | 'critical' | 'lost'
export type EnemyKind = 'harvester' | 'interceptor' | 'sentinel'
export type MarkerKind = EnemyKind | 'outpost'

export type Outpost = { name: string; dir: Vector3; landPos: Vector3; integrity: number; state: OutpostState }
export type Enemy = {
  id: number
  kind: EnemyKind
  pos: Vector3
  vel: Vector3
  hp: number
  target: number // outpost index
  phase: 'descend' | 'drain' | 'chase' | 'hover'
  fireCd: number
  landed: boolean
}
export type Bullet = { id: number; pos: Vector3; vel: Vector3; life: number; active: boolean }
export type Particle = { pos: Vector3; vel: Vector3; life: number; ttl: number; hot: boolean }

export type Marker = {
  id: string
  bearing: number
  proximity: number
  kind: MarkerKind
  urgency: 'safe' | 'threatened' | 'critical'
  hostile: boolean
  lost?: boolean
}

export type HudSnapshot = {
  hull: number
  heat: number
  lockout: boolean
  boost: number
  throttle: number
  turn: number // smoothed yaw rate, -1..1 (flight-director)
  climb: number // -1..1
  speed: number
  score: number
  combo: number
  wave: number
  outposts: { name: string; integrity: number; state: OutpostState }[]
  markers: Marker[]
  altitude: number
  damageDir: number | null
  alert: { text: string; severity: 'info' | 'warning' | 'critical' } | null
  status: 'playing' | 'clear' | 'over'
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export function seedToNumber(seed: string) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

// Even point distribution on a sphere (fibonacci lattice).
export function fibonacciDir(i: number, n: number): Vector3 {
  const golden = Math.PI * (3 - Math.sqrt(5))
  const y = 1 - (i / (n - 1)) * 2
  const r = Math.sqrt(1 - y * y)
  const t = golden * i
  return new Vector3(Math.cos(t) * r, y, Math.sin(t) * r).normalize()
}

export type Keys = Record<string, boolean>

// ---- scratch vectors (reused every step; no per-frame allocation) ----
const _up = new Vector3()
const _right = new Vector3()
const _acc = new Vector3()
const _seg = new Vector3()
const _oc = new Vector3()
const _to = new Vector3()

const ENEMY_RADIUS = 2.6
const DRAIN_PER_SEC = 1.4 // % integrity per harvester per second

export class Game {
  outposts: Outpost[] = []
  enemies: Enemy[] = []
  bullets: Bullet[] = []
  rng: () => number
  seed: string

  // craft flight state
  pos = new Vector3()
  vel = new Vector3()
  forward = new Vector3()
  up = new Vector3(0, 0, 1)
  right = new Vector3(1, 0, 0)
  bankAngle = 0
  altTarget = 30

  // input intents (set by the render layer)
  steer = 0 // -1..1 target yaw
  climb = 0 // -1..1 altitude rate
  yawVel = 0 // smoothed steering rate
  throttle = 0.7 // 0..1
  boosting = false
  firing = false

  // feedback channels read by the renderer
  shake = 0
  muzzle = 0
  particles: Particle[] = []

  hull = 100
  heat = 0
  lockout = false
  boost = 100

  score = 0
  combo = 1
  comboTimer = 0
  wave = 1
  spawnBudget = 0
  spawnTimer = 0
  killsThisWave = 0
  totalKills = 0
  shots = 0
  hits = 0
  status: 'playing' | 'clear' | 'over' = 'playing'
  damageDir: number | null = null
  damageTimer = 0
  alert: { text: string; severity: 'info' | 'warning' | 'critical'; ttl: number } | null = null
  nextId = 1
  runClock = 0
  losses: { name: string; t: number }[] = []
  _fireCd = 0
  accumulator = 0

  constructor(seed: string) {
    this.seed = seed
    this.rng = mulberry32(seedToNumber(seed))
    this.outposts = OUTPOST_NAMES.map((name, i) => {
      const dir = fibonacciDir(i, 8)
      return { name, dir, landPos: dir.clone().multiplyScalar(R + 3), integrity: 100, state: 'nominal' as OutpostState }
    })
    // start above the first outpost, heading along a tangent
    this.up.copy(this.outposts[0].dir).normalize()
    this.pos.copy(this.up).multiplyScalar(R + this.altTarget)
    const t = new Vector3(0, 1, 0).cross(this.up)
    if (t.lengthSq() < 1e-4) t.set(1, 0, 0)
    this.forward.copy(t).normalize()
    this.startWave(1)
  }

  startWave(n: number) {
    this.wave = n
    this.status = 'playing'
    this.spawnBudget = 3 + n * 2
    this.spawnTimer = 0.8
    this.killsThisWave = 0
    this.setAlert(`WAVE ${n} — INCOMING`, 'warning')
  }

  setAlert(text: string, severity: 'info' | 'warning' | 'critical') {
    const rank = { info: 0, warning: 1, critical: 2 }
    if (!this.alert || rank[severity] >= rank[this.alert.severity]) this.alert = { text, severity, ttl: 2.6 }
  }

  // Advance real time; drive the sim at a fixed timestep.
  advance(delta: number) {
    if (this.status !== 'playing') return
    this.accumulator += Math.min(delta, 0.25) // clamp prevents tab-switch spiral
    while (this.accumulator >= FIXED_DT) {
      this.step(FIXED_DT)
      this.accumulator -= FIXED_DT
    }
  }

  step(dt: number) {
    this.runClock += dt

    // ---- tangent frame ----
    _up.copy(this.pos).normalize()
    this.up.copy(_up)
    this.forward.addScaledVector(_up, -this.forward.dot(_up)).normalize()
    _right.copy(this.forward).cross(_up).normalize()
    this.right.copy(_right)

    // ---- steering: smooth the input into a yaw rate so it never snaps ----
    this.yawVel += (this.steer - this.yawVel) * Math.min(1, dt * 5)
    this.forward.applyAxisAngle(_up, -this.yawVel * 1.6 * dt).normalize()

    // bank into turns, proportional to yaw rate, max ~35deg
    const targetBank = Math.max(-0.6, Math.min(0.6, -this.yawVel * 0.6))
    this.bankAngle += (targetBank - this.bankAngle) * Math.min(1, dt * 6)

    // altitude target driven by climb input (mouse Y / keys / stick)
    this.altTarget = Math.max(ALT_MIN, Math.min(ALT_MAX, this.altTarget + this.climb * 34 * dt))

    // ---- boost / heat resources ----
    const boosting = this.boosting && this.boost > 0
    this.boost = boosting ? Math.max(0, this.boost - dt * 42) : Math.min(100, this.boost + dt * 12)

    // ---- forces ----
    _acc.set(0, 0, 0)
    _acc.addScaledVector(_up, -G) // radial gravity
    _acc.addScaledVector(this.forward, this.throttle * (boosting ? F_BOOST : F_THRUST))
    _acc.addScaledVector(this.vel, -K_DRAG * this.vel.length()) // quadratic drag

    // ---- altitude hold (critically damped PD) ----
    const h = this.pos.length() - R
    const hDot = this.vel.dot(_up)
    _acc.addScaledVector(_up, KP * (this.altTarget - h) - KD * hDot)

    // ---- semi-implicit Euler: velocity FIRST, then position ----
    this.vel.addScaledVector(_acc, dt)
    this.pos.addScaledVector(this.vel, dt)

    // ---- weapon heat / firing ----
    this.heat = Math.max(0, this.heat - dt * (this.firing ? 6 : 26))
    if (this.lockout && this.heat <= 55) this.lockout = false
    if (this.firing && !this.lockout) {
      this._fireCd -= dt
      if (this._fireCd <= 0) { this.fire(); this._fireCd = 0.12 }
    }

    this.comboTimer -= dt
    if (this.comboTimer <= 0) this.combo = 1

    // ---- spawning ----
    if (this.spawnBudget > 0) {
      this.spawnTimer -= dt
      if (this.spawnTimer <= 0) { this.spawnEnemy(); this.spawnBudget--; this.spawnTimer = 1.4 + this.rng() * 1.6 }
    }

    this.updateEnemies(dt)
    this.updateBullets(dt)
    this.updateOutposts(dt)
    this.updateParticles(dt)

    // feedback decay
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 4)
    if (this.muzzle > 0) this.muzzle = Math.max(0, this.muzzle - dt * 6)

    if (this.alert) { this.alert.ttl -= dt; if (this.alert.ttl <= 0) this.alert = null }
    if (this.damageTimer > 0) { this.damageTimer -= dt; if (this.damageTimer <= 0) this.damageDir = null }

    if (this.outposts.every((o) => o.state === 'lost') || this.hull <= 0) this.status = 'over'
    else if (this.spawnBudget === 0 && this.enemies.length === 0) this.status = 'clear'
  }

  spawnEnemy() {
    const live = this.outposts.filter((o) => o.state !== 'lost')
    if (!live.length) return
    const o = live[Math.floor(this.rng() * live.length)]
    const idx = this.outposts.indexOf(o)
    const roll = this.rng()
    const kind: EnemyKind = roll > 0.82 ? 'sentinel' : roll > 0.58 ? 'interceptor' : 'harvester'
    // spawn on an arc high above the target outpost, slightly offset
    const jitter = new Vector3(this.rng() - 0.5, this.rng() - 0.5, this.rng() - 0.5).multiplyScalar(0.6)
    const dir = o.dir.clone().add(jitter).normalize()
    this.enemies.push({
      id: this.nextId++,
      kind,
      pos: dir.multiplyScalar(R + 150 + this.rng() * 70),
      vel: new Vector3(),
      hp: kind === 'sentinel' ? 5 : kind === 'interceptor' ? 2 : 3,
      target: idx,
      phase: kind === 'interceptor' ? 'chase' : kind === 'sentinel' ? 'hover' : 'descend',
      fireCd: 1 + this.rng() * 2,
      landed: false,
    })
  }

  updateEnemies(dt: number) {
    for (const e of this.enemies) {
      let o = this.outposts[e.target]
      if (!o || o.state === 'lost') {
        const live = this.outposts.filter((x) => x.state !== 'lost')
        if (!live.length) { e.hp = 0; continue }
        e.target = this.outposts.indexOf(live[Math.floor(this.rng() * live.length)])
        o = this.outposts[e.target]
        e.landed = false
        e.phase = e.kind === 'interceptor' ? 'chase' : e.kind === 'sentinel' ? 'hover' : 'descend'
      }

      if (e.kind === 'harvester') {
        _to.copy(o.landPos).sub(e.pos)
        const d = _to.length()
        if (d > 6) {
          e.pos.addScaledVector(_to.normalize(), Math.min(d, 54 * dt))
          e.phase = 'descend'
        } else {
          e.phase = 'drain'
          e.landed = true
          o.integrity = Math.max(0, o.integrity - DRAIN_PER_SEC * dt)
          if (o.integrity <= 0) this.loseOutpost(o)
        }
      } else if (e.kind === 'interceptor') {
        // chase the player
        _to.copy(this.pos).sub(e.pos)
        const d = _to.length()
        e.pos.addScaledVector(_to.normalize(), Math.min(d, 80 * dt))
        e.phase = 'chase'
        if (d < 9) this.hitPlayer(60 * dt, this.bearingTo(e.pos))
      } else {
        // sentinel: hover above its outpost at mid altitude
        _to.copy(o.dir).multiplyScalar(R + 42).sub(e.pos)
        e.pos.addScaledVector(_to, Math.min(1, dt * 0.9))
        e.phase = 'hover'
        if (e.pos.distanceTo(this.pos) < 11) this.hitPlayer(40 * dt, this.bearingTo(e.pos))
      }
    }
    this.enemies = this.enemies.filter((e) => e.hp > 0)
  }

  fire() {
    if (this.lockout || this.heat >= 100 || this.status !== 'playing') return
    // aim assist: bend toward the nearest enemy inside a cone of the heading
    let dir = this.forward.clone()
    let best: Enemy | null = null
    let bestDot = Math.cos(0.14)
    for (const e of this.enemies) {
      _to.copy(e.pos).sub(this.pos).normalize()
      const d = _to.dot(this.forward)
      if (d > bestDot) { bestDot = d; best = e }
    }
    if (best) dir = best.pos.clone().sub(this.pos).normalize().lerp(this.forward, 0.2).normalize()
    // reuse a dead bullet from the pool if possible
    const vel = dir.multiplyScalar(220).add(this.vel)
    const b = this.bullets.find((x) => !x.active)
    if (b) { b.pos.copy(this.pos); b.vel.copy(vel); b.life = 1.4; b.active = true; b.id = this.nextId++ }
    else this.bullets.push({ id: this.nextId++, pos: this.pos.clone(), vel, life: 1.4, active: true })
    this.heat = Math.min(100, this.heat + 8)
    if (this.heat >= 100) { this.lockout = true; this.setAlert('WEAPON OVERHEAT', 'warning') }
    this.muzzle = 0.06
    this.shots++
  }

  spawnBurst(at: Vector3, count: number, spread: number, hot: boolean) {
    for (let i = 0; i < count; i++) {
      let p = this.particles.find((x) => x.life <= 0)
      if (!p) { p = { pos: new Vector3(), vel: new Vector3(), life: 0, ttl: 1, hot }; this.particles.push(p) }
      p.pos.copy(at)
      p.vel.set(this.rng() - 0.5, this.rng() - 0.5, this.rng() - 0.5).normalize().multiplyScalar(spread * (0.4 + this.rng()))
      p.ttl = 0.4 + this.rng() * 0.5
      p.life = p.ttl
      p.hot = hot
    }
  }

  updateParticles(dt: number) {
    for (const p of this.particles) {
      if (p.life <= 0) continue
      p.life -= dt
      _up.copy(p.pos).normalize()
      p.vel.addScaledVector(_up, -G * dt) // radial gravity
      p.vel.multiplyScalar(Math.pow(0.4, dt)) // drag
      p.pos.addScaledVector(p.vel, dt)
    }
  }

  updateBullets(dt: number) {
    for (const b of this.bullets) {
      if (!b.active) continue
      b.life -= dt
      if (b.life <= 0) { b.active = false; continue }
      // swept segment this step
      _seg.copy(b.vel).multiplyScalar(dt)
      // surface hit (moon)
      if (_oc.copy(b.pos).add(_seg).length() < R) { b.active = false; continue }
      // swept ray-sphere against enemies
      let hit = false
      for (const e of this.enemies) {
        if (e.hp <= 0) continue
        if (this.segmentHitsSphere(b.pos, _seg, e.pos, ENEMY_RADIUS)) {
          e.hp--
          this.hits++
          hit = true
          if (e.hp <= 0) this.killEnemy(e)
          break
        }
      }
      if (hit) { b.active = false; continue }
      b.pos.add(_seg)
    }
  }

  // Ray-sphere quadratic over the swept segment p0 -> p0+seg. Returns true if the
  // segment intersects the sphere (center c, radius r) with t in [0,1].
  segmentHitsSphere(p0: Vector3, seg: Vector3, c: Vector3, r: number) {
    _oc.copy(p0).sub(c)
    const a = seg.dot(seg)
    if (a < 1e-9) return _oc.lengthSq() <= r * r
    const b = 2 * _oc.dot(seg)
    const cc = _oc.dot(_oc) - r * r
    const disc = b * b - 4 * a * cc
    if (disc < 0) return false
    const sq = Math.sqrt(disc)
    const t0 = (-b - sq) / (2 * a)
    const t1 = (-b + sq) / (2 * a)
    return (t0 >= 0 && t0 <= 1) || (t1 >= 0 && t1 <= 1) || (t0 < 0 && t1 > 1)
  }

  updateOutposts(_dt: number) {
    for (const o of this.outposts) {
      if (o.state === 'lost') continue
      const threatened = this.enemies.some((e) => this.outposts[e.target] === o)
      const draining = this.enemies.some((e) => e.phase === 'drain' && this.outposts[e.target] === o)
      if (o.integrity < 25) { o.state = 'critical'; this.setAlert(`${o.name} CRITICAL`, 'critical') }
      else if (draining) { o.state = 'draining'; this.setAlert(`OUTPOST ${o.name} DRAINING`, 'warning') }
      else if (threatened) { o.state = 'threatened' }
      else o.state = 'nominal'
    }
  }

  killEnemy(e: Enemy) {
    this.combo = Math.min(5, this.combo + 1)
    this.comboTimer = 3
    // shooting a harvester before it lands is worth more
    const base = e.kind === 'harvester' ? (e.landed ? 60 : 140) : e.kind === 'sentinel' ? 120 : 90
    this.score += base * this.combo
    this.killsThisWave++
    this.totalKills++
    this.spawnBurst(e.pos, e.kind === 'sentinel' ? 20 : 14, 26, true)
    this.shake = Math.min(1.2, this.shake + 0.35)
  }

  hitPlayer(dmg: number, dir: number) {
    this.hull = Math.max(0, this.hull - dmg)
    this.damageDir = dir
    this.damageTimer = 0.5
    this.shake = Math.min(2, this.shake + Math.min(1.4, dmg * 0.05))
    if (this.hull < 20) this.setAlert('HULL CRITICAL', 'critical')
    if (this.hull <= 0) this.status = 'over'
  }

  loseOutpost(o: Outpost) {
    o.state = 'lost'
    o.integrity = 0
    this.losses.push({ name: o.name, t: this.runClock })
    this.setAlert(`OUTPOST ${o.name} LOST`, 'critical')
  }

  get accuracy() {
    return this.shots ? Math.round((this.hits / this.shots) * 100) : 0
  }

  get altitude() {
    return this.pos.length() - R
  }

  // bearing of a world point relative to heading (0 = ahead), projected to tangent plane
  bearingTo(p: Vector3) {
    _to.copy(p).sub(this.pos).normalize()
    _to.addScaledVector(this.up, -_to.dot(this.up)).normalize()
    return Math.atan2(_to.dot(this.right), _to.dot(this.forward))
  }

  snapshot(): HudSnapshot {
    const maxRange = 320
    const markerFor = (p: Vector3, kind: MarkerKind, urgency: Marker['urgency'], hostile: boolean, id: number, lost?: boolean): Marker => {
      _to.copy(p).sub(this.pos)
      const dist = _to.length()
      _to.normalize().addScaledVector(this.up, -_to.dot(this.up)).normalize()
      const deg = (Math.atan2(_to.dot(this.right), _to.dot(this.forward)) * 180) / Math.PI
      return { id: String(id), bearing: ((deg % 360) + 360) % 360, proximity: Math.min(1, dist / maxRange), kind, urgency, hostile, lost }
    }
    const markers: Marker[] = []
    for (const e of this.enemies) {
      const dist = e.pos.distanceTo(this.pos)
      const urgency: Marker['urgency'] = e.phase === 'drain' ? 'critical' : dist < 170 ? 'threatened' : 'safe'
      markers.push(markerFor(e.pos, e.kind, urgency, true, e.id))
    }
    for (let i = 0; i < this.outposts.length; i++) {
      const o = this.outposts[i]
      const urgency: Marker['urgency'] = o.state === 'critical' ? 'critical' : o.state === 'nominal' || o.state === 'lost' ? 'safe' : 'threatened'
      markers.push(markerFor(o.landPos, 'outpost', urgency, false, 10000 + i, o.state === 'lost'))
    }
    return {
      hull: this.hull,
      heat: this.heat,
      lockout: this.lockout,
      boost: this.boost,
      throttle: this.throttle,
      turn: Math.max(-1, Math.min(1, this.yawVel)),
      climb: this.climb,
      speed: this.vel.length(),
      score: this.score,
      combo: this.combo,
      wave: this.wave,
      outposts: this.outposts.map((o) => ({ name: o.name, integrity: Math.round(o.integrity), state: o.state })),
      markers,
      altitude: Math.round(((this.altitude - ALT_MIN) / (ALT_MAX - ALT_MIN)) * 62 + 8),
      damageDir: this.damageDir,
      alert: this.alert ? { text: this.alert.text, severity: this.alert.severity } : null,
      status: this.status,
    }
  }
}
