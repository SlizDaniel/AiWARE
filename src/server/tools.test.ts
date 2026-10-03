// Agent tool registry (card 02) — port of legacy tests/test_tools.py.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { confirmStockChange, initDb, listAudit, listReorderDrafts, listZones } from './db'
import { createPgliteDb, nextTuesday, type Db } from './sql'
import { TOOL_REGISTRY, ToolError, UnknownToolError, callTool } from './tools'

const TABLES = 'items, audit_log, reorder_drafts, zones, procedures, proposals, pending_imports, settings, app_meta'

const TOOLS_Z_PRD = [
  'get_stock',
  'update_stock',
  'check_reorder',
  'draft_order',
  'get_location',
  'add_zone',
  'remember_procedure',
  'recall_procedure',
]

let db: Db

beforeAll(async () => {
  db = await createPgliteDb(null)
  await initDb(db)
})

beforeEach(async () => {
  await db.exec(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`)
  await initDb(db)
})

describe('registry', () => {
  it('contains all eight PRD tools', () => {
    for (const name of TOOLS_Z_PRD) expect(TOOL_REGISTRY).toHaveProperty(name)
  })

  it('every tool has kind, description and an object JSON schema', () => {
    for (const spec of Object.values(TOOL_REGISTRY)) {
      expect(['read', 'write']).toContain(spec.kind)
      expect(spec.description).toBeTruthy()
      expect(spec.parameters.type).toBe('object')
    }
  })

  it('keeps the Python schemas', () => {
    expect(TOOL_REGISTRY.update_stock.parameters).toEqual({
      type: 'object',
      properties: {
        item_id: { type: 'integer' },
        delta: { type: 'integer', description: 'Zmiana stanu, może być ujemna' },
        text: { type: 'string', description: 'Oryginalna komenda do audytu' },
      },
      required: ['item_id', 'delta'],
    })
    expect(TOOL_REGISTRY.get_stock.parameters).toEqual({
      type: 'object',
      properties: { item_id: { type: 'integer', description: 'ID pozycji; brak = cały magazyn' } },
      required: [],
    })
  })
})

describe('tools on a real database', () => {
  it('get_stock single and all', async () => {
    const single = (await callTool(db, 'get_stock', { item_id: 1 })) as { item: { name: string; quantity: number } }
    expect(single.item.name).toBe('Kartony')
    expect(single.item.quantity).toBe(54)

    const everything = (await callTool(db, 'get_stock')) as { items: { name: string }[] }
    expect(everything.items.map((item) => item.name)).toEqual(expect.arrayContaining(['Kartony', 'Szkło', 'Folia stretch']))
  })

  it('update_stock writes state and audit', async () => {
    const result = await callTool(db, 'update_stock', { item_id: 1, delta: -2, text: 'wzięliśmy paletę kartonów' })
    expect(result.after).toBe(52)
    const [entry] = await listAudit(db)
    expect(entry.event_type).toBe('stock_change')
    expect(entry.item_name).toBe('Kartony')
    expect(entry.text).toBe('wzięliśmy paletę kartonów')
  })

  it('update_stock records the actor from the context', async () => {
    await callTool(
      db,
      'update_stock',
      { item_id: 1, delta: 2, text: 'doszła paleta' },
      { actor: { name: 'Ala', id: '11111111-1111-1111-1111-111111111111' } },
    )
    const [entry] = await listAudit(db)
    expect(entry.actor).toBe('Ala')
    const rows = await db.query<{ actor_id: string }>('SELECT actor_id::text AS actor_id FROM audit_log')
    expect(rows[0].actor_id).toBe('11111111-1111-1111-1111-111111111111')
  })

  it('update_stock on a missing item raises a ToolError', async () => {
    await expect(callTool(db, 'update_stock', { item_id: 999, delta: 1, text: 'x' })).rejects.toBeInstanceOf(ToolError)
  })

  it('check_reorder flags below minimum', async () => {
    const above = await callTool(db, 'check_reorder', { item_id: 1 })
    expect(above.below_minimum).toBe(false)

    await confirmStockChange(db, { itemId: 1, delta: -45, text: 'test progu' })
    const below = await callTool(db, 'check_reorder', { item_id: 1 })
    expect(below.below_minimum).toBe(true)
    expect(below.quantity).toBe(9)
    expect(below.minimum).toBe(12)
    expect(below.suggested_quantity).toBe(3)
  })

  it('draft_order persists with status pending', async () => {
    const draft = await callTool(db, 'draft_order', { item_id: 1, quantity: 50 })
    expect(draft.status).toBe('pending')
    expect(draft.deliver_on).toBe(nextTuesday())

    const rows = await listReorderDrafts(db)
    expect(rows).toHaveLength(1)
    expect(rows[0].quantity).toBe(50)
    expect(rows[0].item_name).toBe('Kartony')
    expect(rows[0].deliver_on).toBe(nextTuesday())
    expect(rows[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('draft_order is idempotent while pending', async () => {
    const first = await callTool(db, 'draft_order', { item_id: 1, quantity: 50 })
    const again = await callTool(db, 'draft_order', { item_id: 1, quantity: 30 })
    expect(first.created).toBe(true)
    expect(again.created).toBe(false)
    expect(again.id).toBe(first.id)
    expect(await listReorderDrafts(db)).toHaveLength(1)
  })

  it('draft_order on a missing item raises a ToolError', async () => {
    await expect(callTool(db, 'draft_order', { item_id: 999, quantity: 5 })).rejects.toThrow('Pozycja nie istnieje w bazie')
  })

  it('get_location returns the zone', async () => {
    const location = await callTool(db, 'get_location', { item_id: 2 })
    expect(location.item_name).toBe('Szkło')
    expect(location.location).toBe('Strefa B-2')
    expect(await callTool(db, 'get_location', { item_id: 999 })).toEqual({})
  })

  it('add_zone is idempotent', async () => {
    const first = await callTool(db, 'add_zone', { name: 'kartony' })
    expect(first.created).toBe(true)

    const again = await callTool(db, 'add_zone', { name: 'kartony' })
    expect(again.created).toBe(false)
    expect(again.id).toBe(first.id)

    const sameButUpper = await callTool(db, 'add_zone', { name: '  KARTONY ' })
    expect(sameButUpper.created).toBe(false)

    expect((await listZones(db)).map((zone) => zone.name)).toEqual(['kartony'])
  })

  it('remember and recall a procedure', async () => {
    await callTool(db, 'remember_procedure', { topic: 'szkło', text: 'szkło pakujemy w kartony Y, strefa C2' })

    const hit = (await callTool(db, 'recall_procedure', { topic: 'szkło' })) as { procedures: { text: string }[] }
    expect(hit.procedures[0].text.startsWith('szkło pakujemy')).toBe(true)

    // search by a fragment of the procedure text
    const fragment = (await callTool(db, 'recall_procedure', { topic: 'pakujemy' })) as { procedures: unknown[] }
    expect(fragment.procedures).toHaveLength(1)

    // Polish uppercase is folded too
    const upper = (await callTool(db, 'recall_procedure', { topic: 'SZKŁO' })) as { procedures: unknown[] }
    expect(upper.procedures).toHaveLength(1)

    expect(await callTool(db, 'recall_procedure', { topic: 'elektronika' })).toEqual({ procedures: [] })
  })

  it('remember_procedure updates an existing topic', async () => {
    await callTool(db, 'remember_procedure', { topic: 'szkło', text: 'stara wersja' })
    const second = await callTool(db, 'remember_procedure', { topic: 'Szkło', text: 'nowa wersja' })
    expect(second.updated).toBe(true)

    const procedures = ((await callTool(db, 'recall_procedure', { topic: 'szkło' })) as { procedures: { text: string }[] })
      .procedures
    expect(procedures).toHaveLength(1)
    expect(procedures[0].text).toBe('nowa wersja')
  })

  it('add_item adds once with defaults', async () => {
    const first = await callTool(db, 'add_item', { name: 'Taśma' })
    expect(first).toEqual({ id: 4, name: 'Taśma', created: true })
    const again = await callTool(db, 'add_item', { name: 'TAŚMA', quantity: 3 })
    expect(again).toEqual({ id: 4, name: 'TAŚMA', created: false })
    const rows = await db.query('SELECT name, quantity, unit, minimum, location FROM items WHERE id = 4')
    expect(rows[0]).toEqual({ name: 'Taśma', quantity: 0, unit: 'szt', minimum: 0, location: '' })
  })

  it('unknown tool raises', async () => {
    await expect(callTool(db, 'nie_ma_takiego')).rejects.toBeInstanceOf(UnknownToolError)
    await expect(callTool(db, 'constructor')).rejects.toBeInstanceOf(UnknownToolError)
  })
})
