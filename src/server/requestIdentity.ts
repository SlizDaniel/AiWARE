import type { SessionIdentity } from './auth'

type Claims = { sub?: string; email?: unknown; is_anonymous?: unknown; user_metadata?: unknown }
type VerifiedClaims = { data: { claims: Claims } | null; error: unknown }

/** Explicit credentials take precedence; invalid tokens never fall back to cookies. */
export async function requestIdentity(
  authorization: string | null,
  verify: (token: string) => Promise<VerifiedClaims>,
  readCookies: () => Promise<SessionIdentity | null>,
): Promise<SessionIdentity | null> {
  if (authorization === null) return readCookies()
  const match = /^Bearer ([^\s]+)$/i.exec(authorization)
  if (!match) return null
  const { data, error } = await verify(match[1])
  const claims = data?.claims
  if (error || !claims?.sub || claims.is_anonymous === true) return null
  const metadata = claims.user_metadata
  return {
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : '',
    metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? metadata as Record<string, unknown> : {},
  }
}
