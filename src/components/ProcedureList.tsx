import { useState } from 'react'
import type { Item, Procedure, Zone } from '@/lib/api'
import ProcedureLocation from './ProcedureLocation'
import PackingEditor from './PackingEditor'
import { filterProcedures } from './procedures'
import { EmptyState, LoadError, Skeleton } from './ui/feedback'
import { SearchIcon } from './ui/icons'
import { buttonClass, fieldClass, panelClass } from './ui/styles'

type Props = {
  procedures: Procedure[]
  state: 'loading' | 'ready' | 'error'
  error: string
  onRetry: () => void
  zones: Zone[]
  items: Item[]
  onShowZone: (id: number) => void
  canManage?: boolean
  onChanged?: () => void
}

export default function ProcedureList({ procedures, state, error, onRetry, zones, items, onShowZone, canManage = false, onChanged = onRetry }: Props) {
  const [query, setQuery] = useState('')

  if (state === 'loading') {
    return <Skeleton rows={4} label="Pobieram procedury…" />
  }
  if (state === 'error') {
    return <LoadError title="Nie udało się pobrać procedur." detail={error || undefined} onRetry={onRetry} />
  }

  const filtered = filterProcedures(procedures, query)
  return (
    <section aria-label="Zapisane procedury" className={panelClass}>
      <div className="space-y-3 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="relative w-full max-w-sm">
            <label htmlFor="procedure-search" className="sr-only">Szukaj w procedurach</label>
            <SearchIcon size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
            <input
              id="procedure-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Fragment tematu lub treści…"
              className={`${fieldClass} h-10 pl-10`}
            />
          </div>
          <p className="text-sm text-ink-2" role="status">
            Znaleziono: <span className="font-semibold tabular-nums text-ink">{filtered.length}</span>
          </p>
        </div>
        <p className="max-w-[70ch] text-sm text-ink-2">
          Zatwierdzone przez kierownika reguły: konkretny produkt, opakowanie z katalogu i ilość na opakowanie.
          {canManage && ' Możesz też powiedzieć: „zapamiętaj: Szkło pakujemy po 2 w Duży karton”.'}
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="border-t border-line p-5">
          {procedures.length === 0 ? (
            <EmptyState title="Brak zatwierdzonych reguł">{canManage ? 'Utwórz pierwszą regułę w formularzu poniżej. Dawne luźne notatki są zachowane w bazie i wymagają utworzenia reguły.' : 'Poproś kierownika o dodanie reguły pakowania.'}</EmptyState>
          ) : (
            <EmptyState
              title="Brak procedur pasujących do wyszukiwania."
              action={
                <button type="button" onClick={() => setQuery('')} className={buttonClass('secondary', 'sm')}>
                  Wyczyść wyszukiwanie
                </button>
              }
            />
          )}
        </div>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {filtered.map((procedure) => (
            <li key={procedure.id} className="px-5 py-5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-lg font-semibold leading-snug text-ink">{procedure.topic}</h2>
                <span className="narrow text-xs tabular-nums text-mute">#{procedure.id}</span>
              </div>
              <p className="mt-2 max-w-[70ch] whitespace-pre-wrap text-[15px] leading-7 text-ink-2">{procedure.text}</p>
              <p className="mt-2 text-sm text-ink-2">{procedure.packaging_stock ? `Opakowania na stanie: ${procedure.packaging_stock.name} — ${procedure.packaging_stock.quantity} ${procedure.packaging_stock.unit}` : 'Opakowanie nie ma powiązanego stanu magazynowego.'}</p>
              <p className="mt-2 text-xs text-mute">Wersja {procedure.version} · {procedure.updated_by} · {procedure.created}</p>
              <ProcedureLocation procedure={procedure} zones={zones} items={items} onShowZone={onShowZone} />
            </li>
          ))}
        </ul>
      )}
      {canManage && <PackingEditor items={items} procedures={procedures} onChanged={onChanged} />}
    </section>
  )
}
