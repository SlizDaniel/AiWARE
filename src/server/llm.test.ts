// Provider contract tests (port of legacy test_llm.py + test_llm_completion.py):
// no API key, network or inventory writes required — fetch is mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  decodeJson,
  GeminiProvider,
  llmConfigured,
  MAX_RESPONSE_BYTES,
  providerFromEnv,
  toGeminiSchema,
  validateToolCall,
} from './llm'
import { LLMProviderError, type ToolSchema } from './types'

const TOOLS: ToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'update_stock',
      description: 'Zmień stan pozycji.',
      parameters: {
        type: 'object',
        properties: {
          item_id: { type: 'integer', minimum: 1 },
          delta: { type: 'integer', minimum: -1000, maximum: 1000 },
        },
        required: ['item_id', 'delta'],
        additionalProperties: false,
      },
    },
  },
]

const KEY = 'test-key-123'

type FetchArgs = [string, RequestInit]

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function geminiResponse(parts: unknown, finishReason: unknown = 'STOP'): Record<string, unknown> {
  const candidate: Record<string, unknown> = { content: { role: 'model', parts } }
  if (finishReason !== undefined) candidate.finishReason = finishReason
  return { candidates: [candidate] }
}

function callParts(args: unknown, name = 'update_stock') {
  return [{ functionCall: { id: 'call-1', name, args }, thoughtSignature: 'c2ln' }]
}

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => handler(url, init))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function respondWith(body: unknown) {
  return stubFetch(() => jsonResponse(body))
}

function provider(model = 'gemini-3.8-flash', timeoutMs?: number) {
  return new GeminiProvider({ apiKey: KEY, model, timeoutMs })
}

async function interpret(body: unknown, tools = TOOLS) {
  respondWith(body)
  return provider().interpret('pobraliśmy cztery kartony', tools)
}

beforeEach(() => {
  ;(globalThis as { __magazynierLlmInFlight?: number }).__magazynierLlmInFlight = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('GeminiProvider.interpret — tool contract', () => {
  it('returns a valid call without executing it', async () => {
    const result = await interpret(geminiResponse(callParts({ item_id: 1, delta: -4 })))
    expect(result).toEqual({ toolCall: { name: 'update_stock', arguments: { item_id: 1, delta: -4 } }, clarification: null })
  })

  it('returns a clarification without a tool', async () => {
    const result = await interpret(geminiResponse([{ text: '  Ile kartonów pobrano?  ' }]))
    expect(result).toEqual({ toolCall: null, clarification: 'Ile kartonów pobrano?' })
  })

  it('concatenates text parts and skips thought summaries', async () => {
    const result = await interpret(
      geminiResponse([{ text: 'Myślę o kartonach…', thought: true }, { text: 'Ile ' }, { text: 'kartonów?' }]),
    )
    expect(result.clarification).toBe('Ile kartonów?')
  })

  it('accepts a call preceded by text and carrying a thought signature', async () => {
    const parts = [{ text: 'Już zapisuję.' }, ...callParts({ item_id: 2, delta: 3 })]
    const result = await interpret(geminiResponse(parts))
    expect(result.toolCall).toEqual({ name: 'update_stock', arguments: { item_id: 2, delta: 3 } })
  })

  it('treats omitted args as an empty object', async () => {
    const tools: ToolSchema[] = [
      {
        type: 'function',
        function: {
          name: 'get_stock',
          description: 'Stan magazynu.',
          parameters: { type: 'object', properties: { item_id: { type: 'integer' } }, required: [], additionalProperties: false },
        },
      },
    ]
    const result = await interpret(geminiResponse([{ functionCall: { name: 'get_stock' } }]), tools)
    expect(result.toolCall).toEqual({ name: 'get_stock', arguments: {} })
  })

  it('truncates long clarifications to 1000 characters (code points)', async () => {
    const result = await interpret(geminiResponse([{ text: '📦'.repeat(1500) }]))
    expect(Array.from(result.clarification ?? '')).toHaveLength(1000)
  })

  it.each([
    ['null body', null],
    ['array body', []],
    ['string body', 'wrong shape'],
    ['empty object', {}],
    ['no candidates', { candidates: [] }],
    ['candidate not object', { candidates: [null] }],
    ['blank text', geminiResponse([{ text: ' ' }])],
    ['only thoughts', geminiResponse([{ text: 'myślę', thought: true }])],
    ['no content', { candidates: [{ finishReason: 'STOP' }] }],
    ['content wrong type', { candidates: [{ content: 'x', finishReason: 'STOP' }] }],
    ['parts wrong type', geminiResponse('wrong type')],
    ['parts number', geminiResponse(4)],
    ['part null', geminiResponse([null])],
    ['string args', geminiResponse([{ functionCall: { name: 'update_stock', args: '{broken' } }])],
    ['functionCall not object', geminiResponse([{ functionCall: 'update_stock' }])],
    ['functionCall without name', geminiResponse([{ functionCall: { args: { item_id: 1, delta: 1 } } }])],
    ['two calls', geminiResponse([...callParts({ item_id: 1, delta: -4 }), ...callParts({ item_id: 1, delta: -4 })])],
    ['unregistered tool', geminiResponse(callParts({ item_id: 1, delta: -4 }, 'unregistered_tool'))],
    ['blocked prompt', { promptFeedback: { blockReason: 'SAFETY' } }],
    ['blocked prompt with candidate', { promptFeedback: { blockReason: 'OTHER' }, ...geminiResponse([{ text: 'Ile?' }]) }],
  ])('rejects a bad response (%s) with LLMProviderError', async (_label, body) => {
    await expect(interpret(body)).rejects.toBeInstanceOf(LLMProviderError)
  })

  it.each([
    [[]],
    [{ item_id: 1 }],
    [{ item_id: true, delta: -4 }],
    [{ item_id: 1, delta: '-4' }],
    [{ item_id: 1.5, delta: -4 }],
    [{ item_id: 0, delta: -4 }],
    [{ item_id: 1, delta: -1001 }],
    [{ item_id: 1, delta: 1001 }],
    [{ item_id: 1, delta: -4, execute_without_confirmation: true }],
  ])('rejects invalid arguments %j', async (args) => {
    await expect(interpret(geminiResponse(callParts(args)))).rejects.toBeInstanceOf(LLMProviderError)
  })

  it('validates nested objects and array items', async () => {
    const tools: ToolSchema[] = [
      {
        type: 'function',
        function: {
          name: 'update_stock',
          description: 'x',
          parameters: {
            type: 'object',
            required: ['changes'],
            additionalProperties: false,
            properties: {
              changes: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  required: ['action'],
                  additionalProperties: false,
                  properties: { action: { type: 'string', enum: ['take', 'receive'] } },
                },
              },
            },
          },
        },
      },
    ]
    const ok = await interpret(geminiResponse(callParts({ changes: [{ action: 'take' }] })), tools)
    expect(ok.toolCall?.arguments).toEqual({ changes: [{ action: 'take' }] })
    for (const args of [{ changes: [] }, { changes: [{ action: 'delete' }] }, { changes: [4] }]) {
      await expect(interpret(geminiResponse(callParts(args)), tools)).rejects.toBeInstanceOf(LLMProviderError)
    }
  })

  it('turns transport failure into a fallback error', async () => {
    stubFetch(() => {
      throw new TypeError('fetch failed')
    })
    await expect(provider().interpret('pobraliśmy kartony', TOOLS)).rejects.toBeInstanceOf(LLMProviderError)
  })

  it('rejects empty tool lists and blank commands without calling the network', async () => {
    const fetchMock = respondWith(geminiResponse([{ text: 'Ile?' }]))
    await expect(provider().interpret('komenda', [])).rejects.toBeInstanceOf(LLMProviderError)
    await expect(provider().interpret('   ', TOOLS)).rejects.toBeInstanceOf(LLMProviderError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('GeminiProvider.interpret — incomplete output never becomes an action', () => {
  const valid = callParts({ item_id: 1, delta: -40 })

  it.each(['MAX_TOKENS', 'SAFETY', 'MALFORMED_FUNCTION_CALL', 'FINISH_REASON_UNSPECIFIED', 'unknown', null, []])(
    'rejects finishReason %j even with valid arguments',
    async (reason) => {
      await expect(interpret(geminiResponse(valid, reason))).rejects.toBeInstanceOf(LLMProviderError)
    },
  )

  it('accepts STOP', async () => {
    const result = await interpret(geminiResponse(valid, 'STOP'))
    expect(result.toolCall?.arguments.delta).toBe(-40)
  })

  it('tolerates an omitted finishReason', async () => {
    const result = await interpret(geminiResponse(valid, undefined))
    expect(result.toolCall).not.toBeNull()
  })
})

describe('GeminiProvider — transport safety', () => {
  it('maps HTTP errors without echoing the body', async () => {
    stubFetch(() => jsonResponse({ error: { message: 'secret-provider-detail' } }, { status: 500 }))
    const error = await provider().interpret('komenda', TOOLS).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(LLMProviderError)
    expect((error as Error).message).toContain('HTTP 500')
    expect((error as Error).message).not.toContain('secret')
  })

  it('rejects declared oversized responses before parsing', async () => {
    stubFetch(
      () =>
        new Response('{}', {
          status: 200,
          headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) },
        }),
    )
    await expect(provider().interpret('komenda', TOOLS)).rejects.toThrow(/size limit/)
  })

  it('rejects streamed oversized responses without a length header', async () => {
    const chunk = new Uint8Array(256 * 1024).fill(0x20)
    let sent = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 5) return controller.close()
        sent += 1
        controller.enqueue(chunk)
      },
    })
    stubFetch(() => new Response(stream, { status: 200 }))
    await expect(provider().interpret('komenda', TOOLS)).rejects.toThrow(/size limit/)
  })

  it('rejects duplicate keys and excessive nesting in the raw body', async () => {
    stubFetch(() => jsonResponse('{"candidates": [], "candidates": []}'))
    await expect(provider().interpret('komenda', TOOLS)).rejects.toBeInstanceOf(LLMProviderError)
    const deep = '['.repeat(500) + ']'.repeat(500)
    stubFetch(() => jsonResponse(deep))
    await expect(provider().interpret('komenda', TOOLS)).rejects.toBeInstanceOf(LLMProviderError)
    const dupArgs =
      '{"candidates":[{"finishReason":"STOP","content":{"parts":[{"functionCall":' +
      '{"name":"update_stock","args":{"item_id":1,"delta":-4,"delta":4}}}]}}]}'
    stubFetch(() => jsonResponse(dupArgs))
    await expect(provider().interpret('komenda', TOOLS)).rejects.toThrow(/invalid or excessively nested/)
  })

  it('aborts the whole request after the time budget', async () => {
    stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const started = Date.now()
    await expect(provider('gemini-3.8-flash', 50).interpret('komenda', TOOLS)).rejects.toThrow(/timed out/)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('aborts a body that trickles past the deadline', async () => {
    stubFetch((_url, init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"candidates":'))
          init.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
        },
      })
      return new Response(stream, { status: 200 })
    })
    await expect(provider('gemini-3.8-flash', 50).interpret('komenda', TOOLS)).rejects.toThrow(/timed out/)
  })

  it('allows at most two in-flight requests per process', async () => {
    const pending: Array<() => void> = []
    stubFetch(
      () =>
        new Promise<Response>((resolve) => {
          pending.push(() => resolve(jsonResponse(geminiResponse([{ text: 'Ile?' }]))))
        }),
    )
    const first = provider().interpret('a', TOOLS)
    const second = provider().interpret('b', TOOLS)
    await expect(provider().interpret('c', TOOLS)).rejects.toThrow(/capacity/)
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    pending.forEach((resolve) => resolve())
    await expect(first).resolves.toEqual({ toolCall: null, clarification: 'Ile?' })
    await expect(second).resolves.toEqual({ toolCall: null, clarification: 'Ile?' })
    // Slots are released once HTTP ends.
    respondWith(geminiResponse([{ text: 'Ile?' }]))
    await expect(provider().interpret('d', TOOLS)).resolves.toEqual({ toolCall: null, clarification: 'Ile?' })
  })

  it('releases the slot after a failed request', async () => {
    stubFetch(() => jsonResponse({}, { status: 503 }))
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(provider().interpret('komenda', TOOLS)).rejects.toThrow(/HTTP 503/)
    }
  })
})

describe('GeminiProvider — request shape', () => {
  it('sends a generateContent request with the key only in the header (Gemini 3)', async () => {
    const fetchMock = respondWith(geminiResponse([{ text: 'Ile?' }]))
    await provider('gemini-3.8-flash').interpret('pobraliśmy kartony', TOOLS, 'id=1 Kartony')
    const [url, init] = fetchMock.mock.calls[0] as FetchArgs
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent')
    expect(url).not.toContain(KEY)
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('error')
    const headers = new Headers(init.headers)
    expect(headers.get('x-goog-api-key')).toBe(KEY)
    expect(headers.get('authorization')).toBeNull()

    const body = JSON.parse(String(init.body))
    expect(body.systemInstruction.parts[0].text).toContain('Jesteś asystentem magazynowym')
    expect(body.systemInstruction.parts[0].text).toContain('Kontekst magazynu: id=1 Kartony')
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'pobraliśmy kartony' }] }])
    expect(body.toolConfig).toEqual({ functionCallingConfig: { mode: 'AUTO' } })
    expect(body.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: 'update_stock',
            description: 'Zmień stan pozycji.',
            parameters: {
              type: 'object',
              properties: {
                item_id: { type: 'integer', minimum: 1 },
                delta: { type: 'integer', minimum: -1000, maximum: 1000 },
              },
              required: ['item_id', 'delta'],
            },
          },
        ],
      },
    ])
    expect(body.generationConfig).toEqual({ thinkingConfig: { thinkingLevel: 'low' } })
    expect(JSON.stringify(body)).not.toMatch(/temperature|topP|topK|additionalProperties/)
  })

  it('uses temperature 0 and no thinkingLevel for Gemini 2.5', async () => {
    const fetchMock = respondWith(geminiResponse([{ text: 'Ile?' }]))
    await provider('gemini-2.5-flash').interpret('komenda', TOOLS)
    const [url, init] = fetchMock.mock.calls[0] as FetchArgs
    expect(url).toContain('/models/gemini-2.5-flash:generateContent')
    const body = JSON.parse(String(init.body))
    expect(body.generationConfig).toEqual({ temperature: 0 })
    expect(body.systemInstruction.parts[0].text).toContain('brak dodatkowych danych')
  })

  it('accepts a models/ prefix and rejects unsafe model names', async () => {
    const fetchMock = respondWith(geminiResponse([{ text: 'Ile?' }]))
    await provider('models/gemini-3.8-flash').interpret('komenda', TOOLS)
    expect(fetchMock.mock.calls[0][0]).toContain('/models/gemini-3.8-flash:generateContent')
    await expect(provider('../evil?x=').interpret('komenda', TOOLS)).rejects.toBeInstanceOf(LLMProviderError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('omits parameters for tools without properties', async () => {
    const fetchMock = respondWith(geminiResponse([{ text: 'Ile?' }]))
    const tools: ToolSchema[] = [
      { type: 'function', function: { name: 'ping', description: 'p', parameters: { type: 'object', properties: {} } } },
    ]
    await provider().interpret('komenda', tools)
    const body = JSON.parse(String((fetchMock.mock.calls[0] as FetchArgs)[1].body))
    expect(body.tools[0].functionDeclarations[0]).toEqual({ name: 'ping', description: 'p' })
  })
})

describe('toGeminiSchema', () => {
  it('strips keywords Gemini rejects, recursively', () => {
    expect(
      toGeminiSchema({
        type: 'object',
        additionalProperties: false,
        required: ['level', 'ghost'],
        properties: {
          level: { type: 'integer', enum: [1, 2] },
          kind: { type: 'string', enum: ['a', 'b'], minLength: 1, maxLength: 5 },
          list: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', additionalProperties: false, properties: { x: { type: 'number' } } } },
        },
      }),
    ).toEqual({
      type: 'object',
      required: ['level'],
      properties: {
        level: { type: 'integer' },
        kind: { type: 'string', enum: ['a', 'b'], minLength: 1, maxLength: 5 },
        list: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', properties: { x: { type: 'number' } } } },
      },
    })
  })
})

describe('validateToolCall', () => {
  const tool = (parameters: ToolSchema['function']['parameters']): ToolSchema[] => [
    { type: 'function', function: { name: 't', description: 'd', parameters } },
  ]

  it('distinguishes integer, number and boolean', () => {
    const tools = tool({ type: 'object', properties: { n: { type: 'number' }, i: { type: 'integer' }, b: { type: 'boolean' } } })
    expect(() => validateToolCall('t', { n: 1.5, i: 2, b: false }, tools)).not.toThrow()
    expect(() => validateToolCall('t', { i: 2.5 }, tools)).toThrow(LLMProviderError)
    expect(() => validateToolCall('t', { n: true }, tools)).toThrow(LLMProviderError)
    expect(() => validateToolCall('t', { b: 0 }, tools)).toThrow(LLMProviderError)
    expect(() => validateToolCall('t', { n: Number.POSITIVE_INFINITY }, tools)).toThrow(/Non-finite/)
  })

  it('checks string lengths in code points', () => {
    const tools = tool({ type: 'object', properties: { s: { type: 'string', minLength: 1, maxLength: 2 } } })
    expect(() => validateToolCall('t', { s: '📦📦' }, tools)).not.toThrow()
    expect(() => validateToolCall('t', { s: '' }, tools)).toThrow(/too short/)
    expect(() => validateToolCall('t', { s: 'abc' }, tools)).toThrow(/too long/)
  })

  it('does not treat prototype names as declared properties', () => {
    const tools = tool({ type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false })
    expect(() => validateToolCall('t', { constructor: 'x' }, tools)).toThrow(/unexpected fields/)
    expect(() => validateToolCall('t', decodeJson('{"__proto__": {"a": 1}}'), tools)).toThrow(/unexpected fields/)
  })

  it('requires an object schema and a registered name', () => {
    expect(() => validateToolCall('t', {}, tool({ type: 'string' }))).toThrow(/must describe an object/)
    expect(() => validateToolCall('other', {}, tool({ type: 'object' }))).toThrow(/unregistered/)
    expect(() => validateToolCall('t', null, tool({ type: 'object' }))).toThrow(/JSON object/)
  })

  it('rejects values whose schema has no type, like the Python port', () => {
    const tools = tool({ type: 'object', properties: { list: { type: 'array' } } })
    expect(() => validateToolCall('t', { list: [] }, tools)).not.toThrow()
    expect(() => validateToolCall('t', { list: [1] }, tools)).toThrow(/Invalid JSON type/)
  })
})

describe('decodeJson', () => {
  it('parses standard JSON', () => {
    expect(decodeJson(' {"a": [1, -2.5e1, true, false, null, "x\\u0105\\n"]} ')).toEqual({
      a: [1, -25, true, false, null, 'xą\n'],
    })
  })

  it.each(['{"a":1,"a":2}', '{"a":{"b":1,"b":1}}', '{a:1}', "{'a':1}", '[1,]', '01', 'NaN', '1e400', '"\u0001"', '{"a":1} x', ''])(
    'rejects %j',
    (source) => {
      expect(() => decodeJson(source)).toThrow(LLMProviderError)
    },
  )

  it('limits nesting depth', () => {
    expect(() => decodeJson('['.repeat(64) + ']'.repeat(64))).not.toThrow()
    expect(() => decodeJson('['.repeat(65) + ']'.repeat(65))).toThrow(/nested/)
  })

  it('keeps __proto__ as an own property', () => {
    const value = decodeJson('{"__proto__": {"polluted": true}}') as Record<string, unknown>
    expect(Object.hasOwn(value, '__proto__')).toBe(true)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
  })
})

describe('providerFromEnv / llmConfigured', () => {
  function clearKeys() {
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', '')
    vi.stubEnv('GOOGLE_API_KEY', '')
  }

  it('throws without a key and never calls the network', () => {
    clearKeys()
    const fetchMock = respondWith({})
    expect(llmConfigured()).toBe(false)
    expect(() => providerFromEnv()).toThrow(LLMProviderError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('builds a provider from GEMINI_API_KEY and GEMINI_MODEL', () => {
    clearKeys()
    vi.stubEnv('GEMINI_API_KEY', KEY)
    vi.stubEnv('GEMINI_MODEL', 'gemini-2.5-flash')
    expect(llmConfigured()).toBe(true)
    const created = providerFromEnv()
    expect(created.model).toBe('gemini-2.5-flash')
    expect(created.timeoutMs).toBe(15_000)
    expect(JSON.stringify(created)).not.toContain(KEY)
  })

  it('defaults to gemini-3.8-flash', () => {
    clearKeys()
    vi.stubEnv('GEMINI_API_KEY', KEY)
    vi.stubEnv('GEMINI_MODEL', '')
    expect(providerFromEnv().model).toBe('gemini-3.8-flash')
  })
})
