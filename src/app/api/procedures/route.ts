import { actorOf } from '@/server/auth'
import { proposePackingRule } from '@/server/commands'
import { listPackingRules } from '@/server/packing'
import { HttpError, readJson, route } from '@/server/http'
import { session } from '@/server/session'

export const GET = route(async () => {
  const { db } = await session()
  return Response.json({ procedures: await listPackingRules(db) })
})

export const POST = route(async (request: Request) => {
  const { db, user } = await session('kierownik')
  const body = await readJson<Record<string, unknown>>(request)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(422, 'Nieprawidłowa reguła.')
  return Response.json({ proposal: await proposePackingRule(db, body, actorOf(user), user.role) })
})
