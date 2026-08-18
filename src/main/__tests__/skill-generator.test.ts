import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  const sent: Array<{ channel: string; payload: unknown }> = []
  const settings = new Map<string, string | undefined>()
  const configured = new Set<string>()
  let providerText = 'Ready\n<skill-spec>{"name":"Demo Skill","icon":"✨","description":"","instructions":"","tools":{"fileEdit":false,"terminal":false,"webFetch":false}}</skill-spec>'
  const dispatchToProvider = vi.fn(async (opts: { sendChunk: (chunk: string) => void }) => {
    if (providerText) opts.sendChunk(providerText)
    return providerText
  })
  return { sent, settings, configured, dispatchToProvider, get providerText() { return providerText }, set providerText(value: string) { providerText = value } }
})

vi.mock('../database', () => ({
  getDatabase: () => ({
    prepare: (sql: string) => ({
      get: () => {
        if (sql.includes("key = 'default_model'")) {
          const value = state.settings.get('default_model')
          return value ? { value } : undefined
        }
        return undefined
      },
    }),
  }),
}))

vi.mock('../providers', () => ({
  DEFAULT_PROVIDER_MODEL: 'gpt-5-mini',
  PROVIDERS: [
    { name: 'openai', models: ['gpt-5-mini'] },
    { name: 'anthropic', models: ['claude-sonnet-4.5'] },
    { name: 'openrouter', models: [] },
  ],
  getOpenRouterModels: vi.fn(() => []),
  getProviderForAgent: vi.fn((agentModel: string) => {
    const normalized = !agentModel || agentModel === 'default' ? 'gpt-5-mini' : agentModel
    if (normalized.includes(':')) {
      const [provider, model] = normalized.split(':', 2)
      return { provider, model }
    }
    return { provider: 'openai', model: normalized }
  }),
  getApiKey: vi.fn((provider: string) => `${provider}-key`),
  getProviderCredential: vi.fn((provider: string) => `${provider}-key`),
  isProviderConfigured: vi.fn((provider: string) => state.configured.has(provider)),
}))

vi.mock('../chat-provider-dispatch', () => ({
  dispatchToProvider: state.dispatchToProvider,
}))

vi.mock('../cli-adapters/registry', () => ({
  getAdapter: vi.fn(() => null),
}))

vi.mock('../safe-handle', () => ({ safeHandle: vi.fn() }))

import { runSkillGeneratorChat } from '../skill-generator'

describe('skill generator', () => {
  beforeEach(() => {
    state.sent.length = 0
    state.settings.clear()
    state.configured.clear()
    state.providerText = 'Ready\n<skill-spec>{"name":"Demo Skill","icon":"✨","description":"","instructions":"","tools":{"fileEdit":false,"terminal":false,"webFetch":false}}</skill-spec>'
    state.dispatchToProvider.mockClear()
  })

  it('uses the saved global default model provider', async () => {
    state.settings.set('default_model', 'anthropic:claude-sonnet-4.5')
    state.configured.add('anthropic')

    await runSkillGeneratorChat(makeWindow(), [{ role: 'user', content: 'new skill' }])

    expect(state.dispatchToProvider).toHaveBeenCalledWith(expect.objectContaining({
      providerName: 'anthropic',
      providerModel: 'claude-sonnet-4.5',
      byokKey: 'anthropic-key',
    }))
    expect(state.sent).toContainEqual(expect.objectContaining({ channel: 'skill-generator:spec-ready' }))
  })

  it('throws when the selected model returns an empty response', async () => {
    state.configured.add('openai')
    state.providerText = ''

    await expect(runSkillGeneratorChat(makeWindow(), [{ role: 'user', content: 'new skill' }]))
      .rejects
      .toThrow(/returned no response/)

    expect(state.sent.some((event) => event.channel === 'skill-generator:done')).toBe(false)
  })
})

function makeWindow() {
  return {
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, payload: unknown) => state.sent.push({ channel, payload }),
      isDestroyed: () => false,
    },
  } as never
}
