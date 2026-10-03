import { getDataVersion } from '@/server/db'
import { route } from '@/server/http'
import { session } from '@/server/session'

// Replaces the FastAPI WebSocket: clients poll this counter and refetch when it changes.
export const GET = route(async () => {
  const { db } = await session()
  return Response.json({ version: await getDataVersion(db) }, { headers: { 'Cache-Control': 'no-store' } })
})
