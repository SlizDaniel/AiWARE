import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LOCAL_USER,
  MSG_FORBIDDEN,
  MSG_LAST_MANAGER,
  MSG_MISCONFIGURED,
  MSG_PENDING,
  MSG_UNAUTHENTICATED,
  actorOf,
  getCurrentUser,
  listUsers,
  requireUser,
  resetLocalUserCache,
  setSessionReader,
  setUserRole,
  type SessionIdentity,
} from './auth'
import { HttpError } from './http'
import { createPgliteDb, ensureSchema, type Db } from './sql'

const ALICE: SessionIdentity = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'alicja@firma.pl',
  metadata: { full_name: 'Alicja Nowak' },
}
const BOB: SessionIdentity = { id: '22222222-2222-4222-8222-222222222222', email: 'bob@firma.pl', metadata: {} }
const CARL: SessionIdentity = {
  id: '33333333-3333-4333-8333-333333333333',
  email: 'carl@firma.pl',
  metadata: { name: 'Karol' },
}

let db: Db
let current: SessionIdentity | null = null

function useSupabaseMode() {
  vi.stubEnv('AUTH_DISABLED', '')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
}

function useDisabledMode() {
  vi.stubEnv('AUTH_DISABLED', '1')
}

function useMisconfiguredMode() {
  vi.stubEnv('AUTH_DISABLED', '')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
  vi.stubEnv('SUPABASE_URL', '')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
  vi.stubEnv('SUPABASE_ANON_KEY', '')
  vi.stubEnv('NODE_ENV', 'production')
}

/** Logs `identity` in and returns the resulting app user. */
async function login(identity: SessionIdentity) {
  current = identity
  const user = await getCurrentUser(db)
  if (!user) throw new Error('expected a user')
  return user
}

async function expectHttpError(promise: Promise<unknown>, status: number, detail?: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(HttpError)
  expect((error as HttpError).status).toBe(status)
  if (detail) expect((error as HttpError).detail).toBe(detail)
}

beforeAll(async () => {
  db = await createPgliteDb(null)
  await ensureSchema(db)
  setSessionReader(async () => current)
})

afterAll(() => {
  setSessionReader(null)
})

beforeEach(async () => {
  await db.exec('DELETE FROM profiles')
  resetLocalUserCache()
  current = null
  useSupabaseMode()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('profile bootstrap', () => {
  it('makes the first account kierownik and later ones wait for approval', async () => {
    const alice = await login(ALICE)
    expect(alice).toEqual({ id: ALICE.id, email: ALICE.email, display_name: 'Alicja Nowak', role: 'kierownik' })

    const bob = await login(BOB)
    expect(bob).toEqual({ id: BOB.id, email: BOB.email, display_name: 'bob', role: 'oczekujacy' })

    expect((await login(CARL)).display_name).toBe('Karol')
    // A second request keeps the stored role.
    expect((await login(ALICE)).role).toBe('kierownik')
    expect((await login(BOB)).role).toBe('oczekujacy')
  })

  it('agrees on a single kierownik when two first logins race', async () => {
    current = null
    const readers = [ALICE, BOB]
    setSessionReader(async () => readers.shift() ?? null)
    try {
      const users = await Promise.all([getCurrentUser(db), getCurrentUser(db)])
      expect(users.map((user) => user?.role).sort()).toEqual(['kierownik', 'oczekujacy'])
    } finally {
      setSessionReader(async () => current)
    }
    const rows = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM profiles WHERE role = 'kierownik'")
    expect(rows[0].n).toBe(1)
  })

  it('handles concurrent first requests of the same user', async () => {
    current = ALICE
    const users = await Promise.all([getCurrentUser(db), getCurrentUser(db), getCurrentUser(db)])
    expect(users.every((user) => user?.role === 'kierownik')).toBe(true)
    expect((await db.query('SELECT 1 FROM profiles')).length).toBe(1)
  })

  it('keeps the e-mail address in sync with the auth provider', async () => {
    await login(ALICE)
    const changed = await login({ ...ALICE, email: 'alicja.nowak@firma.pl' })
    expect(changed.email).toBe('alicja.nowak@firma.pl')
    expect(changed.role).toBe('kierownik')
    const [row] = await db.query<{ email: string }>('SELECT email FROM profiles WHERE user_id = $1', [ALICE.id])
    expect(row.email).toBe('alicja.nowak@firma.pl')
  })

  it('ignores the local no-login profile when picking the first kierownik', async () => {
    useDisabledMode()
    await getCurrentUser(db)
    useSupabaseMode()
    expect((await login(ALICE)).role).toBe('kierownik')
  })

  it('treats a missing session or a malformed subject as logged out', async () => {
    current = null
    expect(await getCurrentUser(db)).toBeNull()
    current = { id: 'not-a-uuid', email: 'x@y.pl', metadata: {} }
    expect(await getCurrentUser(db)).toBeNull()
  })
})

describe('auth modes', () => {
  it('acts as the local kierownik when auth is disabled', async () => {
    useDisabledMode()
    const user = await getCurrentUser(db)
    expect(user).toEqual(LOCAL_USER)
    expect(await requireUser(db, 'kierownik')).toEqual(LOCAL_USER)
    const rows = await db.query<{ role: string; email: string }>('SELECT role, email FROM profiles WHERE user_id = $1', [
      LOCAL_USER.id,
    ])
    expect(rows).toEqual([{ role: 'kierownik', email: LOCAL_USER.email }])
    // Idempotent.
    await getCurrentUser(db)
    expect((await db.query('SELECT 1 FROM profiles')).length).toBe(1)
  })

  it('is disabled in development without Supabase keys', async () => {
    useMisconfiguredMode()
    vi.stubEnv('NODE_ENV', 'development')
    expect(await getCurrentUser(db)).toEqual(LOCAL_USER)
  })

  it('refuses with 503 in production without Supabase keys', async () => {
    useMisconfiguredMode()
    expect(await getCurrentUser(db)).toBeNull()
    await expectHttpError(requireUser(db), 503, MSG_MISCONFIGURED)
  })
})

describe('requireUser', () => {
  it('answers 401 when logged out', async () => {
    await expectHttpError(requireUser(db), 401, MSG_UNAUTHENTICATED)
    await expectHttpError(requireUser(db, 'kierownik'), 401, MSG_UNAUTHENTICATED)
  })

  it('blocks a pending account until a kierownik approves it', async () => {
    await login(ALICE)
    current = BOB
    await expectHttpError(requireUser(db), 403, MSG_PENDING)
    expect((await requireUser(db, undefined, { allowPending: true })).role).toBe('oczekujacy')
    await setUserRole(db, BOB.id, 'pracownik')
    expect((await requireUser(db)).role).toBe('pracownik')
    await setUserRole(db, BOB.id, 'oczekujacy')
    await expectHttpError(requireUser(db), 403, MSG_PENDING)
  })

  it('answers 403 when a pracownik needs kierownik', async () => {
    await login(ALICE)
    current = BOB
    await login(BOB)
    await setUserRole(db, BOB.id, 'pracownik')
    current = BOB
    expect((await requireUser(db)).role).toBe('pracownik')
    expect((await requireUser(db, 'pracownik')).id).toBe(BOB.id)
    await expectHttpError(requireUser(db, 'kierownik'), 403, MSG_FORBIDDEN)
    current = ALICE
    expect((await requireUser(db, 'kierownik')).id).toBe(ALICE.id)
  })
})

describe('user management', () => {
  it('lists users oldest first with formatted created_at', async () => {
    await login(ALICE)
    await login(BOB)
    const users = await listUsers(db)
    expect(users.map(({ id, role }) => ({ id, role }))).toEqual([
      { id: ALICE.id, role: 'kierownik' },
      { id: BOB.id, role: 'oczekujacy' },
    ])
    expect(users[0]).toMatchObject({ email: ALICE.email, display_name: 'Alicja Nowak' })
    for (const user of users) expect(user.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('shows the local profile only while auth is disabled', async () => {
    useDisabledMode()
    await getCurrentUser(db)
    expect((await listUsers(db)).map((user) => user.id)).toEqual([LOCAL_USER.id])
    useSupabaseMode()
    await login(ALICE)
    expect((await listUsers(db)).map((user) => user.id)).toEqual([ALICE.id])
  })

  it('promotes and demotes while keeping at least one kierownik', async () => {
    await login(ALICE)
    await login(BOB)

    await expectHttpError(setUserRole(db, ALICE.id, 'pracownik'), 409, MSG_LAST_MANAGER)

    const promoted = await setUserRole(db, BOB.id, 'kierownik')
    expect(promoted).toMatchObject({ id: BOB.id, role: 'kierownik', email: BOB.email })
    expect(promoted.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)

    expect((await setUserRole(db, ALICE.id, 'pracownik')).role).toBe('pracownik')
    await expectHttpError(setUserRole(db, BOB.id, 'pracownik'), 409, MSG_LAST_MANAGER)
    // Same role again is a no-op, not an error.
    expect((await setUserRole(db, BOB.id, 'kierownik')).role).toBe('kierownik')

    // The new role applies on the next request.
    current = ALICE
    await expectHttpError(requireUser(db, 'kierownik'), 403, MSG_FORBIDDEN)
  })

  it('does not count the local profile as the remaining kierownik', async () => {
    useDisabledMode()
    await getCurrentUser(db)
    useSupabaseMode()
    await login(ALICE)
    await expectHttpError(setUserRole(db, ALICE.id, 'pracownik'), 409, MSG_LAST_MANAGER)
    await expectHttpError(setUserRole(db, LOCAL_USER.id, 'pracownik'), 409)
  })

  it('rejects unknown users and invalid roles', async () => {
    await login(ALICE)
    await expectHttpError(setUserRole(db, CARL.id, 'kierownik'), 404)
    await expectHttpError(setUserRole(db, 'nope', 'kierownik'), 404)
    await expectHttpError(setUserRole(db, ALICE.id, 'admin'), 422)
    await expectHttpError(setUserRole(db, ALICE.id, undefined), 422)
  })
})

describe('actorOf', () => {
  it('uses the display name, falling back to the e-mail', () => {
    expect(actorOf({ id: ALICE.id, email: ALICE.email, display_name: 'Alicja Nowak', role: 'kierownik' })).toEqual({
      name: 'Alicja Nowak',
      id: ALICE.id,
    })
    expect(actorOf({ id: BOB.id, email: BOB.email, display_name: '', role: 'pracownik' })).toEqual({
      name: BOB.email,
      id: BOB.id,
    })
  })
})
