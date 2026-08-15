import { useMemo, forwardRef } from 'react'
import * as THREE from 'three'
import { registry } from '../disposal.ts'

export interface DrainBeamRefs {
  mesh: THREE.InstancedMesh
}

export const DrainBeams = forwardRef<DrainBeamRefs, object>((_, ref) => {
  const built = useMemo(() => {
    // Max beams = 48 (max harvesters)
    const maxCount = 48

    // Cylinder origin at top or bottom is easier to stretch.
    // Default cylinder is centered. We can translate it so origin is at the bottom.
    const geo = new THREE.CylinderGeometry(0.3, 0.3, 1, 8)
    geo.translate(0, 0.5, 0) 
    registry.track(geo)

    const mat = new THREE.MeshBasicMaterial({
      color: 0xff8a3d,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
    registry.track(mat)

    const mesh = new THREE.InstancedMesh(geo, mat, maxCount)
    mesh.count = 0
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.frustumCulled = false
    registry.track(mesh)

    return { mesh }
  }, [])

  if (ref) {
    if (typeof ref === 'function') {
      ref(built)
    } else {
      ref.current = built
    }
  }

  return <primitive object={built.mesh} />
})
