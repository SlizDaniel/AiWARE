import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { toolSchemas } from './agentContract'
import { commandProviderFromEnv } from './commandProvider'
import { confirmProposal, runCommand } from './commands'
import { getItem, initDb } from './db'
import { commandAiConfigured } from './env'
import { DecisionHybridProvider, stockAmount } from './decisions'
import { GeminiProvider } from './llm'
import { getAgentModeStatus, settingsPayload } from './settings'
import { createPgliteDb, type Db } from './sql'
import type { Interpretation } from './types'

const context = JSON.stringify({ items: [{ id: 1, name: 'Kartony', quantity: 54 }] })
const tools = toolSchemas()
const fallbackResult: Interpretation = { toolCall: null, clarification: 'Pytanie z Gemini' }
function setup(timeoutMs = 2000, withFallback = true) {
  const interpret = vi.fn(async () => fallbackResult)
  const provider = new DecisionHybridProvider({ apiKey: 'test-secret', model: 'inception/mercury-decide:free', timeoutMs, fallback: withFallback ? { interpret } : null })
  return { provider, interpret }
}
function answer(intent = 'take', item = '1', confidence = 1, safe = 1) {
  return { answers: {
    intent: { type: 'choice', choice: intent, confidence, probabilities: Object.fromEntries(['take', 'receive', 'get_stock', 'get_location', 'other'].map((key) => [key, key === intent ? 1 : 0])) },
    item: { type: 'choice', choice: item, confidence, probabilities: Object.fromEntries(['none', 'all', '1'].map((key) => [key, key === item ? 1 : 0])) },
    safe: { type: 'noul', noul: safe },
  } }
}
function respond(body: unknown, status = 200) {
  return vi.stubGlobal('fetch', vi.fn(async () => Response.json(body, { status })))
}
beforeEach(() => vi.stubEnv('OPENROUTER_API_KEY', ''))
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('local stock quantity grammar', () => {
  it.each([
    ['wzięliśmy paletę kartonów', 'take', 2],
    ['wziąłem 3 palety kartonów', 'take', 6],
    ['doszły dwie palety kartonów', 'receive', 4],
    ['przyjęliśmy 12 sztuk kartonów', 'receive', 12],
    ['pobrałam 5 szt. kartonów', 'take', 5],
  ])('extracts %s', (text, intent, quantity) => expect(stockAmount(text)).toEqual({ intent, quantity }))
  it.each(['wzięliśmy palety kartonów', 'wzięliśmy kartony', 'wziąłem 1,5 palety kartonów', 'wziąłem 0 sztuk kartonów', 'nie wzięliśmy paletę kartonów', 'wzięliśmy paletę kartonów i szkła', 'wzięliśmy paletę kartonów, potem szkło', 'wzięliśmy 9007199254740993 sztuk kartonów', 'jutro wzięliśmy paletę kartonów'])('declines %s', (text) => expect(stockAmount(text)).toBeNull())
})

describe('Mercury Decide hybrid command routing', () => {
  it('uses one request for intent, item and safety; keeps credentials in headers', async () => {
    respond(answer())
    const { provider, interpret } = setup()
    expect(await provider.interpret('wzięliśmy paletę kartonów', tools, context)).toEqual({ toolCall: { name: 'update_stock', arguments: { item_id: 1, delta: -2 } }, clarification: null })
    expect(interpret).not.toHaveBeenCalled()
    const fetchMock = vi.mocked(fetch)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions')
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer test-secret')
    expect(options?.redirect).toBe('error')
    const body = JSON.parse(options?.body as string)
    expect(Object.keys(body.questions)).toEqual(['intent', 'item', 'safe'])
    expect(body.model).toBe('inception/mercury-decide:free')
    expect(JSON.stringify(provider)).not.toContain('test-secret')
  })
  it.each([
    ['receive', 'doszły dwie palety kartonów', 'update_stock', { item_id: 1, delta: 4 }],
    ['get_stock', 'ile kartonów zostało?', 'get_stock', { item_id: 1 }],
    ['get_location', 'gdzie są kartony?', 'get_location', { item_id: 1 }],
  ])('routes %s', async (intent, text, name, args) => {
    respond(answer(intent))
    expect(await setup().provider.interpret(text, tools, context)).toEqual({ toolCall: { name, arguments: args }, clarification: null })
  })
  it('allows whole warehouse stock only', async () => {
    respond(answer('get_stock', 'all'))
    expect(await setup().provider.interpret('ile mamy?', tools, context)).toEqual({ toolCall: { name: 'get_stock', arguments: {} }, clarification: null })
  })
  it.each([
    ['low confidence', answer('take', '1', 0.5)],
    ['unsafe', answer('take', '1', 1, 0.4)],
    ['unknown item', answer('take', 'none')],
    ['other intent', answer('other')],
    ['malformed', { answers: {} }],
    ['unknown ID', answer('take', '99')],
    ['invalid probability', answer('take', '1', NaN)],
  ])('falls back for %s', async (_label, body) => {
    respond(body)
    const { provider, interpret } = setup()
    expect(await provider.interpret('wzięliśmy paletę kartonów', tools, context)).toEqual(fallbackResult)
    expect(interpret).toHaveBeenCalledWith('wzięliśmy paletę kartonów', tools, context)
  })
  it.each(['wzięliśmy kartony', 'wzięliśmy palety kartonów', 'wzięliśmy paletę kartonów i szkła', 'doszła paleta kartonów'])('does not invent or contradict quantities: %s', async (text) => {
    respond(answer())
    const { provider, interpret } = setup()
    expect(await provider.interpret(text, tools, context)).toEqual(fallbackResult)
    expect(interpret).toHaveBeenCalledOnce()
  })
  it('sends clarification conversation directly to Gemini without a Mercury Decide round trip', async () => {
    respond(answer())
    const pending = JSON.stringify({ items: [], pending_clarification: [{ userText: 'kartony' }] })
    const { provider, interpret } = setup()
    expect(await provider.interpret('dwie', tools, pending)).toEqual(fallbackResult)
    expect(fetch).not.toHaveBeenCalled()
    expect(interpret).toHaveBeenCalledWith('dwie', tools, pending)
  })
  it.each([429, 401, 503])('falls back on HTTP %s without exposing bodies', async (status) => {
    respond({ secret: 'private-body' }, status)
    expect(await setup().provider.interpret('wzięliśmy paletę kartonów', tools, context)).toEqual(fallbackResult)
  })
  it('times out and falls back', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new Error('private error')), { once: true })
    })))
    expect(await setup(10).provider.interpret('wzięliśmy paletę kartonów', tools, context)).toEqual(fallbackResult)
  })
  it('bounds response bytes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(65 * 1024))))
    expect(await setup().provider.interpret('wzięliśmy paletę kartonów', tools, context)).toEqual(fallbackResult)
  })
  it('does not silently guess a decision without Gemini — the offline parser takes over', async () => {
    respond(answer('take', '1', 0.2))
    await expect(setup(2000, false).provider.interpret('wzięliśmy paletę kartonów', tools, context)).rejects.toThrow('use offline parser')
  })
  it('signals an outage to the offline pipeline without private errors', async () => {
    respond({ secret: 'private-body' }, 503)
    await expect(setup(2000, false).provider.interpret('wzięliśmy paletę kartonów', tools, context)).rejects.toThrow('Decisions API HTTP 503')
  })
  it('keeps Gemini default when no OpenRouter key exists', () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    vi.stubEnv('GEMINI_API_KEY', 'google-test')
    expect(commandProviderFromEnv()).toBeInstanceOf(GeminiProvider)
  })
  it('activates Mercury Decide with OpenRouter key and configurable model', () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-secret')
    vi.stubEnv('OPENROUTER_MODEL', 'inception/mercury-decide:free')
    expect(commandAiConfigured()).toBe(true)
    const provider = commandProviderFromEnv()
    expect(provider).toBeInstanceOf(DecisionHybridProvider)
    expect((provider as DecisionHybridProvider).model).toBe('inception/mercury-decide:free')
  })
  it('derives Decisions endpoint from the standard OpenRouter configuration', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'synthetic-openrouter-key')
    vi.stubEnv('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1/')
    vi.stubEnv('OPENROUTER_MODEL', '')
    respond(answer())
    const provider = commandProviderFromEnv()!
    await provider.interpret('wzięliśmy paletę kartonów', tools, context)
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions')
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer synthetic-openrouter-key')
    expect(JSON.parse(options?.body as string).model).toBe('inception/mercury-decide:free')
  })
  it('does not send OpenRouter credentials to a custom base URL', () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'private-key')
    vi.stubEnv('OPENROUTER_BASE_URL', 'https://example.com/api/v1')
    respond(answer())
    expect(() => commandProviderFromEnv()).toThrow('OPENROUTER_BASE_URL')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects arbitrary endpoints before sending credentials', () => {
    respond(answer())
    expect(() => new DecisionHybridProvider({ apiKey: 'private-key', model: 'inception/mercury-decide:free', fallback: null, endpoint: 'https://example.com' })).toThrow('Unsupported Mercury Decide endpoint')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('hybrid proposal integration', () => {
  let db: Db
  beforeAll(async () => { db = await createPgliteDb(null); await initDb(db) })
  it('preserves confirm-before-write and discloses Mercury Decide in settings', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'synthetic-test')
    vi.stubEnv('DEMO_MODE', '')
    vi.stubEnv('LLM_MODE', 'llm')
    await db.query("UPDATE settings SET value = '\"llm\"'::jsonb WHERE key = 'agent_mode'")
    const before = await getItem(db, 1)
    vi.stubGlobal('fetch', vi.fn(async (_url, options: RequestInit) => {
      const body = JSON.parse(options.body as string)
      const response = answer()
      response.answers.item.probabilities = Object.fromEntries(Object.keys(body.questions.item.criteria).map((key) => [key, key === '1' ? 1 : 0]))
      return Response.json(response)
    }))
    const result = await runCommand(db, 'wzięliśmy paletę kartonów', { provider: setup().provider })
    expect(result.type).toBe('proposal')
    expect((await getItem(db, 1))?.quantity).toBe(before?.quantity)
    if (result.type !== 'proposal') throw new Error('Expected proposal')
    await confirmProposal(db, result.proposal.id)
    expect((await getItem(db, 1))?.quantity).toBe(before!.quantity - 2)
    const logs = await db.query('SELECT * FROM audit_log')
    expect(logs.length).toBeGreaterThan(0)
    expect((await getAgentModeStatus(db)).llm_available).toBe(true)
    const settings = await settingsPayload(db)
    expect(settings.ai_usage.llm_provider).toBe('openrouter.ai')
    expect(settings.ai_usage.disclosure).toContain('Mercury Decide')
    expect(settings.ai_usage.disclosure).toContain('Gemini')
    expect(settings.ai_usage.disclosure).not.toContain('synthetic-test')
  })
})
