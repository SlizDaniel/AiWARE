import { listAudit } from '@/server/db'
import { route } from '@/server/http'
import { session } from '@/server/session'

export const GET = route(async () => {
  const { db } = await session()
  return Response.json({ entries: await listAudit(db) })
})
