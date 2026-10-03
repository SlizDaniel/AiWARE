import { requireUser } from '@/server/auth'
import { authMode } from '@/server/env'
import { route } from '@/server/http'
import { getDb } from '@/server/runtime'

export const runtime = 'nodejs'

/** Who am I? 401 JSON when logged out, 503 when auth is misconfigured. */
export const GET = route(async () => {
  const db = await getDb()
  // Pending accounts may ask who they are (the UI shows a waiting screen); nothing else.
  const user = await requireUser(db, undefined, { allowPending: true })
  return Response.json({ user, auth_mode: authMode() })
})
