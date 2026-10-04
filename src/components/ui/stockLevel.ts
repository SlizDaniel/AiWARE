import type { StateKind } from './StateMark'

/** Poziom zapasu pozycji — jedno źródło prawdy dla tabeli, mapy, karty zmiany i paska alarmów. */
export type StockLevel = 'empty' | 'below' | 'near' | 'ok'

export const STOCK_LEVEL: Record<StockLevel, { label: string; kind: StateKind }> = {
  empty: { label: 'Brak towaru', kind: 'alarm' },
  below: { label: 'Poniżej minimum', kind: 'warn' },
  near: { label: 'Ostatnia szansa', kind: 'near' },
  ok: { label: 'OK', kind: 'idle' },
}

export function stockLevel(quantity: number, minimum: number): StockLevel {
  if (minimum > 0 && quantity <= 0) return 'empty'
  if (quantity < minimum) return 'below'
  if (minimum > 0 && quantity <= minimum * 1.5) return 'near'
  return 'ok'
}

/** Pozycje wymagające uwagi: najpierw braki, potem poniżej minimum. */
export function countDeviations(items: readonly { quantity: number; minimum: number }[]) {
  let empty = 0
  let below = 0
  for (const item of items) {
    const level = stockLevel(item.quantity, item.minimum)
    if (level === 'empty') empty++
    else if (level === 'below') below++
  }
  return { empty, below }
}

/**
 * Skala wskaźnika zakresu. Przy minimum > 0 skala to zawsze 3 × minimum, więc kreska minimum stoi
 * w tym samym miejscu w każdym wierszu (1/3 szerokości) — kolumnę da się przeczytać jednym spojrzeniem.
 * Wartości ponad skalę są ucinane i oznaczane jako „ponad skalę”.
 */
export function rangeScale(minimum: number, values: readonly number[]): number {
  if (minimum > 0) return minimum * 3
  const top = Math.max(0, ...values.filter((value) => Number.isFinite(value)))
  return top > 0 ? top * 1.25 : 1
}

/** Pozycja na skali w procentach, przycięta do [0, 100]. */
export function rangePercent(value: number, scale: number): number {
  if (!(scale > 0) || !Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, (value / scale) * 100))
}
