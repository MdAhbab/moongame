// The live 3D layer: a react-three-fiber scene driven by the engine. Everything
// is generated in code — no models, no textures. The loop runs in useFrame at a
// fixed timestep; HUD values are pushed out at ~10Hz (never per-frame setState).
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { Game, R, fibonacciDir, type Enemy, type HudSnapshot } from './engine'

// ---- procedural moon: fbm relief + bowl craters, maria darkened via vertex colour ----
function fbm(p: THREE.Vector3) {
  return (
    0.5 * Math.sin(p.x * 3.1 + p.y * 1.7) * Math.cos(p.z * 2.3) +
    0.25 * Math.sin(p.x * 6.2 + p.z * 4.1) +
    0.12 * Math.sin(p.y * 9.3 + p.x * 2.6)
  )
}
function randUnit() {
  return new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize()
}
function buildMoon() {
  const geo = new THREE.IcosahedronGeometry(R, 5)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const craters = Array.from({ length: 42 }, () => ({ dir: randUnit(), r: 0.1 + Math.random() * 0.26, depth: 2.5 + Math.random() * 8 }))
  const maria = Array.from({ length: 6 }, () => ({ dir: randUnit(), r: 0.35 + Math.random() * 0.3 }))
  const colors: number[] = []
  const v = new THREE.Vector3()
  const light = new THREE.Color(0xb8b4ad)
  const dark = new THREE.Color(0x6f6d68)
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const n = v.clone().normalize()
    let disp = fbm(n) * 2.2
    for (const c of craters) {
      const ang = n.angleTo(c.dir)
      if (ang < c.r) { const t = ang / c.r; disp -= c.depth * (1 - t * t) }
      else if (ang < c.r * 1.22) disp += c.depth * 0.16 // rim
    }
    let mare = 0
    for (const m of maria) { const ang = n.angleTo(m.dir); if (ang < m.r) mare = Math.max(mare, 1 - ang / m.r) }
    v.setLength(R + disp - mare * 1.5)
    pos.setXYZ(i, v.x, v.y, v.z)
    const shade = THREE.MathUtils.clamp(0.72 + fbm(n.clone().multiplyScalar(3)) * 0.12 + (disp < 0 ? -0.1 : 0.02), 0.45, 1)
    const c = light.clone().lerp(dark, mare * 0.8).multiplyScalar(shade)
    colors.push(c.r, c.g, c.b)
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }))
  mesh.receiveShadow = true
  return mesh
}

function buildStars() {
  const g = new THREE.BufferGeometry()
  const n = 8000
  const arr = new Float32Array(n * 3)
  const col = new Float32Array(n * 3)
  const c = new THREE.Color()
  for (let i = 0; i < n; i++) {
    const d = randUnit().multiplyScalar(900 + Math.random() * 400)
    arr[i * 3] = d.x; arr[i * 3 + 1] = d.y; arr[i * 3 + 2] = d.z
    // faint blue-white to warm variance, a few brighter
    const t = Math.random()
    c.setHSL(0.55 + (Math.random() - 0.5) * 0.12, 0.35, 0.6 + (t > 0.94 ? 0.35 : Math.random() * 0.15))
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
  }
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return new THREE.Points(g, new THREE.PointsMaterial({ size: 1.7, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9 }))
}

// player craft: nose + delta wings + twin canted tails + engine nozzle, nose along +Z
function buildCraft() {
  const grp = new THREE.Group()
  const hull = new THREE.MeshStandardMaterial({ color: 0xe8edf2, roughness: 0.55, metalness: 0.3 })
  const trim = new THREE.MeshStandardMaterial({ color: 0x0d1117, roughness: 0.6, metalness: 0.4 })

  const noseGeos: THREE.BufferGeometry[] = []
  const nose = new THREE.ConeGeometry(1.4, 12, 12); nose.rotateX(Math.PI / 2); nose.translate(0, 0, 4)
  const body = new THREE.CylinderGeometry(1.4, 1.0, 5, 12); body.rotateX(Math.PI / 2); body.translate(0, 0, -3.5)
  noseGeos.push(nose, body)
  const hullMesh = new THREE.Mesh(mergeGeometries(noseGeos), hull)
  hullMesh.castShadow = true
  grp.add(hullMesh)

  const wing = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 2), new THREE.Vector3(7, 0, -5), new THREE.Vector3(0.6, 0, -4),
  ])
  wing.setIndex([0, 1, 2]); wing.computeVertexNormals()
  const wingL = new THREE.Mesh(wing, hull); const wingR = wingL.clone(); wingR.scale.x = -1
  grp.add(wingL, wingR)

  const tailGeo = new THREE.BoxGeometry(0.3, 3, 2.4); tailGeo.translate(0, 1.4, -3.4)
  const tailL = new THREE.Mesh(tailGeo, trim); tailL.rotation.z = 0.4; tailL.position.x = 0.8
  const tailR = new THREE.Mesh(tailGeo, trim); tailR.rotation.z = -0.4; tailR.position.x = -0.8
  grp.add(tailL, tailR)

  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.8, 1.6, 12), trim)
  nozzle.rotation.x = Math.PI / 2; nozzle.position.z = -6.2
  const exhaust = new THREE.Mesh(new THREE.ConeGeometry(0.85, 3.2, 12), new THREE.MeshBasicMaterial({ color: 0x7fe8ff, transparent: true, opacity: 0.85 }))
  exhaust.rotation.x = -Math.PI / 2; exhaust.position.z = -8
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(1.3, 10, 10), new THREE.MeshBasicMaterial({ color: 0xdff6ff, transparent: true, opacity: 0.9 }))
  muzzle.position.z = 10; muzzle.visible = false
  grp.add(nozzle, exhaust, muzzle)

  return { grp, exhaust, muzzle }
}

function buildOutpost() {
  const grp = new THREE.Group()
  const shell = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.7, metalness: 0.2 })
  const dome = new THREE.Mesh(new THREE.IcosahedronGeometry(3.4, 1), shell)
  dome.scale.y = 0.7; dome.position.y = 0.4; dome.castShadow = true
  const corridor = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 5, 8), shell)
  corridor.rotation.z = Math.PI / 2; corridor.position.set(3.5, 0.6, 0)
  const pod = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 1), shell); pod.position.set(6, 0.6, 0)
  const dish = new THREE.Mesh(new THREE.SphereGeometry(1.8, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), shell)
  dish.rotation.x = -0.7; dish.position.set(-2.5, 2, 1.5)
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 5, 8), new THREE.MeshStandardMaterial({ color: 0x7fe8ff, emissive: 0x7fe8ff, emissiveIntensity: 2 }))
  beacon.position.y = 4
  grp.add(dome, corridor, pod, dish, beacon)
  return { grp, beacon }
}

// distinct enemy silhouettes, each a single merged geometry for InstancedMesh
function buildEnemyGeo(kind: 'harvester' | 'interceptor' | 'sentinel') {
  if (kind === 'harvester') {
    const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(3.2, 3.2, 2.2, 6)]
    for (let i = 0; i < 4; i++) {
      const leg = new THREE.BoxGeometry(0.5, 3, 0.5)
      const a = (i / 4) * Math.PI * 2
      leg.translate(Math.cos(a) * 2.8, -2, Math.sin(a) * 2.8)
      parts.push(leg)
    }
    return mergeGeometries(parts)
  }
  if (kind === 'interceptor') {
    const dart = new THREE.ConeGeometry(1.1, 8, 4); dart.rotateX(Math.PI / 2) // nose +Z
    const finA = new THREE.BoxGeometry(4, 0.3, 1.6); finA.translate(0, 0, -2)
    const finB = new THREE.BoxGeometry(0.3, 4, 1.6); finB.translate(0, 0, -2)
    return mergeGeometries([dart, finA, finB])
  }
  const body = new THREE.BoxGeometry(6, 1.6, 4)
  const shield = new THREE.BoxGeometry(6.4, 4, 0.5); shield.translate(0, 0.8, 2.2)
  shield.applyMatrix4(new THREE.Matrix4().makeRotationX(-0.35))
  return mergeGeometries([body, shield])
}

const scratch = {
  desired: new THREE.Vector3(),
  look: new THREE.Vector3(),
  ahead: new THREE.Vector3(),
  xcol: new THREE.Vector3(),
  ycol: new THREE.Vector3(),
  n: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  q: new THREE.Quaternion(),
  m: new THREE.Matrix4(),
}
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const Z_AXIS = new THREE.Vector3(0, 0, 1)

function orientObj(obj: THREE.Object3D, fwd: THREE.Vector3, up: THREE.Vector3, bank: number) {
  const z = fwd
  scratch.xcol.copy(up).cross(z).normalize()
  scratch.ycol.copy(z).cross(scratch.xcol).normalize()
  scratch.m.makeBasis(scratch.xcol, scratch.ycol, z)
  obj.quaternion.setFromRotationMatrix(scratch.m)
  obj.rotateZ(bank)
}

export default function GameScene({
  game,
  paused,
  touch,
  onSnapshot,
  onWaveClear,
  onGameOver,
}: {
  game: Game
  paused: boolean
  touch: boolean
  onSnapshot: (s: HudSnapshot) => void
  onWaveClear: (g: Game) => void
  onGameOver: (g: Game) => void
}) {
  const { camera, gl } = useThree()
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const endedRef = useRef(false)
  const camPos = useRef(new THREE.Vector3())
  const hudAcc = useRef(0)
  const dummy = useMemo(() => new THREE.Object3D(), [])

  const built = useMemo(() => {
    const root = new THREE.Group()

    // key sun — warm, casts shadows, defines the terminator
    const sun = new THREE.DirectionalLight(0xfff2e0, 4.2)
    sun.position.set(400, 220, 260)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.bias = -0.0004
    sun.shadow.camera.near = 100; sun.shadow.camera.far = 900
    ;(sun.shadow.camera as THREE.OrthographicCamera).left = -180
    ;(sun.shadow.camera as THREE.OrthographicCamera).right = 180
    ;(sun.shadow.camera as THREE.OrthographicCamera).top = 180
    ;(sun.shadow.camera as THREE.OrthographicCamera).bottom = -180
    root.add(sun)
    // cool fill from the opposite side so the night hemisphere reads instead of crushing
    const fill = new THREE.DirectionalLight(0x9fc4ff, 0.75)
    fill.position.set(-320, -140, -220)
    root.add(fill)
    root.add(new THREE.HemisphereLight(0x4a6a92, 0x0b1220, 0.7)) // earthshine
    root.add(new THREE.AmbientLight(0xbcd0ff, 0.16))

    root.add(buildStars())
    const moon = buildMoon(); root.add(moon)

    const sunOrb = new THREE.Mesh(new THREE.SphereGeometry(30, 24, 24), new THREE.MeshBasicMaterial({ color: 0xfff2d0 }))
    sunOrb.position.set(700, 380, 460); root.add(sunOrb)
    const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffe9b0, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }))
    sunGlow.scale.setScalar(160); sunGlow.position.copy(sunOrb.position); root.add(sunGlow)

    const earth = new THREE.Mesh(new THREE.SphereGeometry(42, 32, 32), new THREE.MeshStandardMaterial({ color: 0x2f74e0, emissive: 0x0b2350, emissiveIntensity: 0.7, roughness: 1 }))
    earth.position.set(-600, 260, -700); root.add(earth)
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(48, 32, 32), new THREE.MeshBasicMaterial({ color: 0x6fb0ff, transparent: true, opacity: 0.28, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }))
    atmo.position.copy(earth.position); root.add(atmo)

    const { grp: craft, exhaust, muzzle } = buildCraft(); root.add(craft)
    const spot = new THREE.SpotLight(0xdff2ff, 2.6, 340, 0.62, 0.5, 1)
    spot.position.set(0, 1, 2)
    spot.target.position.set(0, -0.4, 24)
    craft.add(spot, spot.target)

    const outpostNodes = game.outposts.map((o, i) => {
      const { grp, beacon } = buildOutpost()
      const dir = fibonacciDir(i, 8)
      grp.position.copy(dir).multiplyScalar(R + 1)
      grp.quaternion.setFromUnitVectors(Y_AXIS, dir) // "up" = surface normal
      root.add(grp)
      return { grp, beacon }
    })

    const enemyMeshes = (['harvester', 'interceptor', 'sentinel'] as const).map((kind) => {
      const mat = new THREE.MeshStandardMaterial({ color: 0x2a1a0e, emissive: 0xff8a3d, emissiveIntensity: 1.1, roughness: 0.5 })
      const mesh = new THREE.InstancedMesh(buildEnemyGeo(kind), mat, 64)
      mesh.count = 0
      mesh.castShadow = true
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.frustumCulled = false
      root.add(mesh)
      return { kind, mesh }
    })

    const bulletMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.7, 8, 8), new THREE.MeshBasicMaterial({ color: 0x7fe8ff }), 256)
    bulletMesh.count = 0
    bulletMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    bulletMesh.frustumCulled = false
    root.add(bulletMesh)

    // explosion / debris particles
    const partMat = new THREE.MeshBasicMaterial({ color: 0xffb066, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    const particleMesh = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.9), partMat, 400)
    particleMesh.count = 0
    particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    particleMesh.frustumCulled = false
    root.add(particleMesh)

    return { root, craft, exhaust, muzzle, outpostNodes, enemyMeshes, bulletMesh, particleMesh }
  }, [game])

  // initial camera placement
  useEffect(() => {
    camPos.current.copy(game.pos).addScaledVector(game.forward, -22).addScaledVector(game.up, 7)
    camera.position.copy(camPos.current)
    ;(camera as THREE.PerspectiveCamera).fov = 62
    camera.up.copy(game.up)
    camera.lookAt(game.pos)
    camera.updateProjectionMatrix()
    // filmic tone mapping lifts the shadows without washing out highlights
    gl.toneMapping = THREE.ACESFilmicToneMapping
    gl.toneMappingExposure = 1.15
  }, [game, camera, gl])

  // input: position-based steering (cursor offset from screen centre = virtual
  // stick — easy, smooth, never hijacks the pointer), keyboard, hold to fire.
  useEffect(() => {
    const el = gl.domElement
    const keys: Record<string, boolean> = {}
    let mSteer = 0
    let mClimb = 0

    const kd = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (k === 'escape') return
      if (k === ' ' || k === 'control') e.preventDefault()
      keys[k] = true
    }
    const ku = (e: KeyboardEvent) => { keys[e.key.toLowerCase()] = false }
    const dead = (v: number) => (Math.abs(v) < 0.08 ? 0 : v)
    const move = (e: MouseEvent) => {
      if (touch) return
      mSteer = dead(THREE.MathUtils.clamp(((e.clientX / window.innerWidth) * 2 - 1) * 1.25, -1, 1))
      mClimb = dead(THREE.MathUtils.clamp((-(e.clientY / window.innerHeight) * 2 + 1) * 1.25, -1, 1))
    }
    const mdown = () => { if (!touch) game.firing = true }
    const mup = () => { game.firing = false }

    // fold key + mouse intents into engine inputs each animation frame
    let raf = 0
    let prev = performance.now()
    const feed = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000); prev = now
      if (!touch) {
        const kSteer = (keys['d'] || keys['arrowright'] ? 1 : 0) - (keys['a'] || keys['arrowleft'] ? 1 : 0)
        const kClimb = (keys[' '] ? 1 : 0) - (keys['control'] ? 1 : 0)
        game.steer = THREE.MathUtils.clamp(mSteer + kSteer, -1, 1)
        game.climb = THREE.MathUtils.clamp(mClimb + kClimb, -1, 1)
        if (keys['w'] || keys['arrowup']) game.throttle = Math.min(1, game.throttle + dt * 0.9)
        if (keys['s'] || keys['arrowdown']) game.throttle = Math.max(0, game.throttle - dt * 0.9)
        game.boosting = !!keys['shift']
      }
      raf = requestAnimationFrame(feed)
    }
    raf = requestAnimationFrame(feed)

    el.addEventListener('mousedown', mdown)
    window.addEventListener('mouseup', mup)
    window.addEventListener('mousemove', move)
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('mousedown', mdown)
      window.removeEventListener('mouseup', mup)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
    }
  }, [game, gl, touch])

  useFrame((_, delta) => {
    if (!pausedRef.current) game.advance(delta)

    // ----- craft -----
    built.craft.position.copy(game.pos)
    orientObj(built.craft, game.forward, game.up, game.bankAngle)
    const boosting = game.boosting && game.boost > 0
    built.exhaust.scale.setScalar(0.7 + game.throttle * (boosting ? 1.8 : 0.9) + Math.random() * 0.15)
    built.muzzle.visible = game.muzzle > 0
    if (game.muzzle > 0) built.muzzle.scale.setScalar(0.6 + game.muzzle * 8 + Math.random() * 0.3)

    // ----- camera (frame-rate-independent smoothing) -----
    scratch.desired.copy(game.pos).addScaledVector(game.forward, -22).addScaledVector(game.up, 7)
    camPos.current.lerp(scratch.desired, 1 - Math.exp(-6 * delta))
    camera.position.copy(camPos.current)
    camera.up.copy(game.up)
    scratch.look.copy(game.pos).addScaledVector(game.forward, 12).addScaledVector(game.up, -1)
    camera.lookAt(scratch.look)
    const pc = camera as THREE.PerspectiveCamera
    const targetFov = boosting ? 74 : 62
    pc.fov += (targetFov - pc.fov) * Math.min(1, delta * 4)
    pc.updateProjectionMatrix()
    // screen shake on impacts / kills (never while paused)
    if (game.shake > 0 && !pausedRef.current) {
      const s = game.shake * 1.6
      camera.position.x += (Math.random() - 0.5) * s
      camera.position.y += (Math.random() - 0.5) * s
      camera.position.z += (Math.random() - 0.5) * s
    }

    // ----- outposts -----
    built.outpostNodes.forEach((node, i) => {
      const o = game.outposts[i]
      const col = o.state === 'lost' ? 0x4a5058 : o.state === 'nominal' ? 0x7fe8ff : 0xff8a3d
      const mat = node.beacon.material as THREE.MeshStandardMaterial
      mat.color.setHex(col); mat.emissive.setHex(col)
      mat.emissiveIntensity = o.state === 'lost' ? 0.05 : o.state === 'critical' ? 1.2 + Math.sin(performance.now() / 90) * 0.8 : 2
    })

    // ----- enemies (instanced per kind) -----
    for (const { kind, mesh } of built.enemyMeshes) {
      let n = 0
      for (const e of game.enemies) {
        if (e.kind !== kind || n >= 64) continue
        placeEnemy(dummy, e)
        mesh.setMatrixAt(n, dummy.matrix)
        n++
      }
      mesh.count = n
      mesh.instanceMatrix.needsUpdate = true
    }

    // ----- bullets (instanced) -----
    let bn = 0
    for (const b of game.bullets) {
      if (!b.active || bn >= 256) continue
      dummy.position.copy(b.pos); dummy.quaternion.identity(); dummy.scale.setScalar(1)
      dummy.updateMatrix()
      built.bulletMesh.setMatrixAt(bn, dummy.matrix)
      bn++
    }
    built.bulletMesh.count = bn
    built.bulletMesh.instanceMatrix.needsUpdate = true

    // ----- particles -----
    let pn = 0
    for (const p of game.particles) {
      if (p.life <= 0 || pn >= 400) continue
      const f = p.life / p.ttl
      dummy.position.copy(p.pos); dummy.quaternion.set(p.pos.x, p.pos.y, p.pos.z, 1).normalize()
      dummy.scale.setScalar(0.25 + f * 1.2)
      dummy.updateMatrix()
      built.particleMesh.setMatrixAt(pn, dummy.matrix); pn++
    }
    built.particleMesh.count = pn
    built.particleMesh.instanceMatrix.needsUpdate = true

    // ----- HUD at ~10Hz + end-of-state -----
    hudAcc.current += delta
    if (hudAcc.current >= 0.1) { onSnapshot(game.snapshot()); hudAcc.current = 0 }
    if (!endedRef.current) {
      if (game.status === 'over') { endedRef.current = true; onGameOver(game) }
      else if (game.status === 'clear') { endedRef.current = true; onWaveClear(game) }
    }
  })

  return <primitive object={built.root} />
}

function placeEnemy(dummy: THREE.Object3D, e: Enemy) {
  dummy.position.copy(e.pos)
  dummy.scale.setScalar(1)
  if (e.kind === 'interceptor') {
    scratch.dir.copy(e.pos).normalize().multiplyScalar(R).sub(e.pos)
    if (scratch.dir.lengthSq() < 1e-6) scratch.dir.set(0, 0, 1)
    dummy.quaternion.setFromUnitVectors(Z_AXIS, scratch.dir.normalize())
  } else {
    scratch.n.copy(e.pos).normalize()
    dummy.quaternion.setFromUnitVectors(Y_AXIS, scratch.n)
  }
  dummy.updateMatrix()
}
