import { useMemo, useState, type ReactNode } from 'react'
import type { Item } from '@/lib/api'
import RangeIndicator from './ui/RangeIndicator'
import { ChangeFlash, EmptyState, LoadError, Notice, RollingNumber, Skeleton } from './ui/feedback'
import { EditIcon, SearchIcon } from './ui/icons'
import { StateMark, StateShape, stateTextClass } from './ui/StateMark'
import { STOCK_LEVEL, rangePercent, rangeScale, stockLevel, type StockLevel } from './ui/stockLevel'
import { buttonClass, fieldClass, panelClass } from './ui/styles'

type StockState = 'loading' | 'ready' | 'error'

const EDIT_FIELDS = [
  ['name', 'Nazwa', 'text', 'sm:col-span-3'],
  ['quantity', 'Ilość', 'number', 'sm:col-span-1'],
  ['minimum', 'Minimum', 'number', 'sm:col-span-1'],
  ['unit', 'Jednostka', 'text', 'sm:col-span-1'],
  ['location', 'Lokalizacja', 'text', 'sm:col-span-3'],
] as const

const LEGEND_LEVELS: StockLevel[] = ['empty', 'below', 'near', 'ok']

export default function StockTable({
  items,
  state = 'ready',
  error = '',
  onRetry,
  canManage = false,
  onSave,
}: {
  items: Item[]
  state?: StockState
  error?: string
  onRetry?: () => void
  canManage?: boolean
  onSave?: (id: number, changes: Partial<Omit<Item, 'id'>>) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState({ name: '', quantity: '', minimum: '', unit: '', location: '' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase('pl-PL')
  const filteredItems = useMemo(
    () => items.filter((item) => item.name.toLocaleLowerCase('pl-PL').includes(normalizedQuery)),
    [items, normalizedQuery],
  )
  const columnCount = canManage ? 5 : 4

  if (state === 'loading') {
    return <Skeleton rows={6} label="Pobieram stany magazynowe…" />
  }

  if (state === 'error') {
    return <LoadError title="Nie udało się pobrać stanów magazynowych." detail={error || undefined} onRetry={onRetry} />
  }

  if (items.length === 0) {
    return (
      <section aria-label="Pozycje magazynowe">
        <Empty text="Brak pozycji magazynowych" hint="Zaimportuj plik lub dodaj dane, aby zobaczyć stany." />
      </section>
    )
  }

  return (
    <section aria-label="Pozycje magazynowe" className={panelClass}>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
        <label className="relative block w-full max-w-sm">
          <SearchIcon size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
          <input
            aria-label="Szukaj pozycji magazynowej"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Wpisz nazwę, np. kartony"
            className={`${fieldClass} h-10 pl-10`}
          />
        </label>
        <p className="text-sm text-ink-2" aria-live="polite">
          <span className="font-semibold tabular-nums text-ink">{filteredItems.length}</span> z{' '}
          <span className="tabular-nums">{items.length}</span> pozycji
        </p>
      </div>

      {filteredItems.length === 0 ? (
        <div className="border-t border-line p-5">
          <Empty
            text={`Nie znaleziono pozycji dla „${query.trim()}”.`}
            action={
              <button type="button" onClick={() => setQuery('')} className={buttonClass('secondary', 'sm')}>
                Wyczyść wyszukiwanie
              </button>
            }
          />
        </div>
      ) : (
        // Szerokości kolumn mieszczą się w ~600 px (laptop 1280 px z kolumną agenta); przewijanie tylko awaryjnie.
        <div className="relative overflow-x-auto border-t border-line">
          <table className="w-full min-w-[34rem] table-fixed text-left">
            <thead>
              <tr>
                <th scope="col" className="label-caps py-3 pl-5 pr-3 text-left">Pozycja</th>
                <th scope="col" className="label-caps w-28 px-3 py-3 text-right">Stan</th>
                <th scope="col" className="label-caps w-36 px-3 py-3 text-left">Poziom</th>
                <th scope="col" className={`label-caps w-38 py-3 pl-3 text-left ${canManage ? 'pr-3' : 'pr-5'}`}>Status</th>
                {canManage && (
                  <th scope="col" className="w-14 py-3 pl-1 pr-3">
                    <span className="sr-only">Edycja</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                if (editing === item.id) {
                  return (
                    <tr key={item.id} className="border-t border-line bg-ground/60">
                      <td colSpan={columnCount} className="px-5 py-5">
                        <form className="grid gap-x-4 gap-y-4 sm:grid-cols-6" onSubmit={async (event) => {
                          event.preventDefault()
                          if (!onSave) return
                          setSaving(true)
                          setSaveError('')
                          try {
                            await onSave(item.id, {
                              name: draft.name, quantity: Number(draft.quantity), minimum: Number(draft.minimum),
                              unit: draft.unit, location: draft.location,
                            })
                            setEditing(null)
                          } catch (reason) {
                            setSaveError(reason instanceof Error ? reason.message : 'Nie udało się zapisać produktu.')
                          } finally {
                            setSaving(false)
                          }
                        }}>
                          {EDIT_FIELDS.map(([field, label, type, span]) => (
                            <label key={field} className={`block ${span}`}>
                              <span className="label-caps mb-1.5 block">{label}</span>
                              <input
                                aria-label={`${label} produktu ${item.name}`}
                                required={field === 'name'} type={type} min={type === 'number' ? 0 : undefined}
                                max={type === 'number' ? 2147483647 : undefined} step={type === 'number' ? 1 : undefined}
                                value={draft[field]} onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))}
                                className={`${fieldClass} ${type === 'number' ? 'tabular-nums' : ''}`}
                              />
                            </label>
                          ))}
                          <div className="flex flex-wrap items-end gap-2 sm:col-span-3">
                            <button type="submit" disabled={saving} className={buttonClass('action')}>
                              {saving ? 'Zapisuję…' : 'Zapisz produkt'}
                            </button>
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => { setEditing(null); setSaveError('') }}
                              className={buttonClass('secondary')}
                            >
                              Anuluj
                            </button>
                          </div>
                          {saveError && (
                            <Notice tone="alarm" role="alert" className="sm:col-span-6">{saveError}</Notice>
                          )}
                        </form>
                      </td>
                    </tr>
                  )
                }

                const level = stockLevel(item.quantity, item.minimum)
                const { label, kind } = STOCK_LEVEL[level]
                const deviation = level === 'empty' || level === 'below'
                const minPct = item.minimum > 0 ? rangePercent(item.minimum, rangeScale(item.minimum, [item.quantity])) : null
                // każda komórka ma własne podświetlenie (pozycjonowanie `tr` nie jest pewne we wszystkich przeglądarkach)
                const flash = <ChangeFlash value={`${item.quantity}/${item.minimum}`} />
                return (
                  <tr key={item.id} className="border-t border-line align-top transition-colors duration-150 hover:bg-ground/50">
                    <th scope="row" className="relative py-4 pl-5 pr-3 text-left font-normal">
                      {flash}
                      <div className="relative min-w-0">
                        <div className="break-words py-[3px] text-[15px] font-semibold leading-snug text-ink">{item.name}</div>
                        <div className={`narrow mt-1 truncate text-[13px] ${item.location ? 'text-ink-2' : 'text-mute'}`} title={item.location || undefined}>
                          {item.location || 'Bez lokalizacji'}
                        </div>
                      </div>
                    </th>
                    <td className="relative px-3 py-4 text-right">
                      {flash}
                      <div className="relative flex h-7 items-baseline justify-end gap-1 whitespace-nowrap">
                        <RollingNumber
                          value={item.quantity}
                          className={`text-lg font-semibold tabular-nums ${deviation ? stateTextClass(kind) : 'text-ink'}`}
                        />
                        <span className="truncate text-sm text-ink-2">{item.unit}</span>
                      </div>
                    </td>
                    <td className="relative px-3 py-4">
                      {flash}
                      <div className="relative">
                        <div className="flex h-7 items-center">
                          <RangeIndicator
                            value={item.quantity}
                            minimum={item.minimum}
                            label={item.name}
                            unit={item.unit}
                            size="md"
                            className="w-full"
                          />
                        </div>
                        <div className="relative mt-1 h-5" aria-hidden="true">
                          <span
                            className={`narrow absolute top-0 whitespace-nowrap text-[13px] tabular-nums text-ink-2 ${minPct === null ? '' : '-translate-x-1/2'}`}
                            style={{ left: `${minPct ?? 0}%` }}
                          >
                            min. {item.minimum}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className={`relative py-4 pl-3 ${canManage ? 'pr-3' : 'pr-5'}`}>
                      {flash}
                      <div className="relative flex h-7 items-center">
                        <StateMark kind={kind} className="whitespace-nowrap">{label}</StateMark>
                      </div>
                    </td>
                    {canManage && (
                      <td className="relative py-4 pl-1 pr-3 text-right">
                        {flash}
                        <div className="relative flex h-7 items-center justify-end">
                          <button
                            type="button"
                            aria-label={`Edytuj ${item.name}`}
                            title="Edytuj"
                            onClick={() => {
                              setDraft({ name: item.name, quantity: String(item.quantity), minimum: String(item.minimum), unit: item.unit, location: item.location })
                              setEditing(item.id)
                              setSaveError('')
                            }}
                            className={buttonClass('ghost', 'sm')}
                          >
                            <EditIcon size={16} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <ul
        aria-label="Legenda poziomów zapasu"
        className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line px-5 py-3 text-xs text-ink-2"
      >
        <li className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="h-3.5 w-0.5 rounded-full bg-ink" />
          Kreska — minimum
        </li>
        {LEGEND_LEVELS.map((level) => (
          <li key={level} className="inline-flex items-center gap-1.5">
            <StateShape kind={STOCK_LEVEL[level].kind} />
            {STOCK_LEVEL[level].label}
            {level === 'near' && <span className="text-mute">(do 1,5 × minimum)</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Pusty stan listy (używany też przez HistoryList): `text` to tytuł, `hint` uczy następnego kroku. */
export function Empty({ text, hint, action }: { text: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <EmptyState title={text} action={action}>
      {hint}
    </EmptyState>
  )
}
