// History undo (card 06): undo is a compensating entry, never a deletion.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { confirmStockChange, getItem, initDb, listAudit, listReorderDrafts, logEvent, undoAuditEntry } from './db'
import { HttpError } from './http'
import { createPgliteDb, type Db } from './sql'

const TABLES = 'items, audit_log, reorder_drafts, zones, procedures, proposals, pending_imports, settings, app_meta'
const MANAGER = { name: 'Kierownik', id: '66666666-6666-6666-6666-666666666666' }

let db: Db

beforeAll(async () => {
  db = await createPgliteDb(null)
  await initDb(db)
})

beforeEach(async () => {
  await db.exec(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`)
  await initDb(db)
})

async function expectHttpError(promise: Promise<unknown>, status: number, detail: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(HttpError)
  expect((error as HttpError).status).toBe(status)
  expect((error as HttpError).detail).toBe(detail)
}

describe('undoAuditEntry', () => {
  it('write → undo → write keeps a consistent history', async () => {
    const change = await confirmStockChange(db, { itemId: 1, delta: -2, text: 'wzięliśmy paletę kartonów' })
    const undo = await undoAuditEntry(db, change!.audit_id, MANAGER)
    expect(undo).toEqual({
      audit_id: 2,
      item_id: 1,
      item_name: 'Kartony',
      delta: 2,
      before: 52,
      after: 54,
      reorder_draft: null,
      undo_of: 1,
    })
    expect((await getItem(db, 1))!.quantity).toBe(54)

    await confirmStockChange(db, { itemId: 1, delta: 4, text: 'doszły dwie palety' })
    const entries = await listAudit(db)
    expect(entries.map((entry) => [entry.id, entry.text, entry.delta, entry.undo_of, entry.undone_by])).toEqual([
      [3, 'doszły dwie palety', 4, null, null],
      [2, 'Cofnięto: wzięliśmy paletę kartonów', 2, 1, null],
      [1, 'wzięliśmy paletę kartonów', -2, null, 2],
    ])
    expect(entries[1].actor).toBe('Kierownik')
    expect(entries[1].event_type).toBe('stock_change')
    expect((await getItem(db, 1))!.quantity).toBe(58)
  })

  it('is relative: later changes are kept, not overwritten', async () => {
    const first = await confirmStockChange(db, { itemId: 2, delta: -4, text: 'a' }) // 20 → 16
    await confirmStockChange(db, { itemId: 2, delta: 10, text: 'b' }) // 16 → 26
    const undo = await undoAuditEntry(db, first!.audit_id, MANAGER)
    expect([undo.before, undo.after]).toEqual([26, 30])
  })

  it('an entry can be undone only once', async () => {
    const change = await confirmStockChange(db, { itemId: 1, delta: -2, text: 'x' })
    await undoAuditEntry(db, change!.audit_id, MANAGER)
    await expectHttpError(undoAuditEntry(db, change!.audit_id, MANAGER), 409, 'Ten wpis został już cofnięty.')
    expect((await getItem(db, 1))!.quantity).toBe(54)
  })

  it('an undo entry itself cannot be undone', async () => {
    const change = await confirmStockChange(db, { itemId: 1, delta: -2, text: 'x' })
    const undo = await undoAuditEntry(db, change!.audit_id, MANAGER)
    await expectHttpError(undoAuditEntry(db, undo.audit_id, MANAGER), 409, 'Tego wpisu nie można cofnąć.')
  })

  it('non stock entries cannot be undone', async () => {
    const event = await logEvent(db, { eventType: 'zone_added', text: 'strefa: rampa', label: 'rampa' })
    await expectHttpError(undoAuditEntry(db, event.audit_id, MANAGER), 409, 'Tego wpisu nie można cofnąć.')
  })

  it('reorder audit rows cannot be undone', async () => {
    await confirmStockChange(db, { itemId: 1, delta: -45, text: 'x' }) // draft created → audit id 2
    const [draftEntry] = await listAudit(db)
    expect(draftEntry.event_type).toBe('reorder_draft_created')
    await expectHttpError(undoAuditEntry(db, draftEntry.id, MANAGER), 409, 'Tego wpisu nie można cofnąć.')
  })

  it('a missing entry is 404', async () => {
    await expectHttpError(undoAuditEntry(db, 999, MANAGER), 404, 'Nie ma takiego wpisu w historii.')
  })

  it('undo runs the reorder sync like a normal change', async () => {
    const change = await confirmStockChange(db, { itemId: 1, delta: -45, text: 'duże wydanie' }) // 9 < 12
    expect(change!.reorder_draft).not.toBeNull()
    await undoAuditEntry(db, change!.audit_id, MANAGER) // back to 54
    expect(await listReorderDrafts(db)).toEqual([])
    const [entry] = await listAudit(db)
    expect(entry.event_type).toBe('reorder_cancelled')
    expect(entry.actor).toBe('Kierownik')

    // undoing a delivery that drops stock below the minimum proposes an order
    await db.query('UPDATE items SET quantity = 10 WHERE id = 1')
    const delivery = await confirmStockChange(db, { itemId: 1, delta: 4, text: 'dostawa' }) // 14
    const undo = await undoAuditEntry(db, delivery!.audit_id, MANAGER) // 10 < 12
    expect(undo.reorder_draft).toMatchObject({ quantity: 50, status: 'pending' })
  })

  it('is atomic: a failed undo leaves no trace', async () => {
    const change = await confirmStockChange(db, { itemId: 1, delta: -2, text: 'x' })
    await db.query('DELETE FROM items WHERE id = 1')
    await expectHttpError(undoAuditEntry(db, change!.audit_id, MANAGER), 409, 'Tego wpisu nie można cofnąć.')
    const entries = await listAudit(db)
    expect(entries).toHaveLength(1)
    expect(entries[0].undone_by).toBeNull()
  })
})
