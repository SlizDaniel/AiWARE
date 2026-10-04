import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { createPgliteDb, type Db } from '@/server/sql'
import { initDb, confirmStockChange, undoAuditEntry } from '@/server/db'
import { managerNotifications, markNotificationsRead } from '@/server/managerNotifications'
import { GET, PATCH } from '@/app/api/notifications/route'
import { resetLocalUserCache, setSessionReader } from '@/server/auth'
let db: Db
const store = globalThis as typeof globalThis & { __magazynierDb?: Promise<Db> }
const NOW = new Date('2026-10-04T10:00:00Z')
beforeAll(async () => { db = await createPgliteDb(null); await initDb(db); store.__magazynierDb = Promise.resolve(db) })
beforeEach(async () => {
  vi.unstubAllEnvs(); vi.stubEnv('AUTH_DISABLED', '1'); vi.stubEnv('DEMO_MODE', '0'); setSessionReader(null); resetLocalUserCache()
  await db.exec("TRUNCATE audit_log, reorder_drafts, profiles RESTART IDENTITY; DELETE FROM settings WHERE key LIKE 'manager_notifications_read:%';")
  await db.query("UPDATE items SET quantity = CASE id WHEN 1 THEN 54 WHEN 2 THEN 20 ELSE 15 END, minimum = CASE id WHEN 1 THEN 12 WHEN 2 THEN 8 ELSE 6 END")
})
afterAll(() => { store.__magazynierDb = undefined; setSessionReader(null); vi.unstubAllEnvs() })
const patch = (body: unknown) => PATCH(new Request('http://test/api/notifications', { method: 'PATCH', body: JSON.stringify(body) }))

describe('automatic manager notifications', () => {
  test('healthy inventory is quiet, stock thresholds update immediately including minimum zero', async () => {
    expect((await managerNotifications(db, 'one', NOW)).notifications).toEqual([])
    await db.query('UPDATE items SET quantity=0, minimum=0 WHERE id=1')
    await db.query('UPDATE items SET quantity=7 WHERE id=2')
    const result = await managerNotifications(db, 'one', NOW)
    expect(result.notifications.map(n => n.kind)).toEqual(['out_of_stock', 'low_stock'])
    expect(result).toMatchObject({ unread_count: 2, critical_count: 1, truncated: false })
    await db.query('UPDATE items SET quantity=minimum WHERE id=2')
    expect((await managerNotifications(db, 'one', NOW)).notifications).toHaveLength(1)
  })
  test('only confirmed large withdrawals appear, undo resolves them and read does not write stock or audit', async () => {
    const change = await confirmStockChange(db, { itemId: 1, delta: -30, text: 'wydanie' })
    const current = await managerNotifications(db, 'one')
    expect(current.notifications).toHaveLength(1)
    expect(current.notifications[0]).toMatchObject({ kind: 'large_withdrawal', id: `withdrawal:${change.audit_id}` })
    await markNotificationsRead(db, 'one', { ids: [current.notifications[0].id] })
    expect((await managerNotifications(db, 'one')).unread_count).toBe(0)
    expect((await managerNotifications(db, 'two')).unread_count).toBe(1)
    expect((await db.query('SELECT quantity FROM items WHERE id=1'))[0].quantity).toBe(24)
    expect((await db.query('SELECT count(*)::int AS count FROM audit_log'))[0].count).toBe(1)
    await undoAuditEntry(db, change.audit_id)
    expect((await managerNotifications(db, 'one')).notifications).toEqual([])
  })
  test('same feed does not duplicate alerts; changed stock creates a new unread notification', async () => {
    await db.query('UPDATE items SET quantity=10 WHERE id=1')
    const first = await managerNotifications(db, 'one')
    await markNotificationsRead(db, 'one', { ids: [first.notifications[0].id] })
    const repeated = await managerNotifications(db, 'one')
    expect(repeated.notifications[0].id).toBe(first.notifications[0].id)
    expect(repeated.unread_count).toBe(0)
    await confirmStockChange(db, { itemId: 1, delta: -1, text: 'wydanie' })
    expect((await managerNotifications(db, 'one')).unread_count).toBe(1)
  })
  test('24/48h order escalation is time-based and decided drafts disappear', async () => {
    for (const [index,hours] of [23,24,48].entries()) await db.query("INSERT INTO reorder_drafts (item_id,item_name,quantity,unit,deliver_on,created_at) VALUES ($2,'Kartony',50,'szt','2026-10-06',$1)", [new Date(NOW.getTime()-hours*3600000).toISOString(), index+1])
    const result = await managerNotifications(db, 'one', NOW)
    expect(result.notifications.map(n => n.priority)).toEqual(['critical', 'warning'])
    expect(result.notifications.map(n => n.id)).toEqual(['order:3:48', 'order:2:24'])
    await db.query("UPDATE reorder_drafts SET status='approved'")
    expect((await managerNotifications(db, 'one', NOW)).notifications).toEqual([])
  })
  test('large withdrawal window excludes old, future and undone events', async () => {
    for (const [ts, undone] of [['2026-10-03T09:59:59Z',null],['2026-10-04T10:00:01Z',null],['2026-10-04T09:00:00Z',99],['2026-10-03T10:00:00Z',null]]) {
      await db.query("INSERT INTO audit_log (ts, actor,text,item_id,item_name,delta,before,after,undone_by) VALUES ($1,'test','test',1,'Kartony',-30,54,24,$2)", [ts,undone])
    }
    expect((await managerNotifications(db, 'one', NOW)).notifications.map(n => n.id)).toEqual(['withdrawal:4'])
  })
  test('read validation is atomic and invalid IDs cannot create read receipts', async () => {
    await expect(markNotificationsRead(db, 'one', { ids: ['invented'] })).rejects.toMatchObject({ status: 409 })
    expect(await db.query("SELECT key FROM settings WHERE key='manager_notifications_read:one'")).toEqual([])
    for (const body of [null,{}, {ids:[]}, {ids:[42]}, {ids:Array(101).fill('x')}]) await expect(markNotificationsRead(db,'one',body)).rejects.toMatchObject({status:422})
  })
  test('HTTP endpoints support persistent read status and no-store', async () => {
    await db.query('UPDATE items SET quantity=0 WHERE id=1')
    const response = await GET()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const body = await response.json()
    expect((await (await patch({ids:[body.notifications[0].id]})).json()).unread_count).toBe(0)
    expect((await (await GET()).json()).unread_count).toBe(0)
    const conflict = await patch({ids:['missing']})
    expect(conflict.status).toBe(409)
    expect(conflict.headers.get('cache-control')).toBe('private, no-store')
    expect((await patch({ids:[]})).status).toBe(422)
  })
  test('worker cannot fetch or mark manager notifications', async () => {
    vi.stubEnv('AUTH_DISABLED','0')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','test')
    await db.query("INSERT INTO profiles (user_id,email,display_name,role) VALUES ('22222222-2222-4222-8222-222222222222','boss@example.com','Szef','kierownik')")
    const id='11111111-1111-4111-8111-111111111111'
    await db.query("INSERT INTO profiles (user_id,email,display_name,role) VALUES ($1,'test@example.com','Jan','pracownik')",[id])
    setSessionReader(async () => ({id,email:'test@example.com',metadata:{}}))
    const forbidden = await GET()
    expect(forbidden.status).toBe(403)
    expect(forbidden.headers.get('cache-control')).toBe('private, no-store')
    expect((await patch({ids:['x']})).status).toBe(403)
  })
})
