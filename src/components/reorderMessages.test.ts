import { expect, test } from 'vitest'
import type { ReorderDraft } from '@/lib/api'
import { confirmationMessage } from './reorderMessages'

const draft: ReorderDraft = {
  id: 1, item_id: 1, item_name: 'Kartony', quantity: 50, unit: 'szt',
  deliver_on: '2026-10-06', status: 'pending', created_at: '', updated_at: '',
}

test('existing draft reports the stored quantity without claiming a new write', () => {
  const message = confirmationMessage('Kartony — 100', { ...draft, created: false })
  expect(message).toContain('Kartony — 50 szt')
  expect(message).toContain('Nie dodano nowego szkica ani nie zmieniono ilości')
  expect(message).not.toMatch(/100|Zapisano/)
})

test('new and automatic drafts retain the original confirmation', () => {
  expect(confirmationMessage('Kartony — 50', { ...draft, created: true }))
    .toBe('Zapisano: Kartony — 50 · szkic zamówienia 50 szt w kolejce')
  expect(confirmationMessage('Kartony 13→11', draft))
    .toBe('Zapisano: Kartony 13→11 · szkic zamówienia 50 szt w kolejce')
})

test('ordinary writes retain the audit confirmation', () => {
  expect(confirmationMessage('Kartony 13→11', null))
    .toBe('Zapisano w bazie: Kartony 13→11 · wpis w historii')
})
