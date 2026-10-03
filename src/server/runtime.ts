// Process-wide database handle for route handlers. Serverless instances (and
// Next dev HMR) reuse one connection pool / PGlite instance via globalThis.
import { databaseConfig, isDemoMode } from './env'
import { createPgliteDb, createPostgresDb, type Db } from './sql'
import { initDb } from './db'
import { initDemoDb } from './demo'

const store = globalThis as typeof globalThis & { __magazynierDb?: Promise<Db> }

async function openConfiguredDb(): Promise<Db> {
  const config = databaseConfig()
  const db = config.kind === 'postgres' ? createPostgresDb(config.url) : await createPgliteDb(config.dataDir)
  if (isDemoMode()) await initDemoDb(db, { reset: false })
  else await initDb(db)
  return db
}

export function getDb(): Promise<Db> {
  if (!store.__magazynierDb) {
    store.__magazynierDb = openConfiguredDb().catch((error) => {
      store.__magazynierDb = undefined
      throw error
    })
  }
  return store.__magazynierDb
}

export type StorageKind = 'supabase' | 'postgres' | 'pglite' | 'ephemeral'

export function storageKind(): StorageKind {
  const config = databaseConfig()
  if (config.kind === 'pglite') return config.ephemeral ? 'ephemeral' : 'pglite'
  return /supabase\.(co|com)/.test(new URL(config.url).hostname) ? 'supabase' : 'postgres'
}
