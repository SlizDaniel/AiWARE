import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { AudioModule, setAudioModeAsync, type AudioRecorder } from 'expo-audio'
import * as Speech from 'expo-speech'
import type { Api } from '../lib/client'
import { readRecording } from '../lib/recording'
import { CHUNK_MS, MAX_STT_FAILURES, decideChunk, hasSpeechAudio, nextArmedUntil } from '../lib/wake'

export type WakePhase = 'off' | 'starting' | 'listening' | 'armed' | 'transcribing' | 'paused' | 'error'
export type WakeEvent = { type: 'submit'; text: string } | { type: 'armed' } | { type: 'confirm' } | { type: 'reject' }

const delay = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms) })

/**
 * Nasłuch „ręce wolne” na telefonie: sesja włączana przyciskiem nagrywa kolejne krótkie
 * chunki, każdy trafia do /api/stt, a decyzje (prefix, komenda, „tak”/„nie”) podejmuje
 * decideChunk na wspólnej logice weba. Sesja kończy się po wyjściu z panelu lub aplikacji
 * do tła, po błędzie mikrofonu albo serii nieudanych transkrypcji; mówiący TTS wstrzymuje
 * pętlę, żeby agent nie słyszał samego siebie.
 */
export function useWakeListener({ enabled, prefix, api, recorder, active, cardStatus, onEvent, tts }: {
  /** tryb wake_word, nie demo — przycisk nasłuchu jest dostępny tylko wtedy */
  enabled: boolean
  prefix: string
  api: Api
  recorder: AudioRecorder
  /** panel komend widoczny (karta zmiany pozostaje zamontowana w innych sekcjach) */
  active: boolean
  cardStatus: () => { pending: boolean; fresh: boolean }
  onEvent: (event: WakeEvent) => void
  tts: boolean
}) {
  const [phase, setPhase] = useState<WakePhase>('off')
  const [error, setError] = useState('')
  const running = useRef(false)
  const session = useRef(0)
  const armedUntil = useRef(0)
  const failures = useRef(0)
  const latest = useRef({ prefix, cardStatus, onEvent, tts })
  useEffect(() => { latest.current = { prefix, cardStatus, onEvent, tts } })

  const releaseMic = useCallback(() => {
    void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined)
  }, [])

  const stop = useCallback(() => {
    running.current = false
    session.current++
    armedUntil.current = 0
    if (recorder.isRecording) void recorder.stop().catch(() => undefined).finally(releaseMic)
    else releaseMic()
    setPhase('off')
  }, [recorder, releaseMic])

  const fail = useCallback((message: string) => {
    running.current = false
    session.current++
    armedUntil.current = 0
    if (recorder.isRecording) void recorder.stop().catch(() => undefined).finally(releaseMic)
    else releaseMic()
    setError(message)
    setPhase('error')
  }, [recorder, releaseMic])

  const loop = useCallback(async (id: number) => {
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
    while (running.current && id === session.current) {
      if (latest.current.tts) {
        let speaking = true
        while (speaking && running.current && id === session.current) {
          speaking = await Speech.isSpeakingAsync().catch(() => false)
          if (speaking) { setPhase('paused'); await delay(300) }
        }
      }
      if (!running.current || id !== session.current) break
      setPhase(armedUntil.current > Date.now() ? 'armed' : 'listening')
      try {
        await recorder.prepareToRecordAsync()
        recorder.record()
      } catch {
        fail('Mikrofon jest niedostępny. Sprawdź, czy inne aplikacje go nie używają, i spróbuj ponownie.')
        return
      }
      // Próbkujemy miernik, żeby ciszę (halucynacje STT) odsiewać przed transkrypcją;
      // krótki interwał dodatkowo szybko przerywa nagranie po wyjściu z panelu.
      let peak: number | undefined
      const startedAt = Date.now()
      while (Date.now() - startedAt < CHUNK_MS && running.current && id === session.current) {
        const level = recorder.getStatus().metering
        if (level != null && (peak === undefined || level > peak)) peak = level
        await delay(150)
      }
      await recorder.stop().catch(() => undefined)
      if (!running.current || id !== session.current) { releaseMic(); return }
      if (!hasSpeechAudio(peak)) continue
      setPhase('transcribing')
      try {
        const recording = await readRecording(recorder.uri)
        const transcript = await api.transcribe(recording.bytes, recording.mime, recording.extension)
        failures.current = 0
        const now = Date.now()
        const status = latest.current.cardStatus()
        const action = decideChunk({
          transcript, prefix: latest.current.prefix, armedUntil: armedUntil.current, now,
          proposalPending: status.pending, proposalFresh: status.fresh,
        })
        armedUntil.current = nextArmedUntil(action, now, armedUntil.current)
        if (action.type !== 'ignore') latest.current.onEvent(action)
      } catch (transcribeError) {
        failures.current += 1
        if (failures.current >= MAX_STT_FAILURES) {
          fail(transcribeError instanceof Error ? `Nasłuch zatrzymany: ${transcribeError.message}` : 'Nasłuch zatrzymany — transkrypcja niedostępna.')
          return
        }
      }
    }
    releaseMic()
  }, [api, fail, recorder, releaseMic])

  const start = useCallback(async () => {
    if (running.current) return
    setError(''); setPhase('starting')
    running.current = true
    failures.current = 0
    armedUntil.current = 0
    const id = ++session.current
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync()
      if (!permission.granted) throw new Error('Brak dostępu do mikrofonu. Włącz go w ustawieniach telefonu albo wpisz komendę.')
      if (!running.current || id !== session.current) return
      await loop(id)
    } catch (permissionError) {
      if (running.current && id === session.current) {
        fail(permissionError instanceof Error ? permissionError.message : 'Nie udało się włączyć nasłuchu.')
      }
    }
  }, [fail, loop])

  useEffect(() => {
    if (!enabled || !active) stop()
  }, [enabled, active, stop])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') stop() })
    return () => { subscription.remove(); stop() }
  }, [stop])

  const on = phase !== 'off' && phase !== 'error'
  return { on, phase, error, start, stop }
}
