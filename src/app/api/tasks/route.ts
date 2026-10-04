import { createWorkTask, ensureWorkTasksSchema, listWorkTasks } from '@/server/workTasks'
import { readJson } from '@/server/http'
import { privateRoute } from '@/server/privateRoute'
import { session } from '@/server/session'
export const runtime = 'nodejs'
export const GET = privateRoute(async (request: Request) => {
  const { db,user } = await session()
  await ensureWorkTasksSchema(db)
  return Response.json(await listWorkTasks(db,user,new URL(request.url).searchParams))
})
export const POST = privateRoute(async (request: Request) => {
  const { db,user } = await session('kierownik')
  await ensureWorkTasksSchema(db)
  return Response.json(await createWorkTask(db,user,await readJson<unknown>(request)),{status:201})
})
