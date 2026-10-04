'use client'

import { useState } from 'react'
import {
  assignSectorItem,
  deleteMapSector,
  unassignSectorItem,
  type Item,
  type MapSector,
} from '@/lib/api'
import { CloseIcon, PlusIcon } from './ui/icons'
import { buttonClass, fieldClass } from './ui/styles'

type Props = {
  sectors: MapSector[]
  items: Item[]
  selectedId: number | null
  onSelect: (id: number | null) => void
  /** Usuwanie sektora — tylko kierownik. */
  canDecide: boolean
  /** Po każdej zmianie (dodanie/usunięcie przypisania, usunięcie sektora). */
  onChanged: (message: string) => void
  onError: (message: string) => void
}

/** Blok „Sektory” w panelu bocznym mapy: lista, szczegóły i przypisywanie przedmiotów. */
export default function SectorPanel({ sectors, items, selectedId, onSelect, canDecide, onChanged, onError }: Props) {
  const [assignItemId, setAssignItemId] = useState('')
  const [assignQuantity, setAssignQuantity] = useState('1')
  const [busy, setBusy] = useState(false)

  const selected = sectors.find((sector) => sector.id === selectedId) ?? null
  const unassignedItems = items.filter((item) => !selected?.items.some((assigned) => assigned.item_id === item.id))

  const run = async (action: () => Promise<void>, successMessage: string) => {
    if (busy) return
    setBusy(true)
    try {
      await action()
      onChanged(successMessage)
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'Operacja na sektorze nie powiodła się.')
    } finally {
      setBusy(false)
    }
  }

  const assign = () => {
    if (!selected || !assignItemId) return
    const quantity = Number(assignQuantity)
    const itemId = Number(assignItemId)
    void run(async () => {
      await assignSectorItem(selected.id, { item_id: itemId, quantity: Number.isInteger(quantity) ? quantity : 1 })
      setAssignQuantity('1')
    }, `Przypisano przedmiot do sektora „${selected.name}”`)
  }

  return (
    <div className="min-w-0 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">Sektory</h2>
        <span className="text-sm tabular-nums text-ink-2">{sectors.length}</span>
      </div>

      {sectors.length === 0 ? (
        <p className="mt-3 max-w-[60ch] text-sm leading-6 text-ink-2">
          Żadnych sektorów. Włącz „Dodaj sektor” nad mapą i kliknij miejsce na rzucie — potem przypisz do niego przedmioty.
        </p>
      ) : (
        <ul className="-mx-2 mt-3 space-y-0.5" aria-label="Lista sektorów">
          {sectors.map((sector) => {
            const active = sector.id === selectedId
            return (
              <li key={sector.id}>
                <button
                  type="button"
                  onClick={() => onSelect(active ? null : sector.id)}
                  aria-pressed={active}
                  className={
                    'flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors duration-150 ' +
                    (active ? 'bg-act-soft font-semibold text-act-ink' : 'font-medium text-ink hover:bg-ground')
                  }
                >
                  <span className="truncate">{sector.name}</span>
                  <span className="shrink-0 tabular-nums text-ink-2">{sector.items.length}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {selected && (
        <div className="mt-4 border-t border-line pt-4" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="break-words text-base font-semibold text-ink">{selected.name}</h3>
            <span className="text-xs tabular-nums text-mute">
              {selected.x.toLocaleString('pl-PL')} m, {selected.y.toLocaleString('pl-PL')} m
            </span>
          </div>

          <p className="mt-2 label-caps">Przypisane przedmioty</p>
          {selected.items.length === 0 ? (
            <p className="mt-1 text-sm text-ink-2">Jeszcze nic — przypisz pierwszy przedmiot poniżej.</p>
          ) : (
            <ul className="mt-1 divide-y divide-line">
              {selected.items.map((assignment) => (
                <li key={assignment.item_id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{assignment.item_name}</span>
                    <span className="tabular-nums text-xs text-ink-2">
                      {assignment.quantity} {assignment.unit} w sektorze
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        async () => {
                          await unassignSectorItem(selected.id, assignment.item_id)
                        },
                        `Usunięto ${assignment.item_name} z sektora „${selected.name}”`,
                      )
                    }
                    aria-label={`Usuń ${assignment.item_name} z sektora ${selected.name}`}
                    className={buttonClass('ghost', 'sm')}
                  >
                    <CloseIcon size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {items.length === 0 ? (
            <p className="mt-3 text-sm text-ink-2">Brak przedmiotów w magazynie — importuj stany, żeby je przypisywać.</p>
          ) : (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="min-w-0 flex-1 text-left">
                <span className="label-caps mb-1.5 block">Przedmiot</span>
                <select value={assignItemId} onChange={(event) => setAssignItemId(event.target.value)} className={fieldClass}>
                  <option value="">wybierz…</option>
                  {unassignedItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} (stan {item.quantity} {item.unit})
                    </option>
                  ))}
                </select>
              </label>
              <label className="w-24 text-left">
                <span className="label-caps mb-1.5 block">Ilość</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={assignQuantity}
                  onChange={(event) => setAssignQuantity(event.target.value)}
                  className={fieldClass}
                />
              </label>
              <button
                type="button"
                onClick={assign}
                disabled={busy || !assignItemId}
                className={buttonClass('primary', 'sm')}
              >
                <PlusIcon size={16} />
                Przypisz
              </button>
            </div>
          )}

          {canDecide && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await deleteMapSector(selected.id)
                  onSelect(null)
                }, `Usunięto sektor „${selected.name}”`)
              }
              className={buttonClass('danger', 'sm') + ' mt-4'}
            >
              <CloseIcon size={16} />
              Usuń sektor
            </button>
          )}
        </div>
      )}
    </div>
  )
}
