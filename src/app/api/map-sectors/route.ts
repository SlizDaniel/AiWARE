import { actorOf } from '@/server/auth'
import { bumpDataVersion } from '@/server/db'
import { listMapSectors, parseMapSectorInput, saveMapSector } from '@/server/mapSectors'
import { readJson, route } from '@/server/http'
import { session } from '@/server/session'

export const GET = route(async () => {
  const { db } = await session()
  return Response.json({ sectors: await listMapSectors(db) })
})

export const POST = route(async (request: Request) => {
  const input = parseMapSectorInput(await readJson(request))
  const { db, user } = await session()
  const sector = await saveMapSector(db, input, actorOf(user))
  await bumpDataVersion(db)
  return Response.json({ sector }, { status: 201 })
})
