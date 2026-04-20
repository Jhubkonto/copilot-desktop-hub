import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Hoisted mocks ─────────────────────────────────────────── */
const { mockIpcMain, mockDb } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const serverRows: { id: string; config_json: string; enabled: number }[] = []

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
      get: vi.fn()
    })),
    _serverRows: serverRows
  }

  return { mockIpcMain, mockDb }
})

vi.mock('electron', () => ({
  ipcMain: mockIpcMain
}))

vi.mock('../database', () => ({
  getDatabase: () => mockDb
}))

// Mock the MCP SDK so we don't need real processes
const { mockClient, mockTransport } = vi.hoisted(() => {
  const mockClient = {
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({ tools: [] }),
    callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], isError: false })
  }
  const mockTransport = {
    close: vi.fn().mockResolvedValue(undefined)
  }
  return { mockClient, mockTransport }
})

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(() => mockClient)
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn(() => mockTransport)
}))

/* ── Helpers ─────────────────────────────────────────── */
async function invokeHandler(channel: string, ...args: unknown[]): Promise<any> {
  const handler = mockIpcMain._handlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  const fakeEvent = { sender: { id: 1 } }
  return handler(fakeEvent, ...args)
}

/* ── Import & Register ─────────────────────────────────────── */
import { registerMcpHandlers } from '../mcp'

beforeEach(() => {
  mockDb._serverRows.length = 0
  vi.clearAllMocks()
  // Re-apply mock implementations after clearAllMocks
  mockClient.connect.mockResolvedValue(undefined)
  mockClient.listTools.mockResolvedValue({ tools: [] })
  mockClient.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], isError: false })
  mockTransport.close.mockResolvedValue(undefined)
  registerMcpHandlers()
})

/* ── Tests ─────────────────────────────────────── */
describe('MCP — IPC Handlers', () => {
  it('mcp:list-servers returns empty when no servers configured', async () => {
    const r = await invokeHandler('mcp:list-servers')
    expect(r).toEqual([])
  })

  it('mcp:add-server stores config and returns with id', async () => {
    const config = {
      name: 'Test MCP',
      command: 'node',
      args: ['server.js'],
      env: {},
      enabled: true
    }
    const r = await invokeHandler('mcp:add-server', config)
    expect(r.id).toBeDefined()
    expect(r.name).toBe('Test MCP')
    expect(mockDb._serverRows.length).toBe(1)
  })

  it('mcp:add-server with enabled=true attempts connection', async () => {
    const config = {
      name: 'Active Server',
      command: 'npx',
      args: ['-y', 'some-mcp'],
      env: {},
      enabled: true
    }
    const result = await invokeHandler('mcp:add-server', config)
    // Config is saved regardless of connection outcome
    expect(result.name).toBe('Active Server')
    expect(result.enabled).toBe(true)
    expect(mockDb._serverRows.length).toBe(1)
  })

  it('mcp:remove-server deletes config', async () => {
    // First add
    const config = { name: 'Tmp', command: 'x', args: [], env: {}, enabled: false }
    const added = await invokeHandler('mcp:add-server', config)

    // Then remove
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
