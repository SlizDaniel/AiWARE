import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/reorder-drafts/reject-batch/route'
import { setSessionReader } from './auth'
import { createReorderDraft, decideReorderDraft, getDataVersion, initDb, listAudit, listItems, listReorderDrafts, rejectReorderDrafts } from './db'
import { createPgliteDb, type Db } from './sql'

let db: Db
const actor = { name: 'Kierownik test', id: null }
const store = globalThis as typeof globalThis & { __magazynierDb?: Promise<Db> }
beforeAll(async () => { db = await createPgliteDb(null); await initDb(db); store.__magazynierDb = Promise.resolve(db) })
afterAll(() => { store.__magazynierDb = undefined; setSessionReader(null); vi.unstubAllEnvs() })
beforeEach(async () => {
  vi.stubEnv('DEMO_MODE', '')
  vi.stubEnv('AUTH_DISABLED', '1')
  await db.exec('TRUNCATE reorder_drafts, audit_log RESTART IDENTITY')
  setSessionReader(null)
})
const draft = async (itemId: number) => (await createReorderDraft(db, { itemId, quantity: 50 }))!
const request = (draft_ids: unknown) => POST(new Request('http://test/api/reorder-drafts/reject-batch', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft_ids }),
}))

describe('clearing a snapshot of the pending queue', () => {
  it('rejects the selected drafts, audits each and bumps version once without changing stock', async () => {
    const a = await draft(1), b = await draft(2)
    const stock = await listItems(db), version = await getDataVersion(db)
    expect(await rejectReorderDrafts(db, [b.id, a.id, a.id], actor)).toEqual({ rejected: 2, skipped: 0 })
    expect((await listReorderDrafts(db)).every(row => row.status === 'rejected' && row.decided_by === actor.name)).toBe(true)
    expect((await listAudit(db)).filter(row => row.event_type === 'reorder_rejected')).toHaveLength(2)
    expect(await getDataVersion(db)).toBe(version + 1)
    expect(await listItems(db)).toEqual(stock)
    expect(await rejectReorderDrafts(db, [a.id, b.id], actor)).toEqual({ rejected: 0, skipped: 2 })
    expect(await getDataVersion(db)).toBe(version + 1)
  })
  it('preserves approved drafts and new arrivals outside the snapshot', async () => {
    const a = await draft(1), b = await draft(2), c = await draft(3)
    await decideReorderDraft(db, b.id, 'approved', actor)
    expect(await rejectReorderDrafts(db, [a.id, b.id, 99999], actor)).toEqual({ rejected: 1, skipped: 2 })
    expect((await listReorderDrafts(db)).find(row => row.id === b.id)?.status).toBe('approved')
    expect((await listReorderDrafts(db)).find(row => row.id === c.id)?.status).toBe('pending')
  })
  it('rolls back the whole batch on a database failure', async () => {
    const a = await draft(1), b = await draft(2)
    const before = await listAudit(db), version = await getDataVersion(db)
    const failing: Db = { ...db, transaction: fn => db.transaction(tx => {
      const wrapped: Db = { ...tx, query: (sql, params) => {
        if (sql.includes('UPDATE reorder_drafts SET status') && params?.[2] === b.id) throw new Error('test failure')
        return tx.query(sql, params)
      } }
      wrapped.transaction = fn => fn(wrapped)
      return fn(wrapped)
    }) }
    await expect(rejectReorderDrafts(failing, [a.id, b.id], actor)).rejects.toThrow('test failure')
    expect((await listReorderDrafts(db)).every(row => row.status === 'pending')).toBe(true)
    expect(await listAudit(db)).toEqual(before)
    expect(await getDataVersion(db)).toBe(version)
  })
  it('serves the manager API', async () => {
    const a = await draft(1)
    const response = await request([a.id])
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ rejected: 1, skipped: 0 })
  })
  it.each([null, [], ['1'], [0], [-1], [1.5], [2147483648], Array(1001).fill(1)])('validates batch IDs: %j', async ids => {
    expect((await request(ids)).status).toBe(422)
  })
  it('forbids worker and anonymous calls', async () => {
    vi.stubEnv('AUTH_DISABLED', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
    const id = '55555555-5555-4555-8555-555555555555'
    await db.query("INSERT INTO profiles(user_id,email,display_name,role) VALUES ($1,'worker@test.local','Test','pracownik') ON CONFLICT(user_id) DO NOTHING", [id])
    setSessionReader(async () => ({ id, email: 'worker@test.local', metadata: {} }))
    expect((await request([1])).status).toBe(403)
    setSessionReader(async () => null)
    expect((await request([1])).status).toBe(401)
  })
})
