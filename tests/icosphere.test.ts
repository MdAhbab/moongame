import { describe, it, expect } from 'vitest'
import { createIcosphere } from '../src/render/geometry/icosphere'
import type * as THREE from 'three'

describe('Icosphere Geometry', () => {
  it('should generate exactly 81,920 triangles at subdivision level 6', () => {
    const radius = 100
    const detail = 6
    const geo = createIcosphere(radius, detail)

    // A buffer geometry without index uses 3 vertices per triangle.
    // The position attribute length will be (number of vertices) * 3
    // So number of triangles = (geo.attributes.position.count) / 3
    const numTriangles = (geo.attributes.position as THREE.BufferAttribute).count / 3
    
    expect(numTriangles).toBe(81920)
  })

  it('should generate 20 triangles at subdivision level 0', () => {
    const radius = 100
    const detail = 0
    const geo = createIcosphere(radius, detail)
    const numTriangles = (geo.attributes.position as THREE.BufferAttribute).count / 3
    expect(numTriangles).toBe(20)
  })

  it('should generate 80 triangles at subdivision level 1', () => {
    const radius = 100
    const detail = 1
    const geo = createIcosphere(radius, detail)
    const numTriangles = (geo.attributes.position as THREE.BufferAttribute).count / 3
    expect(numTriangles).toBe(80)
  })
})
