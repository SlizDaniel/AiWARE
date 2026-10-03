import { dashboardRange, dashboardSummary } from '@/server/dashboard'
import { route } from '@/server/http'
import { session } from '@/server/session'

export const runtime = 'nodejs'
export const GET = route(async (request: Request) => {
  const { db } = await session('kierownik')
  const range = dashboardRange(new URL(request.url).searchParams)
  return Response.json(await dashboardSummary(db, range), { headers: { 'Cache-Control': 'private, no-store' } })
})
