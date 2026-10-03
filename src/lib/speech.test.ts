import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  changedResults,
  commandFromServerText,
  createRecognition,
  decideWakeAction,
  findWakeWord,
  fullTranscript,
  isConfirmPhrase,
  isRejectPhrase,
  levenshtein,
  matchWakeWord,
  normalizeSpeech,
  resultEntries,
  speechRecognitionSupported,
  ttsSpeaking,
  voiceDecision,
  type SpeechRecognitionEventLike,
} from './speech'

function results(...items: [string, boolean][]) {
  const list = items.map(([transcript, isFinal]) => Object.assign([{ transcript, confidence: 0.9 }], { isFinal }))
  return list as unknown as SpeechRecognitionEventLike['results']
}

describe('normalizeSpeech', () => {
  test('lowercases, strips Polish diacritics and punctuation', () => {
    expect(normalizeSpeech('Magu, ILE mamy kartonów?')).toBe('magu ile mamy kartonow')
    expect(normalizeSpeech('Zatwierdź! Łódź — żółć.')).toBe('zatwierdz lodz zolc')
    expect(normalizeSpeech('  „OK”  ')).toBe('ok')
    expect(normalizeSpeech('...')).toBe('')
  })
})

describe('levenshtein', () => {
  test('counts single-letter edits', () => {
    expect(levenshtein('magu', 'magu')).toBe(0)
    expect(levenshtein('magu', 'mago')).toBe(1)
    expect(levenshtein('magu', 'magau')).toBe(1)
    expect(levenshtein('magu', 'mag')).toBe(1)
    expect(levenshtein('magu', 'maku')).toBe(1)
    expect(levenshtein('magu', 'mamy')).toBe(2)
    expect(levenshtein('', 'abc')).toBe(3)
  })
})

describe('matchWakeWord', () => {
  test('prefix as the first word, rest keeps the original wording', () => {
    expect(matchWakeWord('Magu, ile mamy kartonów?', 'Magu')).toEqual({ matched: true, rest: 'ile mamy kartonów?' })
    expect(matchWakeWord('magu wzięliśmy paletę kartonów', 'Magu')).toEqual({ matched: true, rest: 'wzięliśmy paletę kartonów' })
    expect(matchWakeWord('Magu', 'Magu')).toEqual({ matched: true, rest: '' })
    expect(matchWakeWord('Magu , tak', 'Magu')).toEqual({ matched: true, rest: 'tak' })
  })

  test('tolerates one letter for prefixes of 4+ letters and Polish letters', () => {
    expect(matchWakeWord('Mago, ile mamy taśmy', 'Magu').matched).toBe(true)
    expect(matchWakeWord('Gosia ile mamy folii', 'Gosiu').rest).toBe('ile mamy folii')
    expect(matchWakeWord('Żaneto, gdzie leży szkło', 'Żaneto').matched).toBe(true)
    expect(matchWakeWord('Zaneto gdzie leży szkło', 'Żaneto').matched).toBe(true)
    expect(matchWakeWord('Mamy dużo kartonów', 'Magu').matched).toBe(false)
  })

  test('short prefixes must match exactly', () => {
    expect(matchWakeWord('Ola, ile mamy kartonów', 'Ola').matched).toBe(true)
    expect(matchWakeWord('Ala, ile mamy kartonów', 'Ola').matched).toBe(false)
    expect(matchWakeWord('Ol ile mamy', 'Ola').matched).toBe(false)
  })

  test('allows a leading filler like „hej” or „ej”', () => {
    expect(matchWakeWord('Hej Magu, ile mamy kartonów', 'Magu')).toEqual({ matched: true, rest: 'ile mamy kartonów' })
    expect(matchWakeWord('ej magu tak', 'Magu').rest).toBe('tak')
    expect(matchWakeWord('hej ile mamy kartonów', 'Magu').matched).toBe(false)
  })

  test('the prefix must open the phrase', () => {
    expect(matchWakeWord('ile mamy kartonów Magu', 'Magu').matched).toBe(false)
    expect(matchWakeWord('', 'Magu').matched).toBe(false)
    expect(matchWakeWord('Magu ile', '').matched).toBe(false)
  })
})

describe('confirm / reject phrases', () => {
  test('confirm words, alone or repeated', () => {
    for (const phrase of ['tak', 'Tak.', 'zatwierdź', 'Zatwierdzam!', 'potwierdzam', 'OK', 'okej', 'dobrze', 'tak, zatwierdzam']) {
      expect(isConfirmPhrase(phrase)).toBe(true)
    }
    for (const phrase of ['nie', 'tak ale nie teraz', 'wzięliśmy paletę', '', 'nie zatwierdzaj']) {
      expect(isConfirmPhrase(phrase)).toBe(false)
    }
  })

  test('reject words', () => {
    for (const phrase of ['nie', 'Nie!', 'anuluj', 'odrzuć', 'Odrzucam', 'nie, anuluj']) {
      expect(isRejectPhrase(phrase)).toBe(true)
    }
    for (const phrase of ['tak', 'nie wiem ile', 'odrzuć szkic zamówienia kartonów']) {
      expect(isRejectPhrase(phrase)).toBe(false)
    }
  })

  test('decision works with or without the wake word', () => {
    expect(voiceDecision('tak', 'Magu')).toBe('confirm')
    expect(voiceDecision('Magu, zatwierdź', 'Magu')).toBe('confirm')
    expect(voiceDecision('Magu nie', 'Magu')).toBe('reject')
    expect(voiceDecision('Magu, ile mamy kartonów', 'Magu')).toBeNull()
  })
})

describe('decideWakeAction', () => {
  const base = { prefix: 'Magu', armed: false, proposalPending: false }

  test('ignores speech without the wake word', () => {
    expect(decideWakeAction({ ...base, transcript: 'ile mamy kartonów', isFinal: true })).toEqual({ type: 'ignore' })
    expect(decideWakeAction({ ...base, transcript: 'ile mamy', isFinal: false })).toEqual({ type: 'ignore' })
    expect(decideWakeAction({ ...base, transcript: 'tak', isFinal: true })).toEqual({ type: 'ignore' })
    expect(decideWakeAction({ ...base, transcript: '   ', isFinal: true })).toEqual({ type: 'ignore' })
  })

  test('interim text after the wake word is shown live, final text is submitted', () => {
    expect(decideWakeAction({ ...base, transcript: 'Magu ile mamy', isFinal: false })).toEqual({ type: 'interim', text: 'ile mamy' })
    expect(decideWakeAction({ ...base, transcript: 'Magu', isFinal: false })).toEqual({ type: 'interim', text: '' })
    expect(decideWakeAction({ ...base, transcript: 'Magu, ile mamy kartonów', isFinal: true })).toEqual({
      type: 'submit',
      text: 'ile mamy kartonów',
    })
  })

  test('the wake word alone arms the next phrase as the command', () => {
    expect(decideWakeAction({ ...base, transcript: 'Magu', isFinal: true })).toEqual({ type: 'armed' })
    expect(decideWakeAction({ ...base, armed: true, transcript: 'wzięliśmy paletę', isFinal: false })).toEqual({
      type: 'interim',
      text: 'wzięliśmy paletę',
    })
    expect(decideWakeAction({ ...base, armed: true, transcript: 'wzięliśmy paletę kartonów', isFinal: true })).toEqual({
      type: 'submit',
      text: 'wzięliśmy paletę kartonów',
    })
  })

  test('a pending change card accepts tak / nie with or without the wake word', () => {
    const pending = { ...base, proposalPending: true }
    expect(decideWakeAction({ ...pending, transcript: 'tak', isFinal: true })).toEqual({ type: 'confirm' })
    expect(decideWakeAction({ ...pending, transcript: 'Magu, zatwierdzam', isFinal: true })).toEqual({ type: 'confirm' })
    expect(decideWakeAction({ ...pending, transcript: 'odrzuć', isFinal: true })).toEqual({ type: 'reject' })
    // pośredni wynik nigdy nie zatwierdza
    expect(decideWakeAction({ ...pending, transcript: 'tak', isFinal: false })).toEqual({ type: 'ignore' })
    // nowa komenda z prefiksem nadal działa przy otwartej karcie
    expect(decideWakeAction({ ...pending, transcript: 'Magu ile mamy taśmy', isFinal: true })).toEqual({
      type: 'submit',
      text: 'ile mamy taśmy',
    })
  })

  test('confirm words are not decisions without a pending card', () => {
    expect(decideWakeAction({ ...base, transcript: 'Magu tak', isFinal: true })).toEqual({ type: 'submit', text: 'tak' })
  })
})

describe('recognition results', () => {
  test('fullTranscript joins final and interim results', () => {
    expect(fullTranscript(results(['ile mamy', true], [' kartonów', false]))).toBe('ile mamy kartonów')
    expect(fullTranscript(results())).toBe('')
  })

  test('changedResults separates finished phrases from the live one', () => {
    const event = { resultIndex: 1, results: results(['stare', true], ['Magu ile mamy', true], ['Magu gdzie', false], ['leży', false]) }
    expect(changedResults(event)).toEqual({ finals: ['Magu ile mamy'], interim: 'Magu gdzie leży' })
  })
})

describe('browser support', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('unsupported without window or the API', () => {
    expect(speechRecognitionSupported()).toBe(false)
    expect(createRecognition({ continuous: true })).toBeNull()
    expect(ttsSpeaking()).toBe(false)
    vi.stubGlobal('window', {})
    expect(speechRecognitionSupported()).toBe(false)
  })

  test('uses the webkit-prefixed constructor with Polish, interim results', () => {
    class FakeRecognition {
      lang = ''
      continuous = false
      interimResults = false
      maxAlternatives = 0
    }
    vi.stubGlobal('window', { webkitSpeechRecognition: FakeRecognition, speechSynthesis: { speaking: true } })
    expect(speechRecognitionSupported()).toBe(true)
    expect(createRecognition({ continuous: true })).toMatchObject({
      lang: 'pl-PL',
      continuous: true,
      interimResults: true,
      maxAlternatives: 1,
    })
    expect(ttsSpeaking()).toBe(true)
  })
})

describe('server transcription after the wake word', () => {
  test('findWakeWord tolerates the tail of a previous phrase before the prefix', () => {
    expect(findWakeWord('tak. Magu, ile mamy kartonów?', 'Magu')).toEqual({ matched: true, rest: 'ile mamy kartonów?' })
    expect(findWakeWord('Magu ile mamy', 'Magu').rest).toBe('ile mamy')
    expect(findWakeWord('no więc dobrze ok Magu ile', 'Magu').matched).toBe(false)
    expect(findWakeWord('ile mamy kartonów', 'Magu').matched).toBe(false)
  })

  test('server text replaces the browser text, without the prefix', () => {
    expect(commandFromServerText('Magu, wzięliśmy paletę kartonów.', 'Magu', 'wzięli śmy palety kartony')).toEqual({
      type: 'submit',
      text: 'wzięliśmy paletę kartonów.',
    })
    // serwer nie usłyszał prefiksu — tekst idzie w całości (serwer i tak usuwa prefiks)
    expect(commandFromServerText('Ile mamy taśmy?', 'Magu', 'ile mamy tasmy')).toEqual({ type: 'submit', text: 'Ile mamy taśmy?' })
  })

  test('empty or failed server text falls back to the browser text', () => {
    expect(commandFromServerText('', 'Magu', 'ile mamy kartonów')).toEqual({ type: 'submit', text: 'ile mamy kartonów' })
    expect(commandFromServerText(' … ', 'Magu', 'ile mamy kartonów')).toEqual({ type: 'submit', text: 'ile mamy kartonów' })
  })

  test('only the prefix in the server text keeps listening for the command', () => {
    expect(commandFromServerText('Magu.', 'Magu', 'Magu ile')).toEqual({ type: 'armed' })
    expect(commandFromServerText('', 'Magu', '')).toEqual({ type: 'armed' })
  })
})

describe('resultEntries', () => {
  test('keeps result indexes for utterance timing', () => {
    const event = { resultIndex: 1, results: results(['stare', true], ['Magu ile', true], ['', false], ['gdzie', false]) }
    expect(resultEntries(event)).toEqual([
      { index: 1, transcript: 'Magu ile', isFinal: true },
      { index: 3, transcript: 'gdzie', isFinal: false },
    ])
  })
})
