import { useMemo, useEffect, useState } from 'react'
import * as THREE from 'three'
import { createIcosphere } from '../geometry/icosphere.ts'
import { Materials, setRegolithDetail } from '../materials/registry.ts'
import { R } from '../../game/data/constants.ts'
import { registry } from '../disposal.ts'

interface MoonProps {
  albedoMap?: ImageBitmap | undefined
  normalMap?: ImageBitmap | undefined
  aoMap?: ImageBitmap | undefined
  tier: 'High' | 'Medium' | 'Low'
  highRef?: React.Ref<THREE.Mesh> | undefined
  lowRef?: React.Ref<THREE.Mesh> | undefined
}

export function Moon({
  albedoMap,
  normalMap,
  aoMap,
  tier,
  highRef,
  lowRef,
}: MoonProps) {
  const [geoHigh, geoLow] = useMemo(() => {
    const h = createIcosphere(R, tier === 'High' ? 6 : 5)
    h.computeVertexNormals()
    registry.track(h)

    const l = createIcosphere(R, tier === 'High' ? 4 : 3)
    l.computeVertexNormals()
    registry.track(l)

    return [h, l] as const
  }, [tier])

  useEffect(() => {
    return () => {
      registry.release(geoHigh)
      registry.release(geoLow)
    }
  }, [geoHigh, geoLow])

  useEffect(() => {
    setRegolithDetail(tier)
  }, [tier])

  const [textures, setTextures] = useState<{
    albedo?: THREE.Texture
    normal?: THREE.Texture
    ao?: THREE.Texture
  }>({})

  useEffect(() => {
    const nextTextures: { albedo?: THREE.Texture; normal?: THREE.Texture; ao?: THREE.Texture } = {}

    if (albedoMap) {
      const a = new THREE.CanvasTexture(albedoMap)
      a.colorSpace = THREE.SRGBColorSpace
      registry.track(a)
      nextTextures.albedo = a
    }
    if (normalMap) {
      const n = new THREE.CanvasTexture(normalMap)
      registry.track(n)
      nextTextures.normal = n
    }
    if (aoMap) {
      const ao = new THREE.CanvasTexture(aoMap)
      registry.track(ao)
      nextTextures.ao = ao
    }

    setTextures(nextTextures)
    return () => {
      if (nextTextures.albedo) registry.release(nextTextures.albedo)
      if (nextTextures.normal) registry.release(nextTextures.normal)
      if (nextTextures.ao) registry.release(nextTextures.ao)
    }
  }, [albedoMap, normalMap, aoMap])

  useEffect(() => {
    const mat = Materials.regolith
    mat.map = textures.albedo ?? null
    mat.normalMap = textures.normal ?? null
    mat.aoMap = textures.ao ?? null
    mat.needsUpdate = true
    return () => {
      if (mat.map === (textures.albedo ?? null)) mat.map = null
      if (mat.normalMap === (textures.normal ?? null)) mat.normalMap = null
      if (mat.aoMap === (textures.ao ?? null)) mat.aoMap = null
    }
  }, [textures])

  return (
    <group>
      <mesh ref={highRef ?? null} geometry={geoHigh} material={Materials.regolith} receiveShadow />
      <mesh ref={lowRef ?? null} geometry={geoLow} material={Materials.regolith} receiveShadow />
    </group>
  )
}
