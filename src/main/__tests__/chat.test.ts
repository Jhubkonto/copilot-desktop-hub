import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const messages: Array<{ role: string; content: string }> = []
  const send = vi.fn()
  const broadcastToMobile = vi.fn()
  const abortActiveStream = vi.fn()
  return { handlers, messages, send, broadcastToMobile, abortActiveStream }
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
          state.messages.push({ role: String(args[2]), content: String(args[3]) })
        }
        return { changes: 1 }
      },
      get: () => ({ agent_id: null, model: null }),
      all: () => [],
    }),
  }),
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: () => ({ webContents: { send: state.send, isDestroyed: () => false } }),
  },
}))

vi.mock('../agents', () => ({ getAgentConfig: vi.fn(() => null) }))
vi.mock('../project-handlers', () => ({ parseProjectConfig: vi.fn(() => null) }))
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
vi.mock('../ws-server', () => ({ broadcastToMobile: state.broadcastToMobile }))
vi.mock('../auth', () => ({ retrieveAuthMode: vi.fn(() => 'byok') }))
vi.mock('../wiki-context', () => ({ getRelevantWikiEntries: vi.fn(() => []), formatWikiSection: vi.fn(() => '') }))
vi.mock('../wiki-handlers', () => ({ insertWikiEntry: vi.fn() }))
vi.mock('../tools', () => ({ requestApproval: vi.fn(), registerApprovalResolver: vi.fn() }))
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

describe('chat handlers', () => {
  beforeEach(() => {
    state.handlers.clear()
    state.messages.length = 0
    state.send.mockClear()
    state.broadcastToMobile.mockClear()
    state.abortActiveStream.mockClear()
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

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-cli', 'tell me something')

    expect(capturedReqs).toHaveLength(1)
    // Must NOT contain the BYOK model identity instruction
    expect(capturedReqs[0].systemPrompt ?? '').not.toContain('gpt-5-mini')
    expect(capturedReqs[0].systemPrompt ?? '').not.toContain('Runtime model for this conversation')
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
      send: vi.fn(async () => {
        throw new Error('claude failed after running MCP tools')
      }),
    }
    vi.mocked(getAgentConfig).mockReturnValue(null)
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-cli-error', 'open google')

    expect(mockAdapter.send).toHaveBeenCalled()
    expect(state.send).toHaveBeenCalledWith('chat:stream-error', expect.objectContaining({
      message: 'claude failed after running MCP tools',
    }))
    expect(state.messages.some((message) => message.content.includes('No provider configured'))).toBe(false)
  })

  it('aborts the active provider stream', async () => {
    const handler = state.handlers.get('chat:stop-generation') as (...args: unknown[]) => Promise<boolean>

    await expect(handler({}, 'conv-1')).resolves.toBe(true)
    expect(state.abortActiveStream).toHaveBeenCalledWith('conv-1')
  })
})
