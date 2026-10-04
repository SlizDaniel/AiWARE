// A database created by schema v1 (before pending accounts, rate limits and
// audit indexes) is upgraded in place on the next cold start.
import { expect, test } from 'vitest'
import { createPgliteDb, ensureSchema, SCHEMA_SQL, SCHEMA_VERSION, type Db } from '@/server/sql'
import { getDb } from '@/server/runtime'
import { listMapSectors } from '@/server/mapSectors'

test('upgrades a v1 database to the current schema', async () => {
  const db = await createPgliteDb(null)
  const v1 = SCHEMA_SQL.replace("CHECK (role IN ('pracownik', 'kierownik', 'oczekujacy'))", "CHECK (role IN ('pracownik', 'kierownik'))")
    .split('-- v2: accounts waiting for approval')[0]
  await db.exec(v1)
  await db.query("INSERT INTO app_meta (key, value) VALUES ('schema_version', 1)")
  await expect(
    db.query("INSERT INTO profiles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000000aa', 'oczekujacy')"),
  ).rejects.toThrow()

  await ensureSchema(db)

  await db.query("INSERT INTO profiles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000000aa', 'oczekujacy')")
  const indexes = await db.query<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE tablename = 'audit_log' ORDER BY indexname")
  expect(indexes.map((row) => row.indexname)).toEqual(expect.arrayContaining(['audit_log_item_ts_idx', 'audit_log_ts_idx']))
  expect((await db.query("SELECT to_regclass('rate_limits') IS NOT NULL AS ok"))[0]).toEqual({ ok: true })
  expect((await db.query("SELECT value FROM app_meta WHERE key = 'schema_version'"))[0]).toEqual({ value: SCHEMA_VERSION })
})

test('repairs a v4 database without sector tables and preserves inventory and paths', async () => {
  const db = await createPgliteDb(null)
  await db.exec(SCHEMA_SQL)
  await db.exec('DROP TABLE map_sector_items; DROP TABLE map_sectors;')
  await db.query("INSERT INTO app_meta (key, value) VALUES ('schema_version', 4)")
  await db.query("INSERT INTO items (name, quantity) VALUES ('Existing stock', 17)")
  await db.query("INSERT INTO map_paths (name, points) VALUES ('Existing path', '[{\"x\":0,\"y\":0,\"t\":0},{\"x\":0,\"y\":1,\"t\":1}]'::jsonb)")

  const statements: string[] = []
  const tracked: Db = {
    ...db,
    transaction: fn => db.transaction(tx => fn({
      ...tx,
      exec: async sql => { statements.push(sql); await tx.exec(sql) },
    })),
  }
  await ensureSchema(tracked)
  // Repair must not acquire an exclusive lock on profiles, which live auth reads.
  expect(statements.join('\n')).not.toContain('ALTER TABLE profiles')
  expect(await listMapSectors(db)).toEqual([])
  expect(await db.query('SELECT name, quantity FROM items')).toEqual([{ name: 'Existing stock', quantity: 17 }])
  expect(await db.query('SELECT name FROM map_paths')).toEqual([{ name: 'Existing path' }])
  const tables = await db.query<{ tablename: string; rowsecurity: boolean }>(
    "SELECT tablename, rowsecurity FROM pg_tables WHERE tablename IN ('map_sectors', 'map_sector_items') ORDER BY tablename",
  )
  expect(tables).toEqual([{ tablename: 'map_sector_items', rowsecurity: true }, { tablename: 'map_sectors', rowsecurity: true }])
  await ensureSchema(db)
  expect(await listMapSectors(db)).toEqual([])
})

test('upgrades a cached database handle after a code reload instead of opening another connection', async () => {
  const db = await createPgliteDb(null)
  await db.exec(SCHEMA_SQL)
  await db.exec('DROP TABLE map_sector_items; DROP TABLE map_sectors;')
  await db.query("INSERT INTO app_meta (key, value) VALUES ('schema_version', 3)")
  const store = globalThis as typeof globalThis & { __magazynierDb?: Promise<typeof db> }
  const previous = store.__magazynierDb
  store.__magazynierDb = Promise.resolve(db)
  try {
    const [one, two] = await Promise.all([getDb(), getDb()])
    expect(one).toBe(db)
    expect(two).toBe(db)
    expect(await listMapSectors(db)).toEqual([])
  } finally {
    store.__magazynierDb = previous
  }
})
