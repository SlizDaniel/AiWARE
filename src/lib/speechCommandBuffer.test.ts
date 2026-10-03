import { afterEach, expect, test, vi } from 'vitest'
import { createSpeechCommandBuffer } from './speechCommandBuffer'

afterEach(() => vi.useRealTimers())

test('joins adjacent final fragments once, keeping the earliest audio start', () => {
  vi.useFakeTimers()
  const submit = vi.fn()
  const buffer = createSpeechCommandBuffer(submit)
  buffer.push('wzięliśmy', 100, false)
  vi.advanceTimersByTime(300)
  buffer.push('paletę bułek', 450, true)
  vi.advanceTimersByTime(650)
  expect(submit).toHaveBeenCalledExactlyOnceWith('wzięliśmy paletę bułek', 100)
  expect(buffer.pending()).toBe(false)
})

test('a new wake command stays separate and cancel stops delayed submission', () => {
  vi.useFakeTimers()
  const submit = vi.fn()
  const buffer = createSpeechCommandBuffer(submit)
  buffer.push('ile mamy bułek', null, false)
  buffer.push('gdzie leży szkło', 200, false)
  expect(submit).toHaveBeenCalledExactlyOnceWith('ile mamy bułek', null)
  buffer.cancel()
  vi.advanceTimersByTime(1000)
  expect(submit).toHaveBeenCalledTimes(1)
})

test('interim continuation postpones submission until its final fragment', () => {
  vi.useFakeTimers()
  const submit = vi.fn()
  const buffer = createSpeechCommandBuffer(submit)
  buffer.push('wzięliśmy', 100, false)
  vi.advanceTimersByTime(500)
  buffer.defer()
  vi.advanceTimersByTime(500)
  expect(submit).not.toHaveBeenCalled()
  buffer.push('paletę bułek', 800, true)
  vi.advanceTimersByTime(650)
  expect(submit).toHaveBeenCalledExactlyOnceWith('wzięliśmy paletę bułek', 100)
})
