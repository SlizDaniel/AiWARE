import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApi } from '../mobile/src/lib/client'

describe('mobile API transport', () => {
  it('sends the current bearer token on each request', async () => {
    const tokens = ['first', 'refreshed']
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ items: [] }))
    const api = createApi('https://warehouse.example/', async () => tokens.shift() ?? null, fetcher)
    await api.stock(); await api.stock()
    expect(fetcher.mock.calls[0][0]).toBe('https://warehouse.example/api/stock')
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer first')
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('Authorization')).toBe('Bearer refreshed')
    expect(fetcher.mock.calls[0][1]?.redirect).toBe('error')
  })

  it('rejects expired sessions before sending a request', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const api = createApi('https://warehouse.example', async () => null, fetcher)
    await expect(api.stock()).rejects.toMatchObject({ status: 401 })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('shows authorization errors from the server', async () => {
    const api = createApi('https://warehouse.example', async () => 'token', async () => Response.json({ detail: 'Tylko kierownik.' }, { status: 403 }))
    await expect(api.undo(1)).rejects.toEqual(new ApiError(403, 'Tylko kierownik.'))
  })

  it('returns a proposed command without automatically confirming it', async () => {
    const response = { type: 'proposal', proposal: { id: 'pending', summary: 'Kartony 13→11' } }
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(response))
    const api = createApi('https://warehouse.example', async () => 'token', fetcher)
    expect(await api.command('wzięliśmy paletę kartonów')).toEqual(response)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ text: 'wzięliśmy paletę kartonów' })
  })

  it('encodes proposal ids and sends explicit confirmation', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ applied: true }))
    await createApi('https://warehouse.example', async () => 'token', fetcher).confirm('id/with spaces')
    expect(fetcher.mock.calls[0][0]).toBe('https://warehouse.example/api/proposals/id%2Fwith%20spaces/confirm')
    expect(fetcher.mock.calls[0][1]?.method).toBe('POST')
  })

  it('sends recorded audio as raw bytes with its MIME type', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ text: 'kartony' }))
    const api = createApi('https://warehouse.example', async () => 'token', fetcher)
    expect(await api.transcribe(new Uint8Array([1, 2, 3]), 'audio/mp4', 'm4a')).toBe('kartony')
    expect(fetcher.mock.calls[0][0]).toContain('/api/stt?filename=audio.m4a')
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('Content-Type')).toBe('audio/mp4')
    expect(new Uint8Array(fetcher.mock.calls[0][1]?.body as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('rejects oversized uploads before accessing the network', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const api = createApi('https://warehouse.example', async () => 'token', fetcher)
    await expect(api.transcribe(new Uint8Array(4 * 1024 * 1024 + 1), 'audio/mp4', 'm4a')).rejects.toThrow('4 MB')
    expect(() => api.previewImport(new Uint8Array(4 * 1024 * 1024 + 1), 'items.xlsx')).toThrow('4 MB')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('downloads binary inventory exports without JSON parsing', async () => {
    const api = createApi('https://warehouse.example', async () => 'token', async () => new Response(new Uint8Array([80, 75])))
    expect(await api.exportInventory('xlsx')).toEqual(new Uint8Array([80, 75]))
  })
})
