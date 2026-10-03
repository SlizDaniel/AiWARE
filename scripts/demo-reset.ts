// Resets the rehearsal database (DEMO_MODE=1). Stop `npm run dev` first when
// using local PGlite — it holds the data directory open.
//   npm run demo:reset
import { existsSync, readFileSync } from 'node:fs'

for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}
process.env.DEMO_MODE = '1'

const { databaseConfig } = await import('../src/server/env')
const { createPgliteDb, createPostgresDb } = await import('../src/server/sql')
const { initDemoDb } = await import('../src/server/demo')

const config = databaseConfig()
const db = config.kind === 'postgres' ? createPostgresDb(config.url) : await createPgliteDb(config.dataDir)
await initDemoDb(db, { reset: true })
console.log(`Baza demo gotowa (${config.kind === 'postgres' ? 'Postgres' : `PGlite ${config.dataDir ?? 'w pamięci'}`}).`)
process.exit(0)
