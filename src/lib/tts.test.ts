import { afterEach, describe, expect, test, vi } from 'vitest'
import { MAX_SPOKEN_CHARS, pickPolishVoice, speak, truncateForSpeech } from './tts'

describe('truncateForSpeech', () => {
  test('keeps at most two sentences of the agent confirmation', () => {
    expect(truncateForSpeech('Zapisane. Kartony: 52. Propozycję zamówienia masz w kolejce.')).toBe('Zapisane. Kartony: 52.')
  })

  test('short text stays as is (trimmed, whitespace collapsed)', () => {
    expect(truncateForSpeech('  Mamy   54 kartony  ')).toBe('Mamy 54 kartony')
    expect(truncateForSpeech('Gdzie leży szkło?')).toBe('Gdzie leży szkło?')
  })

  test('abbreviations followed by lowercase words and decimals do not end a sentence', () => {
    expect(truncateForSpeech('Mamy 54 szt. kartonów w strefie A-1. Minimum to 12. Zamów więcej.')).toBe(
      'Mamy 54 szt. kartonów w strefie A-1. Minimum to 12.',
    )
    expect(truncateForSpeech('Folia waży 2.5 kg na rolkę. Jest w B-2. Trzecie zdanie.')).toBe(
      'Folia waży 2.5 kg na rolkę. Jest w B-2.',
    )
  })

  test('question and exclamation marks end sentences too', () => {
    expect(truncateForSpeech('Uwaga! Stan poniżej minimum? Zamów kartony.')).toBe('Uwaga! Stan poniżej minimum?')
  })

  test('each line of a list counts as a sentence and bullets are not read', () => {
    expect(truncateForSpeech('Stany:\n- Kartony: 54 szt\n- Taśma: 9 szt\n- Folia: 15 rolek')).toBe('Stany: Kartony: 54 szt')
  })

  test('toast separators and arrows are spoken naturally', () => {
    expect(truncateForSpeech('Zapisano w bazie: Kartony 54 → 53 · wpis w historii')).toBe(
      'Zapisano w bazie: Kartony 54 na 53, wpis w historii',
    )
  })

  test('quotes are dropped and empty input gives nothing to say', () => {
    expect(truncateForSpeech('Usłyszałem: „wzięliśmy paletę”.')).toBe('Usłyszałem: wzięliśmy paletę.')
    expect(truncateForSpeech('   \n  ')).toBe('')
    expect(truncateForSpeech('Coś.', 0)).toBe('')
  })

  test('one very long sentence is clipped on a word boundary', () => {
    const long = `Pozycja ${'bardzo długa nazwa '.repeat(30)}koniec.`
    const spoken = truncateForSpeech(long)
    expect(spoken.length).toBeLessThanOrEqual(MAX_SPOKEN_CHARS + 1)
    expect(spoken.endsWith('…')).toBe(true)
    expect(spoken).not.toMatch(/\s…$/)
  })

  test('custom sentence limit', () => {
    expect(truncateForSpeech('Jeden. Dwa. Trzy.', 1)).toBe('Jeden.')
    expect(truncateForSpeech('Jeden. Dwa. Trzy.', 3)).toBe('Jeden. Dwa. Trzy.')
  })
})

describe('pickPolishVoice', () => {
  const voice = (lang: string, localService = false) => ({ lang, localService, default: false })

  test('prefers an exact pl-PL voice, local before network', () => {
    const voices = [voice('en-US', true), voice('pl', true), voice('pl-PL'), voice('pl_PL', true)]
    expect(pickPolishVoice(voices)).toBe(voices[3])
  })

  test('falls back to any Polish voice or null', () => {
    const voices = [voice('en-GB'), voice('pl')]
    expect(pickPolishVoice(voices)).toBe(voices[1])
    expect(pickPolishVoice([voice('de-DE')])).toBeNull()
  })
})

describe('speak', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('is a silent no-op without speechSynthesis', () => {
    expect(() => speak('Zapisane.')).not.toThrow()
    vi.stubGlobal('window', {})
    expect(() => speak('Zapisane.')).not.toThrow()
  })

  test('speaks truncated Polish text with a Polish voice', () => {
    const spoken: { text: string; lang: string; voice: unknown }[] = []
    const polish = { lang: 'pl-PL', localService: true, default: false }
    class Utterance {
      lang = ''
      voice: unknown = null
      onerror: (() => void) | null = null
      constructor(readonly text: string) {}
    }
    const synth = {
      getVoices: () => [{ lang: 'en-US', localService: true, default: true }, polish],
      cancel: vi.fn(),
      speak: (utterance: Utterance) => spoken.push({ text: utterance.text, lang: utterance.lang, voice: utterance.voice }),
    }
    vi.stubGlobal('window', { speechSynthesis: synth })
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance)

    speak('Zapisane. Kartony: 52. Propozycję zamówienia masz w kolejce.')

    expect(synth.cancel).toHaveBeenCalledOnce()
    expect(spoken).toEqual([{ text: 'Zapisane. Kartony: 52.', lang: 'pl-PL', voice: polish }])
  })

  test('errors from the speech engine never escape', () => {
    vi.stubGlobal('window', {
      speechSynthesis: {
        getVoices: () => {
          throw new Error('boom')
        },
        cancel: () => {},
        speak: () => {},
      },
    })
    vi.stubGlobal('SpeechSynthesisUtterance', class {})
    expect(() => speak('Zapisane.')).not.toThrow()
  })
})
