import { activityCsv } from '@/server/dashboardReports'
import { route } from '@/server/http'
import { session } from '@/server/session'

export const runtime = 'nodejs'
export const GET = route(async (request: Request) => {
  const { db } = await session('kierownik')
  return new Response(await activityCsv(db, new URL(request.url).searchParams), { headers: {
    'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="dashboard-activity.csv"', 'Cache-Control': 'private, no-store',
  } })
})
