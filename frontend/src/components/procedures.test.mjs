import assert from 'node:assert/strict'
import test from 'node:test'
import { filterProcedures, procedureZone } from './procedures.ts'

const procedures = [
  { id: 1, topic: 'szkło', text: 'Szkło pakujemy w kartony Y, strefa C2.', created: '' },
  { id: 2, topic: 'folia', text: 'Przechowujemy na suchym regale.', created: '' },
]

test('procedure search matches a fragment of the topic or text, ignoring case and surrounding spaces', () => {
  assert.deepEqual(filterProcedures(procedures, ' SZKŁ ').map((p) => p.id), [1])
  assert.deepEqual(filterProcedures(procedures, 'KARTONY Y').map((p) => p.id), [1])
  assert.deepEqual(filterProcedures(procedures, 'rega').map((p) => p.id), [2])
})

test('empty procedure search lists all entries and an unknown fragment lists none', () => {
  assert.deepEqual(filterProcedures(procedures, '  '), procedures)
  assert.deepEqual(filterProcedures(procedures, 'metal'), [])
})

const zones = [
  { id: 1, name: 'szkło', created: '' },
  { id: 2, name: 'C2', created: '' },
  { id: 3, name: 'C20', created: '' },
  { id: 4, name: 'B-2', created: '' },
]
const items = [{ id: 1, name: 'Szkło', quantity: 20, minimum: 8, unit: 'szt', location: 'Strefa B-2' }]

test('procedure map link uses the named zone, including Polish inflection, and never a code prefix', () => {
  assert.equal(procedureZone(procedures[0], zones, items)?.id, 2)
  assert.equal(procedureZone({ topic: 'szkło', text: 'Towar leży w Strefie B-2.' }, zones, items)?.id, 4)
  assert.equal(procedureZone({ topic: 'szkło', text: 'Pakujemy w strefie C20.' }, zones, items)?.id, 3)
})

test('unknown and conflicting explicit zones never fall back to the product location', () => {
  assert.equal(procedureZone({ topic: 'szkło', text: 'Strefa C200.' }, zones, items), null)
  assert.equal(procedureZone({ topic: 'szkło', text: 'Strefa C2; strefa B-2.' }, zones, items), null)
  assert.equal(procedureZone({ topic: 'szkło', text: 'Strefa C2; strefa nieznana.' }, zones, items), null)
})

test('without an explicit location only a unique related zone can be shown', () => {
  const procedure = { topic: 'szkło', text: 'Pakujemy z przekładkami.' }
  assert.equal(procedureZone(procedure, [zones[0]], items)?.id, 1)
  assert.equal(procedureZone(procedure, [zones[3]], items)?.id, 4)
  assert.equal(procedureZone(procedure, zones, items), null)
  assert.equal(procedureZone({ topic: 'metal', text: 'Pakujemy ostrożnie.' }, zones, items), null)
})
