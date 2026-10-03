// Adapter for the Python diagnostic. Reuses the real provider and contract,
// but never opens a database or executes a tool. No raw errors reach stdout.
import { readFileSync } from 'node:fs'
import { normalizeCall, toolSchemas } from '../src/server/agentContract'
import { isDemoMode } from '../src/server/env'
import { llmConfigured, providerFromEnv } from '../src/server/llm'
import type { ItemRef, LLMProvider } from '../src/server/types'

export async function interpretSample(input: unknown, provider: LLMProvider) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { kind: 'error' }
  const { text, context, items } = input as Record<string, unknown>
  if (typeof text !== 'string' || !text.trim() || text.length > 2000 || typeof context !== 'string' || context.length > 10000) return { kind: 'error' }
  if (!Array.isArray(items) || items.length < 1 || items.length > 100 || !items.every((item) =>
    item && typeof item === 'object' && !Array.isArray(item) && Number.isSafeInteger(item.id) && item.id > 0 &&
    typeof item.name === 'string' && item.name.trim() && item.name.length <= 100)) return { kind: 'error' }
  if (new Set(items.map((item) => item.id)).size !== items.length) return { kind: 'error' }
  try {
    const result = await provider.interpret(text, toolSchemas(), context)
    if (result.toolCall) {
      const call = normalizeCall(result.toolCall, text, items as ItemRef[])
      return { kind: 'call', tool: call.tool, args: call.args }
    }
    return result.clarification?.trim() ? { kind: 'clarification' } : { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}

if (process.argv.includes('--once')) {
  let result: object = { kind: 'error' }
  try {
    if (!isDemoMode() && llmConfigured()) {
      const bytes = readFileSync(0)
      if (bytes.length <= 20000) result = await interpretSample(JSON.parse(bytes.toString('utf8')), providerFromEnv())
    }
  } catch { /* Keys, raw model content and exception text must not be printed. */ }
  process.stdout.write(JSON.stringify(result) + '\n')
}
