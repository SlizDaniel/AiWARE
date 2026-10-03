import { activityOptions, dashboardActivity, dashboardRange } from '@/server/dashboard'
import { route } from '@/server/http'
import { session } from '@/server/session'

export const runtime = 'nodejs'
export const GET = route(async (request: Request) => {
  const { db } = await session('kierownik')
  const query = new URL(request.url).searchParams
  return Response.json(await dashboardActivity(db, dashboardRange(query), activityOptions(query)), { headers: { 'Cache-Control': 'private, no-store' } })
})
