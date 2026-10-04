import type { Item } from '@/lib/api'
import { stockLevel } from './stockLevel'

export const STOCK_SORTS = {
  name: 'Nazwa A–Z',
  shortage: 'Braki najpierw',
  quantityAsc: 'Stan rosnąco',
  quantityDesc: 'Stan malejąco',
  location: 'Lokalizacja A–Z',
} as const
export const STOCK_FILTERS = {
  all: 'Wszystkie pozycje',
  shortage: 'Braki i poniżej minimum',
  empty: 'Zerowy stan',
} as const
export type StockSort = keyof typeof STOCK_SORTS
export type StockFilter = keyof typeof STOCK_FILTERS

const collator = new Intl.Collator('pl', { numeric: true, sensitivity: 'base' })
const levelRank = { empty: 0, below: 1, near: 2, ok: 3 }
const urgency = (item: Item) => item.quantity <= 0 ? 0 : levelRank[stockLevel(item.quantity, item.minimum)]
// Coverage compares different units without equating one roll with one piece.
const coverage = (item: Item) => item.minimum > 0 ? item.quantity / item.minimum : Infinity

export function selectStockItems(items: readonly Item[], query: string, sort: StockSort, filter: StockFilter): Item[] {
  const search = query.trim().toLocaleLowerCase('pl-PL')
  const selected = items.filter(item => item.name.toLocaleLowerCase('pl-PL').includes(search) && (
    filter === 'all' || (filter === 'empty' ? item.quantity <= 0 : item.quantity <= 0 || item.quantity < item.minimum)
  ))
  const byName = (a: Item, b: Item) => collator.compare(a.name, b.name) || a.id - b.id
  return selected.sort((a, b) => {
    if (sort === 'quantityAsc') return a.quantity - b.quantity || byName(a, b)
    if (sort === 'quantityDesc') return b.quantity - a.quantity || byName(a, b)
    if (sort === 'location') return collator.compare(a.location, b.location) || byName(a, b)
    if (sort === 'shortage') return urgency(a) - urgency(b) || coverage(a) - coverage(b) || byName(a, b)
    return byName(a, b)
  })
}
