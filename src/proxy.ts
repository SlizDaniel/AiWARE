// Next 16 Proxy (formerly middleware). With Supabase Auth enabled it refreshes
// the session cookie on every request and sends logged-out page visits to
// /login. API routes are never redirected — they answer 401 JSON themselves.
// Authorization is NOT decided here: route handlers call requireUser().
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { authMode, supabaseConfig } from '@/server/env'

function isPublicPage(pathname: string): boolean {
  return pathname === '/login' || pathname.startsWith('/login/') || pathname === '/auth' || pathname.startsWith('/auth/')
}

function isApi(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/')
}

/** Redirect that keeps any session cookies the refresh just wrote (or cleared). */
function redirectWithCookies(url: URL, from: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url)
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie)
  const cacheControl = from.headers.get('cache-control')
  if (cacheControl) redirect.headers.set('cache-control', cacheControl)
  return redirect
}

export async function proxy(request: NextRequest) {
  const config = supabaseConfig()
  if (authMode() !== 'supabase' || !config) return NextResponse.next()

  let response = NextResponse.next({ request })
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        // Forward refreshed tokens to the route handler / page of this request…
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        // …and to the browser, with no-store headers so CDNs never cache them.
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options)
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value)
      },
    },
  })

  // Nothing may run between createServerClient and getClaims (Supabase SSR rule).
  const { data } = await supabase.auth.getClaims()
  const signedIn = Boolean(data?.claims?.sub)

  const { pathname, search } = request.nextUrl
  if (isApi(pathname)) return response

  if (!signedIn && !isPublicPage(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    if (pathname !== '/') url.searchParams.set('next', pathname + search)
    return redirectWithCookies(url, response)
  }

  if (signedIn && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return redirectWithCookies(url, response)
  }

  return response
}

export const config = {
  matcher: [
    // Everything except Next internals, public assets and static files.
    '/((?!_next/static|_next/image|favicon\\.ico|brand/|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest|.*\\.(?:xlsx|svg|png|jpg|jpeg|gif|webp|ico|avif)$).*)',
  ],
}
