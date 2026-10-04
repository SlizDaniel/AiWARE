import { describe, expect, test } from 'vitest'
import { inventoryFamily } from './inventoryNames'

describe('inventory family detection', () => {
  test('lists only the variants that extend the name word-wise', () => {
    const items = [{ name: 'Kartony' }, { name: 'Kartony duże' }, { name: 'Kartony małe' }, { name: 'Kartoniki' }, { name: 'Duże kartony' }]
    expect(inventoryFamily('Kartony', items).map((item) => item.name)).toEqual(['Kartony duże', 'Kartony małe'])
    expect(inventoryFamily('kartony', items).map((item) => item.name)).toEqual(['Kartony duże', 'Kartony małe'])
    expect(inventoryFamily('Kartony duże', items)).toEqual([])
    expect(inventoryFamily('Kartoniki', items)).toEqual([])
    expect(inventoryFamily('', items)).toEqual([])
  })
})
