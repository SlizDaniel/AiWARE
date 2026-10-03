import { Fragment, useEffect, useRef, useState } from 'react'
import type { HistoryEntry, Item, UserAccount } from '@/lib/api'
import { DASHBOARD_EVENT_TYPES, type ActivityStatus, type DashboardActivity, type DashboardActivityResponse } from '@/lib/dashboard'
import {
  DEFAULT_FILTERS,
  downloadBlob,
  eventLabel,
  exportActivityCsv,
  fetchActivity,
  formatDateTime,
  isAbortError,
  MAX_QUERY_LENGTH,
  STATUS_LABELS,
  describeError,
  type ActivityFilters,
  type PeriodSelection,
} from '@/lib/dashboardApi'
import { isUndoable } from '../history'
import { Notice } from '../ui/feedback'
import { ChevronIcon, CloseIcon, DownloadIcon, SearchIcon, UndoIcon } from '../ui/icons'
import { StateShape } from '../ui/StateMark'
import { buttonClass, fieldClass } from '../ui/styles'
import { BlockError, Card, EmptyNote, Field, inputClass, labelClass, Loading } from './ui'
import { useRemote } from './useRemote'

type Props = {
  period: PeriodSelection
  periodKey: string
  refreshToken: string
  /** zmiana danych na serwerze (polling /api/version) → wracamy na pierwszą stronę */
  updateTick: number
  users: UserAccount[]
  items: Item[]
  onForbidden: () => void
  onUndo: (entry: HistoryEntry) => Promise<void>
}

const COLUMNS = 7

function hasStockChange(entry: DashboardActivity): boolean {
  return entry.event_type === 'stock_change' || entry.event_type === 'inventory_import'
}

/** Status wpisu bez koloru: aktywny — zwykły tekst, cofnięty — pusty krąg, korekta — ikona cofnięcia. */
function StatusLabel({ status }: { status: DashboardActivity['status'] }) {
  const label = STATUS_LABELS[status] ?? status
  if (status === 'undo') {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-semibold text-ink">
        <UndoIcon size={14} className="text-act" />
        {label}
      </span>
    )
  }
  if (status === 'undone') {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] text-mute">
        <StateShape kind="idle" />
        {label}
      </span>
    )
  }
  return <span className="whitespace-nowrap text-[13px] text-ink-2">{label}</span>
}

/** F: dziennik zapisanych akcji z filtrami (AND), stronami i eksportem CSV. */
export default function DashboardActivityLog({ period, periodKey, refreshToken, updateTick, users, items, onForbidden, onUndo }: Props) {
  const [filters, setFilters] = useState<Omit<ActivityFilters, 'q'>>(DEFAULT_FILTERS)
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const exportRef = useRef<AbortController | null>(null)

  // nowy okres albo nowe dane na serwerze → pierwsza strona (nowe wpisy przesuwają strony)
  const resetKey = `${periodKey}|${updateTick}`
  const [lastResetKey, setLastResetKey] = useState(resetKey)
  if (lastResetKey !== resetKey) {
    setLastResetKey(resetKey)
    setPage(1)
  }

  // wyszukiwanie z opóźnieniem ~300 ms
  useEffect(() => {
    if (queryInput.trim() === query) return
    const timer = setTimeout(() => {
      setQuery(queryInput.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [queryInput, query])

  useEffect(() => () => exportRef.current?.abort(), [])

  const applied: ActivityFilters = { ...filters, q: query }
  const remote = useRemote<DashboardActivityResponse>(
    (signal) => fetchActivity(period, applied, page, signal),
    JSON.stringify({ periodKey, applied, page }),
    refreshToken,
    onForbidden,
  )

  const setFilter = <K extends keyof Omit<ActivityFilters, 'q'>>(key: K, value: ActivityFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }))
    setPage(1)
    setExportError('')
  }

  const runExport = async () => {
    if (exporting) return
    exportRef.current?.abort()
    const controller = new AbortController()
    exportRef.current = controller
    setExporting(true)
    setExportError('')
    try {
      downloadBlob(await exportActivityCsv(period, applied, controller.signal), 'dashboard-activity.csv')
    } catch (error) {
      if (!isAbortError(error)) setExportError(describeError(error, 'Nie udało się przygotować eksportu.'))
    } finally {
      if (exportRef.current === controller) {
        exportRef.current = null
        setExporting(false)
      }
    }
  }

  const data = remote.data
  const timezone = data?.range.timezone ?? 'Europe/Warsaw'
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1
  const sortedUsers = [...users].sort((a, b) => (a.display_name || a.email).localeCompare(b.display_name || b.email, 'pl'))
  const sortedItems = [...items].sort((a, b) => a.name.localeCompare(b.name, 'pl'))
  const head = 'label-caps py-3 text-left'

  return (
    <Card
      title="Dziennik zapisanych akcji"
      subtitle="Zatwierdzone zmiany, importy i decyzje zapisane w audycie (bez pytań i odrzuconych kart)."
      busy={remote.loading}
      flush
      actions={
        <button type="button" onClick={() => void runExport()} disabled={exporting} className={buttonClass('secondary', 'sm')}>
          <DownloadIcon size={16} />
          {exporting ? 'Przygotowuję CSV…' : 'Eksport CSV'}
        </button>
      }
    >
      <div className="space-y-4 px-6 pb-5 pt-5">
        {exportError && (
          <Notice tone="alarm" role="alert">
            Eksport nieudany: {exportError} Zawęź daty lub filtry i spróbuj ponownie.
          </Notice>
        )}

        <div className="grid gap-4 @xl:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-5" role="group" aria-label="Filtry dziennika">
          <Field label="Autor">
            <select value={filters.actorId} onChange={(event) => setFilter('actorId', event.target.value)} className={inputClass}>
              <option value="">Wszyscy</option>
              <option value="unassigned">Bez przypisanego konta</option>
              {sortedUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.display_name || user.email}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Typ zdarzenia">
            <select value={filters.eventType} onChange={(event) => setFilter('eventType', event.target.value)} className={inputClass}>
              <option value="">Wszystkie typy</option>
              {DASHBOARD_EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {eventLabel(type)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Towar">
            <select value={filters.itemId} onChange={(event) => setFilter('itemId', event.target.value)} className={inputClass}>
              <option value="">Wszystkie towary</option>
              {sortedItems.map((item) => (
                <option key={item.id} value={String(item.id)}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select value={filters.status} onChange={(event) => setFilter('status', event.target.value as ActivityStatus)} className={inputClass}>
              <option value="all">Wszystkie</option>
              <option value="active">Aktywne</option>
              <option value="undone">Cofnięte</option>
              <option value="undo">Korekty cofające</option>
            </select>
          </Field>
          <Field label="Szukaj w nazwie">
            <span className="relative mt-1.5 block">
              <SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
              <input
                type="search"
                value={queryInput}
                maxLength={MAX_QUERY_LENGTH}
                onChange={(event) => setQueryInput(event.target.value)}
                placeholder="np. kartony"
                className={`${fieldClass} pl-9`}
              />
            </span>
          </Field>
        </div>

        {remote.error !== null && (
          <BlockError error={remote.error} fallback="Nie udało się pobrać dziennika." onRetry={remote.retry} kept={Boolean(data)} />
        )}
        {!data && remote.loading && <Loading text="Pobieram dziennik…" rows={5} />}
        {data && data.entries.length === 0 && !remote.loading && <EmptyNote>Brak wpisów dla wybranego okresu i filtrów.</EmptyNote>}
      </div>

      {data && data.entries.length > 0 && (
        <div className={'relative overflow-x-auto border-t border-line transition-opacity duration-200 ' + (remote.loading ? 'opacity-60' : '')}>
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="bg-ground/60">
              <tr>
                <th scope="col" className={`${head} pl-6 pr-5`}>Nr</th>
                <th scope="col" className={`${head} px-5`}>Czas</th>
                <th scope="col" className={`${head} px-5`}>Autor</th>
                <th scope="col" className={`${head} px-5`}>Typ</th>
                <th scope="col" className={`${head} px-5`}>Towar / temat</th>
                <th scope="col" className={`${head} px-5`}>Zmiana</th>
                <th scope="col" className={`${head} pl-5 pr-6`}>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((entry) => {
                const open = expandedId === entry.id
                const undone = entry.status === 'undone'
                return (
                  <Fragment key={entry.id}>
                    <tr className={'border-t border-line align-top transition-colors duration-150 ' + (open ? 'bg-ground/60' : 'hover:bg-ground/50')}>
                      <td className="whitespace-nowrap py-3.5 pl-6 pr-5 narrow tabular-nums text-mute">#{entry.id}</td>
                      <td className="whitespace-nowrap px-5 py-2">
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => setExpandedId(open ? null : entry.id)}
                          className="-mx-2 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-left font-medium tabular-nums text-ink transition-colors duration-150 hover:bg-ink/6 hover:text-act-ink"
                        >
                          <ChevronIcon size={14} className={'shrink-0 text-mute transition-transform duration-150 ' + (open ? 'rotate-90' : '')} />
                          {formatDateTime(entry.ts, timezone)}
                        </button>
                      </td>
                      <td className="px-5 py-3.5 text-ink-2">
                        <span className="block max-w-[11rem] truncate" title={entry.actor}>
                          {entry.actor || 'brak autora'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-ink-2">{eventLabel(entry.event_type)}</td>
                      <td className={'px-5 py-3.5 font-semibold ' + (undone ? 'text-ink-2' : 'text-ink')}>
                        <span className="block max-w-[14rem] truncate" title={entry.item_name}>
                          {entry.item_name || '—'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        {hasStockChange(entry) ? (
                          <span className="inline-flex items-baseline gap-2 whitespace-nowrap tabular-nums">
                            <span className={undone ? 'text-mute line-through' : 'text-ink'}>
                              {entry.before} → {entry.after}
                            </span>
                            <span className="text-[13px] font-semibold text-ink-2">{entry.delta > 0 ? `+${entry.delta}` : entry.delta}</span>
                          </span>
                        ) : (
                          <span className="block max-w-[15rem] truncate text-ink-2" title={entry.details || entry.text}>
                            {entry.details || entry.text || '—'}
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 pl-5 pr-6">
                        <StatusLabel status={entry.status} />
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-ground/60">
                        <td colSpan={COLUMNS} className="p-0">
                          {/* szerokość panelu i przyklejenie do lewej: szczegóły widoczne także przy przewiniętej tabeli */}
                          <div aria-live="polite" className="sticky left-0 w-[100cqw] max-w-full px-6 pb-6 pt-1">
                            <div className="border-t border-dashed border-line-strong pt-5">
                              <div className="mb-4 flex items-center justify-between gap-3">
                                <h3 className="text-[15px] font-semibold text-ink">
                                  Szczegóły wpisu <span className="narrow tabular-nums">#{entry.id}</span>
                                </h3>
                                <button type="button" onClick={() => setExpandedId(null)} className={buttonClass('ghost', 'sm')}>
                                  <CloseIcon size={16} />
                                  Zamknij
                                </button>
                              </div>
                              <EntryDetails key={entry.id} entry={entry} timezone={timezone} onUndo={onUndo} />
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && data.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-4 text-sm text-ink-2">
          <p className="tabular-nums">
            Strona {data.page} z {pages} · {data.total} {data.total === 1 ? 'wpis' : 'wpisów'}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1 || remote.loading}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              className={buttonClass('secondary', 'sm')}
            >
              <ChevronIcon size={14} className="rotate-180" />
              Poprzednia
            </button>
            <button type="button" disabled={!data.has_more || remote.loading} onClick={() => setPage((value) => value + 1)} className={buttonClass('secondary', 'sm')}>
              Następna
              <ChevronIcon size={14} />
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}

function EntryDetails({ entry, timezone, onUndo }: { entry: DashboardActivity; timezone: string; onUndo: (entry: HistoryEntry) => Promise<void> }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const undoable = isUndoable(entry)

  const undo = async () => {
    setBusy(true)
    setError('')
    try {
      await onUndo(entry)
      setConfirming(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Nie udało się cofnąć zmiany.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <dl className="grid gap-x-8 gap-y-4 @2xl:grid-cols-2">
        <Detail label="Wpis audytu" value={`#${entry.id} · ${formatDateTime(entry.ts, timezone, true)} (${timezone})`} />
        <Detail label="Autor" value={entry.actor_id ? `${entry.actor} (konto ${entry.actor_id})` : `${entry.actor || 'brak autora'} · bez przypisanego konta`} />
        <Detail label="Komenda / opis" value={entry.text || '—'} />
        <Detail label="Szczegóły" value={entry.details || '—'} />
        {entry.undo_of !== null && <Detail label="Korekta" value={`Cofa wpis #${entry.undo_of}`} />}
        {entry.undone_by !== null && <Detail label="Cofnięty" value={`Wpisem #${entry.undone_by}`} />}
      </dl>
      {undoable && !confirming && (
        <button type="button" onClick={() => setConfirming(true)} className={buttonClass('secondary', 'sm')}>
          <UndoIcon size={16} />
          Cofnij
        </button>
      )}
      {undoable && confirming && (
        <div role="group" aria-label={`Potwierdź cofnięcie wpisu #${entry.id}`}>
          <Notice
            tone="info"
            action={
              <>
                <button type="button" onClick={() => void undo()} disabled={busy} className={buttonClass('action', 'sm')}>
                  <UndoIcon size={16} />
                  {busy ? 'Cofam…' : 'Tak, cofnij'}
                </button>
                <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={buttonClass('ghost', 'sm')}>
                  Anuluj
                </button>
              </>
            }
          >
            Cofnąć zmianę? {entry.item_name} wróci z <span className="tabular-nums">{entry.after}</span> do{' '}
            <span className="tabular-nums">{entry.before}</span>. W dzienniku pojawi się nowy wpis — nic nie zniknie.
          </Notice>
        </div>
      )}
      {error && (
        <Notice tone="alarm" role="alert">
          Nie cofnięto zmiany: {error}
        </Notice>
      )}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className={labelClass}>{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-ink">{value}</dd>
    </div>
  )
}
