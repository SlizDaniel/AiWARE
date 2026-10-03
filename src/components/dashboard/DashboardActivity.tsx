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
import { BlockError, Card, EmptyNote, inputClass, labelClass, Loading, secondaryButton } from './ui'
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

const STATUS_BADGE: Record<DashboardActivity['status'], string> = {
  active: 'bg-[#edf3ec] text-[#315b37]',
  undone: 'bg-[#f0efe9] text-[#646b64]',
  undo: 'bg-[#edf0f3] text-[#475a70]',
}

function hasStockChange(entry: DashboardActivity): boolean {
  return entry.event_type === 'stock_change' || entry.event_type === 'inventory_import'
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
  const expanded = data?.entries.find((entry) => entry.id === expandedId) ?? null
  const sortedUsers = [...users].sort((a, b) => (a.display_name || a.email).localeCompare(b.display_name || b.email, 'pl'))
  const sortedItems = [...items].sort((a, b) => a.name.localeCompare(b.name, 'pl'))

  return (
    <Card
      title="Dziennik zapisanych akcji"
      subtitle="Zatwierdzone zmiany, importy i decyzje zapisane w audycie (bez pytań i odrzuconych kart)."
      busy={remote.loading}
      actions={
        <button type="button" onClick={() => void runExport()} disabled={exporting} className={secondaryButton}>
          {exporting ? 'Przygotowuję CSV…' : 'Eksport CSV'}
        </button>
      }
    >
      {exportError && (
        <p className="mt-4 border border-[#edc8c5] bg-[#fff7f6] px-4 py-3 text-sm text-[#8f3936]" role="alert">
          Eksport nieudany: {exportError} Zawęź daty lub filtry i spróbuj ponownie.
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <label className={labelClass}>
          Autor
          <select value={filters.actorId} onChange={(event) => setFilter('actorId', event.target.value)} className={inputClass}>
            <option value="">Wszyscy</option>
            <option value="unassigned">Bez przypisanego konta</option>
            {sortedUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.display_name || user.email}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Typ zdarzenia
          <select value={filters.eventType} onChange={(event) => setFilter('eventType', event.target.value)} className={inputClass}>
            <option value="">Wszystkie typy</option>
            {DASHBOARD_EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {eventLabel(type)}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Towar
          <select value={filters.itemId} onChange={(event) => setFilter('itemId', event.target.value)} className={inputClass}>
            <option value="">Wszystkie towary</option>
            {sortedItems.map((item) => (
              <option key={item.id} value={String(item.id)}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Status
          <select value={filters.status} onChange={(event) => setFilter('status', event.target.value as ActivityStatus)} className={inputClass}>
            <option value="all">Wszystkie</option>
            <option value="active">Aktywne</option>
            <option value="undone">Cofnięte</option>
            <option value="undo">Korekty cofające</option>
          </select>
        </label>
        <label className={labelClass}>
          Szukaj w nazwie
          <input
            type="search"
            value={queryInput}
            maxLength={MAX_QUERY_LENGTH}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder="np. kartony"
            className={inputClass}
          />
        </label>
      </div>

      {remote.error !== null && (
        <BlockError error={remote.error} fallback="Nie udało się pobrać dziennika." onRetry={remote.retry} kept={Boolean(data)} />
      )}
      {!data && remote.loading && <Loading text="Pobieram dziennik…" />}
      {data && data.entries.length === 0 && !remote.loading && <EmptyNote>Brak wpisów dla wybranego okresu i filtrów.</EmptyNote>}

      {data && data.entries.length > 0 && (
        <div className={'mt-4 overflow-x-auto border border-[#e8e5de] ' + (remote.loading ? 'opacity-60' : '')}>
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-[#e8e5de] bg-[#f8f7f3] text-[11px] font-semibold uppercase tracking-[0.1em] text-[#70756f]">
                <th scope="col" className="px-4 py-3">Czas</th>
                <th scope="col" className="px-4 py-3">Autor</th>
                <th scope="col" className="px-4 py-3">Typ</th>
                <th scope="col" className="px-4 py-3">Towar / temat</th>
                <th scope="col" className="px-4 py-3">Zmiana</th>
                <th scope="col" className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((entry) => {
                const open = expandedId === entry.id
                return (
                  <Fragment key={entry.id}>
                    <tr className="border-b border-[#f0efe9] align-top hover:bg-[#fbfaf7]">
                      <td className="whitespace-nowrap px-4 py-3">
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => setExpandedId(open ? null : entry.id)}
                          className="text-left font-semibold text-[#315b37] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56]"
                        >
                          {formatDateTime(entry.ts, timezone)}
                        </button>
                      </td>
                      <td className="max-w-[12rem] truncate px-4 py-3" title={entry.actor}>
                        {entry.actor || 'brak autora'}
                      </td>
                      <td className="px-4 py-3">{eventLabel(entry.event_type)}</td>
                      <td className="max-w-[14rem] truncate px-4 py-3 font-semibold" title={entry.item_name}>
                        {entry.item_name || '—'}
                      </td>
                      <td className="px-4 py-3">
                        {hasStockChange(entry) ? (
                          <span className="whitespace-nowrap tabular-nums">
                            {entry.before}→{entry.after}{' '}
                            <span className={'px-1.5 py-0.5 text-xs font-bold ' + (entry.delta < 0 ? 'bg-[#fdebec] text-[#8f3936]' : 'bg-[#edf3ec] text-[#315b37]')}>
                              {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                            </span>
                          </span>
                        ) : (
                          <span className="block max-w-[16rem] truncate text-[#646b64]" title={entry.details || entry.text}>
                            {entry.details || entry.text || '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`whitespace-nowrap px-2 py-0.5 text-xs font-bold ${STATUS_BADGE[entry.status] ?? STATUS_BADGE.active}`}>
                          {STATUS_LABELS[entry.status] ?? entry.status}
                        </span>
                      </td>
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {expanded && (
        <div className="mt-4 border border-[#cbd8c9] bg-[#fbfaf7] p-4" aria-live="polite">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="font-bold">Szczegóły wpisu #{expanded.id}</h3>
            <button type="button" onClick={() => setExpandedId(null)} className={secondaryButton}>
              Zamknij
            </button>
          </div>
          <EntryDetails key={expanded.id} entry={expanded} timezone={timezone} onUndo={onUndo} />
        </div>
      )}

      {data && data.total > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-[#646b64]">
          <p>
            Strona {data.page} z {pages} · {data.total} {data.total === 1 ? 'wpis' : 'wpisów'}
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1 || remote.loading} onClick={() => setPage((value) => Math.max(1, value - 1))} className={secondaryButton}>
              Poprzednia
            </button>
            <button type="button" disabled={!data.has_more || remote.loading} onClick={() => setPage((value) => value + 1)} className={secondaryButton}>
              Następna
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
    <div className="space-y-3 text-sm">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <Detail label="Wpis audytu" value={`#${entry.id} · ${formatDateTime(entry.ts, timezone, true)} (${timezone})`} />
        <Detail label="Autor" value={entry.actor_id ? `${entry.actor} (konto ${entry.actor_id})` : `${entry.actor || 'brak autora'} · bez przypisanego konta`} />
        <Detail label="Komenda / opis" value={entry.text || '—'} />
        <Detail label="Szczegóły" value={entry.details || '—'} />
        {entry.undo_of !== null && <Detail label="Korekta" value={`Cofa wpis #${entry.undo_of}`} />}
        {entry.undone_by !== null && <Detail label="Cofnięty" value={`Wpisem #${entry.undone_by}`} />}
      </dl>
      {undoable && !confirming && (
        <button type="button" onClick={() => setConfirming(true)} className={secondaryButton}>
          Cofnij
        </button>
      )}
      {undoable && confirming && (
        <div className="border border-[#ead9a9] bg-[#fffaf0] p-3" role="group" aria-label={`Potwierdź cofnięcie wpisu #${entry.id}`}>
          <p className="text-[#805c12]">
            Cofnąć zmianę? {entry.item_name} wróci z {entry.after} do {entry.before}. W dzienniku pojawi się nowy wpis — nic nie zniknie.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void undo()}
              disabled={busy}
              className="bg-[#315b37] px-4 py-2 text-sm font-semibold text-white hover:bg-[#274a2d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] disabled:opacity-40"
            >
              {busy ? 'Cofam…' : 'Tak, cofnij'}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={secondaryButton}>
              Anuluj
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="border border-[#edc8c5] bg-[#fff7f6] p-3 text-[#8f3936]" role="alert">
          Nie cofnięto zmiany: {error}
        </p>
      )}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className={labelClass}>{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap break-words text-[#454b46]">{value}</dd>
    </div>
  )
}
