import { ensureWorkTasksSchema, updateWorkTask } from '@/server/workTasks'
import { readJson } from '@/server/http'
import { privateRoute } from '@/server/privateRoute'
import { session } from '@/server/session'
export const runtime = 'nodejs'
export const PATCH = privateRoute(async (request: Request, context: {params: Promise<{id:string}>}) => {
  const { db,user } = await session()
  await ensureWorkTasksSchema(db)
  await updateWorkTask(db,user,(await context.params).id,await readJson<unknown>(request))
  return Response.json({ok:true})
})
