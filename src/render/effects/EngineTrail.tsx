import { useMemo, forwardRef } from 'react'
import * as THREE from 'three'
import { registry } from '../disposal.ts'

/**
 * The ribbon is parameterised by **distance, not time**, and the length is
 * bounded by where the camera is.
 *
 * The first version sampled once per frame: 48 samples at 60 fps is 0.8 s, and
 * at cruise (44.7 u/s) that is a 36-unit streak. The chase camera sits 22 units
 * behind the craft, so the trail ran fourteen units *past the camera* and
 * rendered as an enormous translucent column filling the middle of the screen.
 * It also changed length with the frame rate, which is the exact class of bug
 * Rule 5 exists to prevent — just in the render layer rather than the
 * simulation.
 *
 * 24 segments at 0.55 u apart is a 13-unit ribbon: comfortably inside the
 * camera distance at every speed, and identical at 30 fps and 144 fps.
 */
const SEGMENTS = 24
const SEGMENT_SPACING = 0.55

export interface EngineTrailRefs {
  /** Called once per frame with the craft's current position and basis. */
  push(x: number, y: number, z: number, rightX: number, rightY: number, rightZ: number, width: number, intensity: number): void
  reset(): void
  object: THREE.Object3D
}

/**
 * The exhaust ribbon behind the craft (gameplan §16.3).
 *
 * A trail is the cheapest way to make speed legible on a sphere. Without one
 * there is very little parallax reference out here — the regolith is far below,
 * the stars are at infinity, and at cruise the craft can look almost stationary
 * against both. The ribbon gives the eye something attached to the craft that
 * visibly *lags* it, so turning reads as turning and boosting reads as
 * accelerating.
 *
 * Built as a single pre-allocated `BufferGeometry` whose vertex positions are
 * rewritten in place each frame. The alternative — a `Line` rebuilt from a
 * growing array, or one mesh per puff — would allocate every frame in the one
 * callback that §17.4 requires to allocate nothing.
 *
 * The history is a ring buffer, but the geometry is *not* drawn in ring order:
 * a ribbon has to be a strip from oldest to newest or it folds back on itself.
 * So the write index advances around the ring and the rebuild walks it from
 * `head + 1`, which is the oldest sample.
 */
export const EngineTrail = forwardRef<EngineTrailRefs, object>((_, ref) => {
  const built = useMemo(() => {
    // Two vertices per segment — one either side of the craft's centreline.
    const positions = new Float32Array(SEGMENTS * 2 * 3)
    const alphas = new Float32Array(SEGMENTS * 2)

    const geometry = new THREE.BufferGeometry()
    // Held as locals as well as on the geometry: `geometry.attributes` is typed
    // as a loose record, so reading back through it costs an undefined check
    // per frame for a lookup whose answer cannot change.
    const positionAttribute = new THREE.BufferAttribute(positions, 3)
    const alphaAttribute = new THREE.BufferAttribute(alphas, 1)
    geometry.setAttribute('position', positionAttribute)
    geometry.setAttribute('aAlpha', alphaAttribute)

    // A triangle strip as indexed triangles: quad i spans vertices
    // (2i, 2i+1, 2i+2, 2i+3).
    const indices = new Uint16Array((SEGMENTS - 1) * 6)
    for (let i = 0; i < SEGMENTS - 1; i++) {
      const v = i * 2
      const o = i * 6
      indices[o] = v
      indices[o + 1] = v + 1
      indices[o + 2] = v + 2
      indices[o + 3] = v + 1
      indices[o + 4] = v + 3
      indices[o + 5] = v + 2
    }
    geometry.setIndex(new THREE.BufferAttribute(indices, 1))
    registry.track(geometry)

    // Additive and unlit: this is emitted plasma, not a surface. `onBeforeCompile`
    // rather than a ShaderMaterial so the fade rides on a stock material and
    // keeps working if the material is ever swapped for a lit one.
    const material = new THREE.MeshBasicMaterial({
      color: 0x7fe8ff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aAlpha;\nvarying float vAlpha;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
        .replace(
          '#include <opaque_fragment>',
          'gl_FragColor = vec4( outgoingLight, diffuseColor.a * vAlpha );',
        )
    }
    registry.track(material)

    const mesh = new THREE.Mesh(geometry, material)
    // The ribbon is written in world space, so the mesh itself must never carry
    // a transform — and it must never be culled, because its bounding sphere is
    // computed once from an empty buffer.
    mesh.frustumCulled = false
    mesh.renderOrder = 2

    /* ---- history ring ---- */
    const historyX = new Float32Array(SEGMENTS)
    const historyY = new Float32Array(SEGMENTS)
    const historyZ = new Float32Array(SEGMENTS)
    const historyRx = new Float32Array(SEGMENTS)
    const historyRy = new Float32Array(SEGMENTS)
    const historyRz = new Float32Array(SEGMENTS)
    const historyW = new Float32Array(SEGMENTS)
    let head = 0
    let filled = 0
    let intensity = 0

    const refs: EngineTrailRefs = {
      object: mesh,

      reset(): void {
        head = 0
        filled = 0
        mesh.visible = false
      },

      push(x, y, z, rx, ry, rz, width, nextIntensity): void {
        // Commit a new sample only once the craft has actually travelled far
        // enough; otherwise just drag the newest one along with it. That keeps
        // the ribbon's *shape* tied to the flight path and its *length* fixed,
        // independent of how often this is called.
        const dx = x - (historyX[head] ?? x)
        const dy = y - (historyY[head] ?? y)
        const dz = z - (historyZ[head] ?? z)
        const moved = Math.sqrt(dx * dx + dy * dy + dz * dz)

        if (filled === 0 || moved >= SEGMENT_SPACING) {
          head = (head + 1) % SEGMENTS
          if (filled < SEGMENTS) filled++
        }

        historyX[head] = x
        historyY[head] = y
        historyZ[head] = z
        historyRx[head] = rx
        historyRy[head] = ry
        historyRz[head] = rz
        historyW[head] = width
        intensity = nextIntensity

        // Below three samples there is no strip to draw yet.
        if (filled < 3) {
          mesh.visible = false
          return
        }
        mesh.visible = true

        // Walk oldest → newest. `age` 0 is the tail, 1 is the craft.
        for (let i = 0; i < SEGMENTS; i++) {
          const slot = (head + 1 + i) % SEGMENTS
          const age = i / (SEGMENTS - 1)

          // Samples that have not been written yet collapse onto the oldest
          // real one, so a partly-filled ring degenerates instead of streaking
          // back to the origin.
          const valid = i >= SEGMENTS - filled
          const source = valid ? slot : (head + 1 + (SEGMENTS - filled)) % SEGMENTS

          const px = historyX[source] ?? 0
          const py = historyY[source] ?? 0
          const pz = historyZ[source] ?? 0
          // Narrow at the nozzle, widest a third of the way back, tapering out
          // — a plume dispersing, rather than a slab hinged to the tail. `age`
          // is 0 at the oldest sample and 1 at the craft.
          const spread = Math.sin(Math.PI * Math.min(1, (1 - age) * 1.6)) * 0.7 + age * 0.3
          const halfWidth = ((historyW[source] ?? 0) * spread) / 2

          const o = i * 6
          positions[o] = px + (historyRx[source] ?? 0) * halfWidth
          positions[o + 1] = py + (historyRy[source] ?? 0) * halfWidth
          positions[o + 2] = pz + (historyRz[source] ?? 0) * halfWidth
          positions[o + 3] = px - (historyRx[source] ?? 0) * halfWidth
          positions[o + 4] = py - (historyRy[source] ?? 0) * halfWidth
          positions[o + 5] = pz - (historyRz[source] ?? 0) * halfWidth

          // Quadratic rather than linear: a linear fade reads as a hard-edged
          // stick, because perceived brightness is not linear in alpha.
          //
          // The `1 - 0.55 * age` term pulls the brightest point back off the
          // nozzle. Peaking at the craft looked right in isolation and wrong in
          // play — additive blending put the plume's hottest pixels exactly
          // where the hull silhouette is, and the ship the player is flying
          // disappeared inside its own exhaust.
          const alpha = age * age * (1 - 0.55 * age) * intensity * 1.9
          alphas[i * 2] = alpha
          alphas[i * 2 + 1] = alpha
        }

        positionAttribute.needsUpdate = true
        alphaAttribute.needsUpdate = true
      },
    }

    mesh.visible = false
    return refs
  }, [])

  if (ref) {
    if (typeof ref === 'function') ref(built)
    else ref.current = built
  }

  return <primitive object={built.object} />
})
