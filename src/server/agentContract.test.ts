// LLM ↔ tool registry bridge — contract parts of legacy tests/test_llm_registry.py.
import { describe, expect, it } from 'vitest'
import { normalizeCall, toolSchemas } from './agentContract'
import { TOOL_REGISTRY } from './tools'
import { LLMProviderError, type ItemRef } from './types'

const ITEMS: ItemRef[] = [
  { id: 1, name: 'Kartony' },
  { id: 2, name: 'Szkło' },
]

describe('toolSchemas', () => {
  it('are copies of the registry, not mutations', () => {
    const schemas = toolSchemas()
    expect(schemas).toHaveLength(Object.keys(TOOL_REGISTRY).length)
    const stock = schemas.find((tool) => tool.function.name === 'update_stock')!.function
    expect(stock.parameters.properties).not.toHaveProperty('text')
    expect(TOOL_REGISTRY.update_stock.parameters.properties).toHaveProperty('text')
    expect(TOOL_REGISTRY.update_stock.parameters).not.toHaveProperty('additionalProperties')
    expect(TOOL_REGISTRY.add_zone.parameters.properties!.name).not.toHaveProperty('minLength')
  })

  it('tighten the LLM-facing constraints like Python', () => {
    const byName = Object.fromEntries(toolSchemas().map((tool) => [tool.function.name, tool]))
    expect(byName.update_stock).toEqual({
      type: 'function',
      function: {
        name: 'update_stock',
        description: 'Zmiana stanu pozycji o delta (np. wzięliśmy/doszła paleta).',
        parameters: {
          type: 'object',
          properties: {
            item_id: { type: 'integer', minimum: 1 },
            delta: { type: 'integer', description: 'Zmiana stanu, może być ujemna' },
          },
          required: ['item_id', 'delta'],
          additionalProperties: false,
        },
      },
    })
    expect(byName.draft_order.function.parameters.properties!.quantity).toEqual({ type: 'integer', minimum: 1 })
    expect(byName.add_item.function.parameters.properties).toEqual({
      name: { type: 'string', minLength: 1 },
      quantity: { type: 'integer', minimum: 0 },
      unit: { type: 'string', minLength: 1 },
      minimum: { type: 'integer', minimum: 0 },
    })
    expect(byName.remember_procedure.function.parameters.additionalProperties).toBe(false)
  })
})

describe('normalizeCall', () => {
  it('maps a valid call to a ParsedCommand with the item', () => {
    expect(normalizeCall({ name: 'update_stock', arguments: { item_id: 2, delta: -4 } }, 'wzięliśmy dwie palety szkła', ITEMS)).toEqual({
      tool: 'update_stock',
      text: 'wzięliśmy dwie palety szkła',
      args: { item_id: 2, delta: -4 },
      itemId: 2,
      itemName: 'Szkło',
      missingItem: null,
    })
  })

  it('strips string arguments', () => {
    const parsed = normalizeCall({ name: 'add_zone', arguments: { name: '  Rampa  ' } }, 'x', ITEMS)
    expect(parsed.args).toEqual({ name: 'Rampa' })
    expect(parsed.itemId).toBeNull()
  })

  it('does not mutate the provider arguments', () => {
    const args = { name: '  Rampa ' }
    normalizeCall({ name: 'add_zone', arguments: args }, 'x', ITEMS)
    expect(args.name).toBe('  Rampa ')
  })

  it.each([
    ['unregistered tool', { name: 'drop_table', arguments: {} }],
    ['prototype key as tool', { name: 'constructor', arguments: {} }],
    ['blank string', { name: 'add_zone', arguments: { name: '   ' } }],
    ['empty string', { name: 'add_zone', arguments: { name: '' } }],
    ['missing item', { name: 'get_location', arguments: { item_id: 99 } }],
    ['boolean item id', { name: 'get_stock', arguments: { item_id: true } }],
    ['string item id', { name: 'get_stock', arguments: { item_id: '1' } }],
    ['fractional delta', { name: 'update_stock', arguments: { item_id: 1, delta: 1.5 } }],
    ['zero delta', { name: 'update_stock', arguments: { item_id: 1, delta: 0 } }],
    ['forged audit text', { name: 'update_stock', arguments: { item_id: 1, delta: 2, text: 'x' } }],
    ['missing required', { name: 'draft_order', arguments: { item_id: 1 } }],
    ['negative order', { name: 'draft_order', arguments: { item_id: 1, quantity: -5 } }],
    ['zero order', { name: 'draft_order', arguments: { item_id: 1, quantity: 0 } }],
    ['extra field', { name: 'add_zone', arguments: { name: 'A', unexpected: 1 } }],
    ['non-object arguments', { name: 'add_zone', arguments: ['A'] as unknown as Record<string, unknown> }],
    ['item id zero', { name: 'get_stock', arguments: { item_id: 0 } }],
  ])('rejects %s', (_label, call) => {
    expect(() => normalizeCall(call, 'x', ITEMS)).toThrow(LLMProviderError)
  })

  it('accepts get_stock without an item (whole inventory)', () => {
    expect(normalizeCall({ name: 'get_stock', arguments: {} }, 'ile mamy?', ITEMS).args).toEqual({})
  })
})
