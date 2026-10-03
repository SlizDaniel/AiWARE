// Owner settings (card 12) and agent mode, persisted in the `settings` table so
// every serverless instance sees the same values without a restart. Field names
// and validation follow the card-12 API from the legacy FastAPI app
// (GET/PATCH /api/settings), extended with TTS and the default order size.
import { DEFAULT_REORDER_QUANTITY, setSetting } from './db'
import { geminiApiKey, geminiModel, geminiSttModel, isDemoMode, requestedModeFromEnv } from './env'
import { HttpError } from './http'
import type { Db } from './sql'
import type { AgentMode } from './types'

export const APP_VERSION = '0.3.0'

export type AgentModeStatus = {
  mode: AgentMode
  effective_mode: AgentMode
  llm_available: boolean
  warning: string | null
  demo_mode: boolean
}

export type DataAdapter = 'database' | 'file_import'
export type VoiceMode = 'push_to_talk' | 'wake_word' | 'text'

export type AppSettings = {
  prefix: string
  mode: AgentMode
  adapter: DataAdapter
  default_minimum: number
  voice_mode: VoiceMode
  tts_enabled: boolean
  reorder_default_quantity: number
}

type StoredSettings = AppSettings & { retired_prefixes: string[] }

export type AiUsage = {
  llm_model: string
  llm_provider: string
  llm_enabled: boolean
  stt_model: string
  stt_provider: string
  stt_enabled: boolean
  disclosure: string
}

export type SettingsPayload = AppSettings & { mode_status: AgentModeStatus; version: string; ai_usage: AiUsage }

export const DEFAULT_AGENT_PREFIX = 'Magu'
const MAX_DEFAULT_MINIMUM = 100_000
const MAX_REORDER_QUANTITY = 100_000
const AGENT_MODES: readonly AgentMode[] = ['llm', 'offline', 'mock']
const ADAPTERS: readonly DataAdapter[] = ['database', 'file_import']
const VOICE_MODES: readonly VoiceMode[] = ['push_to_talk', 'wake_word', 'text']
const PREFIX_RE = /^\p{L}{2,30}$/u

// Settings table keys. `agent_mode` / `agent_prefix` predate card 12 and stay readable.
const KEYS = {
  prefix: 'prefix',
  legacyPrefix: 'agent_prefix',
  retired: 'retired_prefixes',
  mode: 'agent_mode',
  adapter: 'adapter',
  defaultMinimum: 'default_minimum',
  voiceMode: 'voice_mode',
  tts: 'tts_enabled',
  reorderQuantity: 'reorder_default_quantity',
} as const

export const NO_KEY_WARNING = 'Brak GEMINI_API_KEY — agent działa w trybie offline.'
export const DEMO_WARNING = 'Demo offline — osobna baza, komendy tekstowe, bez zewnętrznych API.'
export const MOCK_WARNING = 'Mock: parser offline. Seed demo włączysz przez DEMO_MODE=1 przy starcie.'
export const DEMO_LOCKED_DETAIL =
  'Demo offline jest zablokowane na czas tej sesji. Wyłącz DEMO_MODE i uruchom backend ponownie.'
export const PREFIX_MESSAGE = 'Prefix musi być jednym słowem (2–30 liter).'
export const TEXT_ONLY_STT_DETAIL = 'Tryb tekstowy — mikrofon wyłączony w Ustawieniach.'

const GEMINI_HOST = 'generativelanguage.googleapis.com'
const WHISPER_DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1'
const WHISPER_DEFAULT_MODEL = 'whisper-large-v3'

const isOneOf =
  <T extends string>(values: readonly T[]) =>
  (value: unknown): value is T =>
    typeof value === 'string' && (values as readonly string[]).includes(value)

const isAgentMode = isOneOf(AGENT_MODES)
const isAdapter = isOneOf(ADAPTERS)
const isVoiceMode = isOneOf(VOICE_MODES)
const isPrefix = (value: unknown): value is string => typeof value === 'string' && PREFIX_RE.test(value)
const isIntIn = (min: number, max: number) => (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

async function readStored(db: Db): Promise<StoredSettings> {
  const rows = await db.query<{ key: string; value: unknown }>('SELECT key, value FROM settings')
  const stored = new Map(rows.map((row) => [row.key, row.value]))
  const pick = <T>(key: string, valid: (value: unknown) => value is T, fallback: T): T => {
    const value = stored.get(key)
    return valid(value) ? value : fallback
  }
  // The legacy FastAPI app called the built-in database adapter "sqlite".
  const adapter = stored.get(KEYS.adapter) === 'sqlite' ? 'database' : pick(KEYS.adapter, isAdapter, 'database')
  const retired = stored.get(KEYS.retired)
  return {
    prefix: pick(KEYS.prefix, isPrefix, pick(KEYS.legacyPrefix, isPrefix, DEFAULT_AGENT_PREFIX)),
    mode: isDemoMode() ? 'mock' : pick(KEYS.mode, isAgentMode, requestedModeFromEnv()),
    adapter,
    default_minimum: pick(KEYS.defaultMinimum, isIntIn(0, MAX_DEFAULT_MINIMUM), 0),
    voice_mode: pick(KEYS.voiceMode, isVoiceMode, 'wake_word'),
    tts_enabled: pick(KEYS.tts, (value): value is boolean => typeof value === 'boolean', false),
    reorder_default_quantity: pick(KEYS.reorderQuantity, isIntIn(1, MAX_REORDER_QUANTITY), DEFAULT_REORDER_QUANTITY),
    retired_prefixes: Array.isArray(retired) ? retired.filter(isPrefix) : [],
  }
}

export async function getAppSettings(db: Db): Promise<AppSettings> {
  const { retired_prefixes: _retired, ...settings } = await readStored(db)
  return settings
}

/** Same logic as the FastAPI GET /api/agent-mode; the requested mode lives in settings. */
export async function getAgentModeStatus(db: Db): Promise<AgentModeStatus> {
  const demoMode = isDemoMode()
  const { mode } = await readStored(db)
  const keyPresent = geminiApiKey() !== ''
  let effectiveMode: AgentMode = mode
  let warning: string | null = null
  if (mode === 'llm' && !keyPresent) {
    effectiveMode = 'offline'
    warning = NO_KEY_WARNING
  } else if (mode === 'mock') {
    effectiveMode = 'offline'
    warning = demoMode ? DEMO_WARNING : MOCK_WARNING
  }
  return { mode, effective_mode: effectiveMode, llm_available: keyPresent, warning, demo_mode: demoMode }
}

const VALIDATORS: Record<keyof AppSettings, { valid: (value: unknown) => boolean; message: string }> = {
  prefix: { valid: isPrefix, message: PREFIX_MESSAGE },
  mode: { valid: isAgentMode, message: 'Nieprawidłowy tryb agenta. Dozwolone: llm, offline, mock.' },
  adapter: { valid: isAdapter, message: 'Źródło danych musi mieć wartość database albo file_import.' },
  default_minimum: {
    valid: isIntIn(0, MAX_DEFAULT_MINIMUM),
    message: 'Domyślne minimum musi być liczbą całkowitą od 0 do 100000.',
  },
  voice_mode: { valid: isVoiceMode, message: 'Tryb głosu musi mieć wartość push_to_talk, wake_word albo text.' },
  tts_enabled: {
    valid: (value) => typeof value === 'boolean',
    message: 'Pole tts_enabled musi mieć wartość true albo false.',
  },
  reorder_default_quantity: {
    valid: isIntIn(1, MAX_REORDER_QUANTITY),
    message: 'Domyślna ilość zamówienia musi być liczbą całkowitą od 1 do 100000.',
  },
}

const STORAGE_KEY: Record<keyof AppSettings, string> = {
  prefix: KEYS.prefix,
  mode: KEYS.mode,
  adapter: KEYS.adapter,
  default_minimum: KEYS.defaultMinimum,
  voice_mode: KEYS.voiceMode,
  tts_enabled: KEYS.tts,
  reorder_default_quantity: KEYS.reorderQuantity,
}

/**
 * Validates the whole partial update first (unknown keys, nulls and invalid
 * values → 422; enabling the cloud in the offline demo → 409), then saves it in
 * one transaction. A rejected update changes nothing. Changing the prefix
 * retires the previous one: commands that still use it are not executed.
 */
export async function updateAppSettings(db: Db, patch: Record<string, unknown>): Promise<AppSettings> {
  const changes: Partial<Record<keyof AppSettings, unknown>> = {}
  for (const [key, raw] of Object.entries(patch)) {
    if (!(key in VALIDATORS)) throw new HttpError(422, `Nieznane ustawienie: ${key}.`)
    if (raw === null || raw === undefined) throw new HttpError(422, 'Ustawienie nie może być puste.')
    let value = raw
    if (key === 'prefix' && typeof value === 'string') value = value.trim()
    if (key === 'adapter' && value === 'sqlite') value = 'database'
    const rule = VALIDATORS[key as keyof AppSettings]
    if (!rule.valid(value)) throw new HttpError(422, rule.message)
    changes[key as keyof AppSettings] = value
  }
  if (isDemoMode() && changes.mode !== undefined && changes.mode !== 'mock') {
    throw new HttpError(409, DEMO_LOCKED_DETAIL)
  }

  await db.transaction(async (tx) => {
    const current = await readStored(tx)
    if (typeof changes.prefix === 'string' && changes.prefix.toLocaleLowerCase('pl') !== current.prefix.toLocaleLowerCase('pl')) {
      const next = changes.prefix.toLocaleLowerCase('pl')
      const retired = [...current.retired_prefixes, current.prefix].filter(
        (prefix, index, all) =>
          prefix.toLocaleLowerCase('pl') !== next &&
          all.findIndex((other) => other.toLocaleLowerCase('pl') === prefix.toLocaleLowerCase('pl')) === index,
      )
      await setSetting(tx, KEYS.retired, retired.sort((a, b) => a.localeCompare(b, 'pl')))
    }
    for (const [key, value] of Object.entries(changes)) {
      await setSetting(tx, STORAGE_KEY[key as keyof AppSettings], value)
    }
  })
  return getAppSettings(db)
}

export async function setAgentMode(db: Db, mode: AgentMode): Promise<AgentModeStatus> {
  await updateAppSettings(db, { mode })
  return getAgentModeStatus(db)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function prefixMatch(text: string, prefix: string): RegExpExecArray | null {
  return new RegExp(`^\\s*${escapeRegExp(prefix)}(?![\\p{L}\\p{N}_])[\\s,.:;!?—–-]*`, 'iu').exec(text)
}

/**
 * Removes the configured wake word from the start of a command:
 * „Magu, ile mamy szkła?" / „magu ile mamy szkła" → „ile mamy szkła?".
 */
export function stripAgentPrefix(text: string, prefix: string): string {
  const match = prefixMatch(text, prefix)
  return (match ? text.slice(match[0].length) : text).trim()
}

/**
 * Card 12: text to interpret, or null when the command starts with a prefix the
 * owner replaced — such commands must not trigger tools.
 */
export async function commandText(db: Db, text: string): Promise<{ text: string | null; prefix: string }> {
  const { prefix, retired_prefixes: retired } = await readStored(db)
  if (prefixMatch(text, prefix)) return { text: stripAgentPrefix(text, prefix), prefix }
  if (retired.some((old) => prefixMatch(text, old))) return { text: null, prefix }
  return { text: text.trim(), prefix }
}

function hostOf(url: string, fallback: string): string {
  try {
    return new URL(url).hostname || fallback
  } catch {
    return fallback
  }
}

/** „Użycie AI” for the hackathon submission — derived from configuration, never exposes keys. */
export function aiUsage(settings: AppSettings, status: AgentModeStatus): AiUsage {
  const whisperKey = (process.env.STT_API_KEY ?? '').trim()
  const sttModel = whisperKey ? (process.env.STT_MODEL ?? '').trim() || WHISPER_DEFAULT_MODEL : geminiSttModel()
  const sttProvider = whisperKey
    ? hostOf((process.env.STT_BASE_URL ?? '').trim() || WHISPER_DEFAULT_BASE_URL, 'API zgodne z Whisper')
    : GEMINI_HOST
  const llmEnabled = status.effective_mode === 'llm'
  const sttEnabled =
    !status.demo_mode && settings.voice_mode !== 'text' && (whisperKey !== '' || geminiApiKey() !== '')
  const llmModel = geminiModel()
  const disclosure =
    'MAGAZYNIER korzysta z AI do interpretacji poleceń, transkrypcji mowy i podpowiedzi mapowania kolumn przy imporcie. ' +
    `Skonfigurowane integracje: LLM ${llmModel} (Google Gemini, ${GEMINI_HOST}), STT ${sttModel} (${sttProvider}). ` +
    `W bieżącym trybie LLM ${llmEnabled ? 'jest aktywne' : 'jest zastąpione parserem offline'}, ` +
    `a STT ${sttEnabled ? 'jest dostępne po naciśnięciu mikrofonu' : 'jest wyłączone lub nieskonfigurowane'}. ` +
    'Dyktowanie na żywo i nasłuch na prefix korzystają z rozpoznawania mowy wbudowanego w przeglądarkę (Web Speech API; w Chrome przetwarzane przez usługę Google), a gdy przeglądarka go nie ma — z nagrania wysyłanego do STT. ' +
    'Polecenia, nagrania oraz nagłówki i kilka przykładowych wierszy importowanych plików są wysyłane do skonfigurowanych API tylko przy aktywnej integracji. ' +
    'Zmiany stanów wymagają zatwierdzenia przez człowieka i są zapisywane w audycie z autorem zmiany. ' +
    'Przy tworzeniu projektu korzystaliśmy także z Codex/ChatGPT oraz Claude Code.'
  return {
    llm_model: llmModel,
    llm_provider: GEMINI_HOST,
    llm_enabled: llmEnabled,
    stt_model: sttModel,
    stt_provider: sttProvider,
    stt_enabled: sttEnabled,
    disclosure,
  }
}

/** Payload of GET/PATCH /api/settings. */
export async function settingsPayload(db: Db): Promise<SettingsPayload> {
  const settings = await getAppSettings(db)
  const modeStatus = await getAgentModeStatus(db)
  return { ...settings, mode_status: modeStatus, version: APP_VERSION, ai_usage: aiUsage(settings, modeStatus) }
}
