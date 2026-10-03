// Inventory import/export adapter (CSV + XLSX) — a faithful port of
// legacy/backend/app/inventory.py. Python semantics that matter for users are
// reproduced on purpose: csv.Sniffer delimiter detection, the csv reader state
// machine, str.casefold/strip, unicodedata NFKD + combining-mark removal and
// int() parsing. XML is parsed by a tiny well-formedness-checking parser below
// (namespace prefixes are ignored, so prefixed and Strict-OOXML parts read too).
import { strToU8, unzipSync, zipSync } from 'fflate'
import type { ColumnMapping, ImportField, ImportedItem } from './types'

/** Vercel caps request bodies at 4.5 MB, so the import limit is 4 MB. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024
export const UPLOAD_TOO_LARGE_MESSAGE = 'Plik jest za duży (limit 4 MB).'
export const MAX_IMPORT_ROWS = 10_000
export const MAX_QUANTITY = 2_147_483_647
export const REQUIRED_FIELDS = ['name', 'quantity'] as const satisfies readonly ImportField[]
export const FIELDS = ['name', 'quantity', 'minimum', 'location', 'unit'] as const satisfies readonly ImportField[]

const ALIASES: Record<ImportField, readonly string[]> = {
  name: ['nazwa', 'nazwa asortymentu', 'nazwa produktu', 'towar', 'produkt', 'item name'],
  quantity: ['ilosc', 'stan', 'stan szt', 'stan ilosc', 'quantity', 'stock', 'qty'],
  minimum: ['minimum', 'min', 'stan minimalny', 'ilosc minimalna', 'prog minimalny', 'reorder point'],
  location: ['lokalizacja', 'miejsce', 'strefa', 'location', 'shelf'],
  unit: ['jednostka', 'unit', 'miara'],
}

const EXPORT_COLUMNS: readonly (readonly [string, keyof InventoryExportItem])[] = [
  ['Nazwa asortymentu', 'name'],
  ['Ilość', 'quantity'],
  ['Stan minimalny', 'minimum'],
  ['Lokalizacja', 'location'],
  ['Jednostka', 'unit'],
]

/** One stock row as written by the CSV/XLSX export. */
export type InventoryExportItem = {
  name: string
  quantity: number
  minimum: number
  unit: string
  location: string
}

/** The uploaded file isn't a supported, readable inventory sheet. */
export class ImportFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportFileError'
  }
}

const XLSX_CORRUPTED = 'Plik XLSX jest uszkodzony lub ma nieobsługiwany format.'
/** Defensive cap on one decompressed XLSX part (zip-bomb guard; Python had none). */
const MAX_XLSX_PART_BYTES = 64 * 1024 * 1024
/** Excel's last column is XFD (index 16383). */
const MAX_XLSX_COLUMN = 16_383

// ------------------------------------------------------- Python string helpers

/** Python str.isspace() for one code point. */
function isPySpace(cp: number): boolean {
  return (
    (cp >= 0x09 && cp <= 0x0d) ||
    (cp >= 0x1c && cp <= 0x20) ||
    cp === 0x85 ||
    cp === 0xa0 ||
    cp === 0x1680 ||
    (cp >= 0x2000 && cp <= 0x200a) ||
    cp === 0x2028 ||
    cp === 0x2029 ||
    cp === 0x202f ||
    cp === 0x205f ||
    cp === 0x3000
  )
}

/** Python str.strip() (Unicode whitespace as defined by str.isspace). */
function pyStrip(value: string): string {
  let start = 0
  let end = value.length
  while (start < end && isPySpace(value.charCodeAt(start))) start++
  while (end > start && isPySpace(value.charCodeAt(end - 1))) end--
  return start === 0 && end === value.length ? value : value.slice(start, end)
}

function isAscii(value: string): boolean {
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) > 0x7f) return false
  return true
}

/**
 * Python str.casefold(). Upper-then-lower reproduces full case folding (ß → ss,
 * ﬁ → fi, ς → σ, ſ → s …); the exceptions are dotless ı and Cherokee, which
 * folds to its uppercase letters. Verified against CPython for all code points.
 */
function casefold(value: string): string {
  if (isAscii(value)) return value.toLowerCase()
  let out = ''
  for (const ch of value) {
    const cp = ch.codePointAt(0)!
    if (cp < 0x80) out += ch.toLowerCase()
    else if (cp === 0x131 || (cp >= 0x13a0 && cp <= 0x13f5)) out += ch
    else if (cp >= 0x13f8 && cp <= 0x13fd) out += String.fromCodePoint(cp - 8)
    else if (cp >= 0xab70 && cp <= 0xabbf) out += String.fromCodePoint(cp - 0xab70 + 0x13a0)
    else out += ch.toUpperCase().toLowerCase().replaceAll('ß', 'ss')
  }
  return out
}

/**
 * unicodedata.combining(ch) != 0, i.e. canonical combining class > 0. JS has no
 * direct accessor, so probe canonical reordering against marks of class 1 and 240.
 */
function isCombining(ch: string): boolean {
  if (ch.charCodeAt(0) < 0x300) return false
  const low = ch + '\u0334'
  const high = '\u0345' + ch
  return low.normalize('NFD') !== low || high.normalize('NFD') !== high
}

function normalise(value: string): string {
  const decomposed = casefold(value).normalize('NFKD')
  let plain = ''
  for (const ch of decomposed) if (!isCombining(ch)) plain += ch
  return (plain.match(/[a-z0-9]+/g) ?? []).join(' ')
}

const UNICODE_DIGIT = /^\p{Nd}$/u

/** Value of a Unicode decimal digit (Nd chars come in contiguous 0–9 runs). */
function decimalValue(ch: string): number | null {
  if (!UNICODE_DIGIT.test(ch)) return null
  const cp = ch.codePointAt(0)!
  let start = cp
  while (start > 0 && UNICODE_DIGIT.test(String.fromCodePoint(start - 1))) start--
  return (cp - start) % 10
}

/**
 * Python int(text): surrounding whitespace, optional sign, Unicode decimal
 * digits, single underscores between digits. No decimal point ('12.0' fails).
 * Returns null where Python raises ValueError (and beyond the safe-integer range).
 */
function pyInt(text: string): number | null {
  let ascii = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (cp < 127) ascii += ch
    else if (isPySpace(cp)) ascii += ' '
    else {
      const digit = decimalValue(ch)
      if (digit === null) return null
      ascii += String(digit)
    }
  }
  const match = /^[ \t\n\r\v\f]*([+-]?)([0-9]+(?:_[0-9]+)*)[ \t\n\r\v\f]*$/.exec(ascii)
  if (!match) return null
  const value = Number(match[1] + match[2].replaceAll('_', ''))
  if (!Number.isSafeInteger(value)) return null
  return value === 0 ? 0 : value // no -0
}

/** First `count` code points (Python slicing is by code point, not UTF-16 unit). */
function codePointPrefix(text: string, count: number): string {
  if (text.length <= count) return text
  let index = 0
  for (let taken = 0; taken < count && index < text.length; taken++) {
    const unit = text.charCodeAt(index)
    const pair = unit >= 0xd800 && unit <= 0xdbff && (text.charCodeAt(index + 1) & 0xfc00) === 0xdc00
    index += pair ? 2 : 1
  }
  return text.slice(0, index)
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

// ------------------------------------------------------------------------ CSV

type Dialect = { delimiter: string; quotechar: string; doublequote: boolean; skipinitialspace: boolean }

const EXCEL_DIALECT: Dialect = { delimiter: ',', quotechar: '"', doublequote: true, skipinitialspace: false }
const SNIFF_DELIMITERS = ',;\t|'
const SNIFF_PREFERRED = [',', '\t', ';', ' ', ':']

// Python re with MULTILINE: ^ = (?<![^\n]), $ = (?![^\n]); \w = [\p{L}\p{N}_].
const PY_BOL = '(?<![^\\n])'
const PY_EOL = '(?![^\\n])'
const PY_NON_WORD = '[^\\p{L}\\p{N}_]'
const SNIFF_DELIM = `[^\\p{L}\\p{N}_\\n"']`
const QUOTE_PATTERNS = [
  `(?<delim>${SNIFF_DELIM})(?<space> ?)(?<quote>["'])[\\s\\S]*?\\k<quote>\\k<delim>`,
  `(?:${PY_BOL}|\\n)(?<quote>["'])[\\s\\S]*?\\k<quote>(?<delim>${SNIFF_DELIM})(?<space> ?)`,
  `(?<delim>${SNIFF_DELIM})(?<space> ?)(?<quote>["'])[\\s\\S]*?\\k<quote>(?:${PY_EOL}|\\n)`,
  `(?:${PY_BOL}|\\n)(?<quote>["'])[\\s\\S]*?\\k<quote>(?:${PY_EOL}|\\n)`,
].map((pattern) => new RegExp(pattern, 'gu'))

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')
}

/** First key with the highest count (Python max() over dict insertion order). */
function maxKey(counts: Map<string, number>): string {
  let best = ''
  let bestCount = -Infinity
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key
      bestCount = count
    }
  }
  return best
}

/** csv.Sniffer._guess_quote_and_delimiter */
function guessQuoteAndDelimiter(data: string, delimiters: string) {
  let matches: RegExpMatchArray[] = []
  let patternIndex = 0
  for (; patternIndex < QUOTE_PATTERNS.length; patternIndex++) {
    matches = [...data.matchAll(QUOTE_PATTERNS[patternIndex])]
    if (matches.length) break
  }
  if (!matches.length) return { quotechar: '', doublequote: false, delimiter: null, skipinitialspace: false }

  const quotes = new Map<string, number>()
  const delims = new Map<string, number>()
  let spaces = 0
  for (const match of matches) {
    const groups = match.groups!
    quotes.set(groups.quote, (quotes.get(groups.quote) ?? 0) + 1)
    if (patternIndex === 3) continue // no delimiter group
    const key = groups.delim
    if (key && delimiters.includes(key)) delims.set(key, (delims.get(key) ?? 0) + 1)
    if (groups.space) spaces += 1
  }
  const quotechar = maxKey(quotes)
  let delimiter = ''
  let skipinitialspace = false
  if (delims.size) {
    delimiter = maxKey(delims)
    skipinitialspace = delims.get(delimiter) === spaces
    if (delimiter === '\n') delimiter = ''
  }
  const d = escapeRegex(delimiter)
  const q = quotechar
  const doubleQuoted = new RegExp(
    `((${d})|${PY_BOL})${PY_NON_WORD}*${q}[^${d}\\n]*${q}[^${d}\\n]*${q}${PY_NON_WORD}*((${d})|${PY_EOL})`,
    'u',
  )
  return { quotechar, doublequote: doubleQuoted.test(data), delimiter, skipinitialspace }
}

/** csv.Sniffer._guess_delimiter */
function guessDelimiter(sample: string, delimiters: string): { delimiter: string; skipinitialspace: boolean } {
  const data = sample.split('\n').filter(Boolean)
  const skipSpace = (delimiter: string) => ({
    delimiter,
    skipinitialspace: countOf(data[0], delimiter) === countOf(data[0], delimiter + ' '),
  })
  const chunkLength = Math.min(10, data.length)
  let iteration = 0
  const charFrequency = new Map<string, Map<number, number>>()
  const modes = new Map<string, [number, number]>()
  const delims = new Map<string, [number, number]>()
  let start = 0
  let end = chunkLength
  while (start < data.length) {
    iteration += 1
    for (const line of data.slice(start, end)) {
      const counts = new Uint32Array(127)
      for (let i = 0; i < line.length; i++) {
        const code = line.charCodeAt(i)
        if (code < 127) counts[code]++
      }
      for (let code = 0; code < 127; code++) {
        const char = String.fromCharCode(code)
        let meta = charFrequency.get(char)
        if (!meta) charFrequency.set(char, (meta = new Map()))
        meta.set(counts[code], (meta.get(counts[code]) ?? 0) + 1)
      }
    }
    for (const [char, meta] of charFrequency) {
      const items = [...meta.entries()]
      if (items.length === 1 && items[0][0] === 0) continue
      if (items.length > 1) {
        let mode = items[0]
        for (const item of items) if (item[1] > mode[1]) mode = item
        const others = items.reduce((sum, item) => (item === mode ? sum : sum + item[1]), 0)
        modes.set(char, [mode[0], mode[1] - others])
      } else {
        modes.set(char, items[0])
      }
    }
    const total = Math.min(chunkLength * iteration, data.length)
    let consistency = 1.0
    const threshold = 0.9
    while (delims.size === 0 && consistency >= threshold) {
      for (const [key, value] of modes) {
        if (value[0] > 0 && value[1] > 0 && value[1] / total >= consistency && delimiters.includes(key)) {
          delims.set(key, value)
        }
      }
      consistency -= 0.01
    }
    if (delims.size === 1) return skipSpace([...delims.keys()][0])
    start = end
    end += chunkLength
  }
  if (delims.size === 0) return { delimiter: '', skipinitialspace: false }
  if (delims.size > 1) {
    for (const delimiter of SNIFF_PREFERRED) if (delims.has(delimiter)) return skipSpace(delimiter)
  }
  const ranked = [...delims.entries()].sort(([keyA, a], [keyB, b]) =>
    a[0] !== b[0] ? a[0] - b[0] : a[1] !== b[1] ? a[1] - b[1] : keyA < keyB ? -1 : keyA > keyB ? 1 : 0,
  )
  return skipSpace(ranked[ranked.length - 1][0])
}

/** csv.Sniffer().sniff(sample, delimiters) — null where Python raises csv.Error. */
function sniffDialect(sample: string): Dialect | null {
  const guessed = guessQuoteAndDelimiter(sample, SNIFF_DELIMITERS)
  let { delimiter, skipinitialspace } = guessed
  if (!delimiter) ({ delimiter, skipinitialspace } = guessDelimiter(sample, SNIFF_DELIMITERS))
  if (!delimiter) return null
  return { delimiter, quotechar: guessed.quotechar || '"', doublequote: guessed.doublequote, skipinitialspace }
}

const START_RECORD = 0
const START_FIELD = 1
const IN_FIELD = 2
const IN_QUOTED_FIELD = 3
const QUOTE_IN_QUOTED_FIELD = 4
const EAT_CRNL = 5

/**
 * CPython's _csv reader state machine (QUOTE_MINIMAL, no escapechar, strict=False)
 * fed line by line like io.StringIO. One deliberate difference: a bare CR followed
 * by data starts a new record instead of raising "new-line character seen in
 * unquoted field".
 */
function parseCsv(text: string, dialect: Dialect): string[][] {
  const { delimiter, quotechar, doublequote, skipinitialspace } = dialect
  const records: string[][] = []
  let fields: string[] = []
  let field = ''
  let state = START_RECORD

  const saveField = () => {
    fields.push(field)
    field = ''
  }
  const endOfLine = (c: string | null) => {
    saveField()
    state = c === null ? START_RECORD : EAT_CRNL
  }
  const step = (c: string | null): void => {
    for (;;) {
      switch (state) {
        case START_RECORD:
          if (c === null) return
          if (c === '\n' || c === '\r') {
            state = EAT_CRNL
            return
          }
          state = START_FIELD
          continue
        case START_FIELD:
          if (c === null || c === '\n' || c === '\r') endOfLine(c)
          else if (c === quotechar) state = IN_QUOTED_FIELD
          else if (c === ' ' && skipinitialspace) {
            // ignore spaces at the start of a field
          } else if (c === delimiter) saveField()
          else {
            field += c
            state = IN_FIELD
          }
          return
        case IN_FIELD:
          if (c === null || c === '\n' || c === '\r') endOfLine(c)
          else if (c === delimiter) {
            saveField()
            state = START_FIELD
          } else field += c
          return
        case IN_QUOTED_FIELD:
          if (c === null) return
          if (c === quotechar) state = doublequote ? QUOTE_IN_QUOTED_FIELD : IN_FIELD
          else field += c
          return
        case QUOTE_IN_QUOTED_FIELD:
          if (c === quotechar) {
            field += c
            state = IN_QUOTED_FIELD
          } else if (c === delimiter) {
            saveField()
            state = START_FIELD
          } else if (c === null || c === '\n' || c === '\r') endOfLine(c)
          else {
            field += c
            state = IN_FIELD
          }
          return
        case EAT_CRNL:
          if (c === '\n' || c === '\r') return
          if (c === null) {
            state = START_RECORD
            return
          }
          records.push(fields) // bare CR line break (CPython raises here)
          fields = []
          state = START_RECORD
          continue
      }
    }
  }

  let position = 0
  while (position < text.length) {
    const newline = text.indexOf('\n', position)
    const lineEnd = newline < 0 ? text.length : newline + 1
    for (let i = position; i < lineEnd; i++) step(text[i])
    step(null)
    if (state === START_RECORD) {
      records.push(fields)
      fields = []
    }
    position = lineEnd
  }
  if (field.length !== 0 || state === IN_QUOTED_FIELD) {
    saveField()
    records.push(fields)
  }
  return records
}

// Bytes that are undefined in Python's cp1250 codec (WHATWG maps them to C1 controls).
const CP1250_UNDEFINED = [0x81, 0x83, 0x88, 0x90, 0x98]

function decodeCsv(data: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data) // strips one BOM like utf-8-sig
  } catch {
    if (CP1250_UNDEFINED.some((byte) => data.includes(byte))) {
      throw new ImportFileError('Nie udało się odczytać kodowania pliku CSV.')
    }
    return new TextDecoder('windows-1250').decode(data)
  }
}

function csvRows(data: Uint8Array): string[][] {
  const text = decodeCsv(data)
  const dialect = sniffDialect(codePointPrefix(text, 8192)) ?? EXCEL_DIALECT
  return parseCsv(text, dialect).filter((row) => row.some((cell) => pyStrip(cell)))
}

// ------------------------------------------------------------------------ XML

type XmlNode = XmlElement | string
type XmlElement = { name: string; attrs: Map<string, string>; children: XmlNode[] }

class XmlSyntaxError extends Error {}

function xmlFail(): never {
  throw new XmlSyntaxError('Malformed XML')
}

function isXmlChar(cp: number): boolean {
  return (
    cp === 0x9 ||
    cp === 0xa ||
    cp === 0xd ||
    (cp >= 0x20 && cp <= 0xd7ff) ||
    (cp >= 0xe000 && cp <= 0xfffd) ||
    (cp >= 0x10000 && cp <= 0x10ffff)
  )
}

const PREDEFINED_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', apos: "'", quot: '"' }

function decodeXmlText(raw: string): string {
  let ampersand = raw.indexOf('&')
  if (ampersand < 0) return raw
  let out = ''
  let position = 0
  while (ampersand >= 0) {
    const semicolon = raw.indexOf(';', ampersand)
    if (semicolon < 0) xmlFail()
    out += raw.slice(position, ampersand)
    const ref = raw.slice(ampersand + 1, semicolon)
    if (Object.hasOwn(PREDEFINED_ENTITIES, ref)) out += PREDEFINED_ENTITIES[ref]
    else {
      let cp: number
      if (/^#x[0-9a-fA-F]+$/.test(ref)) cp = parseInt(ref.slice(2), 16)
      else if (/^#[0-9]+$/.test(ref)) cp = parseInt(ref.slice(1), 10)
      else return xmlFail() // undefined entity
      if (!isXmlChar(cp)) xmlFail()
      out += String.fromCodePoint(cp)
    }
    position = semicolon + 1
    ampersand = raw.indexOf('&', position)
  }
  return out + raw.slice(position)
}

function localName(qualified: string): string {
  const colon = qualified.indexOf(':')
  return colon < 0 ? qualified : qualified.slice(colon + 1)
}

const XML_NAME = /[^\s<>/=!?"'&]+/y
const XML_SPACE = /[ \t\n]*/y

/** Minimal non-validating XML parser: elements, attributes, text, CDATA. */
function parseXml(source: string): XmlElement {
  const s = source.replace(/\r\n?/g, '\n')
  let pos = s.charCodeAt(0) === 0xfeff ? 1 : 0
  let root: XmlElement | null = null
  const stack: XmlElement[] = []
  const qualifiedNames: string[] = []

  const readName = (): string => {
    XML_NAME.lastIndex = pos
    const match = XML_NAME.exec(s)
    if (!match) xmlFail()
    pos += match[0].length
    return match[0]
  }
  const skipSpace = (): number => {
    XML_SPACE.lastIndex = pos
    const length = XML_SPACE.exec(s)![0].length
    pos += length
    return length
  }
  const addText = (text: string) => {
    if (stack.length) stack[stack.length - 1].children.push(text)
    else if (/[^ \t\n]/.test(text)) xmlFail()
  }

  while (pos < s.length) {
    const lt = s.indexOf('<', pos)
    if (lt !== pos) {
      const end = lt < 0 ? s.length : lt
      addText(decodeXmlText(s.slice(pos, end)))
      pos = end
      continue
    }
    if (s.startsWith('<!--', pos)) {
      const end = s.indexOf('-->', pos + 4)
      if (end < 0) xmlFail()
      pos = end + 3
    } else if (s.startsWith('<![CDATA[', pos)) {
      const end = s.indexOf(']]>', pos + 9)
      if (end < 0 || !stack.length) xmlFail()
      stack[stack.length - 1].children.push(s.slice(pos + 9, end))
      pos = end + 3
    } else if (s.startsWith('<?', pos)) {
      const end = s.indexOf('?>', pos + 2)
      if (end < 0) xmlFail()
      pos = end + 2
    } else if (s.startsWith('<!DOCTYPE', pos)) {
      if (root || stack.length) xmlFail()
      const close = s.indexOf('>', pos)
      const subset = s.indexOf('[', pos)
      const end = subset >= 0 && (close < 0 || subset < close) ? s.indexOf(']', subset) : pos
      const gt = end < 0 ? -1 : s.indexOf('>', end)
      if (gt < 0) xmlFail()
      pos = gt + 1
    } else if (s.startsWith('</', pos)) {
      pos += 2
      const name = readName()
      skipSpace()
      if (s[pos] !== '>' || qualifiedNames.pop() !== name) xmlFail()
      stack.pop()
      pos += 1
    } else {
      if (root && !stack.length) xmlFail() // content after the document element
      pos += 1
      const qualified = readName()
      const element: XmlElement = { name: localName(qualified), attrs: new Map(), children: [] }
      let selfClosing = false
      for (;;) {
        const spaced = skipSpace()
        if (s.startsWith('/>', pos)) {
          selfClosing = true
          pos += 2
          break
        }
        if (s[pos] === '>') {
          pos += 1
          break
        }
        if (!spaced) xmlFail()
        const attribute = readName()
        skipSpace()
        if (s[pos] !== '=') xmlFail()
        pos += 1
        skipSpace()
        const quote = s[pos]
        if (quote !== '"' && quote !== "'") xmlFail()
        const close = s.indexOf(quote, pos + 1)
        if (close < 0) xmlFail()
        const raw = s.slice(pos + 1, close)
        if (raw.includes('<')) xmlFail()
        pos = close + 1
        if (attribute === 'xmlns' || attribute.startsWith('xmlns:')) continue
        element.attrs.set(localName(attribute), decodeXmlText(raw.replace(/[\t\n]/g, ' ')))
      }
      if (stack.length) stack[stack.length - 1].children.push(element)
      else root = element
      if (!selfClosing) {
        stack.push(element)
        qualifiedNames.push(qualified)
      }
    }
  }
  if (!root || stack.length) xmlFail()
  return root
}

function childElements(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((node): node is XmlElement => typeof node !== 'string' && node.name === name)
}

/** All descendants (not the element itself) with this local name, in document order. */
function descendants(element: XmlElement, name: string): XmlElement[] {
  const found: XmlElement[] = []
  const pending: XmlNode[] = [...element.children].reverse()
  while (pending.length) {
    const node = pending.pop()!
    if (typeof node === 'string') continue
    if (node.name === name) found.push(node)
    for (let i = node.children.length - 1; i >= 0; i--) pending.push(node.children[i])
  }
  return found
}

/** ElementTree's `element.text`: character data before the first child element. */
function leadingText(element: XmlElement): string {
  let text = ''
  for (const node of element.children) {
    if (typeof node !== 'string') break
    text += node
  }
  return text
}

// ----------------------------------------------------------------------- XLSX

function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/.exec(reference.toUpperCase())
  if (!letters) return 0
  let value = 0
  for (const char of letters[0]) value = value * 26 + char.charCodeAt(0) - 64
  return value - 1
}

function normPath(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..' && parts.length && parts[parts.length - 1] !== '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/') || '.'
}

function decodeXmlBytes(bytes: Uint8Array): string {
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8'
  return new TextDecoder(encoding, { fatal: true }).decode(bytes)
}

function openZip(data: Uint8Array) {
  const names = new Set<string>()
  unzipSync(data, {
    filter: (file) => {
      names.add(file.name)
      return false
    },
  })
  const readXml = (name: string): XmlElement => {
    const files = unzipSync(data, {
      filter: (file) => {
        if (file.name !== name) return false
        if (file.originalSize > MAX_XLSX_PART_BYTES) throw new Error('XLSX part too large')
        return true
      },
    })
    const bytes = files[name]
    if (!bytes) throw new Error(`Missing ${name}`)
    return parseXml(decodeXmlBytes(bytes))
  }
  return { names, readXml }
}

function firstSheetPath(zip: ReturnType<typeof openZip>): string {
  const fallback = 'xl/worksheets/sheet1.xml'
  if (!zip.names.has('xl/workbook.xml')) return fallback
  const book = zip.readXml('xl/workbook.xml')
  const firstSheet = childElements(book, 'sheets')
    .map((sheets) => childElements(sheets, 'sheet')[0])
    .find(Boolean)
  const relationId = firstSheet?.attrs.get('id')
  const relsPath = 'xl/_rels/workbook.xml.rels'
  if (!relationId || !zip.names.has(relsPath)) return fallback
  const relation = childElements(zip.readXml(relsPath), 'Relationship').find((item) => item.attrs.get('Id') === relationId)
  // CPython's `if relation:` tested Element truthiness (always False for a childless
  // element), so the legacy code never followed the relationship; we do.
  if (!relation) return fallback
  const target = relation.attrs.get('Target') ?? ''
  return target.startsWith('/') ? target.replace(/^\/+/, '') : normPath(`xl/${target}`)
}

function xlsxRows(data: Uint8Array): string[][] {
  try {
    const zip = openZip(data)
    let shared: string[] = []
    if (zip.names.has('xl/sharedStrings.xml')) {
      shared = childElements(zip.readXml('xl/sharedStrings.xml'), 'si').map((item) =>
        descendants(item, 't').map(leadingText).join(''),
      )
    }
    const sheetPath = firstSheetPath(zip)
    if (!zip.names.has(sheetPath)) {
      throw new ImportFileError('Arkusz kalkulacyjny nie zawiera czytelnej pierwszej karty.')
    }
    const sheet = zip.readXml(sheetPath)
    const rows: string[][] = []
    for (const sheetData of descendants(sheet, 'sheetData')) {
      for (const row of childElements(sheetData, 'row')) {
        const values = new Map<number, string>()
        let nextIndex = 0
        for (const cell of childElements(row, 'c')) {
          const reference = cell.attrs.get('r')
          // Cells without `r` continue from the previous one (Python put them all in column A).
          const index = reference === undefined ? nextIndex : columnIndex(reference)
          if (index > MAX_XLSX_COLUMN) throw new Error('Column out of range')
          nextIndex = index + 1
          const cellType = cell.attrs.get('t')
          let value: string
          if (cellType === 'inlineStr') {
            value = descendants(cell, 't').map(leadingText).join('')
          } else {
            const v = childElements(cell, 'v')[0]
            const raw = v ? leadingText(v) : ''
            if (cellType === 's' && raw) {
              const position = pyInt(raw)
              const resolved = position === null ? undefined : shared.at(position) // negative → from the end, like Python
              value = resolved ?? ''
            } else {
              value = raw
            }
          }
          values.set(index, value)
        }
        if (!values.size) continue
        const width = Math.max(...values.keys()) + 1
        const cells = Array.from({ length: width }, (_, index) => values.get(index) ?? '')
        // Formatted-but-empty rows are skipped like blank CSV rows (Python kept them).
        if (cells.some((cell) => pyStrip(cell))) rows.push(cells)
      }
    }
    return rows
  } catch (error) {
    if (error instanceof ImportFileError) throw error
    throw new ImportFileError(XLSX_CORRUPTED)
  }
}

// ------------------------------------------------------------------ public API

/** Reads an uploaded CSV/XLSX into trimmed headers and rows padded/cut to the header width. */
export function readInventoryFile(filename: string, data: Uint8Array): { headers: string[]; rows: string[][] } {
  if (data.length > MAX_UPLOAD_BYTES) throw new ImportFileError(UPLOAD_TOO_LARGE_MESSAGE)
  const dot = filename.lastIndexOf('.')
  const suffix = dot >= 0 ? casefold(filename.slice(dot + 1)) : ''
  let rows: string[][]
  if (suffix === 'csv') rows = csvRows(data)
  else if (suffix === 'xlsx') rows = xlsxRows(data)
  else throw new ImportFileError('Obsługiwane formaty plików to XLSX i CSV.')
  if (rows.length < 2) throw new ImportFileError('Plik musi zawierać nagłówki i przynajmniej jeden wiersz danych.')
  const headers = rows[0].map(pyStrip)
  if (!headers.some(Boolean)) throw new ImportFileError('Nie znaleziono nagłówków kolumn.')
  const dataRows = rows.slice(1).map((row) => {
    const sized = row.slice(0, headers.length)
    while (sized.length < headers.length) sized.push('')
    return sized
  })
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new ImportFileError(`Plik może zawierać maksymalnie ${MAX_IMPORT_ROWS} wierszy danych.`)
  }
  return { headers, rows: dataRows }
}

/** Suggests distinct columns from common Polish/English inventory headings. */
export function suggestMapping(headers: string[]): ColumnMapping {
  const normalized = headers.map(normalise)
  const aliases = Object.fromEntries(
    FIELDS.map((field) => [field, new Set(ALIASES[field].map(normalise))]),
  ) as Record<ImportField, Set<string>>
  const result = Object.fromEntries(FIELDS.map((field) => [field, { column: null, confidence: 0.0 }])) as ColumnMapping
  const used = new Set<number>()
  // Reserve exact matches first so "stan minimalny" cannot be consumed by the
  // shorter fuzzy alias "stan" for quantity.
  for (const field of FIELDS) {
    const index = normalized.findIndex((header, i) => header && !used.has(i) && aliases[field].has(header))
    if (index >= 0) {
      result[field] = { column: index, confidence: 0.96 }
      used.add(index)
    }
  }
  for (const field of FIELDS) {
    if (result[field].column !== null) continue
    const longAliases = [...aliases[field]].filter((alias) => alias.length >= 4)
    const index = normalized.findIndex(
      (header, i) =>
        header && !used.has(i) && longAliases.some((alias) => header.includes(alias) || alias.includes(header)),
    )
    if (index >= 0) {
      result[field] = { column: index, confidence: 0.78 }
      used.add(index)
    }
  }
  return result
}

/** Validates the user's column choice and converts every row; all-or-nothing. */
export function validateAndMapRows(
  headers: string[],
  rows: string[][],
  mapping: Record<ImportField, number | null>,
): ImportedItem[] {
  const columnOf = (field: ImportField): number | null => (mapping[field] as number | null | undefined) ?? null
  for (const field of FIELDS) {
    const index = columnOf(field)
    if (index !== null && (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= headers.length)) {
      throw new ImportFileError(`Nieprawidłowa kolumna dla pola „${field}”.`)
    }
  }
  for (const field of REQUIRED_FIELDS) {
    if (columnOf(field) === null) {
      throw new ImportFileError('Wybierz kolumnę nazwy oraz ilości przed zatwierdzeniem importu.')
    }
  }
  const selected = FIELDS.map(columnOf).filter((index) => index !== null)
  if (selected.length !== new Set(selected).size) {
    throw new ImportFileError('Każde pole musi być przypisane do innej kolumny.')
  }

  const items: ImportedItem[] = []
  const seen = new Set<string>()
  rows.forEach((row, offset) => {
    const rowNumber = offset + 2
    const valueFor = (field: ImportField): string => {
      const index = columnOf(field)
      return index !== null && index < row.length ? pyStrip(row[index]) : ''
    }
    const name = valueFor('name')
    const quantityText = valueFor('quantity')
    if (!name) throw new ImportFileError(`Wiersz ${rowNumber}: brak nazwy pozycji.`)
    const quantity = pyInt(quantityText.replaceAll(' ', '').replaceAll(',', '.'))
    if (quantity === null) {
      throw new ImportFileError(`Wiersz ${rowNumber}: ilość „${quantityText}” nie jest liczbą całkowitą.`)
    }
    const minimumText = valueFor('minimum')
    let minimum: number | null = null
    if (minimumText) {
      minimum = pyInt(minimumText.replaceAll(' ', '').replaceAll(',', '.'))
      if (minimum === null) {
        throw new ImportFileError(`Wiersz ${rowNumber}: minimum „${minimumText}” nie jest liczbą całkowitą.`)
      }
    }
    if (quantity < 0 || (minimum !== null && minimum < 0)) {
      throw new ImportFileError(`Wiersz ${rowNumber}: ilość i minimum nie mogą być ujemne.`)
    }
    // Postgres INTEGER columns hold at most 2 147 483 647.
    if (quantity > MAX_QUANTITY || (minimum !== null && minimum > MAX_QUANTITY)) {
      throw new ImportFileError(`Wiersz ${rowNumber}: ilość i minimum nie mogą przekraczać ${MAX_QUANTITY}.`)
    }
    const key = casefold(name)
    if (seen.has(key)) throw new ImportFileError(`Wiersz ${rowNumber}: plik zawiera powtórzoną pozycję „${name}”.`)
    seen.add(key)
    items.push({
      name,
      quantity,
      minimum,
      unit: valueFor('unit') || null,
      location: valueFor('location') || null,
    })
  })
  if (!items.length) throw new ImportFileError('Nie znaleziono pozycji do zaimportowania.')
  return items
}

// --------------------------------------------------------------------- export

function exportValues(item: InventoryExportItem): (string | number)[] {
  return EXPORT_COLUMNS.map(([, field]) => (item[field] as string | number | null | undefined) ?? '')
}

function csvField(value: string | number): string {
  const text = String(value)
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** Excel-friendly UTF-8 Polish CSV: BOM, `;` separator, CRLF line endings. */
export function exportInventoryCsv(items: InventoryExportItem[]): Uint8Array {
  const rows = [EXPORT_COLUMNS.map(([header]) => header), ...items.map(exportValues)]
  return strToU8('\ufeff' + rows.map((row) => row.map(csvField).join(';') + '\r\n').join(''))
}

// eslint-disable-next-line no-control-regex -- XML 1.0 cannot carry these characters
const INVALID_XML_CHARS =/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g

function xmlEscape(text: string): string {
  return text
    .replace(INVALID_XML_CHARS, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\r', '&#13;')
}

function columnName(index: number): string {
  let name = ''
  while (index) {
    const remainder = (index - 1) % 26
    index = Math.floor((index - 1) / 26)
    name = String.fromCharCode(65 + remainder) + name
  }
  return name
}

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NS_PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const COLUMN_WIDTHS = [36, 10, 16, 18, 12]

function sheetXml(items: InventoryExportItem[]): string {
  const rows = [EXPORT_COLUMNS.map(([header]) => header), ...items.map(exportValues)]
  const body = rows
    .map((values, rowIndex) => {
      const rowNumber = rowIndex + 1
      const style = rowIndex === 0 ? ' s="1"' : ''
      const cells = values
        .map((value, columnIndex) => {
          const ref = `${columnName(columnIndex + 1)}${rowNumber}`
          if (typeof value === 'number' && Number.isInteger(value)) return `<c r="${ref}"${style}><v>${value}</v></c>`
          const text = String(value)
          if (!text) return ''
          const preserve = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : ''
          return `<c r="${ref}"${style} t="inlineStr"><is><t${preserve}>${xmlEscape(text)}</t></is></c>`
        })
        .join('')
      return `<row r="${rowNumber}">${cells}</row>`
    })
    .join('')
  const cols = COLUMN_WIDTHS.map(
    (width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
  ).join('')
  return (
    `${XML_DECLARATION}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_DOC_REL}">` +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${body}</sheetData>` +
    '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>'
  )
}

const WORKBOOK_XML =
  `${XML_DECLARATION}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_DOC_REL}">` +
  '<sheets><sheet name="Stany" sheetId="1" r:id="rId1"/></sheets></workbook>'

const WORKBOOK_RELS =
  `${XML_DECLARATION}<Relationships xmlns="${NS_PACKAGE_REL}">` +
  `<Relationship Id="rId1" Type="${NS_DOC_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
  `<Relationship Id="rId2" Type="${NS_DOC_REL}/styles" Target="styles.xml"/>` +
  '</Relationships>'

const PACKAGE_RELS =
  `${XML_DECLARATION}<Relationships xmlns="${NS_PACKAGE_REL}">` +
  `<Relationship Id="rId1" Type="${NS_DOC_REL}/officeDocument" Target="xl/workbook.xml"/>` +
  '</Relationships>'

const STYLES_XML =
  `${XML_DECLARATION}<styleSheet xmlns="${NS_MAIN}">` +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>'

const CONTENT_TYPES =
  `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  '</Types>'

/** Minimal Excel-compatible XLSX workbook ("Stany" sheet) that readInventoryFile re-imports. */
export function exportInventoryXlsx(items: InventoryExportItem[]): Uint8Array {
  return zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(PACKAGE_RELS),
      'xl/workbook.xml': strToU8(WORKBOOK_XML),
      'xl/_rels/workbook.xml.rels': strToU8(WORKBOOK_RELS),
      'xl/styles.xml': strToU8(STYLES_XML),
      'xl/worksheets/sheet1.xml': strToU8(sheetXml(items)),
    },
    { level: 6 },
  )
}
