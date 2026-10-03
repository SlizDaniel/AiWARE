// Prepares the Supabase Postgres database and checks the connection:
// creates the schema (idempotent), seeds an empty inventory, verifies RLS.
//   npm run db:setup
// Never prints the password or the full connection string.
import { existsSync, readFileSync } from 'node:fs'

for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}

const url = (process.env.DATABASE_URL || process.env.POSTGRES_URL || '').trim()
if (!url) {
  console.error('Brak DATABASE_URL. Supabase → Connect → Transaction pooler → skopiuj adres do .env (z hasłem bazy).')
  process.exit(2)
}

let parsed: URL
try {
  parsed = new URL(url)
} catch {
  console.error('DATABASE_URL nie jest poprawnym adresem. Znaki specjalne w haśle zakoduj w URL (np. @ → %40, # → %23).')
  process.exit(2)
}
if (parsed.password === '[YOUR-PASSWORD]' || parsed.password === '%5BYOUR-PASSWORD%5D') {
  console.error('W DATABASE_URL zostało „[YOUR-PASSWORD]” — wpisz hasło bazy (Project Settings → Database → Reset password).')
  process.exit(2)
}
console.log(`Łączę z ${parsed.hostname}:${parsed.port || '5432'} jako ${decodeURIComponent(parsed.username)}…`)
if (/^db\.[a-z0-9]+\.supabase\.co$/.test(parsed.hostname)) {
  console.warn('Uwaga: to „Direct connection” (IPv6). Vercel jej nie obsłuży — użyj „Transaction pooler” (port 6543).')
}

const { createPostgresDb } = await import('../src/server/sql')
const { initDb, listItems } = await import('../src/server/db')

function hint(message: string): string {
  if (/password authentication failed/i.test(message)) return 'Złe hasło bazy. Zresetuj je w Project Settings → Database i popraw DATABASE_URL.'
  if (/tenant or user not found/i.test(message)) return 'Pooler nie zna użytkownika. Login musi mieć postać postgres.<ref-projektu> (skopiuj adres z „Connect”).'
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) return 'Nie znaleziono hosta. Sprawdź adres albo połączenie z internetem.'
  if (/ENETUNREACH|EHOSTUNREACH|ETIMEDOUT|CONNECT_TIMEOUT/i.test(message)) return 'Brak połączenia. „Direct connection” wymaga IPv6 — użyj „Transaction pooler”.'
  return 'Sprawdź DATABASE_URL (Supabase → Connect → Transaction pooler).'
}

try {
  const db = createPostgresDb(url)
  const [{ version }] = await db.query<{ version: string }>('SELECT version()')
  console.log(`Połączono: ${version.split(',')[0]}`)
  await initDb(db)
  const tables = await db.query<{ tablename: string; rowsecurity: boolean }>(
    `SELECT tablename, rowsecurity FROM pg_tables
     WHERE schemaname = 'public' AND tablename = ANY($1::text[]) ORDER BY tablename`,
    [['items', 'audit_log', 'reorder_drafts', 'zones', 'procedures', 'proposals', 'pending_imports', 'settings', 'app_meta', 'profiles', 'rate_limits']],
  )
  const missingRls = tables.filter((table) => !table.rowsecurity).map((table) => table.tablename)
  console.log(`Tabele (${tables.length}/11): ${tables.map((table) => table.tablename).join(', ')}`)
  console.log(missingRls.length ? `UWAGA: RLS wyłączone dla: ${missingRls.join(', ')}` : 'RLS włączone na wszystkich tabelach.')
  const items = await listItems(db)
  const [{ count }] = await db.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM profiles')
  console.log(`Pozycje w magazynie: ${items.length} · konta (profile): ${count}`)
  console.log('Baza Supabase gotowa. Uruchom ponownie `npm run dev`, a na Vercelu ustaw tę samą DATABASE_URL.')
  process.exit(tables.length === 11 && missingRls.length === 0 ? 0 : 1)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Błąd połączenia: ${message.replace(url, '<DATABASE_URL>')}`)
  console.error(hint(message))
  process.exit(1)
}
