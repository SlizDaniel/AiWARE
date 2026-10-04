import { cleanSpeechCommand, levenshtein, matchWakeWord, normalizeSpeech } from './speech'
import { inventoryFamily, matchInventoryNames, sameInventoryWord } from './inventoryNames'

export type SpeechCorrection = { heard: string; name: string }

/** Extract a complete read-only question; trailing noise never changes an inventory write. */
export function extractInventoryQuestion(text: string, names: readonly string[]): string | null {
  const heard = normalizeSpeech(cleanSpeechCommand(text))
  const intent = /^(ile mamy|gdzie (?:lezy|leza|jest|sa)|jak pakujemy)\s+(.+)$/.exec(heard)
  if (!intent) return null
  const words = intent[2].split(' ')
  const matchesWord = (spoken: string, known: string) => {
    if (sameInventoryWord(spoken, known)) return true
    if (/\d/.test(spoken + known) || spoken.length < 4 || known.length < 4) return false
    const variants = [known]
    if (known.endsWith('y')) variants.push(known.slice(0, -1) + 'ow')
    if (known.endsWith('o')) variants.push(known.slice(0, -1) + 'a')
    if (known.endsWith('ki')) variants.push(known.slice(0, -2) + 'ek')
    return variants.some(variant => levenshtein(spoken, variant) <= 1)
  }
  const candidates = [...new Set(names)].map(name => ({ name, words: normalizeSpeech(name).split(' ') }))
  const matched = candidates.filter(candidate => {
    let index = 0
    for (const word of candidate.words) {
      if (!matchesWord(words[index] ?? '', word)) return false
      const previous = word
      index++
      // Repeated corrections: "kartnów kartonów dużych".
      while (index < words.length && matchesWord(words[index], previous)) index++
    }
    return true
  }).sort((a, b) => b.words.length - a.words.length)
  const best = matched[0]
  if (!best || matched.filter(candidate => candidate.words.length === best.words.length).length !== 1) return null
  // A variant win with an unspoken word („duże” was never said) over a shorter
  // matched item is a guess, and so is an inflected family lead („kartonów” may
  // mean Kartony duże albo małe). Both go to the server, which asks for a variant.
  if (best.words.length > words.length &&
      matched.some(candidate => candidate !== best &&
        normalizeSpeech(best.name).startsWith(`${normalizeSpeech(candidate.name)} `))) {
    return null
  }
  const exactSpoken = best.words.every((word, index) => words[index] === word)
  if (!exactSpoken && inventoryFamily(best.name, candidates).length > 0) return null
  const lead = intent[1].startsWith('gdzie') ? 'gdzie leży' : intent[1]
  return `${lead} ${best.name}`
}

// Only an item at the end of a simple read/stock command. Never scan arbitrary
// prose: "bułki na półce" must not turn the shelf into another product.
const COUNT = '(?:[0-9]+|jedn[ąa]|jeden|jedno|dwie|dwa|trzy|cztery|pięć|sześć|siedem|osiem|dziewięć|dziesięć|jedenaście|dwanaście)'
const UNIT = '(?:palet[ęay]|palet|sztuk[iaę]?|rolk[iaę]|rolek|jednostk[iaę]|jednostek)'
const ACTION = '(?:weź|wzięliśmy|pobraliśmy|zabraliśmy|wydaliśmy|przyjęliśmy|wziąłem|wzięłam|pobrałem|pobrałam|przyjąłem|przyjęłam|doszła|doszły|doszło)'
const ITEM_SLOT = new RegExp(
  `^(?<lead>(?:ile\\s+mamy|gdzie\\s+(?:leży|leżą)|${ACTION}\\s+(?:${COUNT}\\s+)?${UNIT}|${ACTION}\\s+${COUNT})\\s+)(?<item>[\\p{L} -]+?)(?<end>[?.!]*\\s*)$`, 'iu',
)
const CONNECTORS = new Set(['i', 'oraz', 'na', 'z', 'ze', 'w', 'do', 'ale'])

/** A conservative spelling suggestion; it never changes quantities or writes data. */
export function correctInventorySpeech(text: string, names: readonly string[], prefix = ''): { text: string; corrections: SpeechCorrection[] } {
  const wake = prefix ? matchWakeWord(text, prefix) : null
  const command = wake?.matched ? wake.rest : text
  const match = ITEM_SLOT.exec(command)
  if (!match?.groups) return { text, corrections: [] }
  const heard = match.groups.item.trim()
  const folded = normalizeSpeech(heard)
  if (folded.length < 4 || folded.length > 100 || folded.split(' ').some((word) => CONNECTORS.has(word))) {
    return { text, corrections: [] }
  }
  const candidates = [...new Set(names)].map((name) => ({ name, folded: normalizeSpeech(name) }))
  // An existing exact name always wins, including homophones and duplicated spellings.
  if (matchInventoryNames(heard, candidates).length) return { text, corrections: [] }
  const ranked = candidates
    .filter((candidate) => candidate.folded.length <= 100 && candidate.folded.split(' ').length === folded.split(' ').length)
    .map((candidate) => ({ ...candidate, distance: nameDistance(folded, candidate.folded) }))
    .sort((a, b) => a.distance - b.distance)
  const best = ranked[0]
  const limit = folded.length >= 5 ? 2 : 1
  if (!best || best.distance > limit || best.distance / Math.max(folded.length, best.folded.length) > 0.4 ||
      (ranked[1] && ranked[1].distance <= best.distance + 1)) return { text, corrections: [] }
  const corrected = match.groups.lead + best.name + match.groups.end
  return {
    text: wake?.matched ? `${prefix}, ${corrected}` : corrected,
    corrections: [{ heard, name: best.name }],
  }
}

function nameDistance(heard: string, name: string): number {
  const spoken = heard.split(' ')
  return name.split(' ').reduce((total, word, index) => {
    const token = spoken[index]
    if (sameInventoryWord(token, word)) return total
    const genitive = word.endsWith('ki') ? word.slice(0, -2) + 'ek' : word
    return total + Math.min(levenshtein(token, word), levenshtein(token, genitive))
  }, 0)
}

export function speechCorrectionNote(corrections: readonly SpeechCorrection[]): string {
  return corrections.length
    ? `Dopasowano do nazw magazynu: ${corrections.map(({ heard, name }) => `„${heard}” → „${name}”`).join(', ')}. Sprawdź towar i ilość przed zatwierdzeniem.`
    : ''
}
