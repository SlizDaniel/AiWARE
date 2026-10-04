// Process-wide database handle for route handlers. Serverless instances (and
// Next dev HMR) reuse one connection pool / PGlite instance via globalThis.
import { databaseConfig, isDemoMode } from './env'
import { createPgliteDb, createPostgresDb, ensureSchema, type Db } from './sql'
import { initDb } from './db'
import { initDemoDb } from './demo'

const store = globalThis as typeof globalThis & { __magazynierDb?: Promise<Db> }
// This module reloads with schema code; the connection survives in globalThis.
// Check each retained handle once per module load, sharing concurrent requests.
const schemaChecks = new WeakMap<Db, Promise<void>>()

async function openConfiguredDb(): Promise<Db> {
  const config = databaseConfig()
  const db = config.kind === 'postgres' ? createPostgresDb(config.url) : await createPgliteDb(config.dataDir)
  if (isDemoMode()) await initDemoDb(db, { reset: false })
  else await initDb(db)
  return db
}

export async function getDb(): Promise<Db> {
  if (!store.__magazynierDb) {
    store.__magazynierDb = openConfiguredDb().catch((error) => {
      store.__magazynierDb = undefined
      throw error
    })
  }
  const db = await store.__magazynierDb
  let checked = schemaChecks.get(db)
  if (!checked) {
    checked = ensureSchema(db).catch((error) => {
      schemaChecks.delete(db)
      throw error
    })
    schemaChecks.set(db, checked)
  }
  await checked
  return db
}

export type StorageKind = 'supabase' | 'postgres' | 'pglite' | 'ephemeral'

export function storageKind(): StorageKind {
  const config = databaseConfig()
  if (config.kind === 'pglite') return config.ephemeral ? 'ephemeral' : 'pglite'
  return /supabase\.(co|com)/.test(new URL(config.url).hostname) ? 'supabase' : 'postgres'
}
