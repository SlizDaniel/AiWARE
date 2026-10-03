import type { DashboardActivity, ShiftSummaryResponse, StockTrendResponse } from '@/lib/dashboard'
import { ACTIVE_STOCK, ACTIVITY_COLUMNS, IN_RANGE, ISO_TS, PERIOD_METRICS, CURRENT_INVENTORY, activityOptions, activityWhere, dashboardRange, dateValue } from './dashboard'
import { HttpError } from './http'
import type { Db } from './sql'

const STOCK_EVENTS = "event_type IN ('stock_change', 'inventory_import')"

/** Filtered export, independent of pagination. Hard limits prevent partial downloads. */
export async function activityCsv(db: Db, query: URLSearchParams): Promise<string> {
  if (query.has('page') || query.has('page_size')) throw new HttpError(422, 'Eksport obejmuje wszystkie pasujące wpisy; pomiń page i page_size.')
  const range = dashboardRange(query)
  const { filters } = activityOptions(query)
  const { where, params } = activityWhere(range, filters)
  const entries = await db.transaction(async (tx) => {
    await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
    return tx.query<DashboardActivity>(`SELECT ${ACTIVITY_COLUMNS} FROM audit_log WHERE ${where} ORDER BY audit_log.ts DESC, id DESC LIMIT 5001`, params)
  })
  if (entries.length > 5000) throw new HttpError(422, 'Eksport przekracza 5000 wpisów. Zawęź daty lub filtry.')
  const cell = (value: string | number | null) => {
    let text = value === null ? '' : String(value)
    if (typeof value === 'string' && (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) text = "'" + text
    return `"${text.replaceAll('"', '""')}"`
  }
  const header = ['ID', 'Czas UTC', 'Autor UUID', 'Autor', 'Towar ID', 'Towar', 'Zdarzenie', 'Komenda', 'Szczegóły', 'Zmiana', 'Przed', 'Po', 'Cofa wpis', 'Cofnięty przez', 'Status']
  const rows = entries.map((e) => [e.id, e.ts, e.actor_id, e.actor, e.item_id, e.item_name, e.event_type, e.text, e.details, e.delta, e.before, e.after, e.undo_of, e.undone_by, e.status].map(cell).join(';'))
  const result = '\uFEFF' + [header.map(cell).join(';'), ...rows].join('\r\n') + '\r\n'
  if (Buffer.byteLength(result, 'utf8') > 4 * 1024 * 1024) throw new HttpError(413, 'Eksport przekracza 4 MB. Zawęź daty lub filtry.')
  return result
}

export function shiftWindow(query: URLSearchParams, now = new Date()) {
  if (['period', 'from', 'to'].some((key) => query.has(key))) throw new HttpError(422, 'Dla zmiany użyj start/end zamiast period/from/to.')
  const start = query.get('start'), end = query.get('end')
  const timezone = dashboardRange(new URLSearchParams(), now).timezone
  if (start === null && end === null) return { start: new Date(now.getTime() - 8 * 3600_000).toISOString(), end: now.toISOString(), timezone }
  function timestamp(value: string | null): number {
    if (!value || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) throw new HttpError(422, 'start i end muszą być datami ISO z sekundami i strefą Z albo offsetem.')
    dateValue(value.slice(0, 10))
    const result = Date.parse(value)
    if (!Number.isFinite(result)) throw new HttpError(422, 'Nieprawidłowy czas zmiany.')
    return result
  }
  const first = timestamp(start), last = timestamp(end)
  if (last <= first || last - first > 48 * 3600_000 || last > now.getTime()) throw new HttpError(422, 'Zmiana musi obejmować do 48 godzin i kończyć się nie później niż teraz.')
  return { start: new Date(first).toISOString(), end: new Date(last).toISOString(), timezone }
}

export async function shiftSummary(db: Db, query: URLSearchParams): Promise<ShiftSummaryResponse> {
  const window = shiftWindow(query)
  return db.transaction(async (tx) => {
    await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
    const bounds = [window.start, window.end]
    const where = 'ts >= $1::timestamptz AND ts < $2::timestamptz'
    const [metrics] = await tx.query<ShiftSummaryResponse['metrics']>(`SELECT ${PERIOD_METRICS} FROM audit_log WHERE ${where}`, bounds)
    const authors = await tx.query<ShiftSummaryResponse['authors'][number]>(`SELECT actor_id::text AS actor_id,
      (array_agg(actor ORDER BY ts DESC, id DESC))[1] AS actor,
      count(*) FILTER (WHERE ${ACTIVE_STOCK})::int AS stock_changes,
      count(*) FILTER (WHERE undo_of IS NOT NULL)::int AS undo_count FROM audit_log WHERE ${where}
      GROUP BY actor_id, CASE WHEN actor_id IS NULL THEN actor ELSE '' END ORDER BY actor, actor_id LIMIT 101`, bounds)
    const procedures = await tx.query<ShiftSummaryResponse['procedures_saved'][number]>(`SELECT id AS audit_id, item_name AS topic, actor, ${ISO_TS('ts')} AS ts
      FROM audit_log WHERE ${where} AND event_type = 'procedure_saved' ORDER BY audit_log.ts DESC, id DESC LIMIT 11`, bounds)
    const [current] = await tx.query<ShiftSummaryResponse['current']>(CURRENT_INVENTORY)
    return { window, metrics, authors: authors.slice(0, 100), authors_truncated: authors.length > 100,
      procedures_saved: procedures.slice(0, 10), procedures_truncated: procedures.length > 10, current, generated_at: new Date().toISOString() }
  })
}

export async function stockTrend(db: Db, itemId: number, query: URLSearchParams): Promise<StockTrendResponse> {
  const range = dashboardRange(query)
  const params = [range.from, range.to, range.timezone, itemId]
  return db.transaction(async (tx) => {
    await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
    const [item] = await tx.query<StockTrendResponse['item']>('SELECT id, name, unit, quantity, minimum FROM items WHERE id = $1', [itemId])
    if (!item) throw new HttpError(404, 'Nie ma takiego towaru.')
    const [anchor] = await tx.query<{ after: number }>(`SELECT after FROM audit_log WHERE item_id = $3 AND ${STOCK_EVENTS}
      AND ts < ($1::date::timestamp AT TIME ZONE $2) ORDER BY ts DESC, id DESC LIMIT 1`, [range.from, range.timezone, itemId])
    const rows = await tx.query<Omit<StockTrendResponse['points'][number], 'continuous'>>(`SELECT id AS audit_id, ${ISO_TS('ts')} AS ts,
      event_type, before, after, delta, undo_of, undone_by FROM audit_log WHERE ${IN_RANGE} AND item_id = $4 AND ${STOCK_EVENTS}
      ORDER BY audit_log.ts, id LIMIT 2001`, params)
    if (rows.length > 2000) throw new HttpError(422, 'Trend przekracza 2000 zdarzeń. Zawęź zakres dat.')
    const [latest] = await tx.query<{ after: number }>(`SELECT after FROM audit_log WHERE item_id = $1 AND ${STOCK_EVENTS} ORDER BY ts DESC, id DESC LIMIT 1`, [itemId])
    let quantity = anchor?.after ?? null
    let warnings = 0
    const points = rows.map((row) => {
      const continuous = quantity === null || quantity === row.before
      if (!continuous) warnings += 1
      quantity = row.after
      return { ...row, continuous }
    })
    const today = dashboardRange(new URLSearchParams('period=today')).to
    return { range, item, opening_quantity: anchor?.after ?? null, closing_quantity: range.to > today ? null : quantity, points,
      quality: { opening_known: anchor !== undefined, continuity_warnings: warnings, current_matches_latest_audit: latest ? latest.after === item.quantity : null, unit_is_current: true } }
  })
}
