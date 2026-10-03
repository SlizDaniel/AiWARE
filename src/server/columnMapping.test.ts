// LLM-assisted import column mapping: strict validation, null on any failure
// so the caller keeps the deterministic mapping. fetch is mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAPPING_TIMEOUT_MS, MAX_CELL_CHARS, parseMappingResponse, suggestColumnMappingWithLlm } from './columnMapping'

const KEY = 'gemini-test-key'
const HEADERS = ['Towar', 'Stan', 'Min.', 'Miejsce', 'J.m.', 'Uwagi']
const ROWS = [
  ['Kartony', '54', '12', 'A-1', 'szt.', ''],
  ['Szkło', '20', '8', 'B-2', 'szt.', 'kruche'],
]

type FetchArgs = [string, RequestInit]

const GOOD = {
  name: { column: 0, confidence: 0.98 },
  quantity: { column: 1, confidence: 0.9 },
  minimum: { column: 2, confidence: 0.8 },
  location: { column: 3, confidence: 0.85 },
  unit: { column: null, confidence: 0 },
}

function modelReply(text: string, finishReason = 'STOP') {
  return { candidates: [{ finishReason, content: { role: 'model', parts: [{ text }] } }] }
}

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => handler(url, init))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function replyWith(body: unknown, status = 200) {
  return stubFetch(
    () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  )
}

beforeEach(() => {
  for (const name of ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_MODEL']) vi.stubEnv(name, '')
  vi.stubEnv('GEMINI_API_KEY', KEY)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('suggestColumnMappingWithLlm', () => {
  it('returns the validated mapping', async () => {
    replyWith(modelReply(JSON.stringify(GOOD)))
    await expect(suggestColumnMappingWithLlm(HEADERS, ROWS)).resolves.toEqual(GOOD)
  })

  it('requests structured JSON output with the key only in the header', async () => {
    const fetchMock = replyWith(modelReply(JSON.stringify(GOOD)))
    await suggestColumnMappingWithLlm(HEADERS, ROWS)
    const [url, init] = fetchMock.mock.calls[0] as FetchArgs
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent')
    expect(url).not.toContain(KEY)
    expect(new Headers(init.headers).get('x-goog-api-key')).toBe(KEY)
    const body = JSON.parse(String(init.body))
    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' })
    expect(body.generationConfig).not.toHaveProperty('temperature')
    const schema = body.generationConfig.responseJsonSchema
    expect(schema.required).toEqual(['name', 'quantity', 'minimum', 'location', 'unit'])
    expect(schema.properties.name.properties.column).toEqual({ type: ['integer', 'null'], minimum: 0, maximum: 5 })
    expect(schema.properties.unit.properties.confidence).toEqual({ type: 'number', minimum: 0, maximum: 1 })
  })

  it('uses temperature 0 for Gemini 2.5', async () => {
    vi.stubEnv('GEMINI_MODEL', 'gemini-2.5-flash')
    const fetchMock = replyWith(modelReply(JSON.stringify(GOOD)))
    await suggestColumnMappingWithLlm(HEADERS, ROWS)
    const body = JSON.parse(String((fetchMock.mock.calls[0] as FetchArgs)[1].body))
    expect(body.generationConfig.temperature).toBe(0)
    expect(body.generationConfig).not.toHaveProperty('thinkingConfig')
  })

  it('sends at most 5 sample rows with cells truncated to 60 characters', async () => {
    const fetchMock = replyWith(modelReply(JSON.stringify(GOOD)))
    const long = 'x'.repeat(200)
    const rows = Array.from({ length: 9 }, (_, index) => [`wiersz-${index}`, long, '1', '', '', ''])
    await suggestColumnMappingWithLlm(HEADERS, rows)
    const prompt: string = JSON.parse(String((fetchMock.mock.calls[0] as FetchArgs)[1].body)).contents[0].parts[0].text
    const data = JSON.parse(prompt.slice(prompt.indexOf('{')))
    expect(data.headers).toEqual(HEADERS)
    expect(data.rows).toHaveLength(5)
    expect(data.rows[0][1]).toHaveLength(MAX_CELL_CHARS)
    expect(prompt).not.toContain('wiersz-5')
    expect(prompt).not.toContain('x'.repeat(MAX_CELL_CHARS + 1))
  })

  it('returns null without a key and never calls the network', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    const fetchMock = replyWith(modelReply(JSON.stringify(GOOD)))
    await expect(suggestColumnMappingWithLlm(HEADERS, ROWS)).resolves.toBeNull()
    await expect(suggestColumnMappingWithLlm([], [])).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['HTTP error', () => replyWith({ error: {} }, 500)],
    ['network error', () => stubFetch(() => Promise.reject(new TypeError('fetch failed')))],
    ['blocked prompt', () => replyWith({ promptFeedback: { blockReason: 'SAFETY' } })],
    ['truncated output', () => replyWith(modelReply(JSON.stringify(GOOD), 'MAX_TOKENS'))],
    ['plain text', () => replyWith(modelReply('Kolumna 0 to nazwa.'))],
    ['empty envelope', () => replyWith({})],
  ])('returns null on %s', async (_label, setup) => {
    setup()
    await expect(suggestColumnMappingWithLlm(HEADERS, ROWS)).resolves.toBeNull()
  })

  it('returns null after the 10 s budget', async () => {
    vi.useFakeTimers()
    stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const pending = suggestColumnMappingWithLlm(HEADERS, ROWS)
    await vi.advanceTimersByTimeAsync(MAPPING_TIMEOUT_MS)
    await expect(pending).resolves.toBeNull()
  })
})

describe('parseMappingResponse', () => {
  const variant = (patch: Record<string, unknown>) => JSON.stringify({ ...GOOD, ...patch })

  it('accepts a fenced JSON block', () => {
    expect(parseMappingResponse('```json\n' + JSON.stringify(GOOD) + '\n```', 6)).toEqual(GOOD)
  })

  it.each([
    ['index out of range', variant({ unit: { column: 6, confidence: 0.5 } })],
    ['negative index', variant({ unit: { column: -1, confidence: 0.5 } })],
    ['fractional index', variant({ unit: { column: 4.5, confidence: 0.5 } })],
    ['string index', variant({ unit: { column: '4', confidence: 0.5 } })],
    ['duplicate columns', variant({ unit: { column: 0, confidence: 0.5 } })],
    ['confidence above 1', variant({ unit: { column: 4, confidence: 1.2 } })],
    ['confidence below 0', variant({ unit: { column: 4, confidence: -0.1 } })],
    ['confidence missing', variant({ unit: { column: 4 } })],
    ['extra entry key', variant({ unit: { column: 4, confidence: 0.5, why: 'x' } })],
    ['entry not object', variant({ unit: 4 })],
    ['missing field', JSON.stringify({ name: GOOD.name, quantity: GOOD.quantity, minimum: GOOD.minimum, location: GOOD.location })],
    ['extra field', variant({ sku: { column: 5, confidence: 0.5 } })],
    ['duplicate keys', JSON.stringify(GOOD).replace('{"name"', '{"name":{"column":5,"confidence":1},"name"')],
    ['array', '[]'],
    ['not json', 'nazwa=0'],
    ['empty', ''],
  ])('rejects %s', (_label, text) => {
    expect(parseMappingResponse(text, 6)).toBeNull()
  })
})
