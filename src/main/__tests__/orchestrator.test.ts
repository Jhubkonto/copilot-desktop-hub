import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendProviderWithTools: vi.fn(),
  windowSend: vi.fn(),
  getAgentConfig: vi.fn(() => ({ systemPrompt: 'You are an agent.' })),
}))

vi.mock('../providers', () => ({
  DEFAULT_PROVIDER_MODEL: 'gpt-5-mini',
  NO_PROVIDER_CONFIGURED_MESSAGE: 'No provider configured. Add an API key in Settings.',
  getProviderForAgent: vi.fn((model?: string) => ({ provider: 'openai', model: model ?? 'gpt-5-mini' })),
  getApiKey: vi.fn(() => 'test-key'),
  getAzureEndpoint: vi.fn(() => null),
  sendProviderWithTools: mocks.sendProviderWithTools,
  sendOpenAIMessage: vi.fn(),
  sendAnthropicMessage: vi.fn(),
  sendAzureMessage: vi.fn(),
}))

vi.mock('../agents', () => ({ getAgentConfig: mocks.getAgentConfig }))
vi.mock('crypto', () => ({ randomUUID: vi.fn(() => 'step-uuid') }))

import { runOrchestration, type OrchestratorOptions } from '../orchestrator'

function makeOpts(overrides: Partial<OrchestratorOptions> = {}): OrchestratorOptions {
  return {
    projectId: 'proj-1',
    projectName: 'Test Project',
    leaderAgentId: 'leader-id',
    teamAgents: [{ agentId: 'leader-id', agentName: 'Leader', agentIcon: '👑', isPrimary: true, sortOrder: 0 }],
    conversationId: 'conv-1',
    window: { webContents: { send: mocks.windowSend } } as unknown as Electron.BrowserWindow,
    selectedModel: 'gpt-4o',
    generationOptions: { temperature: 0.7, maxTokens: 4096 },
    ...overrides,
  }
}

describe('orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the leader response when no delegation is requested', async () => {
    mocks.sendProviderWithTools.mockResolvedValue({ content: 'Leader answer', toolCalls: [] })

    const result = await runOrchestration(makeOpts(), 'Hi', [])

    expect(result.finalContent).toBe('Leader answer')
    expect(result.teamActivity).toEqual([])
  })

  it('uses the default provider model when none is selected', async () => {
    mocks.sendProviderWithTools.mockResolvedValue({ content: 'Default model answer', toolCalls: [] })

    await runOrchestration(makeOpts({ selectedModel: undefined }), 'Hi', [])

    expect(mocks.sendProviderWithTools).toHaveBeenCalled()
  })
})
