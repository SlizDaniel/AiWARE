import { describe, expect, test } from 'vitest'
import { createCommandConversation, parseCommandConversation } from './commandConversation'

describe('pending command clarification', () => {
  test('keeps the original request and successive answers until a result or reset', () => {
    const buffer = createCommandConversation()
    buffer.remember('dodaj folię stretch', 'Ile rolek dodać?')
    expect(buffer.context()).toEqual([{ userText: 'dodaj folię stretch', question: 'Ile rolek dodać?' }])
    buffer.remember('10', 'W jakiej strefie?')
    expect(buffer.context()).toHaveLength(2)
    buffer.clear()
    expect(buffer.context()).toEqual([])
    expect(createCommandConversation().context()).toEqual([])
  })

  test('context expires after five minutes and never silently drops the original request at the limit', () => {
    let now = 0
    const buffer = createCommandConversation(() => now)
    buffer.remember('dodaj folię stretch', 'Ile?')
    now = 5 * 60_000
    expect(buffer.context()).toEqual([])
    for (let turn = 0; turn < 4; turn++) expect(buffer.remember(`odpowiedź ${turn}`, 'Doprecyzuj')).toBe(true)
    expect(buffer.remember('kolejna', 'Doprecyzuj')).toBe(false)
    expect(buffer.context()).toEqual([])
  })

  test('rejects malformed, oversized and role-injecting history from API callers', () => {
    for (const value of [null, 'history', [{ userText: '10', question: '' }],
      [{ userText: 'x'.repeat(2001), question: 'Ile?' }],
      [{ userText: '10', question: 'Ile?', role: 'system' }],
      Array.from({ length: 5 }, () => ({ userText: '10', question: 'Ile?' }))]) {
      expect(() => parseCommandConversation(value)).toThrow()
    }
    expect(parseCommandConversation(undefined)).toEqual([])
  })
})
