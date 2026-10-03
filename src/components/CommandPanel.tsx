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
import { playListeningCue, unlockListeningCue } from '@/lib/listeningCue'
import { abortRecognition, createRecognition, fullTranscript, voiceDecision, type SpeechRecognitionLike } from '@/lib/speech'
import { correctInventorySpeech, speechCorrectionNote } from '@/lib/speechInventory'
import ProcedureLocation from './ProcedureLocation'
import { CheckIcon, MicIcon, MicOffIcon, PinIcon, SendIcon } from './ui/icons'
import { Notice } from './ui/feedback'
import RangeIndicator from './ui/RangeIndicator'
import { StateMark, StateShape } from './ui/StateMark'
import { STOCK_LEVEL, stockLevel } from './ui/stockLevel'
import { buttonClass, fieldClass } from './ui/styles'
import { useWakeListener, type WakeEvent } from './useWakeListener'
import { createCommandConversation, CONVERSATION_LIMIT_MESSAGE } from '@/lib/commandConversation'
import { findZoneByName, mapTargetFromAnswer, type MapTarget } from './zoneItems'

/** Bez prefiksu („zatwierdź”) karta zmiany przyjmuje decyzję głosem tylko przez tyle od pokazania. */
const VOICE_DECISION_MS = 60_000
/** „Mów”: nagranie trwa najwyżej tyle (bufor PCM ma 30 s), po stopie dobieramy „ogon”. */
const MAX_PUSH_TO_TALK_MS = 29_000
const PUSH_TO_TALK_TAIL_MS = 300
const MIN_AUDIO_SECONDS = 0.3

/** Jedno naciśnięcie „Mów”: początek na zegarze nagrania i podgląd przeglądarki. */
type PushToTalkSession = {
  startMs: number
  browserText: string
  recognition: SpeechRecognitionLike | null
  timer: ReturnType<typeof setTimeout> | undefined
  /** nagranie PCM → /api/stt (bez Web Speech albo przy włączonym poprawianiu) */
  serverStt: boolean
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
  const busyRef = useRef(false)
  const [processingCommand, setProcessingCommand] = useState('')
  const [micStarting, setMicStarting] = useState(false)
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
  const voiceSessionRef = useRef(0)
  const proposalShownAtRef = useRef(0)
  const stateRef = useRef<State>(null)
  // Najnowsze akcje panelu dla callbacków rozpoznawania mowy (żyją dłużej niż jeden render).
  const latestRef = useRef<VoiceActions>({ runCommand: async () => {}, confirm: async () => {}, reject: () => {}, busy: false })

  // nagranie nie może żyć dłużej niż panel — stop + zwolnienie mikrofonu, bez wysyłania
  useEffect(() => {
    const unlock = () => unlockListeningCue()
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      uploadAllowedRef.current = false
      voiceSessionRef.current++
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
    paused: busy,
    onCorrection: setVoiceNote,
    cardStatus: () => {
      const pending = stateRef.current?.kind === 'proposal'
      return { pending, fresh: pending && Date.now() - proposalShownAtRef.current <= VOICE_DECISION_MS }
    },
    onEvent: (event: WakeEvent) => {
      if (busyRef.current) return
      const actions = latestRef.current
      if (event.type === 'interim') {
        setText(event.text)
        setVoiceNote('')
      }
      else if (event.type === 'armed') setText('')
      else if (event.type === 'submit') {
        const corrected = correctInventorySpeech(event.text, items.map((item) => item.name), prefix)
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
    if (!pushToTalk) setMicStarting(false)
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
    voiceSessionRef.current++
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
    if (!t || busyRef.current || pushToTalkRef.current || transcribing) return
    if (stateRef.current?.kind === 'proposal') {
      const decision = voiceDecision(t, prefix)
      if (decision === 'confirm') return latestRef.current.confirm()
      if (decision === 'reject') { latestRef.current.reject(); return }
    }
    wake.resetForReply()
    busyRef.current = true
    setProcessingCommand(t)
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
          const nextState: State = { kind: 'proposal', proposal: res.proposal }
          stateRef.current = nextState
          setState(nextState)
          setText('')
          wake.resetForReply()
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
      busyRef.current = false
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!state || state.kind !== 'proposal' || busyRef.current) return
    busyRef.current = true
    wake.resetForReply()
    setProcessingCommand(state.proposal.text)
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
      stateRef.current = null
      setState(null)
      setText('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Nie udało się zapisać zmiany.')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const reject = () => {
    wake.resetForReply()
    stateRef.current = null
    setState(null)
    setActionError('')
    setText('')
  }

  const submit = () => {
    if (micStarting || micLive || transcribing || (wake.on && (wake.phase === 'hearing' || wake.phase === 'refining'))) return
    return runCommand(text)
  }

  useEffect(() => {
    stateRef.current = state
    latestRef.current = { runCommand, confirm, reject, busy }
  })

  const showVoiceFallback = (message: string) => {
    setVoiceNote(message)
    setVoiceFallback(true)
  }

  // „Mów”: podgląd na żywo (Chrome/Edge), opcjonalnie nagranie PCM do poprawiania przez serwer.
  // Po stopie fragment idzie jako WAV do STT, jeśli sesja wymaga rozpoznawania na serwerze.
  // Użytkownik sprawdza tekst i sam klika „Wyślij”.
  const startPushToTalk = async () => {
    if (busyRef.current || transcribing || pushToTalkRef.current || !pushToTalk) return
    unlockListeningCue()
    setMicStarting(true)
    setVoiceNote('')
    setVoiceFallback(false)
    // Bez Web Speech (Firefox) zawsze serwer; z Web Speech — tylko przy włączonym poprawianiu.
    const recognition = liveSpeech ? createRecognition({ continuous: true }) : null
    const serverStt = !recognition || sttRefine
    const session: PushToTalkSession = {
      startMs: 0,
      browserText: '',
      recognition: null,
      timer: undefined,
      serverStt,
    }
    pushToTalkRef.current = session
    setText('')
    if (serverStt) {
      const recorder = (pcmRef.current ??= new PcmRecorder())
      try {
        await recorder.start()
      } catch {
        if (pushToTalkRef.current === session) pushToTalkRef.current = null
        setMicStarting(false)
        showVoiceFallback('Nie udało się włączyć mikrofonu — zezwól na mikrofon dla tej strony albo wpisz komendę ręcznie.')
        return
      }
      if (pushToTalkRef.current !== session) return
      session.startMs = recorder.now()
    }
    session.timer = setTimeout(() => void finishPushToTalk(), MAX_PUSH_TO_TALK_MS)
    const ready = () => {
      if (pushToTalkRef.current !== session) return
      setMicStarting(false)
      setListening(true)
      playListeningCue()
    }
    if (!recognition) { ready(); return }
    recognition.onstart = ready
    recognition.onresult = (event) => {
      if (pushToTalkRef.current !== session) return
      session.browserText = fullTranscript(event.results, prefix)
      setText(session.browserText)
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
    // Koniec sesji przeglądarki kończy też nagranie; krótkie pauzy pozostają w jednej komendzie.
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
        setMicStarting(false)
        showVoiceFallback('Nie udało się włączyć rozpoznawania mowy — wpisz komendę ręcznie.')
      } else ready()
    }
  }

  const finishPushToTalk = async () => {
    const session = pushToTalkRef.current
    if (!session) return
    pushToTalkRef.current = null
    clearTimeout(session.timer)
    detachRecognition(session)
    setListening(false)
    setMicStarting(false)
    if (!session.serverStt) {
      // tekst przeglądarki jest ostateczny — nic nie wysyłamy
      if (!session.browserText) setVoiceNote('Nic nie usłyszałem — kliknij Mów i spróbuj ponownie.')
      else applyVoiceTranscript(session.browserText)
      inputRef.current?.focus()
      return
    }
    setTranscribing(true)
    const voiceSession = voiceSessionRef.current
    setRefiningLive(Boolean(session.browserText))
    const recorder = pcmRef.current
    try {
      await delay(PUSH_TO_TALK_TAIL_MS)
      const samples = recorder ? recorder.slice(session.startMs, recorder.now()) : new Float32Array(0)
      const sampleRate = recorder?.sampleRate ?? 16_000
      recorder?.stop()
      if (!uploadAllowedRef.current || voiceSession !== voiceSessionRef.current) return
      if (samples.length < sampleRate * MIN_AUDIO_SECONDS) {
        if (!session.browserText) setVoiceNote('Nic nie usłyszałem — kliknij Mów i spróbuj ponownie.')
        return
      }
      const transcription = await transcribeAudioDetailed(wavBlob(samples, sampleRate))
      const heard = transcription.text.trim()
      if (!uploadAllowedRef.current || voiceSession !== voiceSessionRef.current) return
      if (heard) {
        applyVoiceTranscript(heard)
        if (transcription.corrections?.length) setVoiceNote(speechCorrectionNote(transcription.corrections))
        setVoiceFallback(false)
      } else if (!session.browserText) {
        setVoiceNote('Nic nie usłyszałem — kliknij Mów i spróbuj ponownie.')
      }
    } catch (error) {
      if (!uploadAllowedRef.current || voiceSession !== voiceSessionRef.current) return
      const detail = error instanceof Error ? error.message : 'Transkrypcja nieudana — wpisz komendę ręcznie.'
      showVoiceFallback(
        session.browserText ? `Nie udało się poprawić transkrypcji (${detail}) — zostawiam tekst rozpoznany w przeglądarce.` : detail,
      )
    } finally {
      setTranscribing(false)
      inputRef.current?.focus()
    }
  }

  // Decyzja z nowego nagrania dotyczy oczekującej karty; nie wysyłamy jej ponownie do LLM.
  const applyVoiceTranscript = (heard: string) => {
    const corrected = correctInventorySpeech(heard, items.map((item) => item.name), prefix)
    setText(corrected.text)
    setVoiceNote(corrected.corrections.length ? speechCorrectionNote(corrected.corrections) : '')
    if (stateRef.current?.kind !== 'proposal' || busyRef.current) return
    const decision = voiceDecision(heard, prefix)
    if (decision === 'confirm') void latestRef.current.confirm()
    else if (decision === 'reject') latestRef.current.reject()
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

  const hearing = micLive || wake.phase === 'hearing'
  const recognizing = transcribing || wake.phase === 'refining'
  const pending = state?.kind === 'proposal'
  const pendingItem = state?.kind === 'proposal' ? items.find((item) => item.id === state.proposal.item_id) ?? null : null
  const bufferStatus = busy
    ? 'Agent przetwarza komendę'
    : micStarting
      ? 'Włączam mikrofon…'
      : recognizing
        ? 'Rozpoznaję — sprawdzam transkrypcję'
        : hearing
          ? 'Słucham — podgląd wypowiedzi'
          : text.trim()
            ? 'Komenda gotowa'
            : pending
              ? 'Czekam na decyzję'
              : 'Czekam na komendę'
  const bufferText = busy
    ? processingCommand || 'Zatwierdzam zmianę…'
    : text ||
      (micLive
        ? liveSpeech
          ? 'Mów teraz — tekst pojawi się tutaj.'
          : 'Nagrywam. Transkrypcja pojawi się po zakończeniu.'
        : pending
          ? 'Powiedz „zatwierdź” albo „odrzuć”.'
          : 'Twoja wypowiedź pojawi się tutaj.')

  return (
    <section className="flex flex-col gap-5 p-5 sm:p-6 xl:min-h-full xl:pt-9">
      <div>
        <h2 className="text-lg font-semibold leading-snug text-ink">Powiedz Magazynierowi, co robisz</h2>
        <p className="mt-1 text-[13px] text-ink-2">Tekst albo mikrofon · nic nie zapiszę bez zatwierdzenia</p>
        {showModeControl && (
          <label className="mt-3 flex items-center gap-3">
            <span className="label-caps whitespace-nowrap">Tryb agenta</span>
            <select
              value={mode}
              onChange={(event) => void changeMode(event.target.value as AgentMode)}
              className="h-8 rounded-md border border-line-strong bg-sheet px-2 text-[13px] text-ink transition-colors hover:border-ink-2/60 disabled:cursor-not-allowed disabled:bg-ground disabled:text-mute"
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
      </div>

      {modeWarning && <Notice tone="warn">{modeWarning}</Notice>}

      {/* jedna decyzja naraz: oczekująca karta zmiany stoi na górze kolumny, zawsze w zasięgu wzroku */}
      {state?.kind === 'proposal' && (
        <ChangeCard
          key={state.proposal.id}
          proposal={state.proposal}
          item={pendingItem}
          voiceHint={wakeActive}
          busy={busy}
          error={actionError}
          onConfirm={confirm}
          onReject={reject}
        />
      )}

      {wake.on && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg px-3.5 py-2.5 ring-1 ring-line">
          <p className="flex min-w-0 items-center gap-2.5 text-sm font-medium text-ink" role="status">
            <span
              aria-hidden
              className={'inline-block size-2.5 shrink-0 rounded-full ' + (wake.phase === 'paused' ? 'bg-band' : 'animate-breathe bg-act')}
            />
            {wake.phase === 'hearing'
              ? 'Słucham…'
              : wake.phase === 'refining'
                ? 'Poprawiam transkrypcję…'
                : wake.phase === 'paused'
                  ? 'Nasłuch wstrzymany na czas odpowiedzi agenta.'
                  : wake.phase === 'starting'
                    ? 'Włączam mikrofon…'
                    : `Mikrofon nasłuchuje — zacznij od „${prefix}”.`}
          </p>
          <button type="button" onClick={wake.turnOff} className={buttonClass('ghost', 'sm')}>
            <MicOffIcon size={16} />
            Wyłącz nasłuch
          </button>
          {wake.audioSuspended && (
            <p className="basis-full text-xs text-ink-2">Kliknij gdziekolwiek, aby włączyć dokładniejsze rozpoznawanie.</p>
          )}
        </div>
      )}
      {wakeActive && !wake.on && !wake.error && wake.userOff && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg px-3.5 py-2.5 ring-1 ring-line">
          <p className="flex items-center gap-2.5 text-sm text-ink-2" role="status">
            <StateShape kind="idle" />
            Nasłuch wyłączony w tej przeglądarce.
          </p>
          <button type="button" onClick={wake.turnOn} className={buttonClass('secondary', 'sm')}>
            <MicIcon size={16} />
            Włącz nasłuch
          </button>
        </div>
      )}
      {wakeActive && wake.error && (
        <Notice
          tone="alarm"
          role="alert"
          action={
            <button type="button" onClick={wake.retry} className={buttonClass('danger', 'sm')}>
              Spróbuj ponownie
            </button>
          }
        >
          {wake.error}
        </Notice>
      )}

      <div
        className={'rounded-lg p-4 transition-colors duration-200 ' + (hearing ? 'bg-act-soft' : 'bg-ground')}
        aria-label="Bufor komendy"
        aria-busy={busy || transcribing}
      >
        <p className={'label-caps flex items-center gap-2 ' + (hearing || busy ? 'text-act-ink' : '')} role="status">
          <span
            aria-hidden
            className={
              'inline-block size-2 shrink-0 rounded-full ' +
              (busy || hearing || recognizing ? 'animate-breathe bg-act' : pending ? 'bg-act' : 'bg-band')
            }
          />
          {bufferStatus}
        </p>
        <p
          className={
            'mt-2.5 min-h-14 whitespace-pre-wrap break-words text-xl font-medium leading-snug ' +
            (busy || text ? 'text-ink' : 'text-mute')
          }
        >
          {bufferText}
        </p>
        {hearing && <p className="mt-2 text-xs text-ink-2">To wstępny zapis mowy. Agent zinterpretuje komendę po zakończeniu wypowiedzi.</p>}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {!wakeActive && (
          <button
            type="button"
            onClick={toggleMic}
            disabled={busy || transcribing || micStarting || !pushToTalk}
            aria-pressed={micLive}
            title={micLive ? 'Zakończ' : pushToTalk ? 'Nagraj komendę głosem' : 'Mikrofon wyłączony w Ustawieniach'}
            className={buttonClass(micLive ? 'action' : 'secondary') + ' h-11'}
          >
            <MicIcon size={18} className={micLive ? 'animate-breathe' : ''} />
            {micStarting ? 'Włączam…' : micLive ? (liveSpeech ? 'Słucham…' : 'Nagrywam…') : transcribing ? 'Rozpoznaję…' : 'Mów'}
          </button>
        )}
        <label htmlFor="inventory-command" className="sr-only">Komenda magazynowa</label>
        <input
          id="inventory-command"
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          readOnly={micStarting || micLive || transcribing || (wake.on && (wake.phase === 'hearing' || wake.phase === 'refining'))}
          placeholder={state?.kind === 'proposal' ? '„zatwierdź” albo „odrzuć”' : `np. „${settings?.prefix ?? 'Magu'}, ile mamy kartonów?”`}
          className={
            fieldClass +
            ' h-11 flex-1 text-[15px] ' +
            (voiceFallback ? 'border-warn bg-warn-soft' : '')
          }
        />
        <button
          type="submit"
          disabled={busy || micStarting || micLive || transcribing || (wake.on && (wake.phase === 'hearing' || wake.phase === 'refining')) || !text.trim()}
          className={buttonClass('primary') + ' h-11'}
        >
          {busy ? 'Przetwarzam…' : 'Wyślij'}
          {!busy && <SendIcon size={16} />}
        </button>
      </form>

      {!pending && <p className="-mt-2 text-xs leading-relaxed text-ink-2">{voiceHelp}</p>}

      {responseWarning && <Notice tone="warn">{responseWarning}</Notice>}
      {micLive && (
        <p className="flex items-center gap-2 text-sm font-medium text-act-ink" role="status">
          <span aria-hidden className="inline-block size-2 shrink-0 animate-breathe rounded-full bg-act" />
          {liveSpeech
            ? 'Słucham — tekst pojawia się na bieżąco. Kliknij „Słucham…”, aby zakończyć (maks. 29 s).'
            : 'Nagrywam — kliknij „Nagrywam…”, aby zakończyć i zobaczyć transkrypcję.'}
        </p>
      )}
      {transcribing && (
        <p className="flex items-center gap-2 text-sm font-medium text-ink-2" role="status">
          <span aria-hidden className="inline-block size-2 shrink-0 animate-breathe rounded-full bg-band" />
          {refiningLive ? 'Poprawiam transkrypcję…' : 'Rozpoznaję nagranie…'}
        </p>
      )}
      {voiceEnabled && !liveSpeech && (
        <p className="text-xs text-warn-ink">
          {wakeMode
            ? 'Nasłuch „ręce wolne” wymaga Chrome lub Edge — tutaj użyj przycisku Mów (nagranie trafia do transkrypcji na serwerze).'
            : 'Podgląd tekstu na żywo działa w Chrome i Edge — tutaj nagranie trafia do transkrypcji na serwerze.'}
        </p>
      )}
      {voiceNote && (
        <Notice tone="warn" role="status">
          {voiceNote} Pole tekstowe jest podświetlone — komenda głosowa nie jest jedyną drogą.
        </Notice>
      )}

      {state?.kind === 'answer' && (
        <div className="animate-arrive rounded-lg bg-ground p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="label-caps">Odpowiedź</p>
            <code className="rounded bg-sheet px-2 py-0.5 font-mono text-[11px] text-ink-2">{state.tool}</code>
          </div>
          <p className="mt-2.5 whitespace-pre-wrap text-base leading-relaxed text-ink">{state.text}</p>
          {state.procedure && <ProcedureLocation procedure={state.procedure} zones={zones} items={items} onShowZone={onShowZone} />}
          {state.target && (
            <button type="button" onClick={() => onShowLocation(state.target!)} className={buttonClass('secondary', 'sm') + ' mt-4'}>
              <PinIcon size={16} />
              Pokaż na mapie
            </button>
          )}
        </div>
      )}
      {state?.kind === 'clarify' && (
        <div className="animate-arrive rounded-lg bg-act-soft p-5 text-act-ink">
          <StateMark kind="decision">Doprecyzujmy</StateMark>
          <p className="mt-2 text-base text-ink">{state.message}</p>
          {conversationRef.current.context().length > 0 && (
            <p className="mt-2 text-xs">Dotyczy: {conversationRef.current.context()[0].userText}. Wpisz odpowiedź w polu komendy.</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                conversationRef.current.clear()
                setState(null)
                setText('')
                inputRef.current?.focus()
              }}
              className={buttonClass('secondary', 'sm')}
            >
              Nowa komenda
            </button>
            {state.target && (
              <button type="button" onClick={() => onShowLocation(state.target!)} className={buttonClass('secondary', 'sm')}>
                <PinIcon size={16} />
                Otwórz istniejącą strefę
              </button>
            )}
          </div>
        </div>
      )}
      {state?.kind === 'unknown' && (
        <div className="animate-arrive rounded-lg bg-warn-soft p-5 text-warn-ink">
          <StateMark kind="warn">Nie rozumiem tej komendy</StateMark>
          <p className="mt-2 text-sm text-ink">{state.text}</p>
          {state.hints && state.hints.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {state.hints.map((hint) => (
                <li key={hint} className="rounded-full bg-sheet px-3 py-1 text-xs font-medium text-ink ring-1 ring-warn/30">
                  {hint}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {state?.kind === 'error' && (
        <Notice
          tone="alarm"
          role="alert"
          title="Nie udało się wysłać komendy."
          className="animate-arrive"
          action={
            <button type="button" onClick={() => void submit()} className={buttonClass('danger', 'sm')}>
              Spróbuj ponownie
            </button>
          }
        >
          {state.message}
        </Notice>
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
  abortRecognition(recognition)
}

/**
 * Karta zmiany — centrum każdej interakcji: co agent chce zapisać, skutek na wskaźniku zakresu
 * i jedna decyzja człowieka. Do zatwierdzenia nic nie trafia do bazy.
 */
function ChangeCard({
  proposal,
  item,
  voiceHint,
  busy,
  error,
  onConfirm,
  onReject,
}: {
  proposal: Proposal
  item: Item | null
  voiceHint: boolean
  busy: boolean
  error: string
  onConfirm: () => void
  onReject: () => void
}) {
  return (
    <div className="animate-arrive rounded-lg bg-sheet p-5 shadow-raise ring-1 ring-act/45">
      <div className="flex items-center justify-between gap-3">
        <StateMark kind="decision">Karta zmiany · do zatwierdzenia</StateMark>
        <code className="rounded bg-ground px-2 py-0.5 font-mono text-[11px] text-ink-2">{proposal.tool}</code>
      </div>

      {proposal.tool === 'update_stock' ? <StockChange proposal={proposal} item={item} /> : <GenericChange proposal={proposal} />}

      <p className="mt-4 text-sm leading-relaxed text-ink-2">
        Usłyszałem: <span className="font-medium text-ink">„{proposal.text}”</span>. Nic nie zostało zapisane — zatwierdź, aby
        wykonać zmianę i dodać wpis w historii.
      </p>

      {error && (
        <Notice tone="alarm" role="alert" className="mt-3">
          Nie zapisano zmiany: {error}
        </Notice>
      )}

      <div className="mt-5 grid grid-cols-[1fr_auto] gap-2">
        <button type="button" onClick={onConfirm} disabled={busy} className={buttonClass('action', 'lg')}>
          <CheckIcon size={18} />
          {busy ? 'Zapisuję…' : 'Zatwierdź'}
        </button>
        <button type="button" onClick={onReject} disabled={busy} className={buttonClass('secondary', 'lg')}>
          Odrzuć
        </button>
      </div>
      {voiceHint && <p className="mt-3 text-center text-xs text-ink-2">albo powiedz „zatwierdź” lub „odrzuć”</p>}
    </div>
  )
}

function StockChange({ proposal, item }: { proposal: Proposal; item: Item | null }) {
  const delta = proposal.delta ?? 0
  const name = proposal.item_name ?? 'Pozycja'
  const unit = proposal.unit ?? ''
  const before = proposal.before
  const after = proposal.after
  const minimum = item?.minimum ?? 0
  const level = typeof after === 'number' ? stockLevel(after, minimum) : 'ok'
  const afterColor = level === 'empty' ? 'text-alarm-ink' : level === 'below' ? 'text-warn-ink' : 'text-ink'

  return (
    <div className="mt-4">
      <p className="text-xl font-semibold leading-tight text-ink">{name}</p>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 tabular-nums">
        <span className="text-[28px] font-semibold leading-none text-mute">{before ?? '—'}</span>
        <span className="text-xl leading-none text-mute" aria-hidden="true">→</span>
        <span className={`text-[44px] font-semibold leading-none tracking-[-0.02em] ${afterColor}`}>{after ?? '—'}</span>
        <span className="text-base text-ink-2">{unit}</span>
        <span className="ml-auto rounded-full bg-ground px-2.5 py-1 text-sm font-semibold text-ink">
          {delta > 0 ? `+${delta}` : delta} {unit}
        </span>
      </div>
      {typeof before === 'number' && typeof after === 'number' && (
        <>
          <RangeIndicator value={before} after={after} minimum={minimum} unit={unit} label={name} size="lg" className="mt-5" />
          {item && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-ink-2">
              <span className="whitespace-nowrap tabular-nums">minimum {minimum} {unit}</span>
              {level !== 'ok' && (
                <StateMark kind={STOCK_LEVEL[level].kind} className="whitespace-nowrap">
                  {STOCK_LEVEL[level].label} po zmianie
                </StateMark>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function GenericChange({ proposal }: { proposal: Proposal }) {
  return (
    <>
      <p className="mt-4 text-xl font-semibold leading-snug text-ink">{proposal.summary}</p>
      {proposal.tool === 'remember_procedure' && typeof proposal.args?.text === 'string' && (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-2">{proposal.args.text}</p>
      )}
    </>
  )
}
