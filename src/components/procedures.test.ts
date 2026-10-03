import { expect, test } from 'vitest'
import { filterProcedures, procedureZone } from './procedures'

const procedures = [
  { id: 1, topic: 'szkło', text: 'Szkło pakujemy w kartony Y, strefa C2.', created: '' },
  { id: 2, topic: 'folia', text: 'Przechowujemy na suchym regale.', created: '' },
]

test('procedure search matches a fragment of the topic or text, ignoring case and surrounding spaces', () => {
  expect(filterProcedures(procedures, ' SZKŁ ').map((p) => p.id)).toEqual([1])
  expect(filterProcedures(procedures, 'KARTONY Y').map((p) => p.id)).toEqual([1])
  expect(filterProcedures(procedures, 'rega').map((p) => p.id)).toEqual([2])
})

test('empty procedure search lists all entries and an unknown fragment lists none', () => {
  expect(filterProcedures(procedures, '  ')).toEqual(procedures)
  expect(filterProcedures(procedures, 'metal')).toEqual([])
})

const zones = [
  { id: 1, name: 'szkło', created: '' },
  { id: 2, name: 'C2', created: '' },
  { id: 3, name: 'C20', created: '' },
  { id: 4, name: 'B-2', created: '' },
]
const items = [{ id: 1, name: 'Szkło', quantity: 20, minimum: 8, unit: 'szt', location: 'Strefa B-2' }]

test('procedure map link uses the named zone, including Polish inflection, and never a code prefix', () => {
  expect(procedureZone(procedures[0], zones, items)?.id).toBe(2)
  expect(procedureZone({ topic: 'szkło', text: 'Towar leży w Strefie B-2.' }, zones, items)?.id).toBe(4)
  expect(procedureZone({ topic: 'szkło', text: 'Pakujemy w strefie C20.' }, zones, items)?.id).toBe(3)
})

test('unknown and conflicting explicit zones never fall back to the product location', () => {
  expect(procedureZone({ topic: 'szkło', text: 'Strefa C200.' }, zones, items)).toBeNull()
  expect(procedureZone({ topic: 'szkło', text: 'Strefa C2; strefa B-2.' }, zones, items)).toBeNull()
  expect(procedureZone({ topic: 'szkło', text: 'Strefa C2; strefa nieznana.' }, zones, items)).toBeNull()
})

test('without an explicit location only a unique related zone can be shown', () => {
  const procedure = { topic: 'szkło', text: 'Pakujemy z przekładkami.' }
  expect(procedureZone(procedure, [zones[0]], items)?.id).toBe(1)
  expect(procedureZone(procedure, [zones[3]], items)?.id).toBe(4)
  expect(procedureZone(procedure, zones, items)).toBeNull()
  expect(procedureZone({ topic: 'metal', text: 'Pakujemy ostrożnie.' }, zones, items)).toBeNull()
})
