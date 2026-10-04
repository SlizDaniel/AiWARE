// Shared server-side contracts. Every server module imports its cross-module
// types from here so parallel work on parser, LLM, inventory and routes stays
// compatible.

export type AgentMode = 'llm' | 'offline' | 'mock'

/** oczekujacy = self-registered account waiting for a manager's approval (no access). */
export type Role = 'pracownik' | 'kierownik' | 'oczekujacy'

/** Authenticated user as seen by route handlers (profile row + auth identity). */
export type AppUser = {
  id: string
  email: string
  display_name: string
  role: Role
}

/** Minimal inventory reference used by the intent → tool seam. */
export type ItemRef = { id: number; name: string; unit?: string }

export type ImportField = 'name' | 'quantity' | 'minimum' | 'location' | 'unit'

export type ColumnMapping = Record<ImportField, { column: number | null; confidence: number }>

/** One validated row of an inventory import, ready for upsert. */
export type ImportedItem = {
  name: string
  quantity: number
  minimum: number | null
  unit: string | null
  location: string | null
}

/** Subset of JSON Schema used by the tool registry. */
export type JsonSchema = {
  type?: 'object' | 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'null'
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean
  enum?: unknown[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  items?: JsonSchema
}

/** OpenAI-style function schema. The Gemini provider converts it to functionDeclarations. */
export type ToolSchema = {
  type: 'function'
  function: { name: string; description: string; parameters: JsonSchema }
}

export type ToolCall = { name: string; arguments: Record<string, unknown> }

export type Interpretation =
  | { toolCall: ToolCall; clarification: null }
  | { toolCall: null; clarification: string }

/** The provider failed or returned a response outside the tool contract. */
export class LLMProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LLMProviderError'
  }
}

export interface LLMProvider {
  interpret(text: string, tools: ToolSchema[], context: string): Promise<Interpretation>
}
