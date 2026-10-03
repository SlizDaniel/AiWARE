import { useEffect, useRef, useState } from 'react'
import {
  confirmProposal,
  fetchZones,
  sendCommand,
  transcribeAudio,
  updateAgentMode,
  type AgentMode,
  type Item,
  type Procedure,
  type AppSettings,
  type Proposal,
  type ReorderDraft,
  type Zone,
} from '../api'
import ProcedureLocation from './ProcedureLocation'
import { findZoneByName, mapTargetFromAnswer, type MapTarget } from './zoneItems'

type Props = {
  onApplied: (summary: string, reorderDraft: ReorderDraft | null) => void
  zones: Zone[]
  items: Item[]
  onShowZone: (id: number) => void
  onShowLocation: (target: MapTarget) => void
  settings: AppSettings | null
  settingsError: string
  onSettingsChanged: () => void
  showModeControl?: boolean
}

type State =
  | { kind: 'proposal'; proposal: Proposal }
  | { kind: 'answer'; tool: string; text: string; target: MapTarget | null; procedure: Pick<Procedure, 'topic' | 'text'> | null }
  | { kind: 'clarify'; message: string; target?: MapTarget }
  | { kind: 'unknown'; text: string; hints?: string[] }
  | { kind: 'error'; message: string }
  | null

export default function CommandPanel({ onApplied, zones, items, onShowZone, onShowLocation, settings, settingsError, onSettingsChanged, showModeControl = true }: Props) {
  const [text, setText] = useState('')
  const [state, setState] = useState<State>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [voiceNote, setVoiceNote] = useState('')
  const [voiceFallback, setVoiceFallback] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  // nagranie nie może żyć dłużej niż panel — stop + zwolnienie mikrofonu
  useEffect(() => {
    return () => {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    }
  }, [])

  const [responseWarning, setResponseWarning] = useState<string | null>(null)
  const [modeError, setModeError] = useState('')
  const [modeBusy, setModeBusy] = useState(false)
  const mode = settings?.mode ?? 'llm'
  const demoMode = settings?.mode_status.demo_mode ?? false
  const modeWarning = modeError || settingsError || settings?.mode_status.warning
  const voiceEnabled = Boolean(settings && settings.voice_mode === 'push_to_talk' && !demoMode)
  const voiceHelp = demoMode
    ? 'Demo offline — użyj pola tekstowego. Mikrofon z API jest wyłączony.'
    : !settings
      ? 'Czekam na konfigurację. Pole tekstowe pozostaje dostępne.'
      : voiceEnabled
        ? 'Nagraj komendę albo wpisz ją poniżej. Sprawdź transkrypcję przed wysłaniem.'
        : 'Tryb tekstowy — mikrofon wyłączony. Możesz zmienić tryb głosu w Ustawieniach.'

  useEffect(() => {
    if (!voiceEnabled && recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }, [voiceEnabled])

  const changeMode = async (nextMode: AgentMode) => {
    setModeBusy(true)
    setModeError('')
    try {
      await updateAgentMode(nextMode)
      onSettingsChanged()
    } catch {
      setModeError('Nie udało się zmienić trybu agenta.')
    } finally {
      setModeBusy(false)
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
      if (res.type === 'proposal') {
        const name = res.proposal.args?.name
        let existing: Zone | null = null
        if (res.proposal.tool === 'add_zone' && typeof name === 'string') {
          try {
            existing = findZoneByName(name, await fetchZones())
          } catch (error) {
            const detail = error instanceof Error ? error.message : 'Brak połączenia.'
            setResponseWarning([res.warning, `Nie udało się sprawdzić listy stref: ${detail} Przy potwierdzeniu baza sprawdzi, czy ta nazwa już istnieje.`].filter(Boolean).join(' '))
          }
        }
        if (existing) {
          setState({
            kind: 'clarify',
            message: `Strefa „${existing.name}” już istnieje. Chcesz ją otworzyć? Aby dodać inną, wpisz „strefa: inna nazwa”.`,
            target: { name: existing.name, location: existing.name },
          })
        } else setState({ kind: 'proposal', proposal: res.proposal })
      } else if (res.type === 'answer') {
        const target = mapTargetFromAnswer(res.tool, res.data)
        const first = res.tool === 'recall_procedure' && Array.isArray(res.data.procedures) ? res.data.procedures[0] : null
        const procedure = first && typeof first.topic === 'string' && typeof first.text === 'string'
          ? { topic: first.topic, text: first.text } : null
        setState({ kind: 'answer', tool: res.tool, text: res.text, target, procedure })
        if (res.tool === 'get_location' && target) onShowLocation(target)
      }
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
      if (state.proposal.tool === 'add_zone' && result.created === false) {
        const name = result.name ?? String(state.proposal.args?.name ?? '')
        setState({
          kind: 'clarify',
          message: `Strefa „${name}” już istnieje. Nie dodano duplikatu. Chcesz ją otworzyć czy podać inną nazwę?`,
          target: { name, location: name },
        })
        return
      }
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

  const showVoiceFallback = (message: string) => {
    setVoiceNote(message)
    setVoiceFallback(true)
  }

  const transcribeRecording = async () => {
    setTranscribing(true)
    try {
      const type = recorderRef.current?.mimeType || 'audio/webm'
      const blob = new Blob(chunksRef.current, { type })
      const heard = await transcribeAudio(blob)
      setText((prev) => (prev.trim() ? `${prev.trimEnd()} ${heard}` : heard))
      setVoiceFallback(false)
      setVoiceNote('')
      // kontrola użytkownika: transkrypcja widoczna w polu PRZED wysłaniem —
      // użytkownik czyta/poprawia i sam klika „Wyślij”
      inputRef.current?.focus()
    } catch (error) {
      showVoiceFallback(
        error instanceof Error ? error.message : 'Transkrypcja nieudana — wpisz komendę ręcznie.',
      )
    } finally {
      setTranscribing(false)
      recorderRef.current = null
    }
  }

  const startRecording = async () => {
    if (busy || transcribing || recording || !voiceEnabled) return
    setVoiceNote('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        setRecording(false)
        void transcribeRecording()
      }
      recorder.start()
      recorderRef.current = recorder
      setRecording(true)
    } catch {
      showVoiceFallback('Nie udało się włączyć mikrofonu — wpisz komendę ręcznie.')
    }
  }

  const toggleRecording = () => {
    if (recording) {
      recorderRef.current?.stop()
      return
    }
    void startRecording()
  }

  return (
    <section className="border border-[#e8e5de] bg-white p-5 sm:p-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <h2 className="text-lg font-bold">Powiedz Magazynierowi, co robisz</h2>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {showModeControl && <label className="flex items-center gap-2 text-sm text-[#70756f]">
            Tryb agenta
            <select
              value={mode}
              onChange={(event) => void changeMode(event.target.value as AgentMode)}
              className="border border-[#d8d6cf] bg-white px-2 py-1"
              aria-label="Tryb agenta"
              disabled={demoMode || modeBusy || !settings}
            >
              <option value="llm">LLM</option>
              <option value="offline">Offline</option>
              <option value="mock">Mock</option>
            </select>
          </label>}
          <span className="text-xs font-medium uppercase tracking-wider text-[#70756f]">
            tekst albo mikrofon · nic nie zapiszę bez zatwierdzenia
          </span>
        </div>
      </div>

      {modeWarning && <p className="mt-2 text-sm text-amber-700">{modeWarning}</p>}
      <p className="mt-1 text-xs text-slate-400">{voiceHelp}</p>

      <form
        className="mt-4 flex gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <button
          type="button"
          onClick={toggleRecording}
          disabled={busy || transcribing || (!voiceEnabled && !recording)}
          aria-pressed={recording}
          title={recording ? 'Zakończ nagrywanie' : 'Nagraj komendę głosem'}
          className={
            'flex shrink-0 items-center gap-2 px-4 py-3 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] disabled:cursor-not-allowed disabled:opacity-40 ' +
            (recording
              ? 'bg-[#8f3936] text-white hover:bg-[#7a302e]'
              : 'border border-[#d8d6cf] bg-white text-[#454b46] hover:bg-[#f8f7f3]')
          }
        >
          <span aria-hidden className={'inline-block size-3 rounded-full ' + (recording ? 'animate-pulse bg-white' : 'bg-[#8f3936]')} />
          {recording ? 'Nagrywam…' : transcribing ? 'Słyszę…' : 'Mów'}
        </button>
        <label htmlFor="inventory-command" className="sr-only">Komenda magazynowa</label>
        <input
          id="inventory-command"
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`np. „${settings?.prefix ?? 'Magu'}, ile mamy kartonów?”`}
          className={
            'min-w-0 flex-1 border px-4 py-3 text-base outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#536b56] ' +
            (voiceFallback
              ? 'border-[#d8a948] bg-[#fffaf0]'
              : 'border-[#d8d6cf] focus-visible:border-[#536b56]')
          }
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
      {recording && (
        <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-[#8f3936]" role="status">
          <span aria-hidden className="inline-block size-2 animate-pulse rounded-full bg-[#8f3936]" />
          Nagrywam — kliknij „Nagrywam…”, aby zakończyć i zobaczyć transkrypcję.
        </p>
      )}
      {voiceNote && (
        <p className="mt-3 border border-[#ead9a9] bg-[#fffaf0] p-3 text-sm text-[#805c12]" role="status">
          {voiceNote} Pole tekstowe jest podświetlone — komenda głosowa nie jest jedyną drogą.
        </p>
      )}
      {state?.kind === 'proposal' && (
        <ChangeCard proposal={state.proposal} busy={busy} error={actionError} onConfirm={confirm} onReject={reject} />
      )}
      {state?.kind === 'answer' && (
        <div className="mt-5 border border-[#cbd8c9] bg-[#f6f8f4] p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="font-semibold text-[#315b37]">Odpowiedź</div>
            <span className="border border-[#e8e5de] bg-white px-3 py-1 font-mono text-xs text-[#777b74]">{state.tool}</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-base text-[#454b46]">{state.text}</p>
          {state.procedure && <ProcedureLocation procedure={state.procedure} zones={zones} items={items} onShowZone={onShowZone} />}
          {state.target && <button type="button" onClick={() => onShowLocation(state.target!)} className="mt-3 border border-[#cbd8c9] bg-white px-4 py-2 text-sm font-semibold text-[#315b37] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56]">Pokaż na mapie</button>}
        </div>
      )}
      {state?.kind === 'clarify' && (
        <div className="mt-5 border border-[#ead9a9] bg-[#fffaf0] p-5">
          <div className="font-semibold text-[#805c12]">Doprecyzujmy</div>
          <p className="mt-1 text-sm text-[#805c12]">{state.message}</p>
          {state.target && <button type="button" onClick={() => onShowLocation(state.target!)} className="mt-3 border border-[#ead9a9] bg-white px-4 py-2 text-sm font-semibold text-[#805c12] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#805c12]">Otwórz istniejącą strefę</button>}
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
  return (
    <>
      <p className="mt-3 text-2xl font-bold text-[#315b37]">{proposal.summary}</p>
      {proposal.tool === 'remember_procedure' && typeof proposal.args?.text === 'string' && (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#454b46]">{proposal.args.text}</p>
      )}
    </>
  )
}
