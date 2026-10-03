import { actorOf } from '@/server/auth'
import { bumpDataVersion, undoAuditEntry } from '@/server/db'
import { intParam, route } from '@/server/http'
import { session } from '@/server/session'

export const POST = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const id = intParam((await context.params).id)
  const { db, user } = await session('kierownik')
  const result = await undoAuditEntry(db, id, actorOf(user))
  await bumpDataVersion(db)
  return Response.json(result)
})
