import { expect, test } from 'vitest'
import { findZoneByName, itemsForZone, mapTargetFromAnswer, normalizeZoneName, zoneForItem } from './zoneItems'

const items = [
  { id: 1, name: 'Kartony', quantity: 54, minimum: 12, unit: 'szt', location: 'Strefa A-1' },
  { id: 2, name: 'Taśma', quantity: 9, minimum: 3, unit: 'szt', location: 'Strefa A-1, regał 2' },
  { id: 3, name: 'Folia', quantity: 15, minimum: 6, unit: 'rolka', location: 'Strefa A-10' },
]

test('a location query highlights the most specific recorded zone', () => {
  const zones = [
    { id: 1, name: 'kartony', created: '' },
    { id: 2, name: 'A', created: '' },
    { id: 3, name: 'A-1', created: '' },
  ]
  expect(zoneForItem({ name: 'Kartony', location: 'Strefa A-1, regał 2' }, zones)?.id).toBe(3)
})

test('API location and single-stock answers expose a map target', () => {
  expect(
    mapTargetFromAnswer('get_location', {
      item_id: 1,
      item_name: 'Kartony',
      location: 'Strefa A-1',
      quantity: 54,
      unit: 'szt',
    }),
  ).toEqual({ name: 'Kartony', location: 'Strefa A-1' })
  expect(mapTargetFromAnswer('get_stock', { item: items[0] })).toEqual({ name: 'Kartony', location: 'Strefa A-1' })
})

test('equivalent zone names identify an existing zone before confirmation', () => {
  const zones = [{ id: 2, name: 'A-1', created: '' }]
  expect(findZoneByName('  Strefa: a 1 ', zones)?.id).toBe(2)
  expect(findZoneByName('A-10', zones)).toBeNull()
})

test('missing zones and unrelated or malformed answers do not invent a map location', () => {
  expect(zoneForItem({ name: 'Szkło', location: 'C2' }, [])).toBeNull()
  expect(mapTargetFromAnswer('get_stock', { items })).toBeNull()
  expect(mapTargetFromAnswer('recall_procedure', { item_name: 'Kartony', location: 'A-1' })).toBeNull()
  expect(mapTargetFromAnswer('get_location', { item_name: 'Kartony', location: null })).toBeNull()
})

test('zone named after an item shows that item even when its location uses a code', () => {
  const zone = { id: 1, name: 'kartony', created: '' }
  expect(itemsForZone(zone, items, [zone]).map((item) => item.id)).toEqual([1])
})

test('zone location matches its exact code and sublocations, but not a different code', () => {
  const zone = { id: 2, name: 'A-1', created: '' }
  expect(itemsForZone(zone, items, [zone]).map((item) => item.id)).toEqual([1, 2])
})

test('a recorded location wins over a matching product name when both zones exist', () => {
  const nameZone = { id: 1, name: 'kartony', created: '' }
  const locationZone = { id: 2, name: 'A-1', created: '' }
  const zones = [nameZone, locationZone]

  expect(itemsForZone(nameZone, items, zones).map((item) => item.id)).toEqual([])
  expect(itemsForZone(locationZone, items, zones).map((item) => item.id)).toEqual([1, 2])
})

test('equivalent location labels normalize alike and the older zone owns the stock', () => {
  const first = { id: 3, name: 'A-1', created: '' }
  const alias = { id: 8, name: 'Strefa A-1', created: '' }

  expect(normalizeZoneName(first.name)).toBe(normalizeZoneName(alias.name))
  expect(itemsForZone(first, items, [alias, first]).map((item) => item.id)).toEqual([1, 2])
  expect(itemsForZone(alias, items, [alias, first]).map((item) => item.id)).toEqual([])
})
