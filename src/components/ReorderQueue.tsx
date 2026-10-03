import { useState } from 'react'
import { approveReorderDraft, rejectReorderDraft, type ReorderDraft } from '@/lib/api'

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
  const [busyId, setBusyId] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'pending' | 'decided' | 'all'>('pending')
  const pendingCount = drafts.filter((draft) => draft.status === 'pending').length
  const visibleDrafts = drafts.filter((draft) =>
    filter === 'all' || (filter === 'pending' ? draft.status === 'pending' : draft.status !== 'pending'),
  )

  const decide = async (draft: ReorderDraft, decision: 'approve' | 'reject') => {
    if (busyId !== null || !canDecide) return
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

  if (state === 'loading') {
    return <div className="border border-[#e8e5de] bg-white p-6 text-sm text-[#646b64]" role="status">Pobieram kolejkę zatwierdzeń…</div>
  }

  if (state === 'error') {
    return (
      <div className="border border-[#edc8c5] bg-[#fff7f6] p-6" role="alert">
        <p className="font-semibold text-[#8f3936]">Nie udało się pobrać kolejki zatwierdzeń.</p>
        {error && <p className="mt-1 text-sm text-[#8f3936]">{error}</p>}
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 border border-[#d8a9a5] bg-white px-4 py-2 text-sm font-semibold text-[#8f3936] hover:bg-[#fdebec] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8f3936]"
        >
          Spróbuj ponownie
        </button>
      </div>
    )
  }

  if (drafts.length === 0) {
    return <div className="border border-dashed border-[#d8d6cf] bg-[#fbfaf7] p-8 text-center text-sm text-[#70756f]">
      Brak szkiców zamówień. Agent zaproponuje zamówienie, gdy stan spadnie poniżej minimum.
    </div>
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtr szkiców zamówień">
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
            className={
              'border px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] ' +
              (filter === value ? 'border-[#315b37] bg-[#315b37] text-white' : 'border-[#d8d6cf] bg-white text-[#646b64] hover:bg-[#f8f7f3]')
            }
          >
            {label} ({count})
          </button>
        ))}
      </div>
      {actionError && (
        <p role="alert" className="border border-[#edc8c5] bg-[#fff7f6] px-4 py-3 text-sm text-[#8f3936]">
          Nie udało się zapisać decyzji: {actionError}. Spróbuj ponownie przyciskiem decyzji.
        </p>
      )}
      {visibleDrafts.length === 0 && (
        <p role="status" className="border border-dashed border-[#d8d6cf] bg-[#fbfaf7] p-8 text-center text-sm text-[#70756f]">
          {filter === 'pending'
            ? 'Nie ma szkiców czekających na decyzję. Dotychczasowe decyzje znajdziesz w filtrze Rozpatrzone.'
            : 'Nie ma jeszcze rozpatrzonych szkiców zamówień.'}
        </p>
      )}
      {visibleDrafts.map((draft) => (
        <article key={draft.id} className="border border-[#e8e5de] bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold">{draft.item_name}</h3>
              <p className="mt-1 text-sm text-[#646b64]">
                Zamówić <strong>{draft.quantity} {draft.unit}</strong> · dostawa: {formatDeliveryDate(draft.deliver_on)}
              </p>
            </div>
            <span className={
              'px-3 py-1 text-xs font-bold ' +
              (draft.status === 'pending'
                ? 'bg-[#fbf3db] text-[#805c12]'
                : draft.status === 'approved'
                  ? 'bg-[#edf3ec] text-[#315b37]'
                  : 'bg-[#f0efe9] text-[#646b64]')
            }>
              {STATUS_LABEL[draft.status]}
            </span>
          </div>
          {draft.status === 'pending' && (
            <div className="mt-4">
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void decide(draft, 'approve')}
                  disabled={busyId !== null || !canDecide}
                  title={canDecide ? undefined : DECISION_LOCKED}
                  aria-describedby={canDecide ? undefined : `reorder-locked-${draft.id}`}
                  className="bg-[#315b37] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#274a2d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busyId === draft.id ? 'Zapisuję…' : 'Zatwierdź szkic'}
                </button>
                <button
                  type="button"
                  onClick={() => void decide(draft, 'reject')}
                  disabled={busyId !== null || !canDecide}
                  title={canDecide ? undefined : DECISION_LOCKED}
                  aria-describedby={canDecide ? undefined : `reorder-locked-${draft.id}`}
                  className="border border-[#d8d6cf] bg-white px-5 py-2.5 text-sm font-semibold text-[#646b64] hover:bg-[#f8f7f3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busyId === draft.id ? 'Zapisuję…' : 'Odrzuć'}
                </button>
              </div>
              {!canDecide && (
                <p id={`reorder-locked-${draft.id}`} className="mt-2 text-xs text-[#70756f]">
                  {DECISION_LOCKED} — szkic czeka w kolejce na jego zatwierdzenie.
                </p>
              )}
            </div>
          )}
        </article>
      ))}
    </div>
  )
}
