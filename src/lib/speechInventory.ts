import { levenshtein, matchWakeWord, normalizeSpeech } from './speech'

export type SpeechCorrection = { heard: string; name: string }

// Only an item at the end of a simple read/stock command. Never scan arbitrary
// prose: "bułki na półce" must not turn the shelf into another product.
const COUNT = '(?:[0-9]+|jedn[ąa]|dwie|dwa|trzy|cztery|pięć|sześć|siedem|osiem|dziewięć|dziesięć)'
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
  if (candidates.some((candidate) => candidate.folded === folded)) return { text, corrections: [] }
  const ranked = candidates
    .filter((candidate) => candidate.folded.split(' ').length === folded.split(' ').length)
    .map((candidate) => ({ ...candidate, distance: levenshtein(folded, candidate.folded) }))
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

export function speechCorrectionNote(corrections: readonly SpeechCorrection[]): string {
  return corrections.length
    ? `Dopasowano do nazw magazynu: ${corrections.map(({ heard, name }) => `„${heard}” → „${name}”`).join(', ')}. Sprawdź towar i ilość przed zatwierdzeniem.`
    : ''
}
