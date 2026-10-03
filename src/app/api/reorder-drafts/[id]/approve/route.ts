import { actorOf } from '@/server/auth'
import { bumpDataVersion, decideReorderDraft } from '@/server/db'
import { HttpError, intParam, route } from '@/server/http'
import { session } from '@/server/session'

export const POST = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const id = intParam((await context.params).id)
  const { db, user } = await session('kierownik')
  const draft = await decideReorderDraft(db, id, 'approved', actorOf(user))
  if (draft === null) throw new HttpError(404, 'Szkic nie istnieje albo został już rozpatrzony')
  await bumpDataVersion(db)
  return Response.json({ approved: true, sent_to_erp: false, draft })
})
