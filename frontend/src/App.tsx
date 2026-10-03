import { useCallback, useEffect, useRef, useState } from 'react'
import CommandPanel from './components/CommandPanel'
import HistoryList from './components/HistoryList'
import InventoryExport from './components/InventoryExport'
import InventoryImport from './components/InventoryImport'
import Placeholder from './components/Placeholder'
import ProcedureList from './components/ProcedureList'
import ReorderQueue from './components/ReorderQueue'
import Sidebar from './components/Sidebar'
import StockTable from './components/StockTable'
import WarehouseMap from './components/WarehouseMap'
import { connectWs, fetchHistory, fetchProcedures, fetchReorderDrafts, fetchStock, fetchZones, type HistoryEntry, type Item, type Procedure, type ReorderDraft, type Zone } from './api'
import { SECTIONS, type SectionId } from './sections'

const PLACEHOLDER_NOTES: Partial<Record<SectionId, string>> = {
  ustawienia: 'Prefix agenta, adapter danych, progi, tryb głosu — karta 09.',
}

const SECTION_TITLES: Record<SectionId, { title: string; subtitle: string }> = {
  mapa: { title: 'Mapa magazynu', subtitle: 'Schematyczny rzut hal i stref' },
  stany: { title: 'Stany magazynowe', subtitle: 'Aktualne ilości pozycji w bazie' },
  kolejka: { title: 'Kolejka zatwierdzeń', subtitle: 'Szkice zamówień i propozycje agenta' },
  historia: { title: 'Historia zmian', subtitle: 'Audyt: kto, kiedy i co zmienił' },
  procedury: { title: 'Procedury', subtitle: 'Wiedza „jak u nas na hali”' },
  ustawienia: { title: 'Ustawienia', subtitle: 'Konfiguracja agenta i adapterów' },
}

type LoadState = 'loading' | 'ready' | 'error'

export default function App() {
  const [section, setSection] = useState<SectionId>('stany')
  const [items, setItems] = useState<Item[]>([])
  const [stockState, setStockState] = useState<LoadState>('loading')
  const [stockError, setStockError] = useState('')
  const [zones, setZones] = useState<Zone[]>([])
  const [zonesState, setZonesState] = useState<LoadState>('loading')
  const [zonesError, setZonesError] = useState('')
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [historyState, setHistoryState] = useState<LoadState>('loading')
  const [historyError, setHistoryError] = useState('')
  const [drafts, setDrafts] = useState<ReorderDraft[]>([])
  const [queueState, setQueueState] = useState<LoadState>('loading')
  const [queueError, setQueueError] = useState('')
  const [procedures, setProcedures] = useState<Procedure[]>([])
  const [proceduresState, setProceduresState] = useState<LoadState>('loading')
  const [proceduresError, setProceduresError] = useState('')
  const [selectedZoneId, setSelectedZoneId] = useState<number | null>(null)
  const [connected, setConnected] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const refreshStock = useCallback(async () => {
    try {
      setItems(await fetchStock())
      setStockState('ready')
      setStockError('')
    } catch (error) {
      setStockState('error')
      setStockError(error instanceof Error ? error.message : 'Nie udało się pobrać stanów magazynowych.')
    }
  }, [])

  const refreshZones = useCallback(async () => {
    try {
      setZones(await fetchZones())
      setZonesState('ready')
      setZonesError('')
    } catch (error) {
      setZonesState('error')
      setZonesError(error instanceof Error ? error.message : 'Nie udało się pobrać stref magazynu.')
    }
  }, [])

  const refreshHistory = useCallback(async () => {
    try {
      setEntries(await fetchHistory())
      setHistoryState('ready')
      setHistoryError('')
    } catch (error) {
      setHistoryState('error')
      setHistoryError(error instanceof Error ? error.message : 'Nie udało się pobrać historii zmian.')
    }
  }, [])

  const refreshQueue = useCallback(async () => {
    try {
      setDrafts(await fetchReorderDrafts())
      setQueueState('ready')
      setQueueError('')
    } catch (error) {
      setQueueState('error')
      setQueueError(error instanceof Error ? error.message : 'Nie udało się pobrać kolejki zatwierdzeń.')
    }
  }, [])

  const refreshProcedures = useCallback(async () => {
    try {
      setProcedures(await fetchProcedures())
      setProceduresState('ready')
      setProceduresError('')
    } catch (error) {
      setProceduresState('error')
      setProceduresError(error instanceof Error ? error.message : 'Nie udało się pobrać procedur.')
    }
  }, [])

  const refresh = useCallback(() => {
    void refreshStock()
    void refreshZones()
    void refreshHistory()
    void refreshQueue()
    void refreshProcedures()
  }, [refreshHistory, refreshProcedures, refreshQueue, refreshStock, refreshZones])

  useEffect(() => {
    refresh()
    return connectWs(refresh, setConnected)
  }, [refresh])

  const showToast = (message: string) => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }

  const onApplied = (summary: string, reorderDraft: ReorderDraft | null) => {
    showToast(
      reorderDraft
        ? `Zapisano: ${summary} · szkic zamówienia ${reorderDraft.quantity} ${reorderDraft.unit} w kolejce`
        : `Zapisano w bazie: ${summary} · wpis w historii`,
    )
    refresh()
  }

  const onQueueChanged = (message: string) => {
    showToast(message)
    refresh()
  }

  const showZone = (id: number) => {
    setSelectedZoneId(id)
    setSection('mapa')
  }

  const heading = SECTION_TITLES[section]

  return (
    <div className="min-h-screen bg-[#f5f4f0] text-[#292d2b] lg:flex lg:h-screen lg:overflow-hidden">
      <Sidebar current={section} onNavigate={setSection} connected={connected} />

      <main className="min-w-0 flex-1 overflow-y-auto">
        <header className="border-b border-[#e8e5de] bg-[#fbfaf7] px-5 py-5 sm:px-8 lg:px-10 lg:py-7">
          <div className="mx-auto flex max-w-[1440px] items-end justify-between gap-4">
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#646b64]">Magazyn · panel operacyjny</p>
              <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">{heading.title}</h1>
              <p className="mt-1 text-sm text-[#70756f]">{heading.subtitle}</p>
            </div>
            <div className="hidden items-center gap-2 text-xs font-medium text-[#646b64] sm:flex" aria-live="polite">
              <span className={'h-2 w-2 rounded-full ' + (connected ? 'bg-[#527b58]' : 'bg-[#a45d52]')} aria-hidden="true" />
              {connected ? 'Połączono' : 'Brak połączenia'}
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-[1440px] space-y-6 px-4 py-5 sm:px-6 lg:px-10 lg:py-8">
          {section === 'stany' && <InventoryImport onImported={refresh} />}
          <CommandPanel onApplied={onApplied} zones={zones} items={items} onShowZone={showZone} />

          {section === 'mapa' && (
            <WarehouseMap
              zones={zones}
              items={items}
              state={zonesState}
              error={zonesError}
              onRetry={() => void refreshZones()}
              itemsState={stockState}
              selectedId={selectedZoneId}
              onSelectZone={setSelectedZoneId}
              onRetryItems={() => void refreshStock()}
              onZoneAdded={(name, created) => {
                showToast(created ? `Dodano strefę: ${name}` : `Strefa „${name}” już istnieje`)
                refresh()
              }}
            />
          )}

          {(section === 'stany' || section === 'historia' || section === 'kolejka') && (
            <section>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold">
                  {section === 'stany' ? 'Pozycje' : section === 'historia' ? 'Wpisy w audycie' : 'Szkice zamówień'}
                </h2>
                {section === 'stany' && <InventoryExport />}
              </div>
              {section === 'stany' ? (
                <StockTable items={items} state={stockState} error={stockError} onRetry={() => void refreshStock()} />
              ) : section === 'historia' ? (
                <HistoryList entries={entries} state={historyState} error={historyError} onRetry={() => void refreshHistory()} />
              ) : (
                <ReorderQueue
                  drafts={drafts}
                  state={queueState}
                  error={queueError}
                  onRetry={() => void refreshQueue()}
                  onChanged={onQueueChanged}
                />
              )}
            </section>
          )}

          {section === 'procedury' && (
            <ProcedureList procedures={procedures} state={proceduresState} error={proceduresError} onRetry={() => void refreshProcedures()} zones={zones} items={items} onShowZone={showZone} />
          )}

          {section === 'ustawienia' && (
            <Placeholder label={SECTIONS.find((s) => s.id === section)?.label ?? section} note={PLACEHOLDER_NOTES[section]} />
          )}
        </div>
      </main>

      {toast && (
        <div className="fixed bottom-4 left-4 right-4 rounded-md border border-[#cbd8c9] bg-[#edf3ec] px-4 py-3 text-sm font-semibold text-[#315b37] sm:left-auto sm:right-6 sm:w-auto" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}
