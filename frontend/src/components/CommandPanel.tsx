import { useState } from 'react'
import { confirmProposal, sendCommand, type Proposal, type ReorderDraft } from '../api'

type Props = {
  onApplied: (summary: string, reorderDraft: ReorderDraft | null) => void
}

type Unknown = { kind: 'unknown'; text: string }
type State = { kind: 'proposal'; proposal: Proposal } | Unknown | null

export default function CommandPanel({ onApplied }: Props) {
  const [text, setText] = useState('')
  const [state, setState] = useState<State>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true)
    try {
      const res = await sendCommand(t)
      if (res.type === 'proposal') setState({ kind: 'proposal', proposal: res.proposal })
      else setState({ kind: 'unknown', text: res.text })
    } catch {
      setState({ kind: 'unknown', text: t })
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!state || state.kind !== 'proposal' || busy) return
    setBusy(true)
    try {
      const result = await confirmProposal(state.proposal.id)
      onApplied(state.proposal.summary, result.reorder_draft)
      setState(null)
      setText('')
    } finally {
      setBusy(false)
    }
  }

  const reject = () => {
    setState(null)
    setText('')
  }

  return (
    <section className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-bold">Powiedz Magazynierowi, co robisz</h2>
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
          tryb tekstowy · głos (STT) w kolejnej karcie
        </span>
      </div>

      <form
        className="mt-4 flex gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='np. „wzięliśmy paletę kartonów”'
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-4 py-3 text-base outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="rounded-lg bg-indigo-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Wyślij
        </button>
      </form>

      {state?.kind === 'proposal' && (
        <ChangeCard proposal={state.proposal} busy={busy} onConfirm={confirm} onReject={reject} />
      )}
      {state?.kind === 'unknown' && (
        <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-5">
          <div className="font-semibold text-amber-900">Nie rozumiem tej komendy</div>
          <p className="mt-1 text-sm text-amber-800">
            W tym tracerze rozumiem na seedowanych pozycjach:{' '}
            <span className="font-mono">„wzięliśmy paletę X”</span> oraz{' '}
            <span className="font-mono">„doszła paleta X”</span>, gdzie X to np. kartony, szkło, folia.
          </p>
        </div>
      )}
    </section>
  )
}

function ChangeCard({
  proposal,
  busy,
  onConfirm,
  onReject,
}: {
  proposal: Proposal
  busy: boolean
  onConfirm: () => void
  onReject: () => void
}) {
  const sign = proposal.delta > 0 ? `+${proposal.delta}` : `${proposal.delta}`
  return (
    <div className="mt-5 rounded-xl border-2 border-indigo-400 bg-indigo-50/60 p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-indigo-600">
          Karta zmiany — czeka na zatwierdzenie
        </span>
        <span className="rounded-full bg-white px-3 py-1 font-mono text-xs text-slate-500 ring-1 ring-slate-200">
          update_stock
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-3xl font-bold">{proposal.item_name}</span>
        <span className="text-3xl font-bold text-slate-400">{proposal.before}</span>
        <span className="text-2xl font-bold text-indigo-500">→</span>
        <span className="text-3xl font-extrabold text-indigo-700">{proposal.after}</span>
        <span
          className={
            'rounded-full px-3 py-1 text-sm font-bold ' +
            (proposal.delta < 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700')
          }
        >
          {sign} {proposal.unit}
        </span>
      </div>

      <p className="mt-3 text-sm text-slate-600">
        Usłyszałem: <span className="font-semibold text-slate-800">„{proposal.text}”</span>. Nic nie
        zostało zapisane — zatwierdź, aby zmienić stan w bazie i dodać wpis w historii.
      </p>

      <div className="mt-4 flex gap-3">
        <button
          onClick={onConfirm}
          disabled={busy}
          className="rounded-lg bg-emerald-600 px-8 py-3 text-base font-bold text-white shadow transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Zatwierdź
        </button>
        <button
          onClick={onReject}
          disabled={busy}
          className="rounded-lg bg-white px-6 py-3 text-base font-semibold text-slate-600 ring-1 ring-slate-300 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Odrzuć
        </button>
      </div>
    </div>
  )
}
