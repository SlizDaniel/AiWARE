import { listAudit } from '@/server/db'
import { route } from '@/server/http'
import { session } from '@/server/session'

const HISTORY_LIMIT = 200

export const GET = route(async () => {
  const { db } = await session()
  // The newest entries only; the manager dashboard pages through the full log.
  return Response.json({ entries: await listAudit(db, HISTORY_LIMIT) })
})
