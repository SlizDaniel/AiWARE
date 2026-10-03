// Real HTTP routes on both database adapters. No LLM, cloud or frontend mocks.
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { GET as version } from '@/app/api/version/route'
import { POST as command } from '@/app/api/command/route'
import { POST as confirm } from '@/app/api/proposals/[id]/confirm/route'
import { initDb, listAudit, listReorderDrafts, getItem, importItems, undoAuditEntry } from '@/server/db'
import { setSessionReader } from '@/server/auth'
import { createPgliteDb, createPostgresDb, type Db } from '@/server/sql'

const engines: [string, () => Promise<{ db: Db; close: () => Promise<void> }>][] = [
  ['PGlite', async () => ({ db: await createPgliteDb(null), close: async () => {} })],
  ['postgres.js', async () => {
    const pg = await PGlite.create()
    const port = 62000 + Math.floor(Math.random() * 1000)
    const server = new PGLiteSocketServer({ db: pg, host: '127.0.0.1', port })
    await server.start()
    return { db: createPostgresDb(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`), close: async () => { await server.stop(); await pg.close() } }
  }],
]

describe.each(engines)('stale stock proposal API on %s', (_name, open) => {
  let db: Db
  let close: () => Promise<void>
  const store = globalThis as typeof globalThis & { __magazynierDb?: Promise<Db> }
  beforeAll(async () => {
    ;({ db, close } = await open())
    await initDb(db)
    store.__magazynierDb = Promise.resolve(db)
  })
  beforeEach(async () => {
    vi.unstubAllEnvs()
    vi.stubEnv('AUTH_DISABLED', '1')
    vi.stubEnv('DEMO_MODE', '1')
    setSessionReader(null)
    await db.exec('TRUNCATE proposals, audit_log, reorder_drafts RESTART IDENTITY')
    await db.query("UPDATE items SET name = 'Kartony', quantity = 54, unit = 'szt' WHERE id = 1")
  })
  afterAll(async () => { store.__magazynierDb = undefined; setSessionReader(null); vi.unstubAllEnvs(); await close() })

  const proposal = async (text = 'wzięliśmy paletę kartonów') => {
    const response = await command(new Request('http://test/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.type).toBe('proposal')
    return body.proposal
  }
  const apply = (id: string) => confirm(new Request(`http://test/api/proposals/${id}/confirm`, { method: 'POST' }), { params: Promise.resolve({ id }) })
  const dataVersion = async () => (await (await version()).json()).version

  async function assertStale(id: string, expectedQuantity: number) {
    const beforeAudit = await listAudit(db)
    const beforeQueue = await listReorderDrafts(db)
    const beforeVersion = await dataVersion()
    const response = await apply(id)
    expect(response.status).toBe(409)
    expect((await response.json()).detail).toContain('wyślij komendę ponownie')
    expect((await getItem(db, 1))!.quantity).toBe(expectedQuantity)
    expect(await listAudit(db)).toEqual(beforeAudit)
    expect(await listReorderDrafts(db)).toEqual(beforeQueue)
    expect(await dataVersion()).toBe(beforeVersion)
    expect((await apply(id)).status).toBe(404) // old card is invalidated, not revived
  }

  test('another confirmed card invalidates the displayed state; a fresh card works', async () => {
    const first = await proposal()
    const second = await proposal()
    expect(first.before).toBe(54)
    expect((await apply(second.id)).status).toBe(200)
    await assertStale(first.id, 52)
    const fresh = await proposal()
    expect(fresh).toMatchObject({ before: 52, after: 50 })
    expect((await apply(fresh.id)).status).toBe(200)
    expect((await getItem(db, 1))!.quantity).toBe(50)
  })

  test('an intervening import invalidates the old card without extra audit or reorder', async () => {
    const card = await proposal()
    await importItems(db, [{ name: 'Kartony', quantity: 9, minimum: 12, unit: 'szt', location: 'Strefa A-1' }])
    await assertStale(card.id, 9)
  })

  test('an intervening undo invalidates the old card', async () => {
    const previous = await proposal()
    const confirmed = await (await apply(previous.id)).json()
    const card = await proposal()
    await undoAuditEntry(db, confirmed.audit_id)
    await assertStale(card.id, 54)
  })

  test.each([['unit', 'rolka'], ['name', 'Kartony duże']])('changing displayed %s also requires a fresh card', async (field, value) => {
    const card = await proposal()
    await db.query(`UPDATE items SET ${field} = $1 WHERE id = 1`, [value])
    await assertStale(card.id, 54)
  })

  // Wire server uses one PGlite backend, so parallel postgres.js transactions
  // cannot model independent Postgres sessions (same seam as tests/api.test.ts).
  test.skipIf(_name !== 'PGlite')('simultaneous cards prepared from the same state cannot both commit', async () => {
    const first = await proposal(), second = await proposal()
    const responses = await Promise.all([apply(first.id), apply(second.id)])
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409])
    expect((await getItem(db, 1))!.quantity).toBe(52)
    expect(await listAudit(db)).toHaveLength(1)
  })

  test('an incomplete persisted snapshot cannot bypass the check', async () => {
    const card = await proposal()
    await db.query("UPDATE proposals SET payload = payload - 'before' WHERE id = $1", [card.id])
    await assertStale(card.id, 54)
  })

  test('different items and unrelated fields do not invalidate the stock card', async () => {
    const card = await proposal()
    await db.query("UPDATE items SET quantity = quantity + 1 WHERE id = 2")
    await db.query("UPDATE items SET location = 'Strefa X', minimum = 20 WHERE id = 1")
    expect((await apply(card.id)).status).toBe(200)
    expect((await getItem(db, 1))!.quantity).toBe(52)
  })
})
