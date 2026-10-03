// Bridge between LLM function calls and the shared tool registry — port of
// legacy/backend/app/agent_contract.py.
//
// normalizeCall also validates the arguments against the advertised schema
// (in Python the provider did that). Doing it here keeps the contract safe for
// every LLMProvider implementation, including test fakes.
import type { ParsedCommand } from './parser'
import { TOOL_REGISTRY, isRegisteredTool } from './tools'
import { LLMProviderError, type ItemRef, type JsonSchema, type ToolCall, type ToolSchema } from './types'

export function toolSchemas(): ToolSchema[] {
  const schemas: ToolSchema[] = []
  for (const spec of Object.values(TOOL_REGISTRY)) {
    const parameters: JsonSchema = structuredClone(spec.parameters)
    parameters.additionalProperties = false
    const properties = (parameters.properties ??= {})
    if (spec.name === 'update_stock') {
      // The server records the user's original command, not model-supplied text.
      delete properties.text
    }
    for (const prop of Object.values(properties)) {
      if (prop.type === 'string') prop.minLength = 1
    }
    if ('item_id' in properties) properties.item_id.minimum = 1
    if ('quantity' in properties) properties.quantity.minimum = spec.name === 'draft_order' ? 1 : 0
    schemas.push({
      type: 'function',
      function: { name: spec.name, description: spec.description, parameters },
    })
  }
  return schemas
}

export function normalizeCall(call: ToolCall, text: string, items: ItemRef[]): ParsedCommand {
  if (!isRegisteredTool(call.name)) throw new LLMProviderError('Tool is not registered')
  if (call.arguments === null || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) {
    throw new LLMProviderError('Tool arguments must be a JSON object')
  }
  const schema = toolSchemas().find((tool) => tool.function.name === call.name)!
  validateValue(call.arguments, schema.function.parameters, 'arguments')

  const args: Record<string, unknown> = { ...call.arguments }
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      args[key] = value.trim()
      if (!args[key]) throw new LLMProviderError('Tool argument cannot be blank')
    }
  }
  let item: ItemRef | null = null
  if ('item_id' in args) {
    item = items.find((candidate) => candidate.id === args.item_id) ?? null
    if (item === null) throw new LLMProviderError('Tool references a missing inventory item')
  }
  if (call.name === 'update_stock' && args.delta === 0) {
    throw new LLMProviderError('Stock change cannot be zero')
  }
  return {
    tool: call.name,
    text,
    args,
    itemId: item ? item.id : null,
    itemName: item ? item.name : null,
    missingItem: null,
  }
}

/** Validates the JSON Schema subset used by the tool registry (port of llm.py _validate_value). */
export function validateValue(value: unknown, schema: JsonSchema, path: string): void {
  const expected = schema.type
  const checks: Record<string, boolean> = {
    integer: typeof value === 'number' && Number.isInteger(value),
    number: typeof value === 'number' && Number.isFinite(value),
    string: typeof value === 'string',
    boolean: typeof value === 'boolean',
    object: value !== null && typeof value === 'object' && !Array.isArray(value),
    array: Array.isArray(value),
    null: value === null,
  }
  if (expected === undefined || !checks[expected]) throw new LLMProviderError(`Invalid JSON type at ${path}`)
  if (schema.enum && !schema.enum.includes(value)) throw new LLMProviderError(`Value outside enum at ${path}`)
  if (expected === 'integer' || expected === 'number') {
    const number = value as number
    if (!Number.isFinite(number)) throw new LLMProviderError(`Non-finite number at ${path}`)
    if (schema.minimum !== undefined && number < schema.minimum) throw new LLMProviderError(`Value below minimum at ${path}`)
    if (schema.maximum !== undefined && number > schema.maximum) throw new LLMProviderError(`Value above maximum at ${path}`)
  }
  if (expected === 'string') {
    const length = Array.from(value as string).length
    if (length < (schema.minLength ?? 0)) throw new LLMProviderError(`Text too short at ${path}`)
    if (schema.maxLength !== undefined && length > schema.maxLength) throw new LLMProviderError(`Text too long at ${path}`)
  }
  if (expected === 'array') {
    const list = value as unknown[]
    if (list.length < (schema.minItems ?? 0)) throw new LLMProviderError(`List too short at ${path}`)
    if (schema.maxItems !== undefined && list.length > schema.maxItems) throw new LLMProviderError(`List too long at ${path}`)
    list.forEach((item, index) => validateValue(item, schema.items ?? {}, `${path}[${index}]`))
  }
  if (expected !== 'object') return

  const object = value as Record<string, unknown>
  const required = schema.required ?? []
  const properties = schema.properties ?? {}
  if (required.some((key) => !(key in object))) throw new LLMProviderError('Tool arguments are missing required fields')
  if (schema.additionalProperties === false && Object.keys(object).some((key) => !Object.hasOwn(properties, key))) {
    throw new LLMProviderError('Tool arguments contain unexpected fields')
  }
  for (const [key, child] of Object.entries(object)) {
    const prop = Object.hasOwn(properties, key) ? properties[key] : undefined
    if (prop === undefined) continue
    validateValue(child, prop, `${path}.${key}`)
  }
}
