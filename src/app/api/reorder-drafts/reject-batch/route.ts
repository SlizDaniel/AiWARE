import { actorOf } from '@/server/auth'
import { rejectReorderDrafts } from '@/server/db'
import { HttpError, readJson, route } from '@/server/http'
import { session } from '@/server/session'

export const POST = route(async (request: Request) => {
  const { db, user } = await session('kierownik')
  const { draft_ids: ids } = await readJson<{ draft_ids?: unknown }>(request)
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1000 ||
    ids.some(id => typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || id > 2147483647)) {
    throw new HttpError(422, 'Podaj od 1 do 1000 poprawnych identyfikatorów szkiców.')
  }
  return Response.json(await rejectReorderDrafts(db, ids, actorOf(user)))
})
