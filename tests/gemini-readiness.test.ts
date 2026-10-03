import { describe, expect, it, vi } from 'vitest'
import { interpretSample } from '../scripts/gemini-readiness-bridge'
import type { Interpretation, LLMProvider } from '@/server/types'

const request = { text: 'wzięliśmy cztery sztuki folii', context: 'Dane syntetyczne.', items: [{ id: 3, name: 'Folia stretch' }] }
function fake(result: Interpretation): LLMProvider {
  return { interpret: vi.fn().mockResolvedValue(result) }
}

describe('Python readiness adapter uses the production tool contract', () => {
  it('returns a normalized call without executing a tool or opening a database', async () => {
    const provider = fake({ toolCall: { name: 'update_stock', arguments: { item_id: 3, delta: -4 } }, clarification: null })
    expect(await interpretSample(request, provider)).toEqual({ kind: 'call', tool: 'update_stock', args: { item_id: 3, delta: -4 } })
    expect(provider.interpret).toHaveBeenCalledOnce()
    expect(provider.interpret).toHaveBeenCalledWith(request.text, expect.arrayContaining([expect.objectContaining({ function: expect.objectContaining({ name: 'update_stock' }) })]), request.context)
  })

  it.each([
    { name: 'unknown', arguments: {} },
    { name: 'update_stock', arguments: { item_id: 999, delta: -4 } },
    { name: 'update_stock', arguments: { item_id: 3, delta: 0 } },
    { name: 'update_stock', arguments: { item_id: 3, delta: true } },
    { name: 'update_stock', arguments: { item_id: 3, delta: -4, text: 'untrusted' } },
  ])('rejects invalid calls with the same validator as the app: %j', async (toolCall) => {
    expect(await interpretSample(request, fake({ toolCall, clarification: null }))).toEqual({ kind: 'error' })
  })

  it('does not return clarification text or provider errors to the report', async () => {
    expect(await interpretSample(request, fake({ toolCall: null, clarification: 'secret from model' }))).toEqual({ kind: 'clarification' })
    expect(await interpretSample(request, { interpret: vi.fn().mockRejectedValue(new Error('private-api-key')) })).toEqual({ kind: 'error' })
    expect(await interpretSample(request, fake({ toolCall: null, clarification: ' ' }))).toEqual({ kind: 'error' })
  })

  it.each([null, [], {}, { ...request, text: '' }, { ...request, text: 'x'.repeat(2001) }, { ...request, context: 'x'.repeat(10001) }])('rejects malformed input without calling the provider', async (input) => {
    const provider = fake({ toolCall: null, clarification: 'question' })
    expect(await interpretSample(input, provider)).toEqual({ kind: 'error' })
    expect(provider.interpret).not.toHaveBeenCalled()
  })

  it.each([[], [{ id: true, name: 'Folia' }], [{ id: 3, name: '' }], [{ id: 3, name: 'A' }, { id: 3, name: 'B' }]])('validates synthetic inventory from Python: %j', async (items) => {
    const provider = fake({ toolCall: null, clarification: 'question' })
    expect(await interpretSample({ ...request, items }, provider)).toEqual({ kind: 'error' })
    expect(provider.interpret).not.toHaveBeenCalled()
  })
})
