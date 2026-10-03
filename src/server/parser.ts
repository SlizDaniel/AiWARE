// Deterministyczny parser intencji (offline) — port 1:1 z legacy/backend/app/parser.py.
//
// Mapuje komendy demo na wywołania narzędzi — bez internetu, bez LLM
// (gwarantowana ścieżka dema awaryjnego, PRD: MockAgent/offline-parser):
//   - „wzięliśmy paletę X"  → update_stock(X, -2 * liczba_palet)
//   - „doszła paleta X"     → update_stock(X, +2 * liczba_palet)
//   - „strefa: X"           → add_zone(X)
//   - „ile mamy [X]?"       → get_stock(X)   / get_stock() dla całego magazynu
//   - „gdzie leży X?"       → get_location(X)
//   - „jak pakujemy X?"     → recall_procedure(X)
//   - „zapamiętaj: X …"     → remember_procedure(X, …)
//
// „paleta" = 2 szt., a X musi pasować do pozycji z bazy (po stemplach polskich
// odmian, np. „kartonów" → „Kartony"). Gdy intencja jest znana, ale towaru nie ma
// w bazie, parser ZWRACA intencję z `missingItem`. Wszystko inne → null.
//
// Regexy: Python `\w` i `\b` są unikodowe; w JS `\b` działa tylko dla ASCII,
// więc granicę słowa zapisujemy lookbehindem na klasie [\p{L}\p{N}_] (flaga `u`).
import type { ItemRef } from './types'

export const SZT_NA_PALETE = 2

/** Wynik mapowania intencji na narzędzie (tool call). */
export type ParsedCommand = {
  tool: string
  text: string
  args: Record<string, unknown>
  itemId?: number | null
  itemName?: string | null
  /** Rozpoznany towar, którego nie ma w bazie. */
  missingItem?: string | null
}

/** Delta stanu (dla narzędzi update_stock; 0 dla pozostałych). */
export function delta(parsed: ParsedCommand): number {
  const value = Number(parsed.args.delta ?? 0)
  return Number.isFinite(value) ? Math.trunc(value) : 0
}

// Python's Unicode \w and \b.
const W = '[\\p{L}\\p{N}_]'
const B = `(?<!${W})` // \b before a word character
// Python `.` matches anything except a newline (JS `.` also stops at CR and
// the Unicode line/paragraph separators), hence an explicit class.
const ANY = '[^\\n]'
const TAIL = '\\s*[?.!]*\\s*$'

const TAKE_RE = /wzi[ęe]liśmy/iu
const GOT_RE = /doszł[ayo]/iu // doszła / doszły / doszło
const PALETTE_RE = new RegExp(`${B}palet${W}*`, 'iu')
const AFTER_PALETTE_RE = new RegExp(`${B}palet${W}*\\s+(${ANY}+?)${TAIL}`, 'iu')
const COUNT_RE = new RegExp(`${B}([0-9]+|jedn${W}*|dw[oa]${W}*|trzy|cztery|pięć)\\s+palet`, 'iu')
const WORD_COUNTS: [string, number][] = [
  ['jedn', 1],
  ['dw', 2],
  ['trzy', 3],
  ['czter', 4],
  ['pięć', 5],
]
const TOKEN_RE = /[a-ząćęłńóśźż0-9]+/gu

const ZONE_RE = new RegExp(`${B}strefa\\s*:\\s*(${ANY}+?)${TAIL}`, 'iu')
const REMEMBER_RE = new RegExp(`${B}zapamiętaj\\s*:\\s*(${ANY}+?)${TAIL}`, 'iu')
const HOW_MANY_RE = new RegExp(`${B}ile\\s+mamy(?:\\s+(${ANY}+?))?${TAIL}`, 'iu')
const WHERE_RE = new RegExp(`${B}gdzie\\s+leż${W}*\\s+(${ANY}+?)${TAIL}`, 'iu')
const HOW_PACK_RE = new RegExp(`${B}jak\\s+(?:się\\s+)?pakuj${W}*\\s+(${ANY}+?)${TAIL}`, 'iu')

function command(
  tool: string,
  text: string,
  extra: { args?: Record<string, unknown>; itemId?: number; itemName?: string; missingItem?: string | null } = {},
): ParsedCommand {
  return {
    tool,
    text,
    args: extra.args ?? {},
    itemId: extra.itemId ?? null,
    itemName: extra.itemName ?? null,
    missingItem: extra.missingItem ?? null,
  }
}

function tokens(text: string): string[] {
  return text.match(TOKEN_RE) ?? []
}

export function parseCommand(text: string, items: ItemRef[]): ParsedCommand | null {
  if (!text) return null
  const t = text.toLowerCase().trim()

  const zone = ZONE_RE.exec(t)
  if (zone) {
    const name = zone[1].trim()
    return name ? command('add_zone', text, { args: { name } }) : null
  }

  const remember = REMEMBER_RE.exec(t)
  if (remember) {
    // treść procedury w ORYGINALNEJ wersji (regex na niezmienionym tekście)
    const orig = REMEMBER_RE.exec(text.trim()) ?? remember
    const fragment = orig[1].trim()
    // temat = pierwszy token frazy, treść = cała fraza
    const found = tokens(fragment.toLowerCase())
    return found.length
      ? command('remember_procedure', text, { args: { topic: found[0].toLowerCase(), text: fragment } })
      : null
  }

  const howMany = HOW_MANY_RE.exec(t)
  const where = WHERE_RE.exec(t)
  const howPack = HOW_PACK_RE.exec(t)

  let sign: number
  if (TAKE_RE.test(t)) {
    sign = -1
    if (!PALETTE_RE.test(t)) return null
  } else if (GOT_RE.test(t)) {
    sign = 1
    if (!PALETTE_RE.test(t)) return null
  } else if (howPack) {
    const topic = howPack[1].trim()
    return topic ? command('recall_procedure', text, { args: { topic } }) : null
  } else if (where) {
    return queryIntent('get_location', where[1].trim(), t, items, text)
  } else if (howMany) {
    const fragment = (howMany[1] ?? '').trim()
    return queryIntent('get_stock', fragment, t, items, text)
  } else {
    return null
  }

  // intencje update_stock: towar z bazy albo missingItem (bez args wykonania)
  const item = findItem(t, items)
  if (item !== null) {
    return command('update_stock', text, {
      args: { item_id: item.id, delta: sign * countPalets(t) * SZT_NA_PALETE },
      itemId: item.id,
      itemName: item.name,
    })
  }
  const after = AFTER_PALETTE_RE.exec(t)
  const missing = after ? after[1].trim() : null
  return command('update_stock', text, { missingItem: missing })
}

/** Pytania o stan/lokalizację: z towarem, bez towaru (cały magazyn) albo missingItem. */
function queryIntent(tool: string, fragment: string, t: string, items: ItemRef[], text: string): ParsedCommand {
  if (!fragment) return command(tool, text, { args: {} })
  const item = findItem(fragment, items) ?? findItem(t, items)
  if (item !== null) {
    return command(tool, text, { args: { item_id: item.id }, itemId: item.id, itemName: item.name })
  }
  return command(tool, text, { missingItem: fragment })
}

function countPalets(t: string): number {
  const match = COUNT_RE.exec(t)
  if (!match) return 1
  const word = match[1]
  if (/^[0-9]+$/.test(word)) return Number.parseInt(word, 10)
  for (const [prefix, n] of WORD_COUNTS) {
    if (word.startsWith(prefix)) return n
  }
  return 1
}

/** Dopasowanie towaru po stemplach: „Kartony" → „karton", „kartonów", „kartony"… */
function findItem(t: string, items: ItemRef[]): ItemRef | null {
  let best: [number, ItemRef] | null = null
  const found = tokens(t)
  for (const item of items) {
    const firstWord = item.name.toLowerCase().trim().split(/\s+/u)[0] ?? ''
    if (!firstWord) continue
    const chars = Array.from(firstWord)
    const stem = chars.slice(0, Math.max(4, chars.length - 2)).join('')
    const stemLength = Array.from(stem).length
    for (const token of found) {
      if (token.startsWith(stem)) {
        if (best === null || stemLength > best[0]) best = [stemLength, item]
        break
      }
    }
  }
  return best ? best[1] : null
}
