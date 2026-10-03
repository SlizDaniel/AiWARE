import { shiftSummary } from '@/server/dashboardReports'
import { route } from '@/server/http'
import { session } from '@/server/session'

export const runtime = 'nodejs'
export const GET = route(async (request: Request) => {
  const { db } = await session('kierownik')
  return Response.json(await shiftSummary(db, new URL(request.url).searchParams), { headers: { 'Cache-Control': 'private, no-store' } })
})
