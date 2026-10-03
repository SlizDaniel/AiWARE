import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getCurrentUser, requireUser } from './auth'
import { createPgliteDb, ensureSchema, type Db } from './sql'

const mocks = vi.hoisted(() => ({ headers: new Headers(), bearerClaims: vi.fn(), cookieClaims: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => mocks.headers }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getClaims: mocks.bearerClaims } }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getClaims: mocks.cookieClaims } }) }))

let db: Db
beforeAll(async () => { db = await createPgliteDb(null); await ensureSchema(db) })
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

function configure() {
  vi.stubEnv('AUTH_DISABLED', '')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
  mocks.headers = new Headers({ Authorization: 'Bearer mobile-token' })
}

describe('Supabase mobile auth wiring', () => {
  it('verifies the supplied JWT before creating a profile and keeps server-owned roles', async () => {
    configure()
    mocks.bearerClaims.mockResolvedValue({ data: { claims: { sub: '11111111-1111-4111-8111-111111111111', email: 'a@example.com', user_metadata: { role: 'kierownik' } } }, error: null })
    expect((await getCurrentUser(db))?.role).toBe('kierownik')
    expect(mocks.bearerClaims).toHaveBeenCalledWith('mobile-token')
    mocks.bearerClaims.mockResolvedValue({ data: { claims: { sub: '22222222-2222-4222-8222-222222222222', email: 'b@example.com', user_metadata: { role: 'kierownik' } } }, error: null })
    await expect(requireUser(db, 'kierownik')).rejects.toMatchObject({ status: 403 })
    expect(mocks.cookieClaims).not.toHaveBeenCalled()
  })

  it('returns 401 for a rejected bearer token even when a cookie session exists', async () => {
    configure()
    mocks.bearerClaims.mockResolvedValue({ data: null, error: new Error('Invalid signature') })
    mocks.cookieClaims.mockResolvedValue({ data: { claims: { sub: '11111111-1111-4111-8111-111111111111' } }, error: null })
    await expect(requireUser(db)).rejects.toMatchObject({ status: 401 })
    expect(mocks.cookieClaims).not.toHaveBeenCalled()
  })

  it('retains browser cookie sessions when the request has no bearer credentials', async () => {
    configure(); mocks.headers = new Headers()
    mocks.cookieClaims.mockResolvedValue({ data: { claims: { sub: '11111111-1111-4111-8111-111111111111', email: 'a@example.com' } }, error: null })
    expect((await requireUser(db)).email).toBe('a@example.com')
    expect(mocks.bearerClaims).not.toHaveBeenCalled()
  })
})
