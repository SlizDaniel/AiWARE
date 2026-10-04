// Agent tool registry (PRD) — port of legacy/backend/app/tools.py.
//
// - kind 'read'  — questions; run immediately, never change the database.
// - kind 'write' — ONLY after a change card was confirmed (confirm-before-write).
//
// Every tool has a JSON Schema for its arguments: the offline parser (card 02)
// and LLM function calling (card 03) share the same call contract (PRD seam 2).
// `add_item` is outside the PRD's eight — it is the card-02 recovery path
// (unknown item in a command → proposal to add it).
import * as db from './db'
import type { Actor, StockSnapshot } from './db'
import type { Db } from './sql'
import type { JsonSchema, Role } from './types'
import { recallPacking, savePacking } from './packing'

export type ToolContext = { actor: Actor; expectedStock?: StockSnapshot; role?: Role }

export type ToolSpec = {
  name: string
  kind: 'read' | 'write'
  description: string
  parameters: JsonSchema
  handler: (db: Db, args: Record<string, unknown>, ctx: ToolContext) => Promise<Record<string, unknown>>
}

/** Python ValueError raised by a tool (e.g. the referenced item no longer exists). */
export class ToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolError'
  }
}

/** Python KeyError: no tool with this name in the registry. */
export class UnknownToolError extends Error {
  constructor(readonly tool: string) {
    super(`Unknown tool: ${tool}`)
    this.name = 'UnknownToolError'
  }
}

function schema(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: 'object', properties, required }
}

function int(args: Record<string, unknown>, key: string): number {
  return Number(args[key])
}

function str(args: Record<string, unknown>, key: string): string {
  return String(args[key] ?? '')
}

const DEFAULT_CONTEXT: ToolContext = { actor: db.DEFAULT_ACTOR }

const SPECS: ToolSpec[] = [
  {
    name: 'get_stock',
    kind: 'read',
    description: 'Ile czego mamy: stan jednej pozycji albo całego magazynu.',
    parameters: schema({
      item_id: { type: 'integer', description: 'ID pozycji; brak = cały magazyn' },
    }),
    handler: async (conn, args) => {
      if (args.item_id === undefined || args.item_id === null) return { items: await db.listItems(conn) }
      return { item: await db.getItem(conn, int(args, 'item_id')) }
    },
  },
  {
    name: 'update_stock',
    kind: 'write',
    description: 'Zmiana stanu pozycji o delta (np. wzięliśmy/doszła paleta).',
    parameters: schema(
      {
        item_id: { type: 'integer' },
        delta: { type: 'integer', description: 'Zmiana stanu, może być ujemna' },
        text: { type: 'string', description: 'Oryginalna komenda do audytu' },
      },
      ['item_id', 'delta'],
    ),
    handler: async (conn, args, ctx) => {
      const result = await db.confirmStockChange(conn, {
        itemId: int(args, 'item_id'),
        delta: int(args, 'delta'),
        text: str(args, 'text'),
        actor: ctx.actor,
        expectedStock: ctx.expectedStock,
      })
      if (result === null) throw new ToolError('Pozycja nie istnieje w bazie')
      return result
    },
  },
  {
    name: 'check_reorder',
    kind: 'read',
    description: 'Czy stan poniżej minimum i ile brakuje do progu.',
    parameters: schema({ item_id: { type: 'integer' } }, ['item_id']),
    handler: async (conn, args) => {
      const item = await db.getItem(conn, int(args, 'item_id'))
      if (item === null) return {}
      return {
        item_id: item.id,
        item_name: item.name,
        quantity: item.quantity,
        minimum: item.minimum,
        below_minimum: item.quantity < item.minimum,
        suggested_quantity: Math.max(0, item.minimum - item.quantity),
      }
    },
  },
  {
    name: 'draft_order',
    kind: 'write',
    description: 'Szkic zamówienia do Kolejki zatwierdzeń (dostawa we wtorek; nigdy nie wysyłany automatycznie).',
    parameters: schema(
      {
        item_id: { type: 'integer' },
        quantity: { type: 'integer' },
      },
      ['item_id', 'quantity'],
    ),
    handler: async (conn, args, ctx) => {
      const draft = await db.createReorderDraft(conn, {
        itemId: int(args, 'item_id'),
        quantity: int(args, 'quantity'),
        actor: ctx.actor,
      })
      if (draft === null) throw new ToolError('Pozycja nie istnieje w bazie')
      return draft
    },
  },
  {
    name: 'get_location',
    kind: 'read',
    description: 'Gdzie leży pozycja (lokalizacja/strefa).',
    parameters: schema({ item_id: { type: 'integer' } }, ['item_id']),
    handler: async (conn, args) => {
      const item = await db.getItem(conn, int(args, 'item_id'))
      if (item === null) return {}
      return {
        item_id: item.id,
        item_name: item.name,
        location: item.location,
        quantity: item.quantity,
        unit: item.unit,
      }
    },
  },
  {
    name: 'add_zone',
    kind: 'write',
    description: 'Nazwanie strefy podczas spaceru („strefa: X”).',
    parameters: schema({ name: { type: 'string' } }, ['name']),
    handler: async (conn, args) => db.addZone(conn, str(args, 'name')),
  },
  {
    name: 'remember_procedure',
    kind: 'write',
    description: 'Kierownik: reguła pakowania istniejącego produktu w opakowanie z katalogu, po potwierdzeniu. Nie zgaduj opakowania ani liczby sztuk.',
    parameters: schema({ item_id: { type: 'integer' }, packaging_id: { type: 'integer', minimum: 1 },
      quantity_per_package: { type: 'integer', minimum: 1, maximum: 1000000 }, notes: { type: 'string', maxLength: 500 } },
    ['item_id', 'packaging_id', 'quantity_per_package']),
    handler: async (conn, args, ctx) => savePacking(conn, args, ctx.actor, ctx.role),
  },
  {
    name: 'recall_procedure',
    kind: 'read',
    description: 'Odszukanie procedury po temacie lub fragmencie („jak pakujemy X?”).',
    parameters: schema({ topic: { type: 'string' } }, ['topic']),
    handler: async (conn, args) => ({ procedures: await recallPacking(conn, str(args, 'topic')) }),
  },
  {
    name: 'add_item',
    kind: 'write',
    description: 'Dodanie nowej pozycji do bazy (gdy agent nie zna towaru z komendy).',
    parameters: schema(
      {
        name: { type: 'string' },
        quantity: { type: 'integer' },
        unit: { type: 'string' },
        minimum: { type: 'integer', minimum: 0 },
      },
      ['name'],
    ),
    handler: async (conn, args) =>
      db.addItem(conn, {
        name: str(args, 'name'),
        quantity: args.quantity === undefined ? 0 : int(args, 'quantity'),
        unit: args.unit === undefined ? 'szt' : str(args, 'unit'),
        minimum: args.minimum === undefined ? 0 : int(args, 'minimum'),
      }),
  },
]

export const TOOL_REGISTRY: Record<string, ToolSpec> = Object.fromEntries(SPECS.map((spec) => [spec.name, spec]))

export function isRegisteredTool(name: string): boolean {
  return Object.hasOwn(TOOL_REGISTRY, name)
}

/** Calls a tool by name — the entry point for the offline parser and the LLM path. */
export async function callTool(
  conn: Db,
  name: string,
  args: Record<string, unknown> = {},
  ctx: ToolContext = DEFAULT_CONTEXT,
): Promise<Record<string, unknown>> {
  if (!isRegisteredTool(name)) throw new UnknownToolError(name)
  return TOOL_REGISTRY[name].handler(conn, args, ctx)
}
