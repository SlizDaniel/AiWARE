import assert from 'node:assert/strict'
import test from 'node:test'
import { itemsForZone } from './zoneItems.ts'

const items = [
  { id: 1, name: 'Kartony', quantity: 54, minimum: 12, unit: 'szt', location: 'Strefa A-1' },
  { id: 2, name: 'Taśma', quantity: 9, minimum: 3, unit: 'szt', location: 'Strefa A-1, regał 2' },
  { id: 3, name: 'Folia', quantity: 15, minimum: 6, unit: 'rolka', location: 'Strefa A-10' },
]

test('zone named after an item shows that item even when its location uses a code', () => {
  assert.deepEqual(itemsForZone({ id: 1, name: 'kartony', created: '' }, items).map((item) => item.id), [1])
})

test('zone location matches its exact code and sublocations, but not a different code', () => {
  assert.deepEqual(itemsForZone({ id: 2, name: 'A-1', created: '' }, items).map((item) => item.id), [1, 2])
})
