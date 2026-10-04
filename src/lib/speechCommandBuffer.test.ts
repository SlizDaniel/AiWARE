import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSpeechCommandBuffer } from './speechCommandBuffer'
import { extractInventoryQuestion } from './speechInventory'

describe('bufor wypowiedzi', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('koniec sesji bez wyniku końcowego zachowuje kompletne pytanie, ale nie operację zapisu', () => {
    const ready = vi.fn()
    const buffer = createSpeechCommandBuffer(ready, 1000, vi.fn(), {
      intervalMs: 500, maxMs: 10_000,
      readQuestion: text => extractInventoryQuestion(text, ['Kartony']),
    })
    buffer.update(0, 'ile mamy kartonów szum', false, 100)
    buffer.endSession()
    expect(ready).toHaveBeenCalledExactlyOnceWith('ile mamy Kartony', 100)
    ready.mockClear()
    buffer.update(0, 'wzięliśmy dwie palety kartonów', false, 200)
    buffer.endSession()
    vi.advanceTimersByTime(1000)
    expect(ready).not.toHaveBeenCalled()
  })

  it('odpowiada raz po 500 ms na pełne pytanie nawet z wyniku pośredniego i szumu', () => {
    const ready = vi.fn()
    const buffer = createSpeechCommandBuffer(ready, 1000, vi.fn(), {
      intervalMs: 500, maxMs: 10_000,
      readQuestion: text => extractInventoryQuestion(text, ['Kartony']),
    })
    buffer.update(0, 'ile mamy kartnów kartonów szum szum', false, 100)
    vi.advanceTimersByTime(499)
    expect(ready).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(ready).toHaveBeenCalledExactlyOnceWith('ile mamy Kartony', 100)
    vi.advanceTimersByTime(10_000)
    expect(ready).toHaveBeenCalledOnce()
    expect(buffer.pending).toBe(false)
  })

  it('próbkuje co 500 ms i zamyka wypowiedź najpóźniej po 10 s mimo nowych słów', () => {
    const idle = vi.fn()
    const ready = vi.fn()
    const buffer = createSpeechCommandBuffer(ready, 1000, idle, { intervalMs: 500, maxMs: 10_000 })
    buffer.update(0, 'ile', false, 100)
    for (let index = 1; index < 10; index++) {
      vi.advanceTimersByTime(1000)
      buffer.update(0, `ile ${index}`, false, 100)
    }
    expect(idle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(idle).toHaveBeenCalledOnce()
    expect(ready).not.toHaveBeenCalled()
    buffer.clear()
    vi.advanceTimersByTime(5000)
    expect(idle).toHaveBeenCalledOnce()
  })

  it('próbkowanie uwzględnia odmowę dopowiedzianą po słowie tak', () => {
    const ready = vi.fn()
    const buffer = createSpeechCommandBuffer(ready, 1000, vi.fn(), { intervalMs: 500, maxMs: 10_000 })
    buffer.update(0, 'tak', true, 10)
    vi.advanceTimersByTime(500)
    buffer.update(1, 'ale nie teraz', true, 20)
    vi.advanceTimersByTime(500)
    expect(ready).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(ready).toHaveBeenCalledExactlyOnceWith('tak ale nie teraz', 10)
  })

  it('kończy nasłuch po stabilnym podglądzie, ale wykonuje dopiero wynik końcowy', () => {
    const ready = vi.fn()
    const idle = vi.fn()
    const buffer = createSpeechCommandBuffer(ready, 1000, idle)
    buffer.update(0, 'gdzie leży szkło', false, 100)
    vi.advanceTimersByTime(1000)
    buffer.update(0, 'gdzie leży szkło', false, 100)
    vi.advanceTimersByTime(500)
    expect(idle).toHaveBeenCalledOnce()
    expect(ready).not.toHaveBeenCalled()
    buffer.update(0, 'gdzie leży szkło', true, 100)
    vi.advanceTimersByTime(1000)
    expect(ready).toHaveBeenCalledExactlyOnceWith('gdzie leży szkło', 100)
  })

  it('dalsze słowa opóźniają zamknięcie, a wyłączenie usuwa timer', () => {
    const idle = vi.fn()
    const buffer = createSpeechCommandBuffer(vi.fn(), 1000, idle)
    buffer.update(0, 'wzięliśmy paletę', false, 100)
    vi.advanceTimersByTime(1000)
    buffer.update(0, 'wzięliśmy paletę kartonów', false, 100)
    vi.advanceTimersByTime(1000)
    expect(idle).not.toHaveBeenCalled()
    buffer.clear()
    vi.advanceTimersByTime(2000)
    expect(idle).not.toHaveBeenCalled()
  })

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

  it('keeps the silence delay after recognition ends and discards incomplete utterances', () => {
    const ready = vi.fn()
    const buffer = createSpeechCommandBuffer(ready)
    buffer.update(0, 'wzięliśmy dwie palety kartonów', true, 10)
    vi.advanceTimersByTime(200)
    buffer.endSession()
    vi.advanceTimersByTime(799)
    expect(ready).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(ready).toHaveBeenCalledExactlyOnceWith('wzięliśmy dwie palety kartonów', 10)
    ready.mockClear()
    buffer.update(0, 'wzięliśmy dwie palety', true, 20)
    buffer.update(1, 'czer', false, 30)
    buffer.endSession()
    vi.advanceTimersByTime(2000)
    expect(ready).not.toHaveBeenCalled()
    expect(buffer.pending).toBe(false)
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

  it('keeps separate interim segments and orders them when final updates arrive out of order', () => {
    const ready = vi.fn()
    const buffer = createSpeechCommandBuffer(ready)
    buffer.update(0, 'wzięliśmy', true, 10)
    buffer.update(2, 'kartonów', false, 30)
    expect(buffer.update(1, 'dwie palety', false, 20)).toBe('wzięliśmy dwie palety kartonów')
    buffer.update(1, 'dwie palety', true, 20)
    buffer.update(2, 'kartonów', true, 30)
    vi.advanceTimersByTime(1000)
    expect(ready).toHaveBeenCalledExactlyOnceWith('wzięliśmy dwie palety kartonów', 10)
  })

  it('nowy prefiks oddziela komendy, a rewizja tego samego indeksu nie gubi początku', () => {
    const ready = vi.fn()
    const buffer = createSpeechCommandBuffer(ready)
    buffer.update(0, 'weź dwie sztuki kartonów', true, 10, true)
    vi.advanceTimersByTime(400)
    expect(buffer.update(1, 'ile mamy', false, 50, true)).toBe('ile mamy')
    expect(buffer.update(1, 'ile mamy szkła', true, 60, true)).toBe('ile mamy szkła')
    vi.advanceTimersByTime(1000)
    expect(ready).toHaveBeenCalledExactlyOnceWith('ile mamy szkła', 50)
  })
})
