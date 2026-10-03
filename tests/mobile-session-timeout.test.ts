import { afterEach, describe, expect, it, vi } from 'vitest'
import { withTimeout } from '../mobile/src/lib/withTimeout'
import { createApi } from '../mobile/src/lib/client'

afterEach(() => { vi.useRealTimers() })

describe('mobile session waits', () => {
  it('bounds a stalled session read instead of leaving startup loading forever', async () => {
    vi.useFakeTimers()
    const pending = withTimeout(new Promise<never>(() => {}), 15_000, 'Odczyt sesji przekroczył limit czasu.')
    const check = expect(pending).rejects.toThrow('Odczyt sesji przekroczył limit czasu.')
    await vi.advanceTimersByTimeAsync(15_000)
    await check
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the deadline when the session becomes available', async () => {
    vi.useFakeTimers()
    await expect(withTimeout(Promise.resolve({ session: null }), 15_000, 'timeout')).resolves.toEqual({ session: null })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds token refresh before the first API request', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<typeof fetch>()
    const api = createApi('https://warehouse.example', () => new Promise(() => {}), fetcher)
    const check = expect(api.version()).rejects.toThrow('Nie udało się odświeżyć sesji')
    await vi.advanceTimersByTimeAsync(15_000)
    await check
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('identifies the server address when the network request fails', async () => {
    const api = createApi('http://192.168.1.20:3000', async () => 'token', async () => { throw new TypeError('Network request failed') })
    await expect(api.version()).rejects.toThrow('Nie można połączyć się z serwerem http://192.168.1.20:3000')
  })
})
