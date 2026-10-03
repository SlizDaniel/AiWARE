// Offline demo database — DB parts of legacy tests/test_demo.py.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmProposal, runCommand } from './commands'
import {
  decideReorderDraft,
  getDataVersion,
  initDb,
  listAudit,
  listItems,
  listProcedures,
  listReorderDrafts,
  listZones,
} from './db'
import { DEMO_PROCEDURE, NOT_DEMO_DATABASE, initDemoDb, resetDemoDb } from './demo'
import { getAgentModeStatus } from './settings'
import { createPgliteDb, type Db } from './sql'
import { LLMProviderError, type LLMProvider } from './types'

let db: Db

beforeAll(async () => {
  db = await createPgliteDb(null)
})

beforeEach(async () => {
  vi.stubEnv('DEMO_MODE', '1')
  vi.stubEnv('LLM_MODE', 'llm')
  vi.stubEnv('GEMINI_API_KEY', 'configured-but-forbidden')
  // every test starts from an empty database
  await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
})

afterAll(() => {
  vi.unstubAllEnvs()
})

const forbiddenProvider: LLMProvider = {
  async interpret() {
    throw new LLMProviderError('Offline demo attempted an external call')
  },
}

async function confirm(text: string): Promise<Record<string, unknown>> {
  const response = await runCommand(db, text, { provider: forbiddenProvider })
  if (response.type !== 'proposal') throw new Error(`expected proposal for ${text}`)
  return confirmProposal(db, response.proposal.id)
}

async function kartony(): Promise<number> {
  return (await listItems(db)).find((item) => item.name === 'Kartony')!.quantity
}

describe('demo database', () => {
  it('seeds the rehearsal, runs the commands offline and survives a restart', async () => {
    await initDemoDb(db, { reset: false })
    const mode = await getAgentModeStatus(db)
    expect(mode.demo_mode).toBe(true)
    expect(mode.effective_mode).toBe('offline')

    expect(await kartony()).toBe(13)
    expect(await listAudit(db)).toEqual([])
    expect((await listProcedures(db)).map((procedure) => [procedure.topic, procedure.text])).toEqual([['szkło', DEMO_PROCEDURE]])

    for (const text of ['strefa: kartony', 'strefa: szkło', 'strefa: folia stretch']) await confirm(text)
    expect(await listZones(db)).toHaveLength(3)

    const response = await runCommand(db, 'wzięliśmy paletę kartonów', { provider: forbiddenProvider })
    if (response.type !== 'proposal') throw new Error('expected proposal')
    expect([response.proposal.before, response.proposal.after]).toEqual([13, 11])
    expect(response.warning).toBe('Demo offline — osobna baza, komendy tekstowe, bez zewnętrznych API.')
    expect((await confirmProposal(db, response.proposal.id)).applied).toBe(true)

    const drafts = await listReorderDrafts(db)
    expect(drafts).toHaveLength(1)
    expect(drafts[0].quantity).toBe(50)
    expect(drafts[0].status).toBe('pending')
    expect(await decideReorderDraft(db, drafts[0].id, 'approved')).toMatchObject({ status: 'approved' })

    for (const text of ['ile mamy szkła?', 'gdzie leży szkło?', 'Magu, jak pakujemy szkło?']) {
      expect((await runCommand(db, text, { provider: forbiddenProvider })).type, text).toBe('answer')
    }
    expect((await listAudit(db)).some((entry) => entry.event_type === 'stock_change')).toBe(true)

    // Restart preserves the rehearsal instead of silently resetting it.
    await initDemoDb(db, { reset: false })
    expect(await kartony()).toBe(11)
    expect(await listZones(db)).toHaveLength(3)
  })

  it('reset is explicit and wipes the rehearsal', async () => {
    await initDemoDb(db, { reset: false })
    await confirm('wzięliśmy paletę kartonów')
    await confirm('strefa: rampa')
    const versionBefore = await getDataVersion(db)

    await resetDemoDb(db)
    expect(await listAudit(db)).toEqual([])
    expect(await listReorderDrafts(db)).toEqual([])
    expect(await listZones(db)).toEqual([])
    expect(await kartony()).toBe(13)
    expect((await listItems(db)).map((item) => item.id).sort()).toEqual([1, 2, 3])
    expect(await listProcedures(db)).toHaveLength(1)
    expect(await getDataVersion(db)).toBeGreaterThan(versionBefore)
  })

  it('protects a regular database', async () => {
    vi.stubEnv('DEMO_MODE', '')
    await initDb(db)
    await confirm('doszła paleta szkła')
    const before = await listItems(db)
    const historyBefore = await listAudit(db)

    await expect(initDemoDb(db, { reset: true })).rejects.toThrow(NOT_DEMO_DATABASE)
    await expect(initDemoDb(db, { reset: false })).rejects.toThrow(/^Baza nie jest bazą demo/)
    expect(await listItems(db)).toEqual(before)
    expect(await listAudit(db)).toEqual(historyBefore)
    const rows = await db.query<{ found: boolean }>("SELECT to_regclass('demo_metadata') IS NOT NULL AS found")
    expect(rows[0].found).toBe(false)
  })

  it('takes over an empty database that already has the schema', async () => {
    vi.stubEnv('DEMO_MODE', '')
    await initDb(db)
    await db.exec('TRUNCATE items RESTART IDENTITY CASCADE')
    await initDemoDb(db, { reset: false })
    expect(await kartony()).toBe(13)
  })
})
