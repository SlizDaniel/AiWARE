// Sektory na zmapowanej mapie: walidacja, CRUD, przypisania przedmiotów
// (rozmieszczenie — bez zmian stanów), kaskadowe usunięcie, audyt.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initDb } from './db'
import {
  assignSectorItem,
  deleteMapSector,
  listMapSectors,
  parseMapSectorInput,
  parseSectorAssignment,
  saveMapSector,
  unassignSectorItem,
} from './mapSectors'
import { createPgliteDb, type Db } from './sql'

const ACTOR = { name: 'Kierownik (bez logowania)', id: '00000000-0000-0000-0000-000000000001' }

let db: Db

beforeAll(async () => {
  db = await createPgliteDb(null)
  await initDb(db)
})

beforeEach(async () => {
  await db.exec('TRUNCATE map_sector_items, map_sectors, audit_log, items RESTART IDENTITY CASCADE')
})

describe('parseMapSectorInput', () => {
  it('przepuszcza poprawny sektor', () => {
    expect(parseMapSectorInput({ name: ' Sektor A1 ', x: 1.5, y: -2 })).toEqual({ name: 'Sektor A1', x: 1.5, y: -2 })
  })

  const invalid: [string, unknown][] = [
    ['brak nazwy', { x: 0, y: 0 }],
    ['pusta nazwa', { name: '  ', x: 0, y: 0 }],
    ['za długa nazwa', { name: 'x'.repeat(61), x: 0, y: 0 }],
    ['tekstowe współrzędne', { name: 'A', x: '1', y: 0 }],
    ['poza skalą', { name: 'A', x: 2000, y: 0 }],
    ['nie-obiekt', 'sektor'],
  ]

  for (const [label, body] of invalid) {
    it(`odrzuca: ${label}`, () => {
      try {
        parseMapSectorInput(body)
        expect.unreachable('oczekiwano HttpError 422')
      } catch (error) {
        expect((error as { status?: number }).status).toBe(422)
      }
    })
  }
})

describe('parseSectorAssignment', () => {
  it('przepuszcza liczby całkowite', () => {
    expect(parseSectorAssignment({ item_id: 2, quantity: 5 })).toEqual({ item_id: 2, quantity: 5 })
    expect(parseSectorAssignment({ item_id: 2, quantity: 0 })).toEqual({ item_id: 2, quantity: 0 })
  })

  it.each([
    ['nie-całkowita ilość', { item_id: 2, quantity: 1.5 }],
    ['ujemna ilość', { item_id: 2, quantity: -1 }],
    ['brak przedmiotu', { quantity: 1 }],
  ])('odrzuca: %s', (_label, body) => {
    try {
      parseSectorAssignment(body)
      expect.unreachable('oczekiwano HttpError 422')
    } catch (error) {
      expect((error as { status?: number }).status).toBe(422)
    }
  })
})

describe('sektory i przypisania', () => {
  it('zapisuje sektor, przypisuje przedmioty, listuje z pozycjami', async () => {
    const item = await db.query<{ id: number }>(
      "INSERT INTO items (name, quantity, minimum, unit, location) VALUES ('Kartony', 54, 12, 'szt', 'Strefa A-1') RETURNING id",
    )
    const itemId = item[0]!.id
    const sector = await saveMapSector(db, { name: 'Sektor A1', x: 1.2, y: -3.4 }, ACTOR)
    expect(sector.items).toEqual([])
    expect(sector.created).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)

    await assignSectorItem(db, sector.id, { item_id: itemId, quantity: 12 }, ACTOR)
    await assignSectorItem(db, sector.id, { item_id: itemId, quantity: 15 }, ACTOR) // upsert tej samej pozycji

    const listed = await listMapSectors(db)
    expect(listed).toHaveLength(1)
    expect(listed[0]!.items).toEqual([{ item_id: itemId, item_name: 'Kartony', unit: 'szt', quantity: 15 }])

    // stan magazynowy nietknięty — przypisanie to rozmieszczenie
    const stock = await db.query<{ quantity: number }>('SELECT quantity FROM items WHERE id = $1', [itemId])
    expect(stock[0]!.quantity).toBe(54)

    const audit = await db.query<{ event_type: string }>(
      "SELECT event_type FROM audit_log WHERE event_type LIKE '%sector%' ORDER BY id",
    )
    expect(audit.map((row) => row.event_type)).toEqual(['map_sector_created', 'sector_item_assigned', 'sector_item_assigned'])
  })

  it('usunięcie sektora kaskadowo czyści przypisania i loguje audyt', async () => {
    const item = await db.query<{ id: number }>(
      "INSERT INTO items (name, quantity, minimum, unit, location) VALUES ('Szkło', 20, 8, 'szt', 'Strefa B-2') RETURNING id",
    )
    const sector = await saveMapSector(db, { name: 'Sektor B2', x: 2, y: 2 }, ACTOR)
    await assignSectorItem(db, sector.id, { item_id: item[0]!.id, quantity: 3 }, ACTOR)
    await deleteMapSector(db, sector.id, ACTOR)
    expect(await listMapSectors(db)).toEqual([])
    const leftovers = await db.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM map_sector_items')
    expect(leftovers[0]!.count).toBe(0)
    const audit = await db.query<{ event_type: string }>(
      "SELECT event_type FROM audit_log WHERE event_type LIKE '%sector%' ORDER BY id",
    )
    expect(audit.map((row) => row.event_type)).toEqual(['map_sector_created', 'sector_item_assigned', 'map_sector_deleted'])
  })

  it('usuwanie przypisania i operacje na nieistniejącym sektorze → 404', async () => {
    const item = await db.query<{ id: number }>(
      "INSERT INTO items (name, quantity, minimum, unit, location) VALUES ('Folia', 15, 6, 'rolka', 'Strefa C-1') RETURNING id",
    )
    const sector = await saveMapSector(db, { name: 'Sektor C1', x: 0, y: 0 }, ACTOR)
    await assignSectorItem(db, sector.id, { item_id: item[0]!.id, quantity: 2 }, ACTOR)
    await unassignSectorItem(db, sector.id, item[0]!.id, ACTOR)
    expect((await listMapSectors(db))[0]!.items).toEqual([])
    await expect(unassignSectorItem(db, sector.id, item[0]!.id, ACTOR)).rejects.toMatchObject({ status: 404 })
    await expect(assignSectorItem(db, 9999, { item_id: item[0]!.id, quantity: 1 }, ACTOR)).rejects.toMatchObject({ status: 404 })
    await expect(deleteMapSector(db, 9999, ACTOR)).rejects.toMatchObject({ status: 404 })
  })
})
