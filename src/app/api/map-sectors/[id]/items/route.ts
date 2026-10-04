import { actorOf } from '@/server/auth'
import { bumpDataVersion } from '@/server/db'
import { assignSectorItem, parseSectorAssignment } from '@/server/mapSectors'
import { intParam, readJson, route } from '@/server/http'
import { session } from '@/server/session'

/** Przypisz przedmiot do sektora (lub zmień jego ilość) — rozmieszczenie, nie stan. */
export const PUT = route(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const id = intParam((await context.params).id)
  const assignment = parseSectorAssignment(await readJson(request))
  const { db, user } = await session()
  const sector = await assignSectorItem(db, id, assignment, actorOf(user))
  await bumpDataVersion(db)
  return Response.json({ sector })
})
