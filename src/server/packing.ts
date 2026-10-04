import { MSG_FORBIDDEN } from './auth'
import { getItem, listItems, logEvent, type Actor } from './db'
import { HttpError } from './http'
import { tsText, type Db } from './sql'
import type { Role } from './types'

export type Packaging = { id: number; name: string; inventory_item_id: number | null }
export type PackingInput = { item_id: number; packaging_id: number; quantity_per_package: number; notes: string }
export type PackingRule = PackingInput & {
  id: number; topic: string; text: string; created: string; version: number; updated_by: string
  packaging_name: string; unit: string; location: string
  packaging_stock: { name: string; quantity: number; unit: string } | null
}

export function requirePackingManager(role?: Role): void {
  if (role !== 'kierownik') throw new HttpError(403, MSG_FORBIDDEN)
}

export async function listPackaging(db: Db): Promise<Packaging[]> {
  return db.query<Packaging>('SELECT id, name, inventory_item_id FROM packaging_types ORDER BY id')
}

export async function listPackingRules(db: Db): Promise<PackingRule[]> {
  const rows = await db.query<PackingInput & {
    id: number; topic: string; unit: string; location: string; packaging_name: string; version: number
    created: string; updated_by: string; stock_name: string | null; stock_quantity: number | null; stock_unit: string | null
  }>(`SELECT r.*, i.name AS topic, i.unit, i.location, p.name AS packaging_name,
      ${tsText('r.updated_at', 'created')}, s.name AS stock_name, s.quantity AS stock_quantity, s.unit AS stock_unit
      FROM packing_rules r JOIN items i ON i.id = r.item_id
      JOIN packaging_types p ON p.id = r.packaging_id LEFT JOIN items s ON s.id = p.inventory_item_id
      ORDER BY i.name`)
  return rows.map(({ stock_name, stock_quantity, stock_unit, ...r }) => ({
    ...r,
    text: `${r.topic}: ${r.quantity_per_package} ${r.unit} na opakowanie „${r.packaging_name}”.${r.notes ? ` ${r.notes}` : ''}`,
    packaging_stock: stock_name === null ? null : { name: stock_name, quantity: stock_quantity!, unit: stock_unit! },
  }))
}

export async function validatePacking(db: Db, raw: Record<string, unknown>): Promise<PackingInput> {
  for (const field of ['item_id', 'packaging_id', 'quantity_per_package']) {
    const value = raw[field]
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || (field === 'quantity_per_package' && value > 1000000)) {
      throw new HttpError(422, 'Produkt, opakowanie i ilość muszą być poprawnymi dodatnimi liczbami całkowitymi.')
    }
  }
  if (raw.notes !== undefined && (typeof raw.notes !== 'string' || raw.notes.length > 500)) {
    throw new HttpError(422, 'Uwagi mogą mieć najwyżej 500 znaków.')
  }
  const item = await getItem(db, raw.item_id as number)
  const packaging = (await listPackaging(db)).find((p) => p.id === raw.packaging_id)
  if (!item) throw new HttpError(422, 'Wybierz istniejący produkt.')
  if (!packaging) throw new HttpError(422, 'Wybierz opakowanie z zatwierdzonego katalogu.')
  if (packaging.inventory_item_id === item.id) throw new HttpError(422, 'Produkt nie może być swoim własnym opakowaniem.')
  const [existing] = await db.query<{ notes: string }>('SELECT notes FROM packing_rules WHERE item_id = $1', [item.id])
  return { item_id: item.id, packaging_id: packaging.id, quantity_per_package: raw.quantity_per_package as number,
    notes: raw.notes === undefined ? existing?.notes ?? '' : String(raw.notes).trim() }
}

// Every preview captures the rule and labels it shows. Confirm cannot overwrite a newer version.
async function snapshot(db: Db, input: PackingInput): Promise<string> {
  const item = (await getItem(db, input.item_id))!
  const packaging = (await listPackaging(db)).find((p) => p.id === input.packaging_id)!
  const [rule] = await db.query('SELECT * FROM packing_rules WHERE item_id = $1', [input.item_id])
  return JSON.stringify({ item: { name: item.name, unit: item.unit }, packaging, rule: rule ? {
    id: rule.id, version: rule.version, packaging_id: rule.packaging_id, quantity_per_package: rule.quantity_per_package, notes: rule.notes,
  } : null })
}

export async function previewPacking(db: Db, raw: Record<string, unknown>, role?: Role) {
  requirePackingManager(role)
  return db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(724245)')
    const input = await validatePacking(tx, raw)
    const item = (await getItem(tx, input.item_id))!
    const packaging = (await listPackaging(tx)).find((p) => p.id === input.packaging_id)!
    const [existing] = await tx.query<{ version: number }>('SELECT version FROM packing_rules WHERE item_id = $1', [input.item_id])
    if (raw.expected_version !== undefined && raw.expected_version !== (existing?.version ?? 0)) {
      throw new HttpError(409, 'Reguła zmieniła się podczas edycji. Wczytaj bieżącą regułę przed przygotowaniem karty.')
    }
    return { args: { ...input, expected: await snapshot(tx, input) },
      summary: `${existing ? `Aktualizacja reguły v${existing.version}` : 'Nowa reguła'}: ${item.name} — ${input.quantity_per_package} ${item.unit} na opakowanie „${packaging.name}”${input.notes ? ` — ${input.notes}` : ''}` }
  })
}

export async function savePacking(db: Db, raw: Record<string, unknown>, actor: Actor, role?: Role): Promise<Record<string, unknown>> {
  requirePackingManager(role)
  return db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(724245)')
    // Lock the product against concurrent renames/import updates until the preview check and save complete.
    const input = await validatePacking(tx, raw)
    await tx.query('SELECT id FROM items WHERE id = $1 FOR UPDATE', [input.item_id])
    if (typeof raw.expected !== 'string' || raw.expected !== await snapshot(tx, input)) {
      throw new HttpError(409, 'Reguła, produkt lub katalog zmieniły się. Przygotuj nową kartę i sprawdź jej treść.')
    }
    const before = (await listPackingRules(tx)).find((r) => r.item_id === input.item_id) ?? null
    await tx.query(`INSERT INTO packing_rules (item_id, packaging_id, quantity_per_package, notes, updated_by)
      VALUES ($1, $2, $3, $4, $5) ON CONFLICT (item_id) DO UPDATE SET
      packaging_id = EXCLUDED.packaging_id, quantity_per_package = EXCLUDED.quantity_per_package,
      notes = EXCLUDED.notes, version = packing_rules.version + 1, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [input.item_id, input.packaging_id, input.quantity_per_package, input.notes, actor.name])
    const after = (await listPackingRules(tx)).find((r) => r.item_id === input.item_id)!
    const audit = await logEvent(tx, { eventType: 'procedure_saved', text: after.text, label: after.topic,
      actor, details: JSON.stringify({ before, after }) })
    return { ...after, audit_id: audit.audit_id }
  })
}

export async function linkPackaging(db: Db, id: number, itemId: unknown, actor: Actor) {
  if (itemId !== null && (typeof itemId !== 'number' || !Number.isSafeInteger(itemId) || itemId < 1)) {
    throw new HttpError(422, 'Wybierz produkt opakowania lub brak powiązania.')
  }
  return db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(724245)')
    const before = (await listPackaging(tx)).find((p) => p.id === id)
    if (!before) throw new HttpError(404, 'Nieznane opakowanie.')
    if (itemId !== null && !await getItem(tx, itemId as number)) throw new HttpError(422, 'Produkt opakowania nie istnieje.')
    const [self] = await tx.query('SELECT id FROM packing_rules WHERE packaging_id = $1 AND item_id = $2', [id, itemId])
    if (self) throw new HttpError(422, 'Powiązanie sprawiłoby, że produkt byłby swoim własnym opakowaniem.')
    await tx.query('UPDATE packaging_types SET inventory_item_id = $2 WHERE id = $1', [id, itemId])
    await logEvent(tx, { eventType: 'packaging_link_updated', text: `Powiązanie opakowania „${before.name}” ze stanem`,
      label: before.name, actor, details: JSON.stringify({ before, after: { ...before, inventory_item_id: itemId } }) })
  })
}

function fold(text: string): string {
  return text.toLocaleLowerCase('pl').replaceAll('ł', 'l').normalize('NFKD').replace(/\p{M}/gu, '').trim().replace(/[?.!]$/u, '').trim()
}

/** Full product names only. Similar names must never select a different product. */
export function matchPackingName<T extends { name: string }>(text: string, rows: T[]): T[] {
  const query = fold(text)
  return rows.filter((r) => fold(r.name) === query)
}

export async function recallPacking(db: Db, topic: string): Promise<PackingRule[]> {
  const items = matchPackingName(topic, await listItems(db))
  if (items.length > 1) throw new HttpError(422, 'Pasuje kilka produktów. Podaj pełną nazwę produktu.')
  return items.length === 1 ? (await listPackingRules(db)).filter((r) => r.item_id === items[0].id) : []
}

export async function parsePacking(db: Db, text: string): Promise<Record<string, unknown>> {
  const match = /^zapami[eę]taj\s*:\s*(.+?)\s+pakujemy\s+po\s+(\d+)\s+(?:do|w)\s+(.+?)[.!]?$/iu.exec(text.trim())
  if (!match) throw new HttpError(422, 'Podaj produkt, ilość i opakowanie, np. „zapamiętaj: Szkło pakujemy po 2 w Duży karton”. Uwagi dodasz w formularzu reguły.')
  const products = matchPackingName(match[1], await listItems(db))
  const aliases: Record<string, string> = { koperty: 'Koperta', koperte: 'Koperta', kopercie: 'Koperta',
    'malego kartonu': 'Mały karton', 'malym kartonie': 'Mały karton',
    'duzego kartonu': 'Duży karton', 'duzym kartonie': 'Duży karton', 'folie stretch': 'Folia stretch', 'folii stretch': 'Folia stretch' }
  const packages = matchPackingName(aliases[fold(match[3])] ?? match[3], await listPackaging(db))
  if (products.length !== 1) throw new HttpError(422, 'Nie rozpoznano jednoznacznie produktu. Podaj jego pełną nazwę ze Stanów.')
  if (packages.length !== 1) throw new HttpError(422, 'Wybierz opakowanie: Koperta, Mały karton, Duży karton lub Folia stretch.')
  return { item_id: products[0].id, packaging_id: packages[0].id, quantity_per_package: Number(match[2]) }
}
