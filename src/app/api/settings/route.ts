import { bumpDataVersion } from '@/server/db'
import { HttpError, readJson, route } from '@/server/http'
import { session } from '@/server/session'
import { settingsPayload, updateAppSettings } from '@/server/settings'

// Card 12: GET for everyone, partial updates for managers (PATCH like the legacy API; PUT kept as an alias).
export const GET = route(async () => {
  const { db } = await session()
  return Response.json(await settingsPayload(db))
})

const update = route(async (request: Request) => {
  const { db } = await session('kierownik')
  const patch = await readJson<unknown>(request)
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new HttpError(422, 'Oczekiwano obiektu ustawień.')
  await updateAppSettings(db, patch as Record<string, unknown>)
  await bumpDataVersion(db)
  return Response.json(await settingsPayload(db))
})

export const PATCH = update
export const PUT = update
