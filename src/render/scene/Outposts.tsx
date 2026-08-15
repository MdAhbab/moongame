import { useMemo } from 'react'
import * as THREE from 'three'
import { Geometries } from '../geometry/shapes.ts'
import { Materials } from '../materials/registry.ts'
import { OUTPOSTS } from '../../game/data/outposts.ts'
import { R } from '../../game/data/constants.ts'
import { registry } from '../disposal.ts'

export function Outposts() {
  const { shellMesh, dishMesh, beaconMesh } = useMemo(() => {
    const shellMat = Materials.outpostShell
    const beaconMat = Materials.beacon
    
    // Dish uses same shell material
    const shellInst = new THREE.InstancedMesh(Geometries.OutpostShell, shellMat, 8)
    const dishInst = new THREE.InstancedMesh(Geometries.OutpostDish, shellMat, 8)
    const beaconInst = new THREE.InstancedMesh(Geometries.OutpostBeacon, beaconMat, 8)
    
    shellInst.receiveShadow = true
    shellInst.castShadow = true
    dishInst.receiveShadow = true
    dishInst.castShadow = true

    // Beacon colors will be modified per-instance in the frame loop, 
    // but InstancedMesh per-instance color requires setting an array.
    // Instead of per-instance colors, we can set InstanceColor if needed.
    // V2 says beacon pulses. If we modify instance colors, we can do it via instanced color buffer.
    const colors = new Float32Array(8 * 3)
    const defaultColor = new THREE.Color(0x7fe8ff)
    for (let i = 0; i < 8; i++) {
      defaultColor.toArray(colors, i * 3)
    }
    beaconInst.instanceColor = new THREE.InstancedBufferAttribute(colors, 3)

    // Position them once
    const dummy = new THREE.Object3D()
    const up = new THREE.Vector3(0, 1, 0)
    
    OUTPOSTS.forEach((o, i) => {
      const dir = new THREE.Vector3(o.direction.x, o.direction.y, o.direction.z)
      
      dummy.position.copy(dir).multiplyScalar(R + 1)
      dummy.quaternion.setFromUnitVectors(up, dir)
      dummy.updateMatrix()

      shellInst.setMatrixAt(i, dummy.matrix)
      dishInst.setMatrixAt(i, dummy.matrix)
      beaconInst.setMatrixAt(i, dummy.matrix)
    })

    registry.track(shellInst)
    registry.track(dishInst)
    registry.track(beaconInst)

    return { shellMesh: shellInst, dishMesh: dishInst, beaconMesh: beaconInst }
  }, [])

  return (
    <group>
      <primitive object={shellMesh} />
      <primitive object={dishMesh} />
      <primitive object={beaconMesh} />
    </group>
  )
}
