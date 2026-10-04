import { describe, expect, test } from 'vitest'
import { correctInventorySpeech } from './speechInventory'

describe('inventory names in spoken commands', () => {
  test('recognises inflected names before correcting, and repairs a misheard inflected noun', () => {
    expect(correctInventorySpeech('ile mamy bułek?', ['Bułki', 'Bułka']).corrections).toEqual([])
    expect(correctInventorySpeech('ile mamy półek?', ['Bułki']).text).toBe('ile mamy Bułki?')
    expect(correctInventorySpeech('gdzie leżą półek?', ['Bułki', 'Półki']).corrections).toEqual([])
    expect(correctInventorySpeech('przyjęliśmy dziesięć sztuk półek', ['Bułki']).text).toBe('przyjęliśmy dziesięć sztuk Bułki')
  })
  test('matches a misheard item only in the item slot', () => {
    expect(correctInventorySpeech('ile mamy półki?', ['Bułki'])).toMatchObject({
      text: 'ile mamy Bułki?', corrections: [{ heard: 'półki', name: 'Bułki' }],
    })
    expect(correctInventorySpeech('wzięliśmy paletę bolki', ['Bułki']).text).toBe('wzięliśmy paletę Bułki')
    expect(correctInventorySpeech('doszła paleta bolki', ['Bułki']).text).toBe('doszła paleta Bułki')
    expect(correctInventorySpeech('wziąłem 2 sztuki bolki', ['Bułki']).text).toBe('wziąłem 2 sztuki Bułki')
    expect(correctInventorySpeech('weź dwie półki', ['Bułki']).text).toBe('weź dwie Bułki')
  })

  test('preserves exact existing names and ambiguous matches', () => {
    expect(correctInventorySpeech('ile mamy półki?', ['Bułki', 'Półki']).corrections).toEqual([])
    expect(correctInventorySpeech('ile mamy kulki?', ['Bułki', 'Kulki']).corrections).toEqual([])
    expect(correctInventorySpeech('ile mamy bulki?', ['Bułki', 'Bulki']).corrections).toEqual([])
    expect(correctInventorySpeech('ile mamy pulki?', ['Bułki', 'Półki']).corrections).toEqual([])
  })

  test('does not rewrite numbers, actions, procedures, new names or shelf descriptions', () => {
    for (const text of ['dodaj towar półki', 'zapamiętaj: bułki leżą na półki', 'strefa: półki',
      'nie wzięliśmy 5 półki', 'jutro weźmiemy półki', 'ile mamy półki na regale 2?', 'wzięliśmy 2 półki i 3 kartony']) {
      expect(correctInventorySpeech(text, ['Bułki']).text).toBe(text)
    }
    expect(correctInventorySpeech('wzięliśmy 12 sztuk półki', ['Bułki']).text).toBe('wzięliśmy 12 sztuk Bułki')
  })

  test('leaves distant and multiword names without a strong match alone', () => {
    expect(correctInventorySpeech('ile mamy gwoździ?', ['Bułki']).corrections).toEqual([])
    expect(correctInventorySpeech('gdzie leży folia strecz?', ['Folia stretch']).text).toBe('gdzie leży Folia stretch?')
    expect(correctInventorySpeech('ile mamy?', ['Bułki']).corrections).toEqual([])
  })
})
