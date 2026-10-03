// Supabase client for Client Components (login form, sign-out button).
// The NEXT_PUBLIC_* accesses must stay literal so Next inlines them at build time.
import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim()
const SUPABASE_KEY = (
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  ''
).trim()

/** True when the build carries the public Supabase URL + key (login is possible). */
export function isSupabaseConfiguredInBrowser(): boolean {
  return SUPABASE_URL !== '' && SUPABASE_KEY !== ''
}

/** Browser client (a singleton in the browser). Throws when Supabase is not configured. */
export function createClient(): SupabaseClient {
  if (!isSupabaseConfiguredInBrowser()) {
    throw new Error('Supabase nie jest skonfigurowany (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).')
  }
  return createBrowserClient(SUPABASE_URL, SUPABASE_KEY)
}
