// A database created by schema v1 (before pending accounts, rate limits and
// audit indexes) is upgraded in place on the next cold start.
import { expect, test } from 'vitest'
import { createPgliteDb, ensureSchema, SCHEMA_SQL, SCHEMA_VERSION } from '@/server/sql'

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
