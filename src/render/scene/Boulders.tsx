import { useMemo, useEffect } from 'react'
import * as THREE from 'three'
import { Random } from '../../game/core/Random.ts'
import { Materials } from '../materials/registry.ts'
import { R } from '../../game/data/constants.ts'
import { registry } from '../disposal.ts'

export function Boulders({ tier, seed }: { tier: 'High' | 'Medium' | 'Low'; seed: number }) {
  const mesh = useMemo(() => {
    const count = tier === 'Low' ? 80 : tier === 'Medium' ? 200 : 400
    // "1 InstancedMesh, 400 instances"
    const geo = new THREE.DodecahedronGeometry(1.5, 0)
    const mat = Materials.regolith

    const inst = new THREE.InstancedMesh(geo, mat, count)
    inst.castShadow = true
    inst.receiveShadow = true

    const rng = new Random(seed ^ 0xb01d)
    const dummy = new THREE.Object3D()
    const up = new THREE.Vector3(0, 1, 0)

    for (let i = 0; i < count; i++) {
      const theta = rng.range(0, Math.PI)
      const phi = rng.range(0, Math.PI * 2)
      
      const dir = new THREE.Vector3(
        Math.sin(theta) * Math.cos(phi),
        Math.cos(theta),
        Math.sin(theta) * Math.sin(phi)
      )
      
      // Sink slightly into ground, random scaling
      const scale = 0.5 + rng.next() * 1.5
      dummy.position.copy(dir).multiplyScalar(R - 0.5 * scale)
      dummy.quaternion.setFromUnitVectors(up, dir)
      
      // Random rotation around local Y
      dummy.rotateY(rng.range(0, Math.PI * 2))
      dummy.rotateX(rng.range(-0.3, 0.3))
      dummy.rotateZ(rng.range(-0.3, 0.3))
      
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      
      inst.setMatrixAt(i, dummy.matrix)
    }

    registry.track(geo)
    registry.track(inst)
    return inst
  }, [tier, seed])

  useEffect(() => {
    return () => {
      registry.release(mesh.geometry)
      registry.release(mesh)
    }
  }, [mesh])

  return <primitive object={mesh} />
}
