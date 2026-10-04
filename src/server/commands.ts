// Command pipeline — port of POST /api/command, dispatch_command, _answer,
// _proposal and POST /api/proposals/{id}/confirm from legacy main.py.
//
// Confirm-before-write: write tools run ONLY in confirmProposal; unconfirmed
// proposals live in the `proposals` table and never touch domain data.
// Questions (read tools) write nothing. data_version is bumped by the routes.
import { normalizeCall, toolSchemas } from './agentContract'
import { DEFAULT_ACTOR, StaleStockProposalError, getItem, listItems, logEvent, saveProposal, takeProposal, type Actor, type Item, type StockSnapshot } from './db'
import { HttpError } from './http'
import { GeminiRequestError } from './llm'
import { delta, parseCommand, stockCommandConcern, SZT_NA_PALETE, type ParsedCommand } from './parser'
import { levenshtein } from '@/lib/speech'
import { sameInventoryWord } from '@/lib/inventoryNames'
import { commandText, getAgentModeStatus, getAppSettings } from './settings'
import type { Db } from './sql'
import { TOOL_REGISTRY, ToolError, UnknownToolError, callTool } from './tools'
import type { ItemRef, LLMProvider, Role } from './types'
import { listPackaging, parsePacking, previewPacking } from './packing'
import { parseCommandConversation, type ClarificationTurn } from '@/lib/commandConversation'

export const HINTS = [
  'wzięliśmy paletę X',
  'doszła paleta X',
  'strefa: X',
  'ile mamy X?',
  'gdzie leży X?',
  'jak pakujemy X?',
  'jakie zadanie ma Michał?',
]

export const NO_KEY_COMMAND_WARNING = 'Brak GEMINI_API_KEY — użyto parsera offline.'
export const LLM_FALLBACK_WARNING = 'LLM nie zwrócił poprawnej propozycji — użyto parsera offline.'

/** Only fixed labels reach the UI; provider messages may contain private data. */
function fallbackWarning(error: unknown): string {
  if (!(error instanceof GeminiRequestError)) return LLM_FALLBACK_WARNING
  let reason: string
  if (error.kind === 'timeout') reason = 'Gemini nie odpowiedział w wyznaczonym czasie'
  else if (error.kind === 'network') reason = 'Nie udało się połączyć z Gemini'
  else if (error.status === 429) reason = 'Gemini: przekroczono limit zapytań lub dostępny limit API'
  else if (error.status === 401 || error.status === 403 || error.reason === 'API_KEY_INVALID') reason = 'Gemini: sprawdź klucz API i uprawnienia do modelu'
  else if (error.status === 404) reason = 'Gemini: skonfigurowany model jest niedostępny'
  else if (error.status !== null && error.status >= 500) reason = 'Gemini jest chwilowo niedostępny'
  else return LLM_FALLBACK_WARNING
  return `${reason} — użyto parsera offline.`
}

const READ_TOOLS = new Set(Object.values(TOOL_REGISTRY).filter((spec) => spec.kind === 'read').map((spec) => spec.name))

export type Proposal = {
  id: string
  tool: string
  text: string
  args: Record<string, unknown>
  summary: string
  item_id?: number
  item_name?: string | null
  unit?: string
  delta?: number
  before?: number
  after?: number
}

export type CommandResponse = (
  | { type: 'proposal'; proposal: Proposal }
  | { type: 'answer'; tool: string; text: string; data: Record<string, unknown> }
  | { type: 'clarify'; text: string; message: string }
  | { type: 'unknown'; text: string; hints: string[] }
) & { warning?: string }

export type ConfirmPayload = { applied: true } & Record<string, unknown>

type RunOptions = { provider: LLMProvider | null; actor?: Actor; conversation?: ClarificationTurn[]; role?: Role }

// The prompt carries only the items the command can be about; small warehouses go in whole.
export const MAX_CONTEXT_ITEMS = 40
const MIN_PREFIX = 4

function foldText(text: string): string {
  return text
    .toLocaleLowerCase('pl')
    .replaceAll('ł', 'l')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
}

function words(text: string): string[] {
  return foldText(text).split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3)
}

function commonPrefix(a: string, b: string): number {
  let length = 0
  while (length < a.length && length < b.length && a[length] === b[length]) length += 1
  return length
}

/**
 * Items worth showing the model for this command: every item whose name shares
 * a word stem with it (Polish inflection changes the ending, not the start),
 * best matches first; the rest of the list fills up to MAX_CONTEXT_ITEMS.
 */
export function contextItems(rows: Item[], command: string): Item[] {
  if (rows.length <= MAX_CONTEXT_ITEMS) return rows
  const commandWords = words(command)
  const scored = rows.map((row, index) => {
    let score = 0
    for (const word of words(row.name)) {
      let best = 0
      for (const token of commandWords) {
        const shared = commonPrefix(word, token)
        if (shared >= Math.min(MIN_PREFIX, word.length, token.length)) best = Math.max(best, shared)
        if (sameInventoryWord(word, token)) best = Math.max(best, 10)
        // A misheard first consonant should not hide the item beyond the 40-row context.
        if (word.length >= 4 && token.length >= 4 && word.length <= 100 && token.length <= 100 &&
          Math.abs(word.length - token.length) <= 2 && levenshtein(word, token) <= (Math.min(word.length, token.length) >= 5 ? 2 : 1)) {
          best = Math.max(best, 2)
        }
      }
      score += best
    }
    return { row, index, score }
  })
  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  return scored.slice(0, MAX_CONTEXT_ITEMS).map((entry) => entry.row)
}

function inventoryContext(rows: Item[], conversation: ClarificationTurn[]): string {
  // JSON keeps commas/quotes in names from looking like another item or field.
  return JSON.stringify({
    units_per_pallet: SZT_NA_PALETE,
    ...(conversation.length ? { pending_clarification: conversation } : {}),
    items: rows.map(({ id, name, quantity, unit, minimum, location }) => ({ id, name, quantity, unit, minimum, location })),
  })
}

/** POST /api/command: text → proposal | answer | clarify | unknown (+ optional warning). */
export async function runCommand(db: Db, text: string, options: RunOptions): Promise<CommandResponse> {
  const conversation = parseCommandConversation(options.conversation)
  const actor = options.actor ?? DEFAULT_ACTOR
  const status = await getAgentModeStatus(db)
  // The wake word („Magu, …") is not part of the command itself; a retired one blocks it (card 12).
  const { text: interpreted, prefix } = await commandText(db, text)
  if (interpreted === null) {
    return { type: 'clarify', text, message: `Aktualny prefix to „${prefix}”. Użyj go albo wpisz komendę bez prefixu.` }
  }
  const command = interpreted || text.trim()
  const { default_minimum: defaultMinimum } = await getAppSettings(db)
  const rows = await listItems(db)
  const items: ItemRef[] = rows.map((row) => ({ id: row.id, name: row.name, unit: row.unit }))
  let warning: string | null = null
  let parsed: ParsedCommand | null

  if (status.mode === 'llm' && options.provider !== null) {
    const relatedText = [...conversation.map((turn) => turn.userText), command].join(' ')
    const suppliedItems = contextItems(rows, relatedText)
    const context = JSON.stringify({ ...JSON.parse(inventoryContext(suppliedItems, conversation)),
      role: options.role ?? 'pracownik', packaging_catalogue: await listPackaging(db) })
    try {
      const interpretation = await options.provider.interpret(command, toolSchemas(), context)
      if (interpretation.toolCall === null) {
        return { type: 'clarify', text, message: interpretation.clarification || 'Doprecyzuj polecenie.' }
      }
      parsed = normalizeCall(interpretation.toolCall, command, suppliedItems)
    } catch (error) {
      // LLMProviderError (or any provider failure): never block the warehouse — use the offline parser.
      parsed = parseCommand(command, items)
      warning = fallbackWarning(error)
    }
  } else {
    parsed = parseCommand(command, items)
    if (status.mode === 'llm') warning = NO_KEY_COMMAND_WARNING
    else if (status.mode === 'mock') warning = status.warning
  }

  const deterministic = parseCommand(command, items)
  if (parsed && deterministic && parsed.tool !== deterministic.tool) {
    return { type: 'clarify', text, message: 'Rozpoznana intencja nie zgadza się z operacją zaproponowaną przez model. Powtórz pełne polecenie.' }
  }
  // The model's valid JSON is not proof that its quantity/direction matches the words.
  if (parsed?.tool === 'update_stock') {
    const concern = stockCommandConcern(command)
    const message = concern ?? deterministic?.clarification
    if (message) return { type: 'clarify', text, message, ...(warning ? { warning } : {}) }
    if (deterministic?.missingItem && !parsed.missingItem) {
      return { type: 'clarify', text, message: 'Nazwa towaru nie pasuje do istniejącej pozycji. Podaj dokładną nazwę z magazynu.' }
    }
    if (deterministic?.tool === 'update_stock' && deterministic.itemId != null &&
      (deterministic.itemId !== parsed.itemId || delta(deterministic) !== delta(parsed))) {
      return { type: 'clarify', text, message: 'Rozpoznana operacja nie zgadza się z podanym towarem lub ilością. Powtórz pełne polecenie.' }
    }
  }

  const sourceText = [...conversation.map((turn) => turn.userText), text].join(' → ')
  // Free-text procedure arguments from the old offline parser never reach a write tool.
  if (parsed?.tool === 'remember_procedure' && !('item_id' in parsed.args)) {
    try { parsed.args = await parsePacking(db, command) }
    catch (error) {
      if (!(error instanceof HttpError)) throw error
      return { type: 'clarify', text, message: error.message, ...(warning ? { warning } : {}) }
    }
  }
  let response: CommandResponse
  try { response = await dispatchCommand(db, sourceText, parsed, actor, defaultMinimum, options.role) }
  catch (error) {
    if (!(error instanceof HttpError) || (error.status !== 422 && error.status !== 403)) throw error
    response = { type: 'clarify', text, message: error.message }
  }
  if (warning) response.warning = warning
  return response
}

async function dispatchCommand(
  db: Db,
  text: string,
  parsed: ParsedCommand | null,
  actor: Actor,
  defaultMinimum: number,
  role?: Role,
): Promise<CommandResponse> {
  if (parsed === null) {
    // unknown command → ask to rephrase, never guess silently
    return { type: 'unknown', text, hints: [...HINTS] }
  }

  if (parsed.clarification) return { type: 'clarify', text, message: parsed.clarification }

  if (parsed.missingItem && parsed.tool === 'update_stock') {
    // item not in the database → proposal to ADD it (change card)
    const name = parsed.missingItem.charAt(0).toUpperCase() + parsed.missingItem.slice(1)
    const proposal = await createProposal(db, actor, {
      tool: 'add_item',
      text,
      args: { name, quantity: 0, unit: 'szt', minimum: defaultMinimum },
      summary: `Nowa pozycja: ${name} (0 szt, minimum ${defaultMinimum})`,
      item_name: name,
    })
    return { type: 'proposal', proposal }
  }

  if (parsed.missingItem) {
    return {
      type: 'clarify',
      text,
      message:
        `Nie znam pozycji «${parsed.missingItem}» — nie ma jej w bazie. ` +
        'Dodaj ją w sekcji Stany albo zaimportuj Excel.',
    }
  }

  if (READ_TOOLS.has(parsed.tool)) {
    const data = await callTool(db, parsed.tool, parsed.args, { actor, role })
    return answer(text, parsed, data)
  }

  if (parsed.tool === 'add_item' || parsed.tool === 'draft_order') {
    // New items get the owner's default minimum unless the command names one (card 12).
    const args = parsed.tool === 'add_item' ? { minimum: defaultMinimum, ...parsed.args } : parsed.args
    const summary =
      parsed.tool === 'add_item'
        ? `Nowa pozycja: ${String(args.name)} (${String(args.quantity ?? 0)} ${String(args.unit ?? 'szt')}, minimum ${String(args.minimum)})`
        : `Szkic zamówienia: ${String(parsed.itemName)} — ${String(parsed.args.quantity)}`
    const proposal = await createProposal(db, actor, { tool: parsed.tool, text, args, summary })
    return { type: 'proposal', proposal }
  }

  if (parsed.tool === 'add_zone') {
    const proposal = await createProposal(db, actor, {
      tool: 'add_zone',
      text,
      args: parsed.args,
      summary: `Nowa strefa: ${String(parsed.args.name)}`,
    })
    return { type: 'proposal', proposal }
  }

  if (parsed.tool === 'remember_procedure') {
    const proposal = await proposePackingRule(db, parsed.args, actor, role, text)
    return { type: 'proposal', proposal }
  }

  if (parsed.tool === 'update_stock') {
    const item = parsed.itemId == null ? null : await getItem(db, parsed.itemId)
    if (item === null) return { type: 'unknown', text, hints: [...HINTS] }
    const change = delta(parsed)
    const before = item.quantity
    const after = before + change
    const proposal = await createProposal(db, actor, {
      tool: 'update_stock',
      text,
      args: parsed.args,
      summary: `${item.name} ${before}→${after}`,
      item_id: item.id,
      item_name: item.name,
      unit: item.unit,
      delta: change,
      before,
      after,
    })
    return { type: 'proposal', proposal }
  }

  return { type: 'unknown', text, hints: [...HINTS] }
}

export async function proposePackingRule(db: Db, args: Record<string, unknown>, actor: Actor, role?: Role, text = 'Formularz reguły pakowania'): Promise<Proposal> {
  const preview = await previewPacking(db, args, role)
  return createProposal(db, actor, { tool: 'remember_procedure', text, ...preview })
}

async function createProposal(db: Db, actor: Actor, fields: Omit<Proposal, 'id'>): Promise<Proposal> {
  const proposal: Proposal = { id: globalThis.crypto.randomUUID().replace(/-/g, ''), ...fields }
  await saveProposal(db, proposal, actor.id)
  return proposal
}

/** Answer to a question (read tool) — reads only, writes nothing. */
function answer(text: string, parsed: ParsedCommand, data: Record<string, unknown>): CommandResponse {
  if (parsed.tool === 'get_work_tasks') {
    if (data.clarification) return { type: 'clarify', text, message: String(data.clarification) }
    return { type: 'answer', tool: parsed.tool, text: String(data.message), data }
  }
  if (parsed.tool === 'check_reorder') {
    if (Object.keys(data).length === 0) return { type: 'clarify', text, message: 'Nie znaleziono pozycji.' }
    const status = data.below_minimum ? 'poniżej minimum' : 'minimum zachowane'
    return {
      type: 'answer',
      tool: parsed.tool,
      data,
      text: `${String(data.item_name)}: ${String(data.quantity)} (minimum ${String(data.minimum)}) — ${status}.`,
    }
  }

  if (parsed.tool === 'get_stock') {
    const item = (data.item ?? null) as Item | null
    let body: string
    if (item !== null) {
      const location = item.location || 'brak lokalizacji'
      body = `${item.name}: ${item.quantity} ${item.unit} (minimum ${item.minimum}) — ${location}.`
    } else {
      const items = (data.items ?? []) as Item[]
      body = 'Na stanie: ' + items.map((i) => `${i.name} ${i.quantity} ${i.unit}`).join(', ') + '.'
    }
    return { type: 'answer', tool: 'get_stock', text: body, data }
  }

  if (parsed.tool === 'get_location') {
    if (Object.keys(data).length === 0) return { type: 'unknown', text, hints: [...HINTS] }
    const location = (data.location as string) || 'brak lokalizacji'
    return {
      type: 'answer',
      tool: 'get_location',
      text: `${String(data.item_name)} leży w: ${location}.`,
      data,
    }
  }

  if (parsed.tool === 'recall_procedure') {
    const procedures = (data.procedures ?? []) as { topic: string; text: string }[]
    if (procedures.length === 0) {
      // no procedure → suggest remembering it, never make one up (card 10)
      const topic = String(parsed.args.topic)
      return {
        type: 'clarify',
        text,
        message:
          `Nie mam zapisanej procedury dla «${topic}». ` +
          'Kierownik może utworzyć regułę w zakładce Procedury, wybierając produkt, opakowanie i ilość.',
      }
    }
    const best = procedures[0] as { topic: string; text: string; packaging_stock?: { name: string; quantity: number; unit: string } | null }
    // stara notatka (bez reguły pakowania) nie ma opakowania — bez zdania o jego stanie
    const stock = !('packaging_stock' in best) ? ''
      : best.packaging_stock
        ? ` Opakowania na stanie: ${best.packaging_stock.name} — ${best.packaging_stock.quantity} ${best.packaging_stock.unit}.`
        : ' Opakowanie nie ma powiązanego stanu magazynowego.'
    return {
      type: 'answer',
      tool: 'recall_procedure',
      text: `Procedura „${best.topic}”: ${best.text}${stock}`,
      data,
    }
  }

  return { type: 'unknown', text, hints: [...HINTS] }
}

const EVENT_TYPES: Record<string, string> = {
  add_zone: 'zone_added',
  add_item: 'item_added',
  remember_procedure: 'procedure_saved',
  draft_order: 'reorder_draft_created',
}

/**
 * POST /api/proposals/{id}/confirm: runs the write tool from the card.
 * Taking the proposal, the tool and its audit entry share one transaction —
 * a second confirm of the same id gets 404 and cannot double-apply.
 */
export async function confirmProposal(db: Db, id: string, actor: Actor = DEFAULT_ACTOR, role?: Role): Promise<ConfirmPayload> {
  const outcome = await db.transaction(async (tx): Promise<{ payload: ConfirmPayload } | { error: HttpError }> => {
    const proposal = await takeProposal<Proposal>(tx, id)
    if (proposal === null) {
      return { error: new HttpError(404, 'Nie ma takiej propozycji (lub została już rozpatrzona)') }
    }
    const tool = proposal.tool
    let expectedStock: StockSnapshot | undefined
    if (tool === 'update_stock') {
      // Snapshot pochodzi z zapisanej karty, nigdy z argumentów modelu ani POST.
      if (typeof proposal.before !== 'number' || !Number.isFinite(proposal.before) ||
          typeof proposal.unit !== 'string' || !proposal.unit ||
          typeof proposal.item_name !== 'string' || !proposal.item_name) {
        return { error: new StaleStockProposalError() }
      }
      expectedStock = { quantity: proposal.before, unit: proposal.unit, name: proposal.item_name }
    }
    // writes ONLY through the tool registry (confirm-before-write) — confirm
    // knows no database logic, it just runs the tool from the card
    const args = tool === 'update_stock' ? { ...proposal.args, text: proposal.text } : (proposal.args ?? {})
    const eventType = Object.hasOwn(EVENT_TYPES, tool) ? EVENT_TYPES[tool] : null
    let result: Record<string, unknown>
    try {
      if (tool !== 'update_stock' && eventType === null) throw new UnknownToolError(tool)
      result = await callTool(tx, tool, args, { actor, expectedStock, role })
    } catch (error) {
      // Like Python: the card is consumed (committed delete), the tool wrote nothing.
      if (error instanceof UnknownToolError) return { error: new HttpError(400, `Nieznane narzędzie: ${tool}`) }
      if (error instanceof ToolError) return { error: new HttpError(400, error.message) }
      if (error instanceof StaleStockProposalError) return { error }
      throw error
    }

    if (tool === 'update_stock' || tool === 'remember_procedure') return { payload: { applied: true as const, tool, ...result } }
    if (tool === 'draft_order') {
      // createReorderDraft already records the creation in the same transaction.
      return { payload: { applied: true as const, tool, reorder_draft: result, ...result } }
    }
    const label = String(result.name || result.item_name || result.topic || '')
    const audit = await logEvent(tx, { eventType: eventType!, text: proposal.text, label, actor })
    return { payload: { applied: true as const, tool, ...result, ...audit } }
  })
  if ('error' in outcome) throw outcome.error
  return outcome.payload
}
