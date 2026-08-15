import { useEffect, useState } from 'react'
import type * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, Vignette, GodRays } from '@react-three/postprocessing'
import { KernelSize } from 'postprocessing'
import type { GodRaysEffect } from 'postprocessing'

interface PostProcessingProps {
  tier: 'High' | 'Medium' | 'Low'
  godRaysRef?: React.Ref<GodRaysEffect> | undefined
}

export function PostProcessing({ tier, godRaysRef }: PostProcessingProps) {
  const { scene, gl } = useThree()
  const [sun, setSun] = useState<THREE.Mesh | null>(null)

  useEffect(() => {
    if (tier !== 'High') return
    // Find the sun mesh once mounted
    const id = setInterval(() => {
      const s = scene.getObjectByName('sunMesh') as THREE.Mesh
      if (s) {
        setSun(s)
        clearInterval(id)
      }
    }, 100)
    return () => clearInterval(id)
  }, [scene, tier])

  if (tier === 'Low') return null

  /*
   * Do not build a composer on a renderer that has no live context.
   *
   * `EffectComposer.addPass` reads `getContextAttributes().alpha`, and
   * `getContextAttributes()` returns **null** when the context is gone — so the
   * failure surfaces as `Cannot read properties of null (reading 'alpha')`,
   * which names neither the context nor the renderer and sends you looking for
   * an `alpha` in your own code. There isn't one.
   *
   * It is reachable because React StrictMode double-invokes effects in
   * development: R3F mounts the renderer, tears it down, and builds a new one,
   * while `@react-three/postprocessing` can still be holding the disposed one.
   * The result was that `npm run dev` could not reach the Title screen at all,
   * while the production build was fine — StrictMode does not double-invoke
   * there — so every e2e test passed against a game nobody could develop on.
   *
   * Returning `null` for the frame or two the renderer is being swapped is not
   * a downgrade: post-processing reattaches as soon as the context is live, and
   * the game is fully playable on Low tier with no composer at all.
   */
  const context = gl.getContext() as WebGLRenderingContext | null
  if (context === null || context.isContextLost()) return null

  return (
    <EffectComposer enableNormalPass={false} multisampling={tier === 'High' ? 4 : 2}>
      <Bloom
        luminanceThreshold={0.85}
        luminanceSmoothing={0.22}
        intensity={tier === 'High' ? 1.15 : 0.85}
        mipmapBlur
        kernelSize={tier === 'High' ? KernelSize.LARGE : KernelSize.MEDIUM}
        resolutionScale={tier === 'High' ? 1 : 0.5}
      />
      {sun && (
        <GodRays
          {...(godRaysRef ? { ref: godRaysRef } : {})}
          sun={sun}
          samples={60}
          density={0.96}
          decay={0.9}
          weight={0.4}
          exposure={0.6}
          clampMax={1.0}
        />
      )}
      <Vignette eskil={false} offset={0.22} darkness={0.78} />
    </EffectComposer>
  )
}
