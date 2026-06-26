import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/* ── Hoisted mocks ─────────────────────────────────────────── */
const { mockIpcMain, mockDb, mockOverrideRows } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const serverRows: { id: string; config_json: string; enabled: number }[] = []
  const overrideRows = new Map<string, { enabled: number; approval: string }>()

  const mockIpcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    _handlers: handlers
  }

  const mockDb = {
    prepare: vi.fn((sql: string) => ({
      run: vi.fn((...args: unknown[]) => {
        if (sql.includes('INSERT OR REPLACE INTO mcp_servers')) {
          const idx = serverRows.findIndex((r) => r.id === args[0])
          const row = { id: args[0] as string, config_json: args[1] as string, enabled: args[2] as number }
          if (idx >= 0) serverRows[idx] = row
          else serverRows.push(row)
        }
        if (sql.includes('DELETE FROM mcp_servers')) {
          const idx = serverRows.findIndex((r) => r.id === args[0])
          if (idx >= 0) serverRows.splice(idx, 1)
        }
        return { changes: 1 }
      }),
      all: vi.fn(() => [...serverRows]),
      get: vi.fn((...args: unknown[]): unknown => {
        if (sql.includes('agent_mcp_tool_overrides')) {
          const key = `${args[0]}:${args[1]}:${args[2]}`
          return overrideRows.get(key)
        }
        return undefined
      })
    })),
    _serverRows: serverRows
  }

  return { mockIpcMain, mockDb, mockOverrideRows: overrideRows }
})

/* ── Mock requestApproval from tools ──────────────────────── */
const { mockRequestApproval } = vi.hoisted(() => ({
  mockRequestApproval: vi.fn().mockResolvedValue(true)
}))

const { MockClient, MockTransport } = vi.hoisted(() => {
  class MockTransport {
    close = vi.fn().mockResolvedValue(undefined)
    onclose?: () => void
  }

  class MockClient {
    connect = vi.fn().mockResolvedValue(undefined)
    listTools = vi.fn().mockResolvedValue({ tools: [] })
    callTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], isError: false })
  }

  return { MockClient, MockTransport }
})

vi.mock('../tools', () => ({
  requestApproval: mockRequestApproval
}))

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: MockClient
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: MockTransport
}))

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))

vi.mock('../database', () => ({
  getDatabase: () => mockDb
}))

/* ── Import & Register ─────────────────────────────────────── */
import { registerMcpHandlers, disconnectServer, shutdownMcpServers, servers, callMcpTool } from '../mcp'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

/* ── Helpers ─────────────────────────────────────────────── */
const fakeSender = {
  id: 1,
  send: vi.fn(),
  isDestroyed: vi.fn().mockReturnValue(false)
}

async function invokeHandler(channel: string, ...args: unknown[]): Promise<any> {
  const handler = mockIpcMain._handlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  const fakeEvent = { sender: fakeSender }
  return handler(fakeEvent, ...args)
}

function makeMockClient() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({ tools: [] }),
    callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], isError: false })
  }
}

/** Directly inject a connected server — bypasses SDK subprocess spawning */
function injectConnectedServer(id: string, name: string, client: ReturnType<typeof makeMockClient>) {
  servers.set(id, {
    config: { id, name, command: 'node', args: [], env: {}, enabled: true },
    client: client as unknown as Client,
    transport: { close: vi.fn().mockResolvedValue(undefined) } as unknown as StdioClientTransport,
    status: 'connected',
    tools: [{ name: 'testTool', description: 'Does a thing', inputSchema: {}, serverId: id, serverName: name }]
  })
}

beforeEach(() => {
  mockDb._serverRows.length = 0
  mockOverrideRows.clear()
  servers.clear()
  vi.useRealTimers()
  vi.clearAllMocks()
  fakeSender.isDestroyed.mockReturnValue(false)
  mockRequestApproval.mockResolvedValue(true)
  registerMcpHandlers()
})

afterEach(async () => {
  await shutdownMcpServers()
  vi.useRealTimers()
})

/* ── Tests ─────────────────────────────────────── */
describe('MCP — IPC Handlers', () => {
  it('mcp:list-servers returns empty when no servers configured', async () => {
    const r = await invokeHandler('mcp:list-servers')
    expect(r).toEqual([])
  })

  it('mcp:add-server stores config and returns with id', async () => {
    const config = { name: 'Test MCP', command: 'node', args: ['server.js'], env: {}, enabled: false }
    const r = await invokeHandler('mcp:add-server', config)
    expect(r.id).toBeDefined()
    expect(r.name).toBe('Test MCP')
    expect(mockDb._serverRows.length).toBe(1)
  })

  it('mcp:add-server returns fullConfig', async () => {
    const config = { name: 'Active Server', command: 'npx', args: ['-y', 'some-mcp'], env: {}, enabled: false }
    const result = await invokeHandler('mcp:add-server', config)
    expect(result.name).toBe('Active Server')
    expect(result.enabled).toBe(false)
    expect(mockDb._serverRows.length).toBe(1)
  })

  it('mcp:remove-server deletes config', async () => {
    const config = { name: 'Tmp', command: 'x', args: [], env: {}, enabled: false }
    const added = await invokeHandler('mcp:add-server', config)
    const r = await invokeHandler('mcp:remove-server', added.id)
    expect(r).toBe(true)
  })

  it('mcp:get-server-status returns disconnected for unknown server', async () => {
    const r = await invokeHandler('mcp:get-server-status', 'nonexistent')
    expect(r.status).toBe('disconnected')
    expect(r.tools).toEqual([])
  })

  it('mcp:list-tools returns empty when no servers connected', async () => {
    const r = await invokeHandler('mcp:list-tools')
    expect(r).toEqual([])
  })
})

describe('MCP — Tool Approval', () => {
  function addTestServer() {
    const id = `test-server-${Math.random().toString(36).slice(2)}`
    const client = makeMockClient()
    injectConnectedServer(id, 'ApprovalServer', client)
    return { id, client }
  }

  it('calls requestApproval when approval is always-ask', async () => {
    const { id: serverId } = addTestServer()
    mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 1, approval: 'always-ask' })

    await invokeHandler('mcp:call-tool', serverId, 'testTool', { x: 1 }, 'agent1')

    expect(mockRequestApproval).toHaveBeenCalledWith(
      fakeSender,
      'testTool',
      { x: 1 },
      expect.any(String),
      { noRemember: true }
    )
  })

  it('executes tool when approval is granted', async () => {
    const { id: serverId, client } = addTestServer()
    mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 1, approval: 'always-ask' })
    mockRequestApproval.mockResolvedValue(true)

    const r = await invokeHandler('mcp:call-tool', serverId, 'testTool', {}, 'agent1')
    expect(r.success).toBe(true)
    expect(client.callTool).toHaveBeenCalled()
  })

  it('denies tool execution when approval is rejected', async () => {
    const { id: serverId, client } = addTestServer()
    mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 1, approval: 'always-ask' })
    mockRequestApproval.mockResolvedValue(false)

    const r = await invokeHandler('mcp:call-tool', serverId, 'testTool', {}, 'agent1')
    expect(r.success).toBe(false)
    expect(r.error).toContain('denied')
    expect(client.callTool).not.toHaveBeenCalled()
  })

  it('auto-approves when approval policy is auto', async () => {
    const { id: serverId, client } = addTestServer()
    mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 1, approval: 'auto' })

    const r = await invokeHandler('mcp:call-tool', serverId, 'testTool', {}, 'agent1')
    expect(r.success).toBe(true)
    expect(mockRequestApproval).not.toHaveBeenCalled()
    expect(client.callTool).toHaveBeenCalled()
  })

  it('defaults to always-ask when no override exists for an agent', async () => {
    const { id: serverId } = addTestServer()
    // No override row — defaults to always-ask
    await invokeHandler('mcp:call-tool', serverId, 'testTool', {}, 'agent1')
    expect(mockRequestApproval).toHaveBeenCalled()
  })

  it('denies when approval is disabled', async () => {
    const { id: serverId, client } = addTestServer()
    mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 1, approval: 'disabled' })

    const r = await invokeHandler('mcp:call-tool', serverId, 'testTool', {}, 'agent1')
    expect(r.success).toBe(false)
    expect(r.error).toContain('disabled')
    expect(mockRequestApproval).not.toHaveBeenCalled()
    expect(client.callTool).not.toHaveBeenCalled()
  })

  it('denies when enabled flag is 0', async () => {
    const { id: serverId, client } = addTestServer()
    mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 0, approval: 'auto' })

    const r = await invokeHandler('mcp:call-tool', serverId, 'testTool', {}, 'agent1')
    expect(r.success).toBe(false)
    expect(r.error).toContain('disabled')
    expect(client.callTool).not.toHaveBeenCalled()
  })

  it('defaults to always-ask when called without agentId', async () => {
    const { id: serverId } = addTestServer()
    await invokeHandler('mcp:call-tool', serverId, 'testTool', {})
    expect(mockRequestApproval).toHaveBeenCalled()
  })

  it('fails closed when always-ask but webContents is destroyed', async () => {
    const { id: serverId, client } = addTestServer()
    fakeSender.isDestroyed.mockReturnValue(true)

    const r = await invokeHandler('mcp:call-tool', serverId, 'testTool', {})
    expect(r.success).toBe(false)
    expect(r.error).toContain('no UI is available')
    expect(mockRequestApproval).not.toHaveBeenCalled()
    expect(client.callTool).not.toHaveBeenCalled()
  })

  describe('Agentic Mode', () => {
    it('auto-approves a tool with no explicit override when agenticMode=true', async () => {
      const { id: serverId, client } = addTestServer()
      // No override row exists — default always-ask — should be bypassed
      client.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'done' }], isError: false })

      const r = await callMcpTool(serverId, 'testTool', {}, 'agent1', fakeSender as unknown as Electron.WebContents, true)
      expect(mockRequestApproval).not.toHaveBeenCalled()
      expect(r.success).toBe(true)
    })

    it('still prompts for an explicit always-ask override even when agenticMode=true', async () => {
      const { id: serverId } = addTestServer()
      mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 1, approval: 'always-ask' })
      mockRequestApproval.mockResolvedValue(true)

      await callMcpTool(serverId, 'testTool', {}, 'agent1', fakeSender as unknown as Electron.WebContents, true)
      expect(mockRequestApproval).toHaveBeenCalled()
    })

    it('still blocks a disabled tool when agenticMode=true', async () => {
      const { id: serverId } = addTestServer()
      mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 1, approval: 'disabled' })

      const r = await callMcpTool(serverId, 'testTool', {}, 'agent1', fakeSender as unknown as Electron.WebContents, true)
      expect(r.success).toBe(false)
      expect(r.error).toContain('disabled')
      expect(mockRequestApproval).not.toHaveBeenCalled()
    })

    it('still blocks an enabled=0 tool when agenticMode=true', async () => {
      const { id: serverId } = addTestServer()
      mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 0, approval: 'auto' })

      const r = await callMcpTool(serverId, 'testTool', {}, 'agent1', fakeSender as unknown as Electron.WebContents, true)
      expect(r.success).toBe(false)
      expect(mockRequestApproval).not.toHaveBeenCalled()
    })
  })
})

describe('MCP — Image extraction', () => {
  function addAutoApproveServer() {
    const id = `img-server-${Math.random().toString(36).slice(2)}`
    const client = makeMockClient()
    injectConnectedServer(id, 'ImgServer', client)
    mockOverrideRows.set(`agent1:${id}:testTool`, { enabled: 1, approval: 'auto' })
    return { id, client }
  }

  it('returns images array when tool result contains image content', async () => {
    const { id: serverId, client } = addAutoApproveServer()
    client.callTool.mockResolvedValue({
      content: [{ type: 'image', data: 'abc123', mimeType: 'image/png' }],
      isError: false
    })

    const r = await invokeHandler('mcp:call-tool', serverId, 'testTool', {}, 'agent1')
    expect(r.success).toBe(true)
    expect(r.images).toHaveLength(1)
    expect(r.images[0].dataUrl).toBe('data:image/png;base64,abc123')
    expect(r.images[0].mimeType).toBe('image/png')
  })

  it('suppresses JSON fallback and returns summary text when only images present', async () => {
    const { id: serverId, client } = addAutoApproveServer()
    client.callTool.mockResolvedValue({
      content: [{ type: 'image', data: 'base64data', mimeType: 'image/png' }],
      isError: false
    })

    const r = await invokeHandler('mcp:call-tool', serverId, 'testTool', {}, 'agent1')
    expect(r.result).toMatch(/Screenshot captured/)
    expect(r.result).not.toContain('base64data')
  })

  it('returns both text result and images when tool result has mixed content', async () => {
    const { id: serverId, client } = addAutoApproveServer()
    client.callTool.mockResolvedValue({
      content: [
        { type: 'text', text: 'Screenshot of viewport' },
        { type: 'image', data: 'imgdata', mimeType: 'image/png' }
      ],
      isError: false
    })

    const r = await invokeHandler('mcp:call-tool', serverId, 'testTool', {}, 'agent1')
    expect(r.result).toBe('Screenshot of viewport')
    expect(r.images).toHaveLength(1)
    expect(r.images[0].dataUrl).toBe('data:image/png;base64,imgdata')
  })

  it('returns no images field when tool result has only text content', async () => {
    const { id: serverId, client } = addAutoApproveServer()
    client.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'plain result' }],
      isError: false
    })

    const r = await invokeHandler('mcp:call-tool', serverId, 'testTool', {}, 'agent1')
    expect(r.result).toBe('plain result')
    expect(r.images).toBeUndefined()
  })

  it('handles multiple images in result', async () => {
    const { id: serverId, client } = addAutoApproveServer()
    client.callTool.mockResolvedValue({
      content: [
        { type: 'image', data: 'img1', mimeType: 'image/png' },
        { type: 'image', data: 'img2', mimeType: 'image/jpeg' }
      ],
      isError: false
    })

    const r = await invokeHandler('mcp:call-tool', serverId, 'testTool', {}, 'agent1')
    expect(r.images).toHaveLength(2)
    expect(r.result).toMatch(/2 image\(s\)/)
  })
})

describe('MCP — fullAutoApprove bypass', () => {
  function addFaaServer() {
    const id = `faa-server-${Math.random().toString(36).slice(2)}`
    const client = makeMockClient()
    injectConnectedServer(id, 'FaaServer', client)
    client.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'done' }], isError: false })
    return { id, client }
  }

  it('bypasses an explicit always-ask override when fullAutoApprove is true', async () => {
    const { id: serverId, client } = addFaaServer()
    mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 1, approval: 'always-ask' })

    const r = await callMcpTool(serverId, 'testTool', {}, 'agent1', fakeSender as unknown as Electron.WebContents, false, false, true)
    expect(mockRequestApproval).not.toHaveBeenCalled()
    expect(r.success).toBe(true)
    expect(client.callTool).toHaveBeenCalled()
  })

  it('bypasses a block server trust when fullAutoApprove is true', async () => {
    const { id: serverId } = addFaaServer()
    // No per-tool row - server trust = 'block' which maps to 'always-ask'
    // We simulate it by adding a server trust that forces always-ask with explicit override
    mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 1, approval: 'always-ask' })

    const r = await callMcpTool(serverId, 'testTool', {}, 'agent1', fakeSender as unknown as Electron.WebContents, false, false, true)
    expect(r.success).toBe(true)
    expect(mockRequestApproval).not.toHaveBeenCalled()
  })

  it('bypasses a disabled tool override when fullAutoApprove is true', async () => {
    const { id: serverId, client } = addFaaServer()
    mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 0, approval: 'auto' })

    const r = await callMcpTool(serverId, 'testTool', {}, 'agent1', fakeSender as unknown as Electron.WebContents, false, false, true)
    expect(r.success).toBe(true)
    expect(client.callTool).toHaveBeenCalled()
  })

  it('still respects explicit always-ask override when fullAutoApprove is false', async () => {
    const { id: serverId } = addFaaServer()
    mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 1, approval: 'always-ask' })
    mockRequestApproval.mockResolvedValue(true)

    await callMcpTool(serverId, 'testTool', {}, 'agent1', fakeSender as unknown as Electron.WebContents, false, false, false)
    expect(mockRequestApproval).toHaveBeenCalled()
  })

  it('emits tool:auto-approved when fullAutoApprove is true', async () => {
    const { id: serverId } = addFaaServer()
    mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 1, approval: 'auto' })

    await callMcpTool(serverId, 'testTool', { x: 1 }, 'agent1', fakeSender as unknown as Electron.WebContents, false, false, true)
    expect(fakeSender.send).toHaveBeenCalledWith('tool:auto-approved', { toolName: 'testTool', args: { x: 1 } })
  })
})

describe('MCP — Crash recovery', () => {
  it('auto-reconnects after an unexpected transport close', async () => {
    vi.useFakeTimers()

    const added = await invokeHandler('mcp:add-server', {
      name: 'Recoverable Server',
      command: 'node',
      args: ['server.js'],
      env: {},
      enabled: true
    })

    const instance = servers.get(added.id)
    expect(instance?.status).toBe('connected')

    ;(instance?.transport as { onclose?: () => void }).onclose?.()
    expect(servers.has(added.id)).toBe(false)

    await vi.advanceTimersByTimeAsync(5000)

    expect(servers.get(added.id)?.status).toBe('connected')
  })

  it('does not auto-reconnect after intentional disconnect', async () => {
    vi.useFakeTimers()

    const added = await invokeHandler('mcp:add-server', {
      name: 'Disconnectable Server',
      command: 'node',
      args: ['server.js'],
      env: {},
      enabled: true
    })

    const instance = servers.get(added.id)
    ;(instance?.transport as { onclose?: () => void }).onclose?.()

    await disconnectServer(added.id)
    await vi.advanceTimersByTimeAsync(5000)

    expect(servers.has(added.id)).toBe(false)
  })
})
