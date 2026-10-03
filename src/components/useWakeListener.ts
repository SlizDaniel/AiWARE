import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { transcribeAudio } from '@/lib/api'
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

const STORAGE_KEY = 'magazynier.wake-listening'
/** Po samym prefiksie czekamy tyle na komendę. */
const ARMED_MS = 8000
/** Co tyle sprawdzamy, czy wznowić nasłuch (koniec sesji, koniec mowy TTS). */
const SUPERVISOR_MS = 300
const MAX_NETWORK_ERRORS = 3
/** Wycinek do STT: zapas przed pierwszym wynikiem przeglądarki i „ogon” po wyniku końcowym. */
const LEAD_MS = 800
const TAIL_MS = 250
/** Krótsze nagranie nie trafia do serwera (zostaje tekst z przeglądarki). */
const MIN_AUDIO_MS = 300
/** Gdy nie znamy początku wypowiedzi — tyle wstecz od wyniku końcowego. */
const UNKNOWN_START_MS = 4000

export type WakePhase = 'off' | 'starting' | 'listening' | 'hearing' | 'refining' | 'paused'
export type WakeEvent = Exclude<WakeAction, { type: 'ignore' }>

const noopSubscribe = () => () => {}

/** Czy przeglądarka ma Web Speech API (po hydratacji; na serwerze zawsze false). */
export function useSpeechRecognitionSupported(): boolean {
  return useSyncExternalStore(noopSubscribe, speechRecognitionSupported, () => false)
}

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeStored(on: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? '1' : '0')
  } catch {
    /* tryb prywatny / zablokowane dane strony — nasłuch działa, tylko bez zapamiętania */
  }
}

async function microphoneGranted(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    return status.state === 'granted'
  } catch {
    return false
  }
}

type Options = {
  /** tryb wake_word, nie demo, ustawienia wczytane */
  enabled: boolean
  prefix: string
  proposalPending: () => boolean
  onEvent: (event: WakeEvent) => void
}

/**
 * Nasłuch „ręce wolne”: ciągłe rozpoznawanie przeglądarki (podgląd na żywo + wykrycie prefiksu)
 * z automatycznym wznawianiem. Równolegle bufor PCM z mikrofonu — po frazie z prefiksem jej
 * nagranie idzie do STT na serwerze, a komendą zostaje dokładniejszy tekst serwera.
 * „tak”/„nie” przy karcie zmiany rozpoznaje sama przeglądarka. Wstrzymany, gdy mówi TTS.
 */
export function useWakeListener({ enabled, prefix, proposalPending, onEvent }: Options) {
  const supported = useSpeechRecognitionSupported()
  const [on, setOn] = useState(false)
  const [phase, setPhase] = useState<WakePhase>('off')
  const [error, setError] = useState('')

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const recorderRef = useRef<PcmRecorder | null>(null)
  const utteranceStartRef = useRef(new Map<number, number>())
  const speechStartRef = useRef<number | null>(null)
  const sessionRef = useRef(0)
  const armedUntilRef = useRef(0)
  const blockedUntilRef = useRef(0)
  const networkErrorsRef = useRef(0)
  const optionsRef = useRef({ prefix, proposalPending, onEvent })

  useEffect(() => {
    optionsRef.current = { prefix, proposalPending, onEvent }
  })

  const recorder = useCallback(() => {
    recorderRef.current ??= new PcmRecorder()
    return recorderRef.current
  }, [])

  const stopRecognition = useCallback(() => {
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
  }, [])

  /** Koniec nasłuchu: rozpoznawanie, nagrywanie i mikrofon zwolnione, trwające STT porzucone. */
  const stopAll = useCallback(() => {
    sessionRef.current++
    stopRecognition()
    recorderRef.current?.stop()
  }, [stopRecognition])

  const fail = useCallback(
    (message: string) => {
      stopAll()
      armedUntilRef.current = 0
      setOn(false)
      setPhase('off')
      setError(message)
      writeStored(false)
    },
    [stopAll],
  )

  // Fraza z prefiksem: najpierw tekst przeglądarki w polu, potem STT serwera z nagrania.
  const refine = useCallback(
    async (startMs: number, browserText: string) => {
      const session = sessionRef.current
      const pcm = recorderRef.current
      const emit = (event: WakeEvent) => {
        if (session === sessionRef.current) optionsRef.current.onEvent(event)
      }
      let serverText = ''
      if (pcm?.isRunning) {
        setPhase('refining')
        await delay(TAIL_MS)
        if (session !== sessionRef.current) return
        const samples = pcm.slice(Math.max(0, startMs - LEAD_MS), pcm.now())
        if (samples.length >= (pcm.sampleRate * MIN_AUDIO_MS) / 1000) {
          try {
            serverText = await transcribeAudio(wavBlob(samples, pcm.sampleRate))
          } catch {
            serverText = '' // 503 / sieć → zostaje tekst przeglądarki
          }
        }
        if (session !== sessionRef.current) return
      }
      const result = commandFromServerText(serverText, optionsRef.current.prefix, browserText)
      if (result.type === 'armed') {
        armedUntilRef.current = Date.now() + ARMED_MS
        setPhase('hearing')
        emit({ type: 'armed' })
      } else {
        setPhase('listening')
        emit(result)
      }
    },
    [],
  )

  const handle = useCallback(
    (transcript: string, isFinal: boolean, startMs: number | null) => {
      const { prefix: currentPrefix, proposalPending: pending, onEvent: emit } = optionsRef.current
      const armed = Date.now() < armedUntilRef.current
      const action = decideWakeAction({ transcript, isFinal, prefix: currentPrefix, armed, proposalPending: pending() })
      if (action.type === 'ignore') {
        if (isFinal && !armed) setPhase('listening')
        return
      }
      if (action.type === 'armed') armedUntilRef.current = Date.now() + ARMED_MS
      else if (action.type !== 'interim') armedUntilRef.current = 0
      if (action.type === 'submit') {
        emit({ type: 'interim', text: action.text })
        const now = recorderRef.current?.now() ?? 0
        void refine(startMs ?? Math.max(0, now - UNKNOWN_START_MS), action.text)
        return
      }
      setPhase(action.type === 'interim' || action.type === 'armed' ? 'hearing' : 'listening')
      emit(action)
    },
    [refine],
  )

  const startRecognition = useCallback(() => {
    if (recognitionRef.current) return
    const recognition = createRecognition({ continuous: true })
    if (!recognition) return
    utteranceStartRef.current = new Map()
    speechStartRef.current = null
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
      for (const entry of entries) if (entry.isFinal) handle(entry.transcript, true, starts.get(entry.index) ?? null)
      const interim = entries
        .filter((entry) => !entry.isFinal)
        .map((entry) => entry.transcript)
        .join(' ')
      if (interim) handle(interim, false, null)
    }
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        fail('Brak dostępu do mikrofonu — zezwól na mikrofon dla tej strony, aby używać nasłuchu.')
      } else if (event.error === 'audio-capture') {
        fail('Nie wykryto mikrofonu — podłącz go i włącz nasłuch ponownie.')
      } else if (event.error === 'network') {
        networkErrorsRef.current += 1
        blockedUntilRef.current = Date.now() + 2000
        if (networkErrorsRef.current >= MAX_NETWORK_ERRORS) {
          fail('Rozpoznawanie mowy jest niedostępne (brak połączenia z usługą). Użyj pola tekstowego.')
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
  }, [fail, handle])

  // Nadzorca: wznawia nasłuch po końcu sesji, wstrzymuje go, gdy mówi syntezator.
  // Nagrywanie PCM działa przez cały czas nasłuchu (TTS nie przeszkadza — wycinamy tylko frazy).
  useEffect(() => {
    if (!on || !enabled || !supported) {
      stopAll()
      return
    }
    void recorder()
      .start()
      .catch(() => {
        /* bez nagrania komendą zostaje tekst przeglądarki */
      })
    const tick = () => {
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
  }, [on, enabled, supported, recorder, startRecognition, stopAll, stopRecognition])

  // Wznowienie po odświeżeniu strony — tylko gdy użytkownik wcześniej włączył nasłuch
  // i przeglądarka ma już zgodę na mikrofon (bez zgody czekamy na kliknięcie).
  useEffect(() => {
    if (!enabled || !supported || !readStored()) return
    let alive = true
    void microphoneGranted().then((granted) => {
      if (alive && granted) setOn(true)
    })
    return () => {
      alive = false
    }
  }, [enabled, supported])

  const toggle = useCallback(() => {
    setError('')
    armedUntilRef.current = 0
    networkErrorsRef.current = 0
    blockedUntilRef.current = 0
    if (on) {
      stopAll()
      setOn(false)
      setPhase('off')
      writeStored(false)
      return
    }
    setOn(true)
    setPhase('starting')
    writeStored(true)
    // start w obsłudze kliknięcia — część przeglądarek wymaga gestu (mikrofon, AudioContext)
    if (enabled && supported) {
      void recorder()
        .start()
        .catch(() => {})
      if (!ttsSpeaking()) startRecognition()
    }
  }, [enabled, on, recorder, startRecognition, stopAll, supported])

  const active = on && enabled && supported
  return { supported, on: active, phase: active ? phase : 'off', error, toggle }
}
