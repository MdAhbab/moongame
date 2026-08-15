import { useMemo, forwardRef } from 'react'
import * as THREE from 'three'
import { Materials } from '../materials/registry.ts'
import { registry } from '../disposal.ts'
import { MAX_PARTICLES } from '../../game/data/constants.ts'

export interface ParticleRefs {
  mesh: THREE.InstancedMesh
}

export const ParticleInstances = forwardRef<ParticleRefs, object>((_, ref) => {
  const built = useMemo(() => {
    // Camera-facing quads
    const geo = new THREE.PlaneGeometry(1, 1)
    registry.track(geo)

    const mesh = new THREE.InstancedMesh(geo, Materials.particle, MAX_PARTICLES)
    mesh.count = 0
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.frustumCulled = false

    // We can also use instance colors since particles have different colors based on type
    const colorArray = new Float32Array(MAX_PARTICLES * 3)
    const colorAttr = new THREE.InstancedBufferAttribute(colorArray, 3)
    colorAttr.setUsage(THREE.DynamicDrawUsage)
    mesh.instanceColor = colorAttr

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
