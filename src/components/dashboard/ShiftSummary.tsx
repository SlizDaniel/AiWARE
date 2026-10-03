import { useState } from 'react'
import type { ShiftSummaryResponse } from '@/lib/dashboard'
import { fetchShift, formatDateTime, isoToZonedInput, shiftWindow } from '@/lib/dashboardApi'
import { BlockError, Card, EmptyNote, inputClass, labelClass, Loading, secondaryButton, Tile } from './ui'
import { useRemote } from './useRemote'

type Props = {
  refreshToken: string
  /** strefa magazynu (z podsumowania); odpowiedź zmiany niesie własną */
  timezone: string
  onForbidden: () => void
}

const segment = (active: boolean) =>
  'border px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] ' +
  (active ? 'border-[#315b37] bg-[#315b37] text-white' : 'border-[#d8d6cf] bg-white text-[#646b64] hover:bg-[#f8f7f3]')

/** G: przekazanie zmiany — ostatnie 8 h albo własne godziny (strefa magazynu). */
export default function ShiftSummary({ refreshToken, timezone, onForbidden }: Props) {
  const [custom, setCustom] = useState(false)
  const [startInput, setStartInput] = useState('')
  const [endInput, setEndInput] = useState('')
  const [formError, setFormError] = useState('')
  const [applied, setApplied] = useState<{ start: string; end: string } | null>(null)

  const remote = useRemote<ShiftSummaryResponse>(
    (signal) => fetchShift(applied, signal),
    JSON.stringify(applied),
    refreshToken,
    onForbidden,
  )
  const data = remote.data
  const zone = data?.window.timezone ?? timezone

  const chooseLast8h = () => {
    setCustom(false)
    setApplied(null)
    setFormError('')
  }

  const chooseCustom = () => {
    setCustom(true)
    // start od bieżącego okna, żeby było co poprawić
    if (!startInput && data) {
      setStartInput(isoToZonedInput(data.window.start, zone))
      setEndInput(isoToZonedInput(data.window.end, zone))
    }
  }

  const apply = () => {
    const result = shiftWindow(startInput, endInput, zone)
    if ('error' in result) {
      setFormError(result.error)
      return
    }
    setFormError('')
    setApplied(result)
  }

  return (
    <Card
      title="Przekazanie zmiany"
      subtitle="Podsumowanie zapisanej pracy w oknie czasu — nie jest ewidencją czasu pracy ani oceną osób."
      busy={remote.loading}
      actions={
        <div className="flex" role="group" aria-label="Okno zmiany">
          <button type="button" aria-pressed={!custom} onClick={chooseLast8h} className={segment(!custom)}>
            Ostatnie 8 h
          </button>
          <button type="button" aria-pressed={custom} onClick={chooseCustom} className={segment(custom) + ' -ml-px'}>
            Własne godziny
          </button>
        </div>
      }
    >
      {custom && (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault()
            apply()
          }}
        >
          <label className={labelClass}>
            Początek ({zone})
            <input type="datetime-local" value={startInput} onChange={(event) => setStartInput(event.target.value)} className={inputClass} required />
          </label>
          <label className={labelClass}>
            Koniec ({zone})
            <input type="datetime-local" value={endInput} onChange={(event) => setEndInput(event.target.value)} className={inputClass} required />
          </label>
          <button type="submit" className={secondaryButton}>
            Pokaż
          </button>
          <p className="text-xs text-[#70756f] sm:col-span-3">
            Godziny w strefie magazynu {zone}. Początek wliczony, koniec nie; najwyżej 48 h, koniec nie później niż teraz.
          </p>
          {formError && (
            <p className="border border-[#edc8c5] bg-[#fff7f6] px-4 py-3 text-sm text-[#8f3936] sm:col-span-3" role="alert">
              {formError}
            </p>
          )}
        </form>
      )}

      {remote.error !== null && (
        <BlockError error={remote.error} fallback="Nie udało się pobrać podsumowania zmiany." onRetry={remote.retry} kept={Boolean(data)} />
      )}
      {!data && remote.loading && <Loading text="Pobieram podsumowanie zmiany…" />}

      {data && (
        <div className={remote.loading ? 'opacity-60' : ''}>
          <p className="mt-4 text-sm font-semibold text-[#454b46]">
            {formatDateTime(data.window.start, zone)} – {formatDateTime(data.window.end, zone)} <span className="font-normal text-[#70756f]">({zone})</span>
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Pobrania" value={data.metrics.withdrawals} note="liczba operacji" />
            <Tile label="Przyjęcia" value={data.metrics.receipts} note="liczba operacji" />
            <Tile label="Cofnięcia" value={data.metrics.undo_count} note="wpisy korygujące" />
            <Tile label="Wpisy audytu" value={data.metrics.audit_events} note={`w tym import pozycji: ${data.metrics.import_events}`} />
          </dl>

          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div className="min-w-0">
              <h3 className="font-bold">Autorzy zapisów</h3>
              {data.authors.length === 0 ? (
                <EmptyNote>Nikt nie zapisał zmian w tym oknie.</EmptyNote>
              ) : (
                <ul className="mt-3 divide-y divide-[#f0efe9] border border-[#e8e5de]">
                  {data.authors.map((author, index) => (
                    <li key={`${author.actor_id ?? author.actor}-${index}`} className="p-3 text-sm">
                      <p className="truncate font-semibold" title={author.actor}>
                        {author.actor || 'brak autora'}
                        {!author.actor_id && <span className="ml-1 text-xs font-normal text-[#70756f]">(bez konta)</span>}
                      </p>
                      <p className="text-xs text-[#646b64]">
                        zmiany zapasu: <span className="font-semibold tabular-nums">{author.stock_changes}</span> · cofnięcia:{' '}
                        <span className="font-semibold tabular-nums">{author.undo_count}</span>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {data.authors_truncated && <p className="mt-2 text-xs text-[#70756f]">Pokazano pierwszych 100 autorów.</p>}
            </div>
            <div className="min-w-0">
              <h3 className="font-bold">Zapisane procedury</h3>
              {data.procedures_saved.length === 0 ? (
                <EmptyNote>Brak nowych lub zmienionych procedur.</EmptyNote>
              ) : (
                <ul className="mt-3 divide-y divide-[#f0efe9] border border-[#e8e5de]">
                  {data.procedures_saved.map((procedure) => (
                    <li key={procedure.audit_id} className="p-3 text-sm">
                      <p className="truncate font-semibold" title={procedure.topic}>{procedure.topic}</p>
                      <p className="text-xs text-[#70756f]">
                        {procedure.actor || 'brak autora'} · {formatDateTime(procedure.ts, zone)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {data.procedures_truncated && <p className="mt-2 text-xs text-[#70756f]">Pokazano 10 najnowszych zapisów.</p>}
            </div>
          </div>

          <p className="mt-4 text-xs text-[#70756f]">
            Stan teraz: {data.current.total_items} towarów · {data.current.below_minimum} poniżej minimum · {data.current.pending_drafts} oczekujących
            szkiców · {data.current.missing_location} bez lokalizacji.
          </p>
        </div>
      )}
    </Card>
  )
}
