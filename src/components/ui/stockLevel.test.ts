import { describe, expect, it } from 'vitest'
import { countDeviations, rangePercent, rangeScale, stockLevel } from './stockLevel'

describe('stockLevel', () => {
  it('rozróżnia brak, poniżej minimum, ostatnią szansę i OK', () => {
    expect(stockLevel(0, 10)).toBe('empty')
    expect(stockLevel(9, 10)).toBe('below')
    expect(stockLevel(15, 10)).toBe('near')
    expect(stockLevel(16, 10)).toBe('ok')
  })

  it('bez minimum zero sztuk nie jest alarmem', () => {
    expect(stockLevel(0, 0)).toBe('ok')
  })

  it('liczy odchylenia', () => {
    expect(countDeviations([
      { quantity: 0, minimum: 5 },
      { quantity: 3, minimum: 5 },
      { quantity: 30, minimum: 5 },
    ])).toEqual({ empty: 1, below: 1 })
  })
})

describe('rangeScale', () => {
  it('trzyma kreskę minimum na 1/3 skali', () => {
    expect(rangeScale(10, [500])).toBe(30)
    expect(rangePercent(10, rangeScale(10, []))).toBeCloseTo(33.33, 1)
  })

  it('bez minimum skaluje do największej wartości z zapasem', () => {
    expect(rangeScale(0, [8, 4])).toBe(10)
    expect(rangeScale(0, [])).toBe(1)
  })

  it('przycina pozycję do zakresu', () => {
    expect(rangePercent(-5, 10)).toBe(0)
    expect(rangePercent(50, 10)).toBe(100)
    expect(rangePercent(5, 0)).toBe(0)
  })
})
