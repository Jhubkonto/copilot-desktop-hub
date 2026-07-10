import { beforeEach, describe, expect, it, vi } from 'vitest'

const { dispatchToProviderMock, getApiKeyMock } = vi.hoisted(() => ({
  dispatchToProviderMock: vi.fn(),
  getApiKeyMock: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => 'C:/tmp') },
}))

vi.mock('../providers', () => ({
  DEFAULT_PROVIDER_MODEL: 'gpt-5-mini',
  NO_PROVIDER_CONFIGURED_MESSAGE: 'No provider configured. Add an API key in Settings.',
  PROVIDERS: [],
  getOpenRouterModels: vi.fn(() => []),
  getProviderForAgent: vi.fn(() => ({ provider: 'openai', model: 'gpt-5-mini' })),
  getApiKey: getApiKeyMock,
  isProviderConfigured: vi.fn(() => false),
}))

vi.mock('../chat-provider-dispatch', () => ({
  dispatchToProvider: dispatchToProviderMock,
}))

vi.mock('../cli-adapters/registry', () => ({
  getAdapter: vi.fn(() => null),
}))

vi.mock('../cli-adapters/claude', () => ({
  ClaudeAdapter: { isAvailable: vi.fn(() => false) },
}))

vi.mock('../cli-adapters/codex', () => ({
  CodexAdapter: { isAvailable: vi.fn(() => false) },
}))

vi.mock('../cli-detection', () => ({
  getCliModels: vi.fn(() => []),
}))

vi.mock('../database', () => ({
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({ get: vi.fn(), all: vi.fn(() => []) })),
  })),
}))

vi.mock('../ws-server', () => ({
  broadcastToMobile: vi.fn(),
}))

vi.mock('../project-handlers', () => ({
  parseProjectConfig: vi.fn(() => ({
    variables: [],
    inScope: [],
    outOfScope: [],
    milestones: [],
    instructions: '',
    workflowMode: 'automated-delegation',
    rootDirectory: null,
  })),
}))

import {
  extractAutomatedWorkflowSpec,
  normalizeAutomatedWorkflowSpec,
  runAutomatedWorkflowProviderChat,
} from '../automated-workflow-generator'

describe('automated workflow generator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getApiKeyMock.mockReturnValue(null)
  })

  it('extracts an automated workflow spec from tagged assistant text', () => {
    const spec = extractAutomatedWorkflowSpec(`Plan ready.
<automated-workflow-spec>
{
  "title": "Launch workflow",
  "goalSummary": "Ship the feature safely",
  "assumptions": ["Codebase already builds locally"],
  "steps": [
    {
      "id": "step-1",
      "title": "Assess current implementation",
      "summary": "Review constraints and current state",
      "agentId": "agent-1",
      "agentName": "Planner",
      "prompt": "Review the current implementation and list the main risks.",
      "expectedOutput": "Risk list"
    }
  ]
}
</automated-workflow-spec>`)

    expect(spec).toEqual({
      title: 'Launch workflow',
      goalSummary: 'Ship the feature safely',
      assumptions: ['Codebase already builds locally'],
      steps: [
        {
          id: 'step-1',
          title: 'Assess current implementation',
          summary: 'Review constraints and current state',
          agentId: 'agent-1',
          agentName: 'Planner',
          prompt: 'Review the current implementation and list the main risks.',
          expectedOutput: 'Risk list',
        },
      ],
    })
  })

  it('normalizes missing optional fields and preserves valid dependency ids', () => {
    const spec = normalizeAutomatedWorkflowSpec({
      title: '',
      goalSummary: '',
      assumptions: ['One', '', 4],
      steps: [
        {
          prompt: 'Do the first thing',
          dependsOnStepIds: [],
        },
        {
          id: 'ship',
          title: 'Ship it',
          prompt: 'Prepare the rollout',
          expectedOutput: 'Release notes',
          dependsOnStepIds: ['step-1', '', 3],
        },
      ],
    })

    expect(spec.title).toBe('Automated workflow')
    expect(spec.assumptions).toEqual(['One'])
    expect(spec.steps).toEqual([
      {
        id: 'step-1',
        title: 'Step 1',
        summary: '',
        agentId: undefined,
        agentName: undefined,
        prompt: 'Do the first thing',
        expectedOutput: '',
        dependsOnStepIds: undefined,
      },
      {
        id: 'ship',
        title: 'Ship it',
        summary: '',
        agentId: undefined,
        agentName: undefined,
        prompt: 'Prepare the rollout',
        expectedOutput: 'Release notes',
        dependsOnStepIds: ['step-1'],
      },
    ])
  })

  it('rejects specs without at least one valid prompt-bearing step', () => {
    expect(() => normalizeAutomatedWorkflowSpec({
      title: 'Broken workflow',
      steps: [{ title: 'Empty prompt', prompt: '' }],
    })).toThrow('Automated workflow requires at least one step')
  })

  it('returns null for invalid tagged JSON', () => {
    expect(extractAutomatedWorkflowSpec('<automated-workflow-spec>{ nope }</automated-workflow-spec>')).toBeNull()
  })

  it('throws a clear provider configuration error before dispatching with an empty key', async () => {
    const win = {
      webContents: { send: vi.fn() },
      isDestroyed: () => false,
    } as never

    await expect(runAutomatedWorkflowProviderChat(
      win,
      [{ role: 'user', content: 'Build a workflow' }],
      'session-1',
      vi.fn(),
      'C:/tmp',
      'gpt-5-mini',
    )).rejects.toThrow('No provider configured. Add an API key in Settings.')

    expect(dispatchToProviderMock).not.toHaveBeenCalled()
  })
})
