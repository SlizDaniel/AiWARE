import { useCallback, useEffect, useRef, useState } from 'react'
import CommandPanel from './components/CommandPanel'
import HistoryList from './components/HistoryList'
import Placeholder from './components/Placeholder'
import Sidebar from './components/Sidebar'
import StockTable from './components/StockTable'
import { connectWs, fetchHistory, fetchStock, type HistoryEntry, type Item } from './api'
import { SECTIONS, type SectionId } from './sections'

const PLACEHOLDER_NOTES: Partial<Record<SectionId, string>> = {
  mapa: 'Schematyczna mapa 2D magazynu ze strefami — karta 03.',
  kolejka: 'Proaktywne szkice zamówień (progi/reorder) — karta 07.',
  procedury: '„Jak pakujemy szkło?” — pamięć proceduralna — karta 08.',
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

export default function App() {
  const [section, setSection] = useState<SectionId>('stany')
  const [items, setItems] = useState<Item[]>([])
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [connected, setConnected] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const refresh = useCallback(() => {
    void fetchStock().then(setItems).catch(() => undefined)
    void fetchHistory().then(setEntries).catch(() => undefined)
  }, [])

  useEffect(() => {
    refresh()
    return connectWs(refresh, setConnected)
  }, [refresh])

  const showToast = (message: string) => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }

  const onApplied = (summary: string) => {
    showToast(`Zapisano w bazie: ${summary} · wpis w historii`)
    refresh()
  }

  const heading = SECTION_TITLES[section]

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar current={section} onNavigate={setSection} connected={connected} />

      <main className="flex-1 overflow-y-auto">
        <header className="border-b border-slate-200 bg-white px-8 py-6">
          <h1 className="text-2xl font-extrabold tracking-tight">{heading.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{heading.subtitle}</p>
        </header>

        <div className="space-y-6 p-8">
          <CommandPanel onApplied={onApplied} />

          {(section === 'stany' || section === 'historia') && (
            <section>
              <h2 className="mb-3 text-lg font-bold">
                {section === 'stany' ? 'Pozycje' : 'Wpisy w audycie'}
              </h2>
              {section === 'stany' ? <StockTable items={items} /> : <HistoryList entries={entries} />}
            </section>
          )}

          {section !== 'stany' && section !== 'historia' && (
            <Placeholder label={SECTIONS.find((s) => s.id === section)?.label ?? section} note={PLACEHOLDER_NOTES[section]} />
          )}
        </div>
      </main>

      {toast && (
        <div className="fixed bottom-6 right-6 rounded-xl bg-slate-900 px-5 py-4 text-sm font-semibold text-white shadow-xl">
          ✓ {toast}
        </div>
      )}
    </div>
  )
}
