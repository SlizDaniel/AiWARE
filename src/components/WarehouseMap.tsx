import { useEffect, useRef, useState } from 'react'
import { confirmProposal, sendCommand, type Item, type Proposal, type Zone } from '@/lib/api'
import RangeIndicator from './ui/RangeIndicator'
import { LoadError, Notice, RollingNumber, Skeleton } from './ui/feedback'
import { CheckIcon, CloseIcon, PinIcon, PlusIcon } from './ui/icons'
import { StateMark, StateShape, stateTextClass } from './ui/StateMark'
import { STOCK_LEVEL, countDeviations, stockLevel } from './ui/stockLevel'
import { buttonClass, fieldClass, panelClass } from './ui/styles'
import { findZoneByName, itemsForZone, zoneForItem, type MapTarget } from './zoneItems'

type LoadState = 'loading' | 'ready' | 'error'

type Props = {
  zones: Zone[]
  items: Item[]
  locationTarget: MapTarget | null
  selectedId: number | null
  onSelectZone: (id: number | null) => void
  state: LoadState
  error: string
  onRetry: () => void
  itemsState: LoadState
  onRetryItems: () => void
  onZoneAdded: (name: string, created: boolean) => void
}

type ZoneStats = { count: number; deviation: { kind: 'alarm' | 'warn'; count: number } | null }

/** Liczba pozycji strefy i odchylenia (braki → kwadrat, poniżej minimum → trójkąt). */
function zoneStats(zone: Zone, items: Item[], zones: Zone[]): ZoneStats {
  const zoneItems = itemsForZone(zone, items, zones)
  const { empty, below } = countDeviations(zoneItems)
  const low = empty + below
  return { count: zoneItems.length, deviation: low > 0 ? { kind: empty > 0 ? 'alarm' : 'warn', count: low } : null }
}

const SLOT = 'min-h-[5.5rem] rounded-md'

export default function WarehouseMap({ zones, items, locationTarget, selectedId, onSelectZone, state, error, onRetry, itemsState, onRetryItems, onZoneAdded }: Props) {
  const [draftOpen, setDraftOpen] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftProposal, setDraftProposal] = useState<Proposal | null>(null)
  const [draftBusy, setDraftBusy] = useState(false)
  const [draftError, setDraftError] = useState('')
  const [draftWarning, setDraftWarning] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  const mapRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (locationTarget && state === 'ready') mapRef.current?.focus()
  }, [locationTarget, state])

  useEffect(() => {
    if (draftOpen) nameInputRef.current?.focus()
  }, [draftOpen])

  useEffect(() => {
    if (draftProposal) confirmButtonRef.current?.focus()
  }, [draftProposal])

  const prepareZone = async () => {
    const name = draftName.trim()
    if (!name || draftBusy) return
    const existing = findZoneByName(name, zones)
    if (existing) {
      onSelectZone(existing.id)
      setDraftError(`Strefa „${existing.name}” już istnieje. Otworzyliśmy jej szczegóły. Jak nazwać nową strefę?`)
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
      onSelectZone(result.id ?? null)
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
    return <Skeleton rows={5} label="Pobieram mapę stref…" />
  }

  if (state === 'error') {
    return <LoadError title="Nie udało się pobrać mapy stref." detail={error || undefined} onRetry={onRetry} />
  }

  const orderedZones = [...zones].sort((a, b) => a.id - b.id)
  const selected = orderedZones.find((zone) => zone.id === selectedId) ?? null
  const targetZone = locationTarget ? zoneForItem(locationTarget, orderedZones) : null
  const selectedItems = selected ? itemsForZone(selected, items, orderedZones) : []
  const stats = new Map<number, ZoneStats>(
    itemsState === 'ready' ? orderedZones.map((zone) => [zone.id, zoneStats(zone, items, orderedZones)]) : [],
  )
  const rows = Math.max(3, Math.ceil((orderedZones.length + 1) / 2))
  const targetLabel = locationTarget ? `${locationTarget.name} · ${locationTarget.location || 'Brak zapisanej lokalizacji'}` : ''

  return (
    <section ref={mapRef} tabIndex={-1} aria-label="Mapa stref magazynu" className="@container rounded-lg focus-visible:outline-offset-4">
      <div className="grid gap-x-8 gap-y-6 @4xl:grid-cols-[minmax(0,1fr)_minmax(17rem,20rem)]">
        {locationTarget && (targetZone ? (
          <div role="status" className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg bg-act-soft px-5 py-4 text-act-ink @4xl:col-span-2">
            <p className="flex min-w-0 items-start gap-2.5 font-semibold">
              <PinIcon size={18} className="mt-0.5 shrink-0" />
              <span className="min-w-0">
                {locationTarget.name} · <span className="font-normal">{locationTarget.location || 'Brak zapisanej lokalizacji'}</span>
              </span>
            </p>
            <button type="button" onClick={() => onSelectZone(targetZone.id)} className={buttonClass('secondary', 'sm')}>
              Wybierz strefę „{targetZone.name}”
            </button>
          </div>
        ) : (
          <Notice
            tone="warn"
            role="status"
            className="@4xl:col-span-2"
            title={targetLabel}
            action={
              <button
                type="button"
                disabled={draftBusy}
                onClick={() => { setDraftName(locationTarget.location || locationTarget.name); setDraftProposal(null); setDraftError(''); setDraftWarning(''); setDraftOpen(true) }}
                className={buttonClass('secondary', 'sm')}
              >
                <PlusIcon size={16} />
                Przygotuj strefę dla tej lokalizacji
              </button>
            }
          >
            Ta pozycja nie ma jeszcze pasującej strefy na schemacie.
          </Notice>
        ))}

        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-lg font-semibold text-ink">Rzut magazynu</h2>
            <span className="text-sm text-ink-2">schemat · <span className="tabular-nums">{orderedZones.length}</span> stref</span>
          </div>

          {/* Rzut hali: obrys ściany, brama (przerwa w ścianie), ciąg komunikacyjny i dwa rzędy regałów. */}
          <div
            role="group"
            aria-label="Schemat magazynu. Strefy można wybrać myszą lub klawiaturą."
            className="rounded-lg border border-line-strong bg-sheet px-3 pb-4 sm:px-5 sm:pb-5"
          >
            <div className="label-caps mx-auto -mt-px w-fit rounded-b-md border border-t-0 border-line-strong bg-ground px-5 py-2">
              Brama / przyjęcie
            </div>
            <div className="mt-4 grid grid-cols-[minmax(0,1fr)_2.75rem_minmax(0,1fr)] gap-x-3 gap-y-3 sm:grid-cols-[minmax(0,1fr)_3.75rem_minmax(0,1fr)] sm:gap-x-4">
              <p className="label-caps" style={{ gridColumn: 1, gridRow: 1 }}>Regały A</p>
              <p className="label-caps" style={{ gridColumn: 3, gridRow: 1 }}>Regały B</p>
              <div
                className="relative flex items-center justify-center rounded-md bg-ground"
                style={{ gridColumn: 2, gridRow: `2 / span ${rows}` }}
              >
                <span aria-hidden="true" className="absolute inset-y-3 left-1/2 border-l border-dashed border-line-strong" />
                <span className="label-caps relative rotate-180 bg-ground py-3 [writing-mode:vertical-rl]">Ciąg komunikacyjny</span>
              </div>

              {Array.from({ length: rows * 2 }, (_, index) => {
                const placement = { gridColumn: index % 2 === 0 ? 1 : 3, gridRow: Math.floor(index / 2) + 2 }
                const zone = orderedZones[index]
                if (!zone) {
                  if (index === orderedZones.length) {
                    return (
                      <button
                        key="add-zone"
                        type="button"
                        aria-label="Dodaj strefę w następnym wolnym miejscu"
                        aria-expanded={draftOpen}
                        aria-controls="new-zone-form"
                        onClick={() => setDraftOpen(true)}
                        style={placement}
                        className={`${SLOT} flex items-center justify-center gap-2 border border-dashed border-line-strong px-3 text-sm font-semibold text-ink-2 transition-colors duration-150 hover:border-act hover:bg-act-soft/60 hover:text-act-ink`}
                      >
                        <PlusIcon size={18} />
                        Dodaj strefę
                      </button>
                    )
                  }
                  return <div key={`empty-${index}`} aria-hidden="true" style={placement} className={`${SLOT} border border-dashed border-line`} />
                }

                const active = selected?.id === zone.id
                const isTarget = targetZone?.id === zone.id
                const stat = stats.get(zone.id) ?? null
                const stockLabel = stat === null
                  ? itemsState === 'error' ? 'Asortyment niedostępny' : 'Pobieram asortyment…'
                  : `${stat.count} ${stat.count === 1 ? 'pozycja' : 'pozycji'}`
                const deviationLabel = stat?.deviation ? `${stat.deviation.count} poniżej minimum` : ''
                return (
                  <button
                    key={zone.id}
                    type="button"
                    aria-label={`Strefa ${zone.name}. ${stockLabel}.${deviationLabel ? ` ${deviationLabel}.` : ''} Pokaż szczegóły.`}
                    aria-pressed={active}
                    onClick={() => onSelectZone(zone.id)}
                    onFocus={() => onSelectZone(zone.id)}
                    style={placement}
                    className={
                      `${SLOT} flex min-w-0 flex-col justify-between gap-2 border px-3 py-3 text-left transition-colors duration-150 sm:px-4 ` +
                      (active ? 'border-act bg-act-soft ring-1 ring-act' : 'border-line-strong bg-sheet hover:border-ink-2 hover:bg-ground/50')
                    }
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0 break-words text-base font-semibold leading-snug text-ink sm:text-[17px]">{zone.name}</span>
                      {isTarget && <PinIcon size={18} className="mt-0.5 shrink-0 text-act" />}
                    </span>
                    <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="text-[13px] tabular-nums text-ink-2">{stockLabel}</span>
                      {stat?.deviation && (
                        <StateMark kind={stat.deviation.kind} className="whitespace-nowrap tabular-nums">{deviationLabel}</StateMark>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
          <p className="mt-3 text-xs text-mute">Układ schematyczny. Położenie stref na rzucie nie oznacza fizycznych współrzędnych.</p>
        </div>

        <aside
          aria-label="Szczegóły stref"
          className={`${panelClass} grid self-start divide-y divide-line @2xl:grid-cols-2 @2xl:divide-x @2xl:divide-y-0 @4xl:grid-cols-1 @4xl:divide-x-0 @4xl:divide-y`}
        >
          <div className={`min-w-0 p-5 ${selected ? '' : '@2xl:col-span-2 @4xl:col-span-1'}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-ink">Strefy</h2>
              <button
                type="button"
                disabled={draftBusy}
                onClick={() => setDraftOpen((open) => !open)}
                aria-expanded={draftOpen}
                aria-controls="new-zone-form"
                className={buttonClass('ghost', 'sm')}
              >
                {draftOpen ? <CloseIcon size={16} /> : <PlusIcon size={16} />}
                {draftOpen ? 'Zamknij' : 'Dodaj strefę'}
              </button>
            </div>

            {draftOpen && (
              <div id="new-zone-form" className="mt-4 space-y-4 border-y border-line py-4">
                <form onSubmit={(event) => { event.preventDefault(); void prepareZone() }} className="space-y-3">
                  <div>
                    <label htmlFor="new-zone-name" className="label-caps mb-1.5 block">Nazwa nowej strefy</label>
                    <input
                      ref={nameInputRef}
                      id="new-zone-name"
                      value={draftName}
                      disabled={draftBusy || draftProposal !== null}
                      onChange={(event) => { setDraftName(event.target.value); setDraftError(''); setDraftWarning('') }}
                      placeholder="np. kartony"
                      className={fieldClass}
                    />
                  </div>
                  {!draftProposal && (
                    <button type="submit" disabled={draftBusy || !draftName.trim()} className={buttonClass('primary', 'sm')}>
                      {draftBusy ? 'Przygotowuję…' : 'Przygotuj kartę'}
                    </button>
                  )}
                </form>
                {draftProposal && (
                  <div className="rounded-md bg-act-soft px-4 py-3">
                    <p className="flex items-start gap-2 text-sm font-semibold text-act-ink">
                      <StateShape kind="decision" className="mt-[5px]" />
                      {draftProposal.summary}
                    </p>
                    <p className="mt-1 pl-[18px] text-xs text-ink-2">Nic nie zapisano. Potwierdź dodanie strefy.</p>
                    <div className="mt-3 flex flex-wrap gap-2 pl-[18px]">
                      <button ref={confirmButtonRef} type="button" onClick={() => void confirmZone()} disabled={draftBusy} className={buttonClass('action', 'sm')}>
                        <CheckIcon size={16} />
                        {draftBusy ? 'Zapisuję…' : 'Zatwierdź'}
                      </button>
                      <button type="button" onClick={() => { setDraftProposal(null); setDraftError('') }} disabled={draftBusy} className={buttonClass('danger', 'sm')}>
                        Odrzuć
                      </button>
                    </div>
                  </div>
                )}
                {draftWarning && <Notice tone="warn" role="status">{draftWarning}</Notice>}
                {draftError && <Notice tone="alarm" role="alert">{draftError}</Notice>}
              </div>
            )}

            {orderedZones.length === 0 ? (
              <p className="mt-3 max-w-[60ch] text-sm leading-6 text-ink-2">Nie ma jeszcze stref. W panelu komend wpisz na przykład „strefa: kartony” i zatwierdź propozycję.</p>
            ) : (
              <>
                <p className="mt-1 text-sm text-ink-2">Wybierz strefę na rzucie lub z listy.</p>
                <ul className="-mx-2 mt-3 space-y-0.5" aria-label="Lista stref">
                  {orderedZones.map((zone) => {
                    const active = selected?.id === zone.id
                    const stat = stats.get(zone.id) ?? null
                    return (
                      <li key={zone.id}>
                        <button
                          type="button"
                          onClick={() => onSelectZone(zone.id)}
                          aria-pressed={active}
                          className={
                            'flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors duration-150 ' +
                            (active ? 'bg-act-soft font-semibold text-act-ink' : 'font-medium text-ink hover:bg-ground')
                          }
                        >
                          <span className="truncate">{zone.name}</span>
                          <span className="flex shrink-0 items-center gap-2 text-ink-2">
                            {stat?.deviation && (
                              <>
                                <StateShape kind={stat.deviation.kind} />
                                <span className="sr-only">{stat.deviation.count} poniżej minimum,</span>
                              </>
                            )}
                            <span className="tabular-nums">{stat ? stat.count : '—'}</span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </div>

          {selected && (
            <div className="min-w-0 p-5" aria-live="polite">
              <h3 className="break-words text-xl font-semibold leading-tight text-ink">{selected.name}</h3>
              <p className="mt-1 text-sm text-ink-2">Wybrana strefa</p>
              {itemsState === 'loading' ? (
                <div className="mt-4"><Skeleton rows={3} label="Pobieram asortyment…" /></div>
              ) : itemsState === 'error' ? (
                <div className="mt-4"><LoadError title="Nie udało się pobrać asortymentu tej strefy." onRetry={onRetryItems} /></div>
              ) : selectedItems.length === 0 ? (
                <p className="mt-3 text-sm leading-6 text-ink-2">Brak pozycji pasujących nazwą lub lokalizacją do tej strefy.</p>
              ) : (
                <ul className="mt-4 divide-y divide-line border-t border-line">
                  {selectedItems.map((item) => {
                    const level = stockLevel(item.quantity, item.minimum)
                    const { label, kind } = STOCK_LEVEL[level]
                    const deviation = level === 'empty' || level === 'below'
                    return (
                      <li key={item.id} className="py-3">
                        <div className="flex items-baseline justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-ink">{item.name}</p>
                            <p className="narrow truncate text-xs text-ink-2">{item.location || 'Bez lokalizacji'}</p>
                          </div>
                          <span className="flex shrink-0 items-baseline gap-1 whitespace-nowrap">
                            <RollingNumber
                              value={item.quantity}
                              className={`text-base font-semibold tabular-nums ${deviation ? stateTextClass(kind) : 'text-ink'}`}
                            />
                            <span className="text-xs text-ink-2">{item.unit}</span>
                          </span>
                        </div>
                        <RangeIndicator value={item.quantity} minimum={item.minimum} label={item.name} unit={item.unit} size="sm" className="mt-2" />
                        {level !== 'ok' && <StateMark kind={kind} className="mt-1.5">{label}</StateMark>}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </aside>
      </div>
    </section>
  )
}
