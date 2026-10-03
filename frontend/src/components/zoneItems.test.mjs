import assert from 'node:assert/strict'
import test from 'node:test'
import { itemsForZone } from './zoneItems.ts'

const items = [
  { id: 1, name: 'Kartony', quantity: 54, minimum: 12, unit: 'szt', location: 'Strefa A-1' },
  { id: 2, name: 'Taśma', quantity: 9, minimum: 3, unit: 'szt', location: 'Strefa A-1, regał 2' },
  { id: 3, name: 'Folia', quantity: 15, minimum: 6, unit: 'rolka', location: 'Strefa A-10' },
]

test('zone named after an item shows that item even when its location uses a code', () => {
  const zone = { id: 1, name: 'kartony', created: '' }
  assert.deepEqual(itemsForZone(zone, items, [zone]).map((item) => item.id), [1])
})

test('zone location matches its exact code and sublocations, but not a different code', () => {
  const zone = { id: 2, name: 'A-1', created: '' }
  assert.deepEqual(itemsForZone(zone, items, [zone]).map((item) => item.id), [1, 2])
})

test('a recorded location wins over a matching product name when both zones exist', () => {
  const nameZone = { id: 1, name: 'kartony', created: '' }
  const locationZone = { id: 2, name: 'A-1', created: '' }
  const zones = [nameZone, locationZone]

  assert.deepEqual(itemsForZone(nameZone, items, zones).map((item) => item.id), [])
  assert.deepEqual(itemsForZone(locationZone, items, zones).map((item) => item.id), [1, 2])
})
