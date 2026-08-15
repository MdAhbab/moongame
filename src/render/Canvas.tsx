import { Canvas as R3FCanvas } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { registry } from './disposal.ts'
import { RenderBridge } from './RenderBridge.tsx'
import { applySkin } from './materials/registry.ts'
import { defaultSkin, skinById } from '../game/data/skins.ts'
import type { WorldPalette } from '../game/data/worlds.ts'
import type { World } from '../game/core/World.ts'

interface CanvasProps {
  world: World
  tier: 'High' | 'Medium' | 'Low'
  albedoMap?: ImageBitmap | undefined
  normalMap?: ImageBitmap | undefined
  aoMap?: ImageBitmap | undefined
  onContextLost?: () => void
  onContextRestored?: () => void
  /** Forwarded to RenderBridge; runs at the end of its single useFrame. */
  onFrame?: ((alpha: number) => void) | undefined
  /** Whether the world may advance. Owned by the UI (see RenderBridge). */
  stepping?: boolean | undefined
  /** Selected craft livery. Cosmetic only — never reaches the simulation. */
  skinId?: string | undefined
  /** Advances the owning `Simulation` by a real delta; returns `alpha`. */
  advance: (delta: number) => number
  /** The selected world's colours (§7.1). Presentation only. */
  palette: WorldPalette
  starDensity: number
}

export function Canvas({ world, tier, albedoMap, normalMap, aoMap, onContextLost, onContextRestored, onFrame, stepping, skinId, advance, palette, starDensity }: CanvasProps) {
  // Repaint on selection. Runs before the first frame because the materials are
  // module singletons that exist as soon as the chunk loads, so there is no
  // window in which the craft is drawn in the wrong livery.
  useEffect(() => {
    applySkin(skinById(skinId ?? '') ?? defaultSkin())
  }, [skinId])

  const [contextLost, setContextLost] = useState(false)

  /**
   * The canvas the live renderer is drawing to.
   *
   * React can replace the whole renderer — StrictMode double-invokes effects in
   * development, and the ErrorBoundary's "Try again" does it in production. The
   * retired renderer's canvas keeps its listeners and its closure over
   * `setContextLost`, and browsers dispatch `webglcontextlost` from
   * `forceContextLoss()` asynchronously, so the *old* canvas reports its death
   * after the *new* one is already drawing. Without this check that stale event
   * raised a "context lost" panel over a perfectly healthy scene, permanently.
   */
  const activeCanvas = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    return () => {
      // Rule 4: Dispose everything on unmount
      registry.disposeAll()
    }
  }, [])

  // DPR based on tier
  const dpr = tier === 'High' ? Math.min(window.devicePixelRatio, 2.0) 
            : tier === 'Medium' ? Math.min(window.devicePixelRatio, 1.5) 
            : 1.0

  return (
    <>
    <R3FCanvas
      dpr={dpr}
      gl={{
        antialias: false,
        powerPreference: 'high-performance',
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.15
      }}
      camera={{ position: [0, 0, 150], fov: 62 }}
      onCreated={({ gl }) => {
        const canvas = gl.domElement
        activeCanvas.current = canvas

        // A renderer exists, therefore a context exists. Clearing the flag here
        // is what makes the overlay survive a *replacement* rather than only a
        // restoration: `webglcontextrestored` fires on the canvas that lost the
        // context, so when React builds a whole new renderer — StrictMode's
        // double-invoke in development, or the ErrorBoundary's "Try again" in
        // production — that event lands on an element nobody is listening to any
        // more, and the panel stayed up over a perfectly healthy scene forever.
        setContextLost(false)

        /*
         * Grabbed while the context is alive, because `getExtension` on a lost
         * context returns null and the moment we need it is precisely the
         * moment it is lost.
         */
        const loseExt = gl.getContext().getExtension('WEBGL_lose_context') as
          | { restoreContext: () => void }
          | null

        // `preventDefault` is what makes the browser willing to hand the context
        // back. It does not ask for it back — and for a loss that came from
        // `loseContext()` rather than from the driver, nothing else will either.
        //
        // three's `forceContextLoss()` is exactly that call, and R3F makes it
        // when it disposes a renderer. StrictMode's double-invoked effects
        // therefore kill the context of the canvas React then goes on to reuse,
        // and it stays dead: one canvas in the DOM, `isContextLost()` true,
        // nothing pending. `npm run dev` could not render a frame while the
        // production build was perfectly healthy.
        //
        // Asking for it back is also the honest version of what the overlay
        // claims. It used to say "attempting to recover" while attempting
        // nothing.
        canvas.addEventListener('webglcontextlost', (e) => {
          e.preventDefault()
          if (activeCanvas.current !== canvas) return // a retired renderer
          setContextLost(true)
          onContextLost?.()
          window.setTimeout(() => {
            if (activeCanvas.current === canvas) loseExt?.restoreContext()
          }, 50)
        })
        canvas.addEventListener('webglcontextrestored', () => {
          if (activeCanvas.current !== canvas) return
          setContextLost(false)
          onContextRestored?.()
        })
      }}
    >
      <RenderBridge 
        world={world} 
        tier={tier} 
        albedoMap={albedoMap} 
        normalMap={normalMap} 
        aoMap={aoMap}
        onFrame={onFrame}
        stepping={stepping}
        advance={advance}
        palette={palette}
        starDensity={starDensity}
      />
    </R3FCanvas>

    {/*
      An **overlay**, not a replacement.

      This used to `return` this panel *instead of* the canvas, which is why the
      message it shows was a lie: unmounting the canvas destroys the element that
      `webglcontextrestored` would have fired on, so nothing was attempting to
      recover and nothing ever could. The only way out was a page reload.

      Same failure this codebase has hit repeatedly — a state with no route out —
      this time in the render layer. Keeping the canvas mounted lets the browser
      hand the context back and the overlay disappear on its own.

      Styled inline because the class names it carried (`absolute inset-0 flex…`)
      are Tailwind, and this project has no Tailwind. They resolved to nothing, so
      the panel rendered as bare unstyled text across the HUD.
    */}
    {contextLost && (
      <div
        role="alert"
        style={{
          position: 'absolute', inset: 0, zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgb(5 6 10 / 0.92)', padding: '32px', textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: '46ch' }}>
          <h2 style={{
            font: '700 1.1rem/1.3 var(--font-hud, monospace)',
            letterSpacing: '0.12em', color: 'var(--text-primary, #e8edf2)', margin: 0,
          }}>
            GRAPHICS CONTEXT LOST
          </h2>
          <p style={{
            color: 'var(--text-secondary, #8b97a6)', marginTop: '12px', lineHeight: 1.5,
          }}>
            The browser reclaimed the GPU context. Waiting for it to come back —
            your run is untouched, because the simulation does not live on the
            graphics card. If this panel stays up for more than a few seconds,
            reload the page.
          </p>
        </div>
      </div>
    )}
    </>
  )
}
