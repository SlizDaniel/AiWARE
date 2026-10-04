import { describe, expect, it } from 'vitest'
import { intParam, readJson, route } from './http'

describe('JSON API input boundaries', () => {
  it.each(['null', '[]', 'true', '42', '"command"', 'not-json'])('rejects %s with 422 instead of crashing handlers', async body => {
    const handler = route(async (request: Request) => {
      const input = await readJson<{text:string}>(request)
      return Response.json({ text: input.text })
    })
    expect((await handler(new Request('http://test/api/command', { method: 'POST', body }))).status).toBe(422)
  })
  it('keeps ordinary object bodies', async () => {
    expect(await readJson(new Request('http://test', { method: 'POST', body: '{"text":"ile mamy szkła?"}' }))).toEqual({text:'ile mamy szkła?'})
  })
  it.each(['0', '-1', '1.5', '9007199254740993', '999999999999999999999999'])('rejects an invalid or imprecise ID %s', value => {
    expect(() => intParam(value)).toThrow()
  })
})
