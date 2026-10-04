import { actorOf } from '@/server/auth'
import { bumpDataVersion } from '@/server/db'
import { HttpError, readJson, route } from '@/server/http'
import { linkPackaging, listPackaging } from '@/server/packing'
import { session } from '@/server/session'

export const GET = route(async () => {
  const { db } = await session()
  return Response.json({ packaging: await listPackaging(db) })
})

export const PATCH = route(async (request: Request) => {
  const { db, user } = await session('kierownik')
  const body = await readJson<{ id?: unknown; inventory_item_id?: unknown }>(request)
  if (!body || typeof body.id !== 'number' || !Number.isSafeInteger(body.id) || body.id < 1) throw new HttpError(422, 'Nieprawidłowe opakowanie.')
  await linkPackaging(db, body.id, body.inventory_item_id, actorOf(user))
  await bumpDataVersion(db)
  return Response.json({ packaging: await listPackaging(db) })
})
