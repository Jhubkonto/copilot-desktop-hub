import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const { mockSendNonStreaming, mockSendChatMessage, mockGetAgentConfig, mockWindowSend } = vi.hoisted(() => {
  const mockWindowSend = vi.fn()
  const mockSendNonStreaming = vi.fn()
  const mockSendChatMessage = vi.fn()
  const mockGetAgentConfig = vi.fn()
  return { mockWindowSend, mockSendNonStreaming, mockSendChatMessage, mockGetAgentConfig }
})

vi.mock('../copilot-api', () => ({
  sendCopilotNonStreaming: mockSendNonStreaming,
  sendCopilotChatMessage: mockSendChatMessage
}))

vi.mock('../agents', () => ({
  getAgentConfig: mockGetAgentConfig
}))

vi.mock('crypto', () => ({ randomUUID: vi.fn(() => 'step-uuid') }))

// ── Helpers ────────────────────────────────────────────────────────────────────

import { runOrchestration, MAX_DELEGATION_DEPTH, type OrchestratorOptions } from '../orchestrator'

function makeMockWindow() {
  return { webContents: { send: mockWindowSend } } as unknown as Electron.BrowserWindow
}

function makeOpts(overrides: Partial<OrchestratorOptions> = {}): OrchestratorOptions {
  return {
    projectId: 'proj-1',
    projectName: 'Test Project',
    leaderAgentId: 'leader-id',
    teamAgents: [
      { agentId: 'leader-id', agentName: 'Leader', agentIcon: '👑', isPrimary: true, sortOrder: 0 },
      { agentId: 'specialist-id', agentName: 'Specialist', agentIcon: '🔧', isPrimary: false, sortOrder: 1 }
    ],
    conversationId: 'conv-1',
    window: makeMockWindow(),
    selectedModel: 'gpt-4o',
    generationOptions: { temperature: 0.7, maxTokens: 4096 },
    ...overrides
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('orchestrator — runOrchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAgentConfig.mockReturnValue({ systemPrompt: 'You are an agent.' })
  })

  // ── h10-1: leader returns text immediately (no delegation) ─────────────────

  describe('h10-1: leader returns text without delegation', () => {
    it('streams final answer and returns teamActivity=[]', async () => {
      mockSendNonStreaming.mockResolvedValue({
        content: 'Hello from leader',
        toolCalls: []
      })

      const result = await runOrchestration(makeOpts(), 'Hi', [])

      expect(result.finalContent).toBe('Hello from leader')
      expect(result.teamActivity).toHaveLength(0)

      // Each char streamed individually, then null sentinel
      const streamCalls = mockWindowSend.mock.calls.filter((call) => call[0] === 'chat:stream-response')
      const chars = streamCalls.map((call) => call[1]).filter((v): v is string => v !== null)
      expect(chars.join('')).toBe('Hello from leader')
      // verify null sentinel was sent
      expect(mockWindowSend).toHaveBeenCalledWith('chat:stream-response', null)
    })
  })

  // ── h10-2: delegation one level deep ──────────────────────────────────────

  describe('h10-2: leader delegates to specialist once, then answers', () => {
    it('calls specialist, injects result, leader streams final answer', async () => {
      // First non-streaming call → tool call to specialist
      mockSendNonStreaming.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'tc-1',
            name: 'delegate_to_agent',
            arguments: { agent_id: 'specialist-id', task: 'Do the analysis' }
          }
        ]
      })
      // Second non-streaming call → text answer
      mockSendNonStreaming.mockResolvedValueOnce({
        content: 'Final combined answer',
        toolCalls: []
      })

      mockSendChatMessage.mockResolvedValue('Specialist result here')

      const result = await runOrchestration(makeOpts(), 'Analyse this', [])

      expect(result.finalContent).toBe('Final combined answer')
      expect(result.teamActivity).toHaveLength(1)
      expect(result.teamActivity[0]).toMatchObject({
        agentId: 'specialist-id',
        agentName: 'Specialist',
        task: 'Do the analysis',
        status: 'done',
        result: 'Specialist result here'
      })

      const secondRoundMessages = mockSendNonStreaming.mock.calls[1][0] as Array<Record<string, unknown>>
      expect(secondRoundMessages).toContainEqual({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'tc-1',
            type: 'function',
            function: {
              name: 'delegate_to_agent',
              arguments: JSON.stringify({ agent_id: 'specialist-id', task: 'Do the analysis' })
            }
          }
        ]
      })
      expect(secondRoundMessages).toContainEqual({
        role: 'tool',
        tool_call_id: 'tc-1',
        content: 'Specialist result here'
      })

      // team-activity events: first 'delegating', then 'done'
      const activityCalls = mockWindowSend.mock.calls.filter((call) => call[0] === 'chat:team-activity')
      expect(activityCalls).toHaveLength(2)
      expect(activityCalls[0][1].status).toBe('delegating')
      expect(activityCalls[1][1].status).toBe('done')
    })
  })

  // ── h10-3: unknown agent_id in tool call ───────────────────────────────────

  describe('h10-3: leader tries to delegate to unknown agent', () => {
    it('injects error message and loops until leader produces text', async () => {
      mockSendNonStreaming.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'tc-x',
            name: 'delegate_to_agent',
            arguments: { agent_id: 'nonexistent-agent', task: 'Do something' }
          }
        ]
      })
      mockSendNonStreaming.mockResolvedValueOnce({
        content: 'I handled it myself',
        toolCalls: []
      })

      const result = await runOrchestration(makeOpts(), 'Task', [])

      expect(result.finalContent).toBe('I handled it myself')
      // No team activity steps — the unknown agent never got called
      expect(result.teamActivity).toHaveLength(0)
      const secondRoundMessages = mockSendNonStreaming.mock.calls[1][0] as Array<Record<string, unknown>>
      expect(secondRoundMessages).toContainEqual({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'tc-x',
            type: 'function',
            function: {
              name: 'delegate_to_agent',
              arguments: JSON.stringify({ agent_id: 'nonexistent-agent', task: 'Do something' })
            }
          }
        ]
      })
      expect(secondRoundMessages).toContainEqual({
        role: 'tool',
        tool_call_id: 'tc-x',
        content: 'Error: Unknown agent_id "nonexistent-agent". Please choose from the listed team members.'
      })
      // sendCopilotChatMessage should NOT have been called (no specialist called)
      expect(mockSendChatMessage).not.toHaveBeenCalled()
    })
  })

  // ── h10-4: specialist throws error ────────────────────────────────────────

  describe('h10-4: specialist agent throws error', () => {
    it('marks step as error and injects error message for leader to recover', async () => {
      mockSendNonStreaming.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'tc-err',
            name: 'delegate_to_agent',
            arguments: { agent_id: 'specialist-id', task: 'Hard task' }
          }
        ]
      })
      mockSendChatMessage.mockRejectedValueOnce(new Error('API timeout'))
      // After receiving the error, leader produces final answer
      mockSendNonStreaming.mockResolvedValueOnce({
        content: 'Could not get specialist result, but here is my answer',
        toolCalls: []
      })

      const result = await runOrchestration(makeOpts(), 'Tough request', [])

      expect(result.teamActivity).toHaveLength(1)
      expect(result.teamActivity[0].status).toBe('error')
      expect(result.teamActivity[0].result).toContain('API timeout')
      expect(result.finalContent).toBe('Could not get specialist result, but here is my answer')
    })
  })

  // ── h10-5: depth cap reached ───────────────────────────────────────────────

  describe('h10-5: depth cap reached', () => {
    it('calls sendCopilotChatMessage for final fallback when max depth exhausted', async () => {
      // Every non-streaming call returns a tool call (never resolves to text)
      mockSendNonStreaming.mockResolvedValue({
        content: null,
        toolCalls: [
          {
            id: 'tc-loop',
            name: 'delegate_to_agent',
            arguments: { agent_id: 'specialist-id', task: 'Repeated task' }
          }
        ]
      })
      mockSendChatMessage.mockResolvedValue('Fallback answer after depth cap')

      const opts = makeOpts({ maxDelegationDepth: 2 })
      const result = await runOrchestration(opts, 'Infinite loop task', [])

      expect(result.finalContent).toBe('Fallback answer after depth cap')
      // Non-streaming called exactly maxDelegationDepth times
      expect(mockSendNonStreaming).toHaveBeenCalledTimes(2)
      // sendCopilotChatMessage called for each specialist + once for the fallback
      const chatCalls = mockSendChatMessage.mock.calls
      // Last call should pass the depth-cap fallback message
      const lastCallMessages = chatCalls[chatCalls.length - 1][1] as Array<{ role: string; content: string }>
      const lastMsg = lastCallMessages[lastCallMessages.length - 1]
      expect(lastMsg.content).toContain('maximum delegation depth')
    })
  })

  // ── h10-6: selectedModel 'default' falls back to gpt-4o ───────────────────

  describe('h10-6: model selection', () => {
    it('uses gpt-4o when selectedModel is "default"', async () => {
      mockSendNonStreaming.mockResolvedValue({ content: 'OK', toolCalls: [] })

      await runOrchestration(makeOpts({ selectedModel: 'default' }), 'test', [])

      expect(mockSendNonStreaming).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Array),
        'gpt-4o',
        expect.any(Object)
      )
    })

    it('uses provided model when not "default"', async () => {
      mockSendNonStreaming.mockResolvedValue({ content: 'OK', toolCalls: [] })

      await runOrchestration(makeOpts({ selectedModel: 'claude-3-5-sonnet' }), 'test', [])

      expect(mockSendNonStreaming).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Array),
        'claude-3-5-sonnet',
        expect.any(Object)
      )
    })
  })

  // ── h10-7: team manifest is injected into leader system prompt ─────────────

  describe('h10-7: team manifest in system prompt', () => {
    it('includes specialist agent_id and name in leader system prompt', async () => {
      mockSendNonStreaming.mockResolvedValue({ content: 'OK', toolCalls: [] })

      await runOrchestration(makeOpts(), 'What can you do?', [])

      const firstCall = mockSendNonStreaming.mock.calls[0]
      const messages = firstCall[0] as Array<{ role: string; content: string }>
      const systemMsg = messages.find((m) => m.role === 'system')
      expect(systemMsg?.content).toContain('specialist-id')
      expect(systemMsg?.content).toContain('Specialist')
      expect(systemMsg?.content).toContain('Test Project')
    })

    it('uses default prompt when leader has no systemPrompt', async () => {
      mockGetAgentConfig.mockReturnValue(null)
      mockSendNonStreaming.mockResolvedValue({ content: 'OK', toolCalls: [] })

      await runOrchestration(makeOpts(), 'Hello', [])

      const messages = mockSendNonStreaming.mock.calls[0][0] as Array<{ role: string; content: string }>
      const systemMsg = messages.find((m) => m.role === 'system')
      expect(systemMsg?.content).toContain('GitHub Copilot')
    })
  })

  // ── h10-8: MAX_DELEGATION_DEPTH constant ──────────────────────────────────

  describe('h10-8: MAX_DELEGATION_DEPTH constant', () => {
    it('is exported and equals 5', () => {
      expect(MAX_DELEGATION_DEPTH).toBe(5)
    })
  })

  // ── h10-9: history messages are included ──────────────────────────────────

  describe('h10-9: history messages forwarded to loop', () => {
    it('includes history messages in the messages sent to the leader', async () => {
      mockSendNonStreaming.mockResolvedValue({ content: 'Recalled context', toolCalls: [] })

      const history = [{ role: 'user' as const, content: 'Earlier message' }]
      await runOrchestration(makeOpts(), 'Follow up', history)

      const messages = mockSendNonStreaming.mock.calls[0][0] as Array<{ role: string; content: string }>
      expect(messages.some((m) => m.content === 'Earlier message')).toBe(true)
    })
  })
})
