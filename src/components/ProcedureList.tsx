import { useState } from 'react'
import type { Item, Procedure, Zone } from '@/lib/api'
import ProcedureLocation from './ProcedureLocation'
import { filterProcedures } from './procedures'

type Props = {
  procedures: Procedure[]
  state: 'loading' | 'ready' | 'error'
  error: string
  onRetry: () => void
  zones: Zone[]
  items: Item[]
  onShowZone: (id: number) => void
}

export default function ProcedureList({ procedures, state, error, onRetry, zones, items, onShowZone }: Props) {
  const [query, setQuery] = useState('')

  if (state === 'loading') {
    return <div className="border border-[#e8e5de] bg-white p-6 text-sm text-[#646b64]" role="status">Pobieram procedury…</div>
  }
  if (state === 'error') {
    return (
      <div className="border border-[#edc8c5] bg-[#fff7f6] p-6" role="alert">
        <p className="font-semibold text-[#8f3936]">Nie udało się pobrać procedur.</p>
        {error && <p className="mt-1 text-sm text-[#8f3936]">{error}</p>}
        <button type="button" onClick={onRetry} className="mt-4 border border-[#d8a9a5] bg-white px-4 py-2 text-sm font-semibold text-[#8f3936] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8f3936]">Spróbuj ponownie</button>
      </div>
    )
  }

  const filtered = filterProcedures(procedures, query)
  return (
    <section aria-label="Zapisane procedury" className="space-y-4">
      <div className="border border-[#e8e5de] bg-white p-5">
        <label htmlFor="procedure-search" className="block text-sm font-semibold">Szukaj w procedurach</label>
        <input id="procedure-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Fragment tematu lub treści…" className="mt-2 w-full border border-[#d8d6cf] bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56]" />
        <p className="mt-3 text-sm text-[#646b64]">Dodaj lub zaktualizuj wiedzę w panelu komend, np. „zapamiętaj: szkło pakujemy w kartony Y, strefa C2”, i zatwierdź kartę.</p>
      </div>
      <p className="text-sm text-[#646b64]" role="status">Znaleziono: {filtered.length}</p>
      {filtered.length === 0 ? (
        <p className="border border-[#e8e5de] bg-white p-6 text-sm text-[#646b64]">{procedures.length === 0 ? 'Brak zapisanych procedur. Zatwierdź pierwszą kartę zapamiętania.' : 'Brak procedur pasujących do wyszukiwania.'}</p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((procedure) => (
            <li key={procedure.id} className="border border-[#e8e5de] bg-white p-5">
              <h2 className="text-lg font-bold">{procedure.topic}</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#454b46]">{procedure.text}</p>
              <ProcedureLocation procedure={procedure} zones={zones} items={items} onShowZone={onShowZone} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
