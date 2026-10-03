import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { transcribeAudio } from '@/lib/api'
import { createOrderedQueue } from '@/lib/orderedQueue'
import { delay, PcmRecorder, wavBlob } from '@/lib/pcmRecorder'
import {
  commandFromServerText,
  createRecognition,
  decideWakeAction,
  resultEntries,
  speechRecognitionSupported,
  ttsSpeaking,
  type SpeechRecognitionLike,
  type WakeAction,
} from '@/lib/speech'

/** Jawne wyłączenie nasłuchu w tej przeglądarce (domyślnie nasłuch startuje sam). */
const OFF_STORAGE_KEY = 'magazynier.wake-off'
/** Po samym prefiksie czekamy tyle na komendę. */
const ARMED_MS = 8000
/** Co tyle sprawdzamy, czy wznowić nasłuch (koniec sesji, koniec mowy TTS). */
const SUPERVISOR_MS = 300
const MAX_NETWORK_ERRORS = 3
/** Decyzja („zatwierdź”) w wyniku pośrednim wykonuje się, gdy tekst nie zmieni się przez tyle. */
const INTERIM_DECISION_MS = 700
/** Wycinek do STT: zapas przed pierwszym wynikiem przeglądarki i „ogon” po wyniku końcowym. */
const LEAD_MS = 800
const TAIL_MS = 250
/** Krótsze nagranie nie trafia do serwera (zostaje tekst z przeglądarki). */
const MIN_AUDIO_MS = 300
/** Gdy nie znamy początku wypowiedzi — tyle wstecz od wyniku końcowego. */
const UNKNOWN_START_MS = 4000

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
  /** karta zmiany czeka (`pending`) i jest świeża (`fresh` — decyzja także bez prefiksu) */
  cardStatus: () => CardStatus
  onEvent: (event: WakeEvent) => void
}

/**
 * Nasłuch „ręce wolne”: startuje sam w trybie wake_word (chyba że użytkownik go wyłączył),
 * rozpoznawanie przeglądarki daje podgląd na żywo i wykrywa prefiks, a nagranie PCM fraz
 * z prefiksem idzie do STT na serwerze (dokładniejszy tekst komendy). Decyzje o karcie
 * zmiany („zatwierdź”/„odrzuć”) rozpoznaje sama przeglądarka. Wstrzymany, gdy mówi TTS.
 */
export function useWakeListener({ enabled, prefix, refine: refineEnabled, cardStatus, onEvent }: Options) {
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
  const tentativeRef = useRef<{ index: number; text: string; timer: ReturnType<typeof setTimeout> } | null>(null)
  const decidedIndexRef = useRef(-1)
  const sessionRef = useRef(0)
  const armedUntilRef = useRef(0)
  const blockedUntilRef = useRef(0)
  const networkErrorsRef = useRef(0)
  const optionsRef = useRef({ prefix, cardStatus, onEvent, refine: refineEnabled })
  const refineQueueRef = useRef(createOrderedQueue<string>())
  const pendingRefinesRef = useRef(0)

  useEffect(() => {
    optionsRef.current = { prefix, cardStatus, onEvent, refine: refineEnabled }
  })

  const recorder = useCallback(() => {
    recorderRef.current ??= new PcmRecorder()
    return recorderRef.current
  }, [])

  const clearTentative = useCallback(() => {
    if (tentativeRef.current) clearTimeout(tentativeRef.current.timer)
    tentativeRef.current = null
  }, [])

  const stopRecognition = useCallback(() => {
    clearTentative()
    const recognition = recognitionRef.current
    recognitionRef.current = null
    if (!recognition) return
    recognition.onresult = null
    recognition.onerror = null
    recognition.onend = null
    recognition.onspeechstart = null
    try {
      recognition.abort()
    } catch {
      /* już zatrzymany */
    }
  }, [clearTentative])

  /** Koniec nasłuchu: rozpoznawanie, nagrywanie i mikrofon zwolnione, trwające STT porzucone. */
  const stopAll = useCallback(() => {
    sessionRef.current++
    refineQueueRef.current.cancel()
    pendingRefinesRef.current = 0
    armedUntilRef.current = 0
    stopRecognition()
  }, [stopRecognition])

  const fail = useCallback(
    (message: string) => {
      stopAll()
      setError(message)
    },
    [stopAll],
  )

  // Fraza z prefiksem: najpierw tekst przeglądarki w polu, potem STT serwera z nagrania.
  // Transkrypcje biegną równolegle, ale komendy wychodzą w kolejności wypowiedzenia (kolejka);
  // zmiana sesji (wyłączenie nasłuchu, zmiana trybu) porzuca oczekujące.
  const refine = useCallback((startMs: number, browserText: string) => {
    const session = sessionRef.current
    const pcm = recorderRef.current
    const transcribe = async (): Promise<string> => {
      // nagranie wstrzymane (brak gestu) albo niedostępne → komendą zostaje tekst przeglądarki
      if (!pcm?.isRunning || pcm.suspended) return ''
      await delay(TAIL_MS)
      if (session !== sessionRef.current) return ''
      const samples = pcm.slice(Math.max(0, startMs - LEAD_MS), pcm.now())
      if (samples.length < (pcm.sampleRate * MIN_AUDIO_MS) / 1000) return ''
      try {
        return await transcribeAudio(wavBlob(samples, pcm.sampleRate))
      } catch {
        return '' // 429 / 503 / sieć → zostaje tekst przeglądarki
      }
    }
    pendingRefinesRef.current++
    setPhase('refining')
    void refineQueueRef.current.push(transcribe(), (serverText) => {
      pendingRefinesRef.current = Math.max(0, pendingRefinesRef.current - 1)
      if (session !== sessionRef.current) return
      const result = commandFromServerText(serverText, optionsRef.current.prefix, browserText)
      if (result.type === 'armed') {
        armedUntilRef.current = Date.now() + ARMED_MS
        setPhase('hearing')
        optionsRef.current.onEvent({ type: 'armed' })
      } else {
        setPhase(pendingRefinesRef.current > 0 ? 'refining' : 'listening')
        optionsRef.current.onEvent(result)
      }
    })
  }, [])

  const handle = useCallback(
    (transcript: string, isFinal: boolean, startMs: number | null, index: number) => {
      const { prefix: currentPrefix, cardStatus: card, onEvent: emit } = optionsRef.current
      // decyzja wykonana już z wyniku pośredniego — jego wersja końcowa nic nie robi
      if (isFinal && decidedIndexRef.current === index) {
        decidedIndexRef.current = -1
        clearTentative()
        return
      }
      const armed = Date.now() < armedUntilRef.current
      const status = card()
      const action = decideWakeAction({
        transcript,
        isFinal,
        prefix: currentPrefix,
        armed,
        proposalPending: status.pending,
        proposalFresh: status.fresh,
      })
      if (action.type === 'tentative') {
        const current = tentativeRef.current
        if (current && current.index === index && current.text === transcript) return
        clearTentative()
        const timer = setTimeout(() => {
          tentativeRef.current = null
          if (!optionsRef.current.cardStatus().pending) return
          decidedIndexRef.current = index
          armedUntilRef.current = 0
          setPhase('listening')
          optionsRef.current.onEvent({ type: action.decision })
        }, INTERIM_DECISION_MS)
        tentativeRef.current = { index, text: transcript, timer }
        return
      }
      clearTentative()
      if (action.type === 'ignore') {
        if (isFinal && !armed) setPhase('listening')
        return
      }
      if (action.type === 'armed') armedUntilRef.current = Date.now() + ARMED_MS
      else if (action.type !== 'interim') armedUntilRef.current = 0
      if (action.type === 'submit' && !optionsRef.current.refine) {
        // tekst przeglądarki jest ostateczny — komenda od razu, bez nagrania i serwera
        setPhase('listening')
        emit(action)
        return
      }
      if (action.type === 'submit') {
        emit({ type: 'interim', text: action.text })
        const now = recorderRef.current?.now() ?? 0
        refine(startMs ?? Math.max(0, now - UNKNOWN_START_MS), action.text)
        return
      }
      setPhase(action.type === 'interim' || action.type === 'armed' ? 'hearing' : 'listening')
      emit(action)
    },
    [clearTentative, refine],
  )

  const startRecognition = useCallback(() => {
    if (recognitionRef.current) return
    const recognition = createRecognition({ continuous: true })
    if (!recognition) return
    // nowa sesja przeglądarki numeruje wyniki od zera
    utteranceStartRef.current = new Map()
    speechStartRef.current = null
    decidedIndexRef.current = -1
    clearTentative()
    recognition.onspeechstart = () => {
      speechStartRef.current = recorderRef.current?.now() ?? null
    }
    recognition.onresult = (event) => {
      networkErrorsRef.current = 0
      const starts = utteranceStartRef.current
      const entries = resultEntries(event)
      for (const entry of entries) {
        if (starts.has(entry.index)) continue
        // początek wypowiedzi na zegarze nagrania: pierwszy wynik pod tym indeksem (lub speechstart)
        starts.set(entry.index, speechStartRef.current ?? recorderRef.current?.now() ?? 0)
        speechStartRef.current = null
      }
      for (const entry of entries) if (entry.isFinal) handle(entry.transcript, true, starts.get(entry.index) ?? null, entry.index)
      const interim = entries.filter((entry) => !entry.isFinal)
      if (interim.length) {
        handle(
          interim.map((entry) => entry.transcript).join(' '),
          false,
          null,
          interim[0].index,
        )
      }
    }
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        fail(
          'Brak dostępu do mikrofonu. Zezwól na mikrofon dla tej strony (ikona przy pasku adresu), a potem kliknij „Spróbuj ponownie”.',
        )
      } else if (event.error === 'audio-capture') {
        fail('Nie wykryto mikrofonu. Podłącz go i kliknij „Spróbuj ponownie”.')
      } else if (event.error === 'network') {
        networkErrorsRef.current += 1
        blockedUntilRef.current = Date.now() + 2000
        if (networkErrorsRef.current >= MAX_NETWORK_ERRORS) {
          fail('Rozpoznawanie mowy jest niedostępne (brak połączenia z usługą). Użyj pola tekstowego albo kliknij „Spróbuj ponownie”.')
        }
      }
      // no-speech / aborted → nadzorca wznowi nasłuch
    }
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null
    }
    try {
      recognition.start()
      recognitionRef.current = recognition
      setPhase((current) => (current === 'hearing' || current === 'refining' ? current : 'listening'))
    } catch {
      blockedUntilRef.current = Date.now() + 1000
    }
  }, [clearTentative, fail, handle])

  /** Start w obsłudze kliknięcia — część przeglądarek wymaga gestu (mikrofon, AudioContext). */
  const startNow = useCallback(() => {
    networkErrorsRef.current = 0
    blockedUntilRef.current = 0
    if (optionsRef.current.refine) {
      void recorder()
        .start()
        .catch(() => {})
    }
    if (!ttsSpeaking()) startRecognition()
  }, [recorder, startRecognition])

  // Nagrywanie PCM tylko przy włączonym poprawianiu (bez niego żadnego AudioContext ani drugiego
  // odbiorcy mikrofonu). Zatrzymanie zwalnia mikrofon.
  useEffect(() => {
    if (!active || !refineEnabled) {
      recorderRef.current?.stop()
      return
    }
    void recorder()
      .start()
      .catch(() => {
        /* bez nagrania komendą zostaje tekst przeglądarki */
      })
    return () => recorderRef.current?.stop()
  }, [active, refineEnabled, recorder])

  // Nadzorca: start po wejściu (przeglądarka zapyta o mikrofon), wznawianie po końcu sesji,
  // pauza, gdy mówi syntezator.
  useEffect(() => {
    if (!active) {
      stopAll()
      return
    }
    const tick = () => {
      setAudioSuspended(recorderRef.current?.suspended ?? false)
      if (ttsSpeaking()) {
        if (recognitionRef.current) stopRecognition()
        setPhase('paused')
        return
      }
      if (armedUntilRef.current && Date.now() > armedUntilRef.current) {
        armedUntilRef.current = 0
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
  }
}
