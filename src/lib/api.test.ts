import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

type Api = typeof import('./api')

const assign = vi.fn()
let fetchMock: ReturnType<typeof vi.fn>

function respond(status: number, body: unknown) {
  return new Response(body === undefined ? 'not json' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Moduł ma stan (tryb logowania z /api/me) — każdy test dostaje świeżą kopię.
async function loadApi(): Promise<Api> {
  vi.resetModules()
  return import('./api')
}

beforeEach(() => {
  assign.mockReset()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('window', { location: { pathname: '/', assign } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('errors and session', () => {
  test('401 redirects to /login once and throws the server detail', async () => {
    const api = await loadApi()
    fetchMock.mockImplementation(async () => respond(401, { detail: 'Zaloguj się.' }))
    await expect(api.fetchStock()).rejects.toMatchObject({ status: 401, message: 'Zaloguj się.' })
    await expect(api.fetchHistory()).rejects.toBeInstanceOf(api.ApiError)
    expect(assign).toHaveBeenCalledTimes(1)
    expect(assign).toHaveBeenCalledWith('/login')
  })

  test('no redirect loop when already on the login page', async () => {
    const api = await loadApi()
    vi.stubGlobal('window', { location: { pathname: '/login', assign } })
    fetchMock.mockResolvedValue(respond(401, { detail: 'Zaloguj się.' }))
    await expect(api.fetchStock()).rejects.toThrow('Zaloguj się.')
    expect(assign).not.toHaveBeenCalled()
  })

  test('no redirect when /api/me reported that login is disabled', async () => {
    const api = await loadApi()
    fetchMock
      .mockResolvedValueOnce(respond(200, { user: null, auth_mode: 'disabled' }))
      .mockResolvedValueOnce(respond(401, { detail: 'Brak sesji.' }))
    expect((await api.fetchMe()).auth_mode).toBe('disabled')
    await expect(api.fetchStock()).rejects.toThrow('Brak sesji.')
    expect(assign).not.toHaveBeenCalled()
  })

  test('403 notifies forbidden listeners with the detail', async () => {
    const api = await loadApi()
    const listener = vi.fn()
    const stop = api.onApiForbidden(listener)
    fetchMock.mockResolvedValue(respond(403, { detail: 'Decyzję podejmuje kierownik.' }))
    const error = await api.approveReorderDraft(3).catch((reason: unknown) => reason)
    expect(api.isForbidden(error)).toBe(true)
    expect(listener).toHaveBeenCalledWith('Decyzję podejmuje kierownik.')
    stop()
    await api.approveReorderDraft(3).catch(() => {})
    expect(listener).toHaveBeenCalledTimes(1)
  })

  test('non-JSON error bodies fall back to the HTTP status', async () => {
    const api = await loadApi()
    fetchMock.mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502, statusText: 'Bad Gateway' }))
    await expect(api.fetchZones()).rejects.toThrow('502 Bad Gateway')
  })
})

describe('new endpoints', () => {
  test('version, settings, users and undo use the documented paths and bodies', async () => {
    const api = await loadApi()
    const settings = { prefix: 'Gosiu', mode: 'offline', adapter: 'database', default_minimum: 5, voice_mode: 'text' }
    const user = { id: 'u-1', email: 'a@b.pl', display_name: 'Anna', role: 'kierownik', created_at: '2026-10-03' }
    const undo = { audit_id: 9, item_name: 'Kartony', delta: 1, before: 53, after: 54, reorder_draft: null, undo_of: 7 }
    fetchMock
      .mockResolvedValueOnce(respond(200, { version: 12 }))
      .mockResolvedValueOnce(respond(200, settings))
      .mockResolvedValueOnce(respond(200, { users: [user] }))
      .mockResolvedValueOnce(respond(200, { user }))
      .mockResolvedValueOnce(respond(200, undo))

    expect(await api.fetchVersion()).toBe(12)
    expect(await api.saveSettings({ prefix: 'Gosiu', voice_mode: 'text' })).toEqual(settings)
    expect(await api.fetchUsers()).toEqual([user])
    expect(await api.updateUserRole('u-1', 'kierownik')).toEqual(user)
    expect(await api.undoHistoryEntry(7)).toEqual(undo)

    const calls = fetchMock.mock.calls.map(([url, init]) => [url, init?.method ?? 'GET', init?.body ?? null])
    expect(calls).toEqual([
      ['/api/version', 'GET', null],
      ['/api/settings', 'PATCH', JSON.stringify({ prefix: 'Gosiu', voice_mode: 'text' })],
      ['/api/users', 'GET', null],
      ['/api/users/u-1/role', 'PUT', JSON.stringify({ role: 'kierownik' })],
      ['/api/history/7/undo', 'POST', null],
    ])
  })
})

describe('speech upload', () => {
  test('audioUploadInfo strips codec parameters and maps the extension', async () => {
    const { audioUploadInfo } = await loadApi()
    expect(audioUploadInfo('audio/webm;codecs=opus')).toEqual({ mime: 'audio/webm', ext: 'webm' })
    expect(audioUploadInfo('audio/ogg; codecs=opus')).toEqual({ mime: 'audio/ogg', ext: 'ogg' })
    expect(audioUploadInfo('audio/mp4')).toEqual({ mime: 'audio/mp4', ext: 'mp4' })
    expect(audioUploadInfo('video/webm')).toEqual({ mime: 'audio/webm', ext: 'webm' })
    expect(audioUploadInfo('')).toEqual({ mime: 'audio/webm', ext: 'webm' })
  })

  test('transcribeAudio sends the real MIME type and matching filename', async () => {
    const api = await loadApi()
    fetchMock.mockResolvedValue(respond(200, { text: 'wzięliśmy paletę kartonów' }))
    const text = await api.transcribeAudio(new Blob([new Uint8Array(10)], { type: 'audio/mp4' }))
    expect(text).toBe('wzięliśmy paletę kartonów')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/stt?filename=audio.mp4')
    expect(init.headers).toEqual({ 'Content-Type': 'audio/mp4' })
  })

  test('a WAV recording uploads as audio/wav with a .wav filename', async () => {
    const api = await loadApi()
    fetchMock.mockResolvedValue(respond(200, { text: 'ile mamy kartonów' }))
    await api.transcribeAudio(new Blob([new Uint8Array(44)], { type: 'audio/wav' }))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/stt?filename=audio.wav')
    expect(init.headers).toEqual({ 'Content-Type': 'audio/wav' })
    expect(api.audioUploadInfo('audio/wave')).toEqual({ mime: 'audio/wav', ext: 'wav' })
  })

  test('recordings over 4 MB are rejected before upload', async () => {
    const api = await loadApi()
    const big = new Blob([new Uint8Array(api.MAX_UPLOAD_BYTES + 1)], { type: 'audio/webm' })
    await expect(api.transcribeAudio(big)).rejects.toThrow('4 MB')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
