import { actorOf } from '@/server/auth'
import { bumpDataVersion, updateItem, type Item } from '@/server/db'
import { HttpError, route, readJson, intParam } from '@/server/http'
import { session } from '@/server/session'

const FIELDS = ['name', 'quantity', 'minimum', 'unit', 'location'] as const
type Field = (typeof FIELDS)[number]

function validateChanges(input: unknown): Partial<Pick<Item, Field>> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(422, 'Oczekiwano danych produktu.')
  const record = input as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length === 0 || keys.some((key) => !FIELDS.includes(key as Field))) throw new HttpError(422, 'Wybierz pola produktu do zapisania.')
  const result: Partial<Pick<Item, Field>> = {}
  for (const key of keys as Field[]) {
    const value = record[key]
    if (key === 'name' || key === 'unit' || key === 'location') {
      if (typeof value !== 'string') throw new HttpError(422, `Pole „${key}” musi być tekstem.`)
      const trimmed = value.trim()
      const max = key === 'name' ? 200 : 100
      if ((key === 'name' && !trimmed) || trimmed.length > max) throw new HttpError(422, `Nieprawidłowa wartość pola „${key}”.`)
      result[key] = trimmed
    } else {
      if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 2_147_483_647) {
        throw new HttpError(422, `Pole „${key}” musi być nieujemną liczbą całkowitą.`)
      }
      result[key] = value as number
    }
  }
  return result
}

export const PATCH = route(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const id = intParam((await context.params).id)
  const { db, user } = await session('kierownik')
  const item = await updateItem(db, id, validateChanges(await readJson<unknown>(request)), actorOf(user))
  await bumpDataVersion(db)
  return Response.json({ item })
})
