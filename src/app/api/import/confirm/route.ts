import { actorOf } from '@/server/auth'
import { bumpDataVersion, deletePendingImport, getPendingImport, importItems } from '@/server/db'
import { HttpError, readJson, route } from '@/server/http'
import { FIELDS, ImportFileError, validateAndMapRows } from '@/server/inventory'
import { session } from '@/server/session'
import { getAppSettings } from '@/server/settings'
import type { ImportField } from '@/server/types'

/** Validates the user's selected mapping, then atomically upserts inventory. */
export const POST = route(async (request: Request) => {
  const { db, user } = await session('kierownik')
  const body = await readJson<{ import_id?: unknown; mapping?: unknown }>(request)
  if (typeof body.import_id !== 'string' || !body.mapping || typeof body.mapping !== 'object') {
    throw new HttpError(422, 'Brak identyfikatora importu albo mapowania kolumn.')
  }
  const pending = await getPendingImport(db, body.import_id)
  if (pending === null) throw new HttpError(404, 'Podgląd importu wygasł. Wczytaj plik ponownie.')

  const raw = body.mapping as Record<string, unknown>
  const mapping = {} as Record<ImportField, number | null>
  for (const field of FIELDS) {
    const value = raw[field]
    if (value !== undefined && value !== null && typeof value !== 'number') {
      throw new HttpError(422, `Nieprawidłowa kolumna dla pola „${field}”.`)
    }
    mapping[field] = (value as number | null | undefined) ?? null
  }

  let items
  try {
    items = validateAndMapRows(pending.headers, pending.rows, mapping)
  } catch (error) {
    if (error instanceof ImportFileError) throw new HttpError(422, error.message)
    throw error
  }
  const { default_minimum: defaultMinimum } = await getAppSettings(db)
  const result = await importItems(db, items, actorOf(user), { defaultMinimum })
  await deletePendingImport(db, body.import_id)
  await bumpDataVersion(db)
  return Response.json(result)
})
