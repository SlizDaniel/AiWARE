// Common preamble of every API route: open the database and authenticate.
import { requireUser } from './auth'
import { getDb } from './runtime'
import type { Db } from './sql'
import type { AppUser, Role } from './types'

export async function session(role?: Role): Promise<{ db: Db; user: AppUser }> {
  const db = await getDb()
  const user = await requireUser(db, role)
  return { db, user }
}
