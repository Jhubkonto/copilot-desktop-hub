import { BrowserWindow, dialog, app } from 'electron'
import { getDatabase } from './database'
import { randomUUID } from 'crypto'
import { readFileSync, statSync, existsSync, writeFileSync, readdirSync } from 'fs'
import https from 'https'
import { basename, isAbsolute, join, resolve } from 'path'
import { execSync } from 'child_process'
import { sendCopilotChatMessage, abortCopilotStream, type CopilotApiError } from './copilot-api'
import { retrieveToken } from './auth'
import { registerAgentHandlers, getAgentConfig } from './agents'
import { registerToolHandlers } from './tools'
import { registerTerminalHandlers } from './terminal'
import { registerMcpHandlers } from './mcp'
import { registerKnowledgeHandlers } from './knowledge'
import {
  registerProviderHandlers,
  getProviderForAgent,
  getApiKey,
  sendOpenAIMessage,
  sendAnthropicMessage,
  sendAzureMessage,
  getAzureEndpoint,
  abortActiveStream,
  type MessageContentPart,
  type ProviderMessage
} from './providers'
import { safeHandle } from './safe-handle'
import { runOrchestration, type OrchestratorAgent } from './orchestrator'

export function registerIpcHandlers(): void {
  registerSettingsHandlers()
  registerProjectHandlers()
  registerProjectAgentHandlers()
  registerConversationHandlers()
  registerChatHandlers()
  registerMessageHandlers()
  registerFileHandlers()
  registerContextHandlers()
  registerAgentHandlers()
  registerKnowledgeHandlers()
  registerToolHandlers()
  registerTerminalHandlers()
  registerMcpHandlers()
  registerProviderHandlers()
  registerSystemHandlers()
}

const PROJECT_COLORS = new Set(['blue', 'green', 'red', 'purple', 'orange', 'pink', 'yellow', 'gray'])

const DEFAULT_PROJECT_CONFIG = {
  instructions: '',
  rootDirectory: '',
  variables: [],
  instructionMode: 'prepend',
  instructionsEnabled: true,
  orchestrationEnabled: false,
  maxDelegationDepth: 5,
  showTeamActivity: true,
  inScope: [] as Array<{ id: string; description: string; pathGlob?: string }>,
  outOfScope: [] as Array<{ id: string; description: string; pathGlob?: string }>,
  milestones: [] as Array<{ id: string; title: string; description?: string; status: string; completedAt?: number }>,
}

function parseProjectConfig(configJson: string | null): typeof DEFAULT_PROJECT_CONFIG {
  if (!configJson) return { ...DEFAULT_PROJECT_CONFIG }
  try {
    return { ...DEFAULT_PROJECT_CONFIG, ...JSON.parse(configJson) }
  } catch {
    return { ...DEFAULT_PROJECT_CONFIG }
  }
}

function registerProjectHandlers(): void {
  const db = getDatabase()

  safeHandle('project:list', () => {
    const rows = db.prepare('SELECT * FROM projects ORDER BY name ASC').all() as Array<{
      id: string; name: string; color: string; default_model: string | null;
      config_json: string | null; created_at: number; updated_at: number
    }>
    return rows.map((r) => ({ ...r, config: parseProjectConfig(r.config_json), config_json: undefined }))
  })

  safeHandle('project:create', (_event, name: string, color: string) => {
    const safeName = String(name).trim().slice(0, 100)
    const safeColor = PROJECT_COLORS.has(color) ? color : 'blue'
    if (!safeName) throw new Error('Project name is required')
    const id = randomUUID()
    const now = Date.now()
    const defaultConfig = JSON.stringify(DEFAULT_PROJECT_CONFIG)
    db.prepare(
      'INSERT INTO projects (id, name, color, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, safeName, safeColor, defaultConfig, now, now)
    return { id, name: safeName, color: safeColor, config: { ...DEFAULT_PROJECT_CONFIG }, created_at: now, updated_at: now }
  })

  safeHandle('project:rename', (_event, id: string, name: string) => {
    const safeName = String(name).trim().slice(0, 100)
    if (!safeName) throw new Error('Project name is required')
    db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(safeName, Date.now(), id)
    return true
  })

  safeHandle('project:delete', (_event, id: string) => {
    db.prepare('DELETE FROM projects WHERE id = ?').run(id)
    return true
  })

  safeHandle('project:set-conversation', (_event, conversationId: string, projectId: string | null) => {
    db.prepare('UPDATE conversations SET project_id = ?, updated_at = ? WHERE id = ?').run(
      projectId ?? null,
      Date.now(),
      conversationId
    )
    return true
  })

  safeHandle('project:set-default-model', (_event, id: string, model: string | null) => {
    db.prepare('UPDATE projects SET default_model = ?, updated_at = ? WHERE id = ?').run(
      model ?? null,
      Date.now(),
      id
    )
    return true
  })

  safeHandle('project:update-config', (_event, id: string, config: Record<string, unknown>) => {
    const existing = db.prepare('SELECT config_json FROM projects WHERE id = ?').get(id) as { config_json: string | null } | undefined
    const current = existing?.config_json ? (JSON.parse(existing.config_json) as Record<string, unknown>) : {}
    const merged = { ...current, ...config }
    db.prepare('UPDATE projects SET config_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(merged), Date.now(), id)
    return true
  })

  safeHandle('project:get-config', (_event, id: string) => {
    const row = db.prepare('SELECT config_json FROM projects WHERE id = ?').get(id) as { config_json: string | null } | undefined
    return parseProjectConfig(row?.config_json ?? null)
  })
}

function registerProjectAgentHandlers(): void {
  const db = getDatabase()

  safeHandle('project:list-agents', (_event, projectId: string) => {
    const rows = db.prepare(
      'SELECT pa.agent_id, pa.is_primary, pa.sort_order, a.config_json FROM project_agents pa JOIN agents a ON a.id = pa.agent_id WHERE pa.project_id = ? ORDER BY pa.sort_order ASC, pa.added_at ASC'
    ).all(projectId) as { agent_id: string; config_json: string; is_primary: number; sort_order: number }[]
    return rows.map((r) => {
      const cfg = JSON.parse(r.config_json) as { name?: string; icon?: string }
      return {
        agentId: r.agent_id,
        agentName: cfg.name ?? '',
        agentIcon: cfg.icon ?? '',
        isPrimary: r.is_primary === 1,
        sortOrder: r.sort_order,
      }
    })
  })

  safeHandle('project:add-agent', (_event, projectId: string, agentId: string) => {
    db.prepare(
      'INSERT OR IGNORE INTO project_agents (project_id, agent_id, is_primary, sort_order, added_at) VALUES (?, ?, 0, 0, ?)'
    ).run(projectId, agentId, Date.now())
    return true
  })

  safeHandle('project:remove-agent', (_event, projectId: string, agentId: string) => {
    db.prepare('DELETE FROM project_agents WHERE project_id = ? AND agent_id = ?').run(projectId, agentId)
    return true
  })

  safeHandle('project:set-primary-agent', (_event, projectId: string, agentId: string) => {
    const setPrimary = db.transaction(() => {
      db.prepare('UPDATE project_agents SET is_primary = 0 WHERE project_id = ?').run(projectId)
      db.prepare('UPDATE project_agents SET is_primary = 1 WHERE project_id = ? AND agent_id = ?').run(projectId, agentId)
    })
    setPrimary()
    return true
  })

  safeHandle('project:reorder-agents', (_event, projectId: string, orderedAgentIds: string[]) => {
    const update = db.prepare(
      'UPDATE project_agents SET sort_order = ? WHERE project_id = ? AND agent_id = ?'
    )
    const reorder = db.transaction(() => {
      orderedAgentIds.forEach((agentId, index) => {
        update.run(index, projectId, agentId)
      })
    })
    reorder()
    return true
  })
}

function registerSettingsHandlers(): void {
  const db = getDatabase()

  safeHandle('app:get-settings', () => {
    const rows = db.prepare('SELECT key, value FROM settings').all() as {
      key: string
      value: string
    }[]
    const settings: Record<string, string> = {}
    for (const row of rows) {
      settings[row.key] = row.value
    }
    return settings
  })

  safeHandle('app:get-setting', (_event, key: string) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as {
      value: string
    } | undefined
    return row?.value ?? null
  })

  safeHandle('app:set-setting', (_event, key: string, value: string) => {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      key,
      value
    )
    return true
  })

  safeHandle('app:get-theme', () => {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'theme'").get() as
      | { value: string }
      | undefined
    return row?.value ?? 'dark'
  })

  safeHandle('app:set-theme', (_event, theme: string) => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('theme', ?)").run(
      theme
    )
    return true
  })
}

function registerConversationHandlers(): void {
  const db = getDatabase()
  const ensureConversationModelColumn = () => {
    const columns = db.prepare('PRAGMA table_info(conversations)').all() as Array<{ name: string }>
    if (!columns.some((col) => col.name === 'model')) {
      db.exec('ALTER TABLE conversations ADD COLUMN model TEXT')
    }
  }

  safeHandle('conversation:list', () => {
    return db
      .prepare('SELECT * FROM conversations ORDER BY updated_at DESC')
      .all()
  })

  safeHandle('conversation:create', (_event, agentId?: string, projectId?: string) => {
    const id = randomUUID()
    const now = Date.now()
    db.prepare(
      'INSERT INTO conversations (id, agent_id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, agentId ?? null, projectId ?? null, 'New Chat', now, now)
    return {
      id,
      agent_id: agentId ?? null,
      project_id: projectId ?? null,
      title: 'New Chat',
      created_at: now,
      updated_at: now
    }
  })

  safeHandle('conversation:delete', (_event, id: string) => {
    db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
    return true
  })

  safeHandle('conversation:get-messages', (_event, conversationId: string) => {
    return db
      .prepare(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC'
      )
      .all(conversationId)
  })

  safeHandle('conversation:search', (_event, query: string) => {
    if (!query.trim()) {
      return db
        .prepare('SELECT * FROM conversations ORDER BY updated_at DESC')
        .all()
    }
    const searchTerm = `%${query}%`
    return db
      .prepare(
        `SELECT DISTINCT c.* FROM conversations c
         LEFT JOIN messages m ON m.conversation_id = c.id
         WHERE c.title LIKE ? OR m.content LIKE ?
         ORDER BY c.updated_at DESC`
      )
      .all(searchTerm, searchTerm)
  })

  safeHandle('conversation:rename', (_event, id: string, title: string) => {
    db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(
      title,
      Date.now(),
      id
    )
    return true
  })

  safeHandle('conversation:set-model', (_event, id: string, model: string | null) => {
    ensureConversationModelColumn()
    db.prepare('UPDATE conversations SET model = ?, updated_at = ? WHERE id = ?').run(
      model,
      Date.now(),
      id
    )
    return true
  })

  safeHandle('conversation:set-pinned', (_event, id: string, pinned: boolean) => {
    db.prepare('UPDATE conversations SET pinned = ?, updated_at = ? WHERE id = ?').run(
      pinned ? 1 : 0,
      Date.now(),
      id
    )
    return true
  })
}

function registerChatHandlers(): void {
  const db = getDatabase()

  safeHandle(
    'chat:send-message',
    async (
      event,
      conversationId: string,
      content: string,
      options?: {
        attachments?: { id: string; name: string; path: string; size: number }[]
        images?: { id: string; name: string; dataUrl: string }[]
        regenerate?: boolean
        agentId?: string
        model?: string
        messageId?: string
        projectId?: string
        contextSnapshot?: string
      }
    ) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) return null

      const attachments = options?.attachments
      const pastedImages = options?.images ?? []
      const regenerate = options?.regenerate === true
      const agentId = options?.agentId
      const modelOverride = options?.model
      const projectId = options?.projectId
      const contextSnapshot = options?.contextSnapshot ?? null

      if (!regenerate) {
        // Ensure conversation exists, create if needed
        const convo = db
          .prepare('SELECT id FROM conversations WHERE id = ?')
          .get(conversationId) as { id: string } | undefined

        if (!convo) {
          const now = Date.now()
          const title = content.slice(0, 80) + (content.length > 80 ? '...' : '')
          db.prepare(
            'INSERT INTO conversations (id, agent_id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(conversationId, agentId ?? null, projectId ?? null, title, now, now)
        }

        // Save user message
        const userMsgId = options?.messageId ?? randomUUID()
        const attachmentsJson =
          attachments && attachments.length > 0 ? JSON.stringify(attachments) : null
        db.prepare(
          'INSERT INTO messages (id, conversation_id, role, content, attachments, context_snapshot, timestamp, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(userMsgId, conversationId, 'user', content, attachmentsJson, contextSnapshot, Date.now(), null)

        // Update conversation title if it's the first message
        const msgCount = db
          .prepare('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?')
          .get(conversationId) as { count: number }
        if (msgCount.count === 1) {
          const title = content.slice(0, 80) + (content.length > 80 ? '...' : '')
          db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(
            title,
            conversationId
          )
        }
      }

      // Update conversation timestamp
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
        Date.now(),
        conversationId
      )

      // Build augmented content with file attachments
      const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'])
      const IMAGE_MIME: Record<string, string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp'
      }
      const attachedImages: { id: string; name: string; dataUrl: string }[] = [...pastedImages]
      let augmentedContent = content
      if (attachments && attachments.length > 0) {
        let fileContext = ''
        for (const att of attachments) {
          const ext = att.name.split('.').pop()?.toLowerCase() ?? ''
          if (IMAGE_EXTENSIONS.has(ext)) {
            try {
              const buf = readFileSync(att.path)
              const mime = IMAGE_MIME[ext]
              attachedImages.push({ id: att.id, name: att.name, dataUrl: `data:${mime};base64,${buf.toString('base64')}` })
            } catch {
              fileContext += `File: ${att.name} (could not read image)\n\n`
            }
          } else {
            try {
              const fileContent = readFileSync(att.path, 'utf-8')
              fileContext += `File: ${att.name}\n\`\`\`\n${fileContent}\n\`\`\`\n\n`
            } catch {
              fileContext += `File: ${att.name} (could not read file)\n\n`
            }
          }
        }
        if (fileContext) augmentedContent = fileContext + content
      }

      // Look up agent system prompt for this conversation
      const convRow = db
        .prepare('SELECT agent_id, model FROM conversations WHERE id = ?')
        .get(conversationId) as { agent_id: string | null; model: string | null } | undefined
      const settingsRows = db
        .prepare("SELECT key, value FROM settings WHERE key IN ('default_model', 'temperature', 'max_tokens')")
        .all() as Array<{ key: string; value: string }>
      const settingsMap = new Map(settingsRows.map((r) => [r.key, r.value]))
      const defaultModel = settingsMap.get('default_model') || 'default'
      const temperatureSetting = Number.parseFloat(settingsMap.get('temperature') ?? '')
      const maxTokensSetting = Number.parseInt(settingsMap.get('max_tokens') ?? '', 10)
      const generationOptions = {
        temperature: Number.isFinite(temperatureSetting)
          ? Math.min(2, Math.max(0, temperatureSetting))
          : 0.7,
        maxTokens: Number.isFinite(maxTokensSetting)
          ? Math.min(16384, Math.max(256, maxTokensSetting))
          : 4096
      }
      if (convRow?.agent_id) {
        const agentCfg = getAgentConfig(convRow.agent_id)
        if (agentCfg?.systemPrompt) {
          let systemPromptText = agentCfg.systemPrompt as string

          // C.3: Replace {{scratchpad}} with actual scratchpad file content
          if (systemPromptText.includes('{{scratchpad}}')) {
            const scratchpadRow = db
              .prepare(
                "SELECT file_path FROM agent_knowledge_files WHERE agent_id = ? AND file_path LIKE '%-scratchpad.md' LIMIT 1"
              )
              .get(convRow.agent_id) as { file_path: string } | undefined
            const scratchpadContent =
              scratchpadRow?.file_path && existsSync(scratchpadRow.file_path)
                ? readFileSync(scratchpadRow.file_path, 'utf-8')
                : ''
            systemPromptText = systemPromptText.replace(/\{\{scratchpad\}\}/g, scratchpadContent)
          }

          const memoryBlock = agentCfg.memory
            ? `\n\n## Agent Memory\n${agentCfg.memory}`
            : ''

          // C.1/C.4: Inject 'always' knowledge files (truncate if > 32 000 chars)
          const knowledgeRows = db
            .prepare(
              "SELECT file_path FROM agent_knowledge_files WHERE agent_id = ? AND inject_mode = 'always' ORDER BY sort_order ASC"
            )
            .all(convRow.agent_id) as { file_path: string }[]
          const knowledgeBlocks: string[] = []
          for (const kf of knowledgeRows) {
            if (!existsSync(kf.file_path)) continue
            const raw = readFileSync(kf.file_path, 'utf-8')
            const fileName = basename(kf.file_path)
            if (raw.length > 32000) {
              const truncated = raw.split('\n').slice(0, 100).join('\n')
              knowledgeBlocks.push(
                `### ${fileName}\n${truncated}\n\n<!-- [Knowledge file truncated — ${Math.ceil(raw.length / 4)} tokens total] -->`
              )
            } else {
              knowledgeBlocks.push(`### ${fileName}\n${raw}`)
            }
          }
          const knowledgeBlock =
            knowledgeBlocks.length > 0
              ? `\n\n## Knowledge Files\n${knowledgeBlocks.join('\n\n---\n\n')}`
              : ''

          const toolLines: string[] = []
          const tc = agentCfg?.tools as { fileEdit?: { enabled?: boolean; instructions?: string }; terminal?: { enabled?: boolean; instructions?: string }; webFetch?: { enabled?: boolean; instructions?: string } } | null
          if (tc?.fileEdit?.enabled && tc.fileEdit.instructions) {
            toolLines.push(`- **File Edit**: ${tc.fileEdit.instructions}`)
          }
          if (tc?.terminal?.enabled && tc.terminal.instructions) {
            toolLines.push(`- **Terminal**: ${tc.terminal.instructions}`)
          }
          if (tc?.webFetch?.enabled && tc.webFetch.instructions) {
            toolLines.push(`- **Web Fetch**: ${tc.webFetch.instructions}`)
          }
          const mcpOverrides = db.prepare(
            "SELECT tool_name, server_id, instructions FROM agent_mcp_tool_overrides WHERE agent_id=? AND enabled=1 AND instructions != ''"
          ).all(convRow.agent_id) as { tool_name: string; server_id: string; instructions: string }[]
          for (const o of mcpOverrides) {
            toolLines.push(`- **${o.tool_name}** (via ${o.server_id}): ${o.instructions}`)
          }
          const guidelinesBlock = toolLines.length > 0 ? `\n\n## Tool Usage Guidelines\n${toolLines.join('\n')}` : ''

          augmentedContent = `[System Instructions]\n${systemPromptText}${memoryBlock}${knowledgeBlock}${guidelinesBlock}\n[/System Instructions]\n\n${augmentedContent}`
        }
      }

      // ── J.3: Project context injection ────────────────────────────────────
      {
        const convProjectId = projectId ?? (db.prepare('SELECT project_id FROM conversations WHERE id = ?').get(conversationId) as { project_id: string | null } | undefined)?.project_id ?? null
        if (convProjectId) {
          const projRow = db.prepare('SELECT config_json FROM projects WHERE id = ?').get(convProjectId) as { config_json: string | null } | undefined
          const projCfg = parseProjectConfig(projRow?.config_json ?? null)

          if (projCfg.instructionsEnabled && projCfg.instructions.trim()) {
            let instructions = projCfg.instructions
            for (const { key, value } of projCfg.variables) {
              instructions = instructions.replaceAll(`{{${key}}}`, value)
            }

            // Apply variable substitution to agent system prompt if already injected
            if (projCfg.variables.length > 0) {
              for (const { key, value } of projCfg.variables) {
                augmentedContent = augmentedContent.replaceAll(`{{${key}}}`, value)
              }
            }

            const projectBlock = `[Project Context]\n${instructions}\n[/Project Context]`
            switch (projCfg.instructionMode) {
              case 'prepend':
                augmentedContent = `${projectBlock}\n\n${augmentedContent}`
                break
              case 'append': {
                // Insert project block between system instructions and user content
                const splitMarker = '\n\n'
                const splitIdx = augmentedContent.indexOf(splitMarker)
                if (splitIdx !== -1) {
                  augmentedContent = augmentedContent.slice(0, splitIdx) + splitMarker + projectBlock + splitMarker + augmentedContent.slice(splitIdx + splitMarker.length)
                } else {
                  augmentedContent = `${augmentedContent}\n\n${projectBlock}`
                }
                break
              }
              case 'replace':
              case 'standalone':
                // Strip agent system instructions, keep only project block + user content
                augmentedContent = `${projectBlock}\n\n${content}`
                break
            }
          }

          // Apply rootDirectory if set (used by context handlers via projectRootDirectory convention)
          if (projCfg.rootDirectory) {
            // Pass to context handlers by injecting a synthetic context note (non-intrusive)
            // The actual cwd override is handled in context:workspace-summary / context:git handlers
          }

          // K.2: Scope block injection
          const inScopeRules = projCfg.inScope ?? []
          const outOfScopeRules = projCfg.outOfScope ?? []
          const milestonesArr = projCfg.milestones ?? []
          const activeMilestone = milestonesArr.find((m) => m.status === 'active')
          if (activeMilestone || inScopeRules.length > 0 || outOfScopeRules.length > 0) {
            const scopeLines: string[] = []
            if (activeMilestone) {
              const desc = activeMilestone.description ? ` — ${activeMilestone.description}` : ''
              scopeLines.push(`Active Milestone: ${activeMilestone.title}${desc}`)
            }
            if (inScopeRules.length > 0) {
              scopeLines.push('In Scope:')
              for (const r of inScopeRules) {
                scopeLines.push(`  - ${r.description}${r.pathGlob ? ` (${r.pathGlob})` : ''}`)
              }
            }
            if (outOfScopeRules.length > 0) {
              scopeLines.push('Out of Scope (do NOT work on these):')
              for (const r of outOfScopeRules) {
                scopeLines.push(`  - ${r.description}${r.pathGlob ? ` (${r.pathGlob})` : ''}`)
              }
            }
            const scopeBlock = `[Project Scope]\n${scopeLines.join('\n')}\n[/Project Scope]`
            augmentedContent = `${scopeBlock}\n\n${augmentedContent}`
          }

          // Team awareness block — inject when project has ≥2 agents, regardless of orchestration setting.
          // The orchestrator injects its own richer manifest later; this block covers non-orchestrated chats.
          const projCfgRaw = projRow?.config_json ? (() => { try { return JSON.parse(projRow.config_json) as Record<string, unknown> } catch { return {} } })() : {}
          const orchAlreadyEnabled = projCfgRaw.orchestrationEnabled === true
          if (!orchAlreadyEnabled) {
            const teamRows = db.prepare(
              "SELECT pa.agent_id, pa.is_primary, a.config_json FROM project_agents pa JOIN agents a ON pa.agent_id = a.id WHERE pa.project_id = ? ORDER BY pa.is_primary DESC, pa.sort_order ASC"
            ).all(convProjectId) as { agent_id: string; is_primary: number; config_json: string }[]

            if (teamRows.length >= 2) {
              const projName = (db.prepare('SELECT name FROM projects WHERE id = ?').get(convProjectId) as { name: string } | undefined)?.name ?? 'this project'
              const memberLines = teamRows.map((r) => {
                const cfg = (() => { try { return JSON.parse(r.config_json) as Record<string, unknown> } catch { return {} } })()
                const name = typeof cfg.name === 'string' ? cfg.name : 'Agent'
                const icon = typeof cfg.icon === 'string' ? cfg.icon : '🤖'
                const role = r.is_primary ? ' (primary — currently speaking)' : ''
                return `  - ${icon} ${name}${role}`
              })
              const teamBlock =
                `[Project Team — "${projName}"]\n` +
                `This conversation is part of a project with the following agents:\n` +
                memberLines.join('\n') + '\n' +
                `Orchestration is currently disabled, so you cannot autonomously delegate tasks.\n` +
                `If asked about delegation or other agents, be honest: the user can switch agents manually\n` +
                `or enable orchestration in the project settings to allow automatic delegation.\n` +
                `[/Project Team]`
              augmentedContent = `${teamBlock}\n\n${augmentedContent}`
            }
          }
        }
      }

      let responseContent: string

      // Determine which provider to use based on agent config
      let providerName = 'copilot'
      let providerModel = 'default'
      const agentCfg2 = convRow?.agent_id ? getAgentConfig(convRow.agent_id) : null
      const agentModel = typeof agentCfg2?.model === 'string' ? agentCfg2.model : undefined
      const conversationModel = typeof convRow?.model === 'string' ? convRow.model : undefined
      const selectedModel = modelOverride && modelOverride !== 'default'
        ? modelOverride
        : conversationModel && conversationModel !== 'default'
          ? conversationModel
          : agentModel && agentModel !== 'default'
            ? agentModel
            : defaultModel !== 'default'
              ? defaultModel
              : undefined
      if (selectedModel && selectedModel !== 'default') {
        const resolved = getProviderForAgent(selectedModel)
        providerName = resolved.provider
        providerModel = resolved.model
      }
      const effectiveModelName = selectedModel && selectedModel !== 'default' ? selectedModel : 'gpt-4o'
      const modelIdentityInstruction =
        `Runtime model for this conversation: ${effectiveModelName}. ` +
        'If the user asks which model or language model is running this chat, answer with this exact value.'

      // Try BYOK provider if configured
      const byokKey = providerName !== 'copilot' ? getApiKey(providerName as 'openai' | 'anthropic') : null

      // Build conversation history from DB
      const historyRows = db
        .prepare(
          'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC'
        )
        .all(conversationId) as { role: string; content: string }[]

      // Build messages array with history (exclude the just-saved user message for augmented content)
      const historyMessages = historyRows.slice(0, -1).map((m) => ({
        role: m.role,
        content: m.content
      }))

      // Build the current user message content — include pasted images for vision-capable providers
      const buildVisionUserContent = (): MessageContentPart[] => {
        const parts: MessageContentPart[] = [{ type: 'text', text: augmentedContent }]
        for (const img of attachedImages) {
          parts.push({ type: 'image_url', image_url: { url: img.dataUrl } })
        }
        return parts
      }

      const userContent: ProviderMessage['content'] =
        attachedImages.length > 0 ? buildVisionUserContent() : augmentedContent

      // ── Multi-agent orchestration (Feature H) ──────────────────────────────
      // Trigger when the conversation belongs to a project with orchestration
      // enabled, a primary agent, and ≥2 total agents.
      const orchProjectId = projectId ?? convRow
        ? db.prepare('SELECT project_id FROM conversations WHERE id = ?').get(conversationId) as { project_id: string | null } | undefined
        : undefined
      const orchProjId = projectId ?? (orchProjectId as { project_id?: string | null } | undefined)?.project_id ?? null

      if (orchProjId) {
        const projRow = db.prepare('SELECT name, config_json FROM projects WHERE id = ?').get(orchProjId) as { name: string; config_json: string | null } | undefined
        const projConfig = projRow?.config_json ? (() => { try { return JSON.parse(projRow.config_json) as Record<string, unknown> } catch { return {} } })() : {}
        const orchEnabled = projConfig.orchestrationEnabled === true

        if (orchEnabled) {
          const agentRows = db.prepare(
            "SELECT pa.agent_id, pa.is_primary, pa.sort_order, a.config_json FROM project_agents pa JOIN agents a ON pa.agent_id = a.id WHERE pa.project_id = ? ORDER BY pa.sort_order ASC"
          ).all(orchProjId) as { agent_id: string; is_primary: number; sort_order: number; config_json: string }[]

          const primaryRow = agentRows.find((r) => r.is_primary === 1)

          if (primaryRow && agentRows.length >= 2) {
            const teamAgents: OrchestratorAgent[] = agentRows.map((r) => {
              const cfg = (() => { try { return JSON.parse(r.config_json) as Record<string, unknown> } catch { return {} } })()
              return {
                agentId: r.agent_id,
                agentName: typeof cfg.name === 'string' ? cfg.name : 'Agent',
                agentIcon: typeof cfg.icon === 'string' ? cfg.icon : '🤖',
                isPrimary: r.is_primary === 1,
                sortOrder: r.sort_order
              }
            })

            const maxDepth = typeof projConfig.maxDelegationDepth === 'number' ? projConfig.maxDelegationDepth : 5
            const showActivity = projConfig.showTeamActivity !== false

            const { finalContent, teamActivity } = await runOrchestration(
              {
                projectId: orchProjId,
                projectName: projRow?.name ?? 'Project',
                leaderAgentId: primaryRow.agent_id,
                teamAgents,
                conversationId,
                window,
                selectedModel: selectedModel ?? 'default',
                generationOptions,
                maxDelegationDepth: maxDepth,
                showActivity
              },
              userContent,
              historyMessages.filter((m) => m.role !== 'team-activity')
            )

            // Persist team-activity block if there were delegation steps
            if (showActivity && teamActivity.length > 0) {
              const activityMsgId = randomUUID()
              db.prepare(
                'INSERT INTO messages (id, conversation_id, role, content, attachments, timestamp, model) VALUES (?, ?, ?, ?, ?, ?, ?)'
              ).run(activityMsgId, conversationId, 'team-activity', JSON.stringify({ steps: teamActivity }), null, Date.now() - 1, selectedModel ?? null)
            }

            responseContent = finalContent
            const assistantMsgId = randomUUID()
            db.prepare(
              'INSERT INTO messages (id, conversation_id, role, content, attachments, timestamp, model) VALUES (?, ?, ?, ?, ?, ?, ?)'
            ).run(assistantMsgId, conversationId, 'assistant', responseContent, null, Date.now(), selectedModel ?? null)
            return { assistantMsgId }
          }
        }
      }
      // ── End orchestration ─────────────────────────────────────────────────

      if (byokKey && providerName === 'openai') {
        try {
          const messages: ProviderMessage[] = [
            { role: 'system', content: modelIdentityInstruction },
            ...historyMessages,
            { role: 'user', content: userContent }
          ]
          responseContent = await sendOpenAIMessage(byokKey, providerModel, messages, (chunk) => {
            window.webContents.send('chat:stream-response', chunk)
          }, generationOptions)
          window.webContents.send('chat:stream-response', null)
        } catch (error) {
          console.error('OpenAI error:', error)
          const msg = `OpenAI API error: ${(error as Error).message}`
          window.webContents.send('chat:stream-error', {
            type: 'api',
            message: msg,
            retryable: true
          })
          responseContent = msg
        }
      } else if (byokKey && providerName === 'anthropic') {
        try {
          const agentSystemPrompt = typeof agentCfg2?.systemPrompt === 'string' ? agentCfg2.systemPrompt : undefined
          const systemPrompt = agentSystemPrompt
            ? `${agentSystemPrompt}\n\n${modelIdentityInstruction}`
            : modelIdentityInstruction
          const messages: ProviderMessage[] = [...historyMessages, { role: 'user', content: userContent }]
          responseContent = await sendAnthropicMessage(
            byokKey,
            providerModel,
            messages,
            systemPrompt,
            (chunk) => {
              window.webContents.send('chat:stream-response', chunk)
            },
            generationOptions
          )
          window.webContents.send('chat:stream-response', null)
        } catch (error) {
          console.error('Anthropic error:', error)
          const msg = `Anthropic API error: ${(error as Error).message}`
          window.webContents.send('chat:stream-error', {
            type: 'api',
            message: msg,
            retryable: true
          })
          responseContent = msg
        }
      } else if (byokKey && providerName === 'azure') {
        try {
          const azureEndpoint = getAzureEndpoint()
          if (!azureEndpoint) throw new Error('Azure endpoint not configured')
          const messages: ProviderMessage[] = [
            { role: 'system', content: modelIdentityInstruction },
            ...historyMessages,
            { role: 'user', content: userContent }
          ]
          responseContent = await sendAzureMessage(
            byokKey,
            azureEndpoint,
            providerModel,
            messages,
            (chunk) => {
              window.webContents.send('chat:stream-response', chunk)
            },
            generationOptions
          )
          window.webContents.send('chat:stream-response', null)
        } catch (error) {
          console.error('Azure error:', error)
          const msg = `Azure API error: ${(error as Error).message}`
          window.webContents.send('chat:stream-error', {
            type: 'api',
            message: msg,
            retryable: true
          })
          responseContent = msg
        }
      } else {
        // Use Copilot API with GitHub OAuth token (OpenAI-compatible, supports vision)
        try {
          const agentSystemPrompt = typeof agentCfg2?.systemPrompt === 'string' ? agentCfg2.systemPrompt : undefined
          const chatMessages: ProviderMessage[] = []
          chatMessages.push({
            role: 'system',
            content: agentSystemPrompt
              ? `${agentSystemPrompt}\n\n${modelIdentityInstruction}`
              : `You are GitHub Copilot, an AI programming assistant.\n\n${modelIdentityInstruction}`
          })
          chatMessages.push(...historyMessages)
          chatMessages.push({ role: 'user', content: userContent })

          // Use agent model or default
          const copilotModel = selectedModel && selectedModel !== 'default' ? selectedModel : 'gpt-4o'

          responseContent = await sendCopilotChatMessage(window, chatMessages, (chunk) => {
            window.webContents.send('chat:stream-response', chunk)
          }, copilotModel, generationOptions)
          window.webContents.send('chat:stream-response', null)
        } catch (error) {
          console.error('Copilot API error:', error)
          const apiErr = error as CopilotApiError
          const errorType = apiErr.errorType || 'network'
          const retryable = apiErr.retryable ?? true
          const retryAfterSeconds = apiErr.retryAfterSeconds
          let friendlyMessage: string
          switch (errorType) {
            case 'auth':
              friendlyMessage = 'Authentication failed. Please sign in again.'
              break
            case 'model_not_available':
              friendlyMessage = 'Model not available. Choose a different model and try again.'
              break
            case 'rate_limit':
              friendlyMessage = 'Rate limited by Copilot API. Please wait a moment and try again.'
              break
            case 'server':
              friendlyMessage = 'Copilot service is temporarily unavailable. Please try again.'
              break
            case 'empty_response':
              friendlyMessage = 'Copilot returned an empty response. Please try again.'
              break
            default:
              friendlyMessage = `Copilot API error: ${(error as Error).message}`
          }
          const streamErrorPayload: Record<string, unknown> = {
            type: errorType,
            message: friendlyMessage,
            retryable
          }
          if (retryAfterSeconds !== undefined) streamErrorPayload.retryAfterSeconds = retryAfterSeconds
          window.webContents.send('chat:stream-error', streamErrorPayload)
          responseContent = friendlyMessage
        }
      }

      // Save assistant message
      const assistantMsgId = randomUUID()
      db.prepare(
        'INSERT INTO messages (id, conversation_id, role, content, attachments, timestamp, model) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(assistantMsgId, conversationId, 'assistant', responseContent, null, Date.now(), selectedModel ?? null)

      return { assistantMsgId }
    }
  )

  safeHandle('chat:stop-generation', async () => {
    abortActiveStream()
    abortCopilotStream()
    return true
  })
}

function registerMessageHandlers(): void {
  const db = getDatabase()

  safeHandle('message:delete', (_event, id: string) => {
    db.prepare('DELETE FROM messages WHERE id = ?').run(id)
    return true
  })

  safeHandle(
    'message:delete-after',
    (_event, conversationId: string, timestamp: number) => {
      db.prepare(
        'DELETE FROM messages WHERE conversation_id = ? AND timestamp >= ?'
      ).run(conversationId, timestamp)
      return true
    }
  )
}

function registerFileHandlers(): void {
  const db = getDatabase()

  safeHandle('file:open-dialog', async () => {
    const win = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Code & Text',
          extensions: [
            'ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'cpp', 'c', 'h',
            'hpp', 'cs', 'rb', 'php', 'swift', 'kt', 'scala', 'sh', 'bash', 'zsh',
            'ps1', 'sql', 'json', 'yaml', 'yml', 'toml', 'xml', 'html', 'css',
            'scss', 'less', 'md', 'txt', 'csv', 'log', 'env', 'cfg', 'ini', 'conf'
          ]
        },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled) return []

    return result.filePaths.map((filePath) => {
      const stat = statSync(filePath)
      return {
        id: randomUUID(),
        name: basename(filePath),
        path: filePath,
        size: stat.size
      }
    })
  })

  safeHandle('file:get-cwd', () => {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'working_directory'").get() as
      | { value: string }
      | undefined
    if (row?.value) return row.value
    const defaultDir = app.getPath('home')
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('working_directory', ?)").run(defaultDir)
    return defaultDir
  })

  safeHandle('file:set-cwd', (_event, cwd: string) => {
    if (!cwd || !existsSync(cwd)) {
      throw new Error(`Directory does not exist: ${cwd}`)
    }
    const stat = statSync(cwd)
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${cwd}`)
    }
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('working_directory', ?)").run(cwd)
    return true
  })

  safeHandle('file:get-recent-dirs', () => {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'recent_directories'").get() as { value: string } | undefined
    try { return row ? JSON.parse(row.value) : [] } catch { return [] }
  })

  safeHandle('file:add-recent-dir', (_event, path: string) => {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'recent_directories'").get() as { value: string } | undefined
    let dirs: string[] = []
    try { dirs = row ? JSON.parse(row.value) : [] } catch { dirs = [] }
    dirs = [path, ...dirs.filter((d: string) => d !== path)].slice(0, 5)
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('recent_directories', ?)").run(JSON.stringify(dirs))
    return dirs
  })
}

function getWorkingDirectory(): string {
  const db = getDatabase()
  const row = db.prepare("SELECT value FROM settings WHERE key = 'working_directory'").get() as
    | { value: string }
    | undefined
  if (row?.value && existsSync(row.value)) return row.value
  return app.getPath('home')
}

function registerContextHandlers(): void {
  safeHandle('context:read-file', (_event, filePath: string) => {
    if (!filePath) {
      throw new Error('File path is required')
    }
    const cwd = getWorkingDirectory()
    const resolvedPath = isAbsolute(filePath) ? filePath : resolve(cwd, filePath)
    if (!existsSync(resolvedPath)) {
      throw new Error(`File does not exist: ${resolvedPath}`)
    }
    const content = readFileSync(resolvedPath, 'utf-8')
    const limit = 12000
    const truncated = content.length > limit
    return {
      path: resolvedPath,
      content: truncated ? `${content.slice(0, limit)}\n\n...[truncated]` : content,
      truncated
    }
  })

  safeHandle('context:workspace-summary', () => {
    const cwd = getWorkingDirectory()
    const maxDepth = 3
    const maxEntries = 200
    const ignored = new Set(['.git', 'node_modules', 'dist', 'release'])
    const lines: string[] = [cwd]
    let entryCount = 0
    const walk = (dir: string, depth: number) => {
      if (depth > maxDepth || entryCount >= maxEntries) return
      const entries = readdirSync(dir, { withFileTypes: true }).filter((entry) => !ignored.has(entry.name))
      for (const entry of entries) {
        if (entryCount >= maxEntries) break
        const indent = '  '.repeat(depth)
        lines.push(`${indent}- ${entry.name}${entry.isDirectory() ? '/' : ''}`)
        entryCount += 1
        if (entry.isDirectory()) {
          walk(join(dir, entry.name), depth + 1)
        }
      }
    }
    walk(cwd, 1)
    return lines.join('\n')
  })

  safeHandle('context:git', () => {
    const cwd = getWorkingDirectory()
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8' }).trim()
      const status = execSync('git status --short', { cwd, encoding: 'utf8' }).trim()
      const recent = execSync('git log -5 --oneline', { cwd, encoding: 'utf8' }).trim()
      return [
        `Branch: ${branch}`,
        '',
        'Status:',
        status || '(clean)',
        '',
        'Recent commits:',
        recent || '(none)'
      ].join('\n')
    } catch {
      return 'Git context unavailable for the current working directory.'
    }
  })
}

async function generatePlaceholderResponse(
  errorMessage: string,
  window: BrowserWindow
): Promise<string> {
  const response = errorMessage

  const words = response.split(' ')
  for (let i = 0; i < words.length; i++) {
    const chunk = (i === 0 ? '' : ' ') + words[i]
    window.webContents.send('chat:stream-response', chunk)
    await new Promise((resolve) => setTimeout(resolve, 30))
  }

  window.webContents.send('chat:stream-response', null)
  return response
}

function registerSystemHandlers(): void {
  safeHandle('app:get-version', () => {
    return app.getVersion()
  })

  safeHandle('app:save-text-file', async (_event, defaultFileName: string, content: string) => {
    const win = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showSaveDialog(win, {
      defaultPath: defaultFileName,
      filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }]
    })
    if (result.canceled || !result.filePath) return null
    writeFileSync(result.filePath, content, 'utf-8')
    return result.filePath
  })

  safeHandle('app:create-gist', async (_event, filename: string, content: string, description?: string) => {
    const githubToken = retrieveToken()
    if (!githubToken) {
      throw new Error('Not authenticated — sign in with GitHub first')
    }

    const body = JSON.stringify({
      description: description || 'Shared from Copilot Desktop Hub',
      public: false,
      files: {
        [filename || 'conversation.md']: {
          content
        }
      }
    })

    const response = await new Promise<{ status: number; data: string }>((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'api.github.com',
          path: '/gists',
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${githubToken}`,
            'User-Agent': 'CopilotDesktopHub',
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
          }
        },
        (res) => {
          let data = ''
          res.on('data', (chunk) => (data += chunk))
          res.on('end', () => resolve({ status: res.statusCode || 0, data }))
        }
      )
      req.on('error', reject)
      req.write(body)
      req.end()
    })

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`GitHub Gist API error (HTTP ${response.status})`)
    }

    const parsed = JSON.parse(response.data) as { html_url?: string }
    if (!parsed.html_url) {
      throw new Error('GitHub Gist API did not return a URL')
    }
    return parsed.html_url
  })

  safeHandle('app:set-auto-start', (_event, enabled: boolean) => {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true
    })
    return true
  })
}
