import { privateRoute } from '@/server/privateRoute'
import { managerNotifications, markNotificationsRead } from '@/server/managerNotifications'
import { readJson } from '@/server/http'
import { session } from '@/server/session'
export const runtime = 'nodejs'
export const GET = privateRoute(async () => {
  const { db, user } = await session('kierownik')
  return Response.json(await managerNotifications(db, user.id))
})
export const PATCH = privateRoute(async (request: Request) => {
  const { db, user } = await session('kierownik')
  await markNotificationsRead(db, user.id, await readJson<unknown>(request))
  return Response.json(await managerNotifications(db, user.id))
})
