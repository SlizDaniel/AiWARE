// Command → change card → confirm → audit (PRD seam 3) — port of the command,
// confirm and agent-mode behaviour of legacy tests/test_api.py and the
// contract part of tests/test_llm_registry.py (fake LLMProvider).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { HINTS, LLM_FALLBACK_WARNING, NO_KEY_COMMAND_WARNING, confirmProposal, runCommand, type CommandResponse } from './commands'
import {
  initDb,
  listAudit,
  listItems,
  listReorderDrafts,
  listZones,
  saveProposal,
} from './db'
import { HttpError } from './http'
import { listPackingRules as listProcedures, previewPacking, savePacking } from './packing'
import type { Role } from './types'
import { GeminiRequestError } from './llm'
import { MOCK_WARNING, setAgentMode, updateAppSettings } from './settings'
import { createPgliteDb, type Db } from './sql'
import { TOOL_REGISTRY } from './tools'
import { LLMProviderError, type Interpretation, type LLMProvider, type ToolSchema } from './types'

const TABLES = 'items, audit_log, reorder_drafts, zones, procedures, packing_rules, proposals, pending_imports, settings, app_meta'
const WORKER = { name: 'Jan Magazynier', id: '33333333-3333-3333-3333-333333333333' }

let db: Db

beforeAll(async () => {
  db = await createPgliteDb(null)
  await initDb(db)
})

beforeEach(async () => {
  vi.stubEnv('DEMO_MODE', '')
  vi.stubEnv('LLM_MODE', '')
  vi.stubEnv('GEMINI_API_KEY', '')
  vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', '')
  vi.stubEnv('GOOGLE_API_KEY', '')
  await db.exec(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`)
  await initDb(db)
})

afterAll(() => {
  vi.unstubAllEnvs()
})

async function command(text: string, provider: LLMProvider | null = null, role: Role = 'pracownik'): Promise<CommandResponse> {
  return runCommand(db, text, { provider, actor: WORKER, role })
}

async function proposalFor(text: string, provider: LLMProvider | null = null) {
  const response = await command(text, provider, 'kierownik')
  if (response.type !== 'proposal') throw new Error(`expected proposal for ${text}, got ${JSON.stringify(response)}`)
  return response.proposal
}

async function stock(name: string): Promise<number> {
  return (await listItems(db)).find((item) => item.name === name)!.quantity
}

async function expectHttpError(promise: Promise<unknown>, status: number, detail?: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(HttpError)
  expect((error as HttpError).status).toBe(status)
  if (detail !== undefined) expect((error as HttpError).detail).toBe(detail)
}

describe('offline command pipeline (test_api.py)', () => {
  it('a quantity reply continues the unresolved command and still requires confirmation', async () => {
    const provider: LLMProvider = {
      async interpret(text, _tools, context) {
        if (text === 'dodaj folię stretch') return { toolCall: null, clarification: 'Ile rolek dodać?' }
        const pending = JSON.parse(context).pending_clarification
        expect(pending).toEqual([{ userText: 'dodaj folię stretch', question: 'Ile rolek dodać?' }])
        expect(text).toBe('10')
        const item = (await listItems(db)).find((row) => row.name === 'Folia stretch')!
        return { toolCall: { name: 'update_stock', arguments: { item_id: item.id, delta: 10 } }, clarification: null }
      },
    }
    const first = await runCommand(db, 'dodaj folię stretch', { provider, actor: WORKER })
    expect(first.type).toBe('clarify')
    const next = await runCommand(db, '10', {
      provider, actor: WORKER,
      conversation: [{ userText: 'dodaj folię stretch', question: 'Ile rolek dodać?' }],
    })
    expect(next.type).toBe('proposal')
    expect(await stock('Folia stretch')).toBe(15)
    if (next.type !== 'proposal') throw new Error('Expected a change card')
    expect(next.proposal.delta).toBe(10)
    expect(next.proposal.text).toBe('dodaj folię stretch → 10')
    await confirmProposal(db, next.proposal.id, WORKER)
    expect(await stock('Folia stretch')).toBe(25)
  })
  it('seed has at least three items and Kartony 54 / min 12', async () => {
    const items = await listItems(db)
    expect(items.length).toBeGreaterThanOrEqual(3)
    const kartony = items.find((item) => item.name === 'Kartony')!
    expect(kartony.quantity).toBe(54)
    expect(kartony.minimum).toBe(12)
  })

  it('command returns a change card and writes nothing', async () => {
    const response = await command('wzięliśmy paletę kartonów')
    expect(response.type).toBe('proposal')
    const proposal = (response as Extract<CommandResponse, { type: 'proposal' }>).proposal
    expect(proposal.tool).toBe('update_stock')
    expect(proposal.item_name).toBe('Kartony')
    expect(proposal.before).toBe(54)
    expect(proposal.after).toBe(52)
    expect(proposal.delta).toBe(-2)
    expect(proposal.summary).toContain('54→52')
    expect(proposal.id).toMatch(/^[0-9a-f]{32}$/)
    expect(proposal.args).toEqual({ item_id: 1, delta: -2 })

    expect(await stock('Kartony')).toBe(54)
    expect(await listAudit(db)).toEqual([])
  })

  it('offline parser in llm mode without a key warns', async () => {
    const response = await command('wzięliśmy paletę kartonów')
    expect(response.warning).toBe(NO_KEY_COMMAND_WARNING)
  })

  it('confirm writes stock and audit', async () => {
    const proposal = await proposalFor('wzięliśmy paletę kartonów')
    const result = await confirmProposal(db, proposal.id, WORKER, 'kierownik')
    expect(result.applied).toBe(true)
    expect(result).toMatchObject({ item_id: 1, item_name: 'Kartony', delta: -2, before: 54, after: 52, reorder_draft: null })

    expect(await stock('Kartony')).toBe(52)
    const entries = await listAudit(db)
    expect(entries).toHaveLength(1)
    const [entry] = entries
    expect(entry.item_name).toBe('Kartony')
    expect(entry.delta).toBe(-2)
    expect(entry.before).toBe(54)
    expect(entry.after).toBe(52)
    expect(entry.text).toBe('wzięliśmy paletę kartonów')
    expect(entry.actor).toBe('Jan Magazynier')
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(entry.undo_of).toBeNull()
    expect(entry.undone_by).toBeNull()
  })

  it('unknown command returns unknown and touches nothing', async () => {
    const response = await command('zamknij magazyn na noc')
    expect(response.type).toBe('unknown')
    expect(response).toMatchObject({ text: 'zamknij magazyn na noc', hints: HINTS })
    expect((response as { hints: string[] }).hints.length).toBeGreaterThanOrEqual(6)
    expect(await listAudit(db)).toEqual([])
  })

  it('query returns an answer without touching the db', async () => {
    const response = await command('ile mamy szkła?')
    expect(response).toMatchObject({ type: 'answer', tool: 'get_stock' })
    const answer = response as Extract<CommandResponse, { type: 'answer' }>
    expect(answer.text).toBe('Szkło: 20 szt (minimum 8) — Strefa B-2.')
    expect((answer.data.item as { quantity: number }).quantity).toBe(20)
    expect(await listAudit(db)).toEqual([])
  })

  it('query of all stock returns an answer', async () => {
    const response = await command('ile mamy?')
    expect(response).toMatchObject({ type: 'answer', tool: 'get_stock' })
    const answer = response as Extract<CommandResponse, { type: 'answer' }>
    expect((answer.data.items as unknown[]).length).toBeGreaterThanOrEqual(3)
    expect(answer.text).toBe('Na stanie: Folia stretch 15 rolka, Kartony 54 szt, Szkło 20 szt.')
  })

  it('location query returns an answer', async () => {
    const response = await command('gdzie leży szkło?')
    expect(response).toMatchObject({ type: 'answer', tool: 'get_location', text: 'Szkło leży w: Strefa B-2.' })
  })

  it('recall of a missing rule is clarify, not a hallucination', async () => {
    const response = await command('jak pakujemy szkło?')
    expect(response.type).toBe('clarify')
    const message = (response as { message: string }).message
    expect(message).toBe('Nie mam zapisanej procedury dla «szkło». Kierownik może utworzyć regułę w zakładce Procedury, wybierając produkt, opakowanie i ilość.')
    expect(await listAudit(db)).toEqual([])
  })

  it('recall of a saved procedure returns an answer', async () => {
    await savePacking(db, (await previewPacking(db, { item_id: 2, packaging_id: 3, quantity_per_package: 2, notes: 'Przekładki' }, 'kierownik')).args, WORKER, 'kierownik')
    const response = await command('jak pakujemy szkło?')
    expect(response).toMatchObject({
      type: 'answer',
      tool: 'recall_procedure',
      text: expect.stringContaining('Szkło: 2 szt na opakowanie „Duży karton”. Przekładki'),
    })
  })

  it('recall understands an inflected product name', async () => {
    await savePacking(db, (await previewPacking(db, { item_id: 2, packaging_id: 3, quantity_per_package: 2, notes: 'Przekładki' }, 'kierownik')).args, WORKER, 'kierownik')
    const response = await command('jak pakujemy szkła?')
    expect(response).toMatchObject({ type: 'answer', tool: 'recall_procedure', text: expect.stringContaining('Duży karton') })
  })

  it('recall falls back to a free-text procedure saved before packing rules', async () => {
    await db.query('INSERT INTO procedures (topic, text) VALUES ($1, $2)', ['szkło', 'Owijamy folią, przekładki w kartonie.'])
    const response = await command('jak pakujemy szkło?')
    expect(response).toMatchObject({ type: 'answer', tool: 'recall_procedure', text: 'Procedura „szkło”: Owijamy folią, przekładki w kartonie.' })
    expect(await command('jak pakujemy szkła?')).toMatchObject({ type: 'answer', tool: 'recall_procedure' })
  })

  it('zone proposal then confirm writes zone and audit', async () => {
    const proposal = await proposalFor('strefa: kartony')
    expect(proposal.tool).toBe('add_zone')
    expect(proposal.args).toEqual({ name: 'kartony' })
    expect(proposal.summary).toBe('Nowa strefa: kartony')
    expect(await listZones(db)).toEqual([])

    const result = await confirmProposal(db, proposal.id, WORKER, 'kierownik')
    expect(result).toMatchObject({ applied: true, tool: 'add_zone', name: 'kartony', created: true, event_type: 'zone_added' })
    expect(typeof result.audit_id).toBe('number')
    expect((await listZones(db)).map((zone) => zone.name)).toEqual(['kartony'])

    const [entry] = await listAudit(db)
    expect(entry.event_type).toBe('zone_added')
    expect(entry.item_name).toBe('kartony')
    expect(entry.actor).toBe('Jan Magazynier')
    const rows = await db.query<{ item_id: number | null }>('SELECT item_id FROM audit_log')
    expect(rows[0].item_id).toBeNull()
  })

  it('zone confirm is idempotent', async () => {
    const first = await proposalFor('strefa: kartony')
    expect((await confirmProposal(db, first.id)).created).toBe(true)
    const second = await proposalFor('strefa: kartony')
    expect((await confirmProposal(db, second.id)).created).toBe(false)
    expect(await listZones(db)).toHaveLength(1)
  })

  it('missing item on update proposes adding it', async () => {
    const proposal = await proposalFor('wzięliśmy paletę śrubek')
    expect(proposal.tool).toBe('add_item')
    expect(proposal.args).toEqual({ name: 'Śrubek', quantity: 0, unit: 'szt', minimum: 0 })
    expect(proposal.summary).toBe('Nowa pozycja: Śrubek (0 szt, minimum 0)')
    expect(proposal.item_name).toBe('Śrubek')

    await confirmProposal(db, proposal.id)
    const added = (await listItems(db)).find((item) => item.name.toLowerCase() === 'śrubek')!
    expect(added.quantity).toBe(0)
    expect((await listAudit(db))[0].event_type).toBe('item_added')
  })

  it('missing item on a query is clarify', async () => {
    const response = await command('ile mamy śrubek?')
    expect(response).toMatchObject({
      type: 'clarify',
      message: 'Nie znam pozycji «śrubek» — nie ma jej w bazie. Dodaj ją w sekcji Stany albo zaimportuj Excel.',
    })
    expect(await listAudit(db)).toEqual([])
  })

  it('structured packing command waits for manager confirmation and round-trips', async () => {
    const proposal = await proposalFor('zapamiętaj: Szkło pakujemy po 2 w Duży karton')
    expect(proposal.tool).toBe('remember_procedure')
    expect(await listProcedures(db)).toEqual([])
    expect((await command('jak pakujemy szkło?')).type).toBe('clarify')
    await confirmProposal(db, proposal.id, WORKER, 'kierownik')
    const answer = await command('jak pakujemy szkło?')
    expect(answer.type).toBe('answer')
    if (answer.type !== 'answer') throw new Error('Expected packing answer')
    expect(answer.text).toContain('Duży karton')
    const procedures = await listProcedures(db)
    expect(procedures).toHaveLength(1)
    expect(procedures[0]).toMatchObject({ item_id: 2, packaging_id: 3, quantity_per_package: 2 })
    expect((await listAudit(db))[0].event_type).toBe('procedure_saved')
  })

  it('packing update waits for confirmation and increments the rule version', async () => {
    const original = await proposalFor('zapamiętaj: Szkło pakujemy po 2 w Duży karton')
    await confirmProposal(db, original.id, WORKER, 'kierownik')
    const before = await listProcedures(db)
    const replacement = await proposalFor('zapamiętaj: Szkło pakujemy po 4 w Mały karton')
    expect(await listProcedures(db)).toEqual(before)
    await confirmProposal(db, replacement.id, WORKER, 'kierownik')
    const after = await listProcedures(db)
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe(before[0].id)
    expect(after[0].version).toBe(before[0].version + 1)
    expect(after[0]).toMatchObject({ packaging_id: 2, quantity_per_package: 4 })
    const answer = await command('jak pakujemy szkło?')
    if (answer.type !== 'answer') throw new Error('Expected packing answer')
    expect(answer.text).toContain('Mały karton')
  })

  it('uppercase packing commands match full catalogue names', async () => {
    const proposal = await proposalFor('Zapamiętaj: SZKŁO pakujemy po 2 w DUŻY KARTON')
    expect(proposal.args.item_id).toBe(2)
    await confirmProposal(db, proposal.id, WORKER, 'kierownik')
    expect((await command('jak pakujemy SZKŁO?')).type).toBe('answer')
    expect((await command('jak pakujemy przekładkami?')).type).toBe('clarify')
  })

  it('worker cannot create a packing proposal (clarification, not an HTTP 403)', async () => {
    expect(await command('zapamiętaj: Szkło pakujemy po 2 w Duży karton')).toMatchObject({ type: 'clarify' })
    expect(await listProcedures(db)).toEqual([])
    expect(await db.query('SELECT id FROM proposals')).toEqual([])
    expect(await listAudit(db)).toEqual([])
  })

  it('a draft_order proposal confirms into the queue', async () => {
    await saveProposal(
      db,
      {
        id: 't-order',
        tool: 'draft_order',
        args: { item_id: 1, quantity: 50 },
        summary: 'Szkic zamówienia: Kartony 50',
        text: 'zamów 50 kartonów',
      },
      null,
    )
    const result = await confirmProposal(db, 't-order')
    expect(result.applied).toBe(true)
    expect(result.tool).toBe('draft_order')
    expect(result.reorder_draft).toMatchObject({ quantity: 50, status: 'pending', created: true })
    const drafts = await listReorderDrafts(db)
    expect(drafts[0].quantity).toBe(50)
    expect(drafts[0].status).toBe('pending')
    const entries = await listAudit(db)
    expect(entries.map((entry) => entry.event_type)).toEqual(['reorder_draft_created'])
  })

  it('confirming an unknown tool is 400 and consumes the card', async () => {
    await saveProposal(db, { id: 't-bad', tool: 'nie_ma_takiego', args: {}, text: 'x' }, null)
    await expectHttpError(confirmProposal(db, 't-bad'), 400, 'Nieznane narzędzie: nie_ma_takiego')
    await expectHttpError(confirmProposal(db, 't-bad'), 404)
  })

  it('confirming a card for a deleted item is 400 with the tool message', async () => {
    const proposal = await proposalFor('wzięliśmy paletę kartonów')
    await db.query('DELETE FROM items WHERE id = 1')
    await expectHttpError(confirmProposal(db, proposal.id), 400, 'Pozycja nie istnieje w bazie')
    expect(await listAudit(db)).toEqual([])
  })

  it('all six demo commands work offline', async () => {
    const commands: [string, string, string | null][] = [
      ['wzięliśmy paletę kartonów', 'proposal', 'update_stock'],
      ['doszła paleta szkła', 'proposal', 'update_stock'],
      ['strefa: kartony', 'proposal', 'add_zone'],
      ['ile mamy szkła?', 'answer', 'get_stock'],
      ['gdzie leży szkło?', 'answer', 'get_location'],
      ['jak pakujemy szkło?', 'clarify', null],
    ]
    for (const [text, type, tool] of commands) {
      const response = await command(text)
      expect(response.type, text).toBe(type)
      if (response.type === 'proposal') expect(response.proposal.tool).toBe(tool)
      if (response.type === 'answer') expect(response.tool).toBe(tool)
    }
  })

  it('confirming an unknown proposal is 404', async () => {
    await expectHttpError(confirmProposal(db, 'nie-ma-takiego'), 404, 'Nie ma takiej propozycji (lub została już rozpatrzona)')
  })

  it('a proposal cannot be confirmed twice', async () => {
    const proposal = await proposalFor('doszła paleta szkła')
    await confirmProposal(db, proposal.id)
    await expectHttpError(confirmProposal(db, proposal.id), 404)
    expect(await stock('Szkło')).toBe(22)
  })

  it('concurrent confirms apply the card once', async () => {
    const proposal = await proposalFor('doszła paleta szkła')
    const results = await Promise.allSettled([confirmProposal(db, proposal.id), confirmProposal(db, proposal.id)])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await stock('Szkło')).toBe(22)
  })
})

describe('agent prefix', () => {
  it('strips the default wake word before parsing but keeps the original text', async () => {
    for (const text of ['Magu, ile mamy szkła?', 'magu ile mamy szkła?', 'MAGU: ile mamy szkła?', '  Magu,ile mamy szkła?']) {
      const response = await command(text)
      expect(response.type, text).toBe('answer')
      expect((response as { text: string }).text).toBe('Szkło: 20 szt (minimum 8) — Strefa B-2.')
    }
    const proposal = await proposalFor('Magu, strefa: rampa')
    expect(proposal.args).toEqual({ name: 'rampa' })
    expect(proposal.text).toBe('Magu, strefa: rampa')
  })

  it('a configured prefix is stripped before the LLM sees the command', async () => {
    await updateAppSettings(db, { prefix: 'Gosiu' })
    const provider = fakeProvider({ toolCall: { name: 'get_stock', arguments: { item_id: 2 } }, clarification: null })
    const response = await command('Gosiu, ile mamy szkła?', provider)
    expect(response.type).toBe('answer')
    expect(provider.calls[0].text).toBe('ile mamy szkła?')
  })

  it('does not strip a word that only starts with the prefix', async () => {
    await updateAppSettings(db, { prefix: 'Ile' })
    const provider = fakeProvider({ toolCall: { name: 'get_stock', arguments: {} }, clarification: null })
    await command('Ilekroć ile mamy?', provider)
    expect(provider.calls[0].text).toBe('Ilekroć ile mamy?')
  })
})

describe('agent mode', () => {
  it('llm without a key falls back to offline with a warning', async () => {
    const { getAgentModeStatus } = await import('./settings')
    expect(await getAgentModeStatus(db)).toEqual({
      mode: 'llm',
      effective_mode: 'offline',
      llm_available: false,
      warning: 'Brak GEMINI_API_KEY — agent działa w trybie offline.',
      demo_mode: false,
    })
  })

  it('llm with a key is effective', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    const { getAgentModeStatus } = await import('./settings')
    expect(await getAgentModeStatus(db)).toMatchObject({ mode: 'llm', effective_mode: 'llm', llm_available: true, warning: null })
  })

  it('switching to offline is persisted and silences the warning', async () => {
    const status = await setAgentMode(db, 'offline')
    expect(status).toMatchObject({ mode: 'offline', effective_mode: 'offline', warning: null })
    const response = await command('ile mamy szkła?')
    expect(response.warning).toBeUndefined()
  })

  it('offline mode never calls the provider', async () => {
    await setAgentMode(db, 'offline')
    const provider = fakeProvider(new LLMProviderError('should not be called'))
    expect((await command('ile mamy szkła?', provider)).type).toBe('answer')
    expect(provider.calls).toHaveLength(0)
  })

  it('mock mode warns with the mock text', async () => {
    await setAgentMode(db, 'mock')
    const response = await command('ile mamy szkła?')
    expect(response.warning).toBe(MOCK_WARNING)
  })

  it('the LLM_MODE env var is the default', async () => {
    vi.stubEnv('LLM_MODE', 'offline')
    const { getAgentModeStatus } = await import('./settings')
    expect((await getAgentModeStatus(db)).mode).toBe('offline')
  })

  it('demo mode is locked to mock', async () => {
    vi.stubEnv('DEMO_MODE', '1')
    vi.stubEnv('GEMINI_API_KEY', 'configured-but-forbidden')
    const { getAgentModeStatus } = await import('./settings')
    const status = await getAgentModeStatus(db)
    expect(status).toMatchObject({ mode: 'mock', effective_mode: 'offline', demo_mode: true })
    expect(status.warning).toBe('Demo offline — osobna baza, komendy tekstowe, bez zewnętrznych API.')
    await expectHttpError(
      setAgentMode(db, 'llm'),
      409,
      'Demo offline jest zablokowane na czas tej sesji. Wyłącz DEMO_MODE i uruchom backend ponownie.',
    )
    expect((await setAgentMode(db, 'mock')).mode).toBe('mock')
    // even with a provider the demo never calls an external API
    const provider = fakeProvider(new LLMProviderError('forbidden'))
    const response = await command('Magu, jak pakujemy szkło?', provider)
    expect(provider.calls).toHaveLength(0)
    expect(response.type).toBe('clarify')
  })

  it('rejects an invalid mode', async () => {
    await expectHttpError(setAgentMode(db, 'turbo' as never), 422)
  })
})

// ------------------------------------------------------------ LLM contract

type FakeProvider = LLMProvider & { calls: { text: string; tools: ToolSchema[]; context: string }[] }

function fakeProvider(result: Interpretation | Error): FakeProvider {
  const calls: FakeProvider['calls'] = []
  return {
    calls,
    async interpret(text, tools, context) {
      calls.push({ text, tools, context })
      if (result instanceof Error) throw result
      return result
    },
  }
}

function respond(name: string, args: Record<string, unknown>): FakeProvider {
  return fakeProvider({ toolCall: { name, arguments: args }, clarification: null })
}

describe('LLM registry contract (test_llm_registry.py)', () => {
  it.each([
    ['wzięliśmy dwie palety kartonów czerwonych', { item_id: 1, delta: -4 }],
    ['ile mamy szkła?', { item_id: 2, delta: -2 }],
    ['gdzie jest szkło?', { item_id: 2, delta: -2 }],
    ['nie wzięliśmy palety kartonów', { item_id: 1, delta: -2 }],
    ['wzięliśmy dwie palety kartonów', { item_id: 1, delta: -2 }],
    ['wzięliśmy dwie palety kartonów', { item_id: 2, delta: -4 }],
    ['wzięliśmy dwie palety kartonów', { item_id: 1, delta: 4 }],
    ['pobrałem 2 rolki szkła', { item_id: 2, delta: -2 }],
    ['wzięliśmy kartony', { item_id: 1, delta: -2 }],
    ['wzięliśmy 1,5 palety kartonów', { item_id: 1, delta: -10 }],
    ['wzięliśmy 2 kilogramy kartonów', { item_id: 1, delta: -2 }],
  ] as const)('rejects a semantically wrong model proposal: %s', async (text, args) => {
    expect((await command(text, respond('update_stock', args))).type).toBe('clarify')
    expect(await listAudit(db)).toEqual([])
    expect(await db.query('SELECT id FROM proposals')).toEqual([])
  })
  it('rejects another model write intent for a recognized stock question', async () => {
    expect((await command('ile mamy szkła?', respond('draft_order', { item_id: 2, quantity: 50 }))).type).toBe('clarify')
    expect(await db.query('SELECT id FROM proposals')).toEqual([])
  })
  it('explains rate limiting while preserving the offline demo path', async () => {
    const response = await command('wzięliśmy paletę kartonów', fakeProvider(new GeminiRequestError('secret provider body', 'http', 429)))
    expect(response.type).toBe('proposal')
    expect(response.warning).toContain('limit zapytań')
    expect(response.warning).toContain('parsera offline')
    expect(response.warning).not.toContain('secret')
    expect(await listAudit(db)).toEqual([])
  })

  it.each([
    [new GeminiRequestError('secret', 'timeout'), 'wyznaczonym czasie'],
    [new GeminiRequestError('secret', 'network'), 'połączyć'],
    [new GeminiRequestError('secret', 'http', 403), 'klucz API'],
    [new GeminiRequestError('secret', 'http', 400, 'API_KEY_INVALID'), 'klucz API'],
    [new GeminiRequestError('secret', 'http', 404), 'model jest niedostępny'],
    [new GeminiRequestError('secret', 'http', 503), 'chwilowo niedostępny'],
  ])('explains provider failure without echoing its message: %s', async (error, expected) => {
    const response = await command('wzięliśmy paletę kartonów', fakeProvider(error))
    expect(response.type).toBe('proposal')
    expect(response.warning).toContain(expected)
    expect(response.warning).not.toContain('secret')
  })

  it('passes every registry tool and the inventory context to the provider', async () => {
    const provider = respond('get_stock', { item_id: 1 })
    await command('naturalne pytanie', provider)
    const [call] = provider.calls
    expect(new Set(call.tools.map((tool) => tool.function.name))).toEqual(new Set(Object.keys(TOOL_REGISTRY)))
    expect(JSON.parse(call.context)).toEqual({
      units_per_pallet: 2,
      role: 'pracownik',
      packaging_catalogue: [
        { id: 1, name: 'Koperta', inventory_item_id: null },
        { id: 2, name: 'Mały karton', inventory_item_id: null },
        { id: 3, name: 'Duży karton', inventory_item_id: null },
        { id: 4, name: 'Folia stretch', inventory_item_id: null },
      ],
      items: [
        { id: 3, name: 'Folia stretch', quantity: 15, unit: 'rolka', minimum: 6, location: 'Strefa C-1' },
        { id: 1, name: 'Kartony', quantity: 54, unit: 'szt', minimum: 12, location: 'Strefa A-1' },
        { id: 2, name: 'Szkło', quantity: 20, unit: 'szt', minimum: 8, location: 'Strefa B-2' },
      ],
    })
  })

  it.each(['get_stock', 'get_location', 'check_reorder', 'recall_procedure'])(
    'read tool %s returns an answer without writes',
    async (tool) => {
      const args = tool === 'recall_procedure' ? { topic: 'szkło' } : { item_id: 1 }
      const response = await command('naturalne pytanie', respond(tool, args))
      expect(response.type).toBe(tool === 'recall_procedure' ? 'clarify' : 'answer')
      expect(response.warning).toBeUndefined()
      expect(await listAudit(db)).toEqual([])
    },
  )

  it('check_reorder answer text', async () => {
    const response = await command('czy trzeba zamówić kartony?', respond('check_reorder', { item_id: 1 }))
    expect(response).toMatchObject({ type: 'answer', tool: 'check_reorder', text: 'Kartony: 54 (minimum 12) — minimum zachowane.' })
  })

  const writeCases: [string, Record<string, unknown>, () => Promise<unknown>][] = [
    ['add_zone', { name: 'Strefa testowa' }, () => listZones(db)],
    ['remember_procedure', { item_id: 2, packaging_id: 3, quantity_per_package: 2 }, () => listProcedures(db)],
    ['add_item', { name: 'Taśma', quantity: 7 }, () => listItems(db)],
    ['draft_order', { item_id: 1, quantity: 50 }, () => listReorderDrafts(db)],
  ]

  it.each(writeCases)('write tool %s waits for confirmation', async (tool, args, read) => {
    const before = await read()
    const proposal = await proposalFor('naturalne polecenie', respond(tool, args))
    expect(proposal.tool).toBe(tool)
    expect(await read()).toEqual(before)
    expect(await listAudit(db)).toEqual([])

    const confirmed = await confirmProposal(db, proposal.id, WORKER, 'kierownik')
    expect(confirmed.applied).toBe(true)
    expect(await read()).not.toEqual(before)
    expect(await listAudit(db)).toHaveLength(1)
    await expectHttpError(confirmProposal(db, proposal.id), 404)
  })

  it('summaries of LLM write proposals match Python', async () => {
    expect((await proposalFor('x', respond('add_item', { name: 'Taśma', quantity: 7 }))).summary).toBe('Nowa pozycja: Taśma (7 szt, minimum 0)')
    expect((await proposalFor('x', respond('draft_order', { item_id: 1, quantity: 50 }))).summary).toBe(
      'Szkic zamówienia: Kartony — 50',
    )
    const stockCard = await proposalFor('x', respond('update_stock', { item_id: 2, delta: 5 }))
    expect(stockCard).toMatchObject({ summary: 'Szkło 20→25', unit: 'szt', delta: 5, before: 20, after: 25 })
  })

  it.each([
    ['get_location', { item_id: 99999 }],
    ['get_stock', { item_id: true }],
    ['draft_order', { item_id: 1, quantity: -50 }],
    ['add_zone', { name: '   ' }],
    ['add_zone', { name: 'Test', unexpected: 'extra' }],
    ['update_stock', { item_id: 1, delta: -2, text: 'Forged audit' }],
    ['update_stock', { item_id: 1, delta: 0 }],
    ['update_stock', { item_id: 1.5, delta: 2 }],
    ['nie_ma_takiego', {}],
  ] as [string, Record<string, unknown>][])('invalid call %s %j falls back without writes', async (tool, args) => {
    const response = await command('nieznane polecenie', respond(tool, args))
    expect(response.warning).toBe(LLM_FALLBACK_WARNING)
    expect(response.type).toBe('unknown')
    expect(await listAudit(db)).toEqual([])
  })

  it('a provider failure falls back to the offline parser', async () => {
    const response = await command('wzięliśmy paletę kartonów', fakeProvider(new LLMProviderError('timeout')))
    expect(response.type).toBe('proposal')
    expect(response.warning).toBe(LLM_FALLBACK_WARNING)
  })

  it('a clarification from the LLM is returned as clarify without a warning', async () => {
    const response = await command('weź to', fakeProvider({ toolCall: null, clarification: 'Którą pozycję masz na myśli?' }))
    expect(response).toEqual({ type: 'clarify', text: 'weź to', message: 'Którą pozycję masz na myśli?' })
  })

  it('an empty clarification gets the default question', async () => {
    const response = await command('weź to', fakeProvider({ toolCall: null, clarification: '' }))
    expect(response).toEqual({ type: 'clarify', text: 'weź to', message: 'Doprecyzuj polecenie.' })
  })

  it('the update_stock audit text is the user command, never model text', async () => {
    const proposal = await proposalFor('wzięliśmy dwie palety szkła', respond('update_stock', { item_id: 2, delta: -4 }))
    await confirmProposal(db, proposal.id)
    expect((await listAudit(db))[0].text).toBe('wzięliśmy dwie palety szkła')
    expect(await stock('Szkło')).toBe(16)
  })
})

describe('LLM context size', () => {
  it('includes a phonetically close product beyond the first context page', async () => {
    const { contextItems } = await import('./commands')
    const rows = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, name: `Towar ${index}`, quantity: 1, minimum: 0, unit: 'szt', location: '' }))
    rows.push({ id: 101, name: 'Bułki', quantity: 5, minimum: 1, unit: 'szt', location: 'A' })
    expect(contextItems(rows, 'ile mamy półki?')[0].name).toBe('Bułki')
  })
  it('sends only the items a command can be about in a large warehouse', async () => {
    const { contextItems, MAX_CONTEXT_ITEMS } = await import('./commands')
    const rows = Array.from({ length: 300 }, (_, index) => ({
      id: index + 1, name: `Towar ${index + 1}`, quantity: 1, minimum: 0, unit: 'szt', location: '',
    }))
    rows.push({ id: 301, name: 'Kartony', quantity: 54, minimum: 12, unit: 'szt', location: 'A-1' })
    rows.push({ id: 302, name: 'Folia stretch', quantity: 15, minimum: 6, unit: 'rolka', location: 'C-1' })
    const picked = contextItems(rows, 'wzięliśmy dwie palety kartonów i rolkę folii')
    expect(picked).toHaveLength(MAX_CONTEXT_ITEMS)
    expect(picked.slice(0, 2).map((item) => item.name).sort()).toEqual(['Folia stretch', 'Kartony'])
    expect(contextItems(rows.slice(0, 10), 'cokolwiek')).toHaveLength(10)
  })
})
