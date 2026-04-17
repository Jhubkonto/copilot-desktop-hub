import { getDatabase } from './database'
import { dialog } from 'electron'
import { randomUUID } from 'crypto'
import { readFileSync, writeFileSync } from 'fs'
import { safeHandle } from './safe-handle'

interface AgentRow {
  id: string
  config_json: string
  is_default: number
  created_at: number
  updated_at: number
}

const DEFAULT_AGENTS = [
  {
    name: 'General Assistant',
    icon: '🤖',
    systemPrompt:
      'You are a helpful AI assistant. Be concise and clear in your responses. When providing code examples, use proper formatting and explain your reasoning.',
    model: 'default',
    temperature: 0.7,
    maxTokens: 4096,
    contextDirectories: [] as string[],
    contextFiles: [] as string[],
    mcpServers: [] as string[],
    agenticMode: false,
    tools: { fileEdit: false, terminal: false, webFetch: false },
    responseFormat: 'default' as const
  },
  {
    name: 'Code Reviewer',
    icon: '🔍',
    systemPrompt:
      'You are an expert code reviewer. When reviewing code, focus on:\n- Bugs and potential issues\n- Performance improvements\n- Security vulnerabilities\n- Code style and best practices\n- Readability and maintainability\nProvide specific, actionable feedback with code examples.',
    model: 'default',
    temperature: 0.3,
    maxTokens: 4096,
    contextDirectories: [] as string[],
    contextFiles: [] as string[],
    mcpServers: [] as string[],
    agenticMode: false,
    tools: { fileEdit: false, terminal: false, webFetch: false },
    responseFormat: 'detailed' as const
  },
  {
    name: 'Debugger',
    icon: '🐛',
    systemPrompt:
      'You are a debugging expert. When helping debug issues:\n- Ask clarifying questions about the error and context\n- Analyze stack traces and error messages carefully\n- Suggest systematic debugging approaches\n- Provide step-by-step solutions\n- Explain the root cause once identified',
    model: 'default',
    temperature: 0.4,
    maxTokens: 4096,
    contextDirectories: [] as string[],
    contextFiles: [] as string[],
    mcpServers: [] as string[],
    agenticMode: false,
    tools: { fileEdit: false, terminal: false, webFetch: false },
    responseFormat: 'detailed' as const
  }
]

function rowToConfig(row: AgentRow) {
  const config = JSON.parse(row.config_json)
  return {
    ...config,
    id: row.id,
    isDefault: row.is_default === 1
  }
}

function seedDefaultAgents(): void {
  const db = getDatabase()
  const count = (
    db.prepare('SELECT COUNT(*) as count FROM agents WHERE is_default = 1').get() as {
      count: number
    }
  ).count
  if (count > 0) return

  const insert = db.prepare(
    'INSERT INTO agents (id, config_json, is_default, created_at, updated_at) VALUES (?, ?, 1, ?, ?)'
  )
  const now = Date.now()
  for (const agent of DEFAULT_AGENTS) {
    insert.run(randomUUID(), JSON.stringify(agent), now, now)
  }
}

export function getAgentConfig(agentId: string): Record<string, unknown> | null {
  const db = getDatabase()
  const row = db.prepare('SELECT config_json FROM agents WHERE id = ?').get(agentId) as
    | { config_json: string }
    | undefined
  if (!row) return null
  return JSON.parse(row.config_json)
}

export function registerAgentHandlers(): void {
  seedDefaultAgents()
  const db = getDatabase()

  safeHandle('agent:list', () => {
    const rows = db.prepare('SELECT * FROM agents ORDER BY created_at ASC').all() as AgentRow[]
    return rows.map(rowToConfig)
  })

  safeHandle('agent:get', (_event, id: string) => {
    const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined
    return row ? rowToConfig(row) : null
  })

  safeHandle('agent:create', (_event, config: Record<string, unknown>) => {
    const id = randomUUID()
    const now = Date.now()
    db.prepare(
      'INSERT INTO agents (id, config_json, is_default, created_at, updated_at) VALUES (?, ?, 0, ?, ?)'
    ).run(id, JSON.stringify(config), now, now)
    return { ...config, id, isDefault: false }
  })

  safeHandle('agent:update', (_event, id: string, config: Record<string, unknown>) => {
    const now = Date.now()
    db.prepare('UPDATE agents SET config_json = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(config),
      now,
      id
    )
    return { ...config, id }
  })

  safeHandle('agent:delete', (_event, id: string) => {
    const row = db.prepare('SELECT is_default FROM agents WHERE id = ?').get(id) as
      | { is_default: number }
      | undefined
    if (row?.is_default === 1) return false
    db.prepare('DELETE FROM agents WHERE id = ?').run(id)
    db.prepare('UPDATE conversations SET agent_id = NULL WHERE agent_id = ?').run(id)
    return true
  })

  safeHandle('agent:duplicate', (_event, id: string) => {
    const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined
    if (!row) return null
    const config = JSON.parse(row.config_json)
    config.name = `${config.name} (copy)`
    const newId = randomUUID()
    const now = Date.now()
    db.prepare(
      'INSERT INTO agents (id, config_json, is_default, created_at, updated_at) VALUES (?, ?, 0, ?, ?)'
    ).run(newId, JSON.stringify(config), now, now)
    return { ...config, id: newId, isDefault: false }
  })

  safeHandle('agent:export', async (_event, id: string) => {
    const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined
    if (!row) return false
    const config = JSON.parse(row.config_json)
    const result = await dialog.showSaveDialog({
      defaultPath: `${config.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return false
    writeFileSync(result.filePath, JSON.stringify(config, null, 2), 'utf-8')
    return true
  })

  safeHandle('agent:import', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    try {
      const content = readFileSync(result.filePaths[0], 'utf-8')
      const config = JSON.parse(content)
      if (!config.name || typeof config.name !== 'string') return null
      const fullConfig = {
        name: config.name,
        icon: config.icon || '🤖',
        systemPrompt: config.systemPrompt || '',
        model: config.model || 'default',
        temperature: config.temperature ?? 0.7,
        maxTokens: config.maxTokens ?? 4096,
        contextDirectories: config.contextDirectories || [],
        contextFiles: config.contextFiles || [],
        mcpServers: config.mcpServers || [],
        agenticMode: config.agenticMode ?? false,
        tools: config.tools || { fileEdit: false, terminal: false, webFetch: false },
        responseFormat: config.responseFormat || 'default'
      }
      const id = randomUUID()
      const now = Date.now()
      db.prepare(
        'INSERT INTO agents (id, config_json, is_default, created_at, updated_at) VALUES (?, ?, 0, ?, ?)'
      ).run(id, JSON.stringify(fullConfig), now, now)
      return { ...fullConfig, id, isDefault: false }
    } catch {
      return null
    }
  })

  safeHandle('file:open-directory-dialog', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'multiSelections']
    })
    if (result.canceled) return []
    return result.filePaths
  })
}
