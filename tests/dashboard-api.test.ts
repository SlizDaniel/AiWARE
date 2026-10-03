import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { initDb } from '@/server/db'
import { createPgliteDb, createPostgresDb, type Db } from '@/server/sql'
import { setSessionReader } from '@/server/auth'
import { GET } from '@/app/api/dashboard/route'
import { GET as activity } from '@/app/api/dashboard/activity/route'
import { GET as csv } from '@/app/api/dashboard/activity/export/route'
import { GET as shift } from '@/app/api/dashboard/shift/route'
import { GET as trend } from '@/app/api/dashboard/items/[id]/trend/route'
import { dashboardRange } from '@/server/dashboard'
import { shiftWindow } from '@/server/dashboardReports'

const engines: [string, () => Promise<{ db: Db; close: () => Promise<void> }>][] = [
  ['PGlite', async () => ({ db: await createPgliteDb(null), close: async () => {} })],
  ['postgres.js', async () => {
    const pg = await PGlite.create()
    const port = 60_000 + Math.floor(Math.random() * 2_000)
    const server = new PGLiteSocketServer({ db: pg, host: '127.0.0.1', port })
    await server.start()
    return { db: createPostgresDb(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`), close: async () => { await server.stop(); await pg.close() } }
  }],
]

describe.each(engines)('dashboard API on %s', (_name, open) => {
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
  setSessionReader(null)
  vi.stubEnv('AUTH_DISABLED', '1')
  vi.stubEnv('APP_TIMEZONE', 'Europe/Warsaw')
  await db.exec('TRUNCATE audit_log, reorder_drafts, profiles RESTART IDENTITY;')
  await db.query("UPDATE items SET quantity = CASE id WHEN 1 THEN 54 WHEN 2 THEN 20 ELSE 15 END, location = 'Strefa A-1'")
})
afterAll(async () => { store.__magazynierDb = undefined; setSessionReader(null); vi.unstubAllEnvs(); await close() })

test('manager gets zero period metrics and live inventory without invoking AI', async () => {
  const response = await GET(new Request('http://test/api/dashboard?from=2026-10-03&to=2026-10-03'))
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.range).toEqual({ from: '2026-10-03', to: '2026-10-03', timezone: 'Europe/Warsaw' })
  expect(body.current).toMatchObject({ total_items: 3, below_minimum: 0, pending_drafts: 0 })
  expect(body.period).toMatchObject({ stock_changes: 0, withdrawals: 0, receipts: 0, undo_count: 0 })
  expect(body.daily).toEqual([{ date: '2026-10-03', withdrawals: 0, receipts: 0, undo_count: 0 }])
  expect(response.headers.get('cache-control')).toBe('private, no-store')
})

const ANNA = '11111111-1111-4111-8111-111111111111'
const JAN = '22222222-2222-4222-8222-222222222222'
const RANGE = 'from=2026-10-03&to=2026-10-03'
const request = (path = '', query = RANGE) => new Request(`http://test/api/dashboard${path}?${query}`)

async function seedActivity() {
  const rows: [string, string | null, string, number, number | null, number | null][] = [
    ['2026-10-02T22:10:00Z', ANNA, 'stock_change', -2, null, null], // Oct 3 in Warsaw
    ['2026-10-03T09:00:00Z', JAN, 'stock_change', 3, null, null],
    ['2026-10-03T10:00:00Z', ANNA, 'stock_change', -5, null, 5],
    ['2026-10-03T11:00:00Z', null, 'inventory_import', 100, null, null],
    ['2026-10-03T12:00:00Z', JAN, 'stock_change', 5, 3, null],
    ['2026-10-03T13:00:00Z', ANNA, 'reorder_draft_created', 0, null, null],
    ['2026-10-03T22:00:00Z', ANNA, 'stock_change', -9, null, null], // Oct 4 in Warsaw
  ]
  for (const [ts, actor_id, event_type, delta, undo_of, undone_by] of rows) {
    await db.query(`INSERT INTO audit_log (ts, actor, actor_id, text, item_id, item_name, delta, before, after, event_type, undo_of, undone_by)
      VALUES ($1, 'Jan', $2, 'test', 1, 'Kartony', $3, 13, 11, $4, $5, $6)`, [ts, actor_id, delta, event_type, undo_of, undone_by])
  }
  await db.query("UPDATE items SET quantity = 9, location = '' WHERE id = 1")
  await db.query("INSERT INTO reorder_drafts (item_id, item_name, quantity, unit, deliver_on) VALUES (1, 'Kartony', 50, 'szt', '2026-10-06')")
}

test('period charts exclude imports, corrections and undone changes; current attention ignores date filter', async () => {
  await seedActivity()
  const response = await GET(request())
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.period).toEqual({ audit_events: 6, stock_changes: 2, withdrawals: 1, receipts: 1, undo_count: 1, import_events: 1 })
  expect(body.daily).toEqual([{ date: '2026-10-03', withdrawals: 1, receipts: 1, undo_count: 1 }])
  expect(body.most_changed_items).toEqual([{ item_id: 1, item_name: 'Kartony', stock_changes: 2, withdrawals: 1, receipts: 1 }])
  expect(body.current).toEqual({ total_items: 3, below_minimum: 1, pending_drafts: 1, missing_location: 1 })
  expect(body.attention.below_minimum[0]).toMatchObject({ item_id: 1, quantity: 9, minimum: 12, pending_draft_id: 1 })
  expect(body.attention.pending_drafts[0]).toMatchObject({ id: 1, quantity: 50, unit: 'szt', deliver_on: '2026-10-06' })
  expect(body.attention.pending_drafts[0].waiting_hours).toBeGreaterThanOrEqual(0)
  expect(body.attention.missing_location).toEqual([{ item_id: 1, item_name: 'Kartony' }])
  const historical = await (await GET(request('', 'from=2020-01-01&to=2020-01-01'))).json()
  expect(historical.period.audit_events).toBe(0)
  expect(historical.current).toEqual(body.current)
})

test('activity pagination is stable, includes identity and audit details, filters compose', async () => {
  await seedActivity()
  const first = await (await activity(request('/activity', `${RANGE}&page_size=2`))).json()
  expect(first).toMatchObject({ total: 6, has_more: true, page: 1, page_size: 2 })
  expect(first.entries.map((entry: { id: number }) => entry.id)).toEqual([6, 5])
  expect(first.entries[1]).toMatchObject({ actor_id: JAN, actor: 'Jan', status: 'undo', undo_of: 3, ts: '2026-10-03T12:00:00.000Z' })
  const last = await (await activity(request('/activity', `${RANGE}&page_size=2&page=3`))).json()
  expect(last.entries.map((entry: { id: number }) => entry.id)).toEqual([2, 1])
  expect(last.has_more).toBe(false)
  const filtered = await (await activity(request('/activity', `${RANGE}&actor_id=${ANNA}&event_type=stock_change&item_id=1&q=kart&status=undone`))).json()
  expect(filtered.total).toBe(1)
  expect(filtered.entries[0]).toMatchObject({ id: 3, status: 'undone', undone_by: 5 })
  const unassigned = await (await activity(request('/activity', `${RANGE}&actor_id=unassigned`))).json()
  expect(unassigned.entries.map((entry: { id: number }) => entry.id)).toEqual([4])
  const literalSearch = await (await activity(request('/activity', `${RANGE}&q=%25`))).json()
  expect(literalSearch.total).toBe(0) // % is a literal, not SQL wildcard
})

test.each(['from=2026-02-30&to=2026-03-01', 'from=2026-10-04&to=2026-10-03', 'from=2020-01-01&to=2026-10-03',
  'from=2026-10-03', 'period=bad', `${RANGE}&period=today`])('invalid range returns 422: %s', async (query) => {
  expect((await GET(request('', query))).status).toBe(422)
})

test.each(['page=0', 'page_size=101', 'page=1.5', 'actor_id=bad', 'item_id=-1', 'event_type=bad', 'status=bad', `q=${'x'.repeat(101)}`])('invalid activity filter returns 422: %s', async (query) => {
  expect((await activity(request('/activity', `${RANGE}&${query}`))).status).toBe(422)
})

test('presets use Warsaw calendar days including DST, not rolling hours', () => {
  expect(dashboardRange(new URLSearchParams('period=today'), new Date('2026-10-02T22:10:00Z'))).toEqual({ from: '2026-10-03', to: '2026-10-03', timezone: 'Europe/Warsaw' })
  expect(dashboardRange(new URLSearchParams('period=7d'), new Date('2026-10-26T12:00:00Z')).from).toBe('2026-10-20')
})

test('the 25-hour Warsaw DST day includes both edges and excludes the next midnight', async () => {
  for (const ts of ['2026-10-24T22:00:00Z', '2026-10-25T22:59:59Z', '2026-10-25T23:00:00Z']) {
    await db.query("INSERT INTO audit_log (ts, text, item_id, item_name, delta, before, after) VALUES ($1, 'test', 1, 'Kartony', -1, 10, 9)", [ts])
  }
  const response = await GET(request('', 'from=2026-10-25&to=2026-10-25'))
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.period.withdrawals).toBe(2)
  expect(body.daily).toEqual([{ date: '2026-10-25', withdrawals: 2, receipts: 0, undo_count: 0 }])
})

test('both endpoints require a real manager session when auth is enabled', async () => {
  vi.stubEnv('AUTH_DISABLED', '0')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'test')
  setSessionReader(async () => null)
  const handlers = [GET, activity, csv, shift, (req: Request) => trend(req, { params: Promise.resolve({ id: '1' }) })]
  for (const handler of handlers) expect((await handler(request())).status).toBe(401)
  setSessionReader(async () => ({ id: ANNA, email: 'anna@example.test', metadata: {} }))
  expect((await GET(request())).status).toBe(200) // first account bootstraps manager
  setSessionReader(async () => ({ id: JAN, email: 'jan@example.test', metadata: {} }))
  for (const handler of handlers) expect((await handler(request())).status).toBe(403)
})

test('demo with configured cloud keys still reads only the local database', async () => {
  vi.stubEnv('DEMO_MODE', '1')
  vi.stubEnv('GEMINI_API_KEY', 'fake-key')
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('External requests forbidden'))
  try {
    expect((await GET(request())).status).toBe(200)
    expect((await activity(request('/activity'))).status).toBe(200)
    expect(fetch).not.toHaveBeenCalled()
  } finally { fetch.mockRestore() }
})

test('CSV exports the complete filtered log with Polish headers and escaped text', async () => {
  await seedActivity()
  await db.query("UPDATE audit_log SET text = '=HYPERLINK(\"bad\")', actor = 'Jan;\"Nowak\"' WHERE id = 3")
  const response = await csv(request('/activity/export', `${RANGE}&status=undone`))
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('text/csv')
  expect(response.headers.get('content-disposition')).toContain('attachment')
  const body = await response.text()
  expect(body).toContain('Autor UUID')
  expect(body).toContain('Jan;""Nowak""')
  expect(body).toContain("'=HYPERLINK")
  expect(body.trim().split('\r\n')).toHaveLength(2)
  expect((await csv(request('/activity/export', `${RANGE}&page=1`))).status).toBe(422)
})

test('CSV refuses oversized exports rather than returning truncated data', async () => {
  await db.exec(`INSERT INTO audit_log (ts, text, item_name, delta, before, after)
    SELECT '2026-10-03T10:00:00Z', 'test', 'Kartony', 0, 1, 1 FROM generate_series(1, 5001)`)
  expect((await csv(request('/activity/export'))).status).toBe(422)
  await db.exec('TRUNCATE audit_log RESTART IDENTITY')
  await db.query("INSERT INTO audit_log (ts, text, item_name, delta, before, after) VALUES ('2026-10-03T10:00:00Z', $1, 'Kartony', 0, 1, 1)", ['x'.repeat(4 * 1024 * 1024)])
  expect((await csv(request('/activity/export'))).status).toBe(413)
})

test('shift window normalizes offsets, defaults to eight hours and rejects invalid bounds', () => {
  const now = new Date('2026-10-04T10:00:00Z')
  expect(shiftWindow(new URLSearchParams(), now)).toMatchObject({ start: '2026-10-04T02:00:00.000Z', end: now.toISOString() })
  expect(shiftWindow(new URLSearchParams('start=2026-10-03T08:00:00%2B02:00&end=2026-10-03T16:00:00%2B02:00'), now).start).toBe('2026-10-03T06:00:00.000Z')
  for (const query of ['start=2026-10-03T08:00:00Z', 'start=2026-02-30T08:00:00Z&end=2026-03-01T09:00:00Z',
    'start=2026-10-03T08:00:00&end=2026-10-03T09:00:00', 'start=2026-10-03T08:00:00Z&end=2026-10-03T08:00:00Z',
    'start=2026-10-01T00:00:00Z&end=2026-10-04T00:00:00Z', 'start=2026-10-04T10:00:00Z&end=2026-10-04T11:00:00Z', 'period=today']) {
    expect(() => shiftWindow(new URLSearchParams(query), now)).toThrow()
  }
})

test('handover summary respects exact start/end and reports procedures and authors', async () => {
  await seedActivity()
  await db.query("INSERT INTO audit_log (ts, actor, actor_id, text, item_name, delta, before, after, event_type) VALUES ('2026-10-03T12:30:00Z', 'Anna', $1, 'zapamiętaj', 'Szkło', 0, 0, 0, 'procedure_saved')", [ANNA])
  const response = await shift(request('/shift', 'start=2026-10-03T09:00:00Z&end=2026-10-03T13:00:00Z'))
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  const body = await response.json()
  expect(body.metrics).toEqual({ audit_events: 5, stock_changes: 1, withdrawals: 0, receipts: 1, undo_count: 1, import_events: 1 })
  expect(body.authors.find((a: { actor_id: string }) => a.actor_id === JAN)).toMatchObject({ stock_changes: 1, undo_count: 1 })
  expect(body.procedures_saved).toEqual([{ audit_id: 8, topic: 'Szkło', actor: 'Anna', ts: '2026-10-03T12:30:00.000Z' }])
  expect(body.authors_truncated).toBe(false)
  expect(body.procedures_truncated).toBe(false)
  expect(body.current.pending_drafts).toBe(1)
})

test('pending drafts expose normal, overdue and critical waiting priorities', async () => {
  for (const [index, hours] of [1, 25, 49].entries()) await db.query(`INSERT INTO reorder_drafts (item_id, item_name, quantity, unit, deliver_on, created_at)
    VALUES ($2, 'Towar', 50, 'szt', '2026-10-06', now() - ($1::int * interval '1 hour'))`, [hours, index + 1])
  const body = await (await GET(request())).json()
  expect(body.attention.pending_drafts.map((d: { waiting_priority: string; overdue: boolean }) => [d.waiting_priority, d.overdue])).toEqual([
    ['critical', true], ['warning', true], ['normal', false],
  ])
})

const trendRequest = (id = '1', query = RANGE) => trend(request(`/items/${id}/trend`, query), { params: Promise.resolve({ id }) })
test('stock trend retains original change, import and undo in their historical order', async () => {
  const rows = [
    ['2026-10-02T10:00:00Z', 'stock_change', 15, 13, null, null],
    ['2026-10-03T09:00:00Z', 'stock_change', 13, 11, null, null],
    ['2026-10-03T10:00:00Z', 'inventory_import', 11, 30, null, null],
    ['2026-10-03T11:00:00Z', 'stock_change', 30, 25, null, 5],
    ['2026-10-03T12:00:00Z', 'stock_change', 25, 30, 4, null],
  ]
  for (const [ts, type, before, after, undo_of, undone_by] of rows) await db.query(`INSERT INTO audit_log (ts, text, item_id, item_name, delta, before, after, event_type, undo_of, undone_by)
    VALUES ($1, 'test', 1, 'Kartony', $4::float8 - $3::float8, $3, $4, $2, $5, $6)`, [ts, type, before, after, undo_of, undone_by])
  await db.query('UPDATE items SET quantity = 30 WHERE id = 1')
  const response = await trendRequest()
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.opening_quantity).toBe(13)
  expect(body.closing_quantity).toBe(30)
  expect(body.points.map((p: { after: number }) => p.after)).toEqual([11, 30, 25, 30])
  expect(body.points[2]).toMatchObject({ undone_by: 5, continuous: true })
  expect(body.points[3]).toMatchObject({ undo_of: 4, continuous: true })
  expect(body.quality).toEqual({ opening_known: true, continuity_warnings: 0, current_matches_latest_audit: true, unit_is_current: true })
  await db.query('UPDATE audit_log SET before = 99 WHERE id = 3')
  await db.query('UPDATE items SET quantity = 31 WHERE id = 1')
  const inconsistent = await (await trendRequest()).json()
  expect(inconsistent.quality.continuity_warnings).toBe(1)
  expect(inconsistent.points[1].continuous).toBe(false)
  expect(inconsistent.quality.current_matches_latest_audit).toBe(false)
})

test('trend never invents opening quantities, validates item and rejects excessive history', async () => {
  const empty = await (await trendRequest()).json()
  expect(empty.opening_quantity).toBeNull()
  expect(empty.closing_quantity).toBeNull()
  expect(empty.points).toEqual([])
  expect(empty.quality.current_matches_latest_audit).toBeNull()
  expect((await trendRequest('99999')).status).toBe(404)
  expect((await trendRequest('bad')).status).toBe(422)
  await db.exec(`INSERT INTO audit_log (ts, text, item_id, item_name, delta, before, after)
    SELECT '2026-10-03T10:00:00Z', 'test', 1, 'Kartony', 0, 1, 1 FROM generate_series(1, 2001)`)
  expect((await trendRequest()).status).toBe(422)
})
})
