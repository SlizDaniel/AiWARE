import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

it('nie odtwarza sygnału bez odblokowania audio przez użytkownika', async () => {
  const constructor = vi.fn()
  vi.stubGlobal('AudioContext', constructor)
  const { playListeningCue } = await import('./listeningCue')
  playListeningCue()
  expect(constructor).not.toHaveBeenCalled()
})

it('odtwarza krótki sygnał i zwalnia węzły audio po zakończeniu', async () => {
  const oscillator = { frequency: { value: 0 }, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as null | (() => void) }
  const gain = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }
  const context = { state: 'running', currentTime: 10, destination: {}, createOscillator: () => oscillator, createGain: () => gain }
  vi.stubGlobal('AudioContext', class { constructor() { return context } })
  const { playListeningCue, unlockListeningCue } = await import('./listeningCue')
  unlockListeningCue()
  playListeningCue()
  expect(oscillator.start).toHaveBeenCalledWith(10)
  expect(oscillator.stop).toHaveBeenCalledWith(10.12)
  oscillator.onended?.()
  expect(oscillator.disconnect).toHaveBeenCalledOnce()
  expect(gain.disconnect).toHaveBeenCalledOnce()
})

it('brak obsługi audio nie blokuje interfejsu', async () => {
  vi.stubGlobal('AudioContext', class { constructor() { throw new Error('audio unavailable') } })
  const { playListeningCue, unlockListeningCue } = await import('./listeningCue')
  expect(() => { unlockListeningCue(); playListeningCue() }).not.toThrow()
})
