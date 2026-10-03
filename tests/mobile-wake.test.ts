import { describe, expect, it } from 'vitest'
import { ARMED_MS, CHUNK_MS, decideChunk, hasSpeechAudio, nextArmedUntil, SILENCE_METERING_DB } from '../mobile/src/lib/wake'

const base = { prefix: 'Magu', armedUntil: 0, now: 1_000, proposalPending: false }

describe('decideChunk', () => {
  it('ignores talk without the prefix while idle', () => {
    expect(decideChunk({ ...base, transcript: 'wzięliśmy paletę kartonów' })).toEqual({ type: 'ignore' })
    expect(decideChunk({ ...base, transcript: '   ' })).toEqual({ type: 'ignore' })
    expect(decideChunk({ ...base, transcript: 'tak' })).toEqual({ type: 'ignore' })
  })

  it('submits the command spoken with the prefix in one chunk', () => {
    expect(decideChunk({ ...base, transcript: 'Magu, gdzie leży szkło?' })).toEqual({
      type: 'submit',
      text: 'gdzie leży szkło?',
    })
  })

  it('tolerates a prefix buried after a few words (chunk starts mid-speech)', () => {
    expect(decideChunk({ ...base, transcript: 'no więc Magu gdzie leży szkło' })).toEqual({
      type: 'submit',
      text: 'gdzie leży szkło',
    })
  })

  it('normalises case, filler words and Polish spelling', () => {
    expect(decideChunk({ ...base, transcript: 'Hej MAGU! gdzie leży szkło' })).toEqual({
      type: 'submit',
      text: 'gdzie leży szkło',
    })
  })

  it('arms after the bare prefix and takes the next chunk as the command', () => {
    expect(decideChunk({ ...base, transcript: 'Hej Magu' })).toEqual({ type: 'armed' })
    const armed = decideChunk({
      ...base,
      transcript: 'wzięliśmy paletę kartonów',
      armedUntil: base.now + ARMED_MS,
    })
    expect(armed).toEqual({ type: 'submit', text: 'wzięliśmy paletę kartonów' })
  })

  it('stops treating chunks as commands once the arming expires', () => {
    expect(decideChunk({ ...base, transcript: 'wzięliśmy paletę', armedUntil: base.now - 1 })).toEqual({ type: 'ignore' })
  })

  it('accepts voice decisions on a pending card with and without the prefix', () => {
    const pending = { ...base, proposalPending: true }
    expect(decideChunk({ ...pending, transcript: 'tak' })).toEqual({ type: 'confirm' })
    expect(decideChunk({ ...pending, transcript: 'Magu, zatwierdzam' })).toEqual({ type: 'confirm' })
    expect(decideChunk({ ...pending, transcript: 'odrzuć' })).toEqual({ type: 'reject' })
    expect(decideChunk({ ...pending, transcript: 'Magu, nie zapisuj' })).toEqual({ type: 'reject' })
  })

  it('requires the prefix for a decision once the card is no longer fresh', () => {
    const stale = { ...base, proposalPending: true, proposalFresh: false }
    expect(decideChunk({ ...stale, transcript: 'tak' })).toEqual({ type: 'ignore' })
    expect(decideChunk({ ...stale, transcript: 'Magu tak' })).toEqual({ type: 'confirm' })
  })

  it('still runs a new prefixed command while a card is pending', () => {
    expect(decideChunk({ ...base, proposalPending: true, transcript: 'Magu ile mamy taśmy' })).toEqual({
      type: 'submit',
      text: 'ile mamy taśmy',
    })
  })

  it('keeps listening instead of submitting noise transcriptions while idle', () => {
    // transkrypcja szumu bez prefiksu nie może stać się komendą
    expect(decideChunk({ ...base, transcript: 'hmm eee' })).toEqual({ type: 'ignore' })
  })
})

describe('nextArmedUntil', () => {
  it('arms for ARMED_MS after a bare prefix', () => {
    expect(nextArmedUntil({ type: 'armed' }, 1_000, 0)).toBe(1_000 + ARMED_MS)
  })

  it('keeps the current arming on ignore (silence between chunks)', () => {
    expect(nextArmedUntil({ type: 'ignore' }, 5_000, 4_000)).toBe(4_000)
  })

  it('clears arming after a command or a card decision', () => {
    expect(nextArmedUntil({ type: 'submit', text: 'ile mamy' }, 5_000, 4_000)).toBe(0)
    expect(nextArmedUntil({ type: 'confirm' }, 5_000, 4_000)).toBe(0)
    expect(nextArmedUntil({ type: 'reject' }, 5_000, 4_000)).toBe(0)
  })
})

describe('chunk pacing', () => {
  it('uses short chunks so prefix and command land together', () => {
    expect(CHUNK_MS).toBeLessThanOrEqual(8_000)
    expect(CHUNK_MS).toBeGreaterThanOrEqual(3_000)
  })
})

describe('hasSpeechAudio', () => {
  it('treats a chunk below the silence threshold as silence (no STT hallucinations)', () => {
    expect(hasSpeechAudio(SILENCE_METERING_DB - 1)).toBe(false)
    expect(hasSpeechAudio(-100)).toBe(false)
    expect(hasSpeechAudio(-55)).toBe(false)
  })

  it('sends chunks with audible sound', () => {
    expect(hasSpeechAudio(SILENCE_METERING_DB)).toBe(true)
    expect(hasSpeechAudio(-30)).toBe(true)
    expect(hasSpeechAudio(-10)).toBe(true)
  })

  it('keeps transcribing when the meter is unavailable on the platform', () => {
    expect(hasSpeechAudio(null)).toBe(true)
    expect(hasSpeechAudio(undefined)).toBe(true)
  })
})
