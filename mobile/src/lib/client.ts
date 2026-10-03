import type { AppSettings, CommandResponse, ConfirmResult, Health, HistoryEntry, ImportField, ImportPreview, Item, Me, Procedure, ReorderDraft, UndoResult, Zone } from './contracts'
import { withTimeout } from './withTimeout'

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'ApiError' }
}

/** Transport is independent of React Native so authorization/error paths can be tested. */
export function createApi(baseUrl: string, getToken: () => Promise<string | null>, fetcher: typeof fetch = fetch) {
  const url = new URL(baseUrl)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Adres API musi być adresem HTTP lub HTTPS bez danych logowania, parametrów i fragmentu.')
  }
  const base = baseUrl.replace(/\/+$/, '')

  async function request<T>(path: string, options: RequestInit = {}, decode?: (response: Response) => Promise<T>): Promise<T> {
    const token = await withTimeout(getToken(), 15_000,
      'Nie udało się odświeżyć sesji w ciągu 15 sekund. Sprawdź połączenie z internetem i spróbuj ponownie.')
    if (!token) throw new ApiError(401, 'Sesja wygasła. Zaloguj się ponownie.')
    const headers = new Headers(options.headers)
    headers.set('Authorization', `Bearer ${token}`)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 35_000)
    try {
      const response = await fetcher(`${base}${path}`, { ...options, headers, signal: controller.signal, redirect: 'error', cache: 'no-store' })
      if (response.ok && decode) return await decode(response)
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const detail = payload && typeof payload === 'object' && 'detail' in payload ? payload.detail : null
        throw new ApiError(response.status, typeof detail === 'string' ? detail : `Błąd serwera (${response.status}).`)
      }
      if (payload === null) throw new Error('Serwer zwrócił nieprawidłową odpowiedź.')
      return payload as T
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Serwer nie odpowiedział na czas. Sprawdź historię przed ponowieniem zapisu.')
      if (error instanceof TypeError) throw new Error(`Nie można połączyć się z serwerem ${base}. Sprawdź, czy telefon i serwer są w tej samej sieci i czy backend działa.`)
      throw error
    } finally { clearTimeout(timer) }
  }

  function json(method: string, value: unknown): RequestInit {
    return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }
  }

  return {
    me: () => request<Me>('/api/me'),
    health: () => request<Health>('/api/health'),
    settings: () => request<AppSettings>('/api/settings'),
    stock: () => request<{ items: Item[] }>('/api/stock').then(d => d.items),
    zones: () => request<{ zones: Zone[] }>('/api/zones').then(d => d.zones),
    history: () => request<{ entries: HistoryEntry[] }>('/api/history').then(d => d.entries),
    procedures: () => request<{ procedures: Procedure[] }>('/api/procedures').then(d => d.procedures),
    orders: () => request<{ drafts: ReorderDraft[] }>('/api/reorder-drafts').then(d => d.drafts),
    version: () => request<{ version: number }>('/api/version').then(d => d.version),
    command: (text: string) => request<CommandResponse>('/api/command', json('POST', { text })),
    confirm: (id: string) => request<ConfirmResult>(`/api/proposals/${encodeURIComponent(id)}/confirm`, { method: 'POST' }),
    undo: (id: number) => request<UndoResult>(`/api/history/${id}/undo`, { method: 'POST' }),
    decideOrder: (id: number, approve: boolean) => request(`/api/reorder-drafts/${id}/${approve ? 'approve' : 'reject'}`, { method: 'POST' }),
    saveSettings: (values: Partial<AppSettings>) => request<AppSettings>('/api/settings', json('PATCH', values)),
    transcribe: async (audio: Uint8Array, mime: string, extension: string) => {
      if (audio.byteLength > 4 * 1024 * 1024) throw new Error('Nagranie przekracza 4 MB. Nagraj krótszą komendę.')
      return request<{ text: string }>(`/api/stt?filename=audio.${extension}`, {
        method: 'POST', headers: { 'Content-Type': mime }, body: new Uint8Array(audio).buffer,
      }).then(d => d.text)
    },
    previewImport: (bytes: Uint8Array, name: string) => {
      if (bytes.byteLength > 4 * 1024 * 1024) throw new Error('Plik przekracza 4 MB.')
      return request<ImportPreview>(`/api/import/preview?filename=${encodeURIComponent(name)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(bytes).buffer,
      })
    },
    confirmImport: (id: string, mapping: Record<ImportField, number | null>) =>
      request<{ total: number }>('/api/import/confirm', json('POST', { import_id: id, mapping })),
    exportInventory: (format: 'xlsx' | 'csv') => request<Uint8Array>(`/api/export/${format}`, {},
      async response => new Uint8Array(await response.arrayBuffer())),
  }
}

export type Api = ReturnType<typeof createApi>
