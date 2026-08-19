import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../http-client', () => ({ httpsRequestUrl: state.request, providerHttpError: (label: string, status: number) => new Error(`${label} ${status}`) }))

import { countProviderInputTokens } from '../token-counting'

describe('provider token preflight', () => {
  it('uses Anthropic count_tokens with converted payloads', async () => {
    state.request.mockResolvedValueOnce({ status: 200, data: JSON.stringify({ input_tokens: 42 }) })
    const result = await countProviderInputTokens({ providerName: 'anthropic', model: 'claude-sonnet-4', credential: 'test-key', messages: [{ role: 'system', content: 'Rules' }, { role: 'user', content: 'Hello' }], tools: [{ type: 'function', function: { name: 'lookup', description: 'Look up', parameters: { type: 'object' } } }] })
    expect(result).toMatchObject({ inputTokens: 42, quality: 'provider', source: 'anthropic' })
    expect(state.request).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages/count_tokens', expect.objectContaining({ method: 'POST' }), expect.stringContaining('lookup'), undefined)
  })

  it('returns null when preflight is unavailable', async () => {
    state.request.mockRejectedValueOnce(new Error('offline'))
    await expect(countProviderInputTokens({ providerName: 'openai', model: 'gpt-5-mini', credential: 'test-key', messages: [{ role: 'user', content: 'Hello' }], tools: [] })).resolves.toBeNull()
  })
})
