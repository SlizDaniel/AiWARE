import { bumpDataVersion } from '@/server/db'
import { resetDemoDb } from '@/server/demo'
import { isDemoMode } from '@/server/env'
import { HttpError, route } from '@/server/http'
import { session } from '@/server/session'

// Fresh rehearsal without a shell (Vercel): only in DEMO_MODE, only for managers.
export const POST = route(async () => {
  if (!isDemoMode()) throw new HttpError(409, 'Reset jest dostępny tylko w trybie demo (DEMO_MODE=1).')
  const { db } = await session('kierownik')
  await resetDemoDb(db)
  await bumpDataVersion(db)
  return Response.json({ reset: true })
})
