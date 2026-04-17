import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { getDatabase } from './database'
import { randomUUID } from 'crypto'
import { safeHandle } from './safe-handle'

interface McpServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
  enabled: boolean
}

interface McpServerInstance {
  config: McpServerConfig
  client: Client
  transport: StdioClientTransport
  status: 'connecting' | 'connected' | 'error' | 'disconnected'
  error?: string
  tools: McpTool[]
}

interface McpTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  serverId: string
  serverName: string
}

const servers = new Map<string, McpServerInstance>()

function loadServerConfigs(): McpServerConfig[] {
  const db = getDatabase()
  const rows = db.prepare('SELECT id, config_json, enabled FROM mcp_servers').all() as {
    id: string
    config_json: string
    enabled: number
  }[]
  return rows.map((row) => {
    const config = JSON.parse(row.config_json)
    return { ...config, id: row.id, enabled: row.enabled === 1 }
  })
}

function saveServerConfig(config: McpServerConfig): void {
  const db = getDatabase()
  const { id, enabled, ...rest } = config
  db.prepare(
    'INSERT OR REPLACE INTO mcp_servers (id, config_json, enabled, updated_at) VALUES (?, ?, ?, unixepoch() * 1000)'
  ).run(id, JSON.stringify(rest), enabled ? 1 : 0)
}

function removeServerConfig(id: string): void {
  const db = getDatabase()
  db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id)
}

async function connectServer(config: McpServerConfig): Promise<void> {
  // Disconnect existing if any
  await disconnectServer(config.id)

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: Object.keys(config.env).length > 0 ? { ...process.env, ...config.env } as Record<string, string> : undefined,
    cwd: config.cwd || undefined,
    stderr: 'pipe'
  })

  const client = new Client(
    { name: 'copilot-desktop-hub', version: '0.1.0' },
    { capabilities: {} }
  )

  const instance: McpServerInstance = {
    config,
    client,
    transport,
    status: 'connecting',
    tools: []
  }

  servers.set(config.id, instance)

  try {
    await client.connect(transport)
    instance.status = 'connected'

    // Discover tools
    try {
      const toolsResult = await client.listTools()
      instance.tools = (toolsResult.tools || []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
        serverId: config.id,
        serverName: config.name
      }))
    } catch {
      // Server may not support tools
      instance.tools = []
    }
  } catch (error) {
    instance.status = 'error'
    instance.error = (error as Error).message
  }
}

async function disconnectServer(id: string): Promise<void> {
  const instance = servers.get(id)
  if (instance) {
    try {
      await instance.transport.close()
    } catch {
      // Ignore close errors
    }
    instance.status = 'disconnected'
    servers.delete(id)
  }
}

export function getAvailableMcpTools(serverIds?: string[]): McpTool[] {
  const tools: McpTool[] = []
  for (const [id, instance] of servers) {
    if (instance.status !== 'connected') continue
    if (serverIds && !serverIds.includes(id)) continue
    tools.push(...instance.tools)
  }
  return tools
}

export async function callMcpTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<{ success: boolean; result?: string; error?: string }> {
  const instance = servers.get(serverId)
  if (!instance || instance.status !== 'connected') {
    return { success: false, error: `Server ${serverId} not connected` }
  }

  try {
    const result = await instance.client.callTool({ name: toolName, arguments: args })
    const contentArray = Array.isArray(result.content) ? result.content : []
    const textContent = contentArray
      .filter((c): c is { type: string; text: string } => c != null && typeof c === 'object' && 'type' in c && c.type === 'text' && typeof (c as { text?: unknown }).text === 'string')
      .map((c) => c.text)
      .join('\n')
    return { success: !result.isError, result: textContent || JSON.stringify(result.content) }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}

export async function initMcpServers(): Promise<void> {
  const configs = loadServerConfigs()
  for (const config of configs) {
    if (config.enabled) {
      await connectServer(config).catch((err) => {
        console.error(`Failed to start MCP server ${config.name}:`, err)
      })
    }
  }
}

export async function shutdownMcpServers(): Promise<void> {
  const ids = [...servers.keys()]
  for (const id of ids) {
    await disconnectServer(id).catch((err) => {
      console.error(`Failed to disconnect MCP server ${id}:`, err)
    })
  }
}

export function registerMcpHandlers(): void {
  safeHandle('mcp:list-servers', () => {
    const configs = loadServerConfigs()
    return configs.map((config) => {
      const instance = servers.get(config.id)
      return {
        ...config,
        status: instance?.status ?? 'disconnected',
        error: instance?.error,
        toolCount: instance?.tools.length ?? 0
      }
    })
  })

  safeHandle('mcp:add-server', async (_event, config: Omit<McpServerConfig, 'id'>) => {
    const id = randomUUID()
    const fullConfig = { ...config, id } as McpServerConfig
    saveServerConfig(fullConfig)
    if (fullConfig.enabled) {
      await connectServer(fullConfig).catch(() => {})
    }
    return fullConfig
  })

  safeHandle('mcp:update-server', async (_event, id: string, updates: Partial<McpServerConfig>) => {
    const configs = loadServerConfigs()
    const existing = configs.find((c) => c.id === id)
    if (!existing) return null

    const updated = { ...existing, ...updates, id }
    saveServerConfig(updated)

    // Reconnect if enabled, disconnect if disabled
    if (updated.enabled) {
      await connectServer(updated).catch(() => {})
    } else {
      await disconnectServer(id)
    }
    return updated
  })

  safeHandle('mcp:remove-server', async (_event, id: string) => {
    await disconnectServer(id)
    removeServerConfig(id)
    return true
  })

  safeHandle('mcp:get-server-status', (_event, id: string) => {
    const instance = servers.get(id)
    return {
      status: instance?.status ?? 'disconnected',
      error: instance?.error,
      tools: instance?.tools ?? []
    }
  })

  safeHandle('mcp:list-tools', (_event, serverIds?: string[]) => {
    return getAvailableMcpTools(serverIds)
  })

  safeHandle(
    'mcp:call-tool',
    async (_event, serverId: string, toolName: string, args: Record<string, unknown>) => {
      return await callMcpTool(serverId, toolName, args)
    }
  )

  safeHandle('mcp:restart-server', async (_event, id: string) => {
    const configs = loadServerConfigs()
    const config = configs.find((c) => c.id === id)
    if (!config) return false
    await connectServer(config).catch(() => {})
    return true
  })
}
