import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // PGlite boots a WASM Postgres per test file; give it room on slow machines.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
