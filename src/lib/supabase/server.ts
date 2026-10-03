// Supabase client for Server Components and Route Handlers. Create a new one per
// request (never cache it in a module/global variable).
import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { supabaseConfig } from '@/server/env'

export async function createClient(): Promise<SupabaseClient> {
  const config = supabaseConfig()
  if (!config) {
    throw new Error('Supabase nie jest skonfigurowany (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).')
  }
  const cookieStore = await cookies()

  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options)
        } catch {
          // Called from a Server Component, where cookies are read-only. Safe to
          // ignore: src/proxy.ts refreshes the session on every request.
        }
      },
    },
  })
}
