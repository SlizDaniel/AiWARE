import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSpeechCommandBuffer } from './speechCommandBuffer'

describe('bufor wypowiedzi', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('łączy końcowe fragmenty po krótkiej pauzie i wysyła raz', () => {
    const ready = vi.fn()
    const buffer = createSpeechCommandBuffer(ready)
    buffer.update(0, 'wzięliśmy paletę', true, 100)
    vi.advanceTimersByTime(600)
    expect(buffer.update(1, 'kartonów', true, 800)).toBe('wzięliśmy paletę kartonów')
    vi.advanceTimersByTime(999)
    expect(ready).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(ready).toHaveBeenCalledExactlyOnceWith('wzięliśmy paletę kartonów', 100)
    expect(buffer.pending).toBe(false)
  })

  it('zastępuje podgląd poprawionym tekstem bez powtarzania słów; nie wysyła wyniku pośredniego', () => {
    const ready = vi.fn()
    const buffer = createSpeechCommandBuffer(ready)
    buffer.update(0, 'ile mamy', true, 10)
    vi.advanceTimersByTime(500)
    buffer.update(1, 'kar', false, 20)
    vi.advanceTimersByTime(5000)
    buffer.flush()
    expect(ready).not.toHaveBeenCalled()
    expect(buffer.update(1, 'kartonów', true, 20)).toBe('ile mamy kartonów')
    vi.advanceTimersByTime(1000)
    expect(ready).toHaveBeenCalledExactlyOnceWith('ile mamy kartonów', 10)
  })

  it('wyłączenie nasłuchu porzuca komendę i pozwala zacząć od nowa', () => {
    const ready = vi.fn()
    const buffer = createSpeechCommandBuffer(ready)
    buffer.update(0, 'stara komenda', true, null)
    buffer.clear()
    vi.advanceTimersByTime(2000)
    expect(ready).not.toHaveBeenCalled()
    buffer.update(0, 'nowa komenda', true, null)
    buffer.flush()
    vi.advanceTimersByTime(2000)
    expect(ready).toHaveBeenCalledExactlyOnceWith('nowa komenda', null)
  })
})
