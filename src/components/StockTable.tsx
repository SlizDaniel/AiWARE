import { useMemo, useState } from 'react'
import type { Item } from '@/lib/api'

type StockState = 'loading' | 'ready' | 'error'
type StockLevel = 'ok' | 'last-chance' | 'below-minimum'

const STOCK_LEVELS: Record<StockLevel, { label: string; badge: string }> = {
  ok: { label: 'OK', badge: 'bg-[#edf3ec] text-[#315b37]' },
  'last-chance': {
    label: 'Ostatnia szansa',
    badge: 'bg-[#fbf3db] text-[#805c12]',
  },
  'below-minimum': {
    label: 'Poniżej minimum',
    badge: 'bg-[#fdebec] text-[#8f3936]',
  },
}

function getStockLevel(item: Item): StockLevel {
  if (item.quantity < item.minimum) return 'below-minimum'
  if (item.minimum > 0 && item.quantity <= item.minimum * 1.5) return 'last-chance'
  return 'ok'
}

function StockLevelBar({ item, level }: { item: Item; level: StockLevel }) {
  const scale = Math.max(item.minimum * 2, 1)
  const redEnd = Math.min((item.minimum / scale) * 100, 100)
  const yellowEnd = Math.min(((item.minimum * 1.5) / scale) * 100, 100)
  const value = Math.min(Math.max((item.quantity / scale) * 100, 0), 100)
  const segments = `#f2dada 0% ${redEnd}%, #f3e7c3 ${redEnd}% ${yellowEnd}%, #dce9dc ${yellowEnd}% 100%`

  return (
    <div
      className="relative h-2.5 overflow-visible rounded-sm"
      role="progressbar"
      aria-label={`Stan ${item.name}: ${item.quantity} ${item.unit}, minimum ${item.minimum}. ${STOCK_LEVELS[level].label}.`}
      aria-valuemin={0}
      aria-valuemax={scale}
      aria-valuenow={Math.min(Math.max(item.quantity, 0), scale)}
      aria-valuetext={`${item.quantity} ${item.unit}; minimum ${item.minimum}; ${STOCK_LEVELS[level].label}`}
      style={{ background: `linear-gradient(to right, ${segments})` }}
    >
      <span
        aria-hidden="true"
        className="absolute top-[-3px] h-4 w-0.5 bg-[#454b46]"
        style={{ left: `${value}%` }}
      />
    </div>
  )
}

export default function StockTable({
  items,
  state = 'ready',
  error = '',
  onRetry,
}: {
  items: Item[]
  state?: StockState
  error?: string
  onRetry?: () => void
}) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase('pl-PL')
  const filteredItems = useMemo(
    () => items.filter((item) => item.name.toLocaleLowerCase('pl-PL').includes(normalizedQuery)),
    [items, normalizedQuery],
  )

  if (state === 'loading') {
    return (
      <div className="border border-[#e8e5de] bg-white p-6 text-sm text-[#646b64]" role="status" aria-live="polite">
        Pobieram stany magazynowe…
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="border border-[#edc8c5] bg-[#fff7f6] p-6" role="alert">
        <p className="font-semibold text-[#8f3936]">Nie udało się pobrać stanów magazynowych.</p>
        {error && <p className="mt-1 text-sm text-[#8f3936]">{error}</p>}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 border border-[#d8a9a5] bg-white px-4 py-2 text-sm font-semibold text-[#8f3936] hover:bg-[#fdebec] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8f3936]"
          >
            Spróbuj ponownie
          </button>
        )}
      </div>
    )
  }

  return (
    <section aria-label="Pozycje magazynowe">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <label className="w-full max-w-sm text-sm font-semibold text-[#454b46]">
          Szukaj pozycji
          <input
            aria-label="Szukaj pozycji magazynowej"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Wpisz nazwę, np. kartony"
            className="mt-1.5 block w-full border border-[#d8d6cf] bg-white px-3 py-2.5 font-normal text-[#292d2b] placeholder:text-[#70756f] focus-visible:border-[#536b56] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#536b56]"
          />
        </label>
        <p className="text-sm text-[#777b74]" aria-live="polite">
          {filteredItems.length} z {items.length} pozycji
        </p>
      </div>

      {items.length === 0 ? (
        <Empty text="Brak pozycji magazynowych. Zaimportuj plik lub dodaj dane, aby zobaczyć stany." />
      ) : filteredItems.length === 0 ? (
        <Empty text={`Nie znaleziono pozycji dla „${query.trim()}”.`} />
      ) : (
        <div className="overflow-x-auto border border-[#e8e5de] bg-white">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="border-b border-[#e8e5de] bg-[#f8f7f3] text-[11px] font-semibold uppercase tracking-[0.1em] text-[#70756f]">
                <th scope="col" className="px-5 py-4">Pozycja</th>
                <th scope="col" className="px-5 py-4 text-right">Stan</th>
                <th scope="col" className="px-5 py-4 text-right">Minimum</th>
                <th scope="col" className="px-5 py-4">Poziom zapasu</th>
                <th scope="col" className="px-5 py-4">Lokalizacja</th>
                <th scope="col" className="px-5 py-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const level = getStockLevel(item)
                return (
                  <tr key={item.id} className="border-b border-[#f0efe9] last:border-0 hover:bg-[#fbfaf7]">
                    <th scope="row" className="px-5 py-4 text-left font-semibold text-[#292d2b]">{item.name}</th>
                    <td className="px-5 py-4 text-right text-lg font-bold tabular-nums text-[#292d2b]">
                      {item.quantity} <span className="text-sm font-normal text-[#777b74]">{item.unit}</span>
                    </td>
                    <td className="px-5 py-4 text-right tabular-nums text-[#646b64]">{item.minimum}</td>
                    <td className="px-5 py-4"><StockLevelBar item={item} level={level} /></td>
                    <td className="px-5 py-4 text-sm text-[#646b64]">{item.location || '—'}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex px-2.5 py-1 text-xs font-semibold ${STOCK_LEVELS[level].badge}`}>
                        {STOCK_LEVELS[level].label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[#646b64]" aria-label="Legenda poziomów zapasu">
        <span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 bg-[#edc8c5]" aria-hidden="true" />Poniżej minimum</span>
        <span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 bg-[#ead9a9]" aria-hidden="true" />Ostatnia szansa</span>
        <span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 bg-[#cbd8c9]" aria-hidden="true" />OK</span>
      </div>
    </section>
  )
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="border border-dashed border-[#d8d6cf] bg-[#fbfaf7] p-8 text-center text-[#70756f] sm:p-12" role="status">
      {text}
    </div>
  )
}
