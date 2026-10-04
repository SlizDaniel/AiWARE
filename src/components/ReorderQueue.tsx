import { useState } from 'react'
import { approveReorderDraft, rejectReorderDraft, rejectReorderDrafts, type ReorderDraft } from '@/lib/api'
import { EmptyState, LoadError, Notice, Skeleton } from './ui/feedback'
import { CheckIcon } from './ui/icons'
import { StateMark, StateShape, stateTextClass } from './ui/StateMark'
import { buttonClass, panelClass, segmentClass, segmentGroupClass } from './ui/styles'

type Props = {
  drafts: ReorderDraft[]
  state: 'loading' | 'ready' | 'error'
  error: string
  onRetry: () => void
  onChanged: (message: string) => void
  /** Tylko kierownik zatwierdza/odrzuca szkice — pracownik widzi przyciski wyłączone. */
  canDecide: boolean
}

const DECISION_LOCKED = 'Decyzję podejmuje kierownik'

const STATUS_LABEL: Record<ReorderDraft['status'], string> = {
  pending: 'Czeka na decyzję',
  approved: 'Zatwierdzono · bez wysyłki do ERP',
  rejected: 'Odrzucono',
}

function formatDeliveryDate(value: string): string {
  const date = new Date(`${value}T12:00:00`)
  return new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }).format(date)
}

export default function ReorderQueue({ drafts, state, error, onRetry, onChanged, canDecide }: Props) {
  const [clearing, setClearing] = useState(false)
  const [clearIds, setClearIds] = useState<number[] | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'pending' | 'decided' | 'all'>('pending')
  const pendingCount = drafts.filter((draft) => draft.status === 'pending').length
  const visibleDrafts = drafts.filter((draft) =>
    filter === 'all' || (filter === 'pending' ? draft.status === 'pending' : draft.status !== 'pending'),
  )

  const decide = async (draft: ReorderDraft, decision: 'approve' | 'reject') => {
    if (busyId !== null || clearing || !canDecide) return
    setBusyId(draft.id)
    setActionError(null)
    try {
      if (decision === 'approve') {
        await approveReorderDraft(draft.id)
        onChanged(`Zatwierdzono szkic zamówienia dla: ${draft.item_name}. Niczego nie wysłano do ERP.`)
      } else {
        await rejectReorderDraft(draft.id)
        onChanged(`Odrzucono szkic zamówienia dla: ${draft.item_name}. Decyzja trafiła do Historii.`)
      }
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Nie udało się zapisać decyzji.')
    } finally {
      setBusyId(null)
    }
  }

  const clearPending = async () => {
    if (!clearIds || clearing || busyId !== null || !canDecide) return
    setClearing(true)
    setActionError(null)
    try {
      const result = await rejectReorderDrafts(clearIds)
      setClearIds(null)
      onChanged(`Usunięto z kolejki ${result.rejected} szkiców. Decyzje zapisano w Historii.${result.skipped ? ` Pominięto ${result.skipped} szkiców już rozpatrzonych lub nieistniejących.` : ''}`)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Nie udało się wyczyścić kolejki.')
    } finally {
      setClearing(false)
    }
  }

  if (state === 'loading') {
    return <Skeleton rows={3} label="Pobieram kolejkę zatwierdzeń…" />
  }

  if (state === 'error') {
    return <LoadError title="Nie udało się pobrać kolejki zatwierdzeń." detail={error || undefined} onRetry={onRetry} />
  }

  if (drafts.length === 0) {
    return (
      <EmptyState title="Brak szkiców zamówień">
        Agent zaproponuje zamówienie, gdy stan spadnie poniżej minimum.
      </EmptyState>
    )
  }

  return (
    <div className="space-y-5">
      <div className={segmentGroupClass} role="group" aria-label="Filtr szkiców zamówień">
        {([
          ['pending', 'Oczekujące', pendingCount],
          ['decided', 'Rozpatrzone', drafts.length - pendingCount],
          ['all', 'Wszystkie', drafts.length],
        ] as const).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={segmentClass(filter === value)}
          >
            {label} <span className="tabular-nums">({count})</span>
          </button>
        ))}
      </div>

      {pendingCount > 0 && (
        <div className="space-y-3">
          <button type="button" className={buttonClass('danger')}
            disabled={busyId !== null || clearing || !canDecide || clearIds !== null}
            title={canDecide ? undefined : DECISION_LOCKED}
            onClick={() => { setActionError(null); setClearIds(drafts.filter(d => d.status === 'pending').slice(0, 1000).map(d => d.id)) }}>
            Usuń {pendingCount > 1000 ? 'pierwsze 1000' : 'wszystkie oczekujące'} ({Math.min(pendingCount, 1000)})
          </button>
          {!canDecide && <p className="text-sm text-mute">{DECISION_LOCKED} — poproś go o wyczyszczenie kolejki.</p>}
          {clearIds !== null && (
            <Notice tone="warn" role="status" aria-label="Potwierdź usunięcie szkiców z kolejki">
              <p>Usunąć z kolejki {clearIds.length} oczekujących szkiców? Trafią do Rozpatrzonych jako odrzucone. Historia i stany pozostaną zachowane.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={buttonClass('danger')} disabled={clearing || !canDecide}
                  onClick={() => void clearPending()}>{clearing ? 'Usuwam…' : 'Tak, usuń z kolejki'}</button>
                <button type="button" className={buttonClass('secondary')} disabled={clearing}
                  onClick={() => setClearIds(null)}>Anuluj</button>
              </div>
            </Notice>
          )}
        </div>
      )}

      {actionError && (
        <Notice tone="alarm" role="alert">
          Nie udało się zapisać decyzji: {actionError}. Spróbuj ponownie lub anuluj operację.
        </Notice>
      )}

      {visibleDrafts.length === 0 ? (
        filter === 'pending' ? (
          <EmptyState title="Nie ma szkiców czekających na decyzję.">
            Dotychczasowe decyzje znajdziesz w filtrze Rozpatrzone.
          </EmptyState>
        ) : (
          <EmptyState title="Nie ma jeszcze rozpatrzonych szkiców zamówień." />
        )
      ) : (
        <ul className={panelClass + ' divide-y divide-line'}>
          {visibleDrafts.map((draft) =>
            draft.status === 'pending' ? (
              <li key={draft.id} className="px-5 py-6 sm:px-6">
                <article aria-labelledby={`reorder-draft-${draft.id}`}>
                  <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <StateShape kind="decision" size={12} />
                        <h3 id={`reorder-draft-${draft.id}`} className="text-lg font-semibold leading-snug text-ink">
                          {draft.item_name}
                        </h3>
                        <span className="narrow text-sm tabular-nums text-mute">#{draft.id}</span>
                        <span className={'text-[13px] font-semibold ' + stateTextClass('decision')}>{STATUS_LABEL.pending}</span>
                      </div>
                      <dl className="mt-4 flex flex-wrap gap-x-12 gap-y-4 pl-[24px]">
                        <div>
                          <dt className="label-caps">Zamówić</dt>
                          <dd className="mt-1.5 flex items-baseline gap-1.5">
                            <span className="text-[32px] font-semibold leading-none tracking-[-0.01em] tabular-nums text-ink">
                              {draft.quantity}
                            </span>
                            <span className="text-base text-ink-2">{draft.unit}</span>
                          </dd>
                        </div>
                        <div>
                          <dt className="label-caps">Dostawa</dt>
                          <dd className="mt-1.5 text-base font-medium text-ink">{formatDeliveryDate(draft.deliver_on)}</dd>
                        </div>
                      </dl>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void decide(draft, 'approve')}
                        disabled={busyId !== null || clearing || clearIds !== null || !canDecide}
                        title={canDecide ? undefined : DECISION_LOCKED}
                        aria-describedby={canDecide ? undefined : `reorder-locked-${draft.id}`}
                        className={buttonClass('action')}
                      >
                        <CheckIcon size={18} />
                        {busyId === draft.id ? 'Zapisuję…' : 'Zatwierdź szkic'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void decide(draft, 'reject')}
                        disabled={busyId !== null || clearing || clearIds !== null || !canDecide}
                        title={canDecide ? undefined : DECISION_LOCKED}
                        aria-describedby={canDecide ? undefined : `reorder-locked-${draft.id}`}
                        className={buttonClass('danger')}
                      >
                        {busyId === draft.id ? 'Zapisuję…' : 'Usuń z kolejki'}
                      </button>
                    </div>
                  </div>
                  {!canDecide && (
                    <p id={`reorder-locked-${draft.id}`} className="mt-4 text-[13px] text-mute sm:text-right">
                      {DECISION_LOCKED} — szkic czeka w kolejce na jego zatwierdzenie.
                    </p>
                  )}
                </article>
              </li>
            ) : (
              <li key={draft.id} className="px-5 py-4 sm:px-6">
                <article
                  aria-labelledby={`reorder-draft-${draft.id}`}
                  className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2"
                >
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 id={`reorder-draft-${draft.id}`} className="font-semibold text-ink-2">
                      {draft.item_name}
                    </h3>
                    <span className="narrow text-sm tabular-nums text-mute">#{draft.id}</span>
                    <span className="text-sm text-mute">
                      Zamówić <span className="tabular-nums">{draft.quantity}</span> {draft.unit} · dostawa: {formatDeliveryDate(draft.deliver_on)}
                    </span>
                  </div>
                  <StateMark kind={draft.status === 'approved' ? 'ok' : 'alarm'}>{STATUS_LABEL[draft.status]}</StateMark>
                </article>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  )
}
