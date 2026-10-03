import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { POST } from '@/app/api/stt/route'
import { initDb, listAudit, listItems } from '@/server/db'
import { updateAppSettings } from '@/server/settings'
import { createPgliteDb, type Db } from '@/server/sql'

let db: Db
const store = globalThis as typeof globalThis & { __magazynierDb?: Promise<Db> }
beforeAll(async () => {
  db = await createPgliteDb(null)
  await initDb(db)
  await db.query("UPDATE items SET name = 'Bułki' WHERE id = 1")
  await updateAppSettings(db, { voice_mode: 'push_to_talk' })
  store.__magazynierDb = Promise.resolve(db)
})
beforeEach(async () => {
  vi.stubEnv('AUTH_DISABLED', '1')
  vi.stubEnv('DEMO_MODE', '0')
  vi.stubEnv('STT_API_KEY', '')
  vi.stubEnv('GEMINI_API_KEY', 'synthetic-test-key')
  vi.stubEnv('GEMINI_STT_MODEL', 'gemini-3.5-flash-lite')
  await db.exec('DELETE FROM rate_limits')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
afterAll(() => { store.__magazynierDb = undefined })

function recognise(text: string) {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }],
  })))
  return POST(new Request('http://warehouse.test/api/stt', {
    method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: new Uint8Array([1, 2, 3]),
  }))
}

test('STT suggests the known name, keeps the original and writes no inventory/audit', async () => {
  const before = await listItems(db)
  const response = await recognise('Magu, ile mamy półki?')
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    text: 'Magu, ile mamy Bułki?', original_text: 'Magu, ile mamy półki?',
    corrections: [{ heard: 'półki', name: 'Bułki' }],
  })
  expect(await listItems(db)).toEqual(before)
  expect(await listAudit(db)).toEqual([])
})

test('STT keeps a matching transcript and the previous text-only response contract', async () => {
  const response = await recognise('Magu, ile mamy Bułki?')
  expect(await response.json()).toEqual({ text: 'Magu, ile mamy Bułki?' })
})
