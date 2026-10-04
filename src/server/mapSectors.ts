// Sektory na zmapowanym rzucie hali: punkt w metrach + nazwa + przypisane
// przedmioty (gdzie co leży). Przypisanie NIE zmienia stanu magazynowego —
// to rozmieszczenie, stan siedzi w items; każda operacja trafia do audytu.
import { HttpError } from './http'
import { logEvent, type Actor } from './db'
import { tsText, type Db } from './sql'

export type MapSectorItem = { item_id: number; item_name: string; unit: string; quantity: number }

export type MapSectorRecord = {
  id: number
  name: string
  x: number
  y: number
  actor: string
  created: string
  items: MapSectorItem[]
}

export type MapSectorInput = { name: string; x: number; y: number }

const MAX_COORD_M = 1000
const MAX_QUANTITY = 1_000_000

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Waliduje ciało POST /api/map-sectors; HttpError(422) przy błędzie. */
export function parseMapSectorInput(body: unknown): MapSectorInput {
  if (typeof body !== 'object' || body === null) {
    throw new HttpError(422, 'Oczekiwano obiektu JSON z sektorem.')
  }
  const record = body as Record<string, unknown>
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  if (name.length === 0 || name.length > 60) {
    throw new HttpError(422, 'Nazwa sektora jest wymagana (1–60 znaków).')
  }
  if (!isFiniteNumber(record.x) || !isFiniteNumber(record.y)) {
    throw new HttpError(422, 'Sektor musi mieć liczbowe współrzędne x i y.')
  }
  if (Math.abs(record.x) > MAX_COORD_M || Math.abs(record.y) > MAX_COORD_M) {
    throw new HttpError(422, `Sektor musi leżeć w granicach ±${MAX_COORD_M} m od startu.`)
  }
  return { name, x: record.x, y: record.y }
}

export function parseSectorAssignment(body: unknown): { item_id: number; quantity: number } {
  if (typeof body !== 'object' || body === null) {
    throw new HttpError(422, 'Oczekiwano obiektu JSON z przypisaniem.')
  }
  const record = body as Record<string, unknown>
  if (!Number.isInteger(record.item_id) || (record.item_id as number) <= 0) {
    throw new HttpError(422, 'Wskaż przedmiot z magazynu.')
  }
  if (!Number.isInteger(record.quantity) || (record.quantity as number) < 0 || (record.quantity as number) > MAX_QUANTITY) {
    throw new HttpError(422, `Ilość musi być liczbą całkowitą 0–${MAX_QUANTITY}.`)
  }
  return { item_id: record.item_id as number, quantity: record.quantity as number }
}

const SECTOR_COLUMNS = `id, name, x, y, actor, ${tsText('created')}`

/** Sektory z przypisanymi przedmiotami (jedno zapytanie + scalenie w aplikacji). */
export async function listMapSectors(db: Db): Promise<MapSectorRecord[]> {
  const sectors = await db.query<Record<string, unknown>>(`SELECT ${SECTOR_COLUMNS} FROM map_sectors ORDER BY id`)
  const assignments = await db.query<{ sector_id: number; item_id: number; item_name: string; unit: string; quantity: number }>(
    `SELECT msi.sector_id, msi.item_id, msi.quantity, i.name AS item_name, i.unit
     FROM map_sector_items msi JOIN items i ON i.id = msi.item_id
     ORDER BY i.name COLLATE "C"`,
  )
  const bySector = new Map<number, MapSectorItem[]>()
  for (const row of assignments) {
    const list = bySector.get(row.sector_id) ?? []
    list.push({ item_id: row.item_id, item_name: row.item_name, unit: row.unit, quantity: row.quantity })
    bySector.set(row.sector_id, list)
  }
  return sectors.map((row) => ({
    id: row.id as number,
    name: row.name as string,
    x: row.x as number,
    y: row.y as number,
    actor: row.actor as string,
    created: row.created as string,
    items: bySector.get(row.id as number) ?? [],
  }))
}

export async function saveMapSector(db: Db, input: MapSectorInput, actor: Actor): Promise<MapSectorRecord> {
  return db.transaction(async (tx) => {
    const rows = await tx.query<Record<string, unknown>>(
      `INSERT INTO map_sectors (name, x, y, actor) VALUES ($1, $2, $3, $4) RETURNING ${SECTOR_COLUMNS}`,
      [input.name, input.x, input.y, actor.name],
    )
    await logEvent(tx, {
      eventType: 'map_sector_created',
      text: `Sektor „${input.name}” dodany na mapie`,
      label: input.name,
      details: `${input.x.toLocaleString('pl-PL')} m, ${input.y.toLocaleString('pl-PL')} m od startu`,
      actor,
    })
    const row = rows[0]!
    return { id: row.id as number, name: row.name as string, x: row.x as number, y: row.y as number, actor: row.actor as string, created: row.created as string, items: [] }
  })
}

export async function deleteMapSector(db: Db, id: number, actor: Actor): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx.query<Record<string, unknown>>(`DELETE FROM map_sectors WHERE id = $1 RETURNING ${SECTOR_COLUMNS}`, [id])
    if (rows.length === 0) throw new HttpError(404, 'Nie znaleziono sektora do usunięcia.')
    const removed = rows[0]!
    await logEvent(tx, {
      eventType: 'map_sector_deleted',
      text: `Sektor „${removed.name}” usunięty z mapy`,
      label: removed.name as string,
      details: '',
      actor,
    })
  })
}

/** Dodaje/aktualizuje przypisanie przedmiotu do sektora (ilość = rozmieszczenie, nie stan). */
export async function assignSectorItem(
  db: Db,
  sectorId: number,
  assignment: { item_id: number; quantity: number },
  actor: Actor,
): Promise<MapSectorRecord> {
  return db.transaction(async (tx) => {
    const sector = await oneSector(tx, sectorId)
    const item = await tx.query<{ id: number; name: string; unit: string }>(
      'SELECT id, name, unit FROM items WHERE id = $1',
      [assignment.item_id],
    )
    if (item.length === 0) throw new HttpError(404, 'Nie znaleziono przedmiotu o podanym id.')
    await tx.query(
      `INSERT INTO map_sector_items (sector_id, item_id, quantity) VALUES ($1, $2, $3)
       ON CONFLICT (sector_id, item_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
      [sectorId, assignment.item_id, assignment.quantity],
    )
    await logEvent(tx, {
      eventType: 'sector_item_assigned',
      text: `${item[0]!.name}: ${assignment.quantity} ${item[0]!.unit} → sektor „${sector.name}”`,
      label: sector.name,
      details: `ilość w sektorze: ${assignment.quantity} ${item[0]!.unit}`,
      actor,
    })
    return sector
  })
}

export async function unassignSectorItem(db: Db, sectorId: number, itemId: number, actor: Actor): Promise<MapSectorRecord> {
  return db.transaction(async (tx) => {
    const sector = await oneSector(tx, sectorId)
    const rows = await tx.query<{ name: string; unit: string; quantity: number }>(
      `DELETE FROM map_sector_items WHERE sector_id = $1 AND item_id = $2
       RETURNING quantity, (SELECT name FROM items WHERE id = $2) AS name, (SELECT unit FROM items WHERE id = $2) AS unit`,
      [sectorId, itemId],
    )
    if (rows.length === 0) throw new HttpError(404, 'Ten przedmiot nie jest przypisany do sektora.')
    await logEvent(tx, {
      eventType: 'sector_item_unassigned',
      text: `${rows[0]!.name}: usunięto z sektora „${sector.name}”`,
      label: sector.name,
      details: `było: ${rows[0]!.quantity} ${rows[0]!.unit}`,
      actor,
    })
    return sector
  })
}

async function oneSector(db: Db, id: number): Promise<MapSectorRecord> {
  const rows = await db.query<Record<string, unknown>>(`SELECT ${SECTOR_COLUMNS} FROM map_sectors WHERE id = $1`, [id])
  if (rows.length === 0) throw new HttpError(404, 'Nie znaleziono sektora.')
  const row = rows[0]!
  return { id: row.id as number, name: row.name as string, x: row.x as number, y: row.y as number, actor: row.actor as string, created: row.created as string, items: [] }
}
