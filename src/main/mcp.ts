import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { WebContents } from 'electron'
import { getDatabase } from './database'
import { randomUUID } from 'crypto'
import { safeHandle } from './safe-handle'
import { requestApproval } from './tools'

interface McpServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
  imageResponses?: 'allow' | 'omit'
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

export const servers = new Map<string, McpServerInstance>()
const reconnectTimers = new Map<string, NodeJS.Timeout>()
const intentionallyDisconnected = new Set<string>()
const RECONNECT_DELAY_MS = 5000

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

function scheduleReconnect(id: string): void {
  if (intentionallyDisconnected.has(id)) return
  const existing = reconnectTimers.get(id)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(async () => {
    reconnectTimers.delete(id)
    if (intentionallyDisconnected.has(id)) return

    const configs = loadServerConfigs()
    const config = configs.find((c) => c.id === id)
    if (!config || !config.enabled) return

    await connectServer(config).catch((err) => {
      console.error(`MCP auto-reconnect failed for ${config.name}:`, err)
      scheduleReconnect(id)
    })
  }, RECONNECT_DELAY_MS)

  reconnectTimers.set(id, timer)
}

async function connectServer(config: McpServerConfig): Promise<void> {
  intentionallyDisconnected.delete(config.id)

  // Disconnect existing if any
  await disconnectServer(config.id)
  intentionallyDisconnected.delete(config.id)

  const extraArgs: string[] = []
  if (config.imageResponses === 'omit') {
    extraArgs.push('--imageResponses', 'omit')
  }

  const transport = new StdioClientTransport({
    command: config.command,
    args: [...config.args, ...extraArgs],
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

    transport.onclose = () => {
      const inst = servers.get(config.id)
      if (inst && inst.status === 'connected') {
        inst.status = 'disconnected'
        servers.delete(config.id)
        scheduleReconnect(config.id)
      }
    }

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

export async function disconnectServer(id: string): Promise<void> {
  intentionallyDisconnected.add(id)

  const existing = reconnectTimers.get(id)
  if (existing) {
    clearTimeout(existing)
    reconnectTimers.delete(id)
  }

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
  args: Record<string, unknown>,
  agentId?: string,
  webContents?: WebContents
): Promise<{ success: boolean; result?: string; images?: { dataUrl: string; mimeType: string }[]; error?: string }> {
  // Resolve approval policy; default to 'always-ask' when no override exists
  let approval: string = 'always-ask'

  if (agentId) {
    const db = getDatabase()
    const override = db.prepare(
      'SELECT enabled, approval FROM agent_mcp_tool_overrides WHERE agent_id=? AND server_id=? AND tool_name=?'
    ).get(agentId, serverId, toolName) as { enabled: number; approval: string } | undefined
    if (override?.enabled === 0) return { success: false, error: 'Tool disabled for this agent' }
    approval = override?.approval ?? 'always-ask'
  }

  if (approval === 'disabled') return { success: false, error: 'Tool disabled for this agent' }

  const instance = servers.get(serverId)
  if (!instance || instance.status !== 'connected') {
    return { success: false, error: `Server ${serverId} not connected` }
  }

  if (approval === 'always-ask') {
    if (!webContents || webContents.isDestroyed()) {
      return { success: false, error: 'Tool requires interactive approval but no UI is available' }
    }
    const tool = instance.tools.find((t) => t.name === toolName)
    const description = `[${instance.config.name}] ${tool?.description ?? toolName}`
    const approved = await requestApproval(webContents, toolName, args, description, { noRemember: true })
    if (!approved) return { success: false, error: 'Tool execution denied by user' }
  }

  try {
    const result = await instance.client.callTool({ name: toolName, arguments: args })
    const contentArray = Array.isArray(result.content) ? result.content : []

    const textContent = contentArray
      .filter((c): c is { type: string; text: string } =>
        c != null && typeof c === 'object' && 'type' in c &&
        c.type === 'text' && typeof (c as { text?: unknown }).text === 'string')
      .map((c) => c.text)
      .join('\n')

    const images = contentArray
      .filter((c): c is { type: 'image'; data: string; mimeType: string } =>
        c != null && typeof c === 'object' && 'type' in c &&
        c.type === 'image' &&
        typeof (c as { data?: unknown }).data === 'string' &&
        typeof (c as { mimeType?: unknown }).mimeType === 'string')
      .map((c) => ({ dataUrl: `data:${c.mimeType};base64,${c.data}`, mimeType: c.mimeType }))

    // When image parts are present, use a short summary rather than dumping the raw JSON blob
    const resultText = textContent || (images.length > 0
      ? `[Screenshot captured — ${images.length} image(s)]`
      : JSON.stringify(result.content))

    if (result.isError) {
      return { success: false, error: resultText, ...(images.length > 0 && { images }) }
    }
    return { success: true, result: resultText, ...(images.length > 0 && { images }) }
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
  for (const [id, timer] of reconnectTimers) {
    clearTimeout(timer)
    reconnectTimers.delete(id)
  }

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

  safeHandle('mcp:list-tools-for-agent', (_event, agentId: string) => {
    const db = getDatabase()
    const agentRow = db.prepare('SELECT config_json FROM agents WHERE id = ?').get(agentId) as { config_json: string } | undefined
    if (!agentRow) return []
    const cfg = JSON.parse(agentRow.config_json)
    const serverIds: string[] = cfg.mcpServers ?? []
    return getAvailableMcpTools(serverIds)
  })

  safeHandle('agent:get-mcp-tool-overrides', (_event, agentId: string) => {
    const db = getDatabase()
    return db.prepare('SELECT * FROM agent_mcp_tool_overrides WHERE agent_id = ?').all(agentId)
  })

  safeHandle('agent:set-mcp-tool-override', (_event, agentId: string, serverId: string, toolName: string, config: { enabled: boolean; approval: string; instructions: string }) => {
    const db = getDatabase()
    db.prepare(
      'INSERT OR REPLACE INTO agent_mcp_tool_overrides (agent_id, server_id, tool_name, enabled, approval, instructions) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(agentId, serverId, toolName, config.enabled ? 1 : 0, config.approval, config.instructions)
    return true
  })

  safeHandle(
    'mcp:call-tool',
    async (event, serverId: string, toolName: string, args: Record<string, unknown>, agentId?: string) => {
      return await callMcpTool(serverId, toolName, args, agentId, event.sender)
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
