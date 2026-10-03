// Seam intencja → narzędzie (PRD, seam 2) — port of legacy tests/test_parser.py
// and the offline guarantee from tests/test_offline.py.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SZT_NA_PALETE, delta, parseCommand } from './parser'
import type { ItemRef } from './types'

const ITEMS: ItemRef[] = [
  { id: 1, name: 'Kartony' },
  { id: 2, name: 'Szkło' },
  { id: 3, name: 'Folia stretch' },
]

type Expected = { tool: string; item_id?: number; delta?: number; args?: Record<string, unknown> }

const FIXTURES: [string, Expected][] = [
  // komenda demo 1–2: wzięto / doszło („paleta" = 2 szt)
  ['wzięliśmy paletę kartonów', { tool: 'update_stock', item_id: 1, delta: -2 }],
  ['Wzięliśmy paletę szkła', { tool: 'update_stock', item_id: 2, delta: -2 }],
  ['wzięliśmy paletę folii stretch', { tool: 'update_stock', item_id: 3, delta: -2 }],
  ['wzięliśmy 2 palety kartonów', { tool: 'update_stock', item_id: 1, delta: -4 }],
  ['doszła paleta kartonów', { tool: 'update_stock', item_id: 1, delta: 2 }],
  ['doszła paleta szkła', { tool: 'update_stock', item_id: 2, delta: 2 }],
  // komenda demo 3: nazwanie strefy podczas spaceru
  ['strefa: kartony', { tool: 'add_zone', args: { name: 'kartony' } }],
  ['Strefa: folia', { tool: 'add_zone', args: { name: 'folia' } }],
  ['strefa: pakowanie szkła', { tool: 'add_zone', args: { name: 'pakowanie szkła' } }],
  // komenda demo 4: pytanie o stan
  ['ile mamy szkła?', { tool: 'get_stock', args: { item_id: 2 } }],
  ['ile mamy kartonów', { tool: 'get_stock', args: { item_id: 1 } }],
  ['ile mamy?', { tool: 'get_stock', args: {} }],
  // komenda demo 5: pytanie o lokalizację
  ['gdzie leży szkło?', { tool: 'get_location', args: { item_id: 2 } }],
  ['gdzie leżą kartony?', { tool: 'get_location', args: { item_id: 1 } }],
  // komenda demo 6: pamięć proceduralna
  ['jak pakujemy szkło?', { tool: 'recall_procedure', args: { topic: 'szkło' } }],
  ['jak pakujemy folię stretch?', { tool: 'recall_procedure', args: { topic: 'folię stretch' } }],
  // zapis procedury
  [
    'zapamiętaj: szkło pakujemy w kartony Y, strefa C2',
    { tool: 'remember_procedure', args: { topic: 'szkło', text: 'szkło pakujemy w kartony Y, strefa C2' } },
  ],
]

describe('parseCommand fixtures', () => {
  it.each(FIXTURES)('%s', (text, expected) => {
    const parsed = parseCommand(text, ITEMS)
    expect(parsed, `komenda nierozpoznana: ${text}`).not.toBeNull()
    expect(parsed!.tool).toBe(expected.tool)
    if (expected.item_id !== undefined) {
      expect(parsed!.itemId).toBe(expected.item_id)
      expect(parsed!.args).toEqual({ item_id: expected.item_id, delta: expected.delta })
      expect(delta(parsed!)).toBe(expected.delta)
    } else {
      expect(parsed!.args).toEqual(expected.args)
    }
  })
})

describe('parseCommand behaviour', () => {
  it('paleta is two pieces', () => {
    expect(delta(parseCommand('wzięliśmy paletę kartonów', ITEMS)!)).toBe(-SZT_NA_PALETE)
  })

  it('unknown text returns null', () => {
    expect(parseCommand('policz palety na hali', ITEMS)).toBeNull()
    expect(parseCommand('zamknij magazyn na noc', ITEMS)).toBeNull()
    expect(parseCommand('', ITEMS)).toBeNull()
  })

  it('missing item on update intent is not silent', () => {
    const parsed = parseCommand('wzięliśmy paletę śrubek', ITEMS)
    expect(parsed).not.toBeNull()
    expect(parsed!.tool).toBe('update_stock')
    expect(parsed!.itemId ?? null).toBeNull()
    expect(parsed!.missingItem).toBe('śrubek')
    expect(parsed!.args).toEqual({})
  })

  it('missing item on query intent is not silent', () => {
    const parsed = parseCommand('ile mamy śrubek?', ITEMS)
    expect(parsed).not.toBeNull()
    expect(parsed!.tool).toBe('get_stock')
    expect(parsed!.itemId ?? null).toBeNull()
    expect(parsed!.missingItem).toBe('śrubek')
  })

  it('take without palette returns null', () => {
    expect(parseCommand('wzięliśmy kartony', ITEMS)).toBeNull()
  })

  it('word counts and digits multiply the palette', () => {
    expect(delta(parseCommand('doszły trzy palety szkła', ITEMS)!)).toBe(6)
    expect(delta(parseCommand('wzięliśmy dwa palety kartonów', ITEMS)!)).toBe(-4)
    // Python quirk kept on purpose: „dwie” does not match dw[oa]w* → one palette
    expect(delta(parseCommand('doszły dwie palety szkła', ITEMS)!)).toBe(2)
    expect(delta(parseCommand('wzięliśmy cztery palety kartonów', ITEMS)!)).toBe(-8)
    expect(delta(parseCommand('wzięliśmy pięć palet kartonów', ITEMS)!)).toBe(-10)
    expect(delta(parseCommand('wzięliśmy 12 palet kartonów', ITEMS)!)).toBe(-24)
  })

  it('word boundaries are Unicode-aware like Python \\b', () => {
    // „ąile" — preceded by a Polish letter, so „ile mamy" is not a separate word
    expect(parseCommand('ąile mamy szkła?', ITEMS)).toBeNull()
    // „ępaleta" is not the word „paleta"
    expect(parseCommand('wzięliśmy ępaletę kartonów', ITEMS)).toBeNull()
    // punctuation is a boundary
    expect(parseCommand('no, ile mamy szkła?', ITEMS)?.args).toEqual({ item_id: 2 })
  })

  it('works after a wake word and keeps the original text', () => {
    const parsed = parseCommand('Magu, jak pakujemy szkło?', ITEMS)
    expect(parsed?.tool).toBe('recall_procedure')
    expect(parsed?.args).toEqual({ topic: 'szkło' })
    expect(parsed?.text).toBe('Magu, jak pakujemy szkło?')
  })

  it('remember keeps the original casing and lowercases the topic', () => {
    const parsed = parseCommand('Zapamiętaj: SZKŁO pakujemy z PRZEKŁADKAMI, strefa C2', ITEMS)
    expect(parsed?.tool).toBe('remember_procedure')
    expect(parsed?.args).toEqual({ topic: 'szkło', text: 'SZKŁO pakujemy z PRZEKŁADKAMI, strefa C2' })
  })

  it('blank zone or remember fragments are not commands', () => {
    expect(parseCommand('strefa:', ITEMS)).toBeNull()
    expect(parseCommand('zapamiętaj:   ', ITEMS)).toBeNull()
    expect(parseCommand('zapamiętaj: !!!', ITEMS)).toBeNull()
    // like Python: the lazy group needs one character, the rest is trailing punctuation
    expect(parseCommand('strefa: ???', ITEMS)?.args).toEqual({ name: '?' })
  })

  it('missing item fragment after the palette word', () => {
    const parsed = parseCommand('doszła paleta śrubek M8!', ITEMS)
    expect(parsed?.missingItem).toBe('śrubek m8')
  })

  it('prefers the longest matching stem', () => {
    const items: ItemRef[] = [
      { id: 1, name: 'Folia' },
      { id: 2, name: 'Foliowe worki' },
    ]
    expect(parseCommand('ile mamy foliowych worków?', items)?.itemId).toBe(2)
  })
})

describe('offline path (test_offline.py)', () => {
  const BANNED = ['http', 'https', 'net', 'tls', 'dgram', 'undici', 'axios', 'node-fetch', '@google/genai', '@google/generative-ai']
  const MODULES = ['db.ts', 'parser.ts', 'tools.ts', 'commands.ts', 'agentContract.ts', 'settings.ts', 'demo.ts']

  it.each(MODULES)('%s has no network imports', (file) => {
    const source = readFileSync(path.join(import.meta.dirname, file), 'utf8')
    const imports = [...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((match) =>
      match[1].replace(/^node:/, ''),
    )
    const used = imports.filter((name) => BANNED.some((banned) => name === banned || name.startsWith(`${banned}/`)))
    expect(used, `${file}: ścieżka offline nie może importować ${used.join(', ')}`).toEqual([])
    expect(/\bfetch\s*\(/.test(source), `${file}: ścieżka offline nie może wołać fetch()`).toBe(false)
  })
})
