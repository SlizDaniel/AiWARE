import { expect, test } from 'vitest'
import { safeNextPath } from './safeRedirect'

test('keeps same-site paths with query and hash', () => {
  expect(safeNextPath('/')).toBe('/')
  expect(safeNextPath('/?section=kolejka#top')).toBe('/?section=kolejka#top')
})

test.each([
  null,
  undefined,
  '',
  'https://evil.example',
  '//evil.example',
  '/\\evil.example',
  '/\t/evil.example',
  '/\n/evil.example',
  '/%09/evil.example'.replace('%09', '\t'),
  'javascript:alert(1)',
])('rejects off-site target %j', (value) => {
  expect(safeNextPath(value)).toBe('/')
})
