// Runtime configuration read from environment variables (Vercel project
// settings in production, .env.local locally).
import type { AgentMode } from './types'

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])

function env(name: string): string {
  return (process.env[name] ?? '').trim()
}

export function isDemoMode(): boolean {
  return TRUE_VALUES.has(env('DEMO_MODE').toLowerCase())
}

export function isVercel(): boolean {
  return env('VERCEL') !== ''
}

/** IANA zone for timestamps shown in the UI (Vercel runs in UTC). */
export function appTimezone(): string {
  const zone = env('APP_TIMEZONE') || 'Europe/Warsaw'
  // The value is interpolated into SQL (AT TIME ZONE); allow only IANA-style names.
  return /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(zone) ? zone : 'Europe/Warsaw'
}

export function geminiApiKey(): string {
  return env('GEMINI_API_KEY') || env('GOOGLE_GENERATIVE_AI_API_KEY') || env('GOOGLE_API_KEY')
}

export function geminiModel(): string {
  return env('GEMINI_MODEL') || 'gemini-3.8-flash'
}

/** Model used for speech-to-text (audio understanding); defaults to the main model. */
export function geminiSttModel(): string {
  return env('GEMINI_STT_MODEL') || geminiModel()
}

export function requestedModeFromEnv(): AgentMode {
  if (isDemoMode()) return 'mock'
  const mode = env('LLM_MODE').toLowerCase()
  return mode === 'offline' || mode === 'mock' ? mode : 'llm'
}

export type DatabaseConfig =
  | { kind: 'postgres'; url: string }
  // dataDir null = in-memory PGlite (data lost on restart / per serverless instance)
  | { kind: 'pglite'; dataDir: string | null; ephemeral: boolean }

/**
 * Production: Supabase Postgres via DATABASE_URL (or POSTGRES_URL set by the
 * Vercel ↔ Supabase integration). Without it: PGlite — a file locally, memory
 * on Vercel (clearly flagged as ephemeral in /api/health).
 */
export function databaseConfig(): DatabaseConfig {
  const normalUrl = env('DATABASE_URL') || env('POSTGRES_URL')
  if (isDemoMode()) {
    const demoUrl = env('DEMO_DATABASE_URL')
    if (demoUrl) {
      if (demoUrl === normalUrl) throw new Error('DEMO_DATABASE_URL musi wskazywać inną bazę niż DATABASE_URL.')
      return { kind: 'postgres', url: demoUrl }
    }
    return isVercel()
      ? { kind: 'pglite', dataDir: null, ephemeral: true }
      : { kind: 'pglite', dataDir: env('PGLITE_DEMO_DIR') || './data/pglite-demo', ephemeral: false }
  }
  if (normalUrl) return { kind: 'postgres', url: normalUrl }
  return isVercel()
    ? { kind: 'pglite', dataDir: null, ephemeral: true }
    : { kind: 'pglite', dataDir: env('PGLITE_DIR') || './data/pglite', ephemeral: false }
}

export type SupabaseConfig = { url: string; publishableKey: string }

export function supabaseConfig(): SupabaseConfig | null {
  const url = env('NEXT_PUBLIC_SUPABASE_URL') || env('SUPABASE_URL')
  const publishableKey =
    env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') || env('NEXT_PUBLIC_SUPABASE_ANON_KEY') || env('SUPABASE_ANON_KEY')
  return url && publishableKey ? { url, publishableKey } : null
}

/**
 * supabase      — Supabase Auth sessions are required.
 * disabled      — no login; every request acts as a local manager (dev/demo only).
 * misconfigured — production without Supabase keys: the API refuses to serve data.
 */
export function authMode(): 'supabase' | 'disabled' | 'misconfigured' {
  if (TRUE_VALUES.has(env('AUTH_DISABLED').toLowerCase())) return 'disabled'
  if (supabaseConfig()) return 'supabase'
  return process.env.NODE_ENV === 'production' ? 'misconfigured' : 'disabled'
}
