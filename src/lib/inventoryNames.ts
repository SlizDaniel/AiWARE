import { normalizeSpeech } from './speech'

// Deliberately limited Polish inflection, not arbitrary prefix/fuzzy matching.
const ENDINGS = new Set(['', 'a', 'u', 'y', 'i', 'e', 'o', 'ow', 'om', 'ami', 'ach', 'em', 'ie', 'ego', 'ych', 'ich', 'ej', 'ym', 'im'])

export function sameInventoryWord(left: string, right: string): boolean {
  if (left === right) return true
  if (/\d/.test(left + right)) return false // product codes must match exactly
  let shared = 0
  while (shared < left.length && shared < right.length && left[shared] === right[shared]) shared++
  if (shared < 3) return false
  const a = left.slice(shared), b = right.slice(shared)
  // bułki/bułek, śrubki/śrubek: the vowel moves inside the ending.
  if ((a === 'ek' && ['ki', 'ka', 'ke'].includes(b)) || (b === 'ek' && ['ki', 'ka', 'ke'].includes(a))) return true
  return ENDINGS.has(a) && ENDINGS.has(b)
}

/** Match every spoken word; never silently drop a product's spoken qualifier. */
export function matchInventoryNames<T extends { name: string }>(fragment: string, items: readonly T[]): T[] {
  const query = normalizeSpeech(fragment)
  if (!query) return []
  const exact = items.filter(item => normalizeSpeech(item.name) === query)
  if (exact.length) return exact
  const words = query.split(' ')
  const candidates = items.filter(item => {
    const name = normalizeSpeech(item.name).split(' ')
    return words.length <= name.length && words.every((word, index) => sameInventoryWord(word, name[index]))
  })
  const complete = candidates.filter(item => normalizeSpeech(item.name).split(' ').length === words.length)
  return complete.length ? complete : candidates
}
