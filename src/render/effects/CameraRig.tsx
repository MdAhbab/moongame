/**
 * The chase camera (gameplan §24).
 *
 * ## Every number here used to be a literal
 *
 * `constants.ts` opens with "a magic number anywhere under `src/game/` is a
 * bug", and then seven of its camera values — `CAM_BACK`, `CAM_UP`,
 * `CAM_OMEGA`, `CAM_LOOKAHEAD`, `FOV_REST`, `FOV_BOOST`, `CAM_ROLL_FRACTION` —
 * were read by nothing at all, because this file hardcoded `-22`, `7`, `6`,
 * `0.15`, `62`, `74` and `0.4` instead. Tuning the camera by editing the
 * constants file did nothing, silently, and one such retune shipped.
 *
 * That is the worst shape a constant can take: not wrong, but *disconnected*, so
 * the file that claims to own game feel does not.
 *
 * ## Why this is a class and not a component
 *
 * §17.2 allows exactly one `useFrame` in the entire render tree, and it lives in
 * `RenderBridge`. A camera that wanted its own would be a second clock. So the
 * rig is a plain object the bridge drives, and `CameraRig` is only the mount-time
 * setup.
 *
 * ## Allocation
 *
 * `update` runs every frame and allocates nothing: every vector is a field,
 * reused. @hot-path
 */
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useEffect } from 'react'

import {
  CAM_BACK,
  CAM_FOV_OMEGA,
  CAM_LATERAL_LAG,
  CAM_LOOKAHEAD,
  CAM_OMEGA,
  CAM_ROLL_FRACTION,
  CAM_UP,
  FOV_BOOST,
  FOV_REST,
  TRAUMA_MAX_OFFSET,
} from '../../game/data/constants.ts'

/** How far below the craft the camera aims, so the horizon sits high in frame. */
const LOOK_DROP = 1

/**
 * Squared distance above which a craft movement is a teleport, not flight.
 *
 * Matches `TRAIL_BREAK_SQ` in `RenderBridge` deliberately — the trail and the
 * camera are answering the same question about the same jump, and having them
 * disagree would mean one of them was wrong.
 */
const TELEPORT_SQ = 12 * 12

export class CameraRigController {
  private readonly camera: THREE.PerspectiveCamera

  /* Pre-allocated scratch. Nothing in `update` calls `new`. */
  private readonly position = new THREE.Vector3()
  private readonly desired = new THREE.Vector3()
  private readonly lookTarget = new THREE.Vector3()
  private readonly forward = new THREE.Vector3()
  private readonly up = new THREE.Vector3()
  private readonly right = new THREE.Vector3()

  /**
   * Last frame's craft position, for teleport detection.
   *
   * The craft does not only fly — it jumps. It jumps when a run starts (out of
   * the menu's attract loop), and it jumps when it respawns four seconds after
   * being destroyed, to an outpost that can be on the far side of the sphere.
   * A critically damped spring cannot tell a jump from very fast movement, so it
   * swept the camera through the moon for a second or more, which is a strange
   * and alarming thing to watch immediately after dying.
   *
   * `null` until the first update, so the camera does not smooth in from
   * wherever the default camera happened to be pointing.
   */
  private lastCraftPos: THREE.Vector3 | null = null
  private readonly craftNow = new THREE.Vector3()

  constructor(camera: THREE.Camera) {
    this.camera = camera as THREE.PerspectiveCamera
  }

  /** @hot-path */
  update(
    dt: number,
    craftPos: { x: number; y: number; z: number },
    craftForward: { x: number; y: number; z: number },
    craftUp: { x: number; y: number; z: number },
    craftVelocity: { x: number; y: number; z: number },
    craftBank: number,
    craftTrauma: number,
    craftSlip: number,
    boosting: boolean,
    reducedMotion: boolean,
  ): void {
    this.forward.set(craftForward.x, craftForward.y, craftForward.z)
    this.up.set(craftUp.x, craftUp.y, craftUp.z)
    this.right.crossVectors(this.forward, this.up).normalize()

    // 1. Where the camera wants to be: behind and above, in craft-local space.
    this.desired
      .set(craftPos.x, craftPos.y, craftPos.z)
      .addScaledVector(this.forward, -CAM_BACK)
      .addScaledVector(this.up, CAM_UP)

    // A lateral slide is invisible without this.
    //
    // The rig is anchored to the craft, so during a strafe the craft and the
    // camera translate together and *nothing in frame changes* — the player
    // presses a key, the physics respond exactly as intended, and the screen
    // looks identical. Holding the camera back from the slide lets the craft
    // move within the frame, which is the entire visual cue that translation is
    // happening at all.
    this.desired.addScaledVector(this.right, -craftSlip * CAM_BACK * CAM_LATERAL_LAG)

    // 2. Critically damped spring, in the exact framerate-independent form
    //    (§21.4, Rule 5). `lerp` by a raw factor would make the camera stiffer
    //    on a 144 Hz display than on a 60 Hz one.
    //
    //    Unless the craft teleported, in which case there is nothing to smooth:
    //    snap, and let the cut do the work a two-second sweep across the moon
    //    was doing badly. The threshold is far above anything flight produces —
    //    boost tops out at ~36.8 u/s and the frame delta is clamped to 100 ms,
    //    so a real frame never moves the craft more than ~3.7 u.
    this.craftNow.set(craftPos.x, craftPos.y, craftPos.z)
    const teleported =
      this.lastCraftPos === null ||
      this.lastCraftPos.distanceToSquared(this.craftNow) > TELEPORT_SQ
    this.lastCraftPos ??= new THREE.Vector3()
    this.lastCraftPos.copy(this.craftNow)

    if (teleported) {
      this.position.copy(this.desired)
    } else {
      this.position.copy(this.camera.position)
      this.position.lerp(this.desired, 1 - Math.exp(-CAM_OMEGA * dt))
    }

    // 3. The aim point leads the craft by v·t, so fast flight looks ahead of
    //    itself rather than at itself (§24.2).
    this.lookTarget
      .set(craftPos.x, craftPos.y, craftPos.z)
      .addScaledVector(
        this.desired.set(craftVelocity.x, craftVelocity.y, craftVelocity.z),
        CAM_LOOKAHEAD,
      )
      .addScaledVector(this.up, -LOOK_DROP)

    // 4. Speed FOV. Exact exponential again, not a per-frame fraction.
    const targetFov = boosting ? FOV_BOOST : FOV_REST
    this.camera.fov = targetFov + (this.camera.fov - targetFov) * Math.exp(-CAM_FOV_OMEGA * dt)
    this.camera.updateProjectionMatrix()

    // 5. Trauma shake — squared, so light hits barely register and heavy ones
    //    are dramatic (§24.3). Suppressed entirely under reduced motion.
    this.camera.position.copy(this.position)
    if (craftTrauma > 0 && !reducedMotion) {
      const shake = craftTrauma * craftTrauma * TRAUMA_MAX_OFFSET
      const t = performance.now() * 0.05
      this.camera.position.x += shake * Math.sin(t) * Math.cos(t * 1.3)
      this.camera.position.y += shake * Math.sin(t * 1.1) * Math.cos(t * 0.8)
      this.camera.position.z += shake * Math.sin(t * 0.7) * Math.cos(t * 1.5)
    }

    this.camera.up.copy(this.up)
    this.camera.lookAt(this.lookTarget)
    // Roll follows the craft's bank at a fraction — matching it exactly would
    // make the horizon pivot as hard as the craft and read as nausea rather
    // than as a turn.
    this.camera.rotateZ(craftBank * CAM_ROLL_FRACTION)
  }
}

/** Mount-time setup only. The per-frame work is driven by `RenderBridge`. */
export function CameraRig() {
  const { camera } = useThree()

  useEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera
    perspective.fov = FOV_REST
    perspective.updateProjectionMatrix()
  }, [camera])

  return null
}
