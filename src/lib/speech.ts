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
  onstart?: (() => void) | null
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
    recognition.maxAlternatives = 3
    return recognition
  } catch {
    return null
  }
}

/** Odetnij wyniki starej wypowiedzi przed przejściem do odpowiedzi na kartę. */
export function abortRecognition(recognition: SpeechRecognitionLike): void {
  recognition.onresult = null
  recognition.onerror = null
  recognition.onend = null
  recognition.onstart = null
  recognition.onspeechstart = null
  try {
    recognition.abort()
  } catch {
    /* sesja już zakończona */
  }
}

/** Cały dotychczasowy tekst sesji (wyniki końcowe + bieżący pośredni). */
export function fullTranscript(results: SpeechResultListLike, prefix = ''): string {
  const parts: string[] = []
  for (let index = 0; index < results.length; index++) parts.push(preferredSpeechTranscript(results[index], prefix))
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
export function resultEntries(event: SpeechRecognitionEventLike, prefix = ''): { index: number; transcript: string; isFinal: boolean }[] {
  const entries: { index: number; transcript: string; isFinal: boolean }[] = []
  for (let index = event.resultIndex; index < event.results.length; index++) {
    const result = event.results[index]
    const transcript = preferredSpeechTranscript(result, prefix).trim()
    if (transcript) entries.push({ index, transcript, isFinal: Boolean(result.isFinal) })
  }
  return entries
}

/** Only repair a wake word when an alternative keeps the entire command intact. */
export function preferredSpeechTranscript(result: SpeechResultLike | undefined, prefix = ''): string {
  const top = result?.[0]?.transcript ?? ''
  if (!result?.isFinal || !prefix || matchWakeWord(top, prefix).matched || isConfirmPhrase(top) || isRejectPhrase(top)) return top
  for (let index = 1; index < Math.min(result.length, 3); index++) {
    const alternative = result[index]
    if (!alternative || alternative.confidence < 0.5) continue
    const wake = matchWakeWord(alternative.transcript, prefix)
    if (!wake.matched || isConfirmPhrase(wake.rest) || isRejectPhrase(wake.rest)) continue
    const heard = normalizeSpeech(top)
    const rest = normalizeSpeech(wake.rest)
    if (rest && !heard.endsWith(` ${rest}`)) continue
    const heardPrefix = rest ? heard.slice(0, -(rest.length + 1)) : heard
    if (levenshtein(heardPrefix.replace(/ /g, ''), normalizeSpeech(prefix)) <= 2) return alternative.transcript
  }
  return top
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

function wakeAt(text: string, words: RegExpMatchArray[], index: number, prefix: string): { matched: boolean; rest: string } {
  const first = words[index]
  if (!first) return { matched: false, rest: '' }
  const next = words[index + 1]
  // Check a split prefix before fuzzy matching its first fragment ("Mag u").
  const split = prefix.length >= 4 && next && normalizeSpeech(first[0] + next[0]) === prefix
  if (!split && !wordMatchesPrefix(first[0], prefix)) return { matched: false, rest: '' }
  const last = split ? next : first
  return { matched: true, rest: text.slice(last.index! + last[0].length).replace(/^[\s,.:;!?—–-]+/, '').trim() }
}

/**
 * Prefix jako pierwsze słowo wypowiedzi (z tolerancją jednej litery dla ≥ 4 liter),
 * ewentualnie po „hej”/„ej”. `rest` to oryginalny tekst po prefiksie.
 */
export function matchWakeWord(transcript: string, prefix: string): { matched: boolean; rest: string } {
  const wanted = normalizeSpeech(prefix)
  const words = [...transcript.matchAll(/[\p{L}\p{N}]+/gu)]
  if (!wanted || words.length === 0) return { matched: false, rest: '' }
  const first = wakeAt(transcript, words, 0, wanted)
  if (first.matched) return first
  return WAKE_FILLERS.has(normalizeSpeech(words[0][0]))
    ? wakeAt(transcript, words, 1, wanted) : { matched: false, rest: '' }
}

/**
 * Prefix w pierwszych `maxOffset + 1` słowach (nagranie z serwera może zacząć się
 * końcówką poprzedniej frazy). `rest` to tekst po prefiksie.
 */
export function findWakeWord(transcript: string, prefix: string, maxOffset = 3): { matched: boolean; rest: string } {
  const wanted = normalizeSpeech(prefix)
  const words = [...transcript.matchAll(/[\p{L}\p{N}]+/gu)]
  if (!wanted) return { matched: false, rest: '' }
  const limit = Math.min(maxOffset, words.length - 1)
  for (let index = 0; index <= limit; index++) {
    const match = wakeAt(transcript, words, index, wanted)
    if (match.matched) return match
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

// Słownik decyzji o karcie zmiany (formy po normalizeSpeech: bez ogonków).
const CONFIRM_WORDS = [
  'tak',
  'zatwierdz',
  'zatwierdzam',
  'zatwierdzic',
  'zatwierdza',
  'potwierdz',
  'potwierdzam',
  'akceptuj',
  'akceptuje',
  'ok',
  'okej',
  'okay',
  'dobrze',
]
const REJECT_WORDS = ['nie', 'odrzuc', 'odrzucam', 'odrzucic', 'anuluj', 'anuluje', 'anulowac']
/** Słowa dozwolone tylko po „nie” („nie zapisuj”). */
const REJECT_AFTER_NIE = ['zapisuj', 'zapisywac']
const MAX_DECISION_WORDS = 4

/** Dokładnie albo (dla słów ≥ 5 liter) z jedną literą różnicy — Chrome bywa niedokładny w pisowni. */
function wordInVocabulary(word: string, vocabulary: readonly string[]): boolean {
  return vocabulary.some((known) => word === known || (known.length >= 5 && word.length >= 4 && levenshtein(word, known) <= 1))
}

function decisionWords(text: string): string[] | null {
  const words = normalizeSpeech(text).split(' ').filter(Boolean)
  return words.length > 0 && words.length <= MAX_DECISION_WORDS ? words : null
}

/** „tak”, „zatwierdź”, „zatwierdzam”, „potwierdzam”, „akceptuję”, „ok”, „dobrze”, „tak, zatwierdź”… (do 4 słów). */
export function isConfirmPhrase(text: string): boolean {
  const words = decisionWords(text)
  return Boolean(words?.every((word) => wordInVocabulary(word, CONFIRM_WORDS)))
}

/** „nie”, „odrzuć”, „odrzucam”, „anuluj”, „anuluję”, „nie zapisuj”… (do 4 słów). */
export function isRejectPhrase(text: string): boolean {
  const words = decisionWords(text)
  if (!words) return false
  return words.every(
    (word, index) =>
      wordInVocabulary(word, REJECT_WORDS) || (words.slice(0, index).includes('nie') && wordInVocabulary(word, REJECT_AFTER_NIE)),
  )
}

/**
 * Decyzja o karcie zmiany. Z prefiksem („Magu, zatwierdź”) — zawsze, gdy karta czeka;
 * bez prefiksu („tak”) — tylko gdy `withoutWakeWord` (świeża karta).
 */
export function voiceDecision(
  transcript: string,
  prefix: string,
  { withoutWakeWord = true }: { withoutWakeWord?: boolean } = {},
): 'confirm' | 'reject' | null {
  const wake = matchWakeWord(transcript, prefix)
  if (!wake.matched && !withoutWakeWord) return null
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
  /** decyzja w wyniku pośrednim — wykonać, jeśli tekst nie zmieni się przez chwilę */
  | { type: 'tentative'; decision: 'confirm' | 'reject' }

/**
 * Co zrobić z frazą usłyszaną w trybie nasłuchu. Bez prefiksu reagujemy tylko po „uzbrojeniu”
 * albo na decyzję o świeżej karcie zmiany (`proposalFresh`); z prefiksem — na decyzję o każdej
 * oczekującej karcie (`proposalPending`) albo na komendę.
 */
export function decideWakeAction({
  transcript,
  isFinal,
  prefix,
  armed,
  proposalPending,
  proposalFresh = proposalPending,
}: {
  transcript: string
  isFinal: boolean
  prefix: string
  armed: boolean
  proposalPending: boolean
  proposalFresh?: boolean
}): WakeAction {
  const heard = transcript.replace(/\s+/g, ' ').trim()
  if (!heard) return { type: 'ignore' }
  if (proposalPending) {
    const decision = voiceDecision(heard, prefix, { withoutWakeWord: proposalFresh })
    if (decision) return isFinal ? { type: decision } : { type: 'tentative', decision }
  }
  const wake = matchWakeWord(heard, prefix)
  if (wake.matched) {
    if (!isFinal) return { type: 'interim', text: wake.rest }
    return wake.rest ? { type: 'submit', text: wake.rest } : { type: 'armed' }
  }
  if (armed) return isFinal ? { type: 'submit', text: heard } : { type: 'interim', text: heard }
  return { type: 'ignore' }
}
