import { geminiApiKey, geminiModel, decisionApiKey, decisionEndpoint, decisionModel } from './env'
import { DecisionHybridProvider } from './decisions'
import { GeminiProvider } from './llm'
import type { LLMProvider } from './types'

/** Construct command routing only; Gemini-only STT/import/readiness stay separate. */
export function commandProviderFromEnv(): LLMProvider | null {
  const googleKey = geminiApiKey()
  const fallback = googleKey ? new GeminiProvider({ apiKey: googleKey, model: geminiModel() }) : null
  const decisionKey = decisionApiKey()
  return decisionKey ? new DecisionHybridProvider({ apiKey: decisionKey, endpoint: decisionEndpoint(), model: decisionModel(), fallback }) : fallback
}
