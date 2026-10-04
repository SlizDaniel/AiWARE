import { actorOf } from '@/server/auth'
import { bumpDataVersion } from '@/server/db'
import { unassignSectorItem } from '@/server/mapSectors'
import { intParam, route } from '@/server/http'
import { session } from '@/server/session'

export const DELETE = route(async (_request: Request, context: { params: Promise<{ id: string; itemId: string }> }) => {
  const params = await context.params
  const id = intParam(params.id)
  const itemId = intParam(params.itemId)
  const { db, user } = await session()
  const sector = await unassignSectorItem(db, id, itemId, actorOf(user))
  await bumpDataVersion(db)
  return Response.json({ sector })
})
