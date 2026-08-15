import * as THREE from 'three'

/**
 * Creates an icosphere geometry by recursively subdividing an icosahedron.
 * Warning: subdivision level 6 produces exactly 81,920 triangles (20 * 4^6).
 * 
 * @param radius The radius of the sphere.
 * @param detail The subdivision level (0 = icosahedron, 1 = 80 faces, 6 = 81920 faces).
 * @returns A BufferGeometry containing the vertices, normals, and UVs.
 */
/**
 * Reads one component, checking the index is in range.
 *
 * Rule 7 permits a non-null assertion only immediately after an explicit check;
 * this is that check, factored out. Under `noUncheckedIndexedAccess` every read
 * from a `number[]` widens to `number | undefined`, and suppressing that with
 * `!` at nineteen call sites would turn a genuine out-of-range index — the
 * classic subdivision bug, where a face references a midpoint that was never
 * pushed — into a silent NaN that propagates into the vertex buffer and shows
 * up as a hole in the moon.
 *
 * This runs once at startup while baking geometry, never per frame, so the
 * bounds check costs nothing that matters.
 */
function at(array: readonly number[] | Float32Array, index: number): number {
  const value = array[index]
  if (value === undefined) {
    throw new RangeError(`icosphere: index ${index} out of range (length ${array.length})`)
  }
  return value
}

export function createIcosphere(radius: number, detail: number): THREE.BufferGeometry {
  const t = (1.0 + Math.sqrt(5.0)) / 2.0

  // 12 base vertices
  const baseVertices = [
    -1, t, 0,  1, t, 0,  -1, -t, 0,  1, -t, 0,
     0, -1, t,  0, 1, t,  0, -1, -t,  0, 1, -t,
     t, 0, -1,  t, 0, 1,  -t, 0, -1,  -t, 0, 1
  ]

  // 20 base faces
  const baseFaces = [
    0, 11, 5,   0, 5, 1,    0, 1, 7,    0, 7, 10,   0, 10, 11,
    1, 5, 9,    5, 11, 4,   11, 10, 2,  10, 7, 6,   7, 1, 8,
    3, 9, 4,    3, 4, 2,    3, 2, 6,    3, 6, 8,    3, 8, 9,
    4, 9, 5,    2, 4, 11,   6, 2, 10,   8, 6, 7,    9, 8, 1
  ]

  // Cache to avoid duplicate vertices for midpoints
  const edgeMidpointCache = new Map<string, number>()

  const currentVerticesArray: number[] = [...baseVertices]

  // Normalize all base vertices
  for (let i = 0; i < 12; i++) {
    const x = at(currentVerticesArray, i * 3)
    const y = at(currentVerticesArray, i * 3 + 1)
    const z = at(currentVerticesArray, i * 3 + 2)
    const len = Math.sqrt(x * x + y * y + z * z)
    if (len > 0) {
      currentVerticesArray[i * 3] = (x / len) * radius
      currentVerticesArray[i * 3 + 1] = (y / len) * radius
      currentVerticesArray[i * 3 + 2] = (z / len) * radius
    }
  }

  const getMidpoint = (v1: number, v2: number): number => {
    const min = Math.min(v1, v2)
    const max = Math.max(v1, v2)
    const key = `${min}_${max}`
    const cached = edgeMidpointCache.get(key)
    if (cached !== undefined) return cached

    const nextIndex = currentVerticesArray.length / 3

    const x1 = at(currentVerticesArray, v1 * 3)
    const y1 = at(currentVerticesArray, v1 * 3 + 1)
    const z1 = at(currentVerticesArray, v1 * 3 + 2)

    const x2 = at(currentVerticesArray, v2 * 3)
    const y2 = at(currentVerticesArray, v2 * 3 + 1)
    const z2 = at(currentVerticesArray, v2 * 3 + 2)

    let mx = (x1 + x2) / 2
    let my = (y1 + y2) / 2
    let mz = (z1 + z2) / 2

    const len = Math.sqrt(mx * mx + my * my + mz * mz)
    if (len > 0) {
      mx = (mx / len) * radius
      my = (my / len) * radius
      mz = (mz / len) * radius
    }

    currentVerticesArray.push(mx, my, mz)
    edgeMidpointCache.set(key, nextIndex)
    return nextIndex
  }

  let faces: number[] = baseFaces

  for (let level = 0; level < detail; level++) {
    const nextFaces: number[] = []
    edgeMidpointCache.clear()

    for (let i = 0; i < faces.length; i += 3) {
      const v1 = at(faces, i)
      const v2 = at(faces, i + 1)
      const v3 = at(faces, i + 2)

      const m12 = getMidpoint(v1, v2)
      const m23 = getMidpoint(v2, v3)
      const m31 = getMidpoint(v3, v1)

      nextFaces.push(
        v1, m12, m31,
        v2, m23, m12,
        v3, m31, m23,
        m12, m23, m31
      )
    }
    faces = nextFaces
  }

  // Create unindexed buffer geometry (since equirectangular UV mapping gets messy at the seam otherwise)
  const finalVertices = new Float32Array(faces.length * 3)
  const finalNormals = new Float32Array(faces.length * 3)
  const finalUvs = new Float32Array(faces.length * 2)

  for (let i = 0; i < faces.length; i++) {
    const idx = at(faces, i)
    const x = at(currentVerticesArray, idx * 3)
    const y = at(currentVerticesArray, idx * 3 + 1)
    const z = at(currentVerticesArray, idx * 3 + 2)

    finalVertices[i * 3] = x
    finalVertices[i * 3 + 1] = y
    finalVertices[i * 3 + 2] = z

    const nx = x / radius
    const ny = y / radius
    const nz = z / radius

    finalNormals[i * 3] = nx
    finalNormals[i * 3 + 1] = ny
    finalNormals[i * 3 + 2] = nz

    // Equirectangular UV mapping
    const u = 0.5 + Math.atan2(nx, nz) / (2 * Math.PI)
    const v = 0.5 - Math.asin(ny) / Math.PI

    finalUvs[i * 2] = u
    finalUvs[i * 2 + 1] = v
  }

  // Fix UV seam
  for (let i = 0; i < faces.length; i += 3) {
    const u1 = at(finalUvs, i * 2)
    const u2 = at(finalUvs, (i + 1) * 2)
    const u3 = at(finalUvs, (i + 2) * 2)

    const min = Math.min(u1, u2, u3)
    const max = Math.max(u1, u2, u3)

    if (max - min > 0.5) {
      const v0 = finalUvs[i * 2]
      const v1 = finalUvs[(i + 1) * 2]
      const v2 = finalUvs[(i + 2) * 2]
      if (v0 !== undefined && v0 < 0.5) finalUvs[i * 2] = v0 + 1
      if (v1 !== undefined && v1 < 0.5) finalUvs[(i + 1) * 2] = v1 + 1
      if (v2 !== undefined && v2 < 0.5) finalUvs[(i + 2) * 2] = v2 + 1
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(finalVertices, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(finalNormals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(finalUvs, 2))

  return geometry
}
