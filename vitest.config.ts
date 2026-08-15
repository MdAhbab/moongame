import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: { alias: { '@': path.resolve(root, 'src') } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    coverage: {
      provider: 'v8',
      include: ['src/game/**/*.ts'],
      exclude: ['src/game/**/index.ts'],
      // §37.1 — ≥85% on game/. UI coverage is deliberately not chased.
      thresholds: { lines: 85, functions: 85, statements: 85, branches: 75 },
      reporter: ['text-summary', 'json-summary'],
    },
  },
})
