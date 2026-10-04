import { managerNotifications, markNotificationsRead } from '@/server/managerNotifications'
import { readJson, route } from '@/server/http'
import { session } from '@/server/session'
export const runtime = 'nodejs'
function privateRoute<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  const wrapped = route(handler)
  return async (...args: A) => {
    const response = await wrapped(...args)
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }
}
export const GET = privateRoute(async () => {
  const { db, user } = await session('kierownik')
  return Response.json(await managerNotifications(db, user.id))
})
export const PATCH = privateRoute(async (request: Request) => {
  const { db, user } = await session('kierownik')
  await markNotificationsRead(db, user.id, await readJson<unknown>(request))
  return Response.json(await managerNotifications(db, user.id))
})
