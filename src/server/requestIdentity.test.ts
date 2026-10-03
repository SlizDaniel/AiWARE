import { describe, expect, it, vi } from 'vitest'
import { requestIdentity } from './requestIdentity'

const identity = { id: 'alice', email: 'a@example.com', metadata: { name: 'Alicja' } }
const cookies = vi.fn(async () => identity)

describe('mobile request credentials', () => {
  it('preserves browser cookie authentication without an Authorization header', async () => {
    const verify = vi.fn()
    expect(await requestIdentity(null, verify, cookies)).toEqual(identity)
    expect(verify).not.toHaveBeenCalled()
  })

  it('passes the bearer token to verification and uses verified identity', async () => {
    const verify = vi.fn(async () => ({ data: { claims: { sub: 'bob', email: 'b@example.com', user_metadata: { name: 'Bob' } } }, error: null }))
    const readCookies = vi.fn()
    expect(await requestIdentity('Bearer signed-token', verify, readCookies)).toEqual({ id: 'bob', email: 'b@example.com', metadata: { name: 'Bob' } })
    expect(verify).toHaveBeenCalledWith('signed-token')
    expect(readCookies).not.toHaveBeenCalled()
  })

  it.each(['', 'Basic secret', 'Bearer ', 'Bearer token extra'])('rejects malformed credentials: %s', async (value) => {
    const verify = vi.fn()
    const readCookies = vi.fn()
    expect(await requestIdentity(value, verify, readCookies)).toBeNull()
    expect(verify).not.toHaveBeenCalled()
    expect(readCookies).not.toHaveBeenCalled()
  })

  it.each([
    { data: null, error: new Error('Expired') },
    { data: { claims: {} }, error: null },
    { data: { claims: { sub: 'anon', is_anonymous: true } }, error: null },
  ])('does not downgrade rejected bearer credentials to a cookie session', async (result) => {
    const readCookies = vi.fn()
    expect(await requestIdentity('Bearer bad-token', async () => result, readCookies)).toBeNull()
    expect(readCookies).not.toHaveBeenCalled()
  })
})
