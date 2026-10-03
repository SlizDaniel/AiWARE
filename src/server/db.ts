// Domain data layer — port of legacy/backend/app/db.py onto the async `Db`
// interface (Postgres SQL; Supabase in production, PGlite locally/in tests).
//
// Confirm-before-write: stock is written only by confirmStockChange (plus the
// proactive reorder draft when the stock drops below the minimum — card 08)
// and by undoAuditEntry; every other write (zone, item, procedure, order draft
// from the `draft_order` tool) runs only after a change card was confirmed.
//
// Returned objects keep the Python dict keys (snake_case): route handlers
// serialise them as-is, so the frontend contract is unchanged.
import { HttpError } from './http'
import { dateText, ensureSchema, nextTuesday, tsText, type Db, type Row } from './sql'
import type { ImportedItem } from './types'

// ---------------------------------------------------------------------- types

/** Who performed a write: display name for the audit + Supabase user id (UUID) or null. */
export type Actor = { name: string; id: string | null }

export const DEFAULT_ACTOR: Actor = { name: 'magazynier', id: null }
export const IMPORT_ACTOR: Actor = { name: 'import', id: null }

export type Item = {
  id: number
  name: string
  quantity: number
  minimum: number
  unit: string
  location: string
}

export type ReorderStatus = 'pending' | 'approved' | 'rejected'

export type ReorderDraft = {
  id: number
  item_id: number
  item_name: string
  quantity: number
  unit: string
  deliver_on: string
  status: ReorderStatus
  created_at: string
  updated_at: string
  decided_by: string | null
}

/** Result of the `draft_order` tool (Python create_reorder_draft). */
export type CreatedReorderDraft = {
  id: number
  item_id: number
  item_name: string
  quantity: number
  unit: string
  deliver_on: string
  status: ReorderStatus
  created: boolean
}

export type StockChangeResult = {
  audit_id: number
  item_id: number
  item_name: string
  delta: number
  before: number
  after: number
  reorder_draft: ReorderDraft | null
}

export type UndoResult = StockChangeResult & { undo_of: number }

export type AuditEntry = {
  id: number
  ts: string
  actor: string
  text: string
  item_name: string
  delta: number
  before: number
  after: number
  event_type: string
  details: string
  undo_of: number | null
  undone_by: number | null
}

export type LoggedEvent = { audit_id: number; event_type: string; item_name: string }

export type Zone = { id: number; name: string; created: string }
export type ZoneResult = { id: number; name: string; created: boolean }

export type Procedure = { id: number; topic: string; text: string; created: string }
export type ProcedureMatch = { id: number; topic: string; text: string }
export type ProcedureResult = { id: number; topic: string; text: string; updated: boolean }

export type AddItemResult = { id: number; name: string; created: boolean }

export type ImportResult = { inserted: number; updated: number; total: number }

export type PendingImport = { headers: string[]; rows: string[][] }

// ----------------------------------------------------------------- constants

export const DEFAULT_REORDER_QUANTITY = 50

/** Demo seed (card 01): at least 3 items, incl. „Kartony" stock 54, minimum 12. */
export const SEED_ITEMS: ReadonlyArray<readonly [name: string, quantity: number, minimum: number, unit: string, location: string]> = [
  ['Kartony', 54, 12, 'szt', 'Strefa A-1'],
  ['Szkło', 20, 8, 'szt', 'Strefa B-2'],
  ['Folia stretch', 15, 6, 'rolka', 'Strefa C-1'],
]

const ITEM_COLUMNS = 'id, name, quantity, minimum, unit, location'
const PENDING_IMPORT_TTL = "interval '1 hour'"
const PROPOSAL_TTL = "interval '1 day'"
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function draftColumns(): string {
  return [
    'id',
    'item_id',
    'item_name',
    'quantity',
    'unit',
    dateText('deliver_on'),
    'status',
    tsText('created_at'),
    tsText('updated_at'),
    'decided_by',
  ].join(', ')
}

/** audit_log.actor_id / proposals.created_by are UUID columns — anything else is stored as NULL. */
function uuidOrNull(id: string | null | undefined): string | null {
  return id && UUID_RE.test(id) ? id : null
}

async function one<T extends Row>(db: Db, text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await db.query<T>(text, params)
  return rows[0] ?? null
}

// ---------------------------------------------------------------------- init

/** Creates the schema and seeds SEED_ITEMS into an empty inventory. */
export async function initDb(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await ensureSchema(tx)
    // Serialise concurrent cold starts so the seed is inserted once.
    await tx.query('SELECT pg_advisory_xact_lock(724243)')
    const row = await one<{ count: number }>(tx, 'SELECT COUNT(*)::int AS count FROM items')
    if ((row?.count ?? 0) === 0) {
      for (const [name, quantity, minimum, unit, location] of SEED_ITEMS) {
        await tx.query(
          `INSERT INTO items (name, quantity, minimum, unit, location) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (name) DO NOTHING`,
          [name, quantity, minimum, unit, location],
        )
      }
    }
  })
}

// --------------------------------------------------------------------- items

export async function listItems(db: Db): Promise<Item[]> {
  // COLLATE "C" = code-point order, identical to SQLite's default BINARY ordering.
  return db.query<Item>(`SELECT ${ITEM_COLUMNS} FROM items ORDER BY name COLLATE "C"`)
}

export async function getItem(db: Db, itemId: number): Promise<Item | null> {
  return one<Item>(db, `SELECT ${ITEM_COLUMNS} FROM items WHERE id = $1`, [itemId])
}

/**
 * Insert new inventory rows and update existing rows by their (case-insensitive) name.
 * New rows without a minimum get the owner's default minimum (card 12); existing thresholds stay.
 */
export async function importItems(
  db: Db,
  items: ImportedItem[],
  actor: Actor = IMPORT_ACTOR,
  options: { defaultMinimum?: number } = {},
): Promise<ImportResult> {
  return db.transaction(async (tx) => {
    let inserted = 0
    let updated = 0
    const existingRows = await tx.query<Item>(`SELECT ${ITEM_COLUMNS} FROM items ORDER BY id FOR UPDATE`)
    const existingByName = new Map(existingRows.map((row) => [row.name.toLowerCase(), row]))

    for (const item of items) {
      const key = item.name.toLowerCase()
      const existing = existingByName.get(key) ?? null
      let itemRow: Item
      if (existing !== null) {
        const rows = await tx.query<Item>(
          `UPDATE items SET quantity = $1,
                 minimum = COALESCE($2::int, minimum),
                 unit = CASE WHEN $3::text IS NULL OR $3::text = '' THEN unit ELSE $3::text END,
                 location = COALESCE($4::text, location)
           WHERE id = $5
           RETURNING ${ITEM_COLUMNS}`,
          [item.quantity, item.minimum, item.unit, item.location, existing.id],
        )
        itemRow = rows[0]
        updated += 1
      } else {
        const rows = await tx.query<Item>(
          `INSERT INTO items (name, quantity, minimum, unit, location) VALUES ($1, $2, $3, $4, $5)
           RETURNING ${ITEM_COLUMNS}`,
          [item.name, item.quantity, item.minimum ?? options.defaultMinimum ?? 0, item.unit || 'szt', item.location || ''],
        )
        itemRow = rows[0]
        inserted += 1
      }

      const changedFields: string[] = []
      const fields: [string, 'minimum' | 'unit' | 'location'][] = [
        ['minimum', 'minimum'],
        ['jednostka', 'unit'],
        ['lokalizacja', 'location'],
      ]
      for (const [label, field] of fields) {
        const previous = existing !== null ? existing[field] : null
        const current = itemRow[field]
        if (previous !== current) {
          const previousDisplay = previous === null || previous === '' ? '—' : String(previous)
          const currentDisplay = current === null || current === '' ? '—' : String(current)
          changedFields.push(`${label}: ${previousDisplay}→${currentDisplay}`)
        }
      }
      if (existing === null) changedFields.unshift('nowa pozycja')

      const before = existing !== null ? existing.quantity : 0
      await tx.query(
        `INSERT INTO audit_log (actor, actor_id, text, item_id, item_name, delta, before, after, event_type, details)
         VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          actor.name,
          uuidOrNull(actor.id),
          'Import zatwierdzony',
          itemRow.id,
          itemRow.name,
          itemRow.quantity - before,
          before,
          itemRow.quantity,
          'inventory_import',
          changedFields.join('; ') || 'Dane pozycji potwierdzone importem.',
        ],
      )
      await syncPendingReorder(tx, {
        itemId: itemRow.id,
        itemName: itemRow.name,
        quantity: itemRow.quantity,
        minimum: itemRow.minimum,
        unit: itemRow.unit,
        source: 'imporcie',
        actor,
      })
      existingByName.set(key, itemRow)
    }
    return { inserted, updated, total: items.length }
  })
}

/** New item (card 02 recovery path: unknown item in a command → proposal to add it). */
export async function addItem(
  db: Db,
  args: { name: string; quantity?: number; unit?: string; minimum?: number; location?: string },
): Promise<AddItemResult> {
  const name = args.name.trim()
  return db.transaction(async (tx) => {
    const existing = await one<{ id: number }>(tx, 'SELECT id FROM items WHERE lower(name) = lower($1::text) ORDER BY id LIMIT 1', [name])
    if (existing !== null) return { id: existing.id, name, created: false }
    const row = await one<{ id: number }>(
      tx,
      `INSERT INTO items (name, quantity, minimum, unit, location) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (name) DO NOTHING RETURNING id`,
      [name, args.quantity ?? 0, args.minimum ?? 0, args.unit ?? 'szt', args.location ?? ''],
    )
    if (row === null) {
      // Lost a race with a concurrent insert of the same name.
      const raced = await one<{ id: number }>(tx, 'SELECT id FROM items WHERE name = $1', [name])
      return { id: raced?.id ?? 0, name, created: false }
    }
    return { id: row.id, name, created: true }
  })
}

// ------------------------------------------------------------- stock changes

export type StockSnapshot = Pick<Item, 'quantity' | 'name' | 'unit'>

export class StaleStockProposalError extends HttpError {
  constructor() {
    super(409, 'Dane towaru zmieniły się od pokazania karty. Nic nie zapisano. Odrzuć tę kartę i wyślij komendę ponownie, aby zatwierdzić aktualny stan.')
    this.name = 'StaleStockProposalError'
  }
}

type StockChangeArgs = { itemId: number; delta: number; text: string; actor?: Actor; expectedStock?: StockSnapshot }

/**
 * Atomically: stock change + audit entry. Returns the audit entry (or null when
 * the item does not exist). Below the minimum it creates a proactive order
 * draft in the approval queue (card 08) — never sent automatically.
 */
export async function confirmStockChange(db: Db, args: StockChangeArgs): Promise<StockChangeResult | null> {
  return db.transaction((tx) => applyStockChange(tx, { ...args, actor: args.actor ?? DEFAULT_ACTOR, undoOf: null }))
}

async function applyStockChange(
  tx: Db,
  args: StockChangeArgs & { actor: Actor; undoOf: number | null },
): Promise<StockChangeResult | null> {
  const row = await one<{ id: number; name: string; quantity: number; minimum: number; unit: string }>(
    tx,
    'SELECT id, name, quantity, minimum, unit FROM items WHERE id = $1 FOR UPDATE',
    [args.itemId],
  )
  if (row === null) return null
  // Sprawdzenie i zapis są pod tą samą blokadą rekordu. Inny pracownik/import
  // nie może zmienić danych pomiędzy porównaniem karty a aktualizacją zapasu.
  if (args.expectedStock && (row.quantity !== args.expectedStock.quantity ||
      row.unit !== args.expectedStock.unit || row.name !== args.expectedStock.name)) {
    throw new StaleStockProposalError()
  }
  const before = row.quantity
  const after = before + args.delta
  await tx.query('UPDATE items SET quantity = $1 WHERE id = $2', [after, args.itemId])
  const audit = await one<{ id: number }>(
    tx,
    `INSERT INTO audit_log (actor, actor_id, text, item_id, item_name, delta, before, after, undo_of)
     VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [args.actor.name, uuidOrNull(args.actor.id), args.text, args.itemId, row.name, args.delta, before, after, args.undoOf],
  )
  const draft = await syncPendingReorder(tx, {
    itemId: args.itemId,
    itemName: row.name,
    quantity: after,
    minimum: row.minimum,
    unit: row.unit,
    actor: args.actor,
  })
  return {
    audit_id: audit!.id,
    item_id: args.itemId,
    item_name: row.name,
    delta: args.delta,
    before,
    after,
    reorder_draft: draft,
  }
}

/**
 * Reverts one confirmed stock change by applying `-delta` (a compensating
 * entry — the log keeps both rows). Only plain 'stock_change' rows can be
 * undone, each at most once.
 */
export async function undoAuditEntry(db: Db, auditId: number, actor: Actor = DEFAULT_ACTOR): Promise<UndoResult> {
  return db.transaction(async (tx) => {
    const entry = await one<{
      id: number
      text: string
      item_id: number | null
      delta: number
      event_type: string
      undo_of: number | null
      undone_by: number | null
    }>(
      tx,
      'SELECT id, text, item_id, delta, event_type, undo_of, undone_by FROM audit_log WHERE id = $1 FOR UPDATE',
      [auditId],
    )
    if (entry === null) throw new HttpError(404, 'Nie ma takiego wpisu w historii.')
    if (entry.undone_by !== null) throw new HttpError(409, 'Ten wpis został już cofnięty.')
    if (entry.event_type !== 'stock_change' || entry.undo_of !== null || entry.item_id === null) {
      throw new HttpError(409, 'Tego wpisu nie można cofnąć.')
    }
    const result = await applyStockChange(tx, {
      itemId: entry.item_id,
      delta: -entry.delta,
      text: `Cofnięto: ${entry.text}`,
      actor,
      undoOf: entry.id,
    })
    if (result === null) throw new HttpError(409, 'Tego wpisu nie można cofnąć.')
    await tx.query('UPDATE audit_log SET undone_by = $1 WHERE id = $2', [result.audit_id, entry.id])
    return { ...result, undo_of: entry.id }
  })
}

// ------------------------------------------------------------ reorder drafts

/** Default order size for proactive drafts (setting reorder_default_quantity, fallback 50). */
async function reorderDefaultQuantity(db: Db): Promise<number> {
  const value = await getSetting<unknown>(db, 'reorder_default_quantity', DEFAULT_REORDER_QUANTITY)
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : DEFAULT_REORDER_QUANTITY
}

async function selectDraft(tx: Db, draftId: number): Promise<ReorderDraft | null> {
  return one<ReorderDraft>(tx, `SELECT ${draftColumns()} FROM reorder_drafts WHERE id = $1`, [draftId])
}

async function syncPendingReorder(
  tx: Db,
  args: {
    itemId: number
    itemName: string
    quantity: number
    minimum: number
    unit: string
    source?: string
    actor: Actor
  },
): Promise<ReorderDraft | null> {
  const source = args.source ?? 'zmianie stanu'
  const pending = await one<{ id: number; quantity: number; unit: string; deliver_on: string }>(
    tx,
    `SELECT id, quantity, unit, ${dateText('deliver_on')} FROM reorder_drafts
     WHERE item_id = $1 AND status = 'pending' FOR UPDATE`,
    [args.itemId],
  )
  if (args.quantity < args.minimum) {
    const orderQuantity = Math.max(await reorderDefaultQuantity(tx), args.minimum - args.quantity)
    if (pending !== null) {
      if (pending.quantity !== orderQuantity || pending.unit !== args.unit) {
        await tx.query(
          'UPDATE reorder_drafts SET quantity = $1, unit = $2, item_name = $3, updated_at = now() WHERE id = $4',
          [orderQuantity, args.unit, args.itemName, pending.id],
        )
        await writeOrderAudit(tx, {
          itemId: args.itemId,
          itemName: args.itemName,
          quantity: orderQuantity,
          unit: args.unit,
          deliverOn: pending.deliver_on,
          eventType: 'reorder_draft_updated',
          text: `Szkic zamówienia zaktualizowany po ${source}: ${args.itemName} — ${orderQuantity} ${args.unit}`,
          before: args.quantity,
          actor: args.actor,
        })
      }
      return null
    }

    const deliverOn = nextTuesday()
    const created = await one<{ id: number }>(
      tx,
      `INSERT INTO reorder_drafts (item_id, item_name, quantity, unit, deliver_on)
       VALUES ($1, $2, $3, $4, $5::date) RETURNING id`,
      [args.itemId, args.itemName, orderQuantity, args.unit, deliverOn],
    )
    await writeOrderAudit(tx, {
      itemId: args.itemId,
      itemName: args.itemName,
      quantity: orderQuantity,
      unit: args.unit,
      deliverOn,
      eventType: 'reorder_draft_created',
      text: `Szkic zamówienia: ${args.itemName} — ${orderQuantity} ${args.unit}`,
      before: args.quantity,
      actor: args.actor,
    })
    return selectDraft(tx, created!.id)
  }

  if (pending !== null) {
    await tx.query('DELETE FROM reorder_drafts WHERE id = $1', [pending.id])
    await writeOrderAudit(tx, {
      itemId: args.itemId,
      itemName: args.itemName,
      quantity: pending.quantity,
      unit: pending.unit,
      deliverOn: pending.deliver_on,
      eventType: 'reorder_cancelled',
      text: `Szkic zamówienia anulowany po ${source}: ${args.itemName}`,
      before: args.quantity,
      actor: args.actor,
    })
  }
  return null
}

async function writeOrderAudit(
  tx: Db,
  args: {
    itemId: number
    itemName: string
    quantity: number
    unit: string
    deliverOn: string
    eventType: string
    text: string
    before: number
    actor: Actor
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO audit_log (actor, actor_id, text, item_id, item_name, delta, before, after, event_type, details)
     VALUES ($1, $2::uuid, $3, $4, $5, 0, $6, $6, $7, $8)`,
    [
      args.actor.name,
      uuidOrNull(args.actor.id),
      args.text,
      args.itemId,
      args.itemName,
      args.before,
      args.eventType,
      `${args.quantity} ${args.unit}; dostawa ${args.deliverOn}`,
    ],
  )
}

export async function listReorderDrafts(db: Db): Promise<ReorderDraft[]> {
  return db.query<ReorderDraft>(
    `SELECT ${draftColumns()} FROM reorder_drafts
     ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, id DESC`,
  )
}

/** Approve/reject a pending draft (audited; never sent to an ERP). Null when not pending. */
export async function decideReorderDraft(
  db: Db,
  draftId: number,
  decision: 'approved' | 'rejected',
  actor: Actor = DEFAULT_ACTOR,
): Promise<ReorderDraft | null> {
  if (decision !== 'approved' && decision !== 'rejected') {
    throw new HttpError(422, 'Nieprawidłowa decyzja szkicu zamówienia')
  }
  return db.transaction(async (tx) => {
    const draft = await one<ReorderDraft>(
      tx,
      `SELECT ${draftColumns()} FROM reorder_drafts WHERE id = $1 AND status = 'pending' FOR UPDATE`,
      [draftId],
    )
    if (draft === null) return null
    // Only the writer that actually changed the pending status records the decision.
    const changed = await tx.query(
      `UPDATE reorder_drafts SET status = $1, decided_by = $2, updated_at = now()
       WHERE id = $3 AND status = 'pending' RETURNING id`,
      [decision, actor.name, draftId],
    )
    if (changed.length !== 1) return null
    const item = await one<{ quantity: number }>(tx, 'SELECT quantity FROM items WHERE id = $1', [draft.item_id])
    const decisionText = decision === 'approved' ? 'zatwierdzono' : 'odrzucono'
    await writeOrderAudit(tx, {
      itemId: draft.item_id,
      itemName: draft.item_name,
      quantity: draft.quantity,
      unit: draft.unit,
      deliverOn: draft.deliver_on,
      eventType: `reorder_${decision}`,
      text: `Szkic zamówienia ${decisionText}: ${draft.item_name} — ${draft.quantity} ${draft.unit}`,
      before: item?.quantity ?? 0,
      actor,
    })
    return (await selectDraft(tx, draftId)) ?? { ...draft, status: decision, decided_by: actor.name }
  })
}

/**
 * Order draft from the `draft_order` tool (card 02) — same queue as the
 * proactive reorder (card 08). Idempotent while a draft for the item is pending.
 * Null when the item does not exist.
 */
export async function createReorderDraft(
  db: Db,
  args: { itemId: number; quantity: number; actor?: Actor },
): Promise<CreatedReorderDraft | null> {
  const actor = args.actor ?? DEFAULT_ACTOR
  return db.transaction(async (tx) => {
    const item = await one<{ id: number; name: string; quantity: number; minimum: number; unit: string }>(
      tx,
      'SELECT id, name, quantity, minimum, unit FROM items WHERE id = $1 FOR UPDATE',
      [args.itemId],
    )
    if (item === null) return null
    const pending = await one<Omit<CreatedReorderDraft, 'created'>>(
      tx,
      `SELECT id, item_id, item_name, quantity, unit, ${dateText('deliver_on')}, status
       FROM reorder_drafts WHERE item_id = $1 AND status = 'pending'`,
      [args.itemId],
    )
    if (pending !== null) return { ...pending, created: false }
    const deliverOn = nextTuesday()
    // The item row lock already serialises writers; ON CONFLICT keeps the
    // partial unique index from turning any remaining race into an error.
    const created = await one<{ id: number }>(
      tx,
      `INSERT INTO reorder_drafts (item_id, item_name, quantity, unit, deliver_on)
       VALUES ($1, $2, $3, $4, $5::date)
       ON CONFLICT (item_id) WHERE status = 'pending' DO NOTHING RETURNING id`,
      [args.itemId, item.name, args.quantity, item.unit, deliverOn],
    )
    if (created === null) {
      const winner = await one<Omit<CreatedReorderDraft, 'created'>>(
        tx,
        `SELECT id, item_id, item_name, quantity, unit, ${dateText('deliver_on')}, status
         FROM reorder_drafts WHERE item_id = $1 AND status = 'pending'`,
        [args.itemId],
      )
      if (winner !== null) return { ...winner, created: false }
      throw new HttpError(409, 'Szkic zamówienia zmienił się w trakcie zapisu. Spróbuj ponownie.')
    }
    await writeOrderAudit(tx, {
      itemId: args.itemId,
      itemName: item.name,
      quantity: args.quantity,
      unit: item.unit,
      deliverOn,
      eventType: 'reorder_draft_created',
      text: `Szkic zamówienia: ${item.name} — ${args.quantity} ${item.unit}`,
      before: item.quantity,
      actor,
    })
    return {
      id: created.id,
      item_id: args.itemId,
      item_name: item.name,
      quantity: args.quantity,
      unit: item.unit,
      deliver_on: deliverOn,
      status: 'pending',
      created: true,
    }
  })
}

// --------------------------------------------------------------------- audit

export async function listAudit(db: Db, limit?: number): Promise<AuditEntry[]> {
  const params: unknown[] = []
  let limitSql = ''
  if (limit !== undefined) {
    params.push(Math.max(0, Math.trunc(limit)))
    limitSql = ' LIMIT $1'
  }
  return db.query<AuditEntry>(
    `SELECT id, ${tsText('ts')}, actor, text, item_name, delta, before, after, event_type, details, undo_of, undone_by
     FROM audit_log ORDER BY id DESC${limitSql}`,
    params,
  )
}

/**
 * Audit entry for changes other than stock (zone, new item, procedure). Numeric
 * columns stay neutral (item_id NULL, delta/before/after 0) — the history view
 * renders these rows by `event_type`, not by the delta.
 */
export async function logEvent(
  db: Db,
  args: { eventType: string; text: string; label: string; details?: string; actor?: Actor },
): Promise<LoggedEvent> {
  const actor = args.actor ?? DEFAULT_ACTOR
  const row = await one<{ id: number }>(
    db,
    `INSERT INTO audit_log (actor, actor_id, event_type, text, item_id, item_name, delta, before, after, details)
     VALUES ($1, $2::uuid, $3, $4, NULL, $5, 0, 0, 0, $6) RETURNING id`,
    [actor.name, uuidOrNull(actor.id), args.eventType, args.text, args.label, args.details ?? ''],
  )
  return { audit_id: row!.id, event_type: args.eventType, item_name: args.label }
}

// --------------------------------------------------------------------- zones

/** Zone named during the walk („strefa: X"). Idempotent by (case-insensitive) name. */
export async function addZone(db: Db, rawName: string): Promise<ZoneResult> {
  const name = rawName.trim()
  return db.transaction(async (tx) => {
    const existing = await one<{ id: number; name: string }>(
      tx,
      'SELECT id, name FROM zones WHERE lower(name) = lower($1::text) ORDER BY id LIMIT 1',
      [name],
    )
    if (existing !== null) return { id: existing.id, name: existing.name, created: false }
    const row = await one<{ id: number }>(tx, 'INSERT INTO zones (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING id', [name])
    if (row === null) {
      const raced = await one<{ id: number; name: string }>(tx, 'SELECT id, name FROM zones WHERE name = $1', [name])
      return { id: raced?.id ?? 0, name: raced?.name ?? name, created: false }
    }
    return { id: row.id, name, created: true }
  })
}

export async function listZones(db: Db): Promise<Zone[]> {
  return db.query<Zone>(`SELECT id, name, ${tsText('created')} FROM zones ORDER BY name COLLATE "C"`)
}

// ---------------------------------------------------------------- procedures

/** Saves/updates a procedure by topic (same topic → new text). */
export async function rememberProcedure(db: Db, args: { topic: string; text: string }): Promise<ProcedureResult> {
  const topic = args.topic.trim().toLowerCase()
  const text = args.text.trim()
  return db.transaction(async (tx) => {
    const row = await one<{ id: number }>(tx, 'SELECT id FROM procedures WHERE lower(topic) = lower($1::text) ORDER BY id LIMIT 1', [topic])
    if (row !== null) {
      await tx.query('UPDATE procedures SET text = $1 WHERE id = $2', [text, row.id])
      return { id: row.id, topic, text, updated: true }
    }
    const created = await one<{ id: number }>(
      tx,
      `INSERT INTO procedures (topic, text) VALUES ($1, $2)
       ON CONFLICT (topic) DO UPDATE SET text = EXCLUDED.text RETURNING id`,
      [topic, text],
    )
    return { id: created!.id, topic, text, updated: false }
  })
}

export async function listProcedures(db: Db): Promise<Procedure[]> {
  return db.query<Procedure>(`SELECT id, topic, text, ${tsText('created')} FROM procedures ORDER BY topic COLLATE "C"`)
}

/** Recall by a fragment of the topic OR of the procedure text (Unicode case-insensitive). */
export async function findProcedures(db: Db, query: string): Promise<ProcedureMatch[]> {
  const fragment = query.trim().toLowerCase()
  return db.query<ProcedureMatch>(
    `SELECT id, topic, text FROM procedures
     WHERE strpos(lower(topic), $1::text) > 0 OR strpos(lower(text), $1::text) > 0
     ORDER BY id DESC`,
    [fragment],
  )
}

// ------------------------------------------------- serverless state (new)

/** Persists an unconfirmed change card (proposal id = payload.id). Drops cards older than a day. */
export async function saveProposal(db: Db, proposal: { id: string } & Record<string, unknown>, createdBy: string | null): Promise<void> {
  await db.query(`DELETE FROM proposals WHERE created_at < now() - ${PROPOSAL_TTL}`)
  await db.query(
    `INSERT INTO proposals (id, payload, created_by) VALUES ($1, $2::text::jsonb, $3::uuid)
     ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, created_by = EXCLUDED.created_by`,
    [proposal.id, JSON.stringify(proposal), uuidOrNull(createdBy)],
  )
}

/** Atomically removes and returns a proposal — a second call for the same id gets null. */
export async function takeProposal<T = Record<string, unknown>>(db: Db, id: string): Promise<T | null> {
  const row = await one<{ payload: T }>(db, 'DELETE FROM proposals WHERE id = $1 RETURNING payload', [id])
  return row ? row.payload : null
}

/** Stores a parsed import file awaiting mapping confirmation; prunes ones older than 1 h. */
export async function savePendingImport(db: Db, id: string, headers: string[], rows: string[][]): Promise<void> {
  await db.query(`DELETE FROM pending_imports WHERE created_at < now() - ${PENDING_IMPORT_TTL}`)
  await db.query(
    `INSERT INTO pending_imports (id, headers, data_rows) VALUES ($1, $2::text::jsonb, $3::text::jsonb)
     ON CONFLICT (id) DO UPDATE SET headers = EXCLUDED.headers, data_rows = EXCLUDED.data_rows, created_at = now()`,
    [id, JSON.stringify(headers), JSON.stringify(rows)],
  )
}

export async function getPendingImport(db: Db, id: string): Promise<PendingImport | null> {
  const row = await one<{ headers: string[]; data_rows: string[][] }>(
    db,
    `SELECT headers, data_rows FROM pending_imports WHERE id = $1 AND created_at >= now() - ${PENDING_IMPORT_TTL}`,
    [id],
  )
  return row ? { headers: row.headers, rows: row.data_rows } : null
}

export async function deletePendingImport(db: Db, id: string): Promise<void> {
  await db.query('DELETE FROM pending_imports WHERE id = $1', [id])
}

export async function getSetting<T>(db: Db, key: string, fallback: T): Promise<T> {
  const row = await one<{ value: T }>(db, 'SELECT value FROM settings WHERE key = $1', [key])
  return row === null || row.value === null || row.value === undefined ? fallback : row.value
}

export async function setSetting(db: Db, key: string, value: unknown): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::text::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  )
}

/** Monotonic counter bumped after every write; clients poll it instead of a WebSocket. */
export async function getDataVersion(db: Db): Promise<number> {
  const row = await one<{ value: number }>(db, "SELECT value FROM app_meta WHERE key = 'data_version'")
  return row?.value ?? 0
}

export async function bumpDataVersion(db: Db): Promise<number> {
  const row = await one<{ value: number }>(
    db,
    `INSERT INTO app_meta (key, value) VALUES ('data_version', 1)
     ON CONFLICT (key) DO UPDATE SET value = app_meta.value + 1 RETURNING value`,
  )
  return row!.value
}
