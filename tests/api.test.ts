// End-to-end contract of the HTTP API (port of legacy test_api.py / test_demo.py
// happy paths): real route handlers, real SQL, no network. Runs twice — on
// PGlite directly and through postgres.js over the Postgres wire protocol
// (pglite-socket), which is the code path production uses against Supabase.
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { setSessionReader } from '@/server/auth'
import { initDb } from '@/server/db'
import { createPgliteDb, createPostgresDb, type Db } from '@/server/sql'

import * as agentMode from '@/app/api/agent-mode/route'
import * as command from '@/app/api/command/route'
import * as exportRoute from '@/app/api/export/[format]/route'
import * as health from '@/app/api/health/route'
import * as history from '@/app/api/history/route'
import * as undo from '@/app/api/history/[id]/undo/route'
import * as importConfirm from '@/app/api/import/confirm/route'
import * as importPreview from '@/app/api/import/preview/route'
import * as me from '@/app/api/me/route'
import * as procedures from '@/app/api/procedures/route'
import * as confirm from '@/app/api/proposals/[id]/confirm/route'
import * as drafts from '@/app/api/reorder-drafts/route'
import * as approve from '@/app/api/reorder-drafts/[id]/approve/route'
import * as settings from '@/app/api/settings/route'
import * as stock from '@/app/api/stock/route'
import * as stt from '@/app/api/stt/route'
import * as users from '@/app/api/users/route'
import * as version from '@/app/api/version/route'
import * as zones from '@/app/api/zones/route'

type Json = Record<string, any>

const BASE = 'http://magazynier.test'
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) })
const post = (path: string, body?: unknown) =>
  new Request(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const put = (path: string, body: unknown) =>
  new Request(BASE + path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

async function ok(response: Response | Promise<Response>): Promise<Json> {
  const res = await response
  const payload = await res.json()
  expect(res.status, JSON.stringify(payload)).toBe(200)
  return payload
}

async function fails(response: Response | Promise<Response>, status: number): Promise<string> {
  const res = await response
  const payload = await res.json()
  expect(res.status, JSON.stringify(payload)).toBe(status)
  return payload.detail
}

const runCommand = (text: string) => ok(command.POST(post('/api/command', { text })))
const confirmCard = (id: string) => ok(confirm.POST(post(`/api/proposals/${id}/confirm`), params({ id })))
const kartony = async () => (await ok(stock.GET())).items.find((item: Json) => item.name === 'Kartony')

const store = globalThis as typeof globalThis & { __magazynierDb?: Promise<Db> }

const engines: [string, () => Promise<{ db: Db; close: () => Promise<void> }>][] = [
  ['PGlite', async () => ({ db: await createPgliteDb(null), close: async () => {} })],
  [
    'postgres.js → Postgres wire protocol',
    async () => {
      const pg = await PGlite.create()
      const port = 55_000 + Math.floor(Math.random() * 5_000)
      const server = new PGLiteSocketServer({ db: pg, port, host: '127.0.0.1' })
      await server.start()
      const db = createPostgresDb(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`)
      return { db, close: async () => { await server.stop(); await pg.close() } }
    },
  ],
]

describe.each(engines)('API on %s', (_name, open) => {
  let db: Db
  let close: () => Promise<void>

  beforeAll(async () => {
    ;({ db, close } = await open())
    await initDb(db)
    store.__magazynierDb = Promise.resolve(db)
  })

  afterAll(async () => {
    store.__magazynierDb = undefined
    await close()
  })

  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('GOOGLE_API_KEY', '')
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', '')
    vi.stubEnv('STT_API_KEY', '')
    vi.stubEnv('AUTH_DISABLED', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
    vi.stubEnv('DEMO_MODE', '0')
    setSessionReader(null)
  })

  test('demo path: command → card → confirm → audit → undo → import → reorder → map → procedures', async () => {
    const status = await ok(health.GET())
    expect(status).toMatchObject({ status: 'ok', mode: 'offline', auth_mode: 'disabled' })
    expect((await ok(me.GET())).user.role).toBe('kierownik')
    const v0 = (await ok(version.GET())).version

    // Tracer bullet: proposal touches nothing until confirmed.
    const card = await runCommand('wzięliśmy paletę kartonów')
    expect(card.type).toBe('proposal')
    expect(card.warning).toBe('Brak GEMINI_API_KEY — użyto parsera offline.')
    expect(card.proposal).toMatchObject({ tool: 'update_stock', summary: 'Kartony 54→52', before: 54, after: 52, delta: -2 })
    expect((await kartony()).quantity).toBe(54)

    const applied = await confirmCard(card.proposal.id)
    expect(applied).toMatchObject({ applied: true, before: 54, after: 52, item_name: 'Kartony' })
    expect((await kartony()).quantity).toBe(52)
    expect((await ok(version.GET())).version).toBeGreaterThan(v0)
    await fails(confirm.POST(post('/x'), params({ id: card.proposal.id })), 404)

    const [entry] = (await ok(history.GET())).entries
    expect(entry).toMatchObject({ event_type: 'stock_change', delta: -2, before: 54, after: 52, actor: 'Kierownik (bez logowania)' })
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)

    const undone = await ok(undo.POST(post('/x'), params({ id: String(entry.id) })))
    expect(undone).toMatchObject({ before: 52, after: 54, undo_of: entry.id })
    expect((await kartony()).quantity).toBe(54)
    await fails(undo.POST(post('/x'), params({ id: String(entry.id) })), 409)

    // Import (rule-based mapping offline), then re-import does not duplicate.
    const file = readFileSync('public/demo-offline.xlsx')
    const preview = await ok(
      importPreview.POST(new Request(`${BASE}/api/import/preview?filename=demo-offline.xlsx`, { method: 'POST', body: file })),
    )
    expect(preview.mapping_source).toBe('rules')
    expect(preview.missing_required).toEqual([])
    const mapping = Object.fromEntries(Object.entries(preview.mapping).map(([field, value]: [string, any]) => [field, value.column]))
    const imported = await ok(importConfirm.POST(post('/api/import/confirm', { import_id: preview.import_id, mapping })))
    expect(imported.total).toBeGreaterThan(0)
    expect((await kartony()).quantity).toBe(13)
    await fails(importConfirm.POST(post('/api/import/confirm', { import_id: preview.import_id, mapping })), 404)
    const itemCount = (await ok(stock.GET())).items.length

    const again = await ok(
      importPreview.POST(new Request(`${BASE}/api/import/preview?filename=demo-offline.xlsx`, { method: 'POST', body: file })),
    )
    const reimported = await ok(importConfirm.POST(post('/api/import/confirm', { import_id: again.import_id, mapping })))
    expect(reimported.inserted).toBe(0)
    expect((await ok(stock.GET())).items.length).toBe(itemCount)

    // Zones.
    for (const name of ['kartony', 'szkło', 'folia stretch']) {
      const zoneCard = await runCommand(`strefa: ${name}`)
      expect(zoneCard.proposal.tool).toBe('add_zone')
      await confirmCard(zoneCard.proposal.id)
    }
    expect((await ok(zones.GET())).zones.map((zone: Json) => zone.name).sort()).toEqual(['folia stretch', 'kartony', 'szkło'])

    // Below minimum → proactive reorder draft → manager approves.
    const below = await runCommand('wzięliśmy paletę kartonów')
    const belowApplied = await confirmCard(below.proposal.id)
    expect(belowApplied.after).toBe(11)
    expect(belowApplied.reorder_draft).toMatchObject({ item_name: 'Kartony', quantity: 50, status: 'pending' })
    expect(belowApplied.reorder_draft.deliver_on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const pending = (await ok(drafts.GET())).drafts.find((draft: Json) => draft.status === 'pending')
    expect(await ok(approve.POST(post('/x'), params({ id: String(pending.id) })))).toMatchObject({ approved: true, sent_to_erp: false })
    await fails(approve.POST(post('/x'), params({ id: String(pending.id) })), 404)

    // Questions answer without writing.
    expect((await runCommand('ile mamy szkła?')).type).toBe('answer')
    expect((await runCommand('gdzie leży szkło?')).text).toContain('Szkło leży w:')
    expect((await runCommand('kto wygrał mecz?')).type).toBe('unknown')

    // Procedures (prefix is stripped before parsing).
    const memory = await runCommand('Magu, zapamiętaj: szkło pakujemy z przekładkami')
    expect(memory.proposal.tool).toBe('remember_procedure')
    await confirmCard(memory.proposal.id)
    expect((await ok(procedures.GET())).procedures).toHaveLength(1)
    const recalled = await runCommand('Magu, jak pakujemy szkło?')
    expect(recalled).toMatchObject({ type: 'answer', tool: 'recall_procedure' })

    // Export is re-importable.
    const csv = await exportRoute.GET(new Request(`${BASE}/api/export/csv`), params({ format: 'csv' }))
    expect(csv.headers.get('content-type')).toContain('text/csv')
    expect(await csv.text()).toContain('Kartony;11')
    const xlsx = await exportRoute.GET(new Request(`${BASE}/api/export/xlsx`), params({ format: 'xlsx' }))
    expect(xlsx.headers.get('content-type')).toContain('spreadsheetml')
    await fails(exportRoute.GET(new Request(`${BASE}/api/export/pdf`), params({ format: 'pdf' })), 404)
  })

  test('agent mode, settings and STT fallback', async () => {
    expect(await ok(agentMode.PUT(put('/api/agent-mode', { mode: 'offline' })))).toMatchObject({ mode: 'offline', effective_mode: 'offline' })
    await fails(agentMode.PUT(put('/api/agent-mode', { mode: 'turbo' })), 422)
    expect((await runCommand('ile mamy kartonów?')).warning).toBeUndefined()
    await ok(agentMode.PUT(put('/api/agent-mode', { mode: 'llm' })))

    const patch = (body: unknown) =>
      new Request(BASE + '/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const saved = await ok(settings.PATCH(patch({ prefix: 'Gosiu', tts_enabled: true, default_minimum: 7 })))
    expect(saved).toMatchObject({ prefix: 'Gosiu', tts_enabled: true, default_minimum: 7, version: '0.3.0' })
    expect(saved.ai_usage.disclosure).toContain('Gemini')
    expect((await ok(settings.GET())).prefix).toBe('Gosiu')
    expect((await runCommand('Gosiu, ile mamy kartonów?')).type).toBe('answer')
    expect((await runCommand('Magu, wzięliśmy paletę kartonów')).message).toBe(
      'Aktualny prefix to „Gosiu”. Użyj go albo wpisz komendę bez prefixu.',
    )
    expect((await runCommand('wzięliśmy paletę nakrętek')).proposal.summary).toBe('Nowa pozycja: Nakrętek (0 szt, minimum 7)')
    expect(await ok(settings.PUT(put('/api/settings', { prefix: 'Magu', tts_enabled: false, default_minimum: 0 })))).toMatchObject({
      prefix: 'Magu',
    })
    await fails(settings.PATCH(patch({ reorder_default_quantity: 0 })), 422)
    await fails(settings.PATCH(patch({ prefix: 'Gosiu, ile' })), 422)

    await ok(settings.PATCH(patch({ voice_mode: 'text' })))
    const textOnly = new Request(`${BASE}/api/stt?filename=audio.webm`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm' },
      body: new Uint8Array([1, 2, 3]),
    })
    expect(await fails(stt.POST(textOnly), 503)).toBe('Tryb tekstowy — mikrofon wyłączony w Ustawieniach.')
    await ok(settings.PATCH(patch({ voice_mode: 'push_to_talk' })))

    const audio = new Request(`${BASE}/api/stt?filename=audio.webm`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm' },
      body: new Uint8Array([1, 2, 3]),
    })
    expect(await fails(stt.POST(audio), 503)).toContain('GEMINI_API_KEY')
  })

  // pglite-socket multiplexes one PGlite session and cannot interleave two open
  // transactions (row-lock waits never resolve), so this runs on PGlite only;
  // on real Postgres the FOR UPDATE row locks provide the same serialisation.
  test.skipIf(_name !== 'PGlite')('concurrent decisions on one draft: only the first is recorded (legacy cbafbe3/c6bac88)', async () => {
    const { createReorderDraft, listAudit } = await import('@/server/db')
    const [first, second] = await Promise.all([
      createReorderDraft(db, { itemId: 2, quantity: 30 }),
      createReorderDraft(db, { itemId: 2, quantity: 40 }),
    ])
    expect([first?.created, second?.created].sort()).toEqual([false, true])
    expect(first?.id).toBe(second?.id)
    const id = String(first!.id)
    const before = (await listAudit(db)).length
    const results = await Promise.all([
      approve.POST(post('/x'), params({ id })),
      approve.POST(post('/x'), params({ id })),
    ])
    expect(results.map((res) => res.status).sort()).toEqual([200, 404])
    expect((await listAudit(db)).length).toBe(before + 1)
  })

  test('roles: pracownik works on the floor, kierownik decides', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')

    setSessionReader(async () => null)
    expect(await fails(stock.GET(), 401)).toBe('Zaloguj się, aby kontynuować.')

    setSessionReader(async () => ({ id: '11111111-1111-4111-8111-111111111111', email: 'szefowa@firma.pl', metadata: { full_name: 'Anna Szefowa' } }))
    expect((await ok(me.GET())).user).toMatchObject({ role: 'kierownik', display_name: 'Anna Szefowa' })

    setSessionReader(async () => ({ id: '22222222-2222-4222-8222-222222222222', email: 'jan@firma.pl', metadata: {} }))
    expect((await ok(me.GET())).user.role).toBe('pracownik')

    // Worker: commands and confirming cards are allowed; audit records the author.
    const card = await runCommand('doszła paleta kartonów')
    await confirmCard(card.proposal.id)
    const [entry] = (await ok(history.GET())).entries
    expect(entry.actor).toBe('jan')

    // Manager-only actions.
    expect(await fails(undo.POST(post('/x'), params({ id: String(entry.id) })), 403)).toContain('kierownika')
    await fails(settings.PUT(put('/api/settings', { prefix: 'Hej' })), 403)
    await fails(agentMode.PUT(put('/api/agent-mode', { mode: 'offline' })), 403)
    await fails(users.GET(), 403)
    await fails(approve.POST(post('/x'), params({ id: '1' })), 403)
    await fails(
      importPreview.POST(new Request(`${BASE}/api/import/preview?filename=a.csv`, { method: 'POST', body: 'Nazwa;Ilość\nA;1' })),
      403,
    )

    setSessionReader(async () => ({ id: '11111111-1111-4111-8111-111111111111', email: 'szefowa@firma.pl', metadata: {} }))
    const list = (await ok(users.GET())).users
    expect(list.map((user: Json) => user.role).sort()).toEqual(['kierownik', 'pracownik'])
  })
})
