import { useEffect, useRef, useState } from 'react'
import { fetchUsers, type HistoryEntry, type Item, type UserAccount } from '@/lib/api'
import type { DashboardResponse } from '@/lib/dashboard'
import { customRangeError, fetchDashboard, formatDateTime, type PeriodSelection, type PresetPeriod } from '@/lib/dashboardApi'
import type { SectionId } from '@/lib/sections'
import DashboardActivityLog from './DashboardActivity'
import DashboardAttention from './DashboardAttention'
import ManagerNotifications from './ManagerNotifications'
import { ActivityCharts, SummaryTiles } from './DashboardSummary'
import ShiftSummary from './ShiftSummary'
import StockTrend from './StockTrend'
import { BlockError, cardClass, inputClass, labelClass, Loading, secondaryButton } from './ui'
import { useRemote } from './useRemote'

/** Co tyle odświeżamy dashboard także bez zapisu w bazie (odznaki szkiców, okno „ostatnie 8 h”). */
const AUTO_REFRESH_MS = 60_000
const PRESETS: { id: PresetPeriod; label: string }[] = [
  { id: 'today', label: 'Dziś' },
  { id: '7d', label: '7 dni' },
  { id: '30d', label: '30 dni' },
]

type Props = {
  /** licznik zmian danych z pollingu /api/version (AppShell) */
  updateTick: number
  items: Item[]
  onNavigate: (section: SectionId) => void
  /** 403 — rola odebrana: wracamy do dozwolonej sekcji */
  onForbidden: () => void
  onUndo: (entry: HistoryEntry) => Promise<void>
}

const segment = (active: boolean) =>
  'border px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] ' +
  (active ? 'border-[#315b37] bg-[#315b37] text-white' : 'border-[#d8d6cf] bg-white text-[#646b64] hover:bg-[#f8f7f3]')

/** Dashboard kierownika (renderowany wyłącznie dla roli kierownik). */
export default function ManagerDashboard({ updateTick, items, onNavigate, onForbidden, onUndo }: Props) {
  const [period, setPeriod] = useState<PeriodSelection>({ kind: 'preset', period: '7d' })
  const [customOpen, setCustomOpen] = useState(false)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [customError, setCustomError] = useState('')
  const [manualTick, setManualTick] = useState(0)
  const [timerTick, setTimerTick] = useState(0)
  const [trendItemId, setTrendItemId] = useState<number | null>(null)
  const trendRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setTimerTick((value) => value + 1)
    }, AUTO_REFRESH_MS)
    return () => clearInterval(timer)
  }, [])

  const refreshToken = `${updateTick}:${manualTick}:${timerTick}`
  const periodKey = JSON.stringify(period)
  const summary = useRemote<DashboardResponse>((signal) => fetchDashboard(period, signal), periodKey, refreshToken, onForbidden)
  // lista kont do filtra autorów; błąd nie blokuje dziennika (zostają „Wszyscy” / „Bez przypisanego konta”)
  const users = useRemote<UserAccount[]>(() => fetchUsers(), 'users', 0)
  const timezone = summary.data?.range.timezone ?? 'Europe/Warsaw'

  const choosePreset = (preset: PresetPeriod) => {
    setCustomOpen(false)
    setCustomError('')
    setPeriod({ kind: 'preset', period: preset })
  }

  const applyCustom = () => {
    const error = customRangeError(customFrom, customTo)
    if (error) {
      setCustomError(error)
      return
    }
    setCustomError('')
    setPeriod({ kind: 'custom', from: customFrom, to: customTo })
  }

  const showTrend = (itemId: number) => {
    setTrendItemId(itemId)
    trendRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const data = summary.data
  return (
    <div className="space-y-5">
      <ManagerNotifications refreshToken={refreshToken} onNavigate={onNavigate} onForbidden={onForbidden} />
      {/* A: okres, odświeżanie, czas pobrania */}
      <section className={cardClass} aria-label="Okres i odświeżanie">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex" role="group" aria-label="Okres">
              {PRESETS.map((preset, index) => (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={period.kind === 'preset' && period.period === preset.id}
                  onClick={() => choosePreset(preset.id)}
                  className={segment(period.kind === 'preset' && period.period === preset.id) + (index ? ' -ml-px' : '')}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={period.kind === 'custom'}
                aria-expanded={customOpen}
                onClick={() => setCustomOpen((open) => !open)}
                className={segment(period.kind === 'custom') + ' -ml-px'}
              >
                Własny
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-[#70756f]" aria-live="polite">
              {summary.loading
                ? 'Odświeżam…'
                : summary.fetchedAt
                  ? `Pobrano ${formatDateTime(new Date(summary.fetchedAt).toISOString(), timezone, true)}`
                  : ''}
            </p>
            <button type="button" onClick={() => setManualTick((value) => value + 1)} disabled={summary.loading} className={secondaryButton}>
              Odśwież
            </button>
          </div>
        </div>
        {customOpen && (
          <form
            className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            onSubmit={(event) => {
              event.preventDefault()
              applyCustom()
            }}
          >
            <label className={labelClass}>
              Od (dzień)
              <input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className={inputClass} required />
            </label>
            <label className={labelClass}>
              Do (dzień, włącznie)
              <input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className={inputClass} required />
            </label>
            <button type="submit" className={secondaryButton}>
              Zastosuj
            </button>
            <p className="text-xs text-[#70756f] sm:col-span-3">Dni kalendarzowe w strefie magazynu {timezone}; najwyżej 366 dni.</p>
            {customError && (
              <p className="border border-[#edc8c5] bg-[#fff7f6] px-4 py-3 text-sm text-[#8f3936] sm:col-span-3" role="alert">
                {customError}
              </p>
            )}
          </form>
        )}
      </section>

      {summary.error !== null && (
        <BlockError error={summary.error} fallback="Nie udało się pobrać podsumowania dashboardu." onRetry={summary.retry} kept={Boolean(data)} />
      )}
      {!data && summary.loading && (
        <section className={cardClass}>
          <Loading text="Pobieram podsumowanie…" />
        </section>
      )}
      {data && (
        <div className={'space-y-5 ' + (summary.loading && summary.stale ? 'opacity-60' : '')}>
          <SummaryTiles data={data} />
          <ActivityCharts data={data} onShowTrend={showTrend} />
          <DashboardAttention data={data} onNavigate={onNavigate} />
        </div>
      )}

      <DashboardActivityLog
        period={period}
        periodKey={periodKey}
        refreshToken={refreshToken}
        updateTick={updateTick}
        users={users.data ?? []}
        items={items}
        onForbidden={onForbidden}
        onUndo={onUndo}
      />

      <div className="grid gap-5 xl:grid-cols-2">
        <ShiftSummary refreshToken={refreshToken} timezone={timezone} onForbidden={onForbidden} />
        <div ref={trendRef} className="min-w-0 scroll-mt-4">
          <StockTrend
            items={items}
            itemId={trendItemId}
            onItemChange={setTrendItemId}
            period={period}
            periodKey={periodKey}
            refreshToken={refreshToken}
            onForbidden={onForbidden}
          />
        </div>
      </div>
    </div>
  )
}
