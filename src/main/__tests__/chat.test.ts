import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import path from 'path'

const state = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const messages: Array<{ role: string; content: string; attachments: string | null; model: string | null; thinkingBlocks: string | null }> = []
  const modelUpdates: Array<{ sql: string; model: unknown; conversationId: unknown }> = []
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
  const recordProjectAuditChange = vi.fn()
  return { handlers, messages, modelUpdates, events, send, broadcastToMobile, abortActiveStream, getOverrides, allOverrides, recordProjectAuditChange }
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
          const role = String(args[2])
          // Column order differs by role: the assistant insert (persistAssistantMessage) is
          // (…, timestamp, model, thinking_blocks, …) so model is args[6]; the user insert is
          // (…, timestamp, model) so model is args[7].
          const model = role === 'assistant'
            ? (typeof args[6] === 'string' ? args[6] : null)
            : (typeof args[7] === 'string' ? args[7] : null)
          state.messages.push({
            role,
            content: String(args[3]),
            attachments: typeof args[4] === 'string' ? args[4] : null,
            model,
            thinkingBlocks: typeof args[7] === 'string' ? args[7] : null,
          })
          if (role === 'assistant') state.events.push('db:assistant-insert')
        }
        if (sql.includes('UPDATE conversations SET model = ?')) {
          state.modelUpdates.push({ sql, model: args[0], conversationId: args[1] })
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
    getAllWindows: () => [],
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
    workflowMode: 'single-agent',
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
vi.mock('../file-handlers', () => ({ listDirectoryEntries: vi.fn(() => []), getWorkingDirectory: vi.fn(() => '/mock-cwd') }))
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
vi.mock('../project-audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../project-audit')>()
  // inferProjectAuditTarget stays real — it's pure path-matching logic against the (mocked)
  // getDatabase() projects table, worth exercising for real. recordProjectAuditChange is spied
  // so tests can assert on it without needing the fake db to actually persist rows.
  return { ...actual, recordProjectAuditChange: state.recordProjectAuditChange }
})
vi.mock('../chat-context-builder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../chat-context-builder')>()
  // Wrapped in vi.fn() so a single test can override it (e.g. simulate an unexpected
  // throw) via mockRejectedValueOnce, while every other test still gets the real
  // implementation by default.
  return { ...actual, buildChatContext: vi.fn(actual.buildChatContext) }
})
vi.mock('../providers', () => ({
  DEFAULT_PROVIDER_MODEL: 'gpt-5-mini',
  NO_PROVIDER_CONFIGURED_MESSAGE: 'No provider configured. Add an API key in Settings.',
  getProviderForAgent: vi.fn(() => ({ provider: 'openai', model: 'gpt-4o' })),
  getApiKey: vi.fn(() => 'test-key'),
  getOpenRouterModels: vi.fn(() => []),
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
import { runProviderMcpToolLoop } from '../tool-loop'
import { buildChatContext } from '../chat-context-builder'
import { getActivitySnapshot } from '../activity-tracker'
import { parseProjectConfig } from '../project-handlers'
import { DEFAULT_PROJECT_CONFIG } from '../../shared/types'

describe('chat handlers', () => {
  beforeEach(() => {
    state.handlers.clear()
    state.messages.length = 0
    state.modelUpdates.length = 0
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
    vi.mocked(runProviderMcpToolLoop).mockReset()
    vi.mocked(requestApproval).mockResolvedValue(false)
    state.recordProjectAuditChange.mockClear()
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
      data: expect.objectContaining({ conversationId: 'conv-1', state: 'thinking', label: 'Preparing context' }),
    })
    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'chat:activity',
      data: expect.objectContaining({ conversationId: 'conv-1', state: 'thinking', label: 'Generating response' }),
    })
    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'chat:activity',
      data: expect.objectContaining({ conversationId: 'conv-1', state: 'complete', label: 'Complete' }),
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
      data: expect.objectContaining({ conversationId: 'conv-byok-thinking', blockId: 'reasoning-0', chunk: 'Checking context.' }),
    })
    const assistantMessage = state.messages.find((message) => message.role === 'assistant')
    expect(JSON.parse(assistantMessage?.thinkingBlocks ?? '[]')).toEqual([
      { blockId: 'reasoning-0', content: 'Checking context.', done: true, firstSeenAt: expect.any(Number) },
    ])
  })

  it('routes BYOK provider tool-loop events through normalized chat turn events', async () => {
    vi.mocked(getAgentConfig).mockReturnValue({
      id: 'agent-tools',
      name: 'Tool Agent',
      systemPrompt: 'Use tools.',
      mcpServers: ['server-1'],
      agenticMode: true,
    } as never)
    vi.mocked(getAvailableMcpTools).mockReturnValue([{
      name: 'browser_snapshot',
      serverId: 'server-1',
      serverName: 'Browser',
    }])
    vi.mocked(runProviderMcpToolLoop).mockImplementationOnce(async (
      _caller,
      _messages,
      _toolDefs,
      _toolMap,
      _agentId,
      _conversationId,
      _webContents,
      onChunk,
      _onModel,
      _agenticMode,
      _inlineHandlers,
      _toolDirective,
      _onActivity,
      _autoApproveTools,
      _toolPolicy,
      onToolFinished,
    ) => {
      onToolFinished?.({
        conversationId: 'conv-byok-tool',
        toolName: 'browser_snapshot',
        serverName: 'Browser',
        args: { tab: 'active' },
        result: 'Snapshot captured',
        success: true,
      })
      onChunk('Done')
      return 'Done'
    })

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>
    await handler({ sender: {} }, 'conv-byok-tool', 'Inspect page', { agentId: 'agent-tools' })

    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'chat:tool-call-event',
      data: expect.objectContaining({
        conversationId: 'conv-byok-tool',
        toolName: 'browser_snapshot',
        serverName: 'Browser',
        args: { tab: 'active' },
        result: 'Snapshot captured',
        success: true,
        turnId: expect.any(String),
        sequence: expect.any(Number),
      }),
    })
    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'chat:turn-event',
      data: expect.objectContaining({
        conversationId: 'conv-byok-tool',
        type: 'tool_finished',
        toolName: 'browser_snapshot',
        result: 'Snapshot captured',
      }),
    })
  })

  it('CLI path sends conversation:messages before chat:stream-end so Android history is loaded before stream closes', async () => {
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (_win: unknown, _req: unknown, onChunk: (chunk: string) => void) => {
        onChunk('cli response')
        return 'cli response'
      }),
    }
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>
    await handler({ sender: {} }, 'conv-cli-order', 'Hello there')

    expect(state.events).toContain('db:assistant-insert')
    expect(state.events).toContain('mobile:messages')
    expect(state.events).toContain('mobile:stream-end')
    expect(state.events.indexOf('db:assistant-insert')).toBeLessThan(state.events.indexOf('mobile:stream-end'))
    expect(state.events.indexOf('mobile:messages')).toBeLessThan(state.events.indexOf('mobile:stream-end'))
  })

  it('routes through the forced agent CLI backend even when a provider model is supplied', async () => {
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async () => 'cli response'),
    }
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(CodexAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(getAgentConfig).mockReturnValue({
      id: 'agent-1',
      name: 'Project Agent',
      icon: 'A',
      systemPrompt: '',
      backend: 'codex-cli',
      cliModel: 'gpt-5.5',
    } as never)
    vi.mocked(sendOpenAIMessage).mockClear()
    state.getOverrides.set('SELECT agent_id, model, cli_backend', {
      agent_id: 'agent-1',
      model: 'gpt-5-mini',
      cli_backend: null,
    })

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-provider-override', 'Hello there', { model: 'gpt-5-mini' })

    expect(mockAdapter.send).toHaveBeenCalled()
    expect(sendOpenAIMessage).not.toHaveBeenCalled()
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
      data: expect.objectContaining({ conversationId: 'conv-cli-thinking', blockId: 'codex-activity', chunk: 'Starting Codex CLI.\n' }),
    })
    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'chat:thinking-end',
      data: expect.objectContaining({ conversationId: 'conv-cli-thinking', blockId: 'codex-activity' }),
    })
    const assistantMessage = state.messages.find((message) => message.role === 'assistant')
    expect(JSON.parse(assistantMessage?.thinkingBlocks ?? '[]')).toEqual([
      { blockId: 'codex-activity', content: 'Starting Codex CLI.\n', done: true, firstSeenAt: expect.any(Number) },
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

  it('asks for the exact PowerShell command when Claude CLI attempts it', async () => {
    const capturedReqs: Array<{
      allowedTools?: string[]
      requestPermission?: (toolName: string, input: Record<string, unknown>) => Promise<boolean>
    }> = []
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (_win: unknown, req: {
        allowedTools?: string[]
        requestPermission?: (toolName: string, input: Record<string, unknown>) => Promise<boolean>
      }) => {
        capturedReqs.push(req)
        expect(await req.requestPermission?.('PowerShell', { command: 'Get-ChildItem -Force' })).toBe(true)
        return 'cli response'
      }),
    }
    vi.mocked(getAgentConfig).mockReturnValue({
      id: 'agent-terminal',
      name: 'Terminal Agent',
      systemPrompt: 'Inspect the workspace.',
      mcpServers: [],
      agenticMode: false,
      tools: {
        fileEdit: { enabled: false, approval: 'always-ask', instructions: '' },
        terminal: { enabled: true, approval: 'always-ask', instructions: '' },
        webFetch: { enabled: false, approval: 'always-ask', instructions: '' },
      },
    } as never)
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)
    vi.mocked(requestApproval).mockResolvedValue(true)

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-terminal', 'inspect files', { agentId: 'agent-terminal' })

    expect(requestApproval).toHaveBeenCalledWith(
      expect.anything(),
      'claude-cli:terminal',
      { command: 'Get-ChildItem -Force' },
      'Allow Claude CLI to run terminal commands for this message?',
      { onRemember: expect.any(Function) },
    )
    // always-ask tools are deliberately absent from --allowedTools; the live
    // PermissionRequest hook pauses and asks only if Claude actually calls one.
    expect(capturedReqs[0].allowedTools).toBeUndefined()
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
      { blockId: 'codex-activity', content: 'Starting Codex CLI.\n', done: true, firstSeenAt: expect.any(Number) },
    ])
    expect(state.messages.some((message) => message.content.includes('No provider configured'))).toBe(false)
  })

  it('threads the conversation cli_mode_override into the CLI adapter request as permissionMode', async () => {
    const capturedReqs: Array<{ permissionMode?: string }> = []
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (_win: unknown, req: { permissionMode?: string }) => {
        capturedReqs.push({ permissionMode: req.permissionMode })
        return 'cli response'
      }),
    }
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)
    state.getOverrides.set('SELECT agent_id, model, cli_backend', {
      agent_id: null,
      model: null,
      cli_backend: null,
      cli_mode_override: 'plan',
    })

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-cli-mode', 'hello there')

    expect(capturedReqs).toHaveLength(1)
    expect(capturedReqs[0].permissionMode).toBe('plan')
  })

  it('labels the assistant message with the explicitly selected model', async () => {
    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>
    await handler({ sender: {} }, 'conv-model-label', 'Hello there', { model: 'gpt-5.4-mini' })

    const assistantMessage = state.messages.find((message) => message.role === 'assistant')
    expect(assistantMessage?.model).toBe('gpt-5.4-mini')
  })

  it('syncs conversations.model unconditionally to the selected model so later un-modeled messages do not fall back to a stale model', async () => {
    // Regression: conversations.model was only written while NULL/'default', so after the
    // first turn the desktop picker and the stored model diverged. A later message that
    // arrived without its own override (e.g. the Android companion omitting it) then
    // resolved to — and was generated by — the stale stored model.
    state.getOverrides.set('SELECT agent_id, model, cli_backend', {
      agent_id: null,
      model: 'gpt-5.5', // stale value locked in on an earlier turn
      cli_backend: null,
    })

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>
    await handler({ sender: {} }, 'conv-model-sync', 'Hello there', { model: 'gpt-5.4-mini' })

    const modelSync = state.modelUpdates.find((u) => u.conversationId === 'conv-model-sync')
    expect(modelSync).toBeDefined()
    expect(modelSync?.model).toBe('gpt-5.4-mini')
    // The update must be unconditional — not gated on the column still being NULL/'default'.
    expect(modelSync?.sql).not.toContain('IS NULL')
  })

  it('labels an un-modeled message with the conversation model (fallback path)', async () => {
    // With the sync in place, conversations.model tracks the last explicit selection, so the
    // fallback used for a message that carries no override resolves to the intended model.
    state.getOverrides.set('SELECT agent_id, model, cli_backend', {
      agent_id: null,
      model: 'gpt-5.4-mini',
      cli_backend: null,
    })

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>
    await handler({ sender: {} }, 'conv-model-fallback', 'Hello there')

    const assistantMessage = state.messages.find((message) => message.role === 'assistant')
    expect(assistantMessage?.model).toBe('gpt-5.4-mini')
  })

  it('aborts the active provider stream', async () => {
    const handler = state.handlers.get('chat:stop-generation') as (...args: unknown[]) => Promise<boolean>

    await expect(handler({}, 'conv-1')).resolves.toBe(true)
    expect(state.abortActiveStream).toHaveBeenCalledWith('conv-1')
  })

  it('closes out the background activity entry when an unexpected error occurs before any provider/CLI dispatch begins', async () => {
    // buildChatContext runs before any of the branch-specific try/catch blocks — an
    // unhandled throw there used to skip every turnEmitter.closeStream()/sendStreamEnd()
    // call, leaving the chat's activity-tracker entry ("still generating") stuck forever.
    vi.mocked(buildChatContext).mockRejectedValueOnce(new Error('context build blew up'))

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-context-crash', 'Hello there')

    expect(state.send).toHaveBeenCalledWith('chat:stream-error', expect.objectContaining({
      message: 'context build blew up',
    }))
    // chat:stream-response with a null payload is how closeStream signals the turn ended.
    expect(state.send).toHaveBeenCalledWith('chat:stream-response', null)
    const assistantMessage = state.messages.find((message) => message.role === 'assistant')
    expect(assistantMessage?.content).toBe('context build blew up')
    expect(getActivitySnapshot().some((activity) => activity.id === 'chat:conv-context-crash')).toBe(false)
  })

  it('clears the background activity entry after a successful CLI turn that includes a failed tool call followed by a retry', async () => {
    // Reproduces a reported "Activity" sidebar badge stuck on 'Assistant is responding…'
    // after a normal, fully-completed CLI response — specifically one where the CLI's own
    // agentic loop hit a tool_use_error (e.g. writing to a file it hadn't read yet) and
    // recovered with a follow-up tool call before finishing successfully.
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (_win: unknown, _req: unknown, onChunk: (chunk: string) => void, onEvent: (event: unknown) => void) => {
        onEvent({ type: 'tool_start', id: 'call-1', name: 'Write', input: { file_path: 'x.test' } })
        onEvent({ type: 'tool_end', id: 'call-1', content: '<tool_use_error>File has not been read yet.</tool_use_error>', isError: true })
        onEvent({ type: 'tool_start', id: 'call-2', name: 'Read', input: { file_path: 'x.test' } })
        onEvent({ type: 'tool_end', id: 'call-2', content: '1  // ok', isError: false })
        onEvent({ type: 'cost', totalCostUsd: 0.06, inputTokens: 26, outputTokens: 1130 })
        onChunk('It is ready to go!')
        return 'It is ready to go!'
      }),
    }
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>
    await handler({ sender: {} }, 'conv-cli-retry', 'This is a test.')

    expect(state.send).toHaveBeenCalledWith('chat:stream-response', null)
    expect(getActivitySnapshot().some((activity) => activity.id === 'chat:conv-cli-retry')).toBe(false)
  })

  it('records a CLI-driven file edit in Project Audit with a real diff, matching what write_project_file already does for BYOK chat', async () => {
    // Regression: Claude CLI / Codex CLI edit files directly inside their own subprocess, so
    // Nexy only ever saw a plain ToolCallBlock for these edits — no diff, no undo, no entry in
    // Project Settings -> Changes — unlike write_project_file (BYOK chat's own file tool), which
    // has always called recordProjectAuditChange. This exercises the tool_start (snapshot
    // "before") / tool_end (diff against "after") flow added to close that gap.
    const testRoot = path.join(process.cwd(), '.test-chat-cli-audit')
    const targetFile = path.join(testRoot, 'src', 'example.ts')
    mkdirSync(path.dirname(targetFile), { recursive: true })
    writeFileSync(targetFile, 'export const value = 1\n', 'utf8')

    state.allOverrides.set('SELECT id, config_json FROM projects', [
      { id: 'proj-1', config_json: JSON.stringify({ rootDirectory: testRoot }) },
    ])

    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (_win: unknown, _req: unknown, onChunk: (chunk: string) => void, onEvent: (event: unknown) => void) => {
        onEvent({ type: 'tool_start', id: 'call-1', name: 'Write', input: { file_path: targetFile, content: 'export const value = 2\n' } })
        // Simulates the CLI subprocess actually performing the edit on disk between the two
        // events — Nexy never writes this itself, it only observes tool_start/tool_end.
        writeFileSync(targetFile, 'export const value = 2\n', 'utf8')
        onEvent({ type: 'tool_end', id: 'call-1', content: 'File written', isError: false })
        onChunk('Done')
        return 'Done'
      }),
    }
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)

    try {
      const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>
      await handler({ sender: {} }, 'conv-cli-audit', 'edit the file', { projectId: 'proj-1' })

      expect(state.recordProjectAuditChange).toHaveBeenCalledWith(expect.objectContaining({
        projectId: 'proj-1',
        source: 'cli-tool',
        relativePath: 'src/example.ts',
        status: 'modified',
        lastOperation: 'write',
        diff: { hunks: expect.arrayContaining([expect.objectContaining({
          lines: expect.arrayContaining([
            expect.objectContaining({ type: 'removed', content: 'export const value = 1' }),
            expect.objectContaining({ type: 'added', content: 'export const value = 2' }),
          ]),
        })]) },
      }))
    } finally {
      rmSync(testRoot, { recursive: true, force: true })
    }
  })

  it('does not record Project Audit for a failed CLI file-edit tool call', async () => {
    const testRoot = path.join(process.cwd(), '.test-chat-cli-audit-fail')
    const targetFile = path.join(testRoot, 'src', 'example.ts')
    mkdirSync(path.dirname(targetFile), { recursive: true })
    writeFileSync(targetFile, 'export const value = 1\n', 'utf8')

    state.allOverrides.set('SELECT id, config_json FROM projects', [
      { id: 'proj-1', config_json: JSON.stringify({ rootDirectory: testRoot }) },
    ])

    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (_win: unknown, _req: unknown, onChunk: (chunk: string) => void, onEvent: (event: unknown) => void) => {
        onEvent({ type: 'tool_start', id: 'call-1', name: 'Write', input: { file_path: targetFile, content: 'export const value = 2\n' } })
        onEvent({ type: 'tool_end', id: 'call-1', content: '<tool_use_error>Permission denied</tool_use_error>', isError: true })
        onChunk('Could not write the file.')
        return 'Could not write the file.'
      }),
    }
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)

    try {
      const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>
      await handler({ sender: {} }, 'conv-cli-audit-fail', 'edit the file', { projectId: 'proj-1' })

      expect(state.recordProjectAuditChange).not.toHaveBeenCalled()
    } finally {
      rmSync(testRoot, { recursive: true, force: true })
    }
  })

  it('attaches a real diff when write_project_file overwrites an existing file, matching the CLI-driven audit path', async () => {
    // Regression: write_project_file recorded a Project Audit entry with no diff at all
    // (diff omitted entirely), so AuditTab.tsx's "View diff" only ever lit up for
    // Code-Changes-sourced rows even though every source rendered the same affordance.
    const testRoot = path.join(process.cwd(), '.test-chat-write-project-file')
    const targetFile = path.join(testRoot, 'notes.md')
    mkdirSync(testRoot, { recursive: true })
    writeFileSync(targetFile, 'old notes', 'utf8')

    vi.mocked(parseProjectConfig).mockReturnValueOnce({
      ...DEFAULT_PROJECT_CONFIG,
      rootDirectory: testRoot,
    } as ReturnType<typeof parseProjectConfig>)
    vi.mocked(requestApproval).mockResolvedValue(true)
    // inferProjectAuditTarget (called inside write_project_file) resolves the project via
    // getDatabase() directly, independent of the stubDb passed to buildChatContext below.
    state.allOverrides.set('SELECT id, config_json FROM projects', [
      { id: 'proj-1', config_json: JSON.stringify({ rootDirectory: testRoot }) },
    ])

    const stubDb = {
      prepare: (sql: string) => ({
        get: () => (sql.includes('COUNT(*)') ? { count: 0 } : undefined),
        all: () => [],
        run: () => ({ changes: 1 }),
      }),
    } as unknown as Parameters<typeof buildChatContext>[0]
    const stubWebContents = { isDestroyed: () => false } as unknown as Parameters<typeof buildChatContext>[4]

    try {
      const built = await buildChatContext(
        stubDb, 'conv-write-project-file', 'update notes.md',
        { projectId: 'proj-1' }, stubWebContents, vi.fn(),
      )
      const writeHandler = built.fileInlineHandlers.get('write_project_file')!
      const result = await writeHandler({ path: 'notes.md', content: 'new notes' })

      expect(result.success).toBe(true)
      expect(state.recordProjectAuditChange).toHaveBeenCalledWith(expect.objectContaining({
        source: 'chat-tool',
        relativePath: 'notes.md',
        status: 'modified',
        lastOperation: 'write',
        diff: { hunks: expect.arrayContaining([expect.objectContaining({
          lines: expect.arrayContaining([
            expect.objectContaining({ type: 'removed', content: 'old notes' }),
            expect.objectContaining({ type: 'added', content: 'new notes' }),
          ]),
        })]) },
      }))
    } finally {
      rmSync(testRoot, { recursive: true, force: true })
    }
  })

  it('broadcasts messages and stream-end to mobile after orchestration completes', async () => {
    // Set up database to return a project with orchestrationEnabled=true and two agents
    state.getOverrides.set('SELECT name, config_json FROM projects', {
      name: 'Test Project',
      config_json: JSON.stringify({ workflowMode: 'orchestrated', orchestrationEnabled: true }),
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
      config_json: JSON.stringify({ workflowMode: 'orchestrated', orchestrationEnabled: true }),
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
