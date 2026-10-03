import { requireUser, setUserRole } from '@/server/auth'
import { bumpDataVersion } from '@/server/db'
import { readJson, route } from '@/server/http'
import { getDb } from '@/server/runtime'

export const runtime = 'nodejs'

/** Body {role: 'pracownik' | 'kierownik'}. Kierownik only; keeps at least one kierownik. */
export const PUT = route(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params
  const db = await getDb()
  await requireUser(db, 'kierownik')
  const body = await readJson<{ role?: unknown } | null>(request)
  const user = await setUserRole(db, id, body && typeof body === 'object' ? body.role : undefined)
  await bumpDataVersion(db)
  return Response.json({ user })
})
