import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { at, requireIndex } from './arrays.ts'
import {
  ENEMY_MODEL_SLACK,
  RADIUS_CARRIER,
  RADIUS_HARVESTER,
  RADIUS_INTERCEPTOR,
  RADIUS_SAPPER,
  RADIUS_SENTINEL,
  RADIUS_WARDEN,
} from '../../game/data/constants.ts'
import { SENTINEL_SHIELD_HALF_ANGLE } from '../../game/data/enemies.ts'

/**
 * Merges parts into one geometry, normalising them first.
 *
 * `mergeGeometries` requires every input to agree on its attribute set and on
 * whether it is indexed, and it signals disagreement by returning **null**
 * rather than throwing. That null then reaches `new THREE.Mesh(null, …)`, which
 * fails deep inside `updateMorphTargets` with a message that names neither the
 * geometry nor the caller — so the symptom appears nowhere near the cause.
 *
 * Two mismatches actually occur here: three's cone and cylinder primitives are
 * non-indexed while a hand-built triangle with `setIndex` is indexed, and a
 * geometry from `setFromPoints` carries no `uv`. Normalising both, then
 * asserting the result, converts a silent null into a loud error at the line
 * that caused it.
 */
export function merge(parts: readonly THREE.BufferGeometry[], label: string): THREE.BufferGeometry {
  const normalised = parts.map((part) => {
    const geometry = part.getIndex() !== null ? part.toNonIndexed() : part
    if (geometry.getAttribute('normal') === undefined) geometry.computeVertexNormals()
    if (geometry.getAttribute('uv') === undefined) {
      const count = geometry.getAttribute('position').count
      geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2))
    }
    return geometry
  })

  const merged = mergeGeometries(normalised)
  if (merged === null) {
    throw new Error(`shapes: could not merge geometry "${label}" — incompatible attributes`)
  }
  return merged
}

/**
 * Merges a hull and a glow half into one geometry with two material groups.
 *
 * Group 0 is structure, group 1 is light. Splitting them is what stops a hostile
 * reading as a flat coloured blob: the previous single material carried a
 * near-black diffuse under a full-strength emissive, so almost none of the
 * pixel came from the lighting rig and the model had no visible form at all —
 * the shading that tells you a thing is solid was simply not being computed.
 * Two groups cost one extra draw call per archetype, six in total, against a
 * budget of 120.
 */
function shell(
  hull: readonly THREE.BufferGeometry[],
  glow: readonly THREE.BufferGeometry[],
  label: string,
): THREE.BufferGeometry {
  const merged = mergeGeometries([merge(hull, `${label}.hull`), merge(glow, `${label}.glow`)], true)
  if (merged === null) {
    throw new Error(`shapes: could not group geometry "${label}"`)
  }
  return merged
}

/**
 * Mirrors a geometry across X, fixing the winding as it goes.
 *
 * A negative scale reverses triangle winding, and WebGL culls by winding — not
 * by the normal attribute, which only affects shading. So a part mirrored with
 * `makeScale(-1, 1, 1)` alone simply vanishes under a `FrontSide` material,
 * and the failure looks like "the left wing did not get built" rather than
 * like a culling problem. Swapping the second and third vertex of every
 * triangle puts the winding back.
 *
 * Non-indexed only: `merge()` expands everything to non-indexed anyway, and
 * doing the swap on raw vertices means it survives that expansion.
 */
function mirrorX(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const mirrored = geometry.getIndex() !== null ? geometry.toNonIndexed() : geometry.clone()
  mirrored.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1))

  for (const name of Object.keys(mirrored.attributes)) {
    const attribute = mirrored.getAttribute(name) as THREE.BufferAttribute
    const array = attribute.array
    const stride = attribute.itemSize
    for (let vertex = 0; vertex < attribute.count; vertex += 3) {
      for (let component = 0; component < stride; component++) {
        const b = (vertex + 1) * stride + component
        const c = (vertex + 2) * stride + component
        const swap = at(array, b)
        array[b] = at(array, c)
        array[c] = swap
      }
    }
    attribute.needsUpdate = true
  }

  mirrored.computeVertexNormals()
  return mirrored
}

/**
 * A flat plate with an arbitrary planform, lying in the XZ plane.
 *
 * Wings built from boxes are the reason the old enemies read as crates with
 * corners. An extruded outline lets the leading edge sweep, which is what
 * separates a dart from a brick at the size these are actually seen.
 *
 * `points` are `[x, z]` in the plane of the plate; the result is solid, closed
 * and correctly wound, `thickness` thick and centred on Y.
 */
function plate(points: readonly (readonly [number, number])[], thickness: number): THREE.BufferGeometry {
  const outline = new THREE.Shape()
  const first = points[0]
  if (first === undefined) throw new Error('shapes: a plate needs at least one point')
  outline.moveTo(first[0], first[1])
  for (let i = 1; i < points.length; i++) {
    const point = points[i]
    if (point === undefined) continue
    outline.lineTo(point[0], point[1])
  }
  outline.closePath()

  const geometry = new THREE.ExtrudeGeometry(outline, { depth: thickness, bevelEnabled: false })
  geometry.translate(0, 0, -thickness / 2)
  // Shape-space is XY extruded along Z. Rotating brings the planform into XZ
  // with the thickness on Y, which is how every caller here thinks about it.
  geometry.rotateX(Math.PI / 2)
  return geometry
}

/* ------------------------------------------------------------------ */
/* Fitting a model to the hitbox it is shot at                         */
/* ------------------------------------------------------------------ */

/**
 * The furthest any vertex sits from the model's origin.
 *
 * Distance **from the origin**, not `boundingSphere.radius`, because the origin
 * is where the simulation puts the entity and where its collision sphere is
 * centred. A bounding sphere is centred on the geometry instead, so for
 * anything asymmetric the two disagree — and the whole point of measuring is to
 * compare against a collision radius.
 */
export function reachFromOrigin(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position')
  let maxSquared = 0
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    const squared = x * x + y * y + z * z
    if (squared > maxSquared) maxSquared = squared
  }
  return Math.sqrt(maxSquared)
}

/**
 * Scales a geometry about its origin until its furthest vertex sits at `reach`.
 *
 * This exists because the alternative — a hand-tuned scale next to a comment
 * saying "adjust as needed" — put the hostiles on screen between **8 and 18
 * times** larger than the spheres the collision system tests against. A player
 * aiming at a hull they could see fired through empty space, because the hull
 * they could see had no relationship to anything the simulation knew about.
 * Deriving the scale from the radius means the two cannot drift apart again.
 */
export function fitToReach(geometry: THREE.BufferGeometry, reach: number): THREE.BufferGeometry {
  const current = reachFromOrigin(geometry)
  if (current <= 1e-6) {
    throw new Error('shapes: cannot fit a degenerate geometry to a reach')
  }
  const factor = reach / current
  geometry.scale(factor, factor, factor)
  return geometry
}

/**
 * `fitToReach` for a loaded hierarchy, sizing it by setting the root's scale.
 *
 * A glTF arrives with its own units and its own nested node transforms, so the
 * only honest way to size it against a game constant is to measure what came
 * out of the loader. Vertices are pulled back through
 * `root.matrixWorld⁻¹ · mesh.matrixWorld`, which divides out the root's current
 * scale — so the result is the same however many times this is called.
 */
export function fitObjectToReach(root: THREE.Object3D, reach: number): void {
  root.updateMatrixWorld(true)

  const toRoot = new THREE.Matrix4()
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const vertex = new THREE.Vector3()
  let maxSquared = 0

  root.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
    toRoot.multiplyMatrices(inverse, mesh.matrixWorld)
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(toRoot)
      const squared = vertex.lengthSq()
      if (squared > maxSquared) maxSquared = squared
    }
  })

  const current = Math.sqrt(maxSquared)
  if (current <= 1e-6) {
    throw new Error('shapes: cannot fit an empty object to a reach')
  }
  root.scale.setScalar(reach / current)
}

export const Geometries = {
  get CraftHull(): THREE.BufferGeometry {
    const nose = new THREE.ConeGeometry(1.4, 12, 12)
    nose.rotateX(Math.PI / 2)
    nose.translate(0, 0, 4)

    const body = new THREE.CylinderGeometry(1.4, 1.0, 5, 12)
    body.rotateX(Math.PI / 2)
    body.translate(0, 0, -3.5)

    const wing = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 2),
      new THREE.Vector3(7, 0, -5),
      new THREE.Vector3(0.6, 0, -4),
    ])
    wing.setIndex([0, 1, 2])
    wing.computeVertexNormals()

    const wingL = wing.clone()
    const wingR = wing.clone()
    wingR.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1))

    // A negative scale mirrors the triangle, which reverses its winding, and
    // WebGL culls by winding — not by the normal attribute, which only affects
    // shading. With the default FrontSide material the mirrored wing would
    // simply vanish when viewed from above. Swapping two indices per triangle
    // restores the original orientation.
    //
    // Order matters here and is load-bearing: `merge()` below calls
    // `toNonIndexed()`, which expands vertices by walking the index in order.
    // Because the swap happens first, the reversed winding is baked into the
    // raw vertex layout and survives the conversion. Doing this after the merge
    // would be a no-op.
    const indices = requireIndex(wingR, 'CraftHull.wingR').array
    for (let i = 0; i < indices.length; i += 3) {
      const b = at(indices, i + 1)
      const c = at(indices, i + 2)
      ;(indices as Uint16Array | Uint32Array)[i + 1] = c
      ;(indices as Uint16Array | Uint32Array)[i + 2] = b
    }
    wingR.computeVertexNormals()

    return merge([nose, body, wingL, wingR], 'CraftHull')
  },

  get CraftTrim(): THREE.BufferGeometry {
    const tailGeo = new THREE.BoxGeometry(0.3, 3, 2.4)
    tailGeo.translate(0, 1.4, -3.4)

    const tailL = tailGeo.clone()
    tailL.applyMatrix4(new THREE.Matrix4().makeRotationZ(0.4))
    tailL.translate(0.8, 0, 0)

    const tailR = tailGeo.clone()
    tailR.applyMatrix4(new THREE.Matrix4().makeRotationZ(-0.4))
    tailR.translate(-0.8, 0, 0)

    const nozzle = new THREE.CylinderGeometry(1.1, 0.8, 1.6, 12)
    nozzle.rotateX(Math.PI / 2)
    nozzle.translate(0, 0, -6.2)

    return merge([tailL, tailR, nozzle], 'CraftTrim')
  },

  /**
   * Harvester — "squat hexagonal body, four legs" (§7.3).
   *
   * Local **+Y is up**, away from the moon's centre, because a Harvester's job
   * is to stand over an outpost and drain it downward. The drain snout points
   * at what it is stealing from, which is the one thing a player has to read
   * about this archetype from any angle.
   *
   * Six facets rather than a smooth drum: at 40 px in peripheral vision the
   * flat faces are what separate this from the Sentinel's slab, and §35.1 asks
   * for identification by silhouette before colour.
   */
  get Harvester(): THREE.BufferGeometry {
    const hull: THREE.BufferGeometry[] = []
    const glow: THREE.BufferGeometry[] = []

    const drum = new THREE.CylinderGeometry(3.1, 2.6, 2.0, 6)
    hull.push(drum)

    // Half a facet out of phase with the drum, so the two hexes read as a
    // stack of machined parts rather than one extruded lump.
    const flange = new THREE.CylinderGeometry(3.6, 3.6, 0.5, 6)
    flange.rotateY(Math.PI / 6)
    flange.translate(0, 1.1, 0)
    hull.push(flange)

    const snout = new THREE.CylinderGeometry(1.5, 0.85, 1.9, 6)
    snout.translate(0, -1.7, 0)
    hull.push(snout)

    // Four two-segment legs. A single box per leg is what made the old model
    // read as a table; a thigh angled out and a shin angled back in gives the
    // knee that says "this thing lands".
    for (let i = 0; i < 4; i++) {
      const bearing = (i / 4) * Math.PI * 2 + Math.PI / 4

      const thigh = new THREE.BoxGeometry(0.44, 2.4, 0.44)
      thigh.rotateZ(0.55)
      thigh.translate(2.3, -0.6, 0)

      const shin = new THREE.BoxGeometry(0.34, 2.3, 0.34)
      shin.rotateZ(-0.3)
      shin.translate(3.4, -2.5, 0)

      const foot = new THREE.CylinderGeometry(0.72, 0.5, 0.3, 6)
      foot.translate(3.1, -3.6, 0)

      for (const part of [thigh, shin, foot]) {
        part.rotateY(bearing)
        hull.push(part)
      }
    }

    const mouth = new THREE.CylinderGeometry(0.78, 0.78, 0.14, 6)
    mouth.translate(0, -2.62, 0)
    glow.push(mouth)

    for (let i = 0; i < 6; i++) {
      const lamp = new THREE.BoxGeometry(0.55, 0.2, 0.2)
      lamp.translate(3.45, 1.1, 0)
      lamp.rotateY((i / 6) * Math.PI * 2 + Math.PI / 6)
      glow.push(lamp)
    }

    return fitToReach(shell(hull, glow, 'Harvester'), RADIUS_HARVESTER * ENEMY_MODEL_SLACK)
  },

  /**
   * Interceptor — "narrow swept-back dart" (§7.3).
   *
   * Local **+Z is the nose**, and the render bridge points it along the
   * heading the simulation already stores. Three-sided fuselage sections give
   * hard chine lines down the body: a fast thing reads as fast because its
   * highlights move when it rolls, and a smooth tube has no highlights to move.
   */
  get Interceptor(): THREE.BufferGeometry {
    const hull: THREE.BufferGeometry[] = []
    const glow: THREE.BufferGeometry[] = []

    const nose = new THREE.ConeGeometry(0.9, 6.4, 3)
    nose.rotateX(Math.PI / 2)
    nose.rotateZ(Math.PI)
    nose.translate(0, 0, 1.6)
    hull.push(nose)

    const tail = new THREE.CylinderGeometry(0.9, 0.62, 2.4, 3)
    tail.rotateX(Math.PI / 2)
    tail.rotateZ(Math.PI)
    tail.translate(0, 0, -2.8)
    hull.push(tail)

    // Swept delta, leading edge raked back nearly 50°.
    const wing = plate(
      [
        [0.55, 1.3],
        [3.4, -2.5],
        [3.4, -3.3],
        [0.55, -2.4],
      ],
      0.26,
    )
    hull.push(wing, mirrorX(wing))

    // Canted tail fins, out of the wing plane so the silhouette stays busy from
    // directly above — the angle a player usually sees a hostile from.
    const fin = plate(
      [
        [0.3, -1.9],
        [1.5, -3.3],
        [1.5, -4.0],
        [0.3, -3.4],
      ],
      0.24,
    )
    fin.rotateZ(-1.05)
    fin.translate(0.35, 0, 0)
    hull.push(fin, mirrorX(fin))

    // Inset in the tail, not capping it. At the tail's own radius the exhaust
    // filled the whole rear silhouette, so an Interceptor bearing down on you
    // read as a light rather than as a machine with a light on it.
    const nozzle = new THREE.CylinderGeometry(0.3, 0.4, 0.5, 8)
    nozzle.rotateX(Math.PI / 2)
    nozzle.translate(0, 0, -3.95)
    glow.push(nozzle)

    const eye = new THREE.BoxGeometry(0.3, 0.16, 0.9)
    eye.translate(0, 0.3, 3.4)
    glow.push(eye)

    return fitToReach(shell(hull, glow, 'Interceptor'), RADIUS_INTERCEPTOR * ENEMY_MODEL_SLACK)
  },

  /**
   * Sentinel — "broad angular plate, front-facing shield" (§7.3).
   *
   * Local **+Y is up** and local **+Z is the shield normal**, which the render
   * bridge takes straight from `sentinelShieldNormal` rather than rebuilding.
   *
   * The shield is seven panels spread across exactly `±SENTINEL_SHIELD_HALF_
   * ANGLE`, with a lit post at each end. That is not decoration: the arc is the
   * archetype's entire design — a Sentinel converts a time problem into a
   * positioning one — and until now nothing on screen showed where the blocked
   * cone stopped. A player was expected to deduce a 144° arc from shots
   * disappearing. Now the geometry *is* the arc, so flanking past the lit post
   * is a thing you can see rather than a thing you have to be told.
   */
  get Sentinel(): THREE.BufferGeometry {
    const hull: THREE.BufferGeometry[] = []
    const glow: THREE.BufferGeometry[] = []

    const hub = new THREE.CylinderGeometry(1.7, 2.1, 2.6, 8)
    hull.push(hub)

    const wing = plate(
      [
        [1.5, 1.9],
        [4.7, 1.0],
        [4.7, -1.0],
        [1.5, -1.9],
      ],
      0.95,
    )
    hull.push(wing, mirrorX(wing))

    const PANELS = 7
    for (let i = 0; i < PANELS; i++) {
      const across = (i + 0.5) / PANELS - 0.5
      const panel = new THREE.BoxGeometry(0.95, 3.4, 0.34)
      panel.translate(0, 0, 3.3)
      panel.rotateY(across * 2 * SENTINEL_SHIELD_HALF_ANGLE)
      hull.push(panel)
    }

    const barrel = new THREE.CylinderGeometry(0.26, 0.3, 2.6, 6)
    barrel.rotateX(Math.PI / 2)
    barrel.translate(1.45, -0.5, 1.7)
    hull.push(barrel, mirrorX(barrel))

    for (const side of [-1, 1]) {
      const post = new THREE.BoxGeometry(0.26, 3.9, 0.26)
      post.translate(0, 0, 3.36)
      post.rotateY(side * SENTINEL_SHIELD_HALF_ANGLE)
      glow.push(post)
    }

    const eye = new THREE.SphereGeometry(0.6, 10, 8)
    eye.translate(0, 0.55, 1.5)
    glow.push(eye)

    return fitToReach(shell(hull, glow, 'Sentinel'), RADIUS_SENTINEL * ENEMY_MODEL_SLACK)
  },

  /**
   * Sapper — "small forward-swept wedge, no cockpit" (§7.3).
   *
   * Local **+Z is the nose**, like the Interceptor. Everything about the shape
   * is an argument against confusing the two at a glance, because confusing them
   * is expensive: an Interceptor is a fight you can decline and a Sapper is a
   * deadline you cannot.
   *
   * So the sweep is *forward* rather than back — the wings rake toward the nose,
   * which no other hostile does and which the eye reads as a wedge driving into
   * something. There is no fuselage behind the wing and no tail at all, so the
   * silhouette ends where the wing ends. And it is tiny: at `RADIUS_SAPPER` it
   * is 17% smaller than an Interceptor, the smallest thing in the sky.
   */
  get Sapper(): THREE.BufferGeometry {
    const hull: THREE.BufferGeometry[] = []
    const glow: THREE.BufferGeometry[] = []

    // A four-sided spike: hard chines, no round surfaces anywhere on it.
    const spike = new THREE.ConeGeometry(0.85, 4.4, 4)
    spike.rotateX(Math.PI / 2)
    spike.rotateZ(Math.PI / 4)
    spike.translate(0, 0, 0.9)
    hull.push(spike)

    // Forward sweep: the leading edge rakes *toward* the nose. The Interceptor's
    // does the opposite, and that one inversion is the whole read.
    const wing = plate(
      [
        [0.4, -1.6],
        [2.9, 1.5],
        [2.9, 0.7],
        [0.4, -2.3],
      ],
      0.22,
    )
    hull.push(wing, mirrorX(wing))

    const collar = new THREE.CylinderGeometry(0.62, 0.62, 0.5, 4)
    collar.rotateX(Math.PI / 2)
    collar.rotateZ(Math.PI / 4)
    collar.translate(0, 0, -1.5)
    hull.push(collar)

    // The warhead, lit and sitting proud at the tip. This is the arming flare's
    // anchor — the render bridge drives the instance colour from the phase, and
    // this is the part of the model that has to catch it.
    const warhead = new THREE.SphereGeometry(0.5, 10, 8)
    warhead.translate(0, 0, 2.3)
    glow.push(warhead)

    const nozzle = new THREE.CylinderGeometry(0.34, 0.42, 0.4, 8)
    nozzle.rotateX(Math.PI / 2)
    nozzle.translate(0, 0, -1.85)
    glow.push(nozzle)

    return fitToReach(shell(hull, glow, 'Sapper'), RADIUS_SAPPER * ENEMY_MODEL_SLACK)
  },

  /**
   * Warden — "three-armed ring on a slim column" (§7.3).
   *
   * Local **+Y is up**, away from the moon's centre.
   *
   * Radial symmetry, and that is the message. A Sentinel is emphatically
   * *directional* — a broad plate with a front and a back, which is how a player
   * knows to fly around it. A Warden has no front. Three identical arms at 120°
   * on a torus say "this thing works the same from every angle", which is
   * exactly the rule its field obeys, so the silhouette teaches the counter
   * before the player has been told it: flanking is not the answer here.
   *
   * The emitter head on each arm is lit, so the three points of the field are
   * visible against the shell `EnemyInstances` draws around it.
   */
  get Warden(): THREE.BufferGeometry {
    const hull: THREE.BufferGeometry[] = []
    const glow: THREE.BufferGeometry[] = []

    const column = new THREE.CylinderGeometry(0.75, 1.05, 4.6, 6)
    hull.push(column)

    const ring = new THREE.TorusGeometry(2.7, 0.32, 6, 18)
    ring.rotateX(Math.PI / 2)
    hull.push(ring)

    const cap = new THREE.ConeGeometry(1.15, 1.5, 6)
    cap.translate(0, 2.8, 0)
    hull.push(cap)

    for (let i = 0; i < 3; i++) {
      const bearing = (i / 3) * Math.PI * 2

      const arm = new THREE.BoxGeometry(0.42, 0.42, 2.4)
      arm.translate(0, 0.2, 3.6)
      arm.rotateY(bearing)
      hull.push(arm)

      const emitter = new THREE.OctahedronGeometry(0.62, 0)
      emitter.translate(0, 0.2, 4.7)
      emitter.rotateY(bearing)
      glow.push(emitter)
    }

    const collar = new THREE.CylinderGeometry(1.35, 1.35, 0.4, 6)
    collar.translate(0, -1.1, 0)
    hull.push(collar)

    return fitToReach(shell(hull, glow, 'Warden'), RADIUS_WARDEN * ENEMY_MODEL_SLACK)
  },

  /**
   * Carrier — "broad slab hull with an open launch bay underneath" (§7.3).
   *
   * Local **+Y is up**, so the bay faces the moon it is seeding.
   *
   * The largest silhouette in the game, and the only one with a *hole* in it.
   * That opening is doing real work: a player who has learned what a Carrier
   * does needs to identify one from further away than anything else on screen,
   * because the decision it poses — pay the seconds now or pay them every trip
   * afterwards — has to be made early to be worth making at all. A gap in a slab
   * survives being small on screen better than any amount of surface detail.
   *
   * Built as four rails around the void rather than as a box with a recess: at
   * this size a recess reads as a dark patch of paint, and a genuine opening
   * shows the sky through it as the Carrier yaws.
   */
  get Carrier(): THREE.BufferGeometry {
    const hull: THREE.BufferGeometry[] = []
    const glow: THREE.BufferGeometry[] = []

    // The slab, as four rails around an open bay.
    for (const [dx, dz, sx, sz] of [
      [0, 3.5, 8.4, 1.4],
      [0, -3.5, 8.4, 1.4],
      [3.5, 0, 1.4, 5.6],
      [-3.5, 0, 1.4, 5.6],
    ] as const) {
      const rail = new THREE.BoxGeometry(sx, 1.6, sz)
      rail.translate(dx, 0, dz)
      hull.push(rail)
    }

    // Spine over the top, so the hull has a readable "up" from a distance.
    const spine = new THREE.BoxGeometry(2.2, 1.5, 7.2)
    spine.translate(0, 1.3, 0)
    hull.push(spine)

    const bridge = new THREE.CylinderGeometry(1.05, 1.35, 1.4, 6)
    bridge.translate(0, 2.4, -1.6)
    hull.push(bridge)

    // Four engine pods, outboard and low, giving the corners a shape.
    for (const side of [-1, 1] as const) {
      for (const front of [-1, 1] as const) {
        const pod = new THREE.CylinderGeometry(0.72, 0.9, 2.2, 8)
        pod.rotateX(Math.PI / 2)
        pod.translate(side * 4.2, -0.5, front * 2.6)
        hull.push(pod)

        const flame = new THREE.CylinderGeometry(0.5, 0.34, 0.4, 8)
        flame.rotateX(Math.PI / 2)
        flame.translate(side * 4.2, -0.5, front * 3.75)
        glow.push(flame)
      }
    }

    // The bay itself: a lit rectangle on the underside, so a Carrier overhead is
    // identifiable from directly below — which is where a player fighting the
    // Harvesters it launched will be looking from.
    const bay = new THREE.BoxGeometry(5.4, 0.16, 4.4)
    bay.translate(0, -0.85, 0)
    glow.push(bay)

    return fitToReach(shell(hull, glow, 'Carrier'), RADIUS_CARRIER * ENEMY_MODEL_SLACK)
  },

  get OutpostShell(): THREE.BufferGeometry {
    const dome = new THREE.IcosahedronGeometry(3.4, 1)
    dome.scale(1, 0.7, 1)
    dome.translate(0, 0.4, 0)

    const corridor = new THREE.CylinderGeometry(0.8, 0.8, 5, 8)
    corridor.rotateZ(Math.PI / 2)
    corridor.translate(3.5, 0.6, 0)

    const pod = new THREE.IcosahedronGeometry(1.6, 1)
    pod.translate(6, 0.6, 0)

    return merge([dome, corridor, pod], 'OutpostShell')
  },

  get OutpostDish(): THREE.BufferGeometry {
    const dish = new THREE.SphereGeometry(1.8, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)
    dish.rotateX(-0.7)
    dish.translate(-2.5, 2, 1.5)
    return dish
  },

  get OutpostBeacon(): THREE.BufferGeometry {
    const beacon = new THREE.CylinderGeometry(0.4, 0.4, 5, 8)
    beacon.translate(0, 4, 0)
    return beacon
  }
}
