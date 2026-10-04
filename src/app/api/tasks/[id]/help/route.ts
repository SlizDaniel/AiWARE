import { privateRoute } from '@/server/privateRoute'
import { session } from '@/server/session'
import { ensureWorkTasksSchema } from '@/server/workTasks'
import { taskHelp } from '@/server/taskHelp'
export const runtime = 'nodejs'
export const maxDuration = 30
export const POST = privateRoute(async (_request: Request, context: {params:Promise<{id:string}>}) => {
  const {db,user} = await session()
  await ensureWorkTasksSchema(db)
  return Response.json(await taskHelp(db,user,(await context.params).id))
})
