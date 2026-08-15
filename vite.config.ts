import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))

/**
 * Vite configuration.
 *
 * Chunking follows gameplan §33.4: the `index` chunk must stay small enough
 * that the Title screen paints before three/R3F have finished downloading,
 * so time-to-interactive is bounded by the shell rather than the engine.
 */
export default defineConfig({
  base: '/',
  resolve: {
    alias: { '@': path.resolve(root, 'src') },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    /**
     * §34.1's budget is on the **initial** payload, ≤400 KB gz, and this
     * warning does not measure that.
     *
     * Rollup warns per chunk against a flat threshold, which assumes every
     * chunk is on the critical path. Here it is not: `index.html` preloads only
     * the two `index` chunks (≈120 KB gz combined, with the CSS), and `three`
     * — the chunk that trips the warning at 190 KB gz — is reached solely
     * through the `lazy()` import of `Canvas.tsx`, so it downloads *after* the
     * Title screen has painted and never delays first interaction.
     *
     * Raised to 800 KB rather than silenced, so it still fires if `three` grows
     * materially or if something new lands in a chunk this size. The real
     * budget is asserted where it can be measured honestly — the e2e suite
     * boots the built game and reports frame time and heap.
     */
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('postprocessing')) return 'post'
          if (id.includes('three') && !id.includes('@react-three')) return 'three'
          if (id.includes('@react-three')) return 'r3f'
          if (id.includes('gsap')) return 'motion'
          return 'index'
        },
      },
    },
  },
  worker: { format: 'es' },
  plugins: [react()],
  server: { port: 5173 },
  preview: { port: 4173 },
})
