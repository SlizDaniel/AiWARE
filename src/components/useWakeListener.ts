import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { transcribeAudioDetailed, type SpeechTranscription } from '@/lib/api'
import { speechCorrectionNote } from '@/lib/speechInventory'
import { createOrderedQueue } from '@/lib/orderedQueue'
import { PcmRecorder, wavBlob } from '@/lib/pcmRecorder'
import { playListeningCue, unlockListeningCue } from '@/lib/listeningCue'
import { createSpeechCommandBuffer } from '@/lib/speechCommandBuffer'
import { createSpeechWindow, SPEECH_WINDOW_MS } from '@/lib/speechWindow'
import {
  abortRecognition,
  commandFromServerText,
  cleanSpeechCommand,
  createRecognition,
  decideWakeAction,
  matchWakeWord,
  latestWakeWord,
  resultEntries,
  speechRecognitionSupported,
  ttsSpeaking,
  voiceDecision,
  type SpeechRecognitionLike,
  type WakeAction,
} from '@/lib/speech'

/** Jawne wyłączenie nasłuchu w tej przeglądarce (domyślnie nasłuch startuje sam). */
const OFF_STORAGE_KEY = 'magazynier.wake-off'
/** Po samym prefiksie czekamy tyle na komendę. */
const ARMED_MS = SPEECH_WINDOW_MS
/** Co tyle sprawdzamy, czy wznowić nasłuch (koniec sesji, koniec mowy TTS). */
const SUPERVISOR_MS = 500
const MAX_UTTERANCE_MS = SPEECH_WINDOW_MS
/** Krótsze nagranie nie trafia do serwera (zostaje tekst z przeglądarki). */
const MIN_AUDIO_MS = 300

export type WakePhase = 'off' | 'starting' | 'listening' | 'hearing' | 'refining' | 'paused'
export type WakeEvent = Exclude<WakeAction, { type: 'ignore' } | { type: 'tentative' }>
export type CardStatus = { pending: boolean; fresh: boolean }

const noopSubscribe = () => () => {}

/** Czy przeglądarka ma Web Speech API (po hydratacji; na serwerze zawsze false). */
export function useSpeechRecognitionSupported(): boolean {
  return useSyncExternalStore(noopSubscribe, speechRecognitionSupported, () => false)
}

// Zapamiętane „wyłącz” — localStorage, a gdy niedostępny (tryb prywatny) — pamięć karty.
let sessionOff: boolean | null = null
const offListeners = new Set<() => void>()

function readOff(): boolean {
  if (sessionOff !== null) return sessionOff
  try {
    return window.localStorage.getItem(OFF_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeOff(off: boolean) {
  sessionOff = off
  try {
    if (off) window.localStorage.setItem(OFF_STORAGE_KEY, '1')
    else window.localStorage.removeItem(OFF_STORAGE_KEY)
  } catch {
    /* zablokowane dane strony — wybór działa do zamknięcia karty */
  }
  offListeners.forEach((listener) => listener())
}

function subscribeOff(listener: () => void) {
  offListeners.add(listener)
  return () => {
    offListeners.delete(listener)
  }
}

type Options = {
  /** tryb wake_word, nie demo, ustawienia wczytane */
  enabled: boolean
  prefix: string
  /**
   * Poprawianie komendy transkrypcją serwera (ustawienie `stt_refine`). Wyłączone: ostateczny jest
   * tekst przeglądarki, bez nagrywania PCM i bez wysyłania dźwięku.
   */
  refine: boolean
  /** Agent kończy poprzednią komendę — nie przechwytuj kolejnej wypowiedzi. */
  paused: boolean
  /** karta zmiany czeka (`pending`) i jest świeża (`fresh` — decyzja także bez prefiksu) */
  cardStatus: () => CardStatus
  onEvent: (event: WakeEvent) => void
  onCorrection: (note: string) => void
  readQuestion: (text: string) => string | null
}

/**
 * Nasłuch „ręce wolne”: startuje sam w trybie wake_word (chyba że użytkownik go wyłączył),
 * rozpoznawanie przeglądarki daje podgląd na żywo i wykrywa prefiks, a nagranie PCM fraz
 * z prefiksem idzie do STT na serwerze (dokładniejszy tekst komendy). Decyzje o karcie
 * zmiany („zatwierdź”/„odrzuć”) rozpoznaje sama przeglądarka. Wstrzymany, gdy mówi TTS.
 */
export function useWakeListener({ enabled, prefix, refine: refineEnabled, paused, cardStatus, onEvent, onCorrection, readQuestion }: Options) {
  const supported = useSpeechRecognitionSupported()
  // na serwerze i przy hydratacji „wyłączony” — mikrofon rusza dopiero w przeglądarce
  const userOff = useSyncExternalStore(subscribeOff, readOff, () => true)
  const [error, setError] = useState('')
  const [phase, setPhase] = useState<WakePhase>('starting')
  const [audioSuspended, setAudioSuspended] = useState(false)
  const active = enabled && supported && !userOff && !error

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const recorderRef = useRef<PcmRecorder | null>(null)
  const utteranceStartRef = useRef(new Map<number, number>())
  const speechStartRef = useRef<number | null>(null)
  const sessionRef = useRef(0)
  const armedUntilRef = useRef(0)
  const blockedUntilRef = useRef(0)
  const networkErrorsRef = useRef(0)
  const cuePlayedRef = useRef(false)
  const hearingCueRef = useRef(false)
  const optionsRef = useRef({ prefix, cardStatus, onEvent, onCorrection, refine: refineEnabled, paused, readQuestion })
  const refineQueueRef = useRef(createOrderedQueue<SpeechTranscription | null>())
  const pendingRefinesRef = useRef(0)
  const commandBufferRef = useRef<ReturnType<typeof createSpeechCommandBuffer> | null>(null)
  const decisionBufferRef = useRef(false)
  const wakeResultIndexRef = useRef<number | null>(null)
  const speechWindowRef = useRef<ReturnType<typeof createSpeechWindow> | null>(null)
  const capturedAudioRef = useRef<{ samples: Float32Array; sampleRate: number } | null>(null)

  useEffect(() => {
    optionsRef.current = { prefix, cardStatus, onEvent, onCorrection, refine: refineEnabled, paused, readQuestion }
  })

  const recorder = useCallback(() => {
    recorderRef.current ??= new PcmRecorder()
    return recorderRef.current
  }, [])

  const stopRecognition = useCallback(() => {
    const recognition = recognitionRef.current
    recognitionRef.current = null
    if (!recognition) return
    abortRecognition(recognition)
  }, [])

  const stopCapture = useCallback(() => {
    const pcm = recorderRef.current
    if (pcm?.isRunning && !pcm.suspended) {
      capturedAudioRef.current = { samples: pcm.slice(0, pcm.now()), sampleRate: pcm.sampleRate }
    }
    pcm?.stop()
  }, [])

  /** Koniec nasłuchu: rozpoznawanie, nagrywanie i mikrofon zwolnione, trwające STT porzucone. */
  const stopAll = useCallback(() => {
    commandBufferRef.current?.clear()
    speechWindowRef.current?.clear()
    capturedAudioRef.current = null
    decisionBufferRef.current = false
    wakeResultIndexRef.current = null
    sessionRef.current++
    refineQueueRef.current.cancel()
    pendingRefinesRef.current = 0
    armedUntilRef.current = 0
    cuePlayedRef.current = false
    hearingCueRef.current = false
    stopRecognition()
    recorderRef.current?.stop()
  }, [stopRecognition])

  const fail = useCallback(
    (message: string) => {
      stopAll()
      blockedUntilRef.current = Number.POSITIVE_INFINITY
      setError(message)
    },
    [stopAll],
  )

  const startSpeechWindow = useCallback(() => {
    speechWindowRef.current ??= createSpeechWindow(() => {
      // Release both microphone consumers at the deadline; never wait for onend.
      stopRecognition()
      stopCapture()
      armedUntilRef.current = 0
      const decision = decisionBufferRef.current
      const submitted = commandBufferRef.current?.finish(!decision)
      if (submitted) return
      if (optionsRef.current.cardStatus().pending) {
        decisionBufferRef.current = false
        setPhase('listening')
        optionsRef.current.onEvent({ type: 'reject' })
        return
      }
      // Nothing was captured: silence or speech that never became a command.
      // Return to listening — a hard failure here would kill the wake word on
      // every bit of background talk, so the prefix could never be used.
      stopAll()
      setPhase('listening')
    })
    if (!speechWindowRef.current.active) capturedAudioRef.current = null
    speechWindowRef.current.start()
  }, [stopAll, stopCapture, stopRecognition])

  useEffect(() => {
    stopAll()
  }, [prefix, refineEnabled, stopAll])

  // Nie czekaj na nadzorcę: stara sesja może jeszcze dopisać słowa do tego samego wyniku.
  const resetForReply = useCallback(() => {
    stopAll()
    setPhase('starting')
  }, [stopAll])

  // Fraza z prefiksem: najpierw tekst przeglądarki w polu, potem STT serwera z nagrania.
  // Transkrypcje biegną równolegle, ale komendy wychodzą w kolejności wypowiedzenia (kolejka);
  // zmiana sesji (wyłączenie nasłuchu, zmiana trybu) porzuca oczekujące.
  const refine = useCallback((_startMs: number, browserText: string) => {
    const session = sessionRef.current
    const audio = capturedAudioRef.current
    const transcribe = async (): Promise<SpeechTranscription | null> => {
      // nagranie wstrzymane (brak gestu) albo niedostępne → komendą zostaje tekst przeglądarki
      if (!audio) return null
      if (session !== sessionRef.current) return null
      if (audio.samples.length < (audio.sampleRate * MIN_AUDIO_MS) / 1000) return null
      try {
        return await transcribeAudioDetailed(wavBlob(audio.samples, audio.sampleRate))
      } catch {
        return null // 429 / 503 / sieć → zostaje tekst przeglądarki
      }
    }
    pendingRefinesRef.current++
    setPhase('refining')
    void refineQueueRef.current.push(transcribe(), (serverResult) => {
      pendingRefinesRef.current = Math.max(0, pendingRefinesRef.current - 1)
      if (session !== sessionRef.current) return
      if (serverResult?.corrections?.length) optionsRef.current.onCorrection(speechCorrectionNote(serverResult.corrections))
      const result = commandFromServerText(serverResult?.text ?? '', optionsRef.current.prefix, browserText)
      if (result.type === 'armed') {
        setPhase('listening')
        // STT returning only the address must not open another recording window.
        if (browserText.trim()) optionsRef.current.onEvent({ type: 'submit', text: cleanSpeechCommand(browserText) })
        else fail('Nie rozpoznałem komendy. Kliknij „Spróbuj ponownie” albo wpisz ją ręcznie.')
      } else {
        setPhase(pendingRefinesRef.current > 0 ? 'refining' : 'listening')
        optionsRef.current.onEvent(result)
      }
    })
  }, [fail])

  const commandBuffer = useCallback(() => {
    commandBufferRef.current ??= createSpeechCommandBuffer((text, startMs) => {
      speechWindowRef.current?.clear()
      stopRecognition()
      stopCapture()
      armedUntilRef.current = 0
      hearingCueRef.current = false
      if (decisionBufferRef.current) {
        decisionBufferRef.current = false
        recorderRef.current?.stop()
        setPhase('listening')
        if (optionsRef.current.cardStatus().pending) optionsRef.current.onEvent({ type: voiceDecision(text, optionsRef.current.prefix) ?? 'reject' })
        return
      }
      text = cleanSpeechCommand(text)
      const question = optionsRef.current.readQuestion(text)
      if (question) {
        recorderRef.current?.stop()
        setPhase('listening')
        optionsRef.current.onEvent({ type: 'submit', text: question })
        return
      }
      if (optionsRef.current.refine) {
        refine(startMs ?? 0, text)
      } else {
        setPhase('listening')
        optionsRef.current.onEvent({ type: 'submit', text })
      }
    }, 500, undefined, { intervalMs: SUPERVISOR_MS, maxMs: MAX_UTTERANCE_MS, retainInterim: true, readQuestion: text => decisionBufferRef.current ? null : optionsRef.current.readQuestion(text) })
    return commandBufferRef.current
  }, [refine, stopCapture, stopRecognition])

  const handle = useCallback(
    (transcript: string, isFinal: boolean, startMs: number | null, index: number) => {
      transcript = cleanSpeechCommand(transcript)
      const { prefix: currentPrefix, cardStatus: card, onEvent: emit } = optionsRef.current
      const wake = latestWakeWord(transcript, currentPrefix)
      if (wake.matched) {
        startSpeechWindow()
        if (wakeResultIndexRef.current === null || index > wakeResultIndexRef.current) commandBufferRef.current?.clear()
        wakeResultIndexRef.current = index
        transcript = `${currentPrefix}, ${wake.rest}`
      } else if (wakeResultIndexRef.current !== null && index <= wakeResultIndexRef.current) return
      if (!isFinal && matchWakeWord(transcript, currentPrefix).matched) armedUntilRef.current = Date.now() + ARMED_MS
      const armed = Date.now() < armedUntilRef.current || Boolean(commandBufferRef.current?.pending)
      const status = card()
      if (!status.pending) decisionBufferRef.current = false
      const action = decideWakeAction({
        transcript,
        isFinal,
        prefix: currentPrefix,
        armed,
        proposalPending: status.pending,
        proposalFresh: status.fresh,
      })
      if (optionsRef.current.refine && (action.type === 'armed' || action.type === 'interim' || action.type === 'submit')) {
        void recorder().start().catch(() => {})
      }
      if (status.pending && (action.type === 'tentative' || action.type === 'confirm' || action.type === 'reject')) {
        startSpeechWindow()
        decisionBufferRef.current = true
        const text = commandBuffer().update(index, transcript, isFinal, startMs)
        setPhase('hearing')
        emit({ type: 'interim', text })
        return
      }
      if (action.type === 'armed' || action.type === 'interim' || action.type === 'submit') {
        if (!hearingCueRef.current) playListeningCue()
        hearingCueRef.current = true
      } else if (action.type === 'confirm' || action.type === 'reject') hearingCueRef.current = false
      if (action.type === 'tentative') {
        // „Tak” may still become „tak, ale nie teraz”. Never confirm interim speech.
        setPhase('hearing')
        emit({ type: 'interim', text: transcript })
        return
      }
      if (action.type === 'ignore') {
        if (isFinal && !armed) setPhase('listening')
        return
      }
      if (action.type === 'submit' || (action.type === 'interim' && (action.text || commandBufferRef.current?.pending))) {
        const text = commandBuffer().update(index, action.text, isFinal, startMs, matchWakeWord(transcript, currentPrefix).matched)
        setPhase('hearing')
        emit({ type: 'interim', text })
        return
      }
      if (action.type === 'armed') {
        commandBufferRef.current?.clear()
        armedUntilRef.current = Date.now() + ARMED_MS
      }
      else if (action.type !== 'interim') armedUntilRef.current = 0
      if (action.type === 'confirm' || action.type === 'reject') commandBufferRef.current?.clear()
      setPhase(action.type === 'interim' || action.type === 'armed' ? 'hearing' : 'listening')
      emit(action)
    },
    [commandBuffer, recorder, startSpeechWindow],
  )

  const startRecognition = useCallback(() => {
    if (recognitionRef.current || optionsRef.current.paused || pendingRefinesRef.current > 0 || commandBufferRef.current?.pending) return
    const recognition = createRecognition({ continuous: true })
    if (!recognition) return
    // nowa sesja przeglądarki numeruje wyniki od zera
    utteranceStartRef.current = new Map()
    wakeResultIndexRef.current = null
    speechStartRef.current = null
    recognition.onstart = () => {
      if (recognitionRef.current !== recognition) return
      if (!cuePlayedRef.current) playListeningCue()
      cuePlayedRef.current = true
      setPhase((current) => (current === 'hearing' || current === 'refining' ? current : 'listening'))
    }
    recognition.onspeechstart = () => {
      if (recognitionRef.current !== recognition || optionsRef.current.paused) return
      speechStartRef.current = recorderRef.current?.now() ?? null
      setPhase('hearing')
    }
    recognition.onresult = (event) => {
      if (recognitionRef.current !== recognition || optionsRef.current.paused) return
      networkErrorsRef.current = 0
      const starts = utteranceStartRef.current
      const entries = resultEntries(event, optionsRef.current.prefix)
      // The bounded attempt applies only to speech that can plausibly be a
      // command: an armed follow-up or a capture already in progress. Bare
      // speech (conversation around the wake word) must not trip the deadline —
      // handle() starts the window itself when an entry matches the prefix.
      if (entries.length && (Date.now() < armedUntilRef.current || Boolean(commandBufferRef.current?.pending))) startSpeechWindow()
      for (const entry of entries) {
        if (starts.has(entry.index)) continue
        // początek wypowiedzi na zegarze nagrania: pierwszy wynik pod tym indeksem (lub speechstart)
        starts.set(entry.index, speechStartRef.current ?? recorderRef.current?.now() ?? 0)
        speechStartRef.current = null
      }
      for (const entry of entries) {
        if (recognitionRef.current !== recognition) return
        if (entry.isFinal) handle(entry.transcript, true, starts.get(entry.index) ?? null, entry.index)
      }
      if (recognitionRef.current !== recognition) return
      // Keep each interim under its own result index. Joining two under the first
      // index used to duplicate the second phrase when both became final.
      for (const entry of entries) {
        if (entry.isFinal) continue
        if (recognitionRef.current !== recognition) return
        handle(entry.transcript, false, starts.get(entry.index) ?? null, entry.index)
      }
      // Discard completed background speech instead of leaving it in the next
      // recognition session's cumulative transcript.
      if (entries.length && entries.every(entry => entry.isFinal) && wakeResultIndexRef.current === null && Date.now() >= armedUntilRef.current && !commandBufferRef.current?.pending) {
        speechWindowRef.current?.clear()
        stopRecognition()
        utteranceStartRef.current.clear()
      }
    }
    recognition.onerror = (event) => {
      if (recognitionRef.current !== recognition) return
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        fail(
          'Brak dostępu do mikrofonu. Zezwól na mikrofon dla tej strony (ikona przy pasku adresu), a potem kliknij „Spróbuj ponownie”.',
        )
      } else if (event.error === 'audio-capture') {
        fail('Nie wykryto mikrofonu. Podłącz go i kliknij „Spróbuj ponownie”.')
      } else if (event.error === 'network') {
        networkErrorsRef.current += 1
        fail('Usługa rozpoznawania mowy nie odpowiada. Kliknij „Mów”, aby nagrać 3-sekundową komendę do rozpoznania na serwerze, albo wpisz ją ręcznie.')
      }
      // no-speech / aborted → nadzorca wznowi nasłuch
    }
    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null
        commandBufferRef.current?.endSession()
        if (!commandBufferRef.current?.pending) decisionBufferRef.current = false
        if (pendingRefinesRef.current === 0) setPhase(Date.now() < armedUntilRef.current ? 'hearing' : 'listening')
      }
    }
    try {
      recognition.start()
      recognitionRef.current = recognition
    } catch {
      blockedUntilRef.current = Date.now() + 1000
    }
  }, [fail, handle, stopRecognition])

  /** Start w obsłudze kliknięcia — część przeglądarek wymaga gestu (mikrofon, AudioContext). */
  const startNow = useCallback(() => {
    unlockListeningCue()
    networkErrorsRef.current = 0
    blockedUntilRef.current = 0
    if (!ttsSpeaking()) startRecognition()
  }, [startRecognition])

  // Nagrywanie PCM tylko przy włączonym poprawianiu (bez niego żadnego AudioContext ani drugiego
  // odbiorcy mikrofonu). Zatrzymanie zwalnia mikrofon.
  useEffect(() => {
    if (!active || !refineEnabled) {
      recorderRef.current?.stop()
      return
    }
    return () => recorderRef.current?.stop()
  }, [active, refineEnabled])

  // Nadzorca: start po wejściu (przeglądarka zapyta o mikrofon), wznawianie po końcu sesji,
  // pauza, gdy mówi syntezator.
  useEffect(() => {
    if (!active) {
      stopAll()
      return
    }
    const tick = () => {
      setAudioSuspended(recorderRef.current?.suspended ?? false)
      if (optionsRef.current.paused || ttsSpeaking()) {
        speechWindowRef.current?.clear()
        commandBufferRef.current?.clear()
        armedUntilRef.current = 0
        hearingCueRef.current = false
        cuePlayedRef.current = false
        if (recognitionRef.current) stopRecognition()
        recorderRef.current?.stop()
        setPhase('paused')
        return
      }
      if (pendingRefinesRef.current > 0) {
        cuePlayedRef.current = false
        if (recognitionRef.current) stopRecognition()
        return
      }
      if (armedUntilRef.current && Date.now() > armedUntilRef.current && !commandBufferRef.current?.pending) {
        armedUntilRef.current = 0
        hearingCueRef.current = false
        setPhase('listening')
      }
      if (!recognitionRef.current && Date.now() >= blockedUntilRef.current) startRecognition()
    }
    const timer = setInterval(tick, SUPERVISOR_MS)
    const first = setTimeout(tick, 0)
    return () => {
      clearInterval(timer)
      clearTimeout(first)
      stopAll()
    }
  }, [active, startRecognition, stopAll, stopRecognition])

  const turnOff = useCallback(() => {
    stopAll()
    setPhase('starting')
    writeOff(true)
  }, [stopAll])

  const turnOn = useCallback(() => {
    setError('')
    setPhase('starting')
    writeOff(false)
    if (enabled && supported) startNow()
  }, [enabled, startNow, supported])

  /** Po błędzie (np. brak zgody na mikrofon) — ponowna próba z kliknięcia. */
  const retry = useCallback(() => {
    setError('')
    setPhase('starting')
    if (enabled && supported) startNow()
  }, [enabled, startNow, supported])

  return {
    supported,
    on: active,
    userOff,
    phase: active ? phase : 'off',
    error,
    audioSuspended: active && refineEnabled && audioSuspended,
    turnOff,
    turnOn,
    retry,
    resetForReply,
    stopForRetry: fail,
  }
}
