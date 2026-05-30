import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIpcMain, mockDb, transportOptions } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const serverRows: { id: string; config_json: string; enabled: number }[] = []
  const transportOptions: Array<Record<string, unknown>> = []

  return {
    mockIpcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }),
      _handlers: handlers
    },
    mockDb: {
      prepare: vi.fn((sql: string) => ({
        run: vi.fn((...args: unknown[]) => {
          if (sql.includes('INSERT OR REPLACE INTO mcp_servers')) {
            const idx = serverRows.findIndex((row) => row.id === args[0])
            const row = { id: args[0] as string, config_json: args[1] as string, enabled: args[2] as number }
            if (idx >= 0) serverRows[idx] = row
            else serverRows.push(row)
          }
          return { changes: 1 }
        }),
        all: vi.fn(() => [...serverRows]),
        get: vi.fn(() => undefined)
      }))
    },
    transportOptions
  }
})

const { MockClient, MockTransport } = vi.hoisted(() => {
  class MockTransport {
    onclose?: () => void
    constructor(options: Record<string, unknown>) {
      transportOptions.push(options)
    }
    close = vi.fn().mockResolvedValue(undefined)
  }

  class MockClient {
    connect = vi.fn().mockResolvedValue(undefined)
    listTools = vi.fn().mockResolvedValue({ tools: [] })
    callTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], isError: false })
  }

  return { MockClient, MockTransport }
})

vi.mock('electron', () => ({
  ipcMain: mockIpcMain
}))

vi.mock('../database', () => ({
  getDatabase: () => mockDb
}))

vi.mock('../safe-handle', () => ({
  safeHandle: (channel: string, handler: (...args: unknown[]) => unknown) => {
    mockIpcMain.handle(channel, handler)
  }
}))

vi.mock('../tools', () => ({
  requestApproval: vi.fn().mockResolvedValue(true)
}))

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: MockClient
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: MockTransport
}))

import { registerMcpHandlers, shutdownMcpServers, servers } from '../mcp'

async function invokeHandler(channel: string, ...args: unknown[]) {
  const handler = mockIpcMain._handlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  return handler({ sender: { isDestroyed: vi.fn().mockReturnValue(false) } }, ...args)
}

describe('MCP imageResponses transport args', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    transportOptions.length = 0
    servers.clear()
    registerMcpHandlers()
  })

  afterEach(async () => {
    await shutdownMcpServers()
  })

  it('includes --imageResponses omit when configured', async () => {
    await invokeHandler('mcp:add-server', {
      name: 'Playwright',
      command: 'npx',
      args: ['@playwright/mcp'],
      env: {},
      imageResponses: 'omit',
      enabled: true
    })

    expect(transportOptions[0]?.args).toEqual(['@playwright/mcp', '--imageResponses', 'omit'])
  })

  it('does not include imageResponses args when undefined or allow', async () => {
    await invokeHandler('mcp:add-server', {
      name: 'Default',
      command: 'npx',
      args: ['tool-a'],
      env: {},
      enabled: true
    })
    await invokeHandler('mcp:add-server', {
      name: 'Allow',
      command: 'npx',
      args: ['tool-b'],
      env: {},
      imageResponses: 'allow',
      enabled: true
    })

    expect(transportOptions[0]?.args).toEqual(['tool-a'])
    expect(transportOptions[1]?.args).toEqual(['tool-b'])
  })
})
