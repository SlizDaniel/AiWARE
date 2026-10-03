import { useEffect, useState } from 'react'
import {
  confirmProposal,
  fetchAgentMode,
  sendCommand,
  updateAgentMode,
  type AgentMode,
  type Proposal,
  type ReorderDraft,
} from '../api'

type Props = {
  onApplied: (summary: string, reorderDraft: ReorderDraft | null) => void
}

type Unknown = { kind: 'unknown'; text: string; hints?: string[] }
type Answer = { kind: 'answer'; tool: string; text: string }
type Clarify = { kind: 'clarify'; message: string }
type State =
  | { kind: 'proposal'; proposal: Proposal }
  | Answer
  | Clarify
  | Unknown
  | null

export default function CommandPanel({ onApplied }: Props) {
  const [text, setText] = useState('')
  const [state, setState] = useState<State>(null)
  const [busy, setBusy] = useState(false)

  const [responseWarning, setResponseWarning] = useState<string | null>(null)
  const [mode, setMode] = useState<AgentMode>('llm')
  const [modeWarning, setModeWarning] = useState<string | null>(null)

  useEffect(() => {
    void fetchAgentMode()
      .then((status) => {
        setMode(status.mode)
        setModeWarning(status.warning)
      })
      .catch(() => setModeWarning('Nie udało się pobrać trybu agenta.'))
  }, [])

  const changeMode = async (nextMode: AgentMode) => {
    setMode(nextMode)
    try {
      const status = await updateAgentMode(nextMode)
      setMode(status.mode)
      setModeWarning(status.warning)
    } catch {
      setModeWarning('Nie udało się zmienić trybu agenta.')
    }
  }

  const submit = async () => {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true)
    try {
      const res = await sendCommand(t)
      setResponseWarning(res.warning ?? null)
      if (res.type === 'proposal') setState({ kind: 'proposal', proposal: res.proposal })
      else if (res.type === 'answer') setState({ kind: 'answer', tool: res.tool, text: res.text })
      else if (res.type === 'clarify') setState({ kind: 'clarify', message: res.message })
      else setState({ kind: 'unknown', text: res.text, hints: res.hints })
    } catch {
      // brak połączenia z backendem — nie mylić z „nie rozumiem komendy”
      setState({ kind: 'clarify', message: 'Nie udało się połączyć z backendem. Sprawdź, czy serwer działa, i spróbuj ponownie.' })
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!state || state.kind !== 'proposal' || busy) return
    setBusy(true)
    try {
      const result = await confirmProposal(state.proposal.id)
      onApplied(state.proposal.summary, result.reorder_draft ?? null)
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
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Tryb agenta
          <select
            value={mode}
            onChange={(event) => void changeMode(event.target.value as AgentMode)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1"
            aria-label="Tryb agenta"
          >
            <option value="llm">LLM</option>
            <option value="offline">Offline</option>
            <option value="mock">Mock</option>
          </select>
        </label>
      </div>

      {modeWarning && <p className="mt-2 text-sm text-amber-700">{modeWarning}</p>}
      <p className="mt-1 text-xs text-slate-400">Komenda tekstowa · głos (STT) w kolejnej karcie</p>

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

      {responseWarning && <p className="mt-3 text-sm text-amber-700">{responseWarning}</p>}
      {state?.kind === 'proposal' && (
        <ChangeCard proposal={state.proposal} busy={busy} onConfirm={confirm} onReject={reject} />
      )}
      {state?.kind === 'answer' && (
        <div className="mt-5 rounded-xl border border-sky-300 bg-sky-50 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="font-semibold text-sky-900">Odpowiedź</div>
            <span className="rounded-full bg-white px-3 py-1 font-mono text-xs text-slate-500 ring-1 ring-slate-200">
              {state.tool}
            </span>
          </div>
          <p className="mt-2 text-base text-slate-800">{state.text}</p>
        </div>
      )}
      {state?.kind === 'clarify' && (
        <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-5">
          <div className="font-semibold text-amber-900">Doprecyzujmy</div>
          <p className="mt-1 text-sm text-amber-800">{state.message}</p>
        </div>
      )}
      {state?.kind === 'unknown' && (
        <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-5">
          <div className="font-semibold text-amber-900">Nie rozumiem tej komendy</div>
          <p className="mt-1 text-sm text-amber-800">
            Agent nie zgaduje po cichu — sformułuj inaczej albo spróbuj jednej z komend demo:
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {(state.hints ?? []).map((h) => (
              <li
                key={h}
                className="rounded-full bg-white px-3 py-1 font-mono text-xs text-slate-600 ring-1 ring-amber-200"
              >
                {h}
              </li>
            ))}
          </ul>
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
  return (
    <div className="mt-5 rounded-xl border-2 border-indigo-400 bg-indigo-50/60 p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-indigo-600">
          Karta zmiany — czeka na zatwierdzenie
        </span>
        <span className="rounded-full bg-white px-3 py-1 font-mono text-xs text-slate-500 ring-1 ring-slate-200">
          {proposal.tool}
        </span>
      </div>

      {proposal.tool === 'update_stock' ? <StockChange proposal={proposal} /> : <GenericChange proposal={proposal} />}

      <p className="mt-3 text-sm text-slate-600">
        Usłyszałem: <span className="font-semibold text-slate-800">„{proposal.text}”</span>. Nic nie
        zostało zapisane — zatwierdź, aby wykonać zmianę w bazie i dodać wpis w historii.
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

function StockChange({ proposal }: { proposal: Proposal }) {
  const delta = proposal.delta ?? 0
  const sign = delta > 0 ? `+${delta}` : `${delta}`
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="text-3xl font-bold">{proposal.item_name}</span>
      <span className="text-3xl font-bold text-slate-400">{proposal.before}</span>
      <span className="text-2xl font-bold text-indigo-500">→</span>
      <span className="text-3xl font-extrabold text-indigo-700">{proposal.after}</span>
      <span
        className={
          'rounded-full px-3 py-1 text-sm font-bold ' +
          (delta < 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700')
        }
      >
        {sign} {proposal.unit}
      </span>
    </div>
  )
}

function GenericChange({ proposal }: { proposal: Proposal }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="text-2xl font-bold text-indigo-700">{proposal.summary}</span>
    </div>
  )
}
