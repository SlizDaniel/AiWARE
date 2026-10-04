// Per-user request budget for endpoints that call paid AI APIs (Gemini, Groq).
// A fixed window counter in Postgres works across all serverless instances.
import { HttpError } from './http'
import type { Db } from './sql'

export const MSG_RATE_LIMITED = 'Za dużo zapytań — odczekaj chwilę i spróbuj ponownie.'

export type RateLimit = { limit: number; windowSeconds: number }

export const RATE_LIMITS = {
  command: { limit: 30, windowSeconds: 60 },
  stt: { limit: 30, windowSeconds: 60 },
  importPreview: { limit: 10, windowSeconds: 60 },
  // ścieżki, sektory i przypisania zapisuje każde konto — limit chroni przed pętlą klienta
  mapWrite: { limit: 30, windowSeconds: 60 },
} satisfies Record<string, RateLimit>

/** Counts one request for `key`; HttpError 429 once the window's budget is spent. */
export async function enforceRateLimit(db: Db, key: string, { limit, windowSeconds }: RateLimit): Promise<void> {
  const [row] = await db.query<{ count: number }>(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, now(), 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start <= now() - make_interval(secs => $2::int) THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start <= now() - make_interval(secs => $2::int) THEN now() ELSE rate_limits.window_start END
     RETURNING count`,
    [key, windowSeconds],
  )
  if ((row?.count ?? 0) > limit) throw new HttpError(429, MSG_RATE_LIMITED)
}
