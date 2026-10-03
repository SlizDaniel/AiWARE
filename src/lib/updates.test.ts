import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { POLL_INTERVAL_MS, subscribeUpdates } from './updates'

type FakeDocument = EventTarget & { hidden: boolean }

let doc: FakeDocument
let win: EventTarget

beforeEach(() => {
  vi.useFakeTimers()
  doc = Object.assign(new EventTarget(), { hidden: false })
  win = new EventTarget()
  vi.stubGlobal('document', doc)
  vi.stubGlobal('window', win)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Kolejne wersje z serwera; liczba po wyczerpaniu powtarza ostatnią, Error → odrzucenie. */
function versions(...values: (number | Error)[]) {
  let index = 0
  return vi.fn(async () => {
    const value = values[Math.min(index++, values.length - 1)]
    if (value instanceof Error) throw value
    return value
  })
}

describe('subscribeUpdates', () => {
  test('first version is the baseline; only a change calls onUpdated', async () => {
    const fetchVersion = versions(1, 1, 2, 2, 3)
    const onUpdated = vi.fn()
    const onStatus = vi.fn()
    const stop = subscribeUpdates(onUpdated, onStatus, { fetchVersion })

    await vi.advanceTimersByTimeAsync(0)
    expect(fetchVersion).toHaveBeenCalledTimes(1)
    expect(onUpdated).not.toHaveBeenCalled()
    expect(onStatus).toHaveBeenLastCalledWith(true)

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS) // 1 → bez zmian
    expect(onUpdated).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS) // 2 → zmiana
    expect(onUpdated).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS) // 2 → bez zmian
    expect(onUpdated).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS) // 3 → zmiana
    expect(onUpdated).toHaveBeenCalledTimes(2)
    expect(fetchVersion).toHaveBeenCalledTimes(5)
    stop()
  })

  test('status reflects the last poll and recovers after an error', async () => {
    const fetchVersion = versions(1, new Error('offline'), 1)
    const onStatus = vi.fn()
    const stop = subscribeUpdates(vi.fn(), onStatus, { fetchVersion })

    await vi.advanceTimersByTimeAsync(0)
    expect(onStatus).toHaveBeenLastCalledWith(true)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(onStatus).toHaveBeenLastCalledWith(false)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(onStatus).toHaveBeenLastCalledWith(true)
    // ten sam status nie jest raportowany ponownie
    expect(onStatus).toHaveBeenCalledTimes(3)
    stop()
  })

  test('a failed first poll does not set the baseline', async () => {
    const fetchVersion = versions(new Error('offline'), 4, 4)
    const onUpdated = vi.fn()
    const stop = subscribeUpdates(onUpdated, vi.fn(), { fetchVersion })
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2)
    expect(fetchVersion).toHaveBeenCalledTimes(3)
    expect(onUpdated).not.toHaveBeenCalled()
    stop()
  })

  test('hidden tab pauses polling; visibility or focus polls immediately', async () => {
    const fetchVersion = versions(1, 1, 2, 2)
    const onUpdated = vi.fn()
    const stop = subscribeUpdates(onUpdated, vi.fn(), { fetchVersion })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchVersion).toHaveBeenCalledTimes(1)

    doc.hidden = true
    doc.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5)
    // zaplanowane zapytanie odpada, gdy karta jest ukryta
    expect(fetchVersion).toHaveBeenCalledTimes(1)

    doc.hidden = false
    doc.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchVersion).toHaveBeenCalledTimes(2)

    win.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchVersion).toHaveBeenCalledTimes(3)
    expect(onUpdated).toHaveBeenCalledTimes(1)

    // po natychmiastowym zapytaniu wraca zwykły rytm
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(fetchVersion).toHaveBeenCalledTimes(4)
    stop()
  })

  test('unsubscribe stops timers, listeners and late callbacks', async () => {
    let resolve: (value: number) => void = () => {}
    const fetchVersion = vi.fn(() => new Promise<number>((r) => (resolve = r)))
    const onStatus = vi.fn()
    const stop = subscribeUpdates(vi.fn(), onStatus, { fetchVersion })
    stop()
    resolve(1)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    win.dispatchEvent(new Event('focus'))
    doc.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(fetchVersion).toHaveBeenCalledTimes(1)
    expect(onStatus).not.toHaveBeenCalled()
  })

  test('does not start a second request while one is in flight', async () => {
    let resolve: (value: number) => void = () => {}
    const fetchVersion = vi.fn(() => new Promise<number>((r) => (resolve = r)))
    const stop = subscribeUpdates(vi.fn(), vi.fn(), { fetchVersion })
    win.dispatchEvent(new Event('focus'))
    win.dispatchEvent(new Event('focus'))
    expect(fetchVersion).toHaveBeenCalledTimes(1)
    resolve(1)
    await vi.advanceTimersByTimeAsync(0)
    stop()
  })
})
