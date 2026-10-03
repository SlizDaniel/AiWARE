import { existsSync } from 'node:fs'
import path from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'

// The Expo client test compiles mobile/ sources, whose tsconfig extends
// expo/tsconfig.base — available only after `npm --prefix mobile install`.
const mobileDepsInstalled = existsSync(path.resolve(import.meta.dirname, 'mobile/node_modules/expo'))
if (!mobileDepsInstalled) {
  console.warn('[vitest] Pomijam tests/mobile-client.test.ts — brak zależności mobile/ (npm --prefix mobile install).')
}

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: mobileDepsInstalled ? configDefaults.exclude : [...configDefaults.exclude, 'tests/mobile-client.test.ts'],
    // PGlite boots a WASM Postgres per test file; give it room on slow machines.
    testTimeout: 30_000,
    // Each file boots its own WASM Postgres; cap parallelism so slow machines don't time out.
    maxWorkers: 4,
    hookTimeout: 60_000,
  },
})
