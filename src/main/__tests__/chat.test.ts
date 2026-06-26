import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const messages: Array<{ role: string; content: string; attachments: string | null; thinkingBlocks: string | null }> = []
  const events: string[] = []
  const send = vi.fn()
  const broadcastToMobile = vi.fn((payload: { event?: string; data?: { state?: string } }) => {
    if (payload.event === 'conversation:messages') events.push('mobile:messages')
    if (payload.event === 'chat:stream-end') events.push('mobile:stream-end')
    if (payload.event === 'chat:activity' && payload.data?.state === 'complete') events.push('mobile:complete')
    if (payload.event === 'chat:activity' && payload.data?.state === 'error') events.push('mobile:error')
  })
  const abortActiveStream = vi.fn()
  // Per-test overrides: map SQL substrings to fixed return values for get()
  const getOverrides = new Map<string, unknown>()
  const allOverrides = new Map<string, unknown[]>()
  return { handlers, messages, events, send, broadcastToMobile, abortActiveStream, getOverrides, allOverrides }
})

vi.mock('../safe-handle', () => ({
  safeHandle: (channel: string, handler: (...args: unknown[]) => unknown) => {
    state.handlers.set(channel, handler)
  },
}))

vi.mock('../database', () => ({
  getDatabase: () => ({
    prepare: (sql: string) => ({
      run: (...args: unknown[]) => {
        if (sql.includes('INSERT INTO messages')) {
          state.messages.push({
            role: String(args[2]),
            content: String(args[3]),
            attachments: typeof args[4] === 'string' ? args[4] : null,
            thinkingBlocks: typeof args[7] === 'string' ? args[7] : null,
          })
          if (String(args[2]) === 'assistant') state.events.push('db:assistant-insert')
        }
        return { changes: 1 }
      },
      get: () => {
        for (const [pattern, value] of state.getOverrides) {
          if (sql.includes(pattern)) return value
        }
        return { agent_id: null, model: null, cli_backend: null }
      },
      all: () => {
        for (const [pattern, value] of state.allOverrides) {
          if (sql.includes(pattern)) return value
        }
        if (sql.includes('SELECT id, role, content')) {
          return state.messages.map((message, index) => ({
            id: `m-${index}`,
            role: message.role,
            content: message.content,
            model: null,
            attachments: message.attachments,
            timestamp: index + 1,
            thinking_blocks: message.thinkingBlocks,
          }))
        }
        return []
      },
    }),
  }),
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: () => ({ webContents: { send: state.send, isDestroyed: () => false } }),
  },
}))

vi.mock('../agents', () => ({ getAgentConfig: vi.fn(() => null) }))
vi.mock('../project-handlers', () => ({
  parseProjectConfig: vi.fn(() => ({
    instructions: '',
    instructionsEnabled: true,
    rootDirectory: null,
    variables: [],
    instructionMode: 'prepend',
    orchestrationEnabled: false,
    maxDelegationDepth: 5,
    showTeamActivity: true,
    inScope: [],
    outOfScope: [],
    milestones: [],
    defaultModel: null,
  })),
}))
vi.mock('../fcm-sender', () => ({ sendChatCompleteNotification: vi.fn(async () => undefined) }))
vi.mock('../file-handlers', () => ({ listDirectoryEntries: vi.fn(() => []) }))
vi.mock('../mcp', () => ({
  ensureMcpServersReady: vi.fn(async () => undefined),
  getAvailableMcpTools: vi.fn(() => []),
  getMcpServerConfigsForCli: vi.fn(() => []),
}))
vi.mock('../orchestrator', () => ({ runOrchestration: vi.fn() }))
vi.mock('../tool-loop', () => ({ runProviderMcpToolLoop: vi.fn() }))
vi.mock('../cli-adapters/registry', () => ({ getAdapter: vi.fn(() => null) }))
vi.mock('../cli-adapters/claude', () => ({ ClaudeAdapter: { isAvailable: vi.fn(() => false) } }))
vi.mock('../cli-adapters/codex', () => ({
  CodexAdapter: { isAvailable: vi.fn(() => false) },
  readCodexConfigModel: vi.fn(() => null),
  CODEX_DEFAULT_MODELS: [],
}))
vi.mock('../ws-server', () => ({ broadcastToMobile: state.broadcastToMobile, hasMobileClients: vi.fn(() => true), isMobileInForeground: vi.fn(() => true) }))
vi.mock('../auth', () => ({ retrieveAuthMode: vi.fn(() => 'byok') }))
vi.mock('../wiki-context', () => ({ getRelevantWikiEntries: vi.fn(() => []), formatWikiSection: vi.fn(() => '') }))
vi.mock('../wiki-handlers', () => ({ insertWikiEntry: vi.fn() }))
vi.mock('../tools', () => ({ requestApproval: vi.fn(), registerApprovalResolver: vi.fn() }))
vi.mock('../context-compression', () => ({
  applyRollingContextCompression: vi.fn((_db, _conversationId, messages) => ({ messages, summary: null })),
}))
vi.mock('../providers', () => ({
  DEFAULT_PROVIDER_MODEL: 'gpt-5-mini',
  NO_PROVIDER_CONFIGURED_MESSAGE: 'No provider configured. Add an API key in Settings.',
  getProviderForAgent: vi.fn(() => ({ provider: 'openai', model: 'gpt-4o' })),
  getApiKey: vi.fn(() => 'test-key'),
  sendOpenAIMessage: vi.fn(async (_conversationId, _apiKey, _model, _messages, onChunk) => {
    onChunk('Hello')
    onChunk(' world')
    return 'Hello world'
  }),
  sendOpenAIWithTools: vi.fn(),
  sendAnthropicMessage: vi.fn(),
  sendAnthropicWithTools: vi.fn(),
  sendAzureMessage: vi.fn(),
  sendAzureWithTools: vi.fn(),
  getAzureEndpoint: vi.fn(() => null),
  abortActiveStream: state.abortActiveStream,
}))

import { registerChatHandlers } from '../chat-handlers'
import { getAdapter } from '../cli-adapters/registry'
import { ClaudeAdapter } from '../cli-adapters/claude'
import { CodexAdapter } from '../cli-adapters/codex'
import { retrieveAuthMode } from '../auth'
import { getAgentConfig } from '../agents'
import { getAvailableMcpTools, getMcpServerConfigsForCli } from '../mcp'
import { getApiKey, sendOpenAIMessage } from '../providers'
import { requestApproval } from '../tools'
import { runOrchestration } from '../orchestrator'

describe('chat handlers', () => {
  beforeEach(() => {
    state.handlers.clear()
    state.messages.length = 0
    state.events.length = 0
    state.send.mockClear()
    state.broadcastToMobile.mockClear()
    state.abortActiveStream.mockClear()
    state.getOverrides.clear()
    state.allOverrides.clear()
    vi.mocked(requestApproval).mockReset()
    vi.mocked(getAdapter).mockReturnValue(undefined)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(false)
    vi.mocked(CodexAdapter.isAvailable).mockReturnValue(false)
    vi.mocked(retrieveAuthMode).mockReturnValue('byok')
    vi.mocked(getAgentConfig).mockReturnValue(null)
    vi.mocked(getAvailableMcpTools).mockReturnValue([])
    vi.mocked(getMcpServerConfigsForCli).mockReturnValue([])
    vi.mocked(getApiKey).mockReturnValue('test-key')
    vi.mocked(requestApproval).mockResolvedValue(false)
    registerChatHandlers()
  })

  it('streams a BYOK provider response', async () => {
    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>

    const result = await handler({ sender: {} }, 'conv-1', 'Hello there')

    expect(result.assistantMsgId).toBeTruthy()
    expect(state.send).toHaveBeenCalledWith('chat:stream-response', 'Hello')
    expect(state.send).toHaveBeenCalledWith('chat:stream-response', ' world')
    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'chat:activity',
      data: { conversationId: 'conv-1', state: 'thinking', label: 'Preparing context' },
    })
    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'chat:activity',
      data: { conversationId: 'conv-1', state: 'thinking', label: 'Generating response' },
    })
    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'chat:activity',
      data: { conversationId: 'conv-1', state: 'complete', label: 'Complete' },
    })
    expect(state.events.indexOf('db:assistant-insert')).toBeLessThan(state.events.indexOf('mobile:stream-end'))
    expect(state.events.indexOf('db:assistant-insert')).toBeLessThan(state.events.indexOf('mobile:complete'))
    expect(state.events.indexOf('db:assistant-insert')).toBeLessThan(state.events.indexOf('mobile:messages'))
    expect(state.events.indexOf('mobile:messages')).toBeLessThan(state.events.indexOf('mobile:stream-end'))
  })

  it('forwards and stores BYOK provider thinking events', async () => {
    vi.mocked(sendOpenAIMessage).mockImplementationOnce(async (
      _conversationId,
      _apiKey,
      _model,
      _messages,
      onChunk,
      options,
    ) => {
      options?.onThinkingChunk?.('reasoning-0', 'Checking context.')
      options?.onThinkingEnd?.('reasoning-0')
      onChunk('Hello')
      return 'Hello'
    })

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>
    await handler({ sender: {} }, 'conv-byok-thinking', 'Hello there')

    expect(state.send).toHaveBeenCalledWith('chat:thinking-delta', {
      blockId: 'reasoning-0',
      chunk: 'Checking context.',
    })
    expect(state.send).toHaveBeenCalledWith('chat:thinking-end', { blockId: 'reasoning-0' })
    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'chat:thinking-delta',
      data: { conversationId: 'conv-byok-thinking', blockId: 'reasoning-0', chunk: 'Checking context.' },
    })
    const assistantMessage = state.messages.find((message) => message.role === 'assistant')
    expect(JSON.parse(assistantMessage?.thinkingBlocks ?? '[]')).toEqual([
      { blockId: 'reasoning-0', content: 'Checking context.', done: true },
    ])
  })

  it('stores mobile image attachment metadata without persisting image data', async () => {
    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>

    await handler({ sender: {} }, 'conv-1', '', {
      images: [{ id: 'img-1', name: 'photo.png', dataUrl: 'data:image/png;base64,abc123' }],
    })

    const userMessage = state.messages.find((message) => message.role === 'user')
    expect(userMessage?.attachments).toBeTruthy()
    const attachments = JSON.parse(userMessage?.attachments ?? '[]')
    expect(attachments).toEqual([
      {
        id: 'img-1',
        name: 'photo.png',
        size: 4,
        type: 'image',
        source: 'mobile',
      },
    ])
    expect(userMessage?.attachments).not.toContain('abc123')
    expect(userMessage?.attachments).not.toContain('data:image/png')
  })

  it('CLI backend does not inject BYOK model identity into system prompt', async () => {
    // Make the handler route through the CLI adapter
    const capturedReqs: { systemPrompt?: string }[] = []
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (_win: unknown, req: { systemPrompt?: string }, _onChunk: unknown) => {
        capturedReqs.push({ systemPrompt: req.systemPrompt })
        return 'cli response'
      }),
    }
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-cli', 'tell me something')

    expect(capturedReqs).toHaveLength(1)
    // Must NOT contain the BYOK model identity instruction
    expect(capturedReqs[0].systemPrompt ?? '').not.toContain('gpt-5-mini')
    expect(capturedReqs[0].systemPrompt ?? '').not.toContain('Runtime model for this conversation')
  })

  it('forwards and stores CLI thinking events', async () => {
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (_win: unknown, _req: unknown, onChunk: (chunk: string) => void, onEvent: (event: unknown) => void) => {
        onEvent({ type: 'thinking_chunk', blockId: 'codex-activity', chunk: 'Starting Codex CLI.\n' })
        onEvent({ type: 'thinking_end', blockId: 'codex-activity' })
        onChunk('cli response')
        return 'cli response'
      }),
    }
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(false)
    vi.mocked(CodexAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-cli-thinking', 'tell me something')

    expect(state.send).toHaveBeenCalledWith('chat:thinking-delta', {
      blockId: 'codex-activity',
      chunk: 'Starting Codex CLI.\n',
    })
    expect(state.send).toHaveBeenCalledWith('chat:thinking-end', { blockId: 'codex-activity' })
    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'chat:thinking-delta',
      data: { conversationId: 'conv-cli-thinking', blockId: 'codex-activity', chunk: 'Starting Codex CLI.\n' },
    })
    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'chat:thinking-end',
      data: { conversationId: 'conv-cli-thinking', blockId: 'codex-activity' },
    })
    const assistantMessage = state.messages.find((message) => message.role === 'assistant')
    expect(JSON.parse(assistantMessage?.thinkingBlocks ?? '[]')).toEqual([
      { blockId: 'codex-activity', content: 'Starting Codex CLI.\n', done: true },
    ])
  })

  it('injects assigned MCP servers when falling back to Claude CLI for MCP agents', async () => {
    const capturedReqs: Array<{ mcpServers?: unknown[]; allowedTools?: string[] }> = []
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (_win: unknown, req: { mcpServers?: unknown[]; allowedTools?: string[] }) => {
        capturedReqs.push({ mcpServers: req.mcpServers, allowedTools: req.allowedTools })
        return 'cli response'
      }),
    }
    vi.mocked(getAgentConfig).mockReturnValue({
      id: 'agent-mcp',
      name: 'MCP Agent',
      systemPrompt: 'Use browser tools.',
      mcpServers: ['server-1'],
      agenticMode: true,
    } as never)
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)
    vi.mocked(getMcpServerConfigsForCli).mockReturnValue([{
      id: 'server-1',
      key: 'playwright_chromium',
      command: 'npx',
      args: ['-y', '@playwright/mcp'],
    }])
    vi.mocked(getAvailableMcpTools).mockReturnValue([{
      name: 'browser_navigate',
      serverId: 'server-1',
      serverName: 'Playwright (Chromium)',
    }])

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-mcp', 'open google', { agentId: 'agent-mcp' })

    expect(mockAdapter.send).toHaveBeenCalled()
    expect(capturedReqs[0].mcpServers).toEqual([{
      id: 'server-1',
      key: 'playwright_chromium',
      command: 'npx',
      args: ['-y', '@playwright/mcp'],
    }])
    expect(capturedReqs[0].allowedTools).toEqual(['mcp__playwright_chromium__browser_navigate'])
  })

  it('asks once and passes built-in file edit tools to Claude CLI', async () => {
    const capturedReqs: Array<{ allowedTools?: string[] }> = []
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (_win: unknown, req: { allowedTools?: string[] }) => {
        capturedReqs.push({ allowedTools: req.allowedTools })
        return 'cli response'
      }),
    }
    vi.mocked(getAgentConfig).mockReturnValue({
      id: 'agent-file',
      name: 'File Agent',
      systemPrompt: 'Draw with SVG files.',
      mcpServers: [],
      agenticMode: false,
      tools: {
        fileEdit: { enabled: true, approval: 'always-ask', instructions: '' },
        terminal: { enabled: false, approval: 'always-ask', instructions: '' },
        webFetch: { enabled: false, approval: 'always-ask', instructions: '' },
      },
    } as never)
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)
    vi.mocked(requestApproval).mockResolvedValue(true)

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-file', 'draw crossbones', { agentId: 'agent-file' })

    expect(requestApproval).toHaveBeenCalledWith(
      expect.anything(),
      'claude-cli:fileEdit',
      {},
      'Allow Claude CLI to read and edit files for this message?',
      { onRemember: expect.any(Function) },
    )
    expect(capturedReqs[0].allowedTools).toEqual(['Read', 'Write', 'Edit', 'MultiEdit'])
  })

  it('injects assigned MCP servers when falling back to Codex CLI for MCP agents', async () => {
    const capturedReqs: Array<{ mcpServers?: unknown[]; allowedTools?: string[] }> = []
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (_win: unknown, req: { mcpServers?: unknown[]; allowedTools?: string[] }) => {
        capturedReqs.push({ mcpServers: req.mcpServers, allowedTools: req.allowedTools })
        return 'cli response'
      }),
    }
    vi.mocked(getAgentConfig).mockReturnValue({
      id: 'agent-mcp',
      name: 'MCP Agent',
      systemPrompt: 'Use browser tools.',
      mcpServers: ['server-1'],
      agenticMode: true,
    } as never)
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(false)
    vi.mocked(CodexAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)
    vi.mocked(getMcpServerConfigsForCli).mockReturnValue([{
      id: 'server-1',
      key: 'playwright_chromium',
      command: 'npx',
      args: ['-y', '@playwright/mcp'],
    }])
    vi.mocked(getAvailableMcpTools).mockReturnValue([{
      name: 'browser_navigate',
      serverId: 'server-1',
      serverName: 'Playwright (Chromium)',
    }])

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-mcp', 'open google', { agentId: 'agent-mcp' })

    expect(mockAdapter.send).toHaveBeenCalled()
    expect(capturedReqs[0].mcpServers).toEqual([{
      id: 'server-1',
      key: 'playwright_chromium',
      command: 'npx',
      args: ['-y', '@playwright/mcp'],
    }])
    expect(capturedReqs[0].allowedTools).toEqual(['mcp__playwright_chromium__browser_navigate'])
  })

  it('reports fallback CLI errors without falling through to provider configuration errors', async () => {
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (_win: unknown, _req: unknown, _onChunk: unknown, onEvent: (event: unknown) => void) => {
        onEvent({ type: 'thinking_chunk', blockId: 'codex-activity', chunk: 'Starting Codex CLI.\n' })
        throw new Error('claude failed after running MCP tools')
      }),
    }
    vi.mocked(getAgentConfig).mockReturnValue(null)
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-cli-error', 'open google')

    expect(mockAdapter.send).toHaveBeenCalled()
    expect(state.send).toHaveBeenCalledWith('chat:stream-error', expect.objectContaining({
      message: 'claude failed after running MCP tools',
    }))
    expect(state.send).toHaveBeenCalledWith('chat:thinking-end', { blockId: 'codex-activity' })
    const assistantMessage = state.messages.find((message) => message.role === 'assistant')
    expect(JSON.parse(assistantMessage?.thinkingBlocks ?? '[]')).toEqual([
      { blockId: 'codex-activity', content: 'Starting Codex CLI.\n', done: true },
    ])
    expect(state.messages.some((message) => message.content.includes('No provider configured'))).toBe(false)
  })

  it('aborts the active provider stream', async () => {
    const handler = state.handlers.get('chat:stop-generation') as (...args: unknown[]) => Promise<boolean>

    await expect(handler({}, 'conv-1')).resolves.toBe(true)
    expect(state.abortActiveStream).toHaveBeenCalledWith('conv-1')
  })

  it('broadcasts messages and stream-end to mobile after orchestration completes', async () => {
    // Set up database to return a project with orchestrationEnabled=true and two agents
    state.getOverrides.set('SELECT name, config_json FROM projects', {
      name: 'Test Project',
      config_json: JSON.stringify({ orchestrationEnabled: true }),
    })
    state.getOverrides.set('SELECT project_id FROM conversations', { project_id: 'proj-1' })
    state.allOverrides.set('project_agents pa JOIN agents', [
      { agent_id: 'agent-leader', is_primary: 1, sort_order: 0, config_json: JSON.stringify({ name: 'Leader', icon: '🎯' }) },
      { agent_id: 'agent-worker', is_primary: 0, sort_order: 1, config_json: JSON.stringify({ name: 'Worker', icon: '🔨' }) },
    ])

    vi.mocked(runOrchestration).mockResolvedValueOnce({
      finalContent: 'Orchestrated answer',
      teamActivity: [],
    })

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>
    const result = await handler({ sender: {} }, 'conv-orch', 'Do the thing', { projectId: 'proj-1' })

    expect(result.assistantMsgId).toBeTruthy()
    expect(vi.mocked(runOrchestration)).toHaveBeenCalledOnce()

    // Android must receive messages push before stream-end so the UI can update
    expect(state.events).toContain('mobile:messages')
    expect(state.events).toContain('mobile:stream-end')
    expect(state.events.indexOf('mobile:messages')).toBeLessThan(state.events.indexOf('mobile:stream-end'))
    expect(state.events).toContain('mobile:complete')

    const assistantMessage = state.messages.find((m) => m.role === 'assistant')
    expect(assistantMessage?.content).toBe('Orchestrated answer')
  })

  it('broadcasts error and stream-end to mobile when orchestration throws', async () => {
    state.getOverrides.set('SELECT name, config_json FROM projects', {
      name: 'Test Project',
      config_json: JSON.stringify({ orchestrationEnabled: true }),
    })
    state.getOverrides.set('SELECT project_id FROM conversations', { project_id: 'proj-1' })
    state.allOverrides.set('project_agents pa JOIN agents', [
      { agent_id: 'agent-leader', is_primary: 1, sort_order: 0, config_json: JSON.stringify({ name: 'Leader', icon: '🎯' }) },
      { agent_id: 'agent-worker', is_primary: 0, sort_order: 1, config_json: JSON.stringify({ name: 'Worker', icon: '🔨' }) },
    ])

    vi.mocked(runOrchestration).mockRejectedValueOnce(new Error('Orchestration network error'))

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>
    const result = await handler({ sender: {} }, 'conv-orch-err', 'Do the thing', { projectId: 'proj-1' })

    expect(result.assistantMsgId).toBeTruthy()
    expect(state.events).toContain('mobile:messages')
    expect(state.events).toContain('mobile:stream-end')
    expect(state.events).toContain('mobile:error')
    const assistantMessage = state.messages.find((m) => m.role === 'assistant')
    expect(assistantMessage?.content).toContain('Orchestration network error')
  })
})
