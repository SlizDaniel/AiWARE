// Domain data layer: seed, import audit, listings and the serverless state
// tables (proposals, pending imports, settings, data_version).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  addItem,
  addZone,
  bumpDataVersion,
  deletePendingImport,
  getDataVersion,
  getItem,
  getPendingImport,
  getSetting,
  importItems,
  initDb,
  listAudit,
  listItems,
  listProcedures,
  listZones,
  logEvent,
  rememberProcedure,
  findProcedures,
  savePendingImport,
  saveProposal,
  setSetting,
  takeProposal,
} from './db'
import { createPgliteDb, type Db } from './sql'

const TABLES = 'items, audit_log, reorder_drafts, zones, procedures, proposals, pending_imports, settings, app_meta'
const TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

let db: Db

beforeAll(async () => {
  db = await createPgliteDb(null)
  await initDb(db)
})

beforeEach(async () => {
  await db.exec(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`)
  await initDb(db)
})

describe('init and items', () => {
  it('seeds once and is idempotent', async () => {
    await initDb(db)
    const items = await listItems(db)
    expect(items).toEqual([
      { id: 3, name: 'Folia stretch', quantity: 15, minimum: 6, unit: 'rolka', location: 'Strefa C-1' },
      { id: 1, name: 'Kartony', quantity: 54, minimum: 12, unit: 'szt', location: 'Strefa A-1' },
      { id: 2, name: 'Szkło', quantity: 20, minimum: 8, unit: 'szt', location: 'Strefa B-2' },
    ])
  })

  it('does not re-seed an emptied-but-used inventory with data', async () => {
    await db.query("DELETE FROM items WHERE name <> 'Kartony'")
    await initDb(db)
    expect((await listItems(db)).map((item) => item.name)).toEqual(['Kartony'])
  })

  it('getItem returns the row or null', async () => {
    expect(await getItem(db, 2)).toEqual({ id: 2, name: 'Szkło', quantity: 20, minimum: 8, unit: 'szt', location: 'Strefa B-2' })
    expect(await getItem(db, 999)).toBeNull()
  })

  it('addItem is idempotent case-insensitively', async () => {
    expect(await addItem(db, { name: ' Śruby ', quantity: 5, unit: 'kg', minimum: 2, location: 'R1' })).toEqual({
      id: 4,
      name: 'Śruby',
      created: true,
    })
    expect(await addItem(db, { name: 'ŚRUBY' })).toEqual({ id: 4, name: 'ŚRUBY', created: false })
    expect(await getItem(db, 4)).toMatchObject({ quantity: 5, unit: 'kg', minimum: 2, location: 'R1' })
  })
})

describe('importItems', () => {
  it('inserts and updates by case-insensitive name and audits the changed fields', async () => {
    const result = await importItems(
      db,
      [
        { name: 'KARTONY', quantity: 60, minimum: 20, unit: '', location: null },
        { name: 'Taśma', quantity: 7, minimum: null, unit: null, location: 'Strefa D' },
      ],
      { name: 'Kierownik', id: '44444444-4444-4444-4444-444444444444' },
    )
    expect(result).toEqual({ inserted: 1, updated: 1, total: 2 })

    const kartony = await getItem(db, 1)
    expect(kartony).toEqual({ id: 1, name: 'Kartony', quantity: 60, minimum: 20, unit: 'szt', location: 'Strefa A-1' })
    const tasma = (await listItems(db)).find((item) => item.name === 'Taśma')!
    expect(tasma).toMatchObject({ quantity: 7, minimum: 0, unit: 'szt', location: 'Strefa D' })

    const entries = await listAudit(db)
    expect(entries).toHaveLength(2)
    const [tasmaEntry, kartonyEntry] = entries
    expect(kartonyEntry).toMatchObject({
      actor: 'Kierownik',
      text: 'Import zatwierdzony',
      item_name: 'Kartony',
      delta: 6,
      before: 54,
      after: 60,
      event_type: 'inventory_import',
      details: 'minimum: 12→20',
    })
    // exactly like Python: an empty location on a new item still reports —→—
    expect(tasmaEntry).toMatchObject({
      item_name: 'Taśma',
      delta: 7,
      before: 0,
      after: 7,
      details: 'nowa pozycja; minimum: —→0; jednostka: —→szt; lokalizacja: —→Strefa D',
    })
  })

  it('an unchanged row gets the confirmation detail', async () => {
    await importItems(db, [{ name: 'Szkło', quantity: 20, minimum: null, unit: null, location: null }])
    const [entry] = await listAudit(db)
    expect(entry.details).toBe('Dane pozycji potwierdzone importem.')
    expect(entry.actor).toBe('import')
  })

  it('rolls back the whole import on failure', async () => {
    await expect(
      importItems(db, [
        { name: 'Nowa', quantity: 1, minimum: null, unit: null, location: null },
        { name: 'Zła', quantity: Number.NaN, minimum: null, unit: null, location: null },
      ]),
    ).rejects.toThrow()
    expect((await listItems(db)).map((item) => item.name)).not.toContain('Nowa')
    expect(await listAudit(db)).toEqual([])
  })
})

describe('audit, zones, procedures', () => {
  it('logEvent writes a neutral row with item_id NULL', async () => {
    const event = await logEvent(db, { eventType: 'zone_added', text: 'strefa: rampa', label: 'rampa' })
    expect(event).toEqual({ audit_id: 1, event_type: 'zone_added', item_name: 'rampa' })
    const [entry] = await listAudit(db)
    expect(Object.keys(entry)).toEqual([
      'id',
      'ts',
      'actor',
      'text',
      'item_name',
      'delta',
      'before',
      'after',
      'event_type',
      'details',
      'undo_of',
      'undone_by',
    ])
    expect(entry).toMatchObject({ actor: 'magazynier', delta: 0, before: 0, after: 0, details: '' })
    expect(entry.ts).toMatch(TS)
    const rows = await db.query<{ item_id: number | null; actor_id: string | null }>('SELECT item_id, actor_id FROM audit_log')
    expect(rows[0]).toEqual({ item_id: null, actor_id: null })
  })

  it('a non-UUID actor id is stored as NULL instead of failing', async () => {
    await logEvent(db, { eventType: 'x', text: 'x', label: 'x', actor: { name: 'local', id: 'not-a-uuid' } })
    const rows = await db.query<{ actor_id: string | null }>('SELECT actor_id FROM audit_log')
    expect(rows[0].actor_id).toBeNull()
  })

  it('listAudit honours a limit', async () => {
    for (const label of ['a', 'b', 'c']) await logEvent(db, { eventType: 'x', text: label, label })
    expect((await listAudit(db, 2)).map((entry) => entry.text)).toEqual(['c', 'b'])
  })

  it('zones are listed by name with a timestamp', async () => {
    await addZone(db, 'rampa')
    await addZone(db, 'Biuro')
    const zones = await listZones(db)
    expect(zones.map((zone) => zone.name)).toEqual(['Biuro', 'rampa'])
    expect(zones[0].created).toMatch(TS)
  })

  it('procedures: topic lowercased, listed by topic, found by fragment', async () => {
    expect(await rememberProcedure(db, { topic: ' SZKŁO ', text: ' Owijamy folią ' })).toEqual({
      id: 1,
      topic: 'szkło',
      text: 'Owijamy folią',
      updated: false,
    })
    await rememberProcedure(db, { topic: 'kartony', text: 'Składamy po 10 sztuk' })
    const listed = await listProcedures(db)
    expect(listed.map((procedure) => procedure.topic)).toEqual(['kartony', 'szkło'])
    expect(listed[0].created).toMatch(TS)
    expect(await findProcedures(db, 'FOLIĄ')).toEqual([{ id: 1, topic: 'szkło', text: 'Owijamy folią' }])
    expect((await findProcedures(db, '')).map((procedure) => procedure.id)).toEqual([2, 1])
  })
})

describe('serverless state', () => {
  it('proposals are taken exactly once', async () => {
    const proposal = { id: 'abc', tool: 'add_zone', text: 'strefa: rampa', args: { name: 'rampa' }, summary: 'Nowa strefa: rampa' }
    await saveProposal(db, proposal, '55555555-5555-5555-5555-555555555555')
    const rows = await db.query<{ created_by: string }>('SELECT created_by::text AS created_by FROM proposals')
    expect(rows[0].created_by).toBe('55555555-5555-5555-5555-555555555555')
    expect(await takeProposal(db, 'abc')).toEqual(proposal)
    expect(await takeProposal(db, 'abc')).toBeNull()
    expect(await takeProposal(db, 'missing')).toBeNull()
  })

  it('stale proposals are pruned on save', async () => {
    await saveProposal(db, { id: 'old' }, null)
    await db.query("UPDATE proposals SET created_at = now() - interval '2 days'")
    await saveProposal(db, { id: 'new' }, null)
    expect(await takeProposal(db, 'old')).toBeNull()
    expect(await takeProposal(db, 'new')).toEqual({ id: 'new' })
  })

  it('pending imports round-trip, expire after an hour and can be deleted', async () => {
    const headers = ['Nazwa', 'Ilość']
    const rows = [
      ['Kartony', '10'],
      ['Szkło „B”', '5'],
    ]
    await savePendingImport(db, 'imp1', headers, rows)
    expect(await getPendingImport(db, 'imp1')).toEqual({ headers, rows })

    await db.query("UPDATE pending_imports SET created_at = now() - interval '61 minutes' WHERE id = 'imp1'")
    expect(await getPendingImport(db, 'imp1')).toBeNull()
    await savePendingImport(db, 'imp2', headers, rows)
    expect((await db.query('SELECT id FROM pending_imports')).map((row) => row.id)).toEqual(['imp2'])

    await deletePendingImport(db, 'imp2')
    expect(await getPendingImport(db, 'imp2')).toBeNull()
  })

  it('settings store JSON values with a fallback', async () => {
    expect(await getSetting(db, 'agent_prefix', 'Magu')).toBe('Magu')
    await setSetting(db, 'agent_prefix', 'Gosiu')
    await setSetting(db, 'complex', { a: [1, 'ż'], b: true })
    expect(await getSetting(db, 'agent_prefix', 'Magu')).toBe('Gosiu')
    expect(await getSetting(db, 'complex', null)).toEqual({ a: [1, 'ż'], b: true })
    await setSetting(db, 'agent_prefix', 'Ala')
    expect(await getSetting(db, 'agent_prefix', 'Magu')).toBe('Ala')
    await setSetting(db, 'flag', false)
    expect(await getSetting(db, 'flag', true)).toBe(false)
  })

  it('data_version starts at 0 and increments', async () => {
    expect(await getDataVersion(db)).toBe(0)
    expect(await bumpDataVersion(db)).toBe(1)
    expect(await bumpDataVersion(db)).toBe(2)
    expect(await getDataVersion(db)).toBe(2)
  })
})
