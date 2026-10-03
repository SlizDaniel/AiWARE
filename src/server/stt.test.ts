// Card 04 — STT seam (port of legacy test_stt.py): Gemini audio understanding by
// default, Whisper-compatible endpoint when STT_API_KEY is set. Every failure is
// an STTUnavailable that points the user at the text field. fetch is mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  geminiAudioMimeType,
  STT_TIMEOUT_MS,
  STTUnavailable,
  transcribe,
  WHISPER_DEFAULT_BASE_URL,
  WHISPER_DEFAULT_MODEL,
} from './stt'

const GEMINI_KEY = 'gemini-test-key'
const WHISPER_KEY = 'whisper-test-key'
const AUDIO = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x01, 0x02, 0x03])

type FetchArgs = [string, RequestInit]

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function geminiText(text: string, finishReason = 'STOP') {
  return { candidates: [{ finishReason, content: { role: 'model', parts: [{ text }] } }] }
}

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => handler(url, init))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function failure(promise: Promise<unknown>): Promise<STTUnavailable> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(STTUnavailable)
  return error as STTUnavailable
}

beforeEach(() => {
  for (const name of ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY', 'STT_API_KEY', 'STT_BASE_URL', 'STT_MODEL', 'GEMINI_MODEL', 'GEMINI_STT_MODEL']) {
    vi.stubEnv(name, '')
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('transcribe — Gemini audio understanding (default)', () => {
  beforeEach(() => vi.stubEnv('GEMINI_API_KEY', GEMINI_KEY))

  it('sends inline base64 audio with a Polish verbatim prompt and returns the text', async () => {
    const fetchMock = stubFetch(() => jsonResponse(geminiText('  wzięliśmy paletę kartonów \n')))
    await expect(transcribe(AUDIO, 'audio/webm;codecs=opus')).resolves.toBe('wzięliśmy paletę kartonów')

    const [url, init] = fetchMock.mock.calls[0] as FetchArgs
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent')
    expect(url).not.toContain(GEMINI_KEY)
    expect(new Headers(init.headers).get('x-goog-api-key')).toBe(GEMINI_KEY)
    const body = JSON.parse(String(init.body))
    const [audioPart, promptPart] = body.contents[0].parts
    expect(audioPart).toEqual({ inlineData: { mimeType: 'audio/webm', data: Buffer.from(AUDIO).toString('base64') } })
    expect(promptPart.text).toMatch(/polską mowę/)
    expect(promptPart.text).toMatch(/pustą odpowiedź/)
    expect(body.generationConfig).toEqual({ thinkingConfig: { thinkingLevel: 'low' } })
  })

  it('uses GEMINI_STT_MODEL and model-appropriate settings', async () => {
    vi.stubEnv('GEMINI_STT_MODEL', 'gemini-2.5-flash')
    const fetchMock = stubFetch(() => jsonResponse(geminiText('ile mamy?')))
    await transcribe(AUDIO, 'audio/ogg')
    const [url, init] = fetchMock.mock.calls[0] as FetchArgs
    expect(url).toContain('/models/gemini-2.5-flash:generateContent')
    expect(JSON.parse(String(init.body)).generationConfig).toEqual({ temperature: 0 })
  })

  it('uses a transcription config for dedicated transcribe models', async () => {
    vi.stubEnv('GEMINI_STT_MODEL', 'gemini-3.5-transcribe')
    const fetchMock = stubFetch(() => jsonResponse(geminiText('ile mamy?')))
    await expect(transcribe(AUDIO, 'audio/webm')).resolves.toBe('ile mamy?')
    const body = JSON.parse(String((fetchMock.mock.calls[0] as FetchArgs)[1].body))
    expect(body.contents[0].parts).toHaveLength(1)
    expect(body.generationConfig).toEqual({ audioTranscriptionConfig: { languageCodes: ['pl-PL'] } })
  })

  it('ignores thought parts', async () => {
    stubFetch(() =>
      jsonResponse({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'analiza…', thought: true }, { text: 'ile mamy?' }] } }],
      }),
    )
    await expect(transcribe(AUDIO, 'audio/webm')).resolves.toBe('ile mamy?')
  })

  it.each([
    ['audio/webm;codecs=opus', 'audio/webm'],
    ['audio/ogg; codecs=opus', 'audio/ogg'],
    ['audio/mp4', 'audio/m4a'],
    ['AUDIO/MP4;codecs=mp4a.40.2', 'audio/m4a'],
    ['audio/wav', 'audio/wav'],
    ['audio/x-wav', 'audio/wav'],
    ['text/plain', null],
    ['', null],
  ])('maps %j to %j', (input, expected) => {
    expect(geminiAudioMimeType(input)).toBe(expected)
  })

  it('rejects unsupported formats and empty audio without calling the API', async () => {
    const fetchMock = stubFetch(() => jsonResponse(geminiText('x')))
    expect((await failure(transcribe(AUDIO, 'application/pdf'))).message).toContain('wpisz komendę')
    expect((await failure(transcribe(new Uint8Array(0), 'audio/webm'))).message).toContain('wpisz komendę')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    [401, 'odrzuciło klucz (401)'],
    [403, 'odrzuciło klucz (403)'],
    [429, 'Limit API STT Gemini wyczerpany (429)'],
    [500, 'API STT Gemini zwróciło błąd (500)'],
  ])('maps HTTP %i to an explicit message', async (status, expected) => {
    stubFetch(() => jsonResponse({ error: { message: 'secret-detail' } }, status))
    const error = await failure(transcribe(AUDIO, 'audio/webm'))
    expect(error.message).toContain(expected)
    expect(error.message).toContain('wpisz komendę w polu tekstowym')
    expect(error.message).not.toContain('secret')
  })

  it('recognises an invalid key reported as HTTP 400', async () => {
    stubFetch(() =>
      jsonResponse(
        {
          error: {
            code: 400,
            message: 'API key not valid. secret-detail',
            status: 'INVALID_ARGUMENT',
            details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }],
          },
        },
        400,
      ),
    )
    const error = await failure(transcribe(AUDIO, 'audio/webm'))
    expect(error.message).toContain('sprawdź GEMINI_API_KEY')
    expect(error.message).not.toContain('secret')
  })

  it.each([
    ['not json', 'not-json'],
    ['array', '[]'],
    ['no candidates', '{}'],
    ['blank text', JSON.stringify(geminiText('   '))],
    ['no speech', JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [] } }] })],
    ['only thoughts', JSON.stringify({ candidates: [{ content: { parts: [{ text: 'x', thought: true }] } }] })],
    ['blocked', JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } })],
    ['truncated', JSON.stringify(geminiText('wzięliśmy pal', 'MAX_TOKENS'))],
    ['parts wrong type', JSON.stringify({ candidates: [{ content: { parts: 'x' } }] })],
  ])('malformed response (%s) uses the text fallback', async (_label, body) => {
    stubFetch(() => jsonResponse(body))
    expect((await failure(transcribe(AUDIO, 'audio/webm'))).message).toContain('wpisz komendę')
  })

  it('network failure signals unavailable, then recovers', async () => {
    let calls = 0
    stubFetch(() => {
      calls += 1
      if (calls === 1) throw new TypeError('fetch failed')
      return jsonResponse(geminiText('wzięliśmy paletę kartonów'))
    })
    expect((await failure(transcribe(AUDIO, 'audio/webm'))).message).toContain('STT')
    await expect(transcribe(AUDIO, 'audio/webm')).resolves.toBe('wzięliśmy paletę kartonów')
  })

  it('gives up after the 15 s budget', async () => {
    vi.useFakeTimers()
    stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const pending = failure(transcribe(AUDIO, 'audio/webm'))
    await vi.advanceTimersByTimeAsync(STT_TIMEOUT_MS)
    expect((await pending).message).toContain('timeout')
  })
})

describe('transcribe — missing configuration', () => {
  it('without any key signals unavailable with the Gemini hint, without network', async () => {
    const fetchMock = stubFetch(() => jsonResponse(geminiText('x')))
    const error = await failure(transcribe(AUDIO, 'audio/webm'))
    expect(error.message).toBe('Brak klucza API Gemini (GEMINI_API_KEY) — wpisz komendę w polu tekstowym.')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('transcribe — Whisper-compatible endpoint (STT_API_KEY)', () => {
  beforeEach(() => {
    vi.stubEnv('STT_API_KEY', WHISPER_KEY)
    vi.stubEnv('GEMINI_API_KEY', GEMINI_KEY)
  })

  it('sends multipart with language=pl and parses text; empty overrides fall back to defaults', async () => {
    const fetchMock = stubFetch(() => jsonResponse({ text: 'wzięliśmy paletę kartonów' }))
    await expect(transcribe(AUDIO, 'audio/webm;codecs=opus')).resolves.toBe('wzięliśmy paletę kartonów')

    const [url, init] = fetchMock.mock.calls[0] as FetchArgs
    expect(url).toBe(`${WHISPER_DEFAULT_BASE_URL}/audio/transcriptions`)
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${WHISPER_KEY}`)
    const form = init.body as FormData
    expect(form.get('model')).toBe(WHISPER_DEFAULT_MODEL)
    expect(form.get('language')).toBe('pl')
    const file = form.get('file') as File
    expect(file.name).toBe('audio.webm')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(AUDIO)
  })

  it('honours STT_BASE_URL and STT_MODEL', async () => {
    vi.stubEnv('STT_BASE_URL', 'https://stt.example.test/v1/')
    vi.stubEnv('STT_MODEL', 'whisper-1')
    const fetchMock = stubFetch(() => jsonResponse({ text: 'ile mamy?' }))
    await transcribe(AUDIO, 'audio/mp4')
    const [url, init] = fetchMock.mock.calls[0] as FetchArgs
    expect(url).toBe('https://stt.example.test/v1/audio/transcriptions')
    expect((init.body as FormData).get('model')).toBe('whisper-1')
    expect(((init.body as FormData).get('file') as File).name).toBe('audio.m4a')
  })

  it.each([
    [401, 'API STT odrzuciło klucz (401) — sprawdź STT_API_KEY — wpisz komendę w polu tekstowym.'],
    [429, 'Limit API STT wyczerpany (429) — wpisz komendę w polu tekstowym.'],
    [502, 'API STT zwróciło błąd (502) — wpisz komendę w polu tekstowym.'],
  ])('maps HTTP %i exactly like stt.py', async (status, message) => {
    stubFetch(() => jsonResponse({ error: 'secret' }, status))
    expect((await failure(transcribe(AUDIO, 'audio/wav'))).message).toBe(message)
  })

  it.each(['not-json', '[]', '{"text": null}', '{"text": 42}', '{"text": {"unexpected": "command"}}', '{"text": "   "}'])(
    'malformed body %j uses the text fallback',
    async (body) => {
      stubFetch(() => jsonResponse(body))
      expect((await failure(transcribe(AUDIO, 'audio/wav'))).message).toContain('wpisz komendę')
    },
  )

  it('network failure names the error class', async () => {
    stubFetch(() => {
      throw new TypeError('fetch failed')
    })
    expect((await failure(transcribe(AUDIO, 'audio/wav'))).message).toBe(
      'API STT nieosiągalne (TypeError) — wpisz komendę w polu tekstowym.',
    )
  })

  it('times out after 15 s', async () => {
    vi.useFakeTimers()
    stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const pending = failure(transcribe(AUDIO, 'audio/wav'))
    await vi.advanceTimersByTimeAsync(STT_TIMEOUT_MS)
    expect((await pending).message).toContain('API STT nieosiągalne (timeout)')
  })
})
