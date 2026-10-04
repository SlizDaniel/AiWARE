import type { ManagerNotification, ManagerNotifications } from '@/lib/managerNotifications'
import { getSetting } from './db'
import { ISO_TS } from './dashboard'
import { HttpError } from './http'
import type { Db } from './sql'
const LIMIT = 100
const readKey = (userId: string) => `manager_notifications_read:${userId}`

/** Only committed data: no AI, proposal execution or inventory writes. */
export async function managerNotifications(db: Db, userId: string, now = new Date()): Promise<ManagerNotifications> {
  return db.transaction(async tx => {
    await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
    return collect(tx, userId, now)
  })
}
async function collect(db: Db, userId: string, now: Date): Promise<ManagerNotifications> {
  const timestamp = now.toISOString()
  const notices: ManagerNotification[] = []
  const stocks = await db.query<{ id: number; name: string; quantity: number; minimum: number; unit: string; event_id: number }>(`
    SELECT i.id, i.name, i.quantity, i.minimum, i.unit,
      coalesce((SELECT max(a.id) FROM audit_log a WHERE a.item_id = i.id
        AND a.event_type IN ('stock_change', 'inventory_import', 'inventory_item_updated')), 0)::int AS event_id
    FROM items i WHERE quantity <= 0 OR quantity < minimum
    ORDER BY quantity, i.id LIMIT 101`)
  for (const item of stocks) {
    const empty = item.quantity <= 0
    notices.push({ id: `stock:${item.id}:${item.quantity}:${item.minimum}:${item.event_id}`,
      kind: empty ? 'out_of_stock' : 'low_stock', priority: empty ? 'critical' : 'warning',
      title: empty ? `Brak towaru: ${item.name}` : `Zapas poniżej minimum: ${item.name}`,
      message: `Stan: ${item.quantity} ${item.unit}. Minimum: ${item.minimum} ${item.unit}. Sprawdź zapas i kolejkę zamówień.`,
      item_id: item.id, item_name: item.name, occurred_at: null, target: 'stany', read: false })
  }
  const orders = await db.query<{ id: number; item_id: number; item_name: string; created_at: string; critical: boolean }>(`
    SELECT id, item_id, item_name, ${ISO_TS('created_at')} AS created_at,
      created_at <= $1::timestamptz - interval '48 hours' AS critical FROM reorder_drafts
    WHERE status = 'pending' AND created_at <= $1::timestamptz - interval '24 hours'
    ORDER BY created_at, id LIMIT 101`, [timestamp])
  for (const order of orders) notices.push({ id: `order:${order.id}:${order.critical ? '48' : '24'}`,
    kind: 'overdue_order', priority: order.critical ? 'critical' : 'warning', title: `Zamówienie czeka: ${order.item_name}`,
    message: `Szkic #${order.id} oczekuje na decyzję ponad ${order.critical ? '48' : '24'} godzin. Zatwierdzenie szkicu nie wysyła zamówienia do dostawcy.`,
    item_id: order.item_id, item_name: order.item_name, occurred_at: order.created_at, target: 'kolejka', read: false })
  const changes = await db.query<{ id: number; item_id: number; item_name: string; delta: number; before: number; after: number; ts: string }>(`
    SELECT a.id, a.item_id, a.item_name, a.delta, a.before, a.after, ${ISO_TS('a.ts')} AS ts
    FROM audit_log a JOIN items i ON i.id = a.item_id
    WHERE a.event_type = 'stock_change' AND a.undo_of IS NULL AND a.undone_by IS NULL
      AND a.before > 0 AND a.delta < 0 AND -a.delta >= a.before * 0.5
      AND a.ts >= $1::timestamptz - interval '24 hours' AND a.ts <= $1::timestamptz
    ORDER BY a.ts DESC, a.id DESC LIMIT 101`, [timestamp])
  for (const change of changes) notices.push({ id: `withdrawal:${change.id}`, kind: 'large_withdrawal', priority: 'warning',
    title: `Duży ubytek: ${change.item_name}`, message: `Jedna zatwierdzona operacja zmieniła stan ${change.before} → ${change.after} (ubytek ${-change.delta}). Sprawdź wpis w historii.`,
    item_id: change.item_id, item_name: change.item_name, occurred_at: change.ts, target: 'historia', read: false })
  const stored = await getSetting<unknown>(db, readKey(userId), [])
  const read = new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [])
  notices.sort((a, b) => Number(b.priority === 'critical') - Number(a.priority === 'critical')
    || (b.occurred_at ?? '').localeCompare(a.occurred_at ?? '') || a.id.localeCompare(b.id))
  const notifications = notices.slice(0, LIMIT).map(notice => ({ ...notice, read: read.has(notice.id) }))
  return { generated_at: timestamp, notifications, unread_count: notifications.filter(n => !n.read).length,
    critical_count: notifications.filter(n => n.priority === 'critical').length, truncated: notices.length > LIMIT }
}

/** Per-manager read receipts, serialized through the settings row lock. */
export async function markNotificationsRead(db: Db, userId: string, body: unknown): Promise<void> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(422, 'Podaj ids jako listę powiadomień.')
  const ids = (body as { ids?: unknown }).ids
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > LIMIT || ids.some(id => typeof id !== 'string' || id.length > 150)) {
    throw new HttpError(422, 'ids: od 1 do 100 identyfikatorów powiadomień.')
  }
  await db.transaction(async tx => {
    const key = readKey(userId)
    await tx.query("INSERT INTO settings (key, value) VALUES ($1, '[]'::jsonb) ON CONFLICT (key) DO NOTHING", [key])
    const [row] = await tx.query<{ value: unknown }>('SELECT value FROM settings WHERE key = $1 FOR UPDATE', [key])
    const active = await collect(tx, userId, new Date())
    const allowed = new Set(active.notifications.map(n => n.id))
    if (ids.some(id => !allowed.has(id))) throw new HttpError(409, 'Powiadomienie zniknęło lub zmieniło się. Odśwież listę.')
    const previous = Array.isArray(row.value) ? row.value.filter((id): id is string => typeof id === 'string') : []
    const merged = [...new Set([...previous.filter(id => !ids.includes(id)), ...ids])].slice(-500)
    await tx.query('UPDATE settings SET value = $2::text::jsonb, updated_at = now() WHERE key = $1', [key, JSON.stringify(merged)])
  })
}
