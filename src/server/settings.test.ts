// Settings (card 12, port of legacy test_settings.py): prefix with retired
// prefixes, agent mode, data adapter, default minimum, voice mode, TTS and the
// default order size — persisted in the DB and applied from the next command.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmProposal, runCommand } from './commands'
import { importItems, initDb, listItems, setSetting } from './db'
import { HttpError } from './http'
import {
  aiUsage,
  commandText,
  getAgentModeStatus,
  getAppSettings,
  setAgentMode,
  settingsPayload,
  stripAgentPrefix,
  updateAppSettings,
} from './settings'
import { createPgliteDb, type Db } from './sql'

const TABLES = 'items, audit_log, reorder_drafts, zones, procedures, proposals, pending_imports, settings, app_meta'

let db: Db

beforeAll(async () => {
  db = await createPgliteDb(null)
  await initDb(db)
})

afterAll(() => {
  vi.unstubAllEnvs()
})

beforeEach(async () => {
  vi.unstubAllEnvs()
  for (const name of ['DEMO_MODE', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'STT_API_KEY', 'STT_MODEL', 'STT_BASE_URL', 'LLM_MODE']) {
    vi.stubEnv(name, '')
  }
  await db.exec(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`)
  await initDb(db)
})

async function httpError(promise: Promise<unknown>): Promise<HttpError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(HttpError)
  return error as HttpError
}

const run = (text: string) => runCommand(db, text, { provider: null })

describe('defaults and persistence', () => {
  it('has card-12 defaults plus TTS and order size', async () => {
    expect(await getAppSettings(db)).toEqual({
      prefix: 'Magu',
      mode: 'llm',
      adapter: 'database',
      default_minimum: 0,
      voice_mode: 'wake_word',
      tts_enabled: false,
      reorder_default_quantity: 50,
    })
  })

  it('the starting mode comes from LLM_MODE until the owner saves one', async () => {
    vi.stubEnv('LLM_MODE', 'offline')
    expect((await getAppSettings(db)).mode).toBe('offline')
    await updateAppSettings(db, { mode: 'llm' })
    expect((await getAppSettings(db)).mode).toBe('llm')
  })

  it('saves a partial patch; another read (another instance) sees it', async () => {
    const saved = await updateAppSettings(db, { adapter: 'file_import', default_minimum: 7, voice_mode: 'text', mode: 'offline' })
    expect(saved).toMatchObject({ adapter: 'file_import', default_minimum: 7, voice_mode: 'text', mode: 'offline', prefix: 'Magu' })
    expect(await getAppSettings(db)).toEqual(saved)
  })

  it('reads values written by older builds (agent_prefix, adapter "sqlite")', async () => {
    await setSetting(db, 'agent_prefix', 'Gosiu')
    await setSetting(db, 'adapter', 'sqlite')
    expect(await getAppSettings(db)).toMatchObject({ prefix: 'Gosiu', adapter: 'database' })
    expect((await updateAppSettings(db, { adapter: 'sqlite' })).adapter).toBe('database')
  })

  it('falls back to defaults for corrupt stored values', async () => {
    await setSetting(db, 'prefix', 'x y')
    await setSetting(db, 'default_minimum', -3)
    await setSetting(db, 'voice_mode', 'always')
    await setSetting(db, 'tts_enabled', 'yes')
    expect(await getAppSettings(db)).toMatchObject({ prefix: 'Magu', default_minimum: 0, voice_mode: 'wake_word', tts_enabled: false })
  })
})

describe('validation (invalid patches change nothing)', () => {
  const invalid: [string, Record<string, unknown>][] = [
    ['empty prefix', { prefix: '' }],
    ['prefix with words', { prefix: 'Gosiu, ile' }],
    ['one-letter prefix', { prefix: 'G' }],
    ['null', { prefix: null }],
    ['bad mode', { mode: 'broken' }],
    ['negative minimum', { default_minimum: -1 }],
    ['fractional minimum', { default_minimum: 2.5 }],
    ['minimum as text', { default_minimum: '7' }],
    ['bad voice mode', { voice_mode: 'always' }],
    ['bad adapter', { adapter: 'erp' }],
    ['tts as text', { tts_enabled: 'yes' }],
    ['order size 0', { reorder_default_quantity: 0 }],
    ['unknown key', { colour: 'green' }],
    ['valid + invalid together', { prefix: 'Gosiu', default_minimum: -1 }],
  ]
  it.each(invalid)('%s → 422', async (_label, patch) => {
    const before = await settingsPayload(db)
    expect((await httpError(updateAppSettings(db, patch))).status).toBe(422)
    expect(await settingsPayload(db)).toEqual(before)
  })

  it('offline demo refuses enabling the cloud and keeps everything else', async () => {
    vi.stubEnv('DEMO_MODE', '1')
    const error = await httpError(updateAppSettings(db, { mode: 'llm', prefix: 'Gosiu' }))
    expect(error.status).toBe(409)
    expect(await getAppSettings(db)).toMatchObject({ prefix: 'Magu', mode: 'mock' })
    expect((await updateAppSettings(db, { mode: 'mock', prefix: 'Gosiu' })).prefix).toBe('Gosiu')
  })
})

describe('prefix (card 12)', () => {
  it('a new prefix works immediately, the old one is rejected, no prefix still works', async () => {
    vi.stubEnv('LLM_MODE', 'offline')
    await updateAppSettings(db, { prefix: 'Gosiu' })
    expect((await run('Gosiu, ile mamy kartonów?')).type).toBe('answer')
    const rejected = await run('Magu, wzięliśmy paletę kartonów')
    expect(rejected).toEqual({
      type: 'clarify',
      text: 'Magu, wzięliśmy paletę kartonów',
      message: 'Aktualny prefix to „Gosiu”. Użyj go albo wpisz komendę bez prefixu.',
    })
    expect((await run('ile mamy kartonów?')).type).toBe('answer')
  })

  it('returning to an old prefix re-enables it and retires the other', async () => {
    await updateAppSettings(db, { prefix: 'Gosiu' })
    await updateAppSettings(db, { prefix: 'Magu' })
    expect(await commandText(db, 'Magu ile mamy?')).toEqual({ text: 'ile mamy?', prefix: 'Magu' })
    expect((await commandText(db, 'gosiu: ile mamy?')).text).toBeNull()
  })

  it('changing only letter case keeps nothing retired', async () => {
    await updateAppSettings(db, { prefix: 'MAGU' })
    expect((await commandText(db, 'magu, ile mamy?')).text).toBe('ile mamy?')
  })

  it('stripAgentPrefix only removes a whole word', () => {
    expect(stripAgentPrefix('Magu, ile mamy szkła?', 'Magu')).toBe('ile mamy szkła?')
    expect(stripAgentPrefix('  magu ile mamy', 'Magu')).toBe('ile mamy')
    expect(stripAgentPrefix('Magus ile mamy', 'Magu')).toBe('Magus ile mamy')
    expect(stripAgentPrefix('Żanko — doszła paleta', 'Żanko')).toBe('doszła paleta')
  })
})

describe('agent mode lives in settings', () => {
  it('setAgentMode and the settings patch write the same value', async () => {
    await setAgentMode(db, 'offline')
    expect((await getAppSettings(db)).mode).toBe('offline')
    await updateAppSettings(db, { mode: 'mock' })
    expect((await getAgentModeStatus(db)).mode).toBe('mock')
  })
})

describe('default minimum applies only to new items', () => {
  it('import: new rows without a minimum get it, existing thresholds stay', async () => {
    await updateAppSettings(db, { default_minimum: 7 })
    const { default_minimum: defaultMinimum } = await getAppSettings(db)
    await importItems(
      db,
      [
        { name: 'Kartony', quantity: 54, minimum: null, unit: null, location: null },
        { name: 'Bolts', quantity: 10, minimum: null, unit: null, location: null },
        { name: 'Nity', quantity: 5, minimum: 3, unit: null, location: null },
      ],
      undefined,
      { defaultMinimum },
    )
    const items = await listItems(db)
    expect(items.find((item) => item.name === 'Bolts')?.minimum).toBe(7)
    expect(items.find((item) => item.name === 'Kartony')?.minimum).toBe(12)
    expect(items.find((item) => item.name === 'Nity')?.minimum).toBe(3)
  })

  it('add_item card shows the minimum before confirmation and saves it', async () => {
    await updateAppSettings(db, { default_minimum: 7, mode: 'offline' })
    const response = await run('wzięliśmy paletę nakrętek')
    if (response.type !== 'proposal') throw new Error(`expected proposal, got ${response.type}`)
    expect(response.proposal.summary).toBe('Nowa pozycja: Nakrętek (0 szt, minimum 7)')
    await confirmProposal(db, response.proposal.id)
    expect((await listItems(db)).find((item) => item.name === 'Nakrętek')?.minimum).toBe(7)
  })

  it('an LLM add_item without a minimum gets the default too', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    await updateAppSettings(db, { default_minimum: 7, mode: 'llm' })
    const provider = {
      interpret: async () => ({
        toolCall: { name: 'add_item', arguments: { name: 'Śruby', quantity: 5, unit: 'szt' } },
        clarification: null,
      }),
    }
    const response = await runCommand(db, 'Magu, dodaj pięć śrub', { provider })
    if (response.type !== 'proposal') throw new Error(`expected proposal, got ${response.type}`)
    expect(response.proposal.summary).toBe('Nowa pozycja: Śruby (5 szt, minimum 7)')
    await confirmProposal(db, response.proposal.id)
    expect((await listItems(db)).find((item) => item.name === 'Śruby')?.minimum).toBe(7)
  })
})

describe('AI usage disclosure', () => {
  it('reflects mode and voice settings without leaking keys', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'secret-gemini')
    vi.stubEnv('STT_API_KEY', 'secret-stt')
    vi.stubEnv('STT_BASE_URL', ' ')
    await updateAppSettings(db, { voice_mode: 'text', mode: 'offline' })
    const payload = await settingsPayload(db)
    expect(payload.ai_usage).toMatchObject({
      llm_enabled: false,
      stt_enabled: false,
      stt_model: 'whisper-large-v3',
      stt_provider: 'api.groq.com',
      llm_provider: 'generativelanguage.googleapis.com',
    })
    expect(payload.ai_usage.disclosure).toContain('Gemini')
    expect(JSON.stringify(payload)).not.toContain('secret-')
    expect(payload.version).toBe('0.3.0')
  })

  it('wake_word is a valid voice mode and keeps STT available', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k')
    const saved = await updateAppSettings(db, { voice_mode: 'wake_word' })
    expect(saved.voice_mode).toBe('wake_word')
    const usage = aiUsage(saved, await getAgentModeStatus(db))
    expect(usage.stt_enabled).toBe(true)
    expect(usage.disclosure).toContain('Web Speech API')
  })

  it('STT through Gemini is available in push-to-talk mode with a key', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k')
    const settings = await getAppSettings(db)
    const usage = aiUsage(settings, await getAgentModeStatus(db))
    expect(usage).toMatchObject({ llm_enabled: true, stt_enabled: true, stt_provider: 'generativelanguage.googleapis.com' })
  })
})
