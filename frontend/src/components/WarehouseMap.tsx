import { useEffect, useRef, useState } from 'react'
import { confirmProposal, sendCommand, type Item, type Proposal, type Zone } from '../api'
import { itemsForZone, normalizeZoneName } from './zoneItems'

type LoadState = 'loading' | 'ready' | 'error'

type Props = {
  zones: Zone[]
  items: Item[]
  state: LoadState
  error: string
  onRetry: () => void
  itemsState: LoadState
  onRetryItems: () => void
  onZoneAdded: (name: string, created: boolean) => void
  selectedId: number | null
  onSelectZone: (id: number | null) => void
}

function shortLabel(value: string): string {
  return value.length > 25 ? `${value.slice(0, 24)}…` : value
}

export default function WarehouseMap({ zones, items, state, error, onRetry, itemsState, onRetryItems, onZoneAdded, selectedId, onSelectZone: setSelectedId }: Props) {
  const [draftOpen, setDraftOpen] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftProposal, setDraftProposal] = useState<Proposal | null>(null)
  const [draftBusy, setDraftBusy] = useState(false)
  const [draftError, setDraftError] = useState('')
  const [draftWarning, setDraftWarning] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (draftOpen) nameInputRef.current?.focus()
  }, [draftOpen])

  useEffect(() => {
    if (draftProposal) confirmButtonRef.current?.focus()
  }, [draftProposal])

  const prepareZone = async () => {
    const name = draftName.trim()
    if (!name || draftBusy) return
    const existing = zones.find((zone) => normalizeZoneName(zone.name) === normalizeZoneName(name))
    if (existing) {
      setSelectedId(existing.id)
      setDraftError(`Strefa „${existing.name}” już istnieje. Wybierz ją z listy, aby zobaczyć szczegóły.`)
      return
    }

    setDraftBusy(true)
    setDraftError('')
    setDraftWarning('')
    try {
      const result = await sendCommand(`strefa: ${name}`)
      setDraftWarning(result.warning ?? '')
      if (result.type === 'proposal' && result.proposal.tool === 'add_zone') {
        setDraftProposal(result.proposal)
      } else if (result.type === 'clarify') {
        setDraftError(result.message)
      } else {
        setDraftError('Nie udało się przygotować strefy. Sprawdź nazwę i spróbuj ponownie.')
      }
    } catch (reason) {
      setDraftError(reason instanceof Error ? reason.message : 'Nie udało się przygotować strefy.')
    } finally {
      setDraftBusy(false)
    }
  }

  const confirmZone = async () => {
    if (!draftProposal || draftBusy) return
    setDraftBusy(true)
    setDraftError('')
    try {
      const result = await confirmProposal(draftProposal.id)
      onZoneAdded(result.name ?? draftName.trim(), result.created !== false)
      setSelectedId(result.id ?? null)
      setDraftProposal(null)
      setDraftName('')
      setDraftWarning('')
      setDraftOpen(false)
    } catch (reason) {
      setDraftError(reason instanceof Error ? reason.message : 'Nie udało się dodać strefy.')
    } finally {
      setDraftBusy(false)
    }
  }

  if (state === 'loading') {
    return <div className="border border-[#e8e5de] bg-white p-6 text-sm text-[#646b64]" role="status">Pobieram mapę stref…</div>
  }

  if (state === 'error') {
    return (
      <div className="border border-[#edc8c5] bg-[#fff7f6] p-6" role="alert">
        <p className="font-semibold text-[#8f3936]">Nie udało się pobrać mapy stref.</p>
        {error && <p className="mt-1 text-sm text-[#8f3936]">{error}</p>}
        <button type="button" onClick={onRetry} className="mt-4 border border-[#d8a9a5] bg-white px-4 py-2 text-sm font-semibold text-[#8f3936] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8f3936]">Spróbuj ponownie</button>
      </div>
    )
  }

  const orderedZones = [...zones].sort((a, b) => a.id - b.id)
  const selected = orderedZones.find((zone) => zone.id === selectedId) ?? null
  const selectedItems = selected ? itemsForZone(selected, items, orderedZones) : []
  const rows = Math.max(3, Math.ceil((orderedZones.length + 1) / 2))
  const height = 172 + rows * 112

  return (
    <section aria-label="Mapa stref magazynu" className="grid gap-5 lg:grid-cols-[minmax(0,1.8fr)_minmax(280px,0.8fr)]">
      <div className="min-w-0 border border-[#e8e5de] bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#e8e5de] px-5 py-4">
          <h2 className="text-lg font-bold">Rzut magazynu</h2>
          <span className="text-xs font-medium uppercase tracking-wider text-[#70756f]">schemat · {orderedZones.length} stref</span>
        </div>
        <div className="overflow-x-auto p-3 sm:p-5">
          <svg viewBox={`0 0 960 ${height}`} className="w-full min-w-[620px]" role="group" aria-label="Schemat magazynu. Strefy można wybrać myszą lub klawiaturą.">
            <rect x="24" y="34" width="912" height={height - 68} fill="#fbfaf7" stroke="#bfc8bc" strokeWidth="2" />
            <rect x="390" y="34" width="180" height="38" fill="#e6e9e2" stroke="#bfc8bc" />
            <text x="480" y="58" textAnchor="middle" fill="#454b46" fontSize="13" fontWeight="700">BRAMA / PRZYJĘCIE</text>
            <rect x="442" y="83" width="76" height={height - 156} fill="#f0efe9" />
            <text x="480" y={height - 62} textAnchor="middle" fill="#70756f" fontSize="12">CIĄG KOMUNIKACYJNY</text>
            <text x="90" y="76" fill="#70756f" fontSize="12" fontWeight="700" letterSpacing="2">REGAŁY A</text>
            <text x="545" y="76" fill="#70756f" fontSize="12" fontWeight="700" letterSpacing="2">REGAŁY B</text>

            {Array.from({ length: rows * 2 }, (_, index) => {
              const x = index % 2 === 0 ? 90 : 545
              const y = 92 + Math.floor(index / 2) * 112
              const zone = orderedZones[index]
              if (!zone) {
                if (index === orderedZones.length) {
                  return (
                    <g
                      key="add-zone"
                      role="button"
                      tabIndex={0}
                      aria-label="Dodaj strefę w następnym wolnym miejscu"
                      aria-expanded={draftOpen}
                      aria-controls="new-zone-form"
                      className="cursor-pointer"
                      onClick={() => setDraftOpen(true)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setDraftOpen(true)
                        }
                      }}
                    >
                      <rect x={x} y={y} width="325" height="84" fill="#f6f8f4" stroke="#759177" strokeWidth="2" strokeDasharray="6 5" />
                      <text x={x + 29} y={y + 49} fill="#315b37" fontSize="17" fontWeight="700">+ Dodaj strefę</text>
                    </g>
                  )
                }
                return <rect key={`empty-${index}`} x={x} y={y} width="325" height="84" fill="#f7f6f3" stroke="#d8d6cf" strokeDasharray="6 6" />
              }

              const active = selected?.id === zone.id
              const count = itemsState === 'ready' ? itemsForZone(zone, items, orderedZones).length : null
              return (
                <g
                  key={zone.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Strefa ${zone.name}. ${count === null ? 'Asortyment wczytywany.' : `${count} pozycji.`} Pokaż szczegóły.`}
                  aria-pressed={active}
                  className="cursor-pointer"
                  onClick={() => setSelectedId(zone.id)}
                  onFocus={() => setSelectedId(zone.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelectedId(zone.id)
                    }
                  }}
                >
                  <rect x={x} y={y} width="325" height="84" fill={active ? '#edf3ec' : '#ffffff'} stroke={active ? '#315b37' : '#bdc8bb'} strokeWidth={active ? 3 : 2} />
                  <rect x={x + 10} y={y + 10} width="5" height="64" fill={active ? '#315b37' : '#a7baa6'} />
                  <text x={x + 29} y={y + 37} fill="#292d2b" fontSize="20" fontWeight="700">{shortLabel(zone.name)}</text>
                  <text x={x + 29} y={y + 62} fill="#646b64" fontSize="13">{count === null ? 'Pobieram asortyment…' : `${count} ${count === 1 ? 'pozycja' : 'pozycji'}`}</text>
                </g>
              )
            })}
          </svg>
        </div>
        <p className="border-t border-[#e8e5de] px-5 py-3 text-xs text-[#70756f]">Układ schematyczny. Położenie stref na rzucie nie oznacza fizycznych współrzędnych.</p>
      </div>

      <aside className="border border-[#e8e5de] bg-white p-5" aria-label="Szczegóły stref">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-bold">Strefy</h2>
          <button type="button" onClick={() => setDraftOpen((open) => !open)} aria-expanded={draftOpen} aria-controls="new-zone-form" className="text-sm font-semibold text-[#315b37] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56]">{draftOpen ? 'Zamknij' : 'Dodaj strefę'}</button>
        </div>
        {draftOpen && (
          <div id="new-zone-form" className="mt-4 border border-[#cbd8c9] bg-[#f6f8f4] p-4">
            <form onSubmit={(event) => { event.preventDefault(); void prepareZone() }}>
              <label htmlFor="new-zone-name" className="block text-sm font-semibold text-[#454b46]">Nazwa nowej strefy</label>
              <input
                ref={nameInputRef}
                id="new-zone-name"
                value={draftName}
                disabled={draftBusy || draftProposal !== null}
                onChange={(event) => { setDraftName(event.target.value); setDraftError(''); setDraftWarning('') }}
                placeholder="np. kartony"
                className="mt-2 w-full border border-[#d8d6cf] bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#536b56] disabled:opacity-60"
              />
              {!draftProposal && <button type="submit" disabled={draftBusy || !draftName.trim()} className="mt-3 bg-[#292d2b] px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] disabled:cursor-not-allowed disabled:opacity-40">{draftBusy ? 'Przygotowuję…' : 'Przygotuj kartę'}</button>}
            </form>
            {draftProposal && (
              <div className="mt-4 border-t border-[#cbd8c9] pt-4">
                <p className="text-sm font-semibold text-[#315b37]">{draftProposal.summary}</p>
                <p className="mt-1 text-xs text-[#646b64]">Nic nie zapisano. Potwierdź dodanie strefy.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button ref={confirmButtonRef} type="button" onClick={() => void confirmZone()} disabled={draftBusy} className="bg-[#315b37] px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] disabled:opacity-40">{draftBusy ? 'Zapisuję…' : 'Zatwierdź'}</button>
                  <button type="button" onClick={() => { setDraftProposal(null); setDraftError('') }} disabled={draftBusy} className="border border-[#d8d6cf] bg-white px-4 py-2 text-sm font-semibold text-[#646b64] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] disabled:opacity-40">Odrzuć</button>
                </div>
              </div>
            )}
            {draftWarning && <p className="mt-3 border border-[#ead9a9] bg-[#fffaf0] p-3 text-sm text-[#805c12]" role="status">{draftWarning}</p>}
            {draftError && <p className="mt-3 border border-[#edc8c5] bg-[#fff7f6] p-3 text-sm text-[#8f3936]" role="alert">{draftError}</p>}
          </div>
        )}
        {orderedZones.length === 0 ? (
          <p className="mt-3 text-sm leading-6 text-[#646b64]">Nie ma jeszcze stref. W panelu komend wpisz na przykład „strefa: kartony” i zatwierdź propozycję.</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-[#646b64]">Wybierz strefę na rzucie lub z listy.</p>
            <div className="mt-4 space-y-1" aria-label="Lista stref">
              {orderedZones.map((zone) => (
                <button
                  key={zone.id}
                  type="button"
                  onClick={() => setSelectedId(zone.id)}
                  aria-pressed={selected?.id === zone.id}
                  className={'flex w-full items-center justify-between gap-3 border px-3 py-2.5 text-left text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#536b56] ' + (selected?.id === zone.id ? 'border-[#315b37] bg-[#edf3ec] text-[#315b37]' : 'border-[#e8e5de] text-[#454b46] hover:bg-[#fbfaf7]')}
                >
                  <span className="truncate">{zone.name}</span>
                  <span className="font-mono text-xs">{itemsState === 'ready' ? itemsForZone(zone, items, orderedZones).length : '—'}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {selected && (
          <div className="mt-6 border-t border-[#e8e5de] pt-5" aria-live="polite">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#70756f]">Wybrana strefa</p>
            <h3 className="mt-1 text-xl font-bold">{selected.name}</h3>
            {itemsState === 'loading' ? (
              <p className="mt-3 text-sm text-[#646b64]" role="status">Pobieram asortyment…</p>
            ) : itemsState === 'error' ? (
              <div className="mt-3 text-sm text-[#8f3936]" role="alert">
                <p>Nie udało się pobrać asortymentu tej strefy.</p>
                <button type="button" onClick={onRetryItems} className="mt-2 border border-[#d8a9a5] px-3 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#8f3936]">Spróbuj ponownie</button>
              </div>
            ) : selectedItems.length === 0 ? (
              <p className="mt-3 text-sm leading-6 text-[#646b64]">Brak pozycji pasujących nazwą lub lokalizacją do tej strefy.</p>
            ) : (
              <ul className="mt-3 divide-y divide-[#e8e5de]">
                {selectedItems.map((item) => (
                  <li key={item.id} className="flex items-baseline justify-between gap-3 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-semibold text-[#454b46]">{item.name}</p>
                      <p className="truncate text-xs text-[#70756f]">{item.location || 'Bez lokalizacji'}</p>
                    </div>
                    <span className="shrink-0 font-bold tabular-nums text-[#292d2b]">{item.quantity} <span className="text-xs font-normal text-[#646b64]">{item.unit}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </aside>
    </section>
  )
}
