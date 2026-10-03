// Odpowiedzi agenta czytane głosem (Web Speech API przeglądarki, polski głos).
// Zasada karty 15: nigdy nie czytamy długich tekstów — maks. 2 zdania; błąd → cisza.

export const MAX_SPOKEN_SENTENCES = 2
export const MAX_SPOKEN_CHARS = 220

// Granica zdania: . ! ? … zakończone spacją, po której NIE idzie mała litera
// (dzięki temu „54 szt. kartonów” czy „np. szkło” nie dzielą zdania).
const SENTENCE_BOUNDARY = /(?<=[.!?…])\s+(?!\p{Ll})/u

function normalizeForSpeech(text: string): string {
  return text
    .replace(/\s*·\s*/g, ', ')
    .replace(/\s*→\s*/g, ' na ')
    .replace(/[„”"*_`#]/g, '')
}

/** Tekst do syntezy: najwyżej `maxSentences` zdań (linia też kończy zdanie) i `MAX_SPOKEN_CHARS` znaków. */
export function truncateForSpeech(text: string, maxSentences = MAX_SPOKEN_SENTENCES): string {
  if (maxSentences < 1) return ''
  const sentences: string[] = []
  for (const rawLine of normalizeForSpeech(text).split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, '').replace(/\s+/g, ' ').trim()
    if (!line) continue
    for (const sentence of line.split(SENTENCE_BOUNDARY)) {
      const trimmed = sentence.trim()
      if (trimmed) sentences.push(trimmed)
      if (sentences.length >= maxSentences) break
    }
    if (sentences.length >= maxSentences) break
  }
  const joined = sentences.join(' ')
  if (joined.length <= MAX_SPOKEN_CHARS) return joined
  const cut = joined.slice(0, MAX_SPOKEN_CHARS)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > MAX_SPOKEN_CHARS / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:]+$/, '')}…`
}

type VoiceLike = Pick<SpeechSynthesisVoice, 'lang' | 'localService' | 'default'>

/** Polski głos: najpierw pl-PL, potem dowolny pl-*, lokalne przed sieciowymi. */
export function pickPolishVoice<V extends VoiceLike>(voices: readonly V[]): V | null {
  const polish = voices.filter((voice) => voice.lang.replace('_', '-').toLowerCase().startsWith('pl'))
  const score = (voice: V) =>
    (voice.lang.replace('_', '-').toLowerCase() === 'pl-pl' ? 2 : 0) + (voice.localService ? 1 : 0)
  return [...polish].sort((a, b) => score(b) - score(a))[0] ?? null
}

/** Czyta krótki komunikat po polsku. Brak wsparcia lub błąd → cicho nic nie robi. */
export function speak(text: string): void {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    if (typeof SpeechSynthesisUtterance === 'undefined') return
    const line = truncateForSpeech(text)
    if (!line) return
    const synth = window.speechSynthesis
    const utterance = new SpeechSynthesisUtterance(line)
    utterance.lang = 'pl-PL'
    const voice = pickPolishVoice(synth.getVoices())
    if (voice) utterance.voice = voice
    utterance.onerror = () => {
      /* cisza zamiast błędu */
    }
    synth.cancel()
    synth.speak(utterance)
  } catch {
    /* TTS jest dodatkiem — nigdy nie psuje UI */
  }
}
