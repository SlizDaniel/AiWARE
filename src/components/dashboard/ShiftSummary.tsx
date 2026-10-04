import { useState } from 'react'
import type { ShiftSummaryResponse } from '@/lib/dashboard'
import { fetchShift, formatDateTime, isoToZonedInput, shiftWindow } from '@/lib/dashboardApi'
import { Notice } from '../ui/feedback'
import { buttonClass, segmentClass, segmentGroupClass } from '../ui/styles'
import { BlockError, Card, EmptyNote, Field, inputClass, Loading, plural, ReadoutLine } from './ui'
import { useRemote } from './useRemote'

type Props = {
  refreshToken: string
  /** strefa magazynu (z podsumowania); odpowiedź zmiany niesie własną */
  timezone: string
  onForbidden: () => void
  /** osadzony w panelu z przełącznikiem widoków (bez własnej powierzchni) */
  embedded?: boolean
}

/** G: przekazanie zmiany — ostatnie 8 h albo własne godziny (strefa magazynu). */
export default function ShiftSummary({ refreshToken, timezone, onForbidden, embedded = false }: Props) {
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

  const hasTop = custom || remote.error !== null || (!data && remote.loading)

  return (
    <Card
      title="Przekazanie zmiany"
      subtitle="Podsumowanie zapisanej pracy w oknie czasu — nie jest ewidencją czasu pracy ani oceną osób."
      busy={remote.loading}
      flush
      bare={embedded}
      actions={
        <div className={segmentGroupClass} role="group" aria-label="Okno zmiany">
          <button type="button" aria-pressed={!custom} onClick={chooseLast8h} className={segmentClass(!custom)}>
            Ostatnie 8 h
          </button>
          <button type="button" aria-pressed={custom} onClick={chooseCustom} className={segmentClass(custom)}>
            Własne godziny
          </button>
        </div>
      }
    >
      {hasTop && (
        <div className={'space-y-4 px-6 pt-5 ' + (data ? '' : 'pb-6')}>
          {custom && (
            <form
              className="grid gap-4 @lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] @lg:items-end"
              onSubmit={(event) => {
                event.preventDefault()
                apply()
              }}
            >
              <Field label={`Początek (${zone})`}>
                <input type="datetime-local" value={startInput} onChange={(event) => setStartInput(event.target.value)} className={inputClass} required />
              </Field>
              <Field label={`Koniec (${zone})`}>
                <input type="datetime-local" value={endInput} onChange={(event) => setEndInput(event.target.value)} className={inputClass} required />
              </Field>
              <button type="submit" className={buttonClass('secondary', 'md')}>
                Pokaż
              </button>
              <p className="text-xs text-mute @lg:col-span-3">
                Godziny w strefie magazynu {zone}. Początek wliczony, koniec nie; najwyżej 48 h, koniec nie później niż teraz.
              </p>
              {formError && (
                <Notice tone="alarm" role="alert" className="@lg:col-span-3">
                  {formError}
                </Notice>
              )}
            </form>
          )}

          {remote.error !== null && (
            <BlockError error={remote.error} fallback="Nie udało się pobrać podsumowania zmiany." onRetry={remote.retry} kept={Boolean(data)} />
          )}
          {!data && remote.loading && <Loading text="Pobieram podsumowanie zmiany…" />}
        </div>
      )}

      {data && (
        <div className={'transition-opacity duration-200 ' + (remote.loading ? 'opacity-60' : '')}>
          <div className="space-y-2 px-6 pb-5 pt-5">
            <p className="text-sm font-semibold tabular-nums text-ink">
              {formatDateTime(data.window.start, zone)} – {formatDateTime(data.window.end, zone)}{' '}
              <span className="font-normal text-mute">({zone})</span>
            </p>
            <ReadoutLine
              items={[
                { value: data.metrics.withdrawals, label: plural(data.metrics.withdrawals, 'pobranie', 'pobrania', 'pobrań') },
                { value: data.metrics.receipts, label: plural(data.metrics.receipts, 'przyjęcie', 'przyjęcia', 'przyjęć') },
                { value: data.metrics.undo_count, label: plural(data.metrics.undo_count, 'cofnięcie', 'cofnięcia', 'cofnięć'), note: 'wpisy korygujące' },
                {
                  value: data.metrics.audit_events,
                  label: plural(data.metrics.audit_events, 'wpis audytu', 'wpisy audytu', 'wpisów audytu'),
                  note: `w tym import pozycji: ${data.metrics.import_events}`,
                },
              ]}
            />
          </div>

          <div className="grid border-t border-line @2xl:grid-cols-2">
            <div className="min-w-0 px-6 py-5">
              <h3 className="text-[15px] font-semibold text-ink">Autorzy zapisów</h3>
              {data.authors.length === 0 ? (
                <div className="mt-3">
                  <EmptyNote>Nikt nie zapisał zmian w tym oknie.</EmptyNote>
                </div>
              ) : (
                <ul className="mt-2 divide-y divide-line">
                  {data.authors.map((author, index) => (
                    <li key={`${author.actor_id ?? author.actor}-${index}`} className="py-3 text-sm">
                      <p className="truncate font-semibold text-ink" title={author.actor}>
                        {author.actor || 'brak autora'}
                        {!author.actor_id && <span className="ml-1.5 text-xs font-normal text-mute">(bez konta)</span>}
                      </p>
                      <p className="mt-0.5 text-[13px] text-ink-2">
                        zmiany zapasu: <span className="font-semibold tabular-nums text-ink">{author.stock_changes}</span> · cofnięcia:{' '}
                        <span className="font-semibold tabular-nums text-ink">{author.undo_count}</span>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {data.authors_truncated && <p className="mt-3 text-xs text-mute">Pokazano pierwszych 100 autorów.</p>}
            </div>
            <div className="min-w-0 border-t border-line px-6 py-5 @2xl:border-l @2xl:border-t-0">
              <h3 className="text-[15px] font-semibold text-ink">Zapisane procedury</h3>
              {data.procedures_saved.length === 0 ? (
                <div className="mt-3">
                  <EmptyNote>Brak nowych lub zmienionych procedur.</EmptyNote>
                </div>
              ) : (
                <ul className="mt-2 divide-y divide-line">
                  {data.procedures_saved.map((procedure) => (
                    <li key={procedure.audit_id} className="py-3 text-sm">
                      <p className="truncate font-semibold text-ink" title={procedure.topic}>
                        {procedure.topic}
                      </p>
                      <p className="mt-0.5 text-[13px] text-ink-2">
                        {procedure.actor || 'brak autora'} · <span className="narrow tabular-nums">{formatDateTime(procedure.ts, zone)}</span>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {data.procedures_truncated && <p className="mt-3 text-xs text-mute">Pokazano 10 najnowszych zapisów.</p>}
            </div>
          </div>

          <p className="border-t border-line px-6 py-4 text-xs text-mute">
            Stan teraz: <span className="tabular-nums">{data.current.total_items}</span> towarów ·{' '}
            <span className="tabular-nums">{data.current.below_minimum}</span> poniżej minimum ·{' '}
            <span className="tabular-nums">{data.current.pending_drafts}</span> oczekujących szkiców ·{' '}
            <span className="tabular-nums">{data.current.missing_location}</span> bez lokalizacji.
          </p>
        </div>
      )}
      {!data && !hasTop && <div className="pb-6" />}
    </Card>
  )
}
