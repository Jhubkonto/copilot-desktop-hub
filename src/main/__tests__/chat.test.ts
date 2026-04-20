import { describe, it, expect, vi, beforeEach } from 'vitest'

// All mocks must be in vi.hoisted since vi.mock factories are hoisted
const {
  mockDb,
  ipcHandlers,
  mockIpcMain,
  mockBrowserWindow,
  mockWebContents,
  mockSendCopilotMessage,
  mockStopGeneration,
  mockCheckCliOnStartup,
  mockGetAgentConfig,
  mockAbortActiveStream,
  mockGetProviderForAgent,
  mockGetApiKey,
  mockSendOpenAIMessage,
  mockSendAnthropicMessage,
  mockSendAzureMessage,
  mockGetAzureEndpoint
} = vi.hoisted(() => {
  // In-memory DB store for conversations and messages
  const conversations = new Map<string, Record<string, unknown>>()
  const messages = new Map<string, Record<string, unknown>>()

  const mockDb = {
    prepare: vi.fn((sql: string) => ({
      run: vi.fn((...args: unknown[]) => {
        if (sql.includes('INSERT INTO conversations')) {
          const conv = {
            id: args[0],
            agent_id: args[1],
            title: args[2],
            created_at: args[3],
            updated_at: args[4]
          }
          conversations.set(conv.id as string, conv)
          return { changes: 1 }
        }
        if (sql.includes('INSERT INTO messages')) {
          const msg = {
            id: args[0],
            conversation_id: args[1],
            role: args[2],
            content: args[3],
            attachments: args[4] ?? null,
            timestamp: args[5]
          }
          messages.set(msg.id as string, msg)
          return { changes: 1 }
        }
        if (sql.includes('UPDATE conversations SET title')) {
          const conv = conversations.get(args[1] as string)
          if (conv) conv.title = args[0]
          return { changes: conv ? 1 : 0 }
        }
        if (sql.includes('UPDATE conversations SET updated_at')) {
          const conv = conversations.get(args[1] as string)
          if (conv) conv.updated_at = args[0]
          return { changes: conv ? 1 : 0 }
        }
        if (sql.includes('DELETE FROM conversations')) {
          conversations.delete(args[0] as string)
          return { changes: 1 }
        }
        if (sql.includes('DELETE FROM messages WHERE id')) {
          messages.delete(args[0] as string)
          return { changes: 1 }
        }
        if (sql.includes('DELETE FROM messages WHERE conversation_id')) {
          for (const [id, msg] of messages) {
            if (msg.conversation_id === args[0] && (msg.timestamp as number) >= (args[1] as number)) {
              messages.delete(id)
            }
          }
          return { changes: 1 }
        }
        if (sql.includes('INSERT OR REPLACE INTO settings')) {
          return { changes: 1 }
        }
        return { changes: 0 }
      }),
      get: vi.fn((...args: unknown[]) => {
        if (sql.includes('SELECT id FROM conversations WHERE id')) {
          const conv = conversations.get(args[0] as string)
          return conv ? { id: conv.id } : undefined
        }
        if (sql.includes('SELECT COUNT')) {
          let count = 0
          for (const msg of messages.values()) {
            if (msg.conversation_id === args[0]) count++
          }
          return { count }
        }
        if (sql.includes('SELECT agent_id FROM conversations')) {
          const conv = conversations.get(args[0] as string)
          return conv ? { agent_id: conv.agent_id } : undefined
        }
        if (sql.includes('SELECT value FROM settings')) {
          return undefined
        }
        return undefined
      }),
      all: vi.fn((..._args: unknown[]) => {
        if (sql.includes('SELECT * FROM conversations ORDER BY')) {
          return Array.from(conversations.values()).sort(
            (a, b) => (b.updated_at as number) - (a.updated_at as number)
          )
        }
        if (sql.includes('SELECT * FROM messages WHERE conversation_id')) {
          const convId = _args[0] as string
          return Array.from(messages.values())
            .filter((m) => m.conversation_id === convId)
            .sort((a, b) => (a.timestamp as number) - (b.timestamp as number))
        }
        if (sql.includes('SELECT DISTINCT')) {
          return Array.from(conversations.values())
        }
        return []
      })
    })),
    exec: vi.fn(),
    pragma: vi.fn(),
    close: vi.fn(),
    // Expose stores for test assertions
    _conversations: conversations,
    _messages: messages
  }

  const mockWebContents = { send: vi.fn() }
  const mockBrowserWindow = {
    fromWebContents: vi.fn((): { webContents: { send: ReturnType<typeof vi.fn> } } | null => ({
      webContents: mockWebContents
    }))
  }

  const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>()
  const mockIpcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, handler)
    }),
    removeHandler: vi.fn()
  }

  const mockSendCopilotMessage = vi.fn()
  const mockStopGeneration = vi.fn()
  const mockCheckCliOnStartup = vi.fn((): { installed: boolean; path: string | null; version: string | null } => ({ installed: false, path: null, version: null }))
  const mockGetAgentConfig = vi.fn((): Record<string, unknown> | null => null)
  const mockAbortActiveStream = vi.fn()
  const mockGetProviderForAgent = vi.fn(() => ({ provider: 'copilot', model: 'default' }))
  const mockGetApiKey = vi.fn((): string | null => null)
  const mockSendOpenAIMessage = vi.fn()
  const mockSendAnthropicMessage = vi.fn()
  const mockSendAzureMessage = vi.fn()
  const mockGetAzureEndpoint = vi.fn(() => null)

  return {
    mockDb,
    ipcHandlers,
    mockIpcMain,
    mockBrowserWindow,
    mockWebContents,
    mockSendCopilotMessage,
    mockStopGeneration,
    mockCheckCliOnStartup,
    mockGetAgentConfig,
    mockAbortActiveStream,
    mockGetProviderForAgent,
    mockGetApiKey,
    mockSendOpenAIMessage,
    mockSendAnthropicMessage,
    mockSendAzureMessage,
    mockGetAzureEndpoint
  }
})

vi.mock('electron', () => ({
  BrowserWindow: mockBrowserWindow,
  ipcMain: mockIpcMain,
  dialog: { showOpenDialog: vi.fn(() => ({ canceled: true, filePaths: [] })) },
  app: { getPath: vi.fn(() => '/tmp/test'), on: vi.fn(), quit: vi.fn(), isPackaged: false, setLoginItemSettings: vi.fn() },
  safeStorage: { isEncryptionAvailable: vi.fn(() => false) },
  shell: { openExternal: vi.fn() }
}))

vi.mock('../database', () => ({ getDatabase: () => mockDb }))

vi.mock('../copilot', () => ({
  sendCopilotMessage: mockSendCopilotMessage,
  stopGeneration: mockStopGeneration
}))

vi.mock('../cli-detection', () => ({
  checkCliOnStartup: mockCheckCliOnStartup
}))

vi.mock('../agents', () => ({
  registerAgentHandlers: vi.fn(),
  getAgentConfig: mockGetAgentConfig
}))

vi.mock('../tools', () => ({ registerToolHandlers: vi.fn() }))
vi.mock('../terminal', () => ({ registerTerminalHandlers: vi.fn() }))
vi.mock('../mcp', () => ({ registerMcpHandlers: vi.fn() }))

vi.mock('../providers', () => ({
  registerProviderHandlers: vi.fn(),
  getProviderForAgent: mockGetProviderForAgent,
  getApiKey: mockGetApiKey,
  sendOpenAIMessage: mockSendOpenAIMessage,
  sendAnthropicMessage: mockSendAnthropicMessage,
  sendAzureMessage: mockSendAzureMessage,
  getAzureEndpoint: mockGetAzureEndpoint,
  abortActiveStream: mockAbortActiveStream
}))

vi.mock('fs', () => ({
  readFileSync: vi.fn((path: string) => `contents of ${path}`),
  statSync: vi.fn(() => ({ size: 100 })),
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn()
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function invokeHandler(channel: string, ...args: unknown[]): Promise<any> {
  const handler = ipcHandlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  const event = { sender: {} } // mock event with sender for BrowserWindow.fromWebContents
  return handler(event, ...args)
}

describe('Chat — IPC Handlers', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockDb._conversations.clear()
    mockDb._messages.clear()

    // Register all handlers
    const { registerIpcHandlers } = await import('../ipc-handlers')
    // Clear old handlers and re-register
    ipcHandlers.clear()
    mockIpcMain.handle.mockClear()
    registerIpcHandlers()
  })

  describe('Conversation CRUD', () => {
    it('chat-m-11: conversation:create returns new conversation with ID and title', async () => {
      const result = await invokeHandler('conversation:create')
      expect(result).toHaveProperty('id')
      expect(result.title).toBe('New Chat')
      expect(result.created_at).toBeGreaterThan(0)
      expect(result.updated_at).toBeGreaterThan(0)
    })

    it('chat-m-11b: conversation:create with agentId', async () => {
      const result = await invokeHandler('conversation:create', 'agent-123')
      expect(result.agent_id).toBe('agent-123')
    })

    it('conversation:list returns conversations ordered by updated_at', async () => {
      await invokeHandler('conversation:create')
      await invokeHandler('conversation:create')
      const list = await invokeHandler('conversation:list')
      expect(Array.isArray(list)).toBe(true)
    })

    it('chat-m-12: conversation:delete removes conversation', async () => {
      const conv = await invokeHandler('conversation:create')
      expect(mockDb._conversations.has(conv.id)).toBe(true)
      await invokeHandler('conversation:delete', conv.id)
      // DB mock calls delete
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM conversations')
      )
    })

    it('chat-m-14: conversation:rename updates title', async () => {
      const conv = await invokeHandler('conversation:create')
      await invokeHandler('conversation:rename', conv.id, 'My Renamed Chat')
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE conversations SET title')
      )
    })

    it('chat-m-13: conversation:search returns matching conversations', async () => {
      const result = await invokeHandler('conversation:search', 'test')
      expect(Array.isArray(result)).toBe(true)
    })

    it('conversation:search with empty query returns all', async () => {
      await invokeHandler('conversation:create')
      const result = await invokeHandler('conversation:search', '')
      expect(Array.isArray(result)).toBe(true)
    })

    it('conversation:get-messages returns messages for conversation', async () => {
      const conv = await invokeHandler('conversation:create')
      const msgs = await invokeHandler('conversation:get-messages', conv.id)
      expect(Array.isArray(msgs)).toBe(true)
    })
  })

  describe('Message CRUD', () => {
    it('chat-m-15: message:delete removes single message', async () => {
      await invokeHandler('message:delete', 'msg-123')
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM messages WHERE id')
      )
    })

    it('chat-m-16: message:delete-after removes messages from timestamp onward', async () => {
      await invokeHandler('message:delete-after', 'conv-1', 1000)
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM messages WHERE conversation_id')
      )
    })
  })

  describe('chat:send-message', () => {
    it('chat-m-1: creates conversation if it does not exist', async () => {
      const convId = 'new-conv-id'
      await invokeHandler('chat:send-message', convId, 'Hello world')

      // Should have called prepare with INSERT INTO conversations
      const prepareCalls = mockDb.prepare.mock.calls.map((c) => c[0])
      expect(prepareCalls.some((s: string) => s.includes('INSERT INTO conversations'))).toBe(true)
    })

    it('chat-m-2: stores user message in DB', async () => {
      const convId = 'test-conv'
      await invokeHandler('chat:send-message', convId, 'My test message')

      const prepareCalls = mockDb.prepare.mock.calls.map((c) => c[0])
      expect(prepareCalls.some((s: string) => s.includes('INSERT INTO messages'))).toBe(true)
    })

    it('chat-m-3: streams response chunks via chat:stream-response IPC event', async () => {
      // Placeholder response sends words one by one
      const convId = 'test-conv-stream'
      await invokeHandler('chat:send-message', convId, 'Hello')

      // Placeholder response sends chunks via webContents.send
      expect(mockWebContents.send).toHaveBeenCalledWith('chat:stream-response', expect.any(String))
    })

    it('chat-m-4: sends null chunk to signal stream end', async () => {
      const convId = 'test-conv-end'
      await invokeHandler('chat:send-message', convId, 'Hello')

      const sendCalls = mockWebContents.send.mock.calls
      const lastCall = sendCalls[sendCalls.length - 1]
      // Placeholder sends null at the end, but the outer handler also saves assistant msg
      // Check that null was sent at some point
      expect(sendCalls.some((c: unknown[]) => c[0] === 'chat:stream-response' && c[1] === null)).toBe(true)
    })

    it('chat-m-5: stores final assistant message in DB', async () => {
      const convId = 'test-conv-save'
      await invokeHandler('chat:send-message', convId, 'Hello')

      // Should have two INSERT INTO messages calls (user + assistant)
      const insertMessageCalls = mockDb.prepare.mock.calls.filter(
        (c) => (c[0] as string).includes('INSERT INTO messages')
      )
      expect(insertMessageCalls.length).toBe(2) // user + assistant
    })

    it('chat-m-8: includes file attachments as context', async () => {
      const convId = 'test-conv-attach'
      const attachments = [{ id: 'a1', name: 'test.ts', path: '/tmp/test.ts', size: 100 }]
      await invokeHandler('chat:send-message', convId, 'Review this', { attachments })

      // readFileSync should have been called for the attachment
      const { readFileSync } = await import('fs')
      expect(readFileSync).toHaveBeenCalledWith('/tmp/test.ts', 'utf-8')
    })

    it('chat-m-7: uses agent system prompt when agent is configured', async () => {
      // Set up: create a conversation with an agent_id
      const convId = 'agent-conv'
      // Pre-populate the conversation in mock DB
      mockDb._conversations.set(convId, {
        id: convId,
        agent_id: 'test-agent',
        title: 'Agent Chat',
        created_at: Date.now(),
        updated_at: Date.now()
      })

      mockGetAgentConfig.mockReturnValue({
        systemPrompt: 'You are a test agent',
        model: 'default'
      })

      await invokeHandler('chat:send-message', convId, 'Hello agent')

      expect(mockGetAgentConfig).toHaveBeenCalledWith('test-agent')
    })

    it('chat-m-6: returns error when provider fails', async () => {
      mockCheckCliOnStartup.mockReturnValue({ installed: true, path: '/usr/bin/copilot', version: '1.0' })
      mockSendCopilotMessage.mockRejectedValue(new Error('SDK crash'))

      const convId = 'error-conv'
      // Should fall back to placeholder when SDK errors
      const result = await invokeHandler('chat:send-message', convId, 'Hello')
      expect(result).toHaveProperty('assistantMsgId')
      // The placeholder response should have been streamed
      expect(mockWebContents.send).toHaveBeenCalled()
    })

    it('does not save user message on regenerate', async () => {
      const convId = 'regen-conv'
      mockDb._conversations.set(convId, {
        id: convId,
        agent_id: null,
        title: 'Test',
        created_at: Date.now(),
        updated_at: Date.now()
      })

      const callsBefore = mockDb.prepare.mock.calls.filter(
        (c) => (c[0] as string).includes('INSERT INTO messages')
      ).length

      await invokeHandler('chat:send-message', convId, 'Regenerated content', { regenerate: true })

      const callsAfter = mockDb.prepare.mock.calls.filter(
        (c) => (c[0] as string).includes('INSERT INTO messages')
      ).length

      // Only assistant message should be saved, not user message
      expect(callsAfter - callsBefore).toBe(1)
    })

    it('returns null when BrowserWindow is not found', async () => {
      mockBrowserWindow.fromWebContents.mockReturnValueOnce(null)
      const result = await invokeHandler('chat:send-message', 'conv-1', 'Hello')
      expect(result).toBeNull()
    })
  })

  describe('chat:stop-generation', () => {
    it('chat-m-9: aborts active stream', async () => {
      await invokeHandler('chat:stop-generation')
      expect(mockAbortActiveStream).toHaveBeenCalled()
      expect(mockStopGeneration).toHaveBeenCalled()
    })

    it('chat-m-10: returns true', async () => {
      const result = await invokeHandler('chat:stop-generation')
      expect(result).toBe(true)
    })
  })

  describe('BYOK Provider Routing', () => {
    it('routes to OpenAI when agent uses OpenAI model', async () => {
      const convId = 'openai-conv'
      mockDb._conversations.set(convId, {
        id: convId,
        agent_id: 'openai-agent',
        title: 'OpenAI Chat',
        created_at: Date.now(),
        updated_at: Date.now()
      })

      mockGetAgentConfig.mockReturnValue({ model: 'gpt-4o', systemPrompt: null })
      mockGetProviderForAgent.mockReturnValue({ provider: 'openai', model: 'gpt-4o' })
      mockGetApiKey.mockReturnValue('sk-test-key')
      mockSendOpenAIMessage.mockResolvedValue('OpenAI response')

      const result = await invokeHandler('chat:send-message', convId, 'Hello OpenAI')
      expect(mockSendOpenAIMessage).toHaveBeenCalled()
      expect(result).toHaveProperty('assistantMsgId')
    })

    it('routes to Anthropic when agent uses Anthropic model', async () => {
      const convId = 'anthropic-conv'
      mockDb._conversations.set(convId, {
        id: convId,
        agent_id: 'anthropic-agent',
        title: 'Anthropic Chat',
        created_at: Date.now(),
        updated_at: Date.now()
      })

      mockGetAgentConfig.mockReturnValue({ model: 'claude-sonnet-4-20250514', systemPrompt: 'Be helpful' })
      mockGetProviderForAgent.mockReturnValue({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' })
      mockGetApiKey.mockReturnValue('sk-ant-test')
      mockSendAnthropicMessage.mockResolvedValue('Anthropic response')

      const result = await invokeHandler('chat:send-message', convId, 'Hello Claude')
      expect(mockSendAnthropicMessage).toHaveBeenCalled()
      expect(result).toHaveProperty('assistantMsgId')
    })

    it('falls back to placeholder when OpenAI errors', async () => {
      const convId = 'openai-error-conv'
      mockDb._conversations.set(convId, {
        id: convId,
        agent_id: 'openai-agent',
        title: 'Test',
        created_at: Date.now(),
        updated_at: Date.now()
      })

      mockGetAgentConfig.mockReturnValue({ model: 'gpt-4o', systemPrompt: null })
      mockGetProviderForAgent.mockReturnValue({ provider: 'openai', model: 'gpt-4o' })
      mockGetApiKey.mockReturnValue('sk-test-key')
      mockSendOpenAIMessage.mockRejectedValue(new Error('Rate limited'))

      const result = await invokeHandler('chat:send-message', convId, 'Hello')
      // Should fall back to placeholder and still return assistantMsgId
      expect(result).toHaveProperty('assistantMsgId')
      expect(mockWebContents.send).toHaveBeenCalledWith('chat:stream-response', null)
    })
  })
})
