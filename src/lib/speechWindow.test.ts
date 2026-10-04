import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSpeechWindow, SPEECH_WINDOW_MS } from './speechWindow'
import { createSpeechCommandBuffer } from './speechCommandBuffer'

describe('3-sekundowa sesja głosowa', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('zamyka mikrofon dokładnie po 3 s również bez żadnego wyniku', () => {
    const releaseMic = vi.fn()
    const window = createSpeechWindow(releaseMic)
    expect(SPEECH_WINDOW_MS).toBe(3000)
    window.start()
    vi.advanceTimersByTime(2999)
    expect(releaseMic).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(releaseMic).toHaveBeenCalledOnce()
    expect(window.active).toBe(false)
  })

  it('kolejne wywołania prefiksu nie przedłużają aktywnej sesji', () => {
    const expire = vi.fn()
    const window = createSpeechWindow(expire)
    window.start()
    vi.advanceTimersByTime(2000)
    window.start()
    vi.advanceTimersByTime(1000)
    expect(expire).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(5000)
    expect(expire).toHaveBeenCalledOnce()
  })

  it('przekazuje tekst komendy po limicie bez czekania na final/onend', () => {
    const ready = vi.fn()
    const buffer = createSpeechCommandBuffer(ready, 500, undefined, {
      intervalMs: 500, maxMs: 3000, retainInterim: true,
    })
    const releaseMic = vi.fn()
    const window = createSpeechWindow(() => {
      releaseMic()
      buffer.finish(true)
    })
    window.start()
    buffer.update(0, 'wzięliśmy paletę kartonów', false, 0)
    buffer.endSession()
    vi.advanceTimersByTime(3000)
    expect(releaseMic).toHaveBeenCalledOnce()
    expect(ready).toHaveBeenCalledExactlyOnceWith('wzięliśmy paletę kartonów', 0)
    expect(buffer.pending).toBe(false)
  })

  it('nie zatwierdza karty na podstawie nieukończonego tak', () => {
    const ready = vi.fn()
    const reject = vi.fn()
    const buffer = createSpeechCommandBuffer(ready)
    const window = createSpeechWindow(() => {
      if (!buffer.finish(false)) reject()
    })
    window.start()
    buffer.update(0, 'tak', false, 0)
    vi.advanceTimersByTime(3000)
    expect(ready).not.toHaveBeenCalled()
    expect(reject).toHaveBeenCalledOnce()
  })

  it('wykonanie komendy lub wyłączenie usuwa deadline i pozwala na nową sesję', () => {
    const expire = vi.fn()
    const window = createSpeechWindow(expire)
    window.start()
    vi.advanceTimersByTime(500)
    window.clear()
    vi.advanceTimersByTime(3000)
    expect(expire).not.toHaveBeenCalled()
    window.start()
    vi.advanceTimersByTime(3000)
    expect(expire).toHaveBeenCalledOnce()
  })
})
