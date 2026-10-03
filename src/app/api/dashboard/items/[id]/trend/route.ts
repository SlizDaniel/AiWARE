import { positiveInt } from '@/server/dashboard'
import { stockTrend } from '@/server/dashboardReports'
import { route } from '@/server/http'
import { session } from '@/server/session'

export const runtime = 'nodejs'
export const GET = route(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const { db } = await session('kierownik')
  const { id } = await context.params
  return Response.json(await stockTrend(db, positiveInt(id, 'id', 2_147_483_647), new URL(request.url).searchParams), { headers: { 'Cache-Control': 'private, no-store' } })
})
