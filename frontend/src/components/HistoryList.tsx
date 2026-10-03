import type { HistoryEntry } from '../api'
import { Empty } from './StockTable'

const EVENT_LABELS: Record<string, string> = {
  zone_added: 'strefa',
  item_added: 'nowa pozycja',
  procedure_saved: 'procedura',
}

type Props = {
  entries: HistoryEntry[]
  state?: 'loading' | 'ready' | 'error'
  error?: string
  onRetry?: () => void
}

export default function HistoryList({ entries, state = 'ready', error = '', onRetry }: Props) {
  if (state === 'loading') {
    return <div className="border border-[#e8e5de] bg-white p-6 text-sm text-[#646b64]" role="status">Pobieram historię zmian…</div>
  }

  if (state === 'error') {
    return (
      <div className="border border-[#edc8c5] bg-[#fff7f6] p-6" role="alert">
        <p className="font-semibold text-[#8f3936]">Nie udało się pobrać historii zmian.</p>
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

  if (entries.length === 0) {
    return <Empty text="Brak zmian — zatwierdź pierwszą kartę zmiany, a pojawi się tutaj wpis." />
  }

  return (
    <ol className="space-y-3">
      {entries.map((entry) => {
        const isReorderEvent = entry.event_type.startsWith('reorder_')
        const isImportEvent = entry.event_type === 'inventory_import'
        const isStockChange = entry.event_type === 'stock_change' || isImportEvent || !entry.event_type
        const markerClass = entry.event_type === 'reorder_rejected'
          ? 'bg-[#f0efe9] text-[#646b64]'
          : isReorderEvent
            ? 'bg-[#fbf3db] text-[#805c12]'
            : isStockChange
              ? entry.delta < 0
                ? 'bg-[#fdebec] text-[#8f3936]'
                : 'bg-[#edf3ec] text-[#315b37]'
              : 'bg-[#edf0f3] text-[#475a70]'
        const eventLabel = !isStockChange && !isReorderEvent ? EVENT_LABELS[entry.event_type] : undefined

        return (
          <li key={entry.id} className="flex items-start gap-4 border border-[#e8e5de] bg-white p-5">
            <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center text-sm font-bold ${markerClass}`} aria-hidden="true">
              {isReorderEvent ? 'Z' : isStockChange ? entry.delta < 0 ? '−' : '+' : '•'}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold">
                  {isStockChange ? `${entry.actor}: ${entry.item_name} ${entry.before}→${entry.after}` : `${entry.actor}: ${entry.item_name}`}
                </span>
                {isStockChange && (
                  <span className={'px-2 py-0.5 text-xs font-bold ' + (entry.delta < 0 ? 'bg-[#fdebec] text-[#8f3936]' : 'bg-[#edf3ec] text-[#315b37]')}>
                    {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                  </span>
                )}
                {eventLabel && <span className="bg-[#edf0f3] px-2 py-0.5 text-xs font-bold text-[#475a70]">{eventLabel}</span>}
              </div>
              <div className="mt-0.5 truncate text-sm text-[#646b64]">
                {isReorderEvent || isImportEvent ? entry.details || entry.text : `„${entry.text}”`}
              </div>
              <div className="mt-1 text-xs text-[#70756f]">
                {entry.ts} · audyt #{entry.id}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
