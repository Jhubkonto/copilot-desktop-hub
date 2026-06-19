import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  const sent: Array<{ channel: string; payload: unknown }> = []
  const mobile: Array<{ event: string; data: unknown }> = []
  const settings = new Map<string, string | undefined>()
  const configured = new Set<string>()
  let providerText = 'Ready\n<project-spec>{"name":"Demo","color":"blue","instructions":"","variables":[],"inScope":[],"outOfScope":[],"milestones":[],"agents":[]}</project-spec>'
  const dispatchToProvider = vi.fn(async (opts: { sendChunk: (chunk: string) => void }) => {
    opts.sendChunk(providerText)
    return providerText
  })
  return { sent, mobile, settings, configured, dispatchToProvider, get providerText() { return providerText }, set providerText(value: string) { providerText = value } }
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
    if (normalized.startsWith('claude')) return { provider: 'anthropic', model: normalized }
    return { provider: 'openai', model: normalized }
  }),
  getApiKey: vi.fn((provider: string) => `${provider}-key`),
  isProviderConfigured: vi.fn((provider: string) => state.configured.has(provider)),
}))

vi.mock('../chat-provider-dispatch', () => ({
  dispatchToProvider: state.dispatchToProvider,
}))

vi.mock('../safe-handle', () => ({ safeHandle: vi.fn() }))
vi.mock('../ws-server', () => ({ broadcastToMobile: vi.fn((payload: { event: string; data: unknown }) => state.mobile.push(payload)) }))
vi.mock('../project-handlers', () => ({ PROJECT_COLORS: new Set(['blue']) }))

import { runProjectGeneratorChat, runProjectGeneratorChatForAndroid } from '../project-generator'

describe('project generator provider selection', () => {
  beforeEach(() => {
    state.sent.length = 0
    state.mobile.length = 0
    state.settings.clear()
    state.configured.clear()
    state.providerText = 'Ready\n<project-spec>{"name":"Demo","color":"blue","instructions":"","variables":[],"inScope":[],"outOfScope":[],"milestones":[],"agents":[]}</project-spec>'
    state.dispatchToProvider.mockClear()
  })

  it('uses the saved default model provider', async () => {
    state.settings.set('default_model', 'anthropic:claude-sonnet-4.5')
    state.configured.add('anthropic')

    await runProjectGeneratorChat(makeWindow(), [{ role: 'user', content: 'new project' }], [])

    expect(state.dispatchToProvider).toHaveBeenCalledWith(expect.objectContaining({
      providerName: 'anthropic',
      providerModel: 'claude-sonnet-4.5',
      byokKey: 'anthropic-key',
    }))
    expect(state.sent).toContainEqual(expect.objectContaining({ channel: 'project-generator:spec-ready' }))
  })

  it('falls back to the first configured provider when the saved provider is unconfigured', async () => {
    state.configured.add('anthropic')

    await runProjectGeneratorChat(makeWindow(), [{ role: 'user', content: 'new project' }], [])

    expect(state.dispatchToProvider).toHaveBeenCalledWith(expect.objectContaining({
      providerName: 'anthropic',
      providerModel: 'claude-sonnet-4.5',
      byokKey: 'anthropic-key',
    }))
  })

  it('emits a mobile turn-complete event when no spec is ready', async () => {
    state.configured.add('openai')
    state.providerText = 'Can you share the root directory?'

    await runProjectGeneratorChatForAndroid(
      [{ role: 'user', content: 'new project' }],
      [],
      'session-1',
    )

    expect(state.mobile).toContainEqual({
      event: 'project-generator:turn-complete',
      data: { sessionId: 'session-1', content: 'Can you share the root directory?', hasSpec: false },
    })
    expect(state.mobile.some((event) => event.event === 'project-generator:spec-ready')).toBe(false)
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
