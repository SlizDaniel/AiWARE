import { actorOf } from '@/server/auth'
import { bumpDataVersion } from '@/server/db'
import { listMapPaths, parseMapPathInput, saveMapPath } from '@/server/mapPaths'
import { readJson, route } from '@/server/http'
import { session } from '@/server/session'

export const GET = route(async () => {
  const { db } = await session()
  return Response.json({ paths: await listMapPaths(db) })
})

// Ścieżkę nagrywa każdy zalogowany (zwykle pracownik z telefonem); karta zmiany
// nie jest potrzebna — zapis i tak trafia do audytu.
export const POST = route(async (request: Request) => {
  const input = parseMapPathInput(await readJson(request))
  const { db, user } = await session()
  const path = await saveMapPath(db, input, actorOf(user))
  await bumpDataVersion(db)
  return Response.json({ path }, { status: 201 })
})
