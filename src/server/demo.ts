// Isolated, persistent offline rehearsal database and its explicit reset —
// port of legacy/backend/app/demo.py.
import { bumpDataVersion } from './db'
import { ensureSchema, type Db } from './sql'

export const DEMO_PROCEDURE = 'Szkło owijamy folią, wkładamy do kartonów z przekładkami; towar leży w Strefie B-2.'

// Rehearsal values stay fixed even if the regular seed changes elsewhere.
export const DEMO_ITEMS: ReadonlyArray<readonly [name: string, quantity: number, minimum: number, unit: string, location: string]> = [
  ['Kartony', 13, 12, 'szt', 'Strefa A-1'],
  ['Szkło', 20, 8, 'szt', 'Strefa B-2'],
  ['Folia stretch', 15, 6, 'rolka', 'Strefa C-1'],
]

export const NOT_DEMO_DATABASE =
  'Baza nie jest bazą demo. Wskaż osobną bazę przez DEMO_DATABASE_URL (albo katalog PGLITE_DEMO_DIR).'

/** Domain tables whose content would be wiped by a demo (re)seed. */
const APP_TABLES = ['items', 'audit_log', 'reorder_drafts', 'zones', 'procedures', 'packing_rules'] as const
/** Tables cleared on (re)seed — rehearsal state, not users or settings. */
const RESET_TABLES = ['audit_log', 'reorder_drafts', 'zones', 'procedures', 'packing_rules', 'packaging_types', 'proposals', 'pending_imports', 'map_paths', 'items']

async function seedDemoPacking(db: Db): Promise<void> {
  await db.exec(`INSERT INTO packaging_types (name) VALUES ('Koperta'), ('Mały karton'), ('Duży karton'), ('Folia stretch') ON CONFLICT (name) DO NOTHING`)
  // Only the shipped, unchanged demo note has a known structured replacement.
  await db.query(`INSERT INTO packing_rules (item_id, packaging_id, quantity_per_package, notes, updated_by)
    SELECT i.id, p.id, 1, 'Owiń folią i dodaj przekładki.', 'Demo — reguła wzorcowa'
    FROM items i CROSS JOIN packaging_types p
    WHERE i.name = 'Szkło' AND p.name = 'Duży karton'
      AND EXISTS (SELECT 1 FROM procedures WHERE topic = 'szkło' AND text = $1)
    ON CONFLICT (item_id) DO NOTHING`, [DEMO_PROCEDURE])
}

async function tableExists(db: Db, table: string): Promise<boolean> {
  const rows = await db.query<{ found: boolean }>('SELECT to_regclass($1::text) IS NOT NULL AS found', [table])
  return rows[0]?.found === true
}

async function holdsAppData(db: Db): Promise<boolean> {
  for (const table of APP_TABLES) {
    if (!(await tableExists(db, table))) continue
    const rows = await db.query<{ has: boolean }>(`SELECT EXISTS (SELECT 1 FROM ${table}) AS has`)
    if (rows[0]?.has === true) return true
  }
  return false
}

/**
 * Seeds only a new (or already-demo) database; never takes ownership of
 * regular data. With reset=true the rehearsal state is wiped and re-seeded.
 */
export async function initDemoDb(db: Db, options: { reset: boolean } = { reset: false }): Promise<void> {
  const reseeded = await db.transaction(async (tx) => {
    // Serialise concurrent cold starts / a reset running next to the app.
    await tx.query('SELECT pg_advisory_xact_lock(724244)')
    const alreadySeeded = await tableExists(tx, 'demo_metadata')
    if (!alreadySeeded && (await holdsAppData(tx))) throw new Error(NOT_DEMO_DATABASE)
    await ensureSchema(tx)
    if (alreadySeeded && !options.reset) { await seedDemoPacking(tx); return false }

    await tx.exec(`TRUNCATE ${RESET_TABLES.join(', ')} RESTART IDENTITY CASCADE`)
    for (const [name, quantity, minimum, unit, location] of DEMO_ITEMS) {
      await tx.query('INSERT INTO items (name, quantity, minimum, unit, location) VALUES ($1, $2, $3, $4, $5)', [
        name,
        quantity,
        minimum,
        unit,
        location,
      ])
    }
    await tx.query('INSERT INTO procedures (topic, text) VALUES ($1, $2)', ['szkło', DEMO_PROCEDURE])
    await seedDemoPacking(tx)
    await tx.exec(`UPDATE packaging_types SET inventory_item_id = (SELECT id FROM items WHERE name = 'Kartony') WHERE name = 'Duży karton';
      UPDATE packaging_types SET inventory_item_id = (SELECT id FROM items WHERE name = 'Folia stretch') WHERE name = 'Folia stretch';`)
    await tx.exec(`
      CREATE TABLE IF NOT EXISTS demo_metadata (version INTEGER NOT NULL);
      ALTER TABLE demo_metadata ENABLE ROW LEVEL SECURITY;
      DELETE FROM demo_metadata;
      INSERT INTO demo_metadata VALUES (1);
    `)
    return true
  })
  // Polling clients refresh after a reset.
  if (reseeded) await bumpDataVersion(db)
}

/** Explicit reset of the rehearsal (scripts/demo-reset.ts). */
export async function resetDemoDb(db: Db): Promise<void> {
  await initDemoDb(db, { reset: true })
}
