import { beforeEach, describe, expect, it, vi } from 'vitest'

// openai-provider pulls in the streaming/http layer transitively; stub electron and the HTTP
// transport so sendOpenAIWithTools can be exercised without real network calls.
vi.mock('electron', () => ({ app: { isPackaged: false } }))

const state = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../http-client', () => ({
  httpsRequestUrl: state.request,
  parseSseStream: vi.fn(),
  providerHttpError: (label: string, status: number) => new Error(`${label} ${status}`),
}))

import { sendOpenAIWithTools, sendOpenAIWithToolsResilient } from '../providers/openai-provider'

beforeEach(() => {
  state.request.mockReset()
})

function jsonResponse(body: Record<string, unknown>) {
  return { status: 200, data: JSON.stringify(body) }
}

describe('sendOpenAIWithTools empty-response detection', () => {
  it('reproduces the BYOK bug at the unit level before the fix would have existed: returns content:null silently', async () => {
    // This is what the endpoint actually sent back on the reported OpenRouter session: a forced
    // final answer (tool_choice:'none') that hit the max_tokens cap mid-generation, leaving no
    // visible text. Before the fix, sendOpenAIWithTools had no detection for this at all.
    state.request.mockResolvedValueOnce(jsonResponse({
      choices: [{ message: { content: null }, finish_reason: 'length' }],
    }))

    // Post-fix behavior: this must now throw a specific, actionable error instead of resolving
    // with { content: null }.
    await expect(
      sendOpenAIWithTools('key', 'anthropic/claude-sonnet-4', [{ role: 'user', content: 'hi' }], [], 'none')
    ).rejects.toThrow(/ran out of tokens/)
  })

  it('throws a distinct message (with finishReason attached) for a genuine empty stop vs. a length cutoff', async () => {
    state.request.mockResolvedValueOnce(jsonResponse({
      choices: [{ message: { content: '' }, finish_reason: 'stop' }],
    }))

    await expect(
      sendOpenAIWithTools('key', 'some-model', [{ role: 'user', content: 'hi' }], [], 'none')
    ).rejects.toThrow(/The conversation may be too long/)
  })

  it('does not throw when tool calls are present even if content is empty', async () => {
    state.request.mockResolvedValueOnce(jsonResponse({
      choices: [{
        message: { content: null, tool_calls: [{ id: 't1', function: { name: 'lookup', arguments: '{}' } }] },
        finish_reason: 'tool_calls',
      }],
    }))

    const result = await sendOpenAIWithTools('key', 'some-model', [{ role: 'user', content: 'hi' }], [], 'auto')
    expect(result.content).toBeNull()
    expect(result.toolCalls).toHaveLength(1)
  })

  it('passes through a normal non-empty response unchanged', async () => {
    state.request.mockResolvedValueOnce(jsonResponse({
      choices: [{ message: { content: 'hello there' }, finish_reason: 'stop' }],
    }))

    const result = await sendOpenAIWithTools('key', 'some-model', [{ role: 'user', content: 'hi' }], [], 'none')
    expect(result.content).toBe('hello there')
  })
})

describe('sendOpenAIWithToolsResilient', () => {
  it('retries once with a doubled max_tokens budget after a length-truncated empty response, and succeeds', async () => {
    state.request
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: null }, finish_reason: 'length' }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'the real answer' }, finish_reason: 'stop' }] }))

    const result = await sendOpenAIWithToolsResilient(
      'key', 'anthropic/claude-sonnet-4', [{ role: 'user', content: 'hi' }], [], 'none', { maxTokens: 4096 }
    )

    expect(result.content).toBe('the real answer')
    expect(state.request).toHaveBeenCalledTimes(2)
    const secondCallBody = JSON.parse(state.request.mock.calls[1][2] as string)
    expect(secondCallBody.max_tokens).toBe(8192)
  })

  it('caps the retried max_tokens at 16384', async () => {
    state.request
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: null }, finish_reason: 'length' }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }))

    await sendOpenAIWithToolsResilient(
      'key', 'some-model', [{ role: 'user', content: 'hi' }], [], 'none', { maxTokens: 12000 }
    )

    const secondCallBody = JSON.parse(state.request.mock.calls[1][2] as string)
    expect(secondCallBody.max_tokens).toBe(16384)
  })

  it('does not retry on a genuine empty stop (not a length cutoff) and rejects', async () => {
    state.request.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] }))

    await expect(
      sendOpenAIWithToolsResilient('key', 'some-model', [{ role: 'user', content: 'hi' }], [], 'none')
    ).rejects.toThrow(/too long/)
    expect(state.request).toHaveBeenCalledTimes(1)
  })
})
