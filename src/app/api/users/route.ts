import { listUsers, requireUser } from '@/server/auth'
import { route } from '@/server/http'
import { getDb } from '@/server/runtime'

export const runtime = 'nodejs'

/** Accounts and their roles (Ustawienia → Użytkownicy). Kierownik only. */
export const GET = route(async () => {
  const db = await getDb()
  await requireUser(db, 'kierownik')
  return Response.json({ users: await listUsers(db) })
})
