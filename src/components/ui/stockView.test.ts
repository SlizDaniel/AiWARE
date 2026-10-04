import { describe, expect, it } from 'vitest'
import type { Item } from '@/lib/api'
import { selectStockItems, type StockSort } from './stockView'

const item = (id: number, name: string, quantity: number, minimum: number, location = ''): Item =>
  ({ id, name, quantity, minimum, location, unit: 'szt' })
const items = [
  item(1, 'Szkło', 30, 10, 'B-10'),
  item(2, 'Folia', 2, 10, 'B-2'),
  item(3, 'Kartony', 0, 12, 'A-1'),
  item(4, 'Taśma', 8, 10, 'C-1'),
  item(5, 'Worki', 12, 10, 'D-1'),
  item(6, 'Zapas bez progu', 0, 0, 'E-1'),
]
const ids = (rows: Item[]) => rows.map(row => row.id)

describe('stock sorting and filtering', () => {
  it.each([
    ['name', [2, 3, 1, 4, 5, 6]],
    ['shortage', [3, 6, 2, 4, 5, 1]],
    ['quantityAsc', [3, 6, 2, 4, 5, 1]],
    ['quantityDesc', [1, 5, 4, 2, 3, 6]],
    ['location', [3, 2, 1, 4, 5, 6]],
  ] as [StockSort, number[]][])('sorts by %s without mutating input', (sort, expected) => {
    const original = [...items]
    expect(ids(selectStockItems(items, '', sort, 'all'))).toEqual(expected)
    expect(items).toEqual(original)
  })
  it('combines search, filter and sorting, including zero without a minimum', () => {
    expect(ids(selectStockItems(items, '', 'shortage', 'shortage'))).toEqual([3, 6, 2, 4])
    expect(ids(selectStockItems(items, '', 'name', 'empty'))).toEqual([3, 6])
    expect(ids(selectStockItems(items, '  KART  ', 'shortage', 'empty'))).toEqual([3])
    expect(selectStockItems(items, 'szkło', 'name', 'shortage')).toEqual([])
  })
  it('uses relative coverage rather than comparing units and treats the minimum boundary consistently', () => {
    const rows = [item(1, 'A', 2, 3), item(2, 'B', 10, 100), item(3, 'C', 3, 3), item(4, 'D', 5, 3)]
    expect(ids(selectStockItems(rows, '', 'shortage', 'all'))).toEqual([2, 1, 3, 4])
    expect(ids(selectStockItems(rows, '', 'name', 'shortage'))).toEqual([1, 2])
  })
  it('breaks ties by Polish name then ID, handles missing locations and zero minima', () => {
    const rows = [item(2, 'Żuraw', 2, 0), item(3, 'Łopata', 2, 0), item(1, 'Łopata', 2, 0)]
    expect(ids(selectStockItems(rows, '', 'shortage', 'all'))).toEqual([1, 3, 2])
    expect(ids(selectStockItems(rows, '', 'location', 'all'))).toEqual([1, 3, 2])
    expect(selectStockItems([], '', 'shortage', 'all')).toEqual([])
  })
  it('recalculates order and filters after a confirmed stock update', () => {
    const updated = items.map(row => row.id === 3 ? { ...row, quantity: 100 } : row)
    expect(ids(selectStockItems(updated, '', 'shortage', 'empty'))).toEqual([6])
    expect(ids(selectStockItems(updated, '', 'shortage', 'all'))).toEqual([6, 2, 4, 5, 1, 3])
  })
})
