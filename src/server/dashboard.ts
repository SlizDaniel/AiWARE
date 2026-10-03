import { DASHBOARD_EVENT_TYPES, type ActivityStatus, type DashboardActivityResponse, type DashboardEventType, type DashboardRange, type DashboardResponse } from '@/lib/dashboard'
import { appTimezone } from './env'
import { getDataVersion } from './db'
import { HttpError } from './http'
import type { Db } from './sql'

const DAY_MS = 86_400_000
export const ACTIVE_STOCK = "event_type = 'stock_change' AND undo_of IS NULL AND undone_by IS NULL AND delta <> 0"
export const IN_RANGE = 'ts >= ($1::date::timestamp AT TIME ZONE $3) AND ts < (($2::date + 1)::timestamp AT TIME ZONE $3)'
export const ISO_TS = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
export const PERIOD_METRICS = `count(*)::int AS audit_events,
  count(*) FILTER (WHERE ${ACTIVE_STOCK})::int AS stock_changes,
  count(*) FILTER (WHERE ${ACTIVE_STOCK} AND delta < 0)::int AS withdrawals,
  count(*) FILTER (WHERE ${ACTIVE_STOCK} AND delta > 0)::int AS receipts,
  count(*) FILTER (WHERE undo_of IS NOT NULL)::int AS undo_count,
  count(*) FILTER (WHERE event_type = 'inventory_import')::int AS import_events`
export const CURRENT_INVENTORY = `SELECT count(*)::int AS total_items,
  count(*) FILTER (WHERE quantity < minimum)::int AS below_minimum,
  count(*) FILTER (WHERE btrim(location) = '')::int AS missing_location,
  (SELECT count(*)::int FROM reorder_drafts WHERE status = 'pending') AS pending_drafts FROM items`

export function dateValue(value: string): number {
  const result = Date.parse(`${value}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(result) || new Date(result).toISOString().slice(0, 10) !== value || value < '1000-01-01') {
    throw new HttpError(422, 'Daty muszą mieć format YYYY-MM-DD i wskazywać istniejący dzień.')
  }
  return result
}

export function dashboardRange(query: URLSearchParams, now = new Date()): DashboardRange {
  let timezone = appTimezone()
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }) } catch { timezone = 'Europe/Warsaw' }
  const from = query.get('from'), to = query.get('to'), period = query.get('period')
  if (from !== null || to !== null) {
    if (!from || !to || period !== null) throw new HttpError(422, 'Podaj from i to razem, bez period.')
    const days = (dateValue(to) - dateValue(from)) / DAY_MS + 1
    if (days < 1 || days > 366) throw new HttpError(422, 'Zakres musi obejmować od 1 do 366 dni.')
    return { from, to, timezone }
  }
  const selected = period ?? '7d'
  if (!['today', '7d', '30d'].includes(selected)) throw new HttpError(422, 'period: today, 7d albo 30d.')
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(now)
  const days = selected === 'today' ? 1 : selected === '7d' ? 7 : 30
  return { from: new Date(dateValue(today) - (days - 1) * DAY_MS).toISOString().slice(0, 10), to: today, timezone }
}

/** All sections of one response observe the same read-only database snapshot. */
export async function dashboardSummary(db: Db, range: DashboardRange): Promise<DashboardResponse> {
  const generated_at = new Date().toISOString()
  const params = [range.from, range.to, range.timezone]
  return db.transaction(async (tx) => {
    await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
    const [current] = await tx.query<DashboardResponse['current']>(CURRENT_INVENTORY)
    const [period] = await tx.query<DashboardResponse['period']>(`SELECT ${PERIOD_METRICS} FROM audit_log WHERE ${IN_RANGE}`, params)
    const daily = await tx.query<DashboardResponse['daily'][number]>(`WITH events AS (
      SELECT to_char(ts AT TIME ZONE $3, 'YYYY-MM-DD') AS day,
        count(*) FILTER (WHERE ${ACTIVE_STOCK} AND delta < 0)::int AS withdrawals,
        count(*) FILTER (WHERE ${ACTIVE_STOCK} AND delta > 0)::int AS receipts,
        count(*) FILTER (WHERE undo_of IS NOT NULL)::int AS undo_count
      FROM audit_log WHERE ${IN_RANGE} GROUP BY day)
      SELECT to_char(d.day, 'YYYY-MM-DD') AS date, coalesce(e.withdrawals, 0)::int AS withdrawals,
        coalesce(e.receipts, 0)::int AS receipts, coalesce(e.undo_count, 0)::int AS undo_count
      FROM generate_series($1::date::timestamp, $2::date::timestamp, interval '1 day') AS d(day)
      LEFT JOIN events e ON e.day = to_char(d.day, 'YYYY-MM-DD') ORDER BY d.day`, params)
    const most_changed_items = await tx.query<DashboardResponse['most_changed_items'][number]>(`SELECT item_id, max(item_name) AS item_name,
      count(*)::int AS stock_changes, count(*) FILTER (WHERE delta < 0)::int AS withdrawals,
      count(*) FILTER (WHERE delta > 0)::int AS receipts FROM audit_log
      WHERE ${IN_RANGE} AND ${ACTIVE_STOCK} GROUP BY item_id
      ORDER BY stock_changes DESC, item_id NULLS LAST LIMIT 10`, params)
    const below_minimum = await tx.query<DashboardResponse['attention']['below_minimum'][number]>(`SELECT i.id AS item_id, i.name AS item_name,
      i.quantity, i.minimum, i.unit, d.id AS pending_draft_id FROM items i
      LEFT JOIN reorder_drafts d ON d.item_id = i.id AND d.status = 'pending'
      WHERE i.quantity < i.minimum ORDER BY CASE WHEN i.quantity <= 0 THEN 0 ELSE 1 END, i.id LIMIT 10`)
    const pending_drafts = await tx.query<DashboardResponse['attention']['pending_drafts'][number]>(`SELECT id, item_id, item_name, quantity, unit,
      to_char(deliver_on, 'YYYY-MM-DD') AS deliver_on, ${ISO_TS('created_at')} AS created_at,
      round(greatest(0, extract(epoch FROM ($1::timestamptz - created_at)) / 3600), 2)::float8 AS waiting_hours,
      ($1::timestamptz - created_at >= interval '24 hours') AS overdue,
      CASE WHEN $1::timestamptz - created_at >= interval '48 hours' THEN 'critical'
           WHEN $1::timestamptz - created_at >= interval '24 hours' THEN 'warning' ELSE 'normal' END AS waiting_priority
      FROM reorder_drafts WHERE status = 'pending' ORDER BY created_at, id LIMIT 10`, [generated_at])
    const missing_location = await tx.query<DashboardResponse['attention']['missing_location'][number]>(
      "SELECT id AS item_id, name AS item_name FROM items WHERE btrim(location) = '' ORDER BY id LIMIT 10")
    const version = await getDataVersion(tx)
    return { generated_at, data_version: version, range, current, period, daily, most_changed_items, attention: { below_minimum, pending_drafts, missing_location } }
  })
}

export function positiveInt(value: string, name: string, max: number): number {
  const result = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(result) || result < 1 || result > max) throw new HttpError(422, `Nieprawidłowy parametr ${name}.`)
  return result
}

export function activityOptions(query: URLSearchParams) {
  const actor_id = query.get('actor_id'), event = query.get('event_type'), item = query.get('item_id')
  if (actor_id !== null && actor_id !== 'unassigned' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actor_id)) throw new HttpError(422, 'actor_id musi być UUID albo unassigned.')
  if (event !== null && !DASHBOARD_EVENT_TYPES.includes(event as DashboardEventType)) throw new HttpError(422, 'Nieznany event_type.')
  const status = query.get('status') ?? 'all'
  if (!['all', 'active', 'undone', 'undo'].includes(status)) throw new HttpError(422, 'status: all, active, undone albo undo.')
  const q = (query.get('q') ?? '').trim()
  if (q.length > 100) throw new HttpError(422, 'Wyszukiwanie może mieć maksymalnie 100 znaków.')
  return { filters: { actor_id, event_type: event as DashboardEventType | null,
    item_id: item === null ? null : positiveInt(item, 'item_id', 2_147_483_647), q, status: status as ActivityStatus },
    page: positiveInt(query.get('page') ?? '1', 'page', 100_000),
    page_size: positiveInt(query.get('page_size') ?? '25', 'page_size', 100) }
}

export function activityWhere(range: DashboardRange, filters: DashboardActivityResponse['filters']) {
  const params: unknown[] = [range.from, range.to, range.timezone]
  const predicates = [IN_RANGE]
  const add = (predicate: string, value: unknown) => { params.push(value); predicates.push(predicate.replace('?', `$${params.length}`)) }
  if (filters.actor_id === 'unassigned') predicates.push('actor_id IS NULL')
  else if (filters.actor_id !== null) add('actor_id = ?::uuid', filters.actor_id)
  if (filters.event_type !== null) add('event_type = ?', filters.event_type)
  if (filters.item_id !== null) add('item_id = ?::int', filters.item_id)
  if (filters.q) add('position(lower(?::text) IN lower(item_name)) > 0', filters.q)
  if (filters.status === 'active') predicates.push('undo_of IS NULL AND undone_by IS NULL')
  if (filters.status === 'undo') predicates.push('undo_of IS NOT NULL')
  if (filters.status === 'undone') predicates.push('undone_by IS NOT NULL')
  const where = predicates.join(' AND ')
  return { where, params }
}

export const ACTIVITY_COLUMNS = `id, ${ISO_TS('ts')} AS ts,
  actor_id::text AS actor_id, actor, item_id, item_name, event_type, text, details, delta, before, after, undo_of, undone_by,
  CASE WHEN undo_of IS NOT NULL THEN 'undo' WHEN undone_by IS NOT NULL THEN 'undone' ELSE 'active' END AS status`

export async function dashboardActivity(db: Db, range: DashboardRange, options: ReturnType<typeof activityOptions>): Promise<DashboardActivityResponse> {
  const { filters, page, page_size } = options
  const { where, params } = activityWhere(range, filters)
  return db.transaction(async (tx) => {
    await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
    const [{ total }] = await tx.query<{ total: number }>(`SELECT count(*)::int AS total FROM audit_log WHERE ${where}`, params)
    const entries = await tx.query<DashboardActivityResponse['entries'][number]>(`SELECT ${ACTIVITY_COLUMNS}
      FROM audit_log WHERE ${where} ORDER BY audit_log.ts DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, page_size, (page - 1) * page_size])
    return { range, ...options, total, has_more: page * page_size < total, entries }
  })
}
