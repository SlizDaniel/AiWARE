import { useState } from 'react'
import type { HistoryEntry } from '@/lib/api'
import { isUndoable } from './history'
import { EmptyState, LoadError, Notice, Skeleton } from './ui/feedback'
import { ChevronIcon, UndoIcon } from './ui/icons'
import { buttonClass, panelClass } from './ui/styles'

const EVENT_LABELS: Record<string, string> = {
  zone_added: 'strefa',
  item_added: 'nowa pozycja',
  procedure_saved: 'procedura',
  packaging_link_updated: 'powiązanie opakowania',
  inventory_item_updated: 'edycja produktu',
  reorder_draft_created: 'szkic zamówienia',
  reorder_approved: 'szkic zatwierdzony',
  reorder_rejected: 'szkic odrzucony',
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

/** Znacznik czasu z serwera: „RRRR-MM-DD GG:MM:SS”. */
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?/

function splitTimestamp(ts: string): { day: string; time: string; iso?: string } {
  const match = TIMESTAMP.exec(ts)
  if (!match) return { day: '', time: ts }
  return { day: match[1], time: match[2], iso: `${match[1]}T${match[2]}${match[3] ?? ''}` }
}

function formatDay(day: string): string {
  const date = new Date(`${day}T12:00:00`)
  if (Number.isNaN(date.getTime())) return day
  return new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

/** Kolejne wpisy z tego samego dnia pod jednym nagłówkiem (kolejność z serwera bez zmian). */
function groupByDay(entries: HistoryEntry[]): { day: string; entries: HistoryEntry[] }[] {
  const groups: { day: string; entries: HistoryEntry[] }[] = []
  for (const entry of entries) {
    const { day } = splitTimestamp(entry.ts)
    const last = groups.at(-1)
    if (last && last.day === day) last.entries.push(entry)
    else groups.push({ day, entries: [entry] })
  }
  return groups
}

function signedDelta(delta: number): string {
  if (delta > 0) return `+${delta}`
  if (delta < 0) return `−${Math.abs(delta)}`
  return '±0'
}

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
    return <Skeleton rows={6} label="Pobieram historię zmian…" />
  }

  if (state === 'error') {
    return <LoadError title="Nie udało się pobrać historii zmian." detail={error || undefined} onRetry={onRetry} />
  }

  if (entries.length === 0) {
    return <EmptyState title="Brak zmian">Zatwierdź pierwszą kartę zmiany, a pojawi się tutaj wpis.</EmptyState>
  }

  return (
    <div className="space-y-4">
      {entries.length >= HISTORY_LIMIT && (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm text-ink-2" role="note">
          <p className="min-w-0 max-w-[70ch]">
            Pokazano {HISTORY_LIMIT} najnowszych wpisów. Starsze znajdziesz w Dashboardzie kierownika → Dziennik zapisanych akcji.
          </p>
          {onOpenFullLog && (
            <button type="button" onClick={onOpenFullLog} className={buttonClass('secondary', 'sm')}>
              Otwórz dziennik
              <ChevronIcon size={14} />
            </button>
          )}
        </div>
      )}

      <div className={panelClass + ' overflow-hidden'}>
        {groupByDay(entries).map((group, index) => (
          <div key={`${group.day}-${index}`}>
            {group.day && (
              <h2 className={'label-caps bg-ground/60 px-5 py-2.5 sm:px-6' + (index > 0 ? ' border-t border-line' : '')}>
                {formatDay(group.day)}
              </h2>
            )}
            <ol className={'divide-y divide-line' + (group.day || index > 0 ? ' border-t border-line' : '')}>
              {group.entries.map((entry) => {
                const isReorderEvent = entry.event_type.startsWith('reorder_')
                const isImportEvent = entry.event_type === 'inventory_import'
                const isStockChange = entry.event_type === 'stock_change' || isImportEvent || !entry.event_type
                const isUndone = entry.undone_by != null
                const isUndo = entry.undo_of != null
                const receded = entry.event_type === 'reorder_rejected' || isUndone
                const eventLabel = !isStockChange ? EVENT_LABELS[entry.event_type] : undefined
                const actor = entry.actor?.trim() || 'System'
                const showUndo = canUndo && Boolean(onUndo) && isUndoable(entry)
                const confirming = confirmingId === entry.id
                const busy = busyId === entry.id
                const detail = isReorderEvent || isImportEvent || entry.event_type === 'inventory_item_updated'
                  ? entry.details || entry.text
                  : `„${entry.text}”`
                const time = splitTimestamp(entry.ts)
                const struck = isUndone ? ' line-through decoration-mute' : ''

                return (
                  <li
                    key={entry.id}
                    className="grid grid-cols-[3.75rem_minmax(0,1fr)_auto] gap-x-4 px-5 py-4 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto] sm:px-6"
                  >
                    <div className="narrow pt-px tabular-nums">
                      <time dateTime={time.iso} title={entry.ts} className="block text-sm font-medium text-ink-2">
                        {time.time}
                      </time>
                      <span className="mt-0.5 block text-xs text-mute">#{entry.id}</span>
                    </div>

                    <div className="min-w-0">
                      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className={'font-semibold ' + (receded ? 'text-mute' : 'text-ink') + struck}>{entry.item_name}</span>
                        {isStockChange && (
                          <span className="inline-flex items-baseline gap-2 tabular-nums">
                            <span className={(receded ? 'text-mute' : 'text-ink') + struck}>
                              {entry.before} → {entry.after}
                            </span>
                            <span className={'text-sm ' + (receded ? 'text-mute' : 'text-ink-2')}>{signedDelta(entry.delta)}</span>
                          </span>
                        )}
                        {eventLabel && <span className="label-caps">{eventLabel}</span>}
                        {isUndo && (
                          <span className="label-caps inline-flex items-center gap-1">
                            <UndoIcon size={13} />
                            cofnięcie
                          </span>
                        )}
                        {isUndone && <span className="label-caps">cofnięte</span>}
                      </p>
                      <p className={'mt-1 truncate text-sm ' + (receded ? 'text-mute' : 'text-ink-2')} title={detail}>
                        {detail}
                      </p>
                      <p className="mt-1 text-[13px] text-mute">
                        {actor}
                        {isUndo && <> · cofa wpis <span className="narrow tabular-nums">#{entry.undo_of}</span></>}
                        {isUndone && <> · cofnięty wpisem <span className="narrow tabular-nums">#{entry.undone_by}</span></>}
                      </p>

                      {showUndo && confirming && (
                        <div className="mt-3" role="group" aria-label={`Potwierdź cofnięcie wpisu #${entry.id}`}>
                          <Notice
                            tone="info"
                            title="Cofnąć zmianę?"
                            action={
                              <>
                                <button
                                  type="button"
                                  onClick={() => void undo(entry)}
                                  disabled={busy}
                                  className={buttonClass('action', 'sm')}
                                >
                                  <UndoIcon size={15} />
                                  {busy ? 'Cofam…' : 'Tak, cofnij'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setConfirmingId(null)
                                    setUndoError(null)
                                  }}
                                  disabled={busy}
                                  className={buttonClass('ghost', 'sm')}
                                >
                                  Anuluj
                                </button>
                              </>
                            }
                          >
                            {entry.item_name} wróci z <span className="tabular-nums">{entry.after}</span> do{' '}
                            <span className="tabular-nums">{entry.before}</span>. W historii pojawi się nowy wpis — nic nie zniknie.
                          </Notice>
                        </div>
                      )}
                      {undoError?.id === entry.id && (
                        <Notice tone="alarm" role="alert" className="mt-3">
                          Nie cofnięto zmiany: {undoError.message}
                        </Notice>
                      )}
                    </div>

                    <div className="-mr-1.5 -mt-1">
                      {showUndo && !confirming && (
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmingId(entry.id)
                            setUndoError(null)
                          }}
                          disabled={busyId !== null}
                          className={buttonClass('ghost', 'sm')}
                        >
                          <UndoIcon size={16} />
                          Cofnij
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>
        ))}
      </div>
    </div>
  )
}
