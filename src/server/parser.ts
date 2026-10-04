// Deterministyczny parser intencji (offline), rozszerzony po migracji z Pythona.
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
// „paleta" = 2 jednostki (przelicznik demo). Obsługujemy też sztuki i rolki,
// pełne nazwy oraz ograniczoną odmianę polską. Niejasność → clarification;
// nieznany towar → missingItem; nierozpoznana intencja → null.
//
// Regexy: Python `\w` i `\b` są unikodowe; w JS `\b` działa tylko dla ASCII,
// więc granicę słowa zapisujemy lookbehindem na klasie [\p{L}\p{N}_] (flaga `u`).
import type { ItemRef } from './types'
import { inventoryFamily, matchInventoryNames } from '@/lib/inventoryNames'
import { normalizeSpeech } from '@/lib/speech'

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
  clarification?: string
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

const TAKE = 'wez|wzielismy|wzialem|wzielam|pobralismy|pobralem|pobralam|zabralismy|zabralem|zabralam|wydalismy|wydalem|wydalam|zuzylismy|zuzylem|zuzylam'
const GOT = 'doszla|doszly|doszlo|przyjelismy|przyjalem|przyjelam|zwrocilismy|zwrocilem|zwrocilam'
const STOCK_RE = new RegExp(`^(${TAKE}|${GOT})\\s+(.+)$`, 'u')
const STOCK_VERB = new RegExp(`(?:^| )(${TAKE}|${GOT}|wezmiemy|pobierzemy|przyjmiemy)(?: |$)`, 'u')
const COUNTS: Record<string, number> = { jedna: 1, jeden: 1, jedno: 1, dwa: 2, dwie: 2, trzy: 3, cztery: 4, piec: 5,
  szesc: 6, siedem: 7, osiem: 8, dziewiec: 9, dziesiec: 10, jedenascie: 11, dwanascie: 12 }
const UNITS = /^(palete|paleta|palety|palet|sztuke|sztuka|sztuki|sztuk|szt\.?|rolke|rolka|rolki|rolek|jednostke|jednostka|jednostki|jednostek)(?:\s+|$)/u
const SINGULAR_UNITS = new Set(['palete', 'paleta', 'sztuke', 'sztuka', 'rolke', 'rolka', 'jednostke', 'jednostka'])
const TOKEN_RE = /[a-ząćęłńóśźż0-9]+/gu

const ZONE_RE = new RegExp(`${B}strefa\\s*:\\s*(${ANY}+?)${TAIL}`, 'iu')
const REMEMBER_RE = new RegExp(`${B}zapamiętaj\\s*:\\s*(${ANY}+?)${TAIL}`, 'iu')
const HOW_MANY_RE = new RegExp(`${B}(?:ile\\s+(?:mamy|jest)|podaj\\s+(?:aktualny\\s+)?stan)(?:\\s+(${ANY}+?))?${TAIL}`, 'iu')
const WHERE_RE = new RegExp(`${B}gdzie\\s+(?:leż${W}*|znajd[eę]|jest|s[aą])\\s+(${ANY}+?)${TAIL}`, 'iu')
const HOW_PACK_RE = new RegExp(`${B}jak\\s+(?:się\\s+)?(?:pakuj${W}*|(?:za)?pakowa[ćc])\\s+(${ANY}+?)${TAIL}`, 'iu')

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

  const taskQuestion = /^(?:jakie|jakiego|jaki)\s+(?:zadanie|zadania|taska|task|taski)\s+ma\s+(.+?)[?.!]*$/iu.exec(t)
    ?? /^co\s+(?:robi|ma\s+do\s+zrobienia)\s+(.+?)[?.!]*$/iu.exec(t)
  if (taskQuestion) return command('get_work_tasks', text, { args: { employee: taskQuestion[1].trim() } })
  if (/^(?:jakie\s+(?:mam|są\s+moje)\s+(?:zadania|taski)|(?:pokaż|pokaz|podaj)\s+moje\s+(?:zadania|taski))[?.!]*$/iu.test(t)) {
    return command('get_work_tasks', text)
  }

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

  if (howPack) {
    const topic = howPack[1].trim()
    return topic ? command('recall_procedure', text, { args: { topic } }) : null
  } else if (where) {
    return queryIntent('get_location', where[1].trim(), items, text)
  } else if (howMany) {
    const fragment = (howMany[1] ?? '').trim()
    return queryIntent('get_stock', fragment, items, text)
  }
  return parseStock(text, items)
}

/** Lista opcji przy niejednoznacznym towarze — dopowiedzenie jednej cechy domyka komendę. */
function ambiguousMessage(matches: readonly ItemRef[]): string {
  return `Pasuje kilka produktów: ${matches.map((match) => `„${match.name}”`).join(', ')}. Dopowiedz różnicę, np. „duże”, albo podaj pełną nazwę.`
}

/** Rodzinę („Kartony” z wariantami) rozstrzyga wyłącznie dokładna nazwa, nie odmieniona. */
function familyAmbiguous(fragment: string, item: ItemRef, items: ItemRef[]): boolean {
  return normalizeSpeech(fragment) !== normalizeSpeech(item.name) && inventoryFamily(item.name, items).length > 0
}

/** Pytania o stan/lokalizację: z towarem, bez towaru (cały magazyn) albo missingItem. */
function queryIntent(tool: string, fragment: string, items: ItemRef[], text: string): ParsedCommand {
  if (!fragment) return command(tool, text, { args: {} })
  const matches = matchInventoryNames(fragment, items)
  if (matches.length > 1) return clarify(tool, text, ambiguousMessage(matches))
  const item = matches[0] ?? null
  if (item !== null) {
    if (familyAmbiguous(fragment, item, items)) {
      return clarify(tool, text, ambiguousMessage([item, ...inventoryFamily(item.name, items)]))
    }
    return command(tool, text, { args: { item_id: item.id }, itemId: item.id, itemName: item.name })
  }
  return command(tool, text, { missingItem: fragment })
}

function clarify(tool: string, text: string, clarification: string): ParsedCommand {
  return { ...command(tool, text), clarification }
}

/** A narrow guard shared with the LLM path; uncertain stock statements must be clarified. */
export function stockCommandConcern(text: string): string | null {
  const normalized = normalizeSpeech(text)
  if (!STOCK_VERB.test(normalized)) return null
  if (/(?:^| )(?:nie|jutro|moze|chyba|jesli|gdyby|planuje|planujemy|wezmiemy|pobierzemy|przyjmiemy)(?: |$)/u.test(normalized)) {
    return 'Podaj jedną pewną zmianę zapasu: co przyjęto lub wydano i w jakiej ilości. Negacja lub plan nie zmienia stanu.'
  }
  if (/\d[.,]\d|(?:^|\s)-\d/u.test(text)) return 'Podaj dodatnią, całkowitą ilość. Nie przeliczam ułamków ani ujemnych ilości.'
  return null
}

function parseStock(text: string, items: ItemRef[]): ParsedCommand | null {
  const concern = stockCommandConcern(text)
  if (concern) return clarify('update_stock', text, concern)
  // Preserve decimal signs: 1,5 must never become 15 or a guessed single pallet.
  const folded = text.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/[.!?]+$/, '')
  const match = STOCK_RE.exec(folded)
  if (!match) return null
  let rest = match[2].trim()
  const first = rest.split(/\s+/u)[0]
  const count = /^\d+$/.test(first) ? Number(first) : COUNTS[first]
  if (count !== undefined) rest = rest.slice(first.length).trim()
  const unit = UNITS.exec(rest)
  if (unit) rest = rest.slice(unit[0].length).trim()
  if (count === undefined && !unit) return clarify('update_stock', text, 'Podaj ilość i jednostkę, np. „wziąłem 3 sztuki kartonów”.')
  const quantity = count ?? (unit && SINGULAR_UNITS.has(unit[1]) ? 1 : 0)
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1_000_000 || !rest) {
    return clarify('update_stock', text, 'Podaj dodatnią, całkowitą ilość i nazwę towaru.')
  }
  const matches = matchInventoryNames(rest, items)
  if (matches.length > 1) return clarify('update_stock', text, ambiguousMessage(matches))
  if (!matches.length) {
    if (!unit && /^(?:kg|kilogram\p{L}*|litr\p{L}*|metr\p{L}*|pacz\p{L}*|opakowan\p{L}*|skrzyn\p{L}*)(?: |$)/u.test(rest)) {
      return clarify('update_stock', text, 'Nie znam przelicznika tej jednostki. Podaj ilość w jednostce towaru ze Stanów.')
    }
    if (/(?:^| )(?:i|oraz|ale|nie|na|do|z|ze|w)(?: |$)/u.test(rest) || /[,.!?;]/u.test(rest)) {
      return clarify('update_stock', text, 'Podaj jedną operację i pełną nazwę jednego towaru.')
    }
    return command('update_stock', text, { missingItem: text.normalize('NFC').trim().replace(/[.!?]+$/, '').slice(-rest.length).toLowerCase() })
  }
  const item = matches[0]
  if (familyAmbiguous(rest, item, items)) {
    return clarify('update_stock', text, ambiguousMessage([item, ...inventoryFamily(item.name, items)]))
  }
  const spokenUnit = unit?.[1] ?? ''
  if (item.unit && (spokenUnit.startsWith('rol') || spokenUnit.startsWith('szt'))) {
    const storedUnit = normalizeSpeech(item.unit)
    const compatible = spokenUnit.startsWith('rol') ? ['rolka', 'rolki', 'rolek'].includes(storedUnit)
      : ['szt', 'sztuka', 'sztuki', 'sztuk'].includes(storedUnit)
    if (!compatible) return clarify('update_stock', text, `Towar „${item.name}” jest liczony w „${item.unit}”. Podaj ilość w tej jednostce.`)
  }
  const sign = new RegExp(`^(?:${TAKE})$`, 'u').test(match[1]) ? -1 : 1
  return command('update_stock', text, { itemId: item.id, itemName: item.name,
    args: { item_id: item.id, delta: sign * quantity * (unit?.[1].startsWith('palet') ? SZT_NA_PALETE : 1) } })
}
