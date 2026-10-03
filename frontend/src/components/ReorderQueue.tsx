import { useState } from 'react'
import { approveReorderDraft, rejectReorderDraft, type ReorderDraft } from '../api'

type Props = {
  drafts: ReorderDraft[]
  onChanged: (message: string) => void
}

const STATUS_LABEL: Record<ReorderDraft['status'], string> = {
  pending: 'Czeka na decyzję',
  approved: 'Zatwierdzono · bez wysyłki do ERP',
  rejected: 'Odrzucono',
}

function formatDeliveryDate(value: string): string {
  const date = new Date(`${value}T12:00:00`)
  return new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }).format(date)
}

export default function ReorderQueue({ drafts, onChanged }: Props) {
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const decide = async (draft: ReorderDraft, decision: 'approve' | 'reject') => {
    if (busyId !== null) return
    setBusyId(draft.id)
    setError(null)
    try {
      if (decision === 'approve') {
        await approveReorderDraft(draft.id)
        onChanged(`Zatwierdzono szkic zamówienia dla: ${draft.item_name}. Niczego nie wysłano do ERP.`)
      } else {
        await rejectReorderDraft(draft.id)
        onChanged(`Odrzucono szkic zamówienia dla: ${draft.item_name}. Decyzja trafiła do Historii.`)
      }
    } catch {
      setError('Nie udało się zapisać decyzji. Odśwież kolejkę i spróbuj ponownie.')
    } finally {
      setBusyId(null)
    }
  }

  if (drafts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        Brak szkiców zamówień. Agent zaproponuje zamówienie, gdy stan spadnie poniżej minimum.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {error && <p role="alert" className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
      {drafts.map((draft) => (
        <article key={draft.id} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold">{draft.item_name}</h3>
              <p className="mt-1 text-sm text-slate-600">
                Zamówić <strong>{draft.quantity} {draft.unit}</strong> · dostawa: {formatDeliveryDate(draft.deliver_on)}
              </p>
            </div>
            <span className={
              'rounded-full px-3 py-1 text-xs font-bold ' +
              (draft.status === 'pending'
                ? 'bg-amber-100 text-amber-800'
                : draft.status === 'approved'
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-slate-100 text-slate-600')
            }>
              {STATUS_LABEL[draft.status]}
            </span>
          </div>
          {draft.status === 'pending' && (
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                onClick={() => void decide(draft, 'approve')}
                disabled={busyId !== null}
                className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Zatwierdź szkic
              </button>
              <button
                onClick={() => void decide(draft, 'reject')}
                disabled={busyId !== null}
                className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
              >
                Odrzuć
              </button>
            </div>
          )}
        </article>
      ))}
    </div>
  )
}
