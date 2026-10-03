import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  confirmProposal,
  fetchZones,
  sendCommand,
  isForbidden,
  transcribeAudioDetailed,
  updateAgentMode,
  type AgentMode,
  type AppSettings,
  type Item,
  type Procedure,
  type Proposal,
  type ReorderDraft,
  type Zone,
} from '@/lib/api'
import { delay, PcmRecorder, wavBlob } from '@/lib/pcmRecorder'
import { createRecognition, fullTranscript, type SpeechRecognitionLike } from '@/lib/speech'
import ProcedureLocation from './ProcedureLocation'
import { useWakeListener, type WakeEvent } from './useWakeListener'
import { correctInventorySpeech, speechCorrectionNote } from '@/lib/speechInventory'
import { createCommandConversation, CONVERSATION_LIMIT_MESSAGE } from '@/lib/commandConversation'
import { findZoneByName, mapTargetFromAnswer, type MapTarget } from './zoneItems'

/** Bez prefiksu („zatwierdź”) karta zmiany przyjmuje decyzję głosem tylko przez tyle od pokazania. */
const VOICE_DECISION_MS = 60_000
/** „Mów”: nagranie trwa najwyżej tyle (bufor PCM ma 30 s), po stopie dobieramy „ogon”. */
const MAX_PUSH_TO_TALK_MS = 29_000
const PUSH_TO_TALK_TAIL_MS = 300
const MIN_AUDIO_SECONDS = 0.3

/** Jedno naciśnięcie „Mów”: tekst sprzed nagrania, początek na zegarze nagrania, podgląd przeglądarki. */
type PushToTalkSession = {
  base: string
  startMs: number
  browserText: string
  recognition: SpeechRecognitionLike | null
  timer: ReturnType<typeof setTimeout> | undefined
  /** nagranie PCM → /api/stt (bez Web Speech albo przy włączonym poprawianiu) */
  serverStt: boolean
}

function joinText(base: string, heard: string): string {
  return base && heard ? `${base} ${heard}` : base || heard
}

type Props = {
  onApplied: (summary: string, reorderDraft: ReorderDraft | null) => void
  zones: Zone[]
  items: Item[]
  onShowZone: (id: number) => void
  onShowLocation: (target: MapTarget) => void
  /** Konfiguracja z /api/settings (tryb agenta, prefix, tryb głosu) — odświeżana pollingiem. */
  settings: AppSettings | null
  settingsError: string
  onSettingsChanged: () => Promise<unknown>
  /** W sekcji Ustawienia tryb zmienia się w formularzu, nie tutaj. */
  showModeControl?: boolean
  canChangeMode: boolean
  /** Odczyt odpowiedzi głosem (no-op, gdy TTS wyłączony). */
  onSpeak?: (text: string) => void
}

type VoiceActions = {
  runCommand: (command: string) => Promise<void>
  confirm: () => Promise<void>
  reject: () => void
  busy: boolean
}

type State =
  | { kind: 'proposal'; proposal: Proposal }
  | { kind: 'answer'; tool: string; text: string; target: MapTarget | null; procedure: Pick<Procedure, 'topic' | 'text'> | null }
  | { kind: 'clarify'; message: string; target?: MapTarget }
  | { kind: 'unknown'; text: string; hints?: string[] }
  | { kind: 'error'; message: string }
  | null

export default function CommandPanel({
  onApplied,
  zones,
  items,
  onShowZone,
  onShowLocation,
  settings,
  settingsError,
  onSettingsChanged,
  showModeControl = true,
  canChangeMode,
  onSpeak,
}: Props) {
  const [text, setText] = useState('')
  const [state, setState] = useState<State>(null)
  const conversationRef = useRef(createCommandConversation())
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [listening, setListening] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [refiningLive, setRefiningLive] = useState(false)
  const [voiceNote, setVoiceNote] = useState('')
  const [voiceFallback, setVoiceFallback] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const pcmRef = useRef<PcmRecorder | null>(null)
  const pushToTalkRef = useRef<PushToTalkSession | null>(null)
  // czy wolno jeszcze wysłać nagranie (tryb głosu mógł się zmienić w trakcie)
  const uploadAllowedRef = useRef(false)
  const proposalShownAtRef = useRef(0)
  const stateRef = useRef<State>(null)
  // Najnowsze akcje panelu dla callbacków rozpoznawania mowy (żyją dłużej niż jeden render).
  const latestRef = useRef<VoiceActions>({ runCommand: async () => {}, confirm: async () => {}, reject: () => {}, busy: false })

  // nagranie nie może żyć dłużej niż panel — stop + zwolnienie mikrofonu, bez wysyłania
  useEffect(() => {
    return () => {
      uploadAllowedRef.current = false
      cancelPushToTalk(pushToTalkRef, pcmRef)
    }
  }, [])

  const [responseWarning, setResponseWarning] = useState<string | null>(null)
  const [modeError, setModeError] = useState('')
  const [modeBusy, setModeBusy] = useState(false)
  const mode: AgentMode = settings?.mode ?? 'llm'
  const demoMode = settings?.mode_status.demo_mode ?? false
  const modeWarning = modeError || settingsError || settings?.mode_status.warning
  const prefix = settings?.prefix || 'Magu'
  // mikrofon nigdy nie działa w trybie tekstowym ani w demo
  const voiceEnabled = Boolean(settings && settings.voice_mode !== 'text' && !demoMode)
  const wakeMode = voiceEnabled && settings?.voice_mode === 'wake_word'

  // Tekst przeglądarki jest ostateczny, chyba że kierownik włączył poprawianie serwerem.
  const sttRefine = settings?.stt_refine === true
  const wake = useWakeListener({
    enabled: wakeMode,
    prefix,
    refine: sttRefine,
    onCorrection: setVoiceNote,
    cardStatus: () => {
      const pending = stateRef.current?.kind === 'proposal'
      return { pending, fresh: pending && Date.now() - proposalShownAtRef.current <= VOICE_DECISION_MS }
    },
    onEvent: (event: WakeEvent) => {
      const actions = latestRef.current
      if (event.type === 'interim') { setText(event.text); setVoiceNote('') }
      else if (event.type === 'armed') setText('')
      else if (event.type === 'submit') {
        const corrected = correctInventorySpeech(event.text, items.map((item) => item.name))
        if (corrected.corrections.length) setVoiceNote(speechCorrectionNote(corrected.corrections))
        setText(corrected.text)
        if (!actions.busy) void actions.runCommand(corrected.text)
      } else if (event.type === 'confirm') {
        if (!actions.busy) void actions.confirm()
      } else actions.reject()
    },
  })
  const liveSpeech = wake.supported
  // wake_word bez Web Speech (Firefox) → zwykły przycisk Mów z nagraniem
  const wakeActive = wakeMode && liveSpeech
  const pushToTalk = voiceEnabled && !wakeActive
  // nagranie przerwane zmianą trybu (efekt niżej) nie może zostawić przycisku w stanie „Słucham…”
  const [pushToTalkBefore, setPushToTalkBefore] = useState(pushToTalk)
  if (pushToTalk !== pushToTalkBefore) {
    setPushToTalkBefore(pushToTalk)
    if (!pushToTalk) setListening(false)
  }
  const micLive = listening && pushToTalk
  const voiceHelp = demoMode
    ? 'Demo offline — użyj pola tekstowego. Mikrofon z API jest wyłączony.'
    : !settings
      ? 'Czekam na konfigurację. Pole tekstowe pozostaje dostępne.'
      : !voiceEnabled
        ? 'Tryb tekstowy — mikrofon wyłączony. Możesz zmienić tryb głosu w Ustawieniach.'
        : wakeActive
          ? `Mów bez klikania: „${prefix}, …” i komenda — wyśle się po krótkiej pauzie. Kartę zmiany zatwierdzisz słowem „zatwierdź” albo „tak”, odrzucisz „odrzuć” albo „nie”.`
          : liveSpeech
            ? sttRefine
              ? 'Kliknij Mów i mów — tekst pojawia się w polu na bieżąco, a po nagraniu serwer go poprawi. Sprawdź i kliknij Wyślij.'
              : 'Kliknij Mów i mów — tekst pojawia się w polu na bieżąco. Sprawdź go i kliknij Wyślij.'
            : 'Nagraj komendę albo wpisz ją poniżej. Sprawdź transkrypcję przed wysłaniem.'

  // tryb głosu zmieniony w Ustawieniach (np. przez kierownika) → przerwij nagranie, zwolnij mikrofon,
  // a trwające nagranie nie trafi już na serwer
  useEffect(() => {
    uploadAllowedRef.current = pushToTalk
    if (!pushToTalk) cancelPushToTalk(pushToTalkRef, pcmRef)
  }, [pushToTalk])

  const changeMode = async (nextMode: AgentMode) => {
    setModeBusy(true)
    setModeError('')
    try {
      await updateAgentMode(nextMode)
      await onSettingsChanged()
    } catch (error) {
      setModeError(isForbidden(error) ? 'Tryb agenta zmienia kierownik.' : 'Nie udało się zmienić trybu agenta.')
    } finally {
      setModeBusy(false)
    }
  }

  const runCommand = async (command: string) => {
    const t = command.trim()
    if (!t || busy) return
    setBusy(true)
    setActionError('')
    try {
      const res = await sendCommand(t, conversationRef.current.context())
      if (res.type !== 'clarify') conversationRef.current.clear()
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
          const message = `Strefa „${existing.name}” już istnieje. Chcesz ją otworzyć? Aby dodać inną, wpisz „strefa: inna nazwa”.`
          setState({ kind: 'clarify', message, target: { name: existing.name, location: existing.name } })
          onSpeak?.(message)
        } else {
          proposalShownAtRef.current = Date.now()
          setState({ kind: 'proposal', proposal: res.proposal })
        }
      } else if (res.type === 'answer') {
        const target = mapTargetFromAnswer(res.tool, res.data)
        const first = res.tool === 'recall_procedure' && Array.isArray(res.data.procedures) ? res.data.procedures[0] : null
        const procedure = first && typeof first.topic === 'string' && typeof first.text === 'string'
          ? { topic: first.topic, text: first.text } : null
        setState({ kind: 'answer', tool: res.tool, text: res.text, target, procedure })
        onSpeak?.(res.text)
        if (res.tool === 'get_location' && target) onShowLocation(target)
      } else if (res.type === 'clarify') {
        const message = conversationRef.current.remember(t, res.message) ? res.message : CONVERSATION_LIMIT_MESSAGE
        setState({ kind: 'clarify', message })
        setText('')
        onSpeak?.(message)
      } else setState({ kind: 'unknown', text: res.text, hints: res.hints })
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

  const submit = () => runCommand(text)

  useEffect(() => {
    stateRef.current = state
    latestRef.current = { runCommand, confirm, reject, busy }
  })

  const showVoiceFallback = (message: string) => {
    setVoiceNote(message)
    setVoiceFallback(true)
  }

  // „Mów”: nagranie PCM (zawsze) + podgląd przeglądarki na żywo (Chrome/Edge). Po stopie albo
  // ciszy fragment idzie jako WAV do STT na serwerze i jego tekst zastępuje podgląd.
  // Użytkownik sprawdza tekst i sam klika „Wyślij”.
  const startPushToTalk = async () => {
    if (busy || transcribing || pushToTalkRef.current || !pushToTalk) return
    setVoiceNote('')
    setVoiceFallback(false)
    // Bez Web Speech (Firefox) zawsze serwer; z Web Speech — tylko przy włączonym poprawianiu.
    const recognition = liveSpeech ? createRecognition({ continuous: false }) : null
    const serverStt = !recognition || sttRefine
    const session: PushToTalkSession = {
      base: text.trim(),
      startMs: 0,
      browserText: '',
      recognition: null,
      timer: undefined,
      serverStt,
    }
    pushToTalkRef.current = session
    if (serverStt) {
      const recorder = (pcmRef.current ??= new PcmRecorder())
      try {
        await recorder.start()
      } catch {
        if (pushToTalkRef.current === session) pushToTalkRef.current = null
        showVoiceFallback('Nie udało się włączyć mikrofonu — zezwól na mikrofon dla tej strony albo wpisz komendę ręcznie.')
        return
      }
      if (pushToTalkRef.current !== session) return
      session.startMs = recorder.now()
    }
    session.timer = setTimeout(() => void finishPushToTalk(), MAX_PUSH_TO_TALK_MS)
    setListening(true)
    if (!recognition) return
    recognition.onresult = (event) => {
      if (pushToTalkRef.current !== session) return
      session.browserText = fullTranscript(event.results, prefix)
      setText(joinText(session.base, session.browserText))
    }
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        showVoiceFallback('Brak dostępu do mikrofonu — zezwól na mikrofon dla tej strony albo wpisz komendę ręcznie.')
      } else if (event.error === 'network') {
        setVoiceNote(
          serverStt
            ? 'Podgląd na żywo niedostępny (brak sieci) — tekst pojawi się po nagraniu.'
            : 'Rozpoznawanie mowy wymaga połączenia z internetem — wpisz komendę ręcznie.',
        )
      }
    }
    // koniec podglądu (cisza) kończy też nagranie
    recognition.onend = () => {
      if (pushToTalkRef.current === session) void finishPushToTalk()
    }
    try {
      recognition.start()
      session.recognition = recognition
    } catch {
      if (!serverStt) {
        // bez nagrania i bez rozpoznawania nie ma czego słuchać
        pushToTalkRef.current = null
        clearTimeout(session.timer)
        setListening(false)
        showVoiceFallback('Nie udało się włączyć rozpoznawania mowy — wpisz komendę ręcznie.')
      }
    }
  }

  const finishPushToTalk = async () => {
    const session = pushToTalkRef.current
    if (!session) return
    pushToTalkRef.current = null
    clearTimeout(session.timer)
    detachRecognition(session)
    setListening(false)
    if (!session.serverStt) {
      // tekst przeglądarki jest ostateczny — nic nie wysyłamy
      const corrected = correctInventorySpeech(session.browserText, items.map((item) => item.name), prefix)
      setText(joinText(session.base, corrected.text))
      if (corrected.corrections.length) setVoiceNote(speechCorrectionNote(corrected.corrections))
      if (!session.browserText) setVoiceNote('Nic nie usłyszałem — kliknij Mów i spróbuj ponownie.')
      inputRef.current?.focus()
      return
    }
    setTranscribing(true)
    setRefiningLive(Boolean(session.browserText))
    const recorder = pcmRef.current
    try {
      await delay(PUSH_TO_TALK_TAIL_MS)
      const samples = recorder ? recorder.slice(session.startMs, recorder.now()) : new Float32Array(0)
      const sampleRate = recorder?.sampleRate ?? 16_000
      recorder?.stop()
      if (!uploadAllowedRef.current) return
      if (samples.length < sampleRate * MIN_AUDIO_SECONDS) {
        if (!session.browserText) setVoiceNote('Nic nie usłyszałem — kliknij Mów i spróbuj ponownie.')
        return
      }
      const transcription = await transcribeAudioDetailed(wavBlob(samples, sampleRate))
      const heard = transcription.text.trim()
      if (heard) {
        setText(joinText(session.base, heard))
        setVoiceNote(speechCorrectionNote(transcription.corrections ?? []))
        setVoiceFallback(false)
      } else if (!session.browserText) {
        setVoiceNote('Nic nie usłyszałem — kliknij Mów i spróbuj ponownie.')
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Transkrypcja nieudana — wpisz komendę ręcznie.'
      showVoiceFallback(
        session.browserText ? `Nie udało się poprawić transkrypcji (${detail}) — zostawiam tekst rozpoznany w przeglądarce.` : detail,
      )
    } finally {
      setTranscribing(false)
      inputRef.current?.focus()
    }
  }

  const toggleMic = () => {
    const session = pushToTalkRef.current
    if (!session) {
      void startPushToTalk()
      return
    }
    // stop podglądu dostarczy ostatni wynik, a jego koniec zamknie nagranie
    if (session.recognition) {
      try {
        session.recognition.stop()
        return
      } catch {
        /* już zatrzymany */
      }
    }
    void finishPushToTalk()
  }

  return (
    <section className="border border-[#e8e5de] bg-white p-5 sm:p-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <h2 className="text-lg font-bold">Powiedz Magazynierowi, co robisz</h2>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {showModeControl && (
            <label className="flex items-center gap-2 text-sm text-[#70756f]">
              Tryb agenta
              <select
                value={mode}
                onChange={(event) => void changeMode(event.target.value as AgentMode)}
                className="border border-[#d8d6cf] bg-white px-2 py-1 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Tryb agenta"
                disabled={demoMode || modeBusy || !settings || !canChangeMode}
                title={!canChangeMode && !demoMode ? 'Tryb agenta zmienia kierownik' : undefined}
              >
                <option value="llm">LLM</option>
                <option value="offline">Offline</option>
                <option value="mock">Mock</option>
              </select>
            </label>
          )}
          <span className="text-xs font-medium uppercase tracking-wider text-[#70756f]">
            tekst albo mikrofon · nic nie zapiszę bez zatwierdzenia
          </span>
        </div>
      </div>

      {modeWarning && <p className="mt-2 text-sm text-amber-700">{modeWarning}</p>}
      <p className="mt-1 text-xs text-slate-400">{voiceHelp}</p>

      <form
        className="mt-4 flex flex-wrap gap-3 sm:flex-nowrap"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {!wakeActive && (
          <button
            type="button"
            onClick={toggleMic}
            disabled={busy || transcribing || !pushToTalk}
            aria-pressed={micLive}
            title={micLive ? 'Zakończ' : pushToTalk ? 'Nagraj komendę głosem' : 'Mikrofon wyłączony w Ustawieniach'}
            className={micButtonClass(micLive)}
          >
            <span aria-hidden className={'inline-block size-3 rounded-full ' + (micLive ? 'animate-pulse bg-white' : 'bg-[#8f3936]')} />
            {micLive ? (liveSpeech ? 'Słucham…' : 'Nagrywam…') : transcribing ? 'Słyszę…' : 'Mów'}
          </button>
        )}
        <label htmlFor="inventory-command" className="sr-only">Komenda magazynowa</label>
        <input
          id="inventory-command"
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`np. „${settings?.prefix ?? 'Magu'}, ile mamy kartonów?”`}
          className={
            'order-first min-w-0 basis-full border px-4 py-3 text-base sm:order-none sm:flex-1 sm:basis-auto outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#536b56] ' +
            (voiceFallback
              ? 'border-[#d8a948] bg-[#fffaf0]'
              : 'border-[#d8d6cf] focus-visible:border-[#536b56]')
          }
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="flex-1 bg-[#292d2b] px-6 py-3 font-semibold text-white sm:flex-none transition-colors hover:bg-[#454b46] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Przetwarzam…' : 'Wyślij'}
        </button>
      </form>

      {responseWarning && <p className="mt-3 text-sm text-amber-700">{responseWarning}</p>}
      {micLive && (
        <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-[#8f3936]" role="status">
          <span aria-hidden className="inline-block size-2 shrink-0 animate-pulse rounded-full bg-[#8f3936]" />
          {liveSpeech
            ? 'Słucham — tekst pojawia się w polu. Kończę po chwili ciszy albo po kliknięciu „Słucham…”.'
            : 'Nagrywam — kliknij „Nagrywam…”, aby zakończyć i zobaczyć transkrypcję.'}
        </p>
      )}
      {transcribing && (
        <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-[#646b64]" role="status">
          <span aria-hidden className="inline-block size-2 shrink-0 animate-pulse rounded-full bg-[#9a9e97]" />
          {refiningLive ? 'Poprawiam transkrypcję…' : 'Rozpoznaję nagranie…'}
        </p>
      )}
      {wake.on && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <p
            className={'flex min-w-0 items-center gap-2 text-sm font-semibold ' + (wake.phase === 'paused' ? 'text-[#646b64]' : 'text-[#8f3936]')}
            role="status"
          >
            <span
              aria-hidden
              className={'inline-block size-2 shrink-0 rounded-full ' + (wake.phase === 'paused' ? 'bg-[#9a9e97]' : 'animate-pulse bg-[#8f3936]')}
            />
            {wake.phase === 'hearing'
              ? 'Słucham…'
              : wake.phase === 'refining'
                ? 'Poprawiam transkrypcję…'
                : wake.phase === 'paused'
                  ? 'Nasłuch wstrzymany, gdy Magazynier mówi.'
                  : `Mikrofon nasłuchuje — zacznij od „${prefix}”.`}
          </p>
          <button type="button" onClick={wake.turnOff} className={smallButtonClass}>
            Wyłącz nasłuch
          </button>
          {wake.audioSuspended && (
            <p className="basis-full text-xs text-[#70756f]">Kliknij gdziekolwiek, aby włączyć dokładniejsze rozpoznawanie.</p>
          )}
        </div>
      )}
      {wakeActive && !wake.on && !wake.error && wake.userOff && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <p className="flex items-center gap-2 text-sm text-[#646b64]" role="status">
            <span aria-hidden className="inline-block size-2 shrink-0 rounded-full bg-[#9a9e97]" />
            Nasłuch wyłączony w tej przeglądarce.
          </p>
          <button type="button" onClick={wake.turnOn} className={smallButtonClass}>
            Włącz nasłuch
          </button>
        </div>
      )}
      {wakeActive && wake.error && (
        <div className="mt-3 border border-[#edc8c5] bg-[#fff7f6] p-3 text-sm text-[#8f3936]" role="alert">
          <p>{wake.error}</p>
          <button
            type="button"
            onClick={wake.retry}
            className="mt-3 border border-[#d8a9a5] bg-white px-4 py-2 text-sm font-semibold text-[#8f3936] hover:bg-[#fdebec] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8f3936]"
          >
            Spróbuj ponownie
          </button>
        </div>
      )}
      {voiceEnabled && !liveSpeech && (
        <p className="mt-3 text-xs text-[#805c12]">
          {wakeMode
            ? 'Nasłuch „ręce wolne” wymaga Chrome lub Edge — tutaj użyj przycisku Mów (nagranie trafia do transkrypcji na serwerze).'
            : 'Podgląd tekstu na żywo działa w Chrome i Edge — tutaj nagranie trafia do transkrypcji na serwerze.'}
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
          {conversationRef.current.context().length > 0 && <p className="mt-2 text-xs text-[#805c12]">Dotyczy: {conversationRef.current.context()[0].userText}. Wpisz odpowiedź w polu komendy.</p>}
          <button type="button" disabled={busy} onClick={() => { conversationRef.current.clear(); setState(null); setText(''); inputRef.current?.focus() }} className="mt-3 border border-[#ead9a9] bg-white px-4 py-2 text-sm font-semibold text-[#805c12]">Nowa komenda</button>
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

/** Przerywa „Mów” bez wysyłania nagrania i zwalnia mikrofon. */
function cancelPushToTalk(sessionRef: RefObject<PushToTalkSession | null>, pcmRef: RefObject<PcmRecorder | null>) {
  const session = sessionRef.current
  sessionRef.current = null
  if (session) {
    clearTimeout(session.timer)
    detachRecognition(session)
  }
  pcmRef.current?.stop()
}

function detachRecognition(session: PushToTalkSession) {
  const recognition = session.recognition
  session.recognition = null
  if (!recognition) return
  recognition.onresult = null
  recognition.onerror = null
  recognition.onend = null
  try {
    recognition.abort()
  } catch {
    /* już zatrzymany */
  }
}

const smallButtonClass =
  'shrink-0 border border-[#d8d6cf] bg-white px-3 py-1.5 text-xs font-semibold text-[#454b46] transition-colors hover:bg-[#f8f7f3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56]'

function micButtonClass(active: boolean): string {
  return (
    'flex shrink-0 items-center gap-2 px-4 py-3 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] disabled:cursor-not-allowed disabled:opacity-40 ' +
    (active ? 'bg-[#8f3936] text-white hover:bg-[#7a302e]' : 'border border-[#d8d6cf] bg-white text-[#454b46] hover:bg-[#f8f7f3]')
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
