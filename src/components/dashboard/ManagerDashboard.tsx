import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { fetchUsers, type HistoryEntry, type Item, type UserAccount } from '@/lib/api'
import type { DashboardResponse } from '@/lib/dashboard'
import { customRangeError, fetchDashboard, type PeriodSelection, type PresetPeriod } from '@/lib/dashboardApi'
import type { SectionId } from '@/lib/sections'
import { Notice } from '../ui/feedback'
import { RefreshIcon } from '../ui/icons'
import { buttonClass, panelClass, segmentClass, segmentGroupClass } from '../ui/styles'
import DashboardActivityLog from './DashboardActivity'
import DashboardAttention from './DashboardAttention'
import ManagerNotifications from './ManagerNotifications'
import { ActivityCharts, SummaryTiles } from './DashboardSummary'
import ShiftSummary from './ShiftSummary'
import StockTrend from './StockTrend'
import { BlockError, Field, inputClass, Loading } from './ui'
import { useRemote } from './useRemote'

/** Co tyle odświeżamy dashboard także bez zapisu w bazie (odznaki szkiców, okno „ostatnie 8 h”). */
const AUTO_REFRESH_MS = 60_000
const PRESETS: { id: PresetPeriod; label: string }[] = [
  { id: 'today', label: 'Dziś' },
  { id: '7d', label: '7 dni' },
  { id: '30d', label: '30 dni' },
]

/** Dolny panel: jeden widok szczegółów naraz (jedno zadanie na widok). */
type DetailView = 'log' | 'shift'
const DETAIL_VIEWS: { id: DetailView; label: string }[] = [
  { id: 'log', label: 'Dziennik akcji' },
  { id: 'shift', label: 'Przekazanie zmiany' },
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

/** Godzina pobrania w strefie magazynu (HH:MM). */
function clock(ms: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('pl-PL', { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(ms))
  } catch {
    return new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' }).format(new Date(ms))
  }
}

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
  const [detailView, setDetailView] = useState<DetailView>('log')
  const trendRef = useRef<HTMLDivElement>(null)
  const tabsId = useId()

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

  const tabId = (view: DetailView) => `${tabsId}-${view}-tab`
  const panelId = (view: DetailView) => `${tabsId}-${view}-panel`

  // strzałki między zakładkami (wzorzec ARIA tabs); aktywna zakładka jest jedynym przystankiem Tab
  const onTabsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
    if (!keys.includes(event.key)) return
    event.preventDefault()
    const index = DETAIL_VIEWS.findIndex((view) => view.id === detailView)
    const last = DETAIL_VIEWS.length - 1
    const nextIndex =
      event.key === 'Home' ? 0 : event.key === 'End' ? last : (index + (event.key === 'ArrowRight' ? 1 : -1) + DETAIL_VIEWS.length) % DETAIL_VIEWS.length
    const next = DETAIL_VIEWS[nextIndex].id
    setDetailView(next)
    document.getElementById(tabId(next))?.focus()
  }

  const data = summary.data
  return (
    <div className="@container space-y-6">
      <ManagerNotifications refreshToken={refreshToken} onNavigate={onNavigate} onForbidden={onForbidden} />
      {/* A: okres, odświeżanie, czas pobrania — cienki pasek nad wszystkim, czego dotyczy */}
      <section className="space-y-4" aria-label="Okres i odświeżanie">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className={segmentGroupClass} role="group" aria-label="Okres">
            {PRESETS.map((preset) => {
              const active = period.kind === 'preset' && period.period === preset.id
              return (
                <button key={preset.id} type="button" aria-pressed={active} onClick={() => choosePreset(preset.id)} className={segmentClass(active)}>
                  {preset.label}
                </button>
              )
            })}
            <button
              type="button"
              aria-pressed={period.kind === 'custom'}
              aria-expanded={customOpen}
              onClick={() => setCustomOpen((open) => !open)}
              className={segmentClass(period.kind === 'custom')}
            >
              Własny
            </button>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-[13px] tabular-nums text-mute" aria-live="polite">
              {summary.loading ? 'Odświeżam…' : summary.fetchedAt ? `Pobrano ${clock(summary.fetchedAt, timezone)}` : ''}
            </p>
            <button
              type="button"
              onClick={() => setManualTick((value) => value + 1)}
              disabled={summary.loading}
              className={buttonClass('ghost', 'sm')}
            >
              <RefreshIcon size={16} />
              Odśwież
            </button>
          </div>
        </div>

        {customOpen && (
          <form
            className={`${panelClass} grid gap-4 px-6 py-5 @2xl:grid-cols-[minmax(0,14rem)_minmax(0,14rem)_auto] @2xl:items-end`}
            onSubmit={(event) => {
              event.preventDefault()
              applyCustom()
            }}
          >
            <Field label="Od (dzień)">
              <input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className={inputClass} required />
            </Field>
            <Field label="Do (dzień, włącznie)">
              <input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className={inputClass} required />
            </Field>
            <button type="submit" className={buttonClass('primary', 'md') + ' @2xl:justify-self-start'}>
              Zastosuj
            </button>
            <p className="text-xs text-mute @2xl:col-span-3">Dni kalendarzowe w strefie magazynu {timezone}; najwyżej 366 dni.</p>
            {customError && (
              <Notice tone="alarm" role="alert" className="@2xl:col-span-3">
                {customError}
              </Notice>
            )}
          </form>
        )}
      </section>

      {summary.error !== null && (
        <BlockError error={summary.error} fallback="Nie udało się pobrać podsumowania dashboardu." onRetry={summary.retry} kept={Boolean(data)} />
      )}
      {!data && summary.loading && (
        <div className={`${panelClass} p-6`}>
          <Loading text="Pobieram podsumowanie…" />
        </div>
      )}
      {data && (
        <div className={'space-y-6 transition-opacity duration-200 ' + (summary.loading && summary.stale ? 'opacity-60' : '')}>
          <SummaryTiles data={data} />
          {/* odchylenia najpierw, potem przebieg okresu */}
          <DashboardAttention data={data} onNavigate={onNavigate} />
          <ActivityCharts data={data} onShowTrend={showTrend} />
        </div>
      )}

      {/* trend z linią minimum jest wykresem — widoczny od razu, nie za zakładką */}
      <div ref={trendRef} className="scroll-mt-6">
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

      {/* E–G: jeden panel, jeden widok naraz; ukryte widoki zostają zamontowane (filtry i strona dziennika nie giną) */}
      <section className={panelClass} aria-label="Dziennik akcji i przekazanie zmiany">
        <div className="border-b border-line px-6 py-4">
          <div role="tablist" aria-label="Widok" className={segmentGroupClass} onKeyDown={onTabsKeyDown}>
            {DETAIL_VIEWS.map((view) => {
              const active = view.id === detailView
              return (
                <button
                  key={view.id}
                  id={tabId(view.id)}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={panelId(view.id)}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setDetailView(view.id)}
                  className={segmentClass(active)}
                >
                  {view.label}
                </button>
              )
            })}
          </div>
        </div>

        <div role="tabpanel" id={panelId('log')} aria-labelledby={tabId('log')} hidden={detailView !== 'log'}>
          <DashboardActivityLog
            period={period}
            periodKey={periodKey}
            refreshToken={refreshToken}
            updateTick={updateTick}
            users={users.data ?? []}
            items={items}
            onForbidden={onForbidden}
            onUndo={onUndo}
            embedded
          />
        </div>
        <div role="tabpanel" id={panelId('shift')} aria-labelledby={tabId('shift')} hidden={detailView !== 'shift'}>
          <ShiftSummary refreshToken={refreshToken} timezone={timezone} onForbidden={onForbidden} embedded />
        </div>
      </section>
    </div>
  )
}
