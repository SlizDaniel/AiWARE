// Tryb „ręce wolne” na telefonie: nasłuch w segmentach (chunkach) nagrywanych po kolei,
// każdy transkrybowany przez /api/stt. Dopasowanie prefiksu i decyzje o karcie zmiany
// korzystają ze wspólnej logiki klienta webowego (src/lib/speech.ts).
import { findWakeWord, normalizeSpeech, voiceDecision } from '../../../src/lib/speech'

/** Po samym prefiksie czekamy tyle na komendę (jak w kliencie webowym). */
export const ARMED_MS = 8_000
/** Długość jednego nagrania nasłuchu: krótkie, żeby prefix i komenda zmieściły się razem. */
export const CHUNK_MS = 6_000
/** Tyle kolejnych nieudanych transkrypcji kończy sesję nasłuchu błędem. */
export const MAX_STT_FAILURES = 3
/** Szczyt głośności chunka (dBFS) poniżej którego uznajemy ciszę — STT ciszy halucynuje komendy. */
export const SILENCE_METERING_DB = -45

export type ChunkAction =
  | { type: 'ignore' }
  | { type: 'submit'; text: string }
  | { type: 'armed' }
  | { type: 'confirm' }
  | { type: 'reject' }

export type WakeChunkInput = {
  transcript: string
  prefix: string
  /** znacznik czasu, do którego kolejne chunki są komendą bez prefiksu (0 = nieuzbrojone) */
  armedUntil: number
  now: number
  proposalPending: boolean
  /** decyzja bez prefiksu („tak”) tylko przy świeżej karcie zmiany */
  proposalFresh?: boolean
}

/**
 * Decyzja dla transkrypcji jednego chunka. W przeciwieństwie do przeglądarki (wyniki na żywo)
 * transkrypcja serwera jest zawsze końcowa, a nagranie może zacząć się w środku wypowiedzi —
 * dlatego prefix szukamy też kilka słów w głąb (jak w `commandFromServerText` weba).
 */
export function decideChunk({ transcript, prefix, armedUntil, now, proposalPending, proposalFresh }: WakeChunkInput): ChunkAction {
  const heard = transcript.replace(/\s+/g, ' ').trim()
  if (!heard) return { type: 'ignore' }
  if (proposalPending) {
    const decision = voiceDecision(heard, prefix, { withoutWakeWord: proposalFresh ?? proposalPending })
    if (decision) return { type: decision }
  }
  const wake = findWakeWord(heard, prefix)
  if (wake.matched) return normalizeSpeech(wake.rest) ? { type: 'submit', text: wake.rest } : { type: 'armed' }
  if (now < armedUntil) return { type: 'submit', text: heard }
  return { type: 'ignore' }
}

/** armedUntil po danej decyzji: uzbrojenie po samym prefiksie, kasowanie po komendzie/decyzji. */
export function nextArmedUntil(action: ChunkAction, now: number, current: number): number {
  if (action.type === 'armed') return now + ARMED_MS
  if (action.type === 'ignore') return current
  return 0
}

/**
 * Czy chunk nadaje się do transkrypcji: ciszę odsiewamy, bo STT bez mowy potrafi
 * „usłyszeć” passującą komendę ze słownika magazynu. Gdy platforma nie dostarcza
 * miernika (null/undefined), ostrożnie zakładamy mowę.
 */
export function hasSpeechAudio(peakMetering: number | null | undefined): boolean {
  if (peakMetering == null) return true
  return peakMetering >= SILENCE_METERING_DB
}
