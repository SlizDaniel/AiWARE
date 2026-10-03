// Live Gemini check (port of legacy/scripts/check-live-llm.py): three real
// requests with a synthetic inventory, validated against the tool contract.
// No tools are executed and no database is opened.
//   npm run check:gemini [-- --env-file path]
// Exit codes: 0 OK, 1 provider error, 2 missing configuration / demo mode.
// Never prints the API key or raw provider responses.
import { existsSync, readFileSync } from 'node:fs'

function loadEnvFile(file: string): void {
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    // The real environment always wins over files.
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
    }
  }
}

const flag = process.argv.indexOf('--env-file')
const envFiles = flag >= 0 && process.argv[flag + 1] ? [process.argv[flag + 1]] : ['.env.local', '.env']
for (const file of envFiles) loadEnvFile(file)

const { geminiModel, isDemoMode } = await import('../src/server/env')
const { llmConfigured, providerFromEnv } = await import('../src/server/llm')
const { normalizeCall, toolSchemas } = await import('../src/server/agentContract')
const { LLMProviderError } = await import('../src/server/types')

// Each sample has the one tool call a correct model must choose (legacy e52bcd9).
const SAMPLES: [text: string, tool: string, args: Record<string, unknown>][] = [
  ['Z półki zabraliśmy cztery sztuki folii stretch.', 'update_stock', { item_id: 3, delta: -4 }],
  ['Podaj mi aktualną liczbę kartonów w magazynie.', 'get_stock', { item_id: 1 }],
  ['W którym miejscu znajdę szkło?', 'get_location', { item_id: 2 }],
]

function sameArgs(actual: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)])
  return [...keys].every((key) => actual[key] === expected[key])
}
const ITEMS = [
  { id: 1, name: 'Kartony' },
  { id: 2, name: 'Szkło' },
  { id: 3, name: 'Folia stretch' },
]
const CONTEXT =
  'Dane syntetyczne do próby: id=1 Kartony, ilość=13, minimum=12, lokalizacja=Strefa A-1; ' +
  'id=2 Szkło, ilość=20, minimum=8, lokalizacja=Strefa B-2; ' +
  'id=3 Folia stretch, ilość=15, minimum=6, lokalizacja=Strefa C-1. Jedna paleta to 2 jednostki.'

async function check(): Promise<number> {
  let matched = 0
  let clarifications = 0
  try {
    const provider = providerFromEnv()
    const tools = toolSchemas()
    for (const [index, [text, expectedTool, expectedArgs]] of SAMPLES.entries()) {
      const result = await provider.interpret(text, tools, CONTEXT)
      if (result.toolCall) {
        const parsed = normalizeCall(result.toolCall, text, ITEMS)
        if (parsed.tool !== expectedTool || !sameArgs(parsed.args, expectedArgs)) {
          throw new LLMProviderError(`Sample ${index + 1}: tool or arguments do not match the expected intent`)
        }
        matched += 1
        console.log(`${index + 1}/3: zgodna intencja — ${parsed.tool}`)
      } else if (result.clarification) {
        clarifications += 1
        console.log(`${index + 1}/3: pytanie doprecyzowujące — oceń je w GUI`)
      } else {
        throw new LLMProviderError('Provider returned neither a call nor a clarification')
      }
    }
  } catch (error) {
    // Provider errors never contain response bodies or the key.
    const message = error instanceof LLMProviderError ? error.message : 'unexpected error'
    console.error(`Test Gemini NIEUDANY: ${message}`)
    await diagnose()
    return 1
  }
  console.log(`Gemini (${geminiModel()}): ${matched} zgodnych wywołań narzędzi; ${clarifications} pytań do ręcznej oceny.`)
  console.log('Nie wykonano narzędzi; baza nie została otwarta. Nadal wymagane: pełny przepływ komenda → karta w GUI.')
  return 0
}

/** Asks Google about the model and prints its error status/message (never the key). */
async function diagnose(): Promise<void> {
  const { geminiApiKey } = await import('../src/server/env')
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel()}`, {
      headers: { 'x-goog-api-key': geminiApiKey() },
      signal: AbortSignal.timeout(10_000),
    })
    if (response.ok) {
      console.error(`Diagnoza: klucz i model ${geminiModel()} są poprawne — problem leży w treści zapytania.`)
      return
    }
    const payload = (await response.json().catch(() => null)) as { error?: { status?: string; message?: string } } | null
    const detail = [payload?.error?.status, payload?.error?.message].filter(Boolean).join(': ').slice(0, 300)
    console.error(`Diagnoza (HTTP ${response.status}): ${detail || 'brak szczegółów'}`)
    if (/API key/i.test(detail)) {
      console.error(
        'Klucz jest nieprawidłowy. Uwaga: zmienne systemowe (GEMINI_API_KEY / GOOGLE_API_KEY) mają pierwszeństwo przed .env.local.',
      )
    }
  } catch {
    console.error('Diagnoza: brak połączenia z generativelanguage.googleapis.com.')
  }
}

async function main(): Promise<number> {
  if (isDemoMode()) {
    console.error('Włączone demo offline (DEMO_MODE). Wyłącz je przed testem prawdziwego API.')
    return 2
  }
  if (!llmConfigured()) {
    console.error('Brak GEMINI_API_KEY. Ustaw go lokalnie w .env.local lub w środowisku — nie wklejaj klucza do czatu.')
    return 2
  }
  return check()
}

process.exitCode = await main()
