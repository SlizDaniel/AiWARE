'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import CommandPanel, { type PendingChange } from './CommandPanel'
import ManagerDashboard from './dashboard/ManagerDashboard'
import HistoryList from './HistoryList'
import InventoryExport from './InventoryExport'
import InventoryImport from './InventoryImport'
import ProcedureList from './ProcedureList'
import ReorderQueue from './ReorderQueue'
import { confirmationMessage } from './reorderMessages'
import { PendingApprovalScreen, StartupScreen } from './SessionScreens'
import SettingsPanel from './SettingsPanel'
import Sidebar, { type NavBadge } from './Sidebar'
import StatusBanner from './StatusBanner'
import StockTable from './StockTable'
import WarehouseMap from './WarehouseMap'
import { UploadIcon } from './ui/icons'
import { StateShape } from './ui/StateMark'
import { buttonClass } from './ui/styles'
import { countDeviations } from './ui/stockLevel'
import {
  fetchHealth,
  fetchHistory,
  fetchMe,
  fetchProcedures,
  fetchReorderDrafts,
  fetchSettings,
  fetchStock,
  fetchZones,
  ApiError,
  onApiForbidden,
  undoHistoryEntry,
  updateStockItem,
  type AppSettings,
  type Health,
  type HistoryEntry,
  type Item,
  type Me,
  type Procedure,
  type ReorderDraft,
  type Role,
  type Zone,
} from '@/lib/api'
import type { SectionId } from '@/lib/sections'
import { speak, stopSpeaking } from '@/lib/tts'
import { subscribeUpdates } from '@/lib/updates'
import { zoneForItem, type MapTarget } from './zoneItems'

const SECTION_TITLES: Record<SectionId, { title: string; subtitle: string }> = {
  mapa: { title: 'Mapa magazynu', subtitle: 'Schematyczny rzut hal i stref' },
  stany: { title: 'Stany magazynowe', subtitle: 'Aktualne ilości pozycji w bazie' },
  kolejka: { title: 'Kolejka zatwierdzeń', subtitle: 'Szkice zamówień i propozycje agenta' },
  historia: { title: 'Historia zmian', subtitle: 'Audyt: kto, kiedy i co zmienił' },
  procedury: { title: 'Procedury', subtitle: 'Wiedza „jak u nas na hali”' },
  dashboard: { title: 'Dashboard kierownika', subtitle: 'Stan teraz, operacje w okresie, dziennik akcji i przekazanie zmiany' },
  ustawienia: { title: 'Ustawienia', subtitle: 'Agent, konta, użycie AI i baza danych' },
}

type LoadState = 'loading' | 'ready' | 'error'
type Toast = { message: string; tone: 'ok' | 'error' }

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback
}

/** Zasób pobierany z API: dane + stan ładowania + komunikat błędu. Stan ustawiany tylko w callbackach obietnicy. */
function useLoader<T>(load: () => Promise<T>, initial: T, fallbackError: string) {
  const [data, setData] = useState<T>(initial)
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState('')
  const reload = useCallback(
    () =>
      load().then(
        (value) => {
          setData(value)
          setState('ready')
          setError('')
        },
        (reason: unknown) => {
          setState('error')
          setError(errorMessage(reason, fallbackError))
        },
      ),
    [load, fallbackError],
  )
  const markLoading = useCallback(() => setState('loading'), [])
  return { data, setData, state, error, reload, markLoading }
}

/** Komunikat 403 dla konta, które czeka na zatwierdzenie (wtedy pokazujemy ekran oczekiwania). */
const PENDING_DETAIL = /czeka na zatwierdzenie/i

/**
 * Najpierw /api/me: konto oczekujące dostaje tylko ekran oczekiwania — bez pobierania danych,
 * pollingu i mikrofonu. Pozostali (także przy błędzie /api/me) — pełna aplikacja.
 */
export default function AppShell() {
  const [session, setSession] = useState<{ loaded: boolean; me: Me | null }>({ loaded: false, me: null })

  const reloadMe = useCallback(
    () =>
      fetchMe().then(
        (me) => setSession({ loaded: true, me }),
        (reason: unknown) => {
          // 401 → trwa przekierowanie do /login; inne błędy → aplikacja z ograniczeniami
          if (reason instanceof ApiError && reason.status === 401) return
          setSession((current) => ({ loaded: true, me: current.me }))
        },
      ),
    [],
  )

  useEffect(() => {
    void reloadMe()
  }, [reloadMe])

  if (!session.loaded) return <StartupScreen />
  if (session.me?.user?.role === 'oczekujacy') return <PendingApprovalScreen me={session.me} onCheck={reloadMe} />
  return <Workspace me={session.me} onReloadMe={reloadMe} />
}

function Workspace({ me, onReloadMe }: { me: Me | null; onReloadMe: () => Promise<unknown> }) {
  const [section, setSection] = useState<SectionId>('stany')
  const stock = useLoader<Item[]>(fetchStock, [], 'Nie udało się pobrać stanów magazynowych.')
  const zones = useLoader<Zone[]>(fetchZones, [], 'Nie udało się pobrać stref magazynu.')
  const history = useLoader<HistoryEntry[]>(fetchHistory, [], 'Nie udało się pobrać historii zmian.')
  const queue = useLoader<ReorderDraft[]>(fetchReorderDrafts, [], 'Nie udało się pobrać kolejki zatwierdzeń.')
  const procedures = useLoader<Procedure[]>(fetchProcedures, [], 'Nie udało się pobrać procedur.')
  const settings = useLoader<AppSettings | null>(
    fetchSettings,
    null,
    'Nie udało się pobrać konfiguracji. Odśwież stronę lub sprawdź połączenie.',
  )
  const [mapTarget, setMapTarget] = useState<MapTarget | null>(null)
  const [mapSelectionId, setMapSelectionId] = useState<number | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [healthError, setHealthError] = useState('')
  // null = domyślnie (otwarty dla źródła „import pliku” i pustego magazynu); true/false = wybór użytkownika
  const [importOverride, setImportOverride] = useState<boolean | null>(null)
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null)
  const [connected, setConnected] = useState(false)
  // rośnie przy każdej zmianie danych na serwerze (polling /api/version) — odświeża dashboard
  const [updateTick, setUpdateTick] = useState(0)
  const [toast, setToast] = useState<Toast | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const { reload: reloadStock, markLoading: markStockLoading } = stock
  const { reload: reloadZones, markLoading: markZonesLoading } = zones
  const { reload: reloadHistory } = history
  const { reload: reloadQueue } = queue
  const { reload: reloadProcedures } = procedures
  const { reload: reloadSettings, setData: setSettings } = settings

  // Ustawienia też tu: polling /api/version odświeża tryb agenta, prefix i tryb głosu u wszystkich.
  const refresh = useCallback(() => {
    void reloadStock()
    void reloadZones()
    void reloadHistory()
    void reloadQueue()
    void reloadProcedures()
    void reloadSettings()
  }, [reloadHistory, reloadProcedures, reloadQueue, reloadSettings, reloadStock, reloadZones])

  // Dane magazynu + odświeżanie na żywo (polling /api/version zamiast WebSocketu).
  useEffect(() => {
    refresh()
    return subscribeUpdates(() => {
      refresh()
      setUpdateTick((value) => value + 1)
    }, setConnected)
  }, [refresh])

  // Konfiguracja serwera — raz po wejściu.
  useEffect(() => {
    let alive = true
    fetchHealth().then(
      (value) => {
        if (alive) setHealth(value)
      },
      (reason: unknown) => {
        if (alive) setHealthError(errorMessage(reason, 'Serwer nie odpowiada.'))
      },
    )
    return () => {
      alive = false
    }
  }, [])

  const showToast = useCallback((message: string, tone: Toast['tone'] = 'ok') => {
    setToast({ message, tone })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), tone === 'error' ? 6000 : 4000)
  }, [])

  // 403 z dowolnego wywołania API (brak uprawnień roli) → komunikat serwera w toaście.
  // Konto zablokowane w trakcie pracy („czeka na zatwierdzenie”) → sprawdzamy rolę i pokazujemy ekran oczekiwania.
  useEffect(
    () =>
      onApiForbidden((detail) => {
        if (PENDING_DETAIL.test(detail)) void onReloadMe()
        else showToast(detail, 'error')
      }),
    [onReloadMe, showToast],
  )

  const authMode = me?.auth_mode ?? health?.auth_mode ?? null
  // Bez logowania (tryb lokalny) serwer traktuje każdego jak kierownika.
  const role: Role | null = me?.user?.role ?? (authMode === 'disabled' ? 'kierownik' : null)
  const canManage = role === 'kierownik'
  // dashboard tylko dla kierownika: bez roli (lub po jej utracie) pokazujemy Stany, a panel się odmontowuje
  const visibleSection: SectionId = section === 'dashboard' && !canManage ? 'stany' : section
  const ttsEnabled = settings.data?.tts_enabled === true && !settings.data.mode_status.demo_mode

  useEffect(() => {
    if (!ttsEnabled) stopSpeaking()
    return stopSpeaking
  }, [ttsEnabled])

  const say = useCallback(
    (text: string) => {
      if (ttsEnabled) speak(text)
    },
    [ttsEnabled],
  )

  const onApplied = (summary: string, reorderDraft: ReorderDraft | null) => {
    const message = confirmationMessage(summary, reorderDraft)
    showToast(message)
    say(message)
    refresh()
  }

  const onQueueChanged = (message: string) => {
    showToast(message)
    refresh()
  }

  const onUndo = async (entry: HistoryEntry) => {
    const result = await undoHistoryEntry(entry.id)
    const change = `${result.item_name} ${result.before}→${result.after}`
    showToast(
      result.reorder_draft
        ? `Cofnięto wpis #${result.undo_of}: ${change} · szkic zamówienia ${result.reorder_draft.quantity} ${result.reorder_draft.unit} w kolejce`
        : `Cofnięto wpis #${result.undo_of}: ${change} · nowy wpis w historii`,
    )
    refresh()
  }

  const showZone = (id: number) => {
    setMapTarget(null)
    setMapSelectionId(id)
    setSection('mapa')
  }

  // 403 z dashboardu: uprawnienia odebrane — wracamy do Stanów i odświeżamy rolę
  const onDashboardForbidden = useCallback(() => {
    setSection('stany')
    void onReloadMe()
  }, [onReloadMe])

  const heading = SECTION_TITLES[visibleSection]
  const importOpen =
    canManage &&
    (importOverride ?? (settings.data?.adapter === 'file_import' || (stock.state === 'ready' && stock.data.length === 0)))
  const deviations = countDeviations(stock.data)
  const pendingDrafts = queue.data.filter((draft) => draft.status === 'pending').length
  const lowTotal = deviations.empty + deviations.below
  const badges: Partial<Record<SectionId, NavBadge>> = {
    stany: {
      count: lowTotal,
      kind: deviations.empty > 0 ? 'alarm' : 'warn',
      label: `${lowTotal} poniżej minimum`,
    },
    kolejka: { count: pendingDrafts, kind: 'decision', label: `${pendingDrafts} czeka na decyzję` },
  }

  return (
    <div className="min-h-screen bg-ground text-ink lg:flex lg:h-screen lg:overflow-hidden">
      <Sidebar
        current={visibleSection}
        onNavigate={setSection}
        connected={connected}
        user={me?.user ?? null}
        authMode={authMode}
        canManage={canManage}
        badges={badges}
      />

      <main className="min-w-0 flex-1 lg:overflow-y-auto xl:grid xl:grid-cols-[minmax(0,1fr)_22rem] xl:grid-rows-[auto_1fr] 2xl:grid-cols-[minmax(0,1fr)_26rem]">
        <header className="px-5 pb-6 pt-7 sm:px-8 xl:col-start-1 xl:row-start-1 xl:pt-9 2xl:px-12">
          <div className="mx-auto flex max-w-[1180px] flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <div className="min-w-0">
              <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.015em] text-ink sm:text-[32px]">{heading.title}</h1>
              <p className="mt-1.5 text-[15px] text-ink-2">{heading.subtitle}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StateChips
                empty={deviations.empty}
                below={deviations.below}
                pendingDrafts={pendingDrafts}
                ready={stock.state === 'ready'}
                localMode={authMode === 'disabled'}
                onNavigate={setSection}
              />
            </div>
          </div>
        </header>

        <aside
          aria-label="Agent głosowy"
          className="mx-4 mb-6 rounded-lg border border-line bg-sheet sm:mx-8 xl:sticky xl:top-0 xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:m-0 xl:h-screen xl:overflow-y-auto xl:rounded-none xl:border-0 xl:border-l"
        >
          <CommandPanel
            onApplied={onApplied}
            zones={zones.data}
            items={stock.data}
            onShowZone={showZone}
            onShowLocation={(target) => {
              setMapTarget({ ...target })
              setMapSelectionId(null)
              markZonesLoading()
              markStockLoading()
              void reloadZones()
              void reloadStock()
              setSection('mapa')
            }}
            settings={settings.data}
            settingsError={settings.state === 'error' ? settings.error : ''}
            onSettingsChanged={reloadSettings}
            showModeControl={visibleSection !== 'ustawienia'}
            canChangeMode={canManage}
            onSpeak={say}
            onPendingChange={setPendingChange}
          />
        </aside>

        <div className="min-w-0 px-4 pb-16 sm:px-8 xl:col-start-1 xl:row-start-2 2xl:px-12">
          <div className="mx-auto max-w-[1180px] space-y-6">
            <StatusBanner storage={health?.storage ?? null} authMode={authMode} />
            {visibleSection === 'stany' && importOpen && (
              <InventoryImport onImported={refresh} onClose={() => setImportOverride(false)} />
            )}

            {visibleSection === 'mapa' && (
              <WarehouseMap
                zones={zones.data}
                items={stock.data}
                locationTarget={mapTarget}
                selectedId={mapSelectionId ?? (mapTarget ? zoneForItem(mapTarget, zones.data)?.id ?? null : null)}
                onSelectZone={setMapSelectionId}
                state={zones.state}
                error={zones.error}
                onRetry={() => void reloadZones()}
                itemsState={stock.state}
                onRetryItems={() => void reloadStock()}
                onZoneAdded={(name, created) => {
                  showToast(created ? `Dodano strefę: ${name}` : `Strefa „${name}” już istnieje`)
                  refresh()
                }}
              />
            )}

            {visibleSection === 'stany' && (
              <StockTable
                items={stock.data}
                state={stock.state}
                error={stock.error}
                onRetry={() => void reloadStock()}
                canManage={canManage}
                pending={pendingChange}
                toolbar={
                  <>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => setImportOverride(!importOpen)}
                        aria-expanded={importOpen}
                        className={buttonClass(importOpen ? 'ghost' : 'secondary', 'sm')}
                      >
                        <UploadIcon size={16} />
                        {importOpen ? 'Zamknij import' : 'Importuj plik'}
                      </button>
                    )}
                    <InventoryExport />
                  </>
                }
                onSave={async (id, changes) => {
                  const item = await updateStockItem(id, changes)
                  showToast(`Zapisano produkt: ${item.name}`)
                  refresh()
                }}
              />
            )}

            {visibleSection === 'historia' && (
              <HistoryList
                entries={history.data}
                state={history.state}
                error={history.error}
                onRetry={() => void reloadHistory()}
                canUndo={canManage}
                onUndo={onUndo}
                onOpenFullLog={canManage ? () => setSection('dashboard') : undefined}
              />
            )}

            {visibleSection === 'kolejka' && (
              <ReorderQueue
                drafts={queue.data}
                state={queue.state}
                error={queue.error}
                onRetry={() => void reloadQueue()}
                onChanged={onQueueChanged}
                canDecide={canManage}
              />
            )}

            {visibleSection === 'procedury' && (
              <ProcedureList
                procedures={procedures.data}
                state={procedures.state}
                error={procedures.error}
                onRetry={() => void reloadProcedures()}
                zones={zones.data}
                items={stock.data}
                onShowZone={showZone}
              />
            )}

            {visibleSection === 'dashboard' && canManage && (
              <ManagerDashboard
                updateTick={updateTick}
                items={stock.data}
                onNavigate={setSection}
                onForbidden={onDashboardForbidden}
                onUndo={onUndo}
              />
            )}

            {visibleSection === 'ustawienia' && (
              <SettingsPanel
                canManage={canManage}
                me={me}
                health={health}
                healthError={healthError}
                settings={settings.data}
                settingsState={settings.state}
                settingsError={settings.error}
                onRetrySettings={() => void reloadSettings()}
                onSettingsSaved={setSettings}
                onOpenImport={() => {
                  setImportOverride(true)
                  setSection('stany')
                }}
                onToast={(message) => showToast(message)}
              />
            )}
          </div>
        </div>
      </main>

      {toast && (
        <div
          key={toast.message}
          className="fixed inset-x-4 bottom-5 z-30 flex animate-arrive items-start gap-3 rounded-lg bg-ink px-4 py-3 text-sm font-medium text-sheet shadow-raise sm:inset-x-auto sm:left-8 sm:max-w-md lg:left-[calc(15rem+2rem)]"
          role={toast.tone === 'error' ? 'alert' : 'status'}
        >
          <StateShape kind={toast.tone === 'error' ? 'alarm' : 'ok'} className="mt-[5px]" />
          {toast.message}
        </div>
      )}
    </div>
  )
}

/**
 * Podsumowanie odchyleń w nagłówku (jak pasek alarmów na ekranie operatorskim): tylko to, co odbiega
 * od normy albo czeka na człowieka. Kliknięcie prowadzi do sekcji, w której to się załatwia.
 */
function StateChips({
  empty,
  below,
  pendingDrafts,
  ready,
  localMode,
  onNavigate,
}: {
  empty: number
  below: number
  pendingDrafts: number
  ready: boolean
  localMode: boolean
  onNavigate: (section: SectionId) => void
}) {
  const chip =
    'inline-flex h-8 items-center gap-2 rounded-full bg-sheet px-3 text-[13px] font-semibold ring-1 ring-line transition-shadow hover:ring-line-strong'
  const calm = ready && empty === 0 && below === 0 && pendingDrafts === 0
  return (
    <>
      {empty > 0 && (
        <button type="button" onClick={() => onNavigate('stany')} className={`${chip} text-alarm-ink`}>
          <StateShape kind="alarm" />
          <span className="tabular-nums">{empty}</span> {empty === 1 ? 'brak towaru' : 'braki towaru'}
        </button>
      )}
      {below > 0 && (
        <button type="button" onClick={() => onNavigate('stany')} className={`${chip} text-warn-ink`}>
          <StateShape kind="warn" />
          <span className="tabular-nums">{below}</span> poniżej minimum
        </button>
      )}
      {pendingDrafts > 0 && (
        <button type="button" onClick={() => onNavigate('kolejka')} className={`${chip} text-act-ink`}>
          <StateShape kind="decision" />
          <span className="tabular-nums">{pendingDrafts}</span> {pendingDrafts === 1 ? 'szkic czeka' : 'szkice czekają'}
        </button>
      )}
      {calm && (
        <span className="inline-flex h-8 items-center gap-2 px-1 text-[13px] font-medium text-ink-2">
          <StateShape kind="idle" />
          Bez odchyleń
        </span>
      )}
      {localMode && <span className="inline-flex h-8 items-center px-1 text-xs text-mute">Tryb lokalny bez logowania</span>}
    </>
  )
}
