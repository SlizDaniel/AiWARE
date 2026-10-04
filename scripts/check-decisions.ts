// Synthetic, read-only comparison: no database, tools or inventory writes.
// npm run check:decisions [-- --env-file path]
import { existsSync, readFileSync } from 'node:fs'

const flag = process.argv.indexOf('--env-file')
if (flag >= 0 && !process.argv[flag + 1]) throw new Error('Missing --env-file path')
const files = flag >= 0 ? [process.argv[flag + 1]] : ['.env.local', '.env']
for (const file of files) {
  if (!existsSync(file)) continue
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}
const { geminiApiKey, geminiModel, isDemoMode, decisionApiKey, decisionEndpoint, decisionModel } = await import('../src/server/env')
const { GeminiProvider, GeminiRequestError } = await import('../src/server/llm')
const { DecisionHybridProvider, DecisionRequestError } = await import('../src/server/decisions')
const { toolSchemas } = await import('../src/server/agentContract')

if (isDemoMode() || !decisionApiKey() || !geminiApiKey()) {
  console.error('Porównanie wymaga OPENROUTER_API_KEY i GEMINI_API_KEY oraz wyłączonego DEMO_MODE.')
  process.exitCode = 2
} else {
  const google = new GeminiProvider({ apiKey: geminiApiKey(), model: geminiModel() })
  // No Gemini fallback here: a clarification indicates the Mercury Decide fast path declined.
  const decisions = new DecisionHybridProvider({ apiKey: decisionApiKey(), endpoint: decisionEndpoint(), model: decisionModel(), fallback: null })
  const context = JSON.stringify({ units_per_pallet: 2, items: [
    { id: 1, name: 'Kartony', quantity: 54, unit: 'szt.', minimum: 12, location: 'A1' },
    { id: 2, name: 'Szkło', quantity: 20, unit: 'szt.', minimum: 8, location: 'B2' },
  ] })
  const samples = [
    { text: 'wzięliśmy paletę kartonów', name: 'update_stock', args: { item_id: 1, delta: -2 } },
    { text: 'ile mamy kartonów?', name: 'get_stock', args: { item_id: 1 } },
    { text: 'gdzie leży szkło?', name: 'get_location', args: { item_id: 2 } },
  ]
  const timings: Record<string, number[]> = { 'Mercury Decide': [], Gemini: [] }
  for (const sample of samples) {
    for (const [name, provider] of [['Mercury Decide', decisions], ['Gemini', google]] as const) {
      const started = performance.now()
      try {
        const result = await provider.interpret(sample.text, toolSchemas(), context)
        const elapsed = Math.round(performance.now() - started)
        const call = result.toolCall
        const matched = call?.name === sample.name && Object.keys(call.arguments).length === Object.keys(sample.args).length && Object.entries(sample.args).every(([key, value]) => call.arguments[key] === value)
        console.log(`${name}: ${elapsed} ms; ${matched ? 'OK' : 'REVIEW'}; ${sample.text}`)
        if (matched) timings[name].push(elapsed)
        else process.exitCode = 1
      } catch (error) {
        const detail = error instanceof DecisionRequestError
          ? `HTTP ${error.status}`
          : error instanceof GeminiRequestError ? (error.status === null ? error.kind : `HTTP ${error.status}`) : 'transport lub kontrakt odpowiedzi'
        console.error(`${name}: ERROR (${detail}); ${sample.text} — sprawdź klucz, model, limit i połączenie.`)
        process.exitCode = 1
      }
    }
  }
  for (const [name, values] of Object.entries(timings)) {
    if (values.length === samples.length) console.log(`${name}: mediana ${values.sort((a, b) => a - b)[1]} ms (3 poprawne decyzje; mała próba).`)
  }
}
