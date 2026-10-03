// Thresholds → proactive order drafts → approval queue (card 08) — port of
// legacy tests/test_reorder.py plus the sync paths (update, cancel, import).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmProposal, runCommand, type Proposal } from './commands'
import {
  confirmStockChange,
  decideReorderDraft,
  importItems,
  initDb,
  listAudit,
  listItems,
  listReorderDrafts,
  setSetting,
} from './db'
import { createPgliteDb, nextTuesday, type Db } from './sql'

const TABLES = 'items, audit_log, reorder_drafts, zones, procedures, proposals, pending_imports, settings, app_meta'
const MANAGER = { name: 'Kierownik', id: '22222222-2222-2222-2222-222222222222' }

let db: Db

beforeAll(async () => {
  vi.stubEnv('DEMO_MODE', '')
  vi.stubEnv('LLM_MODE', 'offline')
  db = await createPgliteDb(null)
  await initDb(db)
})

afterAll(() => {
  vi.unstubAllEnvs()
})

async function freshDb(kartony = 54): Promise<void> {
  await db.exec(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`)
  await initDb(db)
  await db.query("UPDATE items SET quantity = $1 WHERE name = 'Kartony'", [kartony])
}

beforeEach(async () => {
  await freshDb()
})

async function takePalette(): Promise<Record<string, unknown>> {
  const response = await runCommand(db, 'wzięliśmy paletę kartonów', { provider: null })
  if (response.type !== 'proposal') throw new Error(`expected proposal, got ${response.type}`)
  const proposal: Proposal = response.proposal
  return confirmProposal(db, proposal.id)
}

describe('proactive reorder (test_reorder.py)', () => {
  it('confirm below minimum creates one order draft and audit', async () => {
    await freshDb(13)
    const response = await runCommand(db, 'wzięliśmy paletę kartonów', { provider: null })
    if (response.type !== 'proposal') throw new Error('expected proposal')
    expect(await listReorderDrafts(db)).toEqual([])

    const result = await confirmProposal(db, response.proposal.id)
    const draft = result.reorder_draft as Record<string, unknown>
    expect(draft.quantity).toBe(50)
    expect(draft.status).toBe('pending')
    expect(draft.deliver_on).toBe(nextTuesday())
    expect(Object.keys(draft).sort()).toEqual(
      ['created_at', 'decided_by', 'deliver_on', 'id', 'item_id', 'item_name', 'quantity', 'status', 'unit', 'updated_at'].sort(),
    )
    expect(await listReorderDrafts(db)).toHaveLength(1)

    const entries = await listAudit(db)
    expect(entries.map((entry) => entry.event_type)).toEqual(['reorder_draft_created', 'stock_change'])
    expect(entries[0].details).toBe(`50 szt; dostawa ${nextTuesday()}`)
    expect(entries[0].text).toBe('Szkic zamówienia: Kartony — 50 szt')
  })

  it('equal to minimum does not create an order draft', async () => {
    await freshDb(14)
    await takePalette()
    const kartony = (await listItems(db)).find((item) => item.name === 'Kartony')!
    expect(kartony.quantity).toBe(12)
    expect(await listReorderDrafts(db)).toEqual([])
  })

  it('large shortfall scales order quantity to cover the minimum', async () => {
    await freshDb(13)
    await db.query("UPDATE items SET minimum = 80 WHERE name = 'Kartony'")
    const result = await takePalette()
    expect((result.reorder_draft as { quantity: number }).quantity).toBe(69)
  })

  it.each([
    ['approved', 'reorder_approved', 'zatwierdzono'],
    ['rejected', 'reorder_rejected', 'odrzucono'],
  ] as const)('decision %s is audited and never sent to an ERP', async (decision, eventType, word) => {
    await freshDb(13)
    const draft = (await takePalette()).reorder_draft as { id: number }

    const result = await decideReorderDraft(db, draft.id, decision, MANAGER)
    expect(result).not.toBeNull()
    expect(result!.status).toBe(decision)
    expect(result!.decided_by).toBe('Kierownik')
    expect((await listReorderDrafts(db))[0].status).toBe(decision)
    const [entry] = await listAudit(db)
    expect(entry.event_type).toBe(eventType)
    expect(entry.actor).toBe('Kierownik')
    expect(entry.text).toBe(`Szkic zamówienia ${word}: Kartony — 50 szt`)
    expect(entry.before).toBe(11)
    // a decided draft cannot be decided again (route → 404)
    expect(await decideReorderDraft(db, draft.id, decision, MANAGER)).toBeNull()
  })

  it('only one pending draft per item', async () => {
    await freshDb(13)
    await takePalette()
    await takePalette()
    const drafts = await listReorderDrafts(db)
    expect(drafts).toHaveLength(1)
    expect(drafts[0].status).toBe('pending')
  })
})

describe('pending draft sync', () => {
  it('updates the pending draft when the shortfall grows beyond the default', async () => {
    await db.query("UPDATE items SET quantity = 13, minimum = 60 WHERE name = 'Kartony'")
    await confirmStockChange(db, { itemId: 1, delta: -2, text: 'a' }) // 11 → order max(50, 49) = 50
    await confirmStockChange(db, { itemId: 1, delta: -4, text: 'b' }) // 7 → order max(50, 53) = 53
    const drafts = await listReorderDrafts(db)
    expect(drafts).toHaveLength(1)
    expect(drafts[0].quantity).toBe(53)
    const [entry] = await listAudit(db)
    expect(entry.event_type).toBe('reorder_draft_updated')
    expect(entry.text).toBe('Szkic zamówienia zaktualizowany po zmianie stanu: Kartony — 53 szt')
  })

  it('cancels the pending draft when stock is back at the minimum', async () => {
    await freshDb(13)
    await takePalette() // 11 < 12 → draft
    await confirmStockChange(db, { itemId: 1, delta: 2, text: 'doszła paleta kartonów' })
    expect(await listReorderDrafts(db)).toEqual([])
    const [entry] = await listAudit(db)
    expect(entry.event_type).toBe('reorder_cancelled')
    expect(entry.text).toBe('Szkic zamówienia anulowany po zmianie stanu: Kartony')
  })

  it('uses the reorder_default_quantity setting', async () => {
    await freshDb(13)
    await setSetting(db, 'reorder_default_quantity', 120)
    const result = await takePalette()
    expect((result.reorder_draft as { quantity: number }).quantity).toBe(120)
  })

  it('import below minimum creates a draft with the import source', async () => {
    const result = await importItems(db, [
      { name: 'kartony', quantity: 5, minimum: null, unit: null, location: null },
      { name: 'Taśma', quantity: 1, minimum: 4, unit: 'rolka', location: 'Strefa D' },
    ])
    expect(result).toEqual({ inserted: 1, updated: 1, total: 2 })
    const drafts = await listReorderDrafts(db)
    expect(drafts.map((draft) => [draft.item_name, draft.quantity, draft.unit])).toEqual([
      ['Taśma', 50, 'rolka'],
      ['Kartony', 50, 'szt'],
    ])
    await importItems(db, [{ name: 'Kartony', quantity: 40, minimum: null, unit: null, location: null }])
    const entries = await listAudit(db)
    expect(entries[0].text).toBe('Szkic zamówienia anulowany po imporcie: Kartony')
    expect(entries[1].event_type).toBe('inventory_import')
  })
})
