import type { HistoryEntry } from '../api'
import { Empty } from './StockTable'

export default function HistoryList({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length === 0) {
    return <Empty text="Brak zmian — zatwierdź pierwszą kartę zmiany, a pojawi się tutaj wpis." />
  }
  return (
    <ol className="space-y-3">
      {entries.map((e) => {
        const isReorderEvent = e.event_type.startsWith('reorder_')
        const isImportEvent = e.event_type === 'inventory_import'
        const isStockChange = e.event_type === 'stock_change' || isImportEvent || !e.event_type
        const iconClass = e.event_type === 'reorder_rejected'
          ? 'bg-slate-100 text-slate-600'
          : isReorderEvent
            ? 'bg-amber-100 text-amber-700'
            : e.delta < 0
              ? 'bg-rose-100 text-rose-600'
              : 'bg-emerald-100 text-emerald-700'

        return (
        <li key={e.id} className="flex items-start gap-4 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <span
            className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg ${iconClass}`}
          >
            {isReorderEvent ? '📦' : e.delta < 0 ? '↘' : '↗'}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold">
                {isStockChange ? `${e.actor}: ${e.item_name} ${e.before}→${e.after}` : e.text}
              </span>
              {isStockChange && (
                <span
                  className={
                    'rounded-full px-2 py-0.5 text-xs font-bold ' +
                    (e.delta < 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700')
                  }
                >
                  {e.delta > 0 ? `+${e.delta}` : e.delta}
                </span>
              )}
            </div>
            <div className="mt-0.5 truncate text-sm text-slate-600">
              {isReorderEvent || isImportEvent ? e.details : `„${e.text}”`}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {e.ts} · audyt #{e.id}
            </div>
          </div>
        </li>
        )
      })}
    </ol>
  )
}
