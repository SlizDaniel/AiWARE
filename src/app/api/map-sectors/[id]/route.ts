import { actorOf } from '@/server/auth'
import { bumpDataVersion } from '@/server/db'
import { deleteMapSector } from '@/server/mapSectors'
import { intParam, route } from '@/server/http'
import { session } from '@/server/session'

export const DELETE = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const id = intParam((await context.params).id)
  const { db, user } = await session('kierownik')
  await deleteMapSector(db, id, actorOf(user))
  await bumpDataVersion(db)
  return Response.json({ deleted: id })
})
