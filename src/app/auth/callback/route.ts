// Landing URL of Supabase e-mail links (sign-up confirmation, magic link).
// PKCE flow: ?code=… → exchangeCodeForSession. Also accepts ?token_hash=…&type=…
// for custom e-mail templates. Session cookies are written via next/headers.
import type { EmailOtpType } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseConfig } from '@/server/env'

export const runtime = 'nodejs'

/** Only same-origin relative paths; anything else falls back to '/'. */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/'
  return value
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type') as EmailOtpType | null
  const next = safeNext(url.searchParams.get('next'))

  if (supabaseConfig() && (code || (tokenHash && type))) {
    try {
      const supabase = await createClient()
      const { error } = code
        ? await supabase.auth.exchangeCodeForSession(code)
        : await supabase.auth.verifyOtp({ type: type as EmailOtpType, token_hash: tokenHash as string })
      if (!error) return NextResponse.redirect(new URL(next, url.origin))
      console.warn('auth/callback:', error.code ?? error.message)
    } catch (error) {
      console.error('auth/callback:', error)
    }
  }

  const login = new URL('/login', url.origin)
  login.searchParams.set('error', 'callback')
  return NextResponse.redirect(login)
}
