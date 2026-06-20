import { beforeEach, describe, expect, it, vi } from 'vitest'

// Stateful in-memory store shared across all prepared statements
const store = vi.hoisted(() => {
  const agents = new Map<string, string>() // id → config_json
  const knowledgeFiles = new Map<string, Record<string, unknown>>() // id → row
  const mcpToolOverrides: Record<string, unknown>[] = []
  const mcpServerTrust: Record<string, unknown>[] = []
  let uuidCounter = 0

  const commandHandler = { current: null as ((command: string, data: Record<string, unknown>, reply: (e: unknown) => void) => void) | null }
  const broadcasts: unknown[] = []

  return { agents, knowledgeFiles, mcpToolOverrides, mcpServerTrust, commandHandler, broadcasts, nextUuid: () => `uuid-${++uuidCounter}` }
})

vi.mock('../safe-handle', () => ({ safeHandle: vi.fn() }))

vi.mock('../database', () => ({
  getDatabase: () => ({
    prepare: (sql: string) => ({
      run: (...args: unknown[]) => {
        if (sql.includes('INSERT INTO agents')) {
          const [id, config_json] = args as [string, string]
          store.agents.set(id, config_json)
        } else if (sql.includes('UPDATE agents SET config_json')) {
          const [config_json, , id] = args as [string, number, string]
          store.agents.set(id, config_json)
        } else if (sql.includes('INSERT INTO agent_knowledge_files')) {
          const [id, agent_id, file_path, inject_mode, sort_order, created_at, updated_at] = args as [string, string, string, string, number, number, number]
          store.knowledgeFiles.set(id, { id, agent_id, file_path, inject_mode, sort_order, created_at, updated_at })
        } else if (sql.includes('DELETE FROM agent_knowledge_files')) {
          const [id] = args as [string]
          store.knowledgeFiles.delete(id)
        } else if (sql.includes('UPDATE agent_knowledge_files SET updated_at')) {
          const [updated_at, , file_path] = args as [number, string, string]
          for (const f of store.knowledgeFiles.values()) {
            if (f.file_path === file_path) { f.updated_at = updated_at; break }
          }
        } else if (sql.includes('INSERT OR REPLACE INTO agent_mcp_tool_overrides')) {
          const [agent_id, server_id, tool_name, enabled, approval, instructions] = args as [string, string, string, number, string, string]
          const idx = store.mcpToolOverrides.findIndex((r) => r.agent_id === agent_id && r.server_id === server_id && r.tool_name === tool_name)
          const row = { agent_id, server_id, tool_name, enabled, approval, instructions }
          if (idx >= 0) store.mcpToolOverrides[idx] = row; else store.mcpToolOverrides.push(row)
        } else if (sql.includes('INSERT OR REPLACE INTO agent_mcp_server_trust')) {
          const [agent_id, server_id, trust] = args as [string, string, string]
          const idx = store.mcpServerTrust.findIndex((r) => r.agent_id === agent_id && r.server_id === server_id)
          const row = { agent_id, server_id, trust }
          if (idx >= 0) store.mcpServerTrust[idx] = row; else store.mcpServerTrust.push(row)
        }
        return { changes: 1 }
      },
      get: (...args: unknown[]) => {
        if (sql.includes('SELECT config_json FROM agents')) {
          const id = args[0] as string
          const config_json = store.agents.get(id)
          return config_json ? { config_json } : undefined
        }
        if (sql.includes('SELECT id FROM agent_knowledge_files') && sql.includes('file_path')) {
          const [agent_id, file_path] = args as [string, string]
          for (const f of store.knowledgeFiles.values()) {
            if (f.agent_id === agent_id && f.file_path === file_path) return { id: f.id }
          }
          return undefined
        }
        if (sql.includes('SELECT * FROM agent_knowledge_files WHERE id = ?')) {
          return store.knowledgeFiles.get(args[0] as string)
        }
        if (sql.includes('SELECT MAX(sort_order)')) {
          const agentId = args[0] as string
          const orders = [...store.knowledgeFiles.values()]
            .filter((f) => f.agent_id === agentId)
            .map((f) => f.sort_order as number)
          return { m: orders.length ? Math.max(...orders) : null }
        }
        if (sql.includes('SELECT backend') || sql.includes('FROM agents')) {
          return undefined
        }
        return undefined
      },
      all: (...args: unknown[]) => {
        if (sql.includes('FROM conversations')) return []
        if (sql.includes('FROM projects')) return []
        if (sql.includes('FROM messages')) return []
        if (sql.includes('FROM agents')) return []
        if (sql.includes('FROM mcp_servers')) return []
        if (sql.includes('FROM agent_knowledge_files')) {
          const agentId = args[0] as string
          return [...store.knowledgeFiles.values()].filter((f) => f.agent_id === agentId)
        }
        if (sql.includes('FROM agent_mcp_tool_overrides')) {
          const agentId = args[0] as string
          return store.mcpToolOverrides.filter((r) => r.agent_id === agentId)
        }
        if (sql.includes('FROM agent_mcp_server_trust')) {
          const agentId = args[0] as string
          return store.mcpServerTrust.filter((r) => r.agent_id === agentId)
        }
        return []
      },
    }),
  }),
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: vi.fn(() => false), webContents: { send: vi.fn() } }],
  },
}))

vi.mock('../providers', () => ({
  abortActiveStream: vi.fn(),
  PROVIDERS: [],
  isProviderConfigured: vi.fn(() => false),
}))

vi.mock('../model-catalog', () => ({ getCachedCatalog: vi.fn(() => []) }))
vi.mock('../chat-handlers', () => ({ dispatchChatSend: vi.fn() }))
vi.mock('../cli-detection', () => ({ getCliModels: vi.fn(() => []), detectAllClis: vi.fn(() => []) }))
vi.mock('../auth', () => ({ retrieveAuthMode: vi.fn(() => 'byok') }))
vi.mock('../android-handlers', () => ({ getAndroidUpdateManifest: vi.fn() }))
vi.mock('../cli-adapters/claude', () => ({ ClaudeAdapter: { isAvailable: vi.fn(() => false) } }))
vi.mock('../cli-adapters/codex', () => ({ CodexAdapter: { isAvailable: vi.fn(() => false) } }))
vi.mock('../error-report-handlers', () => ({ createErrorReport: vi.fn(), rowToErrorReport: vi.fn() }))
vi.mock('../self-heal/history', () => ({ listHistory: vi.fn() }))
vi.mock('../self-heal/investigator', () => ({ emitInvestigationEvent: vi.fn(), runInvestigation: vi.fn() }))
vi.mock('../self-heal/fix-agent', () => ({ runFix: vi.fn(), emitFixEvent: vi.fn() }))
vi.mock('../self-heal/verifier', () => ({ emitVerificationEvent: vi.fn(), runVerification: vi.fn() }))
vi.mock('../self-heal/git-ops', () => ({ commitSelfHealFix: vi.fn(), prepareSelfHealCommit: vi.fn(), pushSelfHealFix: vi.fn() }))
vi.mock('../self-heal/recovery', () => ({ approveRelaunch: vi.fn(), getRecoveryRuns: vi.fn(), prepareReload: vi.fn(), rollbackHeal: vi.fn(), startReload: vi.fn() }))
vi.mock('../project-generator', () => ({ runProjectGeneratorChatForAndroid: vi.fn(), createProjectFromSpec: vi.fn(), getProjectGeneratorAgentSummaries: vi.fn() }))
vi.mock('../agent-generator', () => ({ runAgentGeneratorChatForAndroid: vi.fn(), createAgentFromSpec: vi.fn() }))
vi.mock('../skill-generator', () => ({ runSkillGeneratorChatForAndroid: vi.fn(), createSkillFromSpec: vi.fn() }))
vi.mock('../artifact-generator', () => ({ createArtifactGeneratorRunRecord: vi.fn(), runArtifactGeneration: vi.fn(), runArtifactGeneratorChatForAndroid: vi.fn(), updateArtifactGeneratorRunRecord: vi.fn() }))
vi.mock('../provider-secrets', () => ({ storeApiKey: vi.fn(), removeApiKey: vi.fn(), getAzureEndpoint: vi.fn(), setAzureEndpoint: vi.fn() }))
vi.mock('../providers', () => ({ abortActiveStream: vi.fn(), PROVIDERS: [], isProviderConfigured: vi.fn(() => false), testProviderKey: vi.fn(), getOpenRouterModels: vi.fn() }))
vi.mock('../wiki-handlers', () => ({ insertWikiEntry: vi.fn() }))
vi.mock('../prompt-handlers', () => ({ insertPromptLibraryEntry: vi.fn(), listPromptLibraryVersions: vi.fn(), rollbackPromptLibraryEntry: vi.fn(), updatePromptLibraryEntry: vi.fn() }))
vi.mock('../conversation-handlers', () => ({ buildConversationExportPack: vi.fn(), forkConversation: vi.fn(), importConversationExport: vi.fn(), getConversationCompressionPreview: vi.fn(), prepareConversationCompressionSummary: vi.fn(), saveConversationCompressionSummary: vi.fn() }))
vi.mock('../skills', () => ({ createSkillConfig: vi.fn(), deleteSkillConfig: vi.fn(), duplicateSkillConfig: vi.fn(), getSkillAgentLinks: vi.fn(), getSkillAgentUsage: vi.fn(), getSkillConfig: vi.fn(), listSkillConfigs: vi.fn(), reorderSkillsForAgent: vi.fn(), setSkillAgentAttachment: vi.fn(), updateSkillConfig: vi.fn() }))
vi.mock('../conversation-serialization', () => ({ parseConversationExport: vi.fn() }))

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => 'file content'),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}))

vi.mock('../ws-server', () => ({
  startWsServer: vi.fn(),
  stopWsServer: vi.fn(),
  getWsStatus: vi.fn(() => ({ enabled: false })),
  getQrDataUrl: vi.fn(),
  regenerateToken: vi.fn(),
  setWsCommandHandler: vi.fn((handler) => { store.commandHandler.current = handler }),
  broadcastToMobile: vi.fn((event: unknown) => { store.broadcasts.push(event) }),
}))

vi.mock('crypto', () => ({ randomUUID: vi.fn(() => store.nextUuid()) }))

import { registerWsHandlers } from '../ws-handlers'

function send(command: string, data: Record<string, unknown> = {}) {
  if (!store.commandHandler.current) throw new Error('handler not registered')
  const replies: unknown[] = []
  store.commandHandler.current(command, data, (e) => replies.push(e))
  return replies
}

function lastReplyData(replies: unknown[]): Record<string, unknown> {
  const last = replies[replies.length - 1] as { data: Record<string, unknown> }
  return last.data
}

describe('agent:update → agent:get-full round-trip', () => {
  const AGENT_ID = 'agent-rt-1'

  beforeEach(() => {
    store.agents.clear()
    store.knowledgeFiles.clear()
    store.mcpToolOverrides.length = 0
    store.mcpServerTrust.length = 0
    store.broadcasts.length = 0
    registerWsHandlers()

    // Seed initial agent
    store.agents.set(AGENT_ID, JSON.stringify({
      id: AGENT_ID, name: 'RT Agent', icon: '🔄',
      systemPrompt: '', backend: undefined, cliModel: undefined,
      temperature: 0.7, maxTokens: 8192, responseFormat: 'default',
      agenticMode: false, memory: '',
      tools: {
        fileEdit: { enabled: true, approval: 'always-ask', instructions: '' },
        terminal: { enabled: false, approval: 'always-ask', instructions: '' },
        webFetch: { enabled: true, approval: 'auto', instructions: '' },
      },
      mcpServers: [],
      thinkingEffort: undefined,
      rootDirectory: undefined,
      contextDirectories: [],
      contextFiles: [],
      contextRules: undefined,
      customCommands: [],
    }))
  })

  it('persists and retrieves thinkingEffort, rootDirectory, contextDirectories, contextFiles', () => {
    send('agent:update', {
      id: AGENT_ID, name: 'RT Agent', icon: '🔄',
      thinkingEffort: 'high',
      rootDirectory: '/home/user/project',
      contextDirectories: ['/home/user/project/src'],
      contextFiles: ['/home/user/project/README.md'],
    })

    const replies = send('agent:get-full', { id: AGENT_ID })
    const agent = lastReplyData(replies).agent as Record<string, unknown>
    expect(agent.thinkingEffort).toBe('high')
    expect(agent.rootDirectory).toBe('/home/user/project')
    expect(agent.contextDirectories).toEqual(['/home/user/project/src'])
    expect(agent.contextFiles).toEqual(['/home/user/project/README.md'])
  })

  it('persists and retrieves contextRules without dropping any field', () => {
    const contextRules = {
      ignoredGlobs: ['node_modules/**', '*.log'],
      autoInjectWorkspace: false,
      autoInjectGit: true,
    }
    send('agent:update', { id: AGENT_ID, name: 'RT Agent', icon: '🔄', contextRules })

    const agent = lastReplyData(send('agent:get-full', { id: AGENT_ID })).agent as Record<string, unknown>
    expect(agent.contextRules).toEqual(contextRules)
  })

  it('persists and retrieves customCommands with all fields', () => {
    const customCommands = [
      { name: '/summarize', description: 'Summarize the conversation', prompt: 'Please summarize the above.' },
      { name: '/explain', description: 'Explain the code', prompt: 'Explain this code step by step.' },
    ]
    send('agent:update', { id: AGENT_ID, name: 'RT Agent', icon: '🔄', customCommands })

    const agent = lastReplyData(send('agent:get-full', { id: AGENT_ID })).agent as Record<string, unknown>
    expect(agent.customCommands).toEqual(customCommands)
  })

  it('persists and retrieves mcpServers list', () => {
    const mcpServers = ['server-alpha', 'server-beta']
    send('agent:update', { id: AGENT_ID, name: 'RT Agent', icon: '🔄', mcpServers })

    const agent = lastReplyData(send('agent:get-full', { id: AGENT_ID })).agent as Record<string, unknown>
    expect(agent.mcpServers).toEqual(mcpServers)
  })

  it('persists and retrieves per-tool instructions and approval without clobbering other tools', () => {
    const tools = {
      fileEdit: { enabled: true, approval: 'always-ask', instructions: 'Only edit .ts files.' },
      terminal: { enabled: true, approval: 'always-ask', instructions: 'No destructive commands.' },
      webFetch: { enabled: true, approval: 'auto', instructions: '' },
    }
    send('agent:update', { id: AGENT_ID, name: 'RT Agent', icon: '🔄', tools })

    const agent = lastReplyData(send('agent:get-full', { id: AGENT_ID })).agent as Record<string, unknown>
    const t = agent.tools as typeof tools
    expect(t.fileEdit.instructions).toBe('Only edit .ts files.')
    expect(t.terminal.enabled).toBe(true)
    expect(t.terminal.instructions).toBe('No destructive commands.')
    expect(t.webFetch.approval).toBe('auto')
  })

  it('does not use never-ask as webFetch default — uses auto', () => {
    // A fresh agent:create should not persist never-ask
    send('agent:create', { name: 'Fresh Agent', icon: '✨' })
    const createdId = [...store.agents.keys()].find((k) => k !== AGENT_ID)
    expect(createdId).toBeTruthy()
    const config = JSON.parse(store.agents.get(createdId!)!)
    expect(config.tools.webFetch.approval).toBe('auto')
    expect(config.tools.webFetch.approval).not.toBe('never-ask')
  })

  it('persists all advanced fields together in a single update', () => {
    const payload = {
      id: AGENT_ID, name: 'Full RT Agent', icon: '🧪',
      systemPrompt: 'You are a full-featured agent.',
      temperature: 0.3,
      maxTokens: 4096,
      responseFormat: 'concise',
      agenticMode: true,
      memory: 'Always be helpful.',
      tools: {
        fileEdit: { enabled: true, approval: 'always-ask', instructions: 'Only TypeScript.' },
        terminal: { enabled: false, approval: 'always-ask', instructions: '' },
        webFetch: { enabled: true, approval: 'auto', instructions: '' },
      },
      mcpServers: ['mcp-primary'],
      thinkingEffort: 'low',
      rootDirectory: '/workspace',
      contextDirectories: ['/workspace/src', '/workspace/tests'],
      contextFiles: ['/workspace/.env.example'],
      contextRules: { ignoredGlobs: ['dist/**'], autoInjectWorkspace: true, autoInjectGit: false },
      customCommands: [{ name: '/check', description: 'Run checks', prompt: 'Run all checks.' }],
    }
    send('agent:update', payload)

    const agent = lastReplyData(send('agent:get-full', { id: AGENT_ID })).agent as Record<string, unknown>
    expect(agent.name).toBe('Full RT Agent')
    expect(agent.systemPrompt).toBe('You are a full-featured agent.')
    expect(agent.temperature).toBe(0.3)
    expect(agent.maxTokens).toBe(4096)
    expect(agent.responseFormat).toBe('concise')
    expect(agent.agenticMode).toBe(true)
    expect(agent.memory).toBe('Always be helpful.')
    expect((agent.tools as Record<string, unknown>)).toMatchObject(payload.tools)
    expect(agent.mcpServers).toEqual(['mcp-primary'])
    expect(agent.thinkingEffort).toBe('low')
    expect(agent.rootDirectory).toBe('/workspace')
    expect(agent.contextDirectories).toEqual(['/workspace/src', '/workspace/tests'])
    expect(agent.contextFiles).toEqual(['/workspace/.env.example'])
    expect(agent.contextRules).toEqual({ ignoredGlobs: ['dist/**'], autoInjectWorkspace: true, autoInjectGit: false })
    expect(agent.customCommands).toEqual([{ name: '/check', description: 'Run checks', prompt: 'Run all checks.' }])
  })
})

describe('knowledge file WS bridge', () => {
  const AGENT_ID = 'agent-kf-1'
  const FILE_PATH = '/workspace/notes.md'

  beforeEach(() => {
    store.agents.clear()
    store.knowledgeFiles.clear()
    store.broadcasts.length = 0
    store.agents.set(AGENT_ID, JSON.stringify({ id: AGENT_ID, name: 'KF Agent', icon: '📄' }))
    registerWsHandlers()
  })

  it('add → list round-trip returns the registered file', () => {
    send('agent:add-knowledge-file', { agentId: AGENT_ID, filePath: FILE_PATH, injectMode: 'always' })
    const replies = send('agent:list-knowledge-files', { agentId: AGENT_ID })
    const data = lastReplyData(replies) as { agentId: string; files: unknown[] }
    expect(data.agentId).toBe(AGENT_ID)
    expect(data.files).toHaveLength(1)
    expect((data.files[0] as Record<string, unknown>).file_path).toBe(FILE_PATH)
  })

  it('add → remove → list leaves empty list', () => {
    const addReplies = send('agent:add-knowledge-file', { agentId: AGENT_ID, filePath: FILE_PATH, injectMode: 'always' })
    const file = (lastReplyData(addReplies) as { file: Record<string, unknown> }).file
    send('agent:remove-knowledge-file', { agentId: AGENT_ID, id: file.id })
    const listReplies = send('agent:list-knowledge-files', { agentId: AGENT_ID })
    expect((lastReplyData(listReplies) as { files: unknown[] }).files).toHaveLength(0)
  })

  it('read returns content for registered file', () => {
    send('agent:add-knowledge-file', { agentId: AGENT_ID, filePath: FILE_PATH, injectMode: 'always' })
    const replies = send('agent:read-knowledge-file', { agentId: AGENT_ID, filePath: FILE_PATH })
    const data = lastReplyData(replies) as Record<string, unknown>
    expect(data.content).toBe('file content')
    expect(data.filePath).toBe(FILE_PATH)
  })

  it('read returns error for unregistered file', () => {
    const replies = send('agent:read-knowledge-file', { agentId: AGENT_ID, filePath: '/unregistered.md' })
    const last = replies[replies.length - 1] as { event: string; data: { message: string } }
    expect(last.event).toBe('agent:knowledge-file-error')
    expect(last.data.message).toMatch(/not registered/)
  })

  it('write returns saved event for registered file', () => {
    send('agent:add-knowledge-file', { agentId: AGENT_ID, filePath: FILE_PATH, injectMode: 'always' })
    const replies = send('agent:write-knowledge-file', { agentId: AGENT_ID, filePath: FILE_PATH, content: 'new content' })
    const last = replies[replies.length - 1] as { event: string; data: { agentId: string; filePath: string } }
    expect(last.event).toBe('agent:knowledge-file-saved')
    expect(last.data.filePath).toBe(FILE_PATH)
  })

  it('sort_order increments for each added file', () => {
    send('agent:add-knowledge-file', { agentId: AGENT_ID, filePath: '/a.md', injectMode: 'always' })
    send('agent:add-knowledge-file', { agentId: AGENT_ID, filePath: '/b.md', injectMode: 'always' })
    const replies = send('agent:list-knowledge-files', { agentId: AGENT_ID })
    const files = (lastReplyData(replies) as { files: Array<{ sort_order: number }> }).files
    expect(files[0].sort_order).toBe(0)
    expect(files[1].sort_order).toBe(1)
  })
})

describe('MCP tool overrides and server trust WS bridge', () => {
  const AGENT_ID = 'agent-mcp-1'

  beforeEach(() => {
    store.agents.clear()
    store.mcpToolOverrides.length = 0
    store.mcpServerTrust.length = 0
    store.agents.set(AGENT_ID, JSON.stringify({ id: AGENT_ID, name: 'MCP Agent', icon: '🔧' }))
    registerWsHandlers()
  })

  it('set → get round-trip persists tool override', () => {
    send('agent:set-mcp-tool-override', {
      agentId: AGENT_ID, serverId: 'server-a', toolName: 'read_file',
      enabled: true, approval: 'always-ask', instructions: 'Only read .ts',
    })
    const replies = send('agent:get-mcp-tool-overrides', { agentId: AGENT_ID })
    const overrides = (lastReplyData(replies) as { overrides: Array<Record<string, unknown>> }).overrides
    expect(overrides).toHaveLength(1)
    expect(overrides[0].tool_name).toBe('read_file')
    expect(overrides[0].enabled).toBe(1)
    expect(overrides[0].approval).toBe('always-ask')
    expect(overrides[0].instructions).toBe('Only read .ts')
  })

  it('set updates existing override in place', () => {
    send('agent:set-mcp-tool-override', { agentId: AGENT_ID, serverId: 'server-a', toolName: 'read_file', enabled: true, approval: 'always-ask', instructions: '' })
    send('agent:set-mcp-tool-override', { agentId: AGENT_ID, serverId: 'server-a', toolName: 'read_file', enabled: false, approval: 'auto', instructions: 'updated' })
    const replies = send('agent:get-mcp-tool-overrides', { agentId: AGENT_ID })
    const overrides = (lastReplyData(replies) as { overrides: Array<Record<string, unknown>> }).overrides
    expect(overrides).toHaveLength(1)
    expect(overrides[0].enabled).toBe(0)
    expect(overrides[0].instructions).toBe('updated')
  })

  it('set-mcp-server-trust → get returns trust value', () => {
    send('agent:set-mcp-server-trust', { agentId: AGENT_ID, serverId: 'server-a', trust: 'always-ask' })
    const replies = send('agent:get-mcp-server-trust', { agentId: AGENT_ID })
    const trust = (lastReplyData(replies) as { trust: Array<Record<string, unknown>> }).trust
    expect(trust).toHaveLength(1)
    expect(trust[0].server_id).toBe('server-a')
    expect(trust[0].trust).toBe('always-ask')
  })

  it('updates server trust in place on re-set', () => {
    send('agent:set-mcp-server-trust', { agentId: AGENT_ID, serverId: 'server-a', trust: 'auto' })
    send('agent:set-mcp-server-trust', { agentId: AGENT_ID, serverId: 'server-a', trust: 'block' })
    const replies = send('agent:get-mcp-server-trust', { agentId: AGENT_ID })
    const trust = (lastReplyData(replies) as { trust: Array<Record<string, unknown>> }).trust
    expect(trust).toHaveLength(1)
    expect(trust[0].trust).toBe('block')
  })

  it('empty get returns empty arrays before any overrides are set', () => {
    const overrideReplies = send('agent:get-mcp-tool-overrides', { agentId: AGENT_ID })
    const trustReplies = send('agent:get-mcp-server-trust', { agentId: AGENT_ID })
    expect((lastReplyData(overrideReplies) as { overrides: unknown[] }).overrides).toHaveLength(0)
    expect((lastReplyData(trustReplies) as { trust: unknown[] }).trust).toHaveLength(0)
  })
})
