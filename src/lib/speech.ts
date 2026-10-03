// Rozpoznawanie mowy na żywo w przeglądarce (Web Speech API, polski).
// Chrome/Edge wysyłają dźwięk do usługi rozpoznawania mowy Google; Firefox nie ma tego API —
// wtedy zostaje nagranie i transkrypcja na serwerze (/api/stt).

// --- typy (lib.dom nie zawiera SpeechRecognition) ---------------------------------------

export type SpeechAlternativeLike = { readonly transcript: string; readonly confidence: number }

export type SpeechResultLike = {
  readonly isFinal: boolean
  readonly length: number
  readonly [index: number]: SpeechAlternativeLike
}

export type SpeechResultListLike = {
  readonly length: number
  readonly [index: number]: SpeechResultLike
}

export type SpeechRecognitionEventLike = {
  readonly resultIndex: number
  readonly results: SpeechResultListLike
}

export type SpeechRecognitionErrorEventLike = {
  readonly error: string
  readonly message?: string
}

export interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  onspeechstart?: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

function recognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null
}

export function speechRecognitionSupported(): boolean {
  return recognitionConstructor() !== null
}

/** Nowy rozpoznawacz po polsku z wynikami pośrednimi; null, gdy przeglądarka go nie ma. */
export function createRecognition({ continuous }: { continuous: boolean }): SpeechRecognitionLike | null {
  const Recognition = recognitionConstructor()
  if (!Recognition) return null
  try {
    const recognition = new Recognition()
    recognition.lang = 'pl-PL'
    recognition.interimResults = true
    recognition.continuous = continuous
    recognition.maxAlternatives = 1
    return recognition
  } catch {
    return null
  }
}

/** Cały dotychczasowy tekst sesji (wyniki końcowe + bieżący pośredni). */
export function fullTranscript(results: SpeechResultListLike): string {
  const parts: string[] = []
  for (let index = 0; index < results.length; index++) parts.push(results[index]?.[0]?.transcript ?? '')
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/** Wyniki zmienione w tym zdarzeniu: zakończone frazy osobno, bieżący tekst pośredni razem. */
export function changedResults(event: SpeechRecognitionEventLike): { finals: string[]; interim: string } {
  const finals: string[] = []
  const interim: string[] = []
  for (let index = event.resultIndex; index < event.results.length; index++) {
    const result = event.results[index]
    const transcript = result?.[0]?.transcript?.trim() ?? ''
    if (!transcript) continue
    if (result.isFinal) finals.push(transcript)
    else interim.push(transcript)
  }
  return { finals, interim: interim.join(' ').replace(/\s+/g, ' ').trim() }
}

/** Wyniki zmienione w tym zdarzeniu z ich indeksami (do śledzenia początku wypowiedzi). */
export function resultEntries(event: SpeechRecognitionEventLike): { index: number; transcript: string; isFinal: boolean }[] {
  const entries: { index: number; transcript: string; isFinal: boolean }[] = []
  for (let index = event.resultIndex; index < event.results.length; index++) {
    const result = event.results[index]
    const transcript = result?.[0]?.transcript?.trim() ?? ''
    if (transcript) entries.push({ index, transcript, isFinal: Boolean(result.isFinal) })
  }
  return entries
}

/** Czy syntezator mowy właśnie mówi (nasłuch nie powinien słyszeć samego siebie). */
export function ttsSpeaking(): boolean {
  try {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.speaking
  } catch {
    return false
  }
}

// --- czyste funkcje dopasowania ---------------------------------------------------------

/** Małe litery, bez polskich znaków i interpunkcji, pojedyncze spacje. */
export function normalizeSpeech(text: string): string {
  return text
    .toLocaleLowerCase('pl-PL')
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
    }
    previous = current
  }
  return previous[b.length]
}

const WAKE_FILLERS = new Set(['hej', 'hey', 'ej', 'halo', 'no'])

function wordMatchesPrefix(word: string, prefix: string): boolean {
  const heard = normalizeSpeech(word)
  if (!heard) return false
  // krótkie prefiksy tylko dokładnie — inaczej łapałyby przypadkowe słowa
  return prefix.length >= 4 ? levenshtein(heard, prefix) <= 1 : heard === prefix
}

/**
 * Prefix jako pierwsze słowo wypowiedzi (z tolerancją jednej litery dla ≥ 4 liter),
 * ewentualnie po „hej”/„ej”. `rest` to oryginalny tekst po prefiksie.
 */
export function matchWakeWord(transcript: string, prefix: string): { matched: boolean; rest: string } {
  const wanted = normalizeSpeech(prefix)
  const words = transcript.trim().split(/\s+/).filter(Boolean)
  if (!wanted || words.length === 0) return { matched: false, rest: '' }
  let index = -1
  if (wordMatchesPrefix(words[0], wanted)) index = 0
  else if (words.length > 1 && WAKE_FILLERS.has(normalizeSpeech(words[0])) && wordMatchesPrefix(words[1], wanted)) index = 1
  if (index < 0) return { matched: false, rest: '' }
  const rest = words
    .slice(index + 1)
    .join(' ')
    .replace(/^[\s,.:;!?—–-]+/, '')
    .trim()
  return { matched: true, rest }
}

/**
 * Prefix w pierwszych `maxOffset + 1` słowach (nagranie z serwera może zacząć się
 * końcówką poprzedniej frazy). `rest` to tekst po prefiksie.
 */
export function findWakeWord(transcript: string, prefix: string, maxOffset = 3): { matched: boolean; rest: string } {
  const wanted = normalizeSpeech(prefix)
  const words = transcript.trim().split(/\s+/).filter(Boolean)
  if (!wanted) return { matched: false, rest: '' }
  const limit = Math.min(maxOffset, words.length - 1)
  for (let index = 0; index <= limit; index++) {
    if (!wordMatchesPrefix(words[index], wanted)) continue
    const rest = words
      .slice(index + 1)
      .join(' ')
      .replace(/^[\s,.:;!?—–-]+/, '')
      .trim()
    return { matched: true, rest }
  }
  return { matched: false, rest: '' }
}

/**
 * Komenda z transkrypcji serwera (dokładniejszej niż przeglądarka). Pusty wynik → tekst
 * z przeglądarki; sam prefiks → czekamy na komendę jak po samym „Magu”.
 */
export function commandFromServerText(
  serverText: string,
  prefix: string,
  browserText: string,
): { type: 'submit'; text: string } | { type: 'armed' } {
  const heard = serverText.replace(/\s+/g, ' ').trim()
  const fallback = browserText.trim()
  if (!normalizeSpeech(heard)) return fallback ? { type: 'submit', text: fallback } : { type: 'armed' }
  const wake = findWakeWord(heard, prefix)
  if (wake.matched) return normalizeSpeech(wake.rest) ? { type: 'submit', text: wake.rest } : { type: 'armed' }
  return { type: 'submit', text: heard }
}

const CONFIRM_WORDS = new Set(['tak', 'zatwierdz', 'zatwierdzam', 'potwierdz', 'potwierdzam', 'ok', 'okej', 'dobrze'])
const REJECT_WORDS = new Set(['nie', 'anuluj', 'odrzuc', 'odrzucam'])

function onlyWordsFrom(text: string, allowed: Set<string>): boolean {
  const words = normalizeSpeech(text).split(' ').filter(Boolean)
  return words.length > 0 && words.length <= 3 && words.every((word) => allowed.has(word))
}

/** „tak”, „zatwierdź”, „zatwierdzam”, „potwierdzam”, „ok”, „dobrze” (także powtórzone, np. „tak, zatwierdzam”). */
export function isConfirmPhrase(text: string): boolean {
  return onlyWordsFrom(text, CONFIRM_WORDS)
}

/** „nie”, „anuluj”, „odrzuć”, „odrzucam”. */
export function isRejectPhrase(text: string): boolean {
  return onlyWordsFrom(text, REJECT_WORDS)
}

/** Decyzja o karcie zmiany, z prefiksem lub bez („Magu, tak” / „tak”). */
export function voiceDecision(transcript: string, prefix: string): 'confirm' | 'reject' | null {
  const wake = matchWakeWord(transcript, prefix)
  const phrase = wake.matched ? wake.rest : transcript
  if (isConfirmPhrase(phrase)) return 'confirm'
  if (isRejectPhrase(phrase)) return 'reject'
  return null
}

export type WakeAction =
  | { type: 'ignore' }
  /** tekst po prefiksie na żywo (może być pusty — „Słucham…”) */
  | { type: 'interim'; text: string }
  /** sam prefiks — kolejna fraza (do ~8 s) będzie komendą */
  | { type: 'armed' }
  | { type: 'submit'; text: string }
  | { type: 'confirm' }
  | { type: 'reject' }

/** Co zrobić z frazą usłyszaną w trybie nasłuchu. Bez prefiksu reagujemy tylko po „uzbrojeniu” lub na tak/nie przy karcie. */
export function decideWakeAction({
  transcript,
  isFinal,
  prefix,
  armed,
  proposalPending,
}: {
  transcript: string
  isFinal: boolean
  prefix: string
  armed: boolean
  proposalPending: boolean
}): WakeAction {
  const heard = transcript.replace(/\s+/g, ' ').trim()
  if (!heard) return { type: 'ignore' }
  if (isFinal && proposalPending) {
    const decision = voiceDecision(heard, prefix)
    if (decision) return { type: decision }
  }
  const wake = matchWakeWord(heard, prefix)
  if (wake.matched) {
    if (!isFinal) return { type: 'interim', text: wake.rest }
    return wake.rest ? { type: 'submit', text: wake.rest } : { type: 'armed' }
  }
  if (armed) return isFinal ? { type: 'submit', text: heard } : { type: 'interim', text: heard }
  return { type: 'ignore' }
}
