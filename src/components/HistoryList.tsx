import { useState } from 'react'
import type { HistoryEntry } from '@/lib/api'
import { isUndoable } from './history'
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
  /** Cofanie zmian stanów — tylko kierownik. */
  canUndo?: boolean
  onUndo?: (entry: HistoryEntry) => Promise<void>
  /** Przejście do pełnego dziennika (Dashboard kierownika) — tylko dla kierownika. */
  onOpenFullLog?: () => void
}

/** Serwer zwraca najwyżej tyle najnowszych wpisów historii. */
export const HISTORY_LIMIT = 200

export default function HistoryList({ entries, state = 'ready', error = '', onRetry, canUndo = false, onUndo, onOpenFullLog }: Props) {
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [undoError, setUndoError] = useState<{ id: number; message: string } | null>(null)

  const undo = async (entry: HistoryEntry) => {
    if (!onUndo || busyId !== null) return
    setBusyId(entry.id)
    setUndoError(null)
    try {
      await onUndo(entry)
      setConfirmingId(null)
    } catch (reason) {
      setUndoError({ id: entry.id, message: reason instanceof Error ? reason.message : 'Nie udało się cofnąć zmiany.' })
    } finally {
      setBusyId(null)
    }
  }

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
    <>
    {entries.length >= HISTORY_LIMIT && (
      <div className="mb-3 border border-[#e8e5de] bg-[#fbfaf7] px-4 py-3 text-sm text-[#646b64]" role="note">
        Pokazano {HISTORY_LIMIT} najnowszych wpisów. Starsze znajdziesz w Dashboardzie kierownika → Dziennik zapisanych akcji.
        {onOpenFullLog && (
          <button
            type="button"
            onClick={onOpenFullLog}
            className="ml-2 font-semibold text-[#315b37] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56]"
          >
            Otwórz dziennik
          </button>
        )}
      </div>
    )}
    <ol className="space-y-3">
      {entries.map((entry) => {
        const isReorderEvent = entry.event_type.startsWith('reorder_')
        const isImportEvent = entry.event_type === 'inventory_import'
        const isStockChange = entry.event_type === 'stock_change' || isImportEvent || !entry.event_type
        const isUndone = entry.undone_by != null
        const isUndo = entry.undo_of != null
        const markerClass = entry.event_type === 'reorder_rejected' || isUndone
          ? 'bg-[#f0efe9] text-[#646b64]'
          : isReorderEvent
            ? 'bg-[#fbf3db] text-[#805c12]'
            : isStockChange
              ? entry.delta < 0
                ? 'bg-[#fdebec] text-[#8f3936]'
                : 'bg-[#edf3ec] text-[#315b37]'
              : 'bg-[#edf0f3] text-[#475a70]'
        const eventLabel = !isStockChange && !isReorderEvent ? EVENT_LABELS[entry.event_type] : undefined
        const actor = entry.actor?.trim() || 'System'
        const showUndo = canUndo && Boolean(onUndo) && isUndoable(entry)
        const confirming = confirmingId === entry.id
        const busy = busyId === entry.id

        return (
          <li key={entry.id} className={'flex items-start gap-4 border border-[#e8e5de] bg-white p-5' + (isUndone ? ' opacity-75' : '')}>
            <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center text-sm font-bold ${markerClass}`} aria-hidden="true">
              {isReorderEvent ? 'Z' : isUndo ? '↺' : isStockChange ? entry.delta < 0 ? '−' : '+' : '•'}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className={'font-semibold' + (isUndone ? ' line-through decoration-[#9a9e97]' : '')}>
                  {isStockChange ? `${actor}: ${entry.item_name} ${entry.before}→${entry.after}` : `${actor}: ${entry.item_name}`}
                </span>
                {isStockChange && (
                  <span className={'px-2 py-0.5 text-xs font-bold ' + (entry.delta < 0 ? 'bg-[#fdebec] text-[#8f3936]' : 'bg-[#edf3ec] text-[#315b37]')}>
                    {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                  </span>
                )}
                {eventLabel && <span className="bg-[#edf0f3] px-2 py-0.5 text-xs font-bold text-[#475a70]">{eventLabel}</span>}
                {isUndone && <span className="bg-[#f0efe9] px-2 py-0.5 text-xs font-bold text-[#646b64]">cofnięte</span>}
                {isUndo && <span className="bg-[#edf0f3] px-2 py-0.5 text-xs font-bold text-[#475a70]">cofnięcie</span>}
              </div>
              <div className="mt-0.5 truncate text-sm text-[#646b64]">
                {isReorderEvent || isImportEvent ? entry.details || entry.text : `„${entry.text}”`}
              </div>
              <div className="mt-1 text-xs text-[#70756f]">
                {entry.ts} · audyt #{entry.id}
                {isUndo && ` · cofa wpis #${entry.undo_of}`}
                {isUndone && ` · cofnięty wpisem #${entry.undone_by}`}
              </div>

              {showUndo && !confirming && (
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingId(entry.id)
                    setUndoError(null)
                  }}
                  disabled={busyId !== null}
                  className="mt-3 border border-[#d8d6cf] bg-white px-3 py-1.5 text-sm font-semibold text-[#454b46] transition-colors hover:bg-[#f8f7f3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Cofnij
                </button>
              )}
              {showUndo && confirming && (
                <div className="mt-3 border border-[#ead9a9] bg-[#fffaf0] p-3" role="group" aria-label={`Potwierdź cofnięcie wpisu #${entry.id}`}>
                  <p className="text-sm text-[#805c12]">
                    Cofnąć zmianę? {entry.item_name} wróci z {entry.after} do {entry.before}. W historii pojawi się nowy wpis — nic nie zniknie.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void undo(entry)}
                      disabled={busy}
                      className="bg-[#315b37] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#274a2d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {busy ? 'Cofam…' : 'Tak, cofnij'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingId(null)
                        setUndoError(null)
                      }}
                      disabled={busy}
                      className="border border-[#d8d6cf] bg-white px-4 py-2 text-sm font-semibold text-[#646b64] transition-colors hover:bg-[#f8f7f3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Anuluj
                    </button>
                  </div>
                </div>
              )}
              {undoError?.id === entry.id && (
                <p className="mt-3 border border-[#edc8c5] bg-[#fff7f6] p-3 text-sm text-[#8f3936]" role="alert">
                  Nie cofnięto zmiany: {undoError.message}
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
    </>
  )
}
