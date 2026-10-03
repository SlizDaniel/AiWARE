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
import { delta, parseCommand, SZT_NA_PALETE, type ParsedCommand } from './parser'
import { commandText, getAgentModeStatus, getAppSettings } from './settings'
import type { Db } from './sql'
import { TOOL_REGISTRY, ToolError, UnknownToolError, callTool } from './tools'
import type { ItemRef, LLMProvider } from './types'

export const HINTS = [
  'wzięliśmy paletę X',
  'doszła paleta X',
  'strefa: X',
  'ile mamy X?',
  'gdzie leży X?',
  'jak pakujemy X?',
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

type RunOptions = { provider: LLMProvider | null; actor?: Actor }

function inventoryContext(rows: Item[]): string {
  // JSON keeps commas/quotes in names from looking like another item or field.
  return JSON.stringify({
    units_per_pallet: SZT_NA_PALETE,
    items: rows.map(({ id, name, quantity, unit, minimum, location }) => ({ id, name, quantity, unit, minimum, location })),
  })
}

/** POST /api/command: text → proposal | answer | clarify | unknown (+ optional warning). */
export async function runCommand(db: Db, text: string, options: RunOptions): Promise<CommandResponse> {
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
  const items: ItemRef[] = rows.map((row) => ({ id: row.id, name: row.name }))
  let warning: string | null = null
  let parsed: ParsedCommand | null

  if (status.mode === 'llm' && options.provider !== null) {
    const context = inventoryContext(rows)
    try {
      const interpretation = await options.provider.interpret(command, toolSchemas(), context)
      if (interpretation.toolCall === null) {
        return { type: 'clarify', text, message: interpretation.clarification || 'Doprecyzuj polecenie.' }
      }
      parsed = normalizeCall(interpretation.toolCall, command, items)
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

  const response = await dispatchCommand(db, text, parsed, actor, defaultMinimum)
  if (warning) response.warning = warning
  return response
}

async function dispatchCommand(
  db: Db,
  text: string,
  parsed: ParsedCommand | null,
  actor: Actor,
  defaultMinimum: number,
): Promise<CommandResponse> {
  if (parsed === null) {
    // unknown command → ask to rephrase, never guess silently
    return { type: 'unknown', text, hints: [...HINTS] }
  }

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
    const data = await callTool(db, parsed.tool, parsed.args, { actor })
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
    const proposal = await createProposal(db, actor, {
      tool: 'remember_procedure',
      text,
      args: parsed.args,
      summary: `Zapamiętaj procedurę: ${String(parsed.args.topic)}`,
    })
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

async function createProposal(db: Db, actor: Actor, fields: Omit<Proposal, 'id'>): Promise<Proposal> {
  const proposal: Proposal = { id: globalThis.crypto.randomUUID().replace(/-/g, ''), ...fields }
  await saveProposal(db, proposal, actor.id)
  return proposal
}

/** Answer to a question (read tool) — reads only, writes nothing. */
function answer(text: string, parsed: ParsedCommand, data: Record<string, unknown>): CommandResponse {
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
          `Zapamiętaj ją mówiąc: „zapamiętaj: ${topic} pakujemy w…”`,
      }
    }
    const best = procedures[0]
    return {
      type: 'answer',
      tool: 'recall_procedure',
      text: `Procedura „${best.topic}”: ${best.text}`,
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
export async function confirmProposal(db: Db, id: string, actor: Actor = DEFAULT_ACTOR): Promise<ConfirmPayload> {
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
      result = await callTool(tx, tool, args, { actor, expectedStock })
    } catch (error) {
      // Like Python: the card is consumed (committed delete), the tool wrote nothing.
      if (error instanceof UnknownToolError) return { error: new HttpError(400, `Nieznane narzędzie: ${tool}`) }
      if (error instanceof ToolError) return { error: new HttpError(400, error.message) }
      if (error instanceof StaleStockProposalError) return { error }
      throw error
    }

    if (tool === 'update_stock') return { payload: { applied: true as const, ...result } }
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
