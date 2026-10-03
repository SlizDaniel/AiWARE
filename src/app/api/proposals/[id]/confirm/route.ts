import { actorOf } from '@/server/auth'
import { confirmProposal } from '@/server/commands'
import { bumpDataVersion } from '@/server/db'
import { route } from '@/server/http'
import { session } from '@/server/session'

// Confirm-before-write: the only place where agent proposals touch the data.
export const POST = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params
  const { db, user } = await session()
  const payload = await confirmProposal(db, id, actorOf(user))
  await bumpDataVersion(db)
  return Response.json(payload)
})
