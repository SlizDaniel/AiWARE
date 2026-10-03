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

type State =
  | { kind: 'proposal'; proposal: Proposal }
  | { kind: 'answer'; tool: string; text: string }
  | { kind: 'clarify'; message: string }
  | { kind: 'unknown'; text: string; hints?: string[] }
  | { kind: 'error'; message: string }
  | null

export default function CommandPanel({ onApplied }: Props) {
  const [text, setText] = useState('')
  const [state, setState] = useState<State>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

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
    setActionError('')
    try {
      const res = await sendCommand(t)
      setResponseWarning(res.warning ?? null)
      if (res.type === 'proposal') setState({ kind: 'proposal', proposal: res.proposal })
      else if (res.type === 'answer') setState({ kind: 'answer', tool: res.tool, text: res.text })
      else if (res.type === 'clarify') setState({ kind: 'clarify', message: res.message })
      else setState({ kind: 'unknown', text: res.text, hints: res.hints })
    } catch (error) {
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Nie udało się połączyć z magazynem.',
      })
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!state || state.kind !== 'proposal' || busy) return
    setBusy(true)
    setActionError('')
    try {
      const result = await confirmProposal(state.proposal.id)
      onApplied(state.proposal.summary, result.reorder_draft ?? null)
      setState(null)
      setText('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Nie udało się zapisać zmiany.')
    } finally {
      setBusy(false)
    }
  }

  const reject = () => {
    setState(null)
    setActionError('')
    setText('')
  }

  return (
    <section className="border border-[#e8e5de] bg-white p-5 sm:p-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <h2 className="text-lg font-bold">Powiedz Magazynierowi, co robisz</h2>
        <label className="flex items-center gap-2 text-sm text-[#70756f]">
          Tryb agenta
          <select
            value={mode}
            onChange={(event) => void changeMode(event.target.value as AgentMode)}
            className="border border-[#d8d6cf] bg-white px-2 py-1"
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
        <label htmlFor="inventory-command" className="sr-only">Komenda magazynowa</label>
        <input
          id="inventory-command"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='np. „wzięliśmy paletę kartonów”'
          className="min-w-0 flex-1 border border-[#d8d6cf] px-4 py-3 text-base outline-none focus-visible:border-[#536b56] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#536b56]"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="bg-[#292d2b] px-6 py-3 font-semibold text-white transition-colors hover:bg-[#454b46] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Przetwarzam…' : 'Wyślij'}
        </button>
      </form>

      {responseWarning && <p className="mt-3 text-sm text-amber-700">{responseWarning}</p>}
      {state?.kind === 'proposal' && (
        <ChangeCard proposal={state.proposal} busy={busy} error={actionError} onConfirm={confirm} onReject={reject} />
      )}
      {state?.kind === 'answer' && (
        <div className="mt-5 border border-[#cbd8c9] bg-[#f6f8f4] p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="font-semibold text-[#315b37]">Odpowiedź</div>
            <span className="border border-[#e8e5de] bg-white px-3 py-1 font-mono text-xs text-[#777b74]">{state.tool}</span>
          </div>
          <p className="mt-2 text-base text-[#454b46]">{state.text}</p>
        </div>
      )}
      {state?.kind === 'clarify' && (
        <div className="mt-5 border border-[#ead9a9] bg-[#fffaf0] p-5">
          <div className="font-semibold text-[#805c12]">Doprecyzujmy</div>
          <p className="mt-1 text-sm text-[#805c12]">{state.message}</p>
        </div>
      )}
      {state?.kind === 'unknown' && (
        <div className="mt-5 border border-[#ead9a9] bg-[#fffaf0] p-5">
          <div className="font-semibold text-[#805c12]">Nie rozumiem tej komendy</div>
          <p className="mt-1 text-sm text-[#805c12]">{state.text}</p>
          {state.hints && state.hints.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {state.hints.map((hint) => <li key={hint} className="border border-[#ead9a9] bg-white px-3 py-1 font-mono text-xs text-[#805c12]">{hint}</li>)}
            </ul>
          )}
        </div>
      )}
      {state?.kind === 'error' && (
        <div className="mt-5 border border-[#edc8c5] bg-[#fff7f6] p-5" role="alert">
          <p className="font-semibold text-[#8f3936]">Nie udało się wysłać komendy.</p>
          <p className="mt-1 text-sm text-[#8f3936]">{state.message}</p>
          <button
            type="button"
            onClick={() => void submit()}
            className="mt-4 border border-[#d8a9a5] bg-white px-4 py-2 text-sm font-semibold text-[#8f3936] hover:bg-[#fdebec] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8f3936]"
          >
            Spróbuj ponownie
          </button>
        </div>
      )}
    </section>
  )
}

function ChangeCard({
  proposal,
  busy,
  error,
  onConfirm,
  onReject,
}: {
  proposal: Proposal
  busy: boolean
  error: string
  onConfirm: () => void
  onReject: () => void
}) {
  return (
    <div className="mt-5 border border-[#cbd8c9] bg-[#f6f8f4] p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-[#536b56]">
          Karta zmiany — czeka na zatwierdzenie
        </span>
        <span className="border border-[#e8e5de] bg-white px-3 py-1 font-mono text-xs text-[#777b74]">
          {proposal.tool}
        </span>
      </div>

      {proposal.tool === 'update_stock' ? <StockChange proposal={proposal} /> : <GenericChange proposal={proposal} />}

      <p className="mt-3 text-sm text-[#646b64]">
        Usłyszałem: <span className="font-semibold text-[#454b46]">„{proposal.text}”</span>. Nic nie
        zostało zapisane — zatwierdź, aby wykonać zmianę i dodać wpis w historii.
      </p>

      {error && <p className="mt-3 border border-[#edc8c5] bg-[#fff7f6] p-3 text-sm text-[#8f3936]" role="alert">Nie zapisano zmiany: {error}</p>}

      <div className="mt-4 flex gap-3">
        <button
          onClick={onConfirm}
          disabled={busy}
          className="bg-[#315b37] px-8 py-3 text-base font-bold text-white transition-colors hover:bg-[#274a2d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Zapisuję…' : 'Zatwierdź'}
        </button>
        <button
          onClick={onReject}
          disabled={busy}
          className="border border-[#d8d6cf] bg-white px-6 py-3 text-base font-semibold text-[#646b64] transition-colors hover:bg-[#f8f7f3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Odrzuć
        </button>
      </div>
    </div>
  )
}

function StockChange({ proposal }: { proposal: Proposal }) {
  const delta = proposal.delta ?? 0
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="text-3xl font-bold">{proposal.item_name ?? 'Pozycja'}</span>
      <span className="text-3xl font-bold text-[#70756f]">{proposal.before ?? '—'}</span>
      <span className="text-2xl font-bold text-[#777b74]">→</span>
      <span className="text-3xl font-extrabold text-[#315b37]">{proposal.after ?? '—'}</span>
      <span className={'px-3 py-1 text-sm font-bold ' + (delta < 0 ? 'bg-[#fdebec] text-[#8f3936]' : 'bg-[#edf3ec] text-[#315b37]')}>
        {delta > 0 ? `+${delta}` : delta} {proposal.unit ?? ''}
      </span>
    </div>
  )
}

function GenericChange({ proposal }: { proposal: Proposal }) {
  return <p className="mt-3 text-2xl font-bold text-[#315b37]">{proposal.summary}</p>
}
