import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  changedResults,
  createRecognition,
  decideWakeAction,
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

export type WakePhase = 'off' | 'starting' | 'listening' | 'hearing' | 'paused'
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
 * Nasłuch „ręce wolne”: ciągłe rozpoznawanie z automatycznym wznawianiem, reakcja tylko
 * na frazy zaczynające się od prefiksu (albo tak/nie przy oczekującej karcie zmiany).
 * Wstrzymany, gdy syntezator mowy mówi.
 */
export function useWakeListener({ enabled, prefix, proposalPending, onEvent }: Options) {
  const supported = useSpeechRecognitionSupported()
  const [on, setOn] = useState(false)
  const [phase, setPhase] = useState<WakePhase>('off')
  const [error, setError] = useState('')

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const armedUntilRef = useRef(0)
  const blockedUntilRef = useRef(0)
  const networkErrorsRef = useRef(0)
  const optionsRef = useRef({ prefix, proposalPending, onEvent })

  useEffect(() => {
    optionsRef.current = { prefix, proposalPending, onEvent }
  })

  const stopRecognition = useCallback(() => {
    const recognition = recognitionRef.current
    recognitionRef.current = null
    if (!recognition) return
    recognition.onresult = null
    recognition.onerror = null
    recognition.onend = null
    try {
      recognition.abort()
    } catch {
      /* już zatrzymany */
    }
  }, [])

  const fail = useCallback(
    (message: string) => {
      stopRecognition()
      armedUntilRef.current = 0
      setOn(false)
      setPhase('off')
      setError(message)
      writeStored(false)
    },
    [stopRecognition],
  )

  const handle = useCallback((transcript: string, isFinal: boolean) => {
    const { prefix: currentPrefix, proposalPending: pending, onEvent: emit } = optionsRef.current
    const armed = Date.now() < armedUntilRef.current
    const action = decideWakeAction({ transcript, isFinal, prefix: currentPrefix, armed, proposalPending: pending() })
    if (action.type === 'ignore') {
      if (isFinal && !armed) setPhase('listening')
      return
    }
    if (action.type === 'armed') armedUntilRef.current = Date.now() + ARMED_MS
    else if (action.type !== 'interim') armedUntilRef.current = 0
    setPhase(action.type === 'interim' || action.type === 'armed' ? 'hearing' : 'listening')
    emit(action)
  }, [])

  const startRecognition = useCallback(() => {
    if (recognitionRef.current) return
    const recognition = createRecognition({ continuous: true })
    if (!recognition) return
    recognition.onresult = (event) => {
      networkErrorsRef.current = 0
      const { finals, interim } = changedResults(event)
      for (const phrase of finals) handle(phrase, true)
      if (interim) handle(interim, false)
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
      setPhase((current) => (current === 'hearing' ? current : 'listening'))
    } catch {
      blockedUntilRef.current = Date.now() + 1000
    }
  }, [fail, handle])

  // Nadzorca: wznawia nasłuch po końcu sesji, wstrzymuje go, gdy mówi syntezator.
  useEffect(() => {
    if (!on || !enabled || !supported) {
      stopRecognition()
      return
    }
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
      stopRecognition()
    }
  }, [on, enabled, supported, startRecognition, stopRecognition])

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
      stopRecognition()
      setOn(false)
      setPhase('off')
      writeStored(false)
      return
    }
    setOn(true)
    setPhase('starting')
    writeStored(true)
    // start w obsłudze kliknięcia — część przeglądarek wymaga gestu użytkownika
    if (enabled && supported && !ttsSpeaking()) startRecognition()
  }, [enabled, on, startRecognition, stopRecognition, supported])

  const active = on && enabled && supported
  return { supported, on: active, phase: active ? phase : 'off', error, toggle }
}
