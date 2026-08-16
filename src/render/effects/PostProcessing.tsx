import { useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { KernelSize } from 'postprocessing'

interface PostProcessingProps {
  tier: 'High' | 'Medium' | 'Low'
}

export function PostProcessing({ tier }: PostProcessingProps) {
  const { gl } = useThree()

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
    <EffectComposer enableNormalPass={false} multisampling={2}>
      <Bloom
        luminanceThreshold={0.85}
        luminanceSmoothing={0.22}
        intensity={tier === 'High' ? 1.15 : 0.85}
        mipmapBlur
        kernelSize={tier === 'High' ? KernelSize.LARGE : KernelSize.MEDIUM}
        resolutionScale={tier === 'High' ? 1 : 0.5}
      />
      <Vignette eskil={false} offset={0.22} darkness={0.78} />
    </EffectComposer>
  )
}
