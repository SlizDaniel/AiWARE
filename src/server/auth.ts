// Authentication + roles. Supabase Auth proves who the user is; the `profiles`
// table (owned by the server, RLS without policies) says what they may do.
// Route handlers call requireUser(db, role?) — authorization lives here, not in RLS.
import { authMode, supabaseConfig } from './env'
import { requestIdentity } from './requestIdentity'
import { HttpError } from './http'
import { tsText, type Db } from './sql'
import type { AppUser, Role } from './types'

// ------------------------------------------------------------------ messages

export const MSG_UNAUTHENTICATED = 'Zaloguj się, aby kontynuować.'
export const MSG_FORBIDDEN = 'Brak uprawnień — ta akcja wymaga roli kierownika.'
export const MSG_MISCONFIGURED =
  'Logowanie nie jest skonfigurowane — ustaw NEXT_PUBLIC_SUPABASE_URL i NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (albo AUTH_DISABLED=1).'
export const MSG_LAST_MANAGER = 'Musi zostać co najmniej jeden kierownik.'

// ---------------------------------------------------------------- local user

/** Acting user when AUTH_DISABLED=1 (or dev without Supabase keys). */
export const LOCAL_USER: Readonly<AppUser> = Object.freeze({
  id: '00000000-0000-0000-0000-000000000001',
  email: 'lokalny@magazynier.local',
  display_name: 'Kierownik (bez logowania)',
  role: 'kierownik',
})

const ROLES: readonly Role[] = ['pracownik', 'kierownik']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Serialises first-login bootstrap and role changes (ensureSchema uses 724242).
const PROFILES_LOCK = 724243

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

// ------------------------------------------------------------ session reader

/** Identity proven by the auth provider (verified JWT claims). */
export type SessionIdentity = {
  id: string
  email: string
  metadata: Record<string, unknown>
}

export type SessionReader = () => Promise<SessionIdentity | null>

/** Verifies explicit mobile bearer credentials, or the browser cookie session. */
async function readSupabaseSession(): Promise<SessionIdentity | null> {
  const { headers } = await import('next/headers')
  const authorization = (await headers()).get('authorization')
  return requestIdentity(authorization, async (token) => {
    const config = supabaseConfig()
    if (!config) return { data: null, error: new Error('Supabase nie jest skonfigurowany.') }
    const { createClient } = await import('@supabase/supabase-js')
    const client = createClient(config.url, config.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    return client.auth.getClaims(token)
  }, readCookieSession)
}

async function readCookieSession(): Promise<SessionIdentity | null> {
  // Imported lazily so tests (and non-request code) never load next/headers.
  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (error || !claims?.sub || claims.is_anonymous === true) return null
  return {
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : '',
    metadata: (claims.user_metadata ?? {}) as Record<string, unknown>,
  }
}

let sessionReader: SessionReader = readSupabaseSession

/** Test seam: replace the Supabase session reader; pass null to restore it. */
export function setSessionReader(reader: SessionReader | null): void {
  sessionReader = reader ?? readSupabaseSession
}

// ------------------------------------------------------------------ profiles

type ProfileRow = { id: string; email: string; display_name: string; role: string }

const PROFILE_COLUMNS = 'user_id::text AS id, email, display_name, role'

function toAppUser(row: ProfileRow): AppUser {
  return { id: row.id, email: row.email, display_name: row.display_name, role: isRole(row.role) ? row.role : 'pracownik' }
}

function displayNameFor(identity: SessionIdentity): string {
  for (const key of ['full_name', 'name', 'display_name']) {
    const value = identity.metadata[key]
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 120)
  }
  const local = identity.email.split('@')[0]?.trim()
  return local || 'Użytkownik'
}

async function ensureLocalUser(db: Db): Promise<AppUser> {
  await db.query(
    `INSERT INTO profiles (user_id, email, display_name, role) VALUES ($1, $2, $3, 'kierownik')
     ON CONFLICT (user_id) DO NOTHING`,
    [LOCAL_USER.id, LOCAL_USER.email, LOCAL_USER.display_name],
  )
  return { ...LOCAL_USER }
}

/**
 * Returns the profile of an authenticated identity, creating it on first login:
 * the very first real account becomes kierownik, everyone after that pracownik.
 * The advisory lock makes two simultaneous first logins agree on who was first.
 */
async function ensureProfile(db: Db, identity: SessionIdentity): Promise<AppUser> {
  const [existing] = await db.query<ProfileRow>(`SELECT ${PROFILE_COLUMNS} FROM profiles WHERE user_id = $1`, [identity.id])
  if (existing) {
    if (identity.email && existing.email !== identity.email) {
      await db.query('UPDATE profiles SET email = $2 WHERE user_id = $1', [identity.id, identity.email])
      existing.email = identity.email
    }
    return toAppUser(existing)
  }

  const row = await db.transaction(async (tx) => {
    await tx.query(`SELECT pg_advisory_xact_lock(${PROFILES_LOCK})`)
    const [again] = await tx.query<ProfileRow>(`SELECT ${PROFILE_COLUMNS} FROM profiles WHERE user_id = $1`, [identity.id])
    if (again) return again
    const [{ taken }] = await tx.query<{ taken: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM profiles WHERE user_id <> $1) AS taken',
      [LOCAL_USER.id],
    )
    const role: Role = taken ? 'pracownik' : 'kierownik'
    const [created] = await tx.query<ProfileRow>(
      `INSERT INTO profiles (user_id, email, display_name, role) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE
         SET email = CASE WHEN EXCLUDED.email <> '' THEN EXCLUDED.email ELSE profiles.email END
       RETURNING ${PROFILE_COLUMNS}`,
      [identity.id, identity.email, displayNameFor(identity), role],
    )
    return created
  })
  return toAppUser(row)
}

// ---------------------------------------------------------------------- API

/** Current user, or null when logged out. Disabled auth → the local kierownik. */
export async function getCurrentUser(db: Db): Promise<AppUser | null> {
  const mode = authMode()
  if (mode === 'disabled') return ensureLocalUser(db)
  if (mode === 'misconfigured') return null
  const identity = await sessionReader()
  if (!identity || !UUID_RE.test(identity.id)) return null
  return ensureProfile(db, identity)
}

/** Current user or HttpError 503 / 401 / 403 (role 'kierownik' required). */
export async function requireUser(db: Db, role?: Role): Promise<AppUser> {
  if (authMode() === 'misconfigured') throw new HttpError(503, MSG_MISCONFIGURED)
  const user = await getCurrentUser(db)
  if (!user) throw new HttpError(401, MSG_UNAUTHENTICATED)
  if (role === 'kierownik' && user.role !== 'kierownik') throw new HttpError(403, MSG_FORBIDDEN)
  return user
}

export type AuditActor = { name: string; id: string }

/** Audit-log actor for writes made by `user`. */
export function actorOf(user: AppUser): AuditActor {
  return { name: user.display_name || user.email, id: user.id }
}

export type UserListEntry = AppUser & { created_at: string }

/** All accounts, oldest first. The local placeholder is shown only while auth is disabled. */
export async function listUsers(db: Db): Promise<UserListEntry[]> {
  const hideLocal = authMode() !== 'disabled'
  const rows = await db.query<ProfileRow & { created_at: string }>(
    `SELECT ${PROFILE_COLUMNS}, ${tsText('created_at')}
       FROM profiles
      WHERE NOT ($1::boolean AND user_id = $2::uuid)
      ORDER BY profiles.created_at, email`,
    [hideLocal, LOCAL_USER.id],
  )
  return rows.map((row) => ({ ...toAppUser(row), created_at: row.created_at }))
}

/** Changes a user's role (kierownik-only route). 404 / 409 / 422 as HttpError. */
export async function setUserRole(db: Db, userId: string, role: unknown): Promise<UserListEntry> {
  if (!isRole(role)) throw new HttpError(422, 'Nieprawidłowa rola — dozwolone: pracownik, kierownik.')
  if (!UUID_RE.test(userId)) throw new HttpError(404, 'Nie ma takiego użytkownika.')
  if (userId.toLowerCase() === LOCAL_USER.id) {
    throw new HttpError(409, 'Nie można zmienić roli użytkownika lokalnego (tryb bez logowania).')
  }

  return db.transaction(async (tx) => {
    await tx.query(`SELECT pg_advisory_xact_lock(${PROFILES_LOCK})`)
    const [target] = await tx.query<ProfileRow>(`SELECT ${PROFILE_COLUMNS} FROM profiles WHERE user_id = $1`, [userId])
    if (!target) throw new HttpError(404, 'Nie ma takiego użytkownika.')

    if (target.role === 'kierownik' && role !== 'kierownik') {
      const [{ others }] = await tx.query<{ others: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM profiles WHERE role = 'kierownik' AND user_id <> $1 AND user_id <> $2
         ) AS others`,
        [userId, LOCAL_USER.id],
      )
      if (!others) throw new HttpError(409, MSG_LAST_MANAGER)
    }

    const [row] = await tx.query<ProfileRow & { created_at: string }>(
      `UPDATE profiles SET role = $2 WHERE user_id = $1 RETURNING ${PROFILE_COLUMNS}, ${tsText('created_at')}`,
      [userId, role],
    )
    return { ...toAppUser(row), created_at: row.created_at }
  })
}
