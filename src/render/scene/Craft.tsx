import { useMemo, forwardRef } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { Materials } from '../materials/registry.ts'
import { registry } from '../disposal.ts'
import { CRAFT_MODEL_REACH, CRAFT_MODEL_SCALE } from '../../game/data/constants.ts'
import { fitObjectToReach } from '../geometry/shapes.ts'

export interface CraftRefs {
  root: THREE.Group
  /** The plume group — core and shroud, scaled together by throttle. */
  exhaust: THREE.Group
  muzzle: THREE.Mesh
}

export const Craft = forwardRef<CraftRefs, object>((_, ref) => {
  const gltf = useGLTF('/models/craft.glb')

  const built = useMemo(() => {
    const root = new THREE.Group()
    root.scale.setScalar(CRAFT_MODEL_SCALE)

    const hullGroup = gltf.scene.clone(true)
    hullGroup.traverse((child: THREE.Object3D) => {
      const mesh = child as THREE.Mesh
      if (mesh.isMesh) {
        // We clone the geometry so disposing it doesn't break the useGLTF cache
        mesh.geometry = mesh.geometry.clone()
        registry.track(mesh.geometry)
        // We use our own material instead of the model's
        mesh.material = Materials.craftHull
        mesh.castShadow = true
      }
    })

    // Sized from `CRAFT_MODEL_REACH`, not by hand.
    //
    // What stood here was `setScalar(6)` under the comment "Adjust as needed
    // since Kenney models are usually small" — a guess about an asset, in local
    // units, with nothing tying it to `RADIUS_CRAFT`. It landed the nose about
    // 1.6 u from the centre, inside a 1.9 u hitbox, so the craft was slightly
    // *smaller* than the sphere things collided with; the muzzle and exhaust
    // offsets below, written for the 10 u hull this replaced, sat in mid-air.
    // Deriving the factor puts all four back in agreement.
    fitObjectToReach(hullGroup, CRAFT_MODEL_REACH / CRAFT_MODEL_SCALE)
    root.add(hullGroup)

    // The plume. Two nested cones — a tight white core inside a wider, softer
    // shroud — because a single flat cone is the single strongest "toy" cue in
    // the whole frame: real exhaust has a hot centre and a diffuse edge, and the
    // eye reads the gradient long before it reads the shape.
    const exhaust = new THREE.Group()

    const coreGeo = new THREE.ConeGeometry(0.34, 1.8, 12, 1, true)
    registry.track(coreGeo)
    const core = new THREE.Mesh(coreGeo, Materials.muzzle)
    core.rotation.x = -Math.PI / 2
    core.position.z = -0.8
    exhaust.add(core)

    const shroudGeo = new THREE.ConeGeometry(0.62, 3.0, 12, 1, true)
    registry.track(shroudGeo)
    const shroud = new THREE.Mesh(shroudGeo, Materials.exhaust)
    shroud.rotation.x = -Math.PI / 2
    shroud.position.z = -1.4
    exhaust.add(shroud)

    exhaust.position.z = -8
    root.add(exhaust)

    // Engine bell, so the plume comes *out* of something rather than out of the
    // air behind the hull.
    const bellGeo = new THREE.CylinderGeometry(0.8, 1.0, 1.2, 12, 1, true)
    registry.track(bellGeo)
    const bell = new THREE.Mesh(bellGeo, Materials.craftTrim)
    bell.rotation.x = Math.PI / 2
    bell.position.z = -7.4
    root.add(bell)

    // Wingtip navigation lights. Tiny, and they do a disproportionate amount of
    // work: two fixed points of colour on a moving silhouette are what let the
    // eye read the craft's roll instantly, which matters on a sphere where the
    // horizon is never level for long.
    for (const side of [-1, 1]) {
      const navGeo = new THREE.SphereGeometry(0.34, 8, 6)
      registry.track(navGeo)
      const nav = new THREE.Mesh(navGeo, side < 0 ? Materials.enemyGlow : Materials.exhaust)
      nav.position.set(side * 6.4, 0.2, -1.2)
      root.add(nav)
    }

    const muzzleGeo = new THREE.SphereGeometry(1.3, 10, 10)
    registry.track(muzzleGeo)
    const muzzle = new THREE.Mesh(muzzleGeo, Materials.muzzle)
    muzzle.position.z = 10
    muzzle.visible = false
    root.add(muzzle)

    // Craft specific spotlight attached to the craft
    const spot = new THREE.SpotLight(0xdff2ff, 1.2, 340, 0.62, 0.5, 1)
    spot.position.set(0, 1, 2)
    spot.target.position.set(0, -0.4, 24)
    root.add(spot, spot.target)
    registry.track(spot)

    // Fill light, behind and above the hull — the side the chase camera sees.
    //
    // The key light is the sun, fixed in world space, and the camera sits
    // *behind* the craft. So for most of a run the player is looking at the
    // craft's unlit side and the hull reads as a dark silhouette no matter what
    // colour the livery is. That is not a look, it is a lighting rig that
    // forgot where the camera was. Attached to the craft so it tracks the one
    // surface that always needs to be legible, and cool and dim enough to read
    // as bounce off the regolith rather than as a second sun.
    //
    // Local coordinates: the root is scaled 0.25, so (0, 9, −26) here is about
    // 2.2 u above and 6.5 u behind the hull in world units.
    const fill = new THREE.PointLight(0xbfd8ff, 46, 70, 2)
    fill.position.set(0, 9, -26)
    root.add(fill)
    registry.track(fill)

    return { root, exhaust, muzzle }
  }, [gltf.scene])

  if (ref) {
    if (typeof ref === 'function') {
      ref(built)
    } else {
      ref.current = built
    }
  }

  return <primitive object={built.root} />
})
