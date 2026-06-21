import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { safeHandle } from './safe-handle'
import { getDatabase } from './database'
import { abortActiveStream, PROVIDERS, getOpenRouterModels, isProviderConfigured } from './providers'
import { dispatchChatSend } from './chat-handlers'
import { getCliModels } from './cli-detection'
import { getCachedCatalog } from './model-catalog'
import { retrieveAuthMode } from './auth'
import { getAndroidUpdateManifest, getAndroidWorkspaceInfo, computeSha256 } from './android-handlers'
import { getWorkspaceInfo } from './build-handlers'
import { existsSync as fsExistsSync, copyFileSync as fsCopyFileSync, mkdirSync as fsMkdirSync, readdirSync as fsReaddirSync, statSync as fsStatSync } from 'fs'
import { writeFile as fsWriteFile, readFile as fsReadFile } from 'fs/promises'
import pathModule from 'path'
import { networkInterfaces } from 'os'
import { startFeedServer, getFeedLanUrl } from './local-feed-server'
import { createErrorReport, rowToErrorReport } from './error-report-handlers'
import { listHistory } from './self-heal/history'
import {
  emitInvestigationEvent,
  runInvestigation,
} from './self-heal/investigator'
import { runFix, emitFixEvent } from './self-heal/fix-agent'
import { emitVerificationEvent, runVerification } from './self-heal/verifier'
import { commitSelfHealFix, prepareSelfHealCommit, pushSelfHealFix } from './self-heal/git-ops'
import { approveRelaunch, getRecoveryRuns, prepareReload, rollbackHeal, startReload } from './self-heal/recovery'
import { runProjectGeneratorChatForAndroid, createProjectFromSpec, getProjectGeneratorAgentSummaries } from './project-generator'
import { runAgentGeneratorChatForAndroid, createAgentFromSpec } from './agent-generator'
import { runSkillGeneratorChatForAndroid, createSkillFromSpec } from './skill-generator'
import {
  createArtifactGeneratorRunRecord,
  runArtifactGeneration,
  runArtifactGeneratorChatForAndroid,
  updateArtifactGeneratorRunRecord,
} from './artifact-generator'
import type { ProjectGeneratorSpec, AgentGeneratorSpec, SkillConfig, SkillGeneratorSpec, ArtifactGeneratorMessage, ArtifactSpec, PromptLibraryEntry, PromptLibraryVersion } from '../shared/types'
import { storeApiKey, removeApiKey, getAzureEndpoint, setAzureEndpoint } from './provider-secrets'
import { testProviderKey } from './providers'
import { detectAllClis } from './cli-detection'
import { ClaudeAdapter } from './cli-adapters/claude'
import { CodexAdapter } from './cli-adapters/codex'
import { insertWikiEntry, extractWikiLearningsForWs } from './wiki-handlers'
import { getMcpServersWithStatus, getMcpServerStatus, addMcpServer, updateMcpServer, removeMcpServer, restartMcpServer, listMcpTools, listMcpToolsForAgent } from './mcp'
import {
  insertPromptLibraryEntry,
  listPromptLibraryVersions,
  rollbackPromptLibraryEntry,
  updatePromptLibraryEntry,
} from './prompt-handlers'
import { buildConversationExportPack, forkConversation, importConversationExport, getConversationCompressionPreview, prepareConversationCompressionSummary, saveConversationCompressionSummary } from './conversation-handlers'
import {
  createSkillConfig,
  deleteSkillConfig,
  duplicateSkillConfig,
  getSkillAgentLinks,
  getSkillAgentUsage,
  getSkillConfig,
  listSkillConfigs,
  reorderSkillsForAgent,
  setSkillAgentAttachment,
  updateSkillConfig,
} from './skills'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { parseConversationExport } from './conversation-serialization'
import { app } from 'electron'
import {
  startWsServer,
  stopWsServer,
  getWsStatus,
  getQrDataUrl,
  regenerateToken,
  setWsCommandHandler,
  broadcastToMobile,
  getWakelockEnabled,
  setWakelockEnabled,
} from './ws-server'

// Filled in by tools.ts after registration to avoid a circular import
let resolveApprovalFn: ((requestId: string, approved: boolean) => boolean) | null = null
export function registerApprovalResolver(fn: (requestId: string, approved: boolean) => boolean): void {
  resolveApprovalFn = fn
}

function mobilePromptEntry(entry: PromptLibraryEntry): Record<string, unknown> {
  return {
    id: entry.id,
    title: entry.title,
    body: entry.body,
    description: entry.description,
    category: entry.category,
    tags: entry.tags,
    scope: entry.scope,
    projectId: entry.project_id,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
  }
}

function mobilePromptVersion(version: PromptLibraryVersion): Record<string, unknown> {
  return {
    id: version.id,
    promptId: version.prompt_id,
    version: version.version,
    title: version.title,
    body: version.body,
    description: version.description,
    category: version.category,
    tags: version.tags,
    variables: version.variables,
    scope: version.scope,
    projectId: version.project_id,
    source: version.source,
    createdAt: version.created_at,
    diff: version.diff,
  }
}

export function registerWsHandlers(): void {
  setWsCommandHandler((command, data, reply) => {
    if (command === 'ping') return

    if (command === 'mobile:fcm-token') {
      const deviceId = typeof data.deviceId === 'string' ? data.deviceId : null
      const token = typeof data.token === 'string' ? data.token : null
      if (deviceId && token) {
        const db = getDatabase()
        db.prepare(
          'INSERT OR REPLACE INTO mobile_clients (device_id, fcm_token, registered_at) VALUES (?, ?, ?)'
        ).run(deviceId, token, Date.now())
        // Enable auto-start on first successful pairing if not already set
        const settings = app.getLoginItemSettings()
        if (!settings.openAtLogin) {
          app.setLoginItemSettings({ openAtLogin: true })
        }
      }
      return
    }

    if (command === 'tool:approve' || command === 'tool:reject') {
      const requestId = typeof data.requestId === 'string' ? data.requestId : ''
      resolveApprovalFn?.(requestId, command === 'tool:approve')
      BrowserWindow.getAllWindows().forEach((w) => {
        if (!w.isDestroyed()) w.webContents.send('tool:approval-resolved', requestId)
      })
      return
    }

    if (command === 'agent:stop') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : undefined
      abortActiveStream(conversationId)
      return
    }

    if (command === 'error-report:request-capture') {
      try {
        const result = createErrorReport({
          title: typeof data.title === 'string' ? data.title : 'Android bug report',
          description: typeof data.description === 'string' ? data.description : 'Requested from Android companion.',
          includeLog: data.includeLog !== false,
          includeScreenshot: false,
        })
        reply({ event: 'error-report:captured', data: result })
      } catch (error) {
        reply({
          event: 'error-report:error',
          data: { message: error instanceof Error ? error.message : String(error) },
        })
      }
      return
    }

    if (command === 'self-heal:get-history') {
      reply({ event: 'self-heal:history', data: { entries: listHistory() } })
      return
    }

    if (command === 'self-heal:get-reports') {
      const rows = getDatabase()
        .prepare('SELECT * FROM error_reports ORDER BY created_at DESC LIMIT 50')
        .all() as Record<string, unknown>[]
      reply({ event: 'self-heal:reports', data: { reports: rows.map(rowToErrorReport) } })
      return
    }

    if (command === 'self-heal:start-investigation') {
      const reportId = typeof data.reportId === 'string' ? data.reportId : ''
      if (!reportId) return
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return
      void runInvestigation(win, reportId, {
        onChunk: (chunk) => {
          broadcastToMobile({ event: 'self-heal:investigation-chunk', data: { reportId, chunk } })
          emitInvestigationEvent(win, 'self-heal:investigation-chunk', { reportId, chunk })
        },
        onActivity: (activity) => {
          broadcastToMobile({ event: 'self-heal:investigation-activity', data: activity })
          emitInvestigationEvent(win, 'self-heal:investigation-activity', activity)
        },
      }).then((result) => {
        broadcastToMobile({ event: 'self-heal:investigation-done', data: result })
        emitInvestigationEvent(win, 'self-heal:investigation-done', result)
      })
      return
    }

    if (command === 'self-heal:start-fix') {
      const reportId = typeof data.reportId === 'string' ? data.reportId : ''
      if (!reportId) return
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return
      void runFix(win, reportId, {
        onEvent: (event) => {
          broadcastToMobile({ event: 'self-heal:fix-event', data: event })
          emitFixEvent(win, 'self-heal:fix-event', event)
        },
      }).then((result) => {
        broadcastToMobile({ event: 'self-heal:fix-done', data: result })
        emitFixEvent(win, 'self-heal:fix-done', result)
      })
      return
    }

    if (command === 'self-heal:start-verification') {
      const reportId = typeof data.reportId === 'string' ? data.reportId : ''
      if (!reportId) return
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return
      const runId = `${reportId}-${Date.now()}`
      void runVerification(reportId, (event) => {
        broadcastToMobile({ event: 'self-heal:verification-event', data: event })
        emitVerificationEvent(win, 'self-heal:verification-event', event)
      }, runId).then((result) => {
        broadcastToMobile({ event: 'self-heal:verification-done', data: result })
        emitVerificationEvent(win, 'self-heal:verification-done', result)
      })
      return
    }

    if (command === 'self-heal:get-staged-diff') {
      const reportId = typeof data.reportId === 'string' ? data.reportId : ''
      const relativePath = typeof data.relativePath === 'string' ? data.relativePath : ''
      if (!reportId || !relativePath) return
      const row = getDatabase()
        .prepare('SELECT diff_json FROM self_heal_diffs WHERE report_id = ? AND relative_path = ?')
        .get(reportId, relativePath) as { diff_json: string } | undefined
      if (!row) {
        reply({ event: 'self-heal:staged-diff', data: { reportId, relativePath, hunks: null } })
        return
      }
      reply({
        event: 'self-heal:staged-diff',
        data: { reportId, relativePath, ...(JSON.parse(row.diff_json) as object) },
      })
      return
    }

    if (command === 'self-heal:list-staged-files') {
      const reportId = typeof data.reportId === 'string' ? data.reportId : ''
      if (!reportId) return
      const row = getDatabase()
        .prepare('SELECT fix_staged_files, fix_status FROM error_reports WHERE id = ?')
        .get(reportId) as { fix_staged_files: string; fix_status: string } | undefined
      if (!row) return
      reply({
        event: 'self-heal:staged-files',
        data: {
          reportId,
          fixStatus: row.fix_status,
          stagedFiles: JSON.parse(row.fix_staged_files || '[]'),
        },
      })
      return
    }

    if (command === 'self-heal:git-prepare-commit') {
      const reportId = typeof data.reportId === 'string' ? data.reportId : ''
      if (!reportId) return
      void prepareSelfHealCommit(reportId).then((result) => {
        reply({ event: 'self-heal:git-prepare-result', data: result })
      })
      return
    }

    if (command === 'self-heal:git-commit') {
      const reportId = typeof data.reportId === 'string' ? data.reportId : ''
      const message = typeof data.message === 'string' ? data.message : ''
      if (!reportId) return
      void commitSelfHealFix(reportId, message).then((result) => {
        reply({ event: 'self-heal:git-commit-result', data: result })
      })
      return
    }

    if (command === 'self-heal:git-push') {
      const reportId = typeof data.reportId === 'string' ? data.reportId : ''
      if (!reportId) return
      void pushSelfHealFix(reportId).then((result) => {
        reply({ event: 'self-heal:git-push-result', data: result })
      })
      return
    }

    if (command === 'self-heal:prepare-reload') {
      const reportId = typeof data.reportId === 'string' ? data.reportId : ''
      if (!reportId) return
      void prepareReload(reportId).then((result) => {
        reply({ event: 'self-heal:reload-prepare-result', data: result })
      })
      return
    }

    if (command === 'self-heal:get-recovery-runs') {
      const reportId = typeof data.reportId === 'string' ? data.reportId : ''
      if (!reportId) return
      reply({ event: 'self-heal:recovery-runs', data: { reportId, runs: getRecoveryRuns(reportId) } })
      return
    }

    if (command === 'self-heal:start-reload') {
      const recoveryId = typeof data.recoveryId === 'string' ? data.recoveryId : ''
      if (!recoveryId) return
      void startReload(recoveryId).then((result) => {
        reply({ event: 'self-heal:reload-start-result', data: result })
      })
      return
    }

    if (command === 'self-heal:approve-relaunch') {
      const recoveryId = typeof data.recoveryId === 'string' ? data.recoveryId : ''
      if (!recoveryId) return
      reply({ event: 'self-heal:relaunch-result', data: approveRelaunch(recoveryId) })
      return
    }

    if (command === 'self-heal:request-rollback') {
      const recoveryId = typeof data.recoveryId === 'string' ? data.recoveryId : ''
      if (!recoveryId) return
      void rollbackHeal(recoveryId, (event) => {
        broadcastToMobile({ event: 'self-heal:recovery-event', data: event })
      })
      return
    }

    if (command === 'model:list') {
      let backend = typeof data.backend === 'string' ? data.backend : undefined
      const agentId = typeof data.agentId === 'string' ? data.agentId : undefined
      if (!backend && agentId) {
        const db = getDatabase()
        const row = db.prepare("SELECT json_extract(config_json, '$.backend') AS backend FROM agents WHERE id = ?").get(agentId) as
          | { backend: string | null }
          | undefined
        backend = row?.backend ?? undefined
      }
      const byId = new Map<string, { id: string; label: string; vendor?: string }>()
      byId.set('default', { id: 'default', label: 'Default model' })

      const catalogById = new Map(getCachedCatalog().map((model) => [model.id, model]))
      const configuredProviders = PROVIDERS.filter((provider) => isProviderConfigured(provider.name))
      const getProviderModelIds = (provider: (typeof PROVIDERS)[number]) =>
        provider.name === 'openrouter' ? getOpenRouterModels() : provider.models

      if (backend) {
        // Explicit backend requested — return just that source (existing per-chat model picker behaviour)
        const resolvedBackend = backend
        const source =
          resolvedBackend === 'codex-cli'
            ? { type: 'cli', label: 'Codex CLI models', backend: 'codex-cli' }
            : resolvedBackend === 'claude-cli'
              ? { type: 'cli', label: 'Claude CLI models', backend: 'claude-cli' }
              : configuredProviders.length > 0
                ? {
                    type: 'provider',
                    label: `Configured ${configuredProviders.map((provider) => provider.label).join(', ')} models`,
                  }
                : { type: 'none', label: 'No configured model backend' }

        const models =
          resolvedBackend === 'codex-cli'
            ? getCliModels('codex-cli').map((model) => ({ ...model, vendor: 'Codex CLI' }))
            : resolvedBackend === 'claude-cli'
              ? getCliModels('claude-cli').map((model) => ({ ...model, vendor: 'Claude CLI' }))
              : configuredProviders
                  .flatMap((provider) => getProviderModelIds(provider).map((model) => ({
                    id: provider.name === 'azure' ? `azure:${model}` : model,
                    label: catalogById.get(model)?.name ?? (provider.name === 'azure' ? `Azure ${model}` : model),
                    vendor: provider.label,
                  })))

        for (const model of models) {
          if (!byId.has(model.id)) byId.set(model.id, model)
        }
        reply({ event: 'model:list', data: { models: [...byId.values()], source } })
        return
      }

      // No explicit backend — aggregate ALL available sources for the model picker
      if (ClaudeAdapter.isAvailable()) {
        for (const model of getCliModels('claude-cli')) {
          if (!byId.has(model.id)) byId.set(model.id, { ...model, vendor: 'Claude CLI' })
        }
      }
      if (CodexAdapter.isAvailable()) {
        for (const model of getCliModels('codex-cli')) {
          if (!byId.has(model.id)) byId.set(model.id, { ...model, vendor: 'Codex CLI' })
        }
      }
      for (const provider of configuredProviders) {
        for (const model of getProviderModelIds(provider)) {
          const id = provider.name === 'azure' ? `azure:${model}` : model
          if (!byId.has(id)) {
            byId.set(id, {
              id,
              label: catalogById.get(model)?.name ?? (provider.name === 'azure' ? `Azure ${model}` : model),
              vendor: provider.label,
            })
          }
        }
      }

      const hasAnySources =
        ClaudeAdapter.isAvailable() || CodexAdapter.isAvailable() || configuredProviders.length > 0
      const sourceLabel = [
        ClaudeAdapter.isAvailable() ? 'Claude CLI' : null,
        CodexAdapter.isAvailable() ? 'Codex CLI' : null,
        ...configuredProviders.map((p) => p.label),
      ]
        .filter(Boolean)
        .join(', ')
      const source = hasAnySources
        ? { type: 'provider', label: sourceLabel }
        : { type: 'none', label: 'No configured model backend' }

      reply({ event: 'model:list', data: { models: [...byId.values()], source } })
      return
    }

    if (command === 'chat:send-message') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      const content = typeof data.content === 'string' ? data.content : ''
      const model = typeof data.model === 'string' ? data.model : undefined
      const agentId = typeof data.agentId === 'string' ? data.agentId : undefined
      const projectId = typeof data.projectId === 'string' ? data.projectId : undefined
      const rawImages = Array.isArray(data.images) ? data.images : []
      const images = rawImages.filter(
        (img): img is { id: string; name: string; dataUrl: string } =>
          typeof img === 'object' && img !== null &&
          typeof (img as Record<string, unknown>).id === 'string' &&
          typeof (img as Record<string, unknown>).name === 'string' &&
          typeof (img as Record<string, unknown>).dataUrl === 'string'
      )
      if (!conversationId || (!content && images.length === 0)) return
      const wins = BrowserWindow.getAllWindows()
      if (wins.length === 0) return
      wins[0].webContents.send('chat:remote-message', {
        conversationId,
        content,
        images: images.length > 0 ? images : undefined,
      })
      // If the requested model belongs to a CLI backend, tell the dispatcher so it
      // routes through that CLI instead of falling through to a BYOK provider.
      let inferredCliBackend: 'codex-cli' | 'claude-cli' | undefined
      if (model && model !== 'default') {
        if (CodexAdapter.isAvailable() && getCliModels('codex-cli').some((m) => m.id === model)) {
          inferredCliBackend = 'codex-cli'
        } else if (ClaudeAdapter.isAvailable() && getCliModels('claude-cli').some((m) => m.id === model)) {
          inferredCliBackend = 'claude-cli'
        }
      }
      void dispatchChatSend(wins[0], conversationId, content, { model, agentId, projectId, images: images.length > 0 ? images : undefined, cliBackend: inferredCliBackend })
      return
    }

    const db = getDatabase()

    if (command === 'android:update-manifest') {
      void getAndroidUpdateManifest(db).then((manifest) => reply({ event: 'android:update-manifest', data: manifest }))
      return
    }

    if (command === 'conversation:list') {
      const rows = db.prepare(`
          SELECT c.id, c.title, c.created_at, c.updated_at,
            c.agent_id,
            c.model,
            json_extract(a.config_json, '$.name') AS agent_name,
            json_extract(a.config_json, '$.icon') AS agent_icon,
            c.project_id,
            p.name AS project_name,
            (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY timestamp DESC LIMIT 1) AS last_message
          FROM conversations c
          LEFT JOIN agents a ON c.agent_id = a.id
          LEFT JOIN projects p ON c.project_id = p.id
          ORDER BY c.updated_at DESC
          LIMIT 50
        `).all()
      reply({ event: 'conversation:list', data: rows })
      return
    }

    if (command === 'conversation:set-model') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      const model = typeof data.model === 'string' && data.model !== 'default' ? data.model : null
      if (!conversationId) return
      db.prepare('UPDATE conversations SET model = ?, updated_at = ? WHERE id = ?').run(model, Date.now(), conversationId)
      reply({ event: 'conversation:model-updated', data: { conversationId, model } })
      return
    }

    if (command === 'project:list') {
      const rows = db.prepare(`
          SELECT p.id, p.name, p.color,
            (SELECT COUNT(*) FROM conversations WHERE project_id = p.id) AS chat_count,
            (SELECT GROUP_CONCAT(NULLIF(json_extract(a.config_json, '$.icon'), ''), ',')
             FROM project_agents pa JOIN agents a ON pa.agent_id = a.id
             WHERE pa.project_id = p.id
             ORDER BY pa.sort_order ASC) AS agent_icons
          FROM projects p ORDER BY p.name ASC
        `).all()
      reply({ event: 'project:list', data: { projects: rows } })
      return
    }

    if (command === 'conversation:get-messages') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      const rows = db.prepare(
        `SELECT id, role, content, model, attachments, timestamp, thinking_blocks FROM messages
           WHERE conversation_id = ? ORDER BY timestamp ASC`
      ).all(conversationId)
      reply({ event: 'conversation:messages', data: { conversationId, messages: rows } })
      return
    }

    if (command === 'agent:list') {
      const rows = db.prepare(
        `SELECT id,
          json_extract(config_json, '$.name') AS name,
          json_extract(config_json, '$.icon') AS icon,
          json_extract(config_json, '$.backend') AS backend,
          json_extract(config_json, '$.cliModel') AS cli_model
         FROM agents ORDER BY created_at ASC`
      ).all()
      reply({ event: 'agent:list', data: { agents: rows } })
      return
    }

    if (command === 'conversation:create') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : null
      const projectId = typeof data.projectId === 'string' ? data.projectId : null
      const title = typeof data.title === 'string' ? data.title : 'New Chat'
      const id = randomUUID()
      const now = Date.now()
      db.prepare(
        `INSERT INTO conversations (id, agent_id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, agentId, projectId, title, now, now)
      reply({ event: 'conversation:created', data: { id, agentId, projectId, title } })
      return
    }

    if (command === 'conversation:rename') {
      const id = typeof data.id === 'string' ? data.id : ''
      const title = typeof data.title === 'string' ? data.title : ''
      if (!id || !title) return
      db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(title, Date.now(), id)
      broadcastToMobile({ event: 'conversation:renamed', data: { id, title } })
      return
    }

    if (command === 'conversation:delete') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
      broadcastToMobile({ event: 'conversation:deleted', data: { id } })
      return
    }

    if (command === 'conversation:search') {
      const query = typeof data.query === 'string' ? data.query.trim() : ''
      const rows = query
        ? db.prepare(`
            SELECT DISTINCT c.id, c.title, c.created_at, c.updated_at,
              c.agent_id, c.model,
              json_extract(a.config_json, '$.name') AS agent_name,
              json_extract(a.config_json, '$.icon') AS agent_icon,
              c.project_id, p.name AS project_name,
              (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY timestamp DESC LIMIT 1) AS last_message
            FROM conversations c
            LEFT JOIN messages m ON m.conversation_id = c.id
            LEFT JOIN agents a ON c.agent_id = a.id
            LEFT JOIN projects p ON c.project_id = p.id
            WHERE c.title LIKE ? OR m.content LIKE ?
            ORDER BY c.updated_at DESC
          `).all(`%${query}%`, `%${query}%`)
        : db.prepare(`
            SELECT c.id, c.title, c.created_at, c.updated_at,
              c.agent_id, c.model,
              json_extract(a.config_json, '$.name') AS agent_name,
              json_extract(a.config_json, '$.icon') AS agent_icon,
              c.project_id, p.name AS project_name,
              (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY timestamp DESC LIMIT 1) AS last_message
            FROM conversations c
            LEFT JOIN agents a ON c.agent_id = a.id
            LEFT JOIN projects p ON c.project_id = p.id
            ORDER BY c.updated_at DESC
          `).all()
      reply({ event: 'conversation:search-results', data: { conversations: rows } })
      return
    }

    if (command === 'message:delete') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      db.prepare('DELETE FROM messages WHERE id = ?').run(id)
      reply({ event: 'message:deleted', data: { id } })
      return
    }

    if (command === 'project:create') {
      const name = typeof data.name === 'string' ? data.name.trim() : ''
      const color = typeof data.color === 'string' ? data.color : 'blue'
      if (!name) return
      const id = randomUUID()
      const now = Date.now()
      db.prepare(
        'INSERT INTO projects (id, name, color, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, name, color, JSON.stringify({}), now, now)
      broadcastToMobile({ event: 'project:created', data: { project: { id, name, color, chat_count: 0, agent_icons: null } } })
      return
    }

    if (command === 'project:rename') {
      const id = typeof data.id === 'string' ? data.id : ''
      const name = typeof data.name === 'string' ? data.name.trim() : ''
      if (!id || !name) return
      db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(name, Date.now(), id)
      broadcastToMobile({ event: 'project:renamed', data: { id, name } })
      return
    }

    if (command === 'project:delete') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      db.prepare('DELETE FROM projects WHERE id = ?').run(id)
      broadcastToMobile({ event: 'project:deleted', data: { id } })
      return
    }

    if (command === 'project:update-config') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const existing = db.prepare('SELECT config_json FROM projects WHERE id = ?').get(id) as { config_json: string | null } | undefined
      const current = existing?.config_json ? (JSON.parse(existing.config_json) as Record<string, unknown>) : {}
      const patch: Record<string, unknown> = {}
      if (typeof data.instructions === 'string') patch.instructions = data.instructions
      if (typeof data.rootDirectory === 'string') patch.rootDirectory = data.rootDirectory
      if (Array.isArray(data.variables)) patch.variables = data.variables
      if (typeof data.orchestrationEnabled === 'boolean') patch.orchestrationEnabled = data.orchestrationEnabled
      if (typeof data.maxDelegationDepth === 'number') patch.maxDelegationDepth = Math.max(1, Math.min(10, data.maxDelegationDepth))
      if (typeof data.showTeamActivity === 'boolean') patch.showTeamActivity = data.showTeamActivity
      if (typeof data.defaultModel === 'string') patch.defaultModel = data.defaultModel
      if (typeof data.instructionMode === 'string') patch.instructionMode = data.instructionMode
      if (typeof data.instructionsEnabled === 'boolean') patch.instructionsEnabled = data.instructionsEnabled
      if (Array.isArray(data.inScope)) patch.inScope = data.inScope
      if (Array.isArray(data.outOfScope)) patch.outOfScope = data.outOfScope
      if (Array.isArray(data.milestones)) patch.milestones = data.milestones
      const merged = { ...current, ...patch }
      db.prepare('UPDATE projects SET config_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(merged), Date.now(), id)
      broadcastToMobile({ event: 'project:config-updated', data: { id } })
      return
    }

    if (command === 'project:get-config') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const row = db.prepare('SELECT config_json FROM projects WHERE id = ?').get(id) as { config_json: string | null } | undefined
      const config = row?.config_json ? (JSON.parse(row.config_json) as Record<string, unknown>) : {}
      reply({ event: 'project:config', data: { id, config } })
      return
    }

    if (command === 'project:list-agents') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const rows = db.prepare(
        'SELECT pa.agent_id, pa.is_primary, pa.sort_order, a.config_json FROM project_agents pa JOIN agents a ON a.id = pa.agent_id WHERE pa.project_id = ? ORDER BY pa.sort_order ASC, pa.added_at ASC'
      ).all(id) as { agent_id: string; config_json: string; is_primary: number; sort_order: number }[]
      const agents = rows.map((r) => {
        const cfg = JSON.parse(r.config_json) as { name?: string; icon?: string }
        return { agentId: r.agent_id, agentName: cfg.name ?? '', agentIcon: cfg.icon ?? '', isPrimary: r.is_primary === 1, sortOrder: r.sort_order }
      })
      reply({ event: 'project:agents', data: { id, agents } })
      return
    }

    if (command === 'project:add-agent') {
      const id = typeof data.id === 'string' ? data.id : ''
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      if (!id || !agentId) return
      db.prepare('INSERT OR IGNORE INTO project_agents (project_id, agent_id, is_primary, sort_order, added_at) VALUES (?, ?, 0, 0, ?)').run(id, agentId, Date.now())
      const rows = db.prepare(
        'SELECT pa.agent_id, pa.is_primary, pa.sort_order, a.config_json FROM project_agents pa JOIN agents a ON a.id = pa.agent_id WHERE pa.project_id = ? ORDER BY pa.sort_order ASC, pa.added_at ASC'
      ).all(id) as { agent_id: string; config_json: string; is_primary: number; sort_order: number }[]
      const agents = rows.map((r) => {
        const cfg = JSON.parse(r.config_json) as { name?: string; icon?: string }
        return { agentId: r.agent_id, agentName: cfg.name ?? '', agentIcon: cfg.icon ?? '', isPrimary: r.is_primary === 1, sortOrder: r.sort_order }
      })
      reply({ event: 'project:agents', data: { id, agents } })
      return
    }

    if (command === 'project:remove-agent') {
      const id = typeof data.id === 'string' ? data.id : ''
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      if (!id || !agentId) return
      db.prepare('DELETE FROM project_agents WHERE project_id = ? AND agent_id = ?').run(id, agentId)
      const rows = db.prepare(
        'SELECT pa.agent_id, pa.is_primary, pa.sort_order, a.config_json FROM project_agents pa JOIN agents a ON a.id = pa.agent_id WHERE pa.project_id = ? ORDER BY pa.sort_order ASC, pa.added_at ASC'
      ).all(id) as { agent_id: string; config_json: string; is_primary: number; sort_order: number }[]
      const agents = rows.map((r) => {
        const cfg = JSON.parse(r.config_json) as { name?: string; icon?: string }
        return { agentId: r.agent_id, agentName: cfg.name ?? '', agentIcon: cfg.icon ?? '', isPrimary: r.is_primary === 1, sortOrder: r.sort_order }
      })
      reply({ event: 'project:agents', data: { id, agents } })
      return
    }

    if (command === 'project:set-primary-agent') {
      const id = typeof data.id === 'string' ? data.id : ''
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      if (!id || !agentId) return
      const setPrimary = db.transaction(() => {
        db.prepare('UPDATE project_agents SET is_primary = 0 WHERE project_id = ?').run(id)
        db.prepare('UPDATE project_agents SET is_primary = 1 WHERE project_id = ? AND agent_id = ?').run(id, agentId)
      })
      setPrimary()
      const rows = db.prepare(
        'SELECT pa.agent_id, pa.is_primary, pa.sort_order, a.config_json FROM project_agents pa JOIN agents a ON a.id = pa.agent_id WHERE pa.project_id = ? ORDER BY pa.sort_order ASC, pa.added_at ASC'
      ).all(id) as { agent_id: string; config_json: string; is_primary: number; sort_order: number }[]
      const agents = rows.map((r) => {
        const cfg = JSON.parse(r.config_json) as { name?: string; icon?: string }
        return { agentId: r.agent_id, agentName: cfg.name ?? '', agentIcon: cfg.icon ?? '', isPrimary: r.is_primary === 1, sortOrder: r.sort_order }
      })
      reply({ event: 'project:agents', data: { id, agents } })
      return
    }

    if (command === 'project:reorder-agents') {
      const id = typeof data.id === 'string' ? data.id : ''
      const agentIds = Array.isArray(data.agentIds) ? data.agentIds.filter((agentId): agentId is string => typeof agentId === 'string') : []
      if (!id || agentIds.length === 0) return
      const update = db.prepare('UPDATE project_agents SET sort_order = ? WHERE project_id = ? AND agent_id = ?')
      const reorder = db.transaction(() => {
        agentIds.forEach((agentId, index) => update.run(index, id, agentId))
      })
      reorder()
      const rows = db.prepare(
        'SELECT pa.agent_id, pa.is_primary, pa.sort_order, a.config_json FROM project_agents pa JOIN agents a ON a.id = pa.agent_id WHERE pa.project_id = ? ORDER BY pa.sort_order ASC, pa.added_at ASC'
      ).all(id) as { agent_id: string; config_json: string; is_primary: number; sort_order: number }[]
      const agents = rows.map((r) => {
        const cfg = JSON.parse(r.config_json) as { name?: string; icon?: string }
        return { agentId: r.agent_id, agentName: cfg.name ?? '', agentIcon: cfg.icon ?? '', isPrimary: r.is_primary === 1, sortOrder: r.sort_order }
      })
      reply({ event: 'project:agents', data: { id, agents } })
      return
    }

    if (command === 'agent:create') {
      const name = typeof data.name === 'string' ? data.name.trim() : ''
      const icon = typeof data.icon === 'string' ? data.icon : ''
      if (!name) return
      const id = randomUUID()
      const now = Date.now()
      const config = {
        id, name, icon, systemPrompt: '', temperature: 0.7, maxTokens: 8192,
        mcpServers: [], agenticMode: false, responseFormat: 'default',
        tools: {
          fileEdit: { enabled: true, approval: 'always-ask' },
          terminal: { enabled: false, approval: 'always-ask' },
          webFetch: { enabled: true, approval: 'auto' },
        },
      }
      db.prepare(
        'INSERT INTO agents (id, config_json, is_default, created_at, updated_at) VALUES (?, ?, 0, ?, ?)'
      ).run(id, JSON.stringify(config), now, now)
      broadcastToMobile({ event: 'agent:created', data: { agent: { id, name, icon } } })
      return
    }

    if (command === 'agent:update') {
      const id = typeof data.id === 'string' ? data.id : ''
      const name = typeof data.name === 'string' ? data.name.trim() : ''
      const icon = typeof data.icon === 'string' ? data.icon : ''
      if (!id || !name) return
      const existing = db.prepare('SELECT config_json FROM agents WHERE id = ?').get(id) as { config_json: string } | undefined
      if (!existing) return
      const prev = JSON.parse(existing.config_json) as Record<string, unknown>
      const patch: Record<string, unknown> = { name, icon }
      if (typeof data.systemPrompt === 'string') patch.systemPrompt = data.systemPrompt
      if (data.backend === '' || typeof data.backend === 'string') patch.backend = data.backend || undefined
      if (typeof data.cliModel === 'string') patch.cliModel = data.cliModel
      if (typeof data.temperature === 'number') patch.temperature = data.temperature
      if (typeof data.maxTokens === 'number') patch.maxTokens = data.maxTokens
      if (['default', 'concise', 'detailed', 'code-only'].includes(data.responseFormat as string)) patch.responseFormat = data.responseFormat
      if (typeof data.agenticMode === 'boolean') patch.agenticMode = data.agenticMode
      if (typeof data.memory === 'string') patch.memory = data.memory
      if (data.tools && typeof data.tools === 'object') patch.tools = { ...(prev.tools as object), ...(data.tools as object) }
      if (Array.isArray(data.mcpServers)) patch.mcpServers = data.mcpServers
      if (typeof data.thinkingEffort === 'string') patch.thinkingEffort = data.thinkingEffort || undefined
      if (typeof data.rootDirectory === 'string') patch.rootDirectory = data.rootDirectory || undefined
      if (Array.isArray(data.contextDirectories)) patch.contextDirectories = data.contextDirectories
      if (Array.isArray(data.contextFiles)) patch.contextFiles = data.contextFiles
      if (data.contextRules && typeof data.contextRules === 'object') patch.contextRules = data.contextRules
      if (Array.isArray(data.customCommands)) patch.customCommands = data.customCommands
      const config = { ...prev, ...patch }
      db.prepare('UPDATE agents SET config_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(config), Date.now(), id)
      broadcastToMobile({ event: 'agent:updated', data: { agent: { id, name, icon } } })
      return
    }

    if (command === 'agent:get-full') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const row = db.prepare('SELECT config_json FROM agents WHERE id = ?').get(id) as { config_json: string } | undefined
      if (!row) return
      const config = JSON.parse(row.config_json) as Record<string, unknown>
      reply({ event: 'agent:full', data: { agent: config } })
      return
    }

    if (command === 'agent:delete') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      db.prepare('UPDATE conversations SET agent_id = NULL WHERE agent_id = ?').run(id)
      db.prepare('DELETE FROM agents WHERE id = ?').run(id)
      broadcastToMobile({ event: 'agent:deleted', data: { id } })
      return
    }

    if (command === 'provider:get-configured') {
      const providers = PROVIDERS.map((p) => ({
        id: p.name,
        label: p.label,
        configured: isProviderConfigured(p.name),
      }))
      reply({ event: 'provider:list', data: { providers } })
      return
    }

    if (command === 'provider:set-key') {
      const provider = typeof data.provider === 'string' ? data.provider : ''
      const key = typeof data.key === 'string' ? data.key : ''
      if (!provider || !key) return
      storeApiKey(provider, key)
      reply({ event: 'provider:key-set', data: { provider } })
      return
    }

    if (command === 'provider:remove-key') {
      const provider = typeof data.provider === 'string' ? data.provider : ''
      if (!provider) return
      removeApiKey(provider)
      reply({ event: 'provider:key-removed', data: { provider } })
      return
    }

    if (command === 'app:cli-status') {
      reply({ event: 'app:cli-status', data: { clis: detectAllClis() } })
      return
    }

    if (command === 'app:set-setting') {
      const key = typeof data.key === 'string' ? data.key : ''
      const value = typeof data.value === 'string' ? data.value : ''
      if (!key) return
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
      reply({ event: 'app:setting-set', data: { key, value } })
      return
    }

    if (command === 'app:get-setting') {
      const key = typeof data.key === 'string' ? data.key : ''
      if (!key) return
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
      reply({ event: 'app:setting-value', data: { key, value: row?.value ?? null } })
      return
    }

    if (command === 'mcp:list') {
      const servers = getMcpServersWithStatus()
      reply({ event: 'mcp:list', data: { servers } })
      return
    }

    if (command === 'mcp:add') {
      const name = typeof data.name === 'string' ? data.name.trim() : ''
      const command2 = typeof data.command === 'string' ? data.command.trim() : ''
      if (!name || !command2) return
      const args = Array.isArray(data.args) ? (data.args as string[]) : []
      const env = (data.env && typeof data.env === 'object' && !Array.isArray(data.env)) ? data.env as Record<string, string> : {}
      const cwd = typeof data.cwd === 'string' ? data.cwd : undefined
      const enabled = typeof data.enabled === 'boolean' ? data.enabled : true
      void addMcpServer({ name, command: command2, args, env, cwd, enabled }).then((server) => {
        const s = getMcpServerStatus(server.id)
        const payload = { ...server, status: s.status, toolCount: s.tools.length }
        broadcastToMobile({ event: 'mcp:server-added', data: { server: payload } })
        reply({ event: 'mcp:server-added', data: { server: payload } })
      })
      return
    }

    if (command === 'mcp:update') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const updates: Record<string, unknown> = {}
      if (typeof data.name === 'string') updates.name = data.name
      if (typeof data.command === 'string') updates.command = data.command
      if (Array.isArray(data.args)) updates.args = data.args
      if (data.env && typeof data.env === 'object') updates.env = data.env
      if (typeof data.cwd === 'string') updates.cwd = data.cwd || undefined
      if (typeof data.enabled === 'boolean') updates.enabled = data.enabled
      void updateMcpServer(id, updates).then((server) => {
        if (!server) return
        const s = getMcpServerStatus(id)
        const payload = { ...server, status: s.status, toolCount: s.tools.length }
        broadcastToMobile({ event: 'mcp:server-updated', data: { server: payload } })
        reply({ event: 'mcp:server-updated', data: { server: payload } })
      })
      return
    }

    if (command === 'mcp:remove') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      void removeMcpServer(id).then(() => {
        broadcastToMobile({ event: 'mcp:server-removed', data: { id } })
        reply({ event: 'mcp:server-removed', data: { id } })
      })
      return
    }

    if (command === 'mcp:restart') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      void restartMcpServer(id).then(() => {
        const s = getMcpServerStatus(id)
        reply({ event: 'mcp:server-status', data: { id, status: s.status, error: s.error ?? null, toolCount: s.tools.length } })
      })
      return
    }

    if (command === 'mcp:get-status') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const status = getMcpServerStatus(id)
      reply({ event: 'mcp:server-status', data: { id, status: status.status, error: status.error ?? null, toolCount: status.tools.length } })
      return
    }

    if (command === 'mcp:list-tools') {
      const serverIds = Array.isArray(data.serverIds) ? (data.serverIds as string[]) : undefined
      const tools = listMcpTools(serverIds)
      reply({ event: 'mcp:tools', data: { tools } })
      return
    }

    if (command === 'mcp:list-tools-for-agent') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      if (!agentId) return
      const tools = listMcpToolsForAgent(agentId)
      reply({ event: 'mcp:tools', data: { agentId, tools } })
      return
    }

    if (command === 'wiki:extract-from-conversation') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      const projectId = typeof data.projectId === 'string' ? data.projectId : ''
      if (!conversationId || !projectId) return
      void extractWikiLearningsForWs(conversationId, projectId)
        .then((result) => {
          reply({ event: 'wiki:extraction-candidates', data: { conversationId, candidates: result.candidates } })
        })
        .catch((err: unknown) => {
          reply({ event: 'wiki:extraction-error', data: { message: String(err) } })
        })
      return
    }

    if (command === 'agent:list-knowledge-files') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      if (!agentId) return
      const files = db.prepare('SELECT * FROM agent_knowledge_files WHERE agent_id = ? ORDER BY sort_order ASC, created_at ASC').all(agentId)
      reply({ event: 'agent:knowledge-files', data: { agentId, files } })
      return
    }

    if (command === 'agent:add-knowledge-file') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      const filePath = typeof data.filePath === 'string' ? data.filePath : ''
      const injectMode = typeof data.injectMode === 'string' ? data.injectMode : 'always'
      if (!agentId || !filePath) return
      const id = randomUUID()
      const now = Date.now()
      const maxRow = db.prepare('SELECT MAX(sort_order) as m FROM agent_knowledge_files WHERE agent_id = ?').get(agentId) as { m: number | null }
      db.prepare('INSERT INTO agent_knowledge_files (id, agent_id, file_path, inject_mode, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, agentId, filePath, injectMode, (maxRow.m ?? -1) + 1, now, now)
      const file = db.prepare('SELECT * FROM agent_knowledge_files WHERE id = ?').get(id)
      reply({ event: 'agent:knowledge-file-added', data: { agentId, file } })
      return
    }

    if (command === 'agent:remove-knowledge-file') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      const id = typeof data.id === 'string' ? data.id : ''
      if (!agentId || !id) return
      db.prepare('DELETE FROM agent_knowledge_files WHERE id = ? AND agent_id = ?').run(id, agentId)
      reply({ event: 'agent:knowledge-file-removed', data: { agentId, id } })
      return
    }

    if (command === 'agent:read-knowledge-file') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      const filePath = typeof data.filePath === 'string' ? data.filePath : ''
      if (!agentId || !filePath) return
      try {
        const row = db.prepare('SELECT id FROM agent_knowledge_files WHERE agent_id = ? AND file_path = ?').get(agentId, filePath)
        if (!row) { reply({ event: 'agent:knowledge-file-error', data: { message: 'File not registered for this agent' } }); return }
        if (!existsSync(filePath)) { reply({ event: 'agent:knowledge-file-error', data: { message: `File not found: ${filePath}` } }); return }
        const content = readFileSync(filePath, 'utf-8')
        reply({ event: 'agent:knowledge-file-content', data: { agentId, filePath, content } })
      } catch (err) {
        reply({ event: 'agent:knowledge-file-error', data: { message: String(err) } })
      }
      return
    }

    if (command === 'agent:write-knowledge-file') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      const filePath = typeof data.filePath === 'string' ? data.filePath : ''
      const content = typeof data.content === 'string' ? data.content : ''
      if (!agentId || !filePath) return
      try {
        const row = db.prepare('SELECT id FROM agent_knowledge_files WHERE agent_id = ? AND file_path = ?').get(agentId, filePath)
        if (!row) { reply({ event: 'agent:knowledge-file-error', data: { message: 'File not registered for this agent' } }); return }
        writeFileSync(filePath, content, 'utf-8')
        db.prepare('UPDATE agent_knowledge_files SET updated_at = ? WHERE agent_id = ? AND file_path = ?').run(Date.now(), agentId, filePath)
        reply({ event: 'agent:knowledge-file-saved', data: { agentId, filePath } })
      } catch (err) {
        reply({ event: 'agent:knowledge-file-error', data: { message: String(err) } })
      }
      return
    }

    if (command === 'agent:get-mcp-tool-overrides') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      if (!agentId) return
      const overrides = db.prepare('SELECT * FROM agent_mcp_tool_overrides WHERE agent_id = ?').all(agentId)
      reply({ event: 'agent:mcp-tool-overrides', data: { agentId, overrides } })
      return
    }

    if (command === 'agent:set-mcp-tool-override') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      const serverId = typeof data.serverId === 'string' ? data.serverId : ''
      const toolName = typeof data.toolName === 'string' ? data.toolName : ''
      const enabled = typeof data.enabled === 'boolean' ? data.enabled : true
      const approval = typeof data.approval === 'string' ? data.approval : 'always-ask'
      const instructions = typeof data.instructions === 'string' ? data.instructions : ''
      if (!agentId || !serverId || !toolName) return
      db.prepare('INSERT OR REPLACE INTO agent_mcp_tool_overrides (agent_id, server_id, tool_name, enabled, approval, instructions) VALUES (?, ?, ?, ?, ?, ?)').run(agentId, serverId, toolName, enabled ? 1 : 0, approval, instructions)
      const overrides = db.prepare('SELECT * FROM agent_mcp_tool_overrides WHERE agent_id = ?').all(agentId)
      reply({ event: 'agent:mcp-tool-overrides', data: { agentId, overrides } })
      return
    }

    if (command === 'agent:get-mcp-server-trust') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      if (!agentId) return
      const trust = db.prepare('SELECT server_id, trust FROM agent_mcp_server_trust WHERE agent_id = ?').all(agentId)
      reply({ event: 'agent:mcp-server-trust', data: { agentId, trust } })
      return
    }

    if (command === 'agent:set-mcp-server-trust') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      const serverId = typeof data.serverId === 'string' ? data.serverId : ''
      const trust = typeof data.trust === 'string' ? data.trust : 'auto'
      if (!agentId || !serverId) return
      db.prepare('INSERT OR REPLACE INTO agent_mcp_server_trust (agent_id, server_id, trust) VALUES (?, ?, ?)').run(agentId, serverId, trust)
      const trustList = db.prepare('SELECT server_id, trust FROM agent_mcp_server_trust WHERE agent_id = ?').all(agentId)
      reply({ event: 'agent:mcp-server-trust', data: { agentId, trust: trustList } })
      return
    }

    if (command === 'skill:list') {
      reply({ event: 'skill:list', data: { skills: listSkillConfigs() } })
      return
    }

    if (command === 'skill:get') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      reply({ event: 'skill:detail', data: { skill: getSkillConfig(id) } })
      return
    }

    if (command === 'skill:create') {
      const skill = createSkillConfig(data as Partial<SkillConfig>)
      broadcastToMobile({ event: 'skill:created', data: { skill } })
      return
    }

    if (command === 'skill:update') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const skill = updateSkillConfig(id, data as Partial<SkillConfig>)
      broadcastToMobile({ event: 'skill:updated', data: { skill } })
      return
    }

    if (command === 'skill:delete') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      deleteSkillConfig(id)
      broadcastToMobile({ event: 'skill:deleted', data: { id } })
      return
    }

    if (command === 'skill:duplicate') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const skill = duplicateSkillConfig(id)
      reply({ event: 'skill:duplicated', data: { skill } })
      if (skill) broadcastToMobile({ event: 'skill:created', data: { skill } })
      return
    }

    if (command === 'skill:export') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const skill = getSkillConfig(id)
      reply({ event: 'skill:exported', data: { skill } })
      return
    }

    if (command === 'skill:import') {
      const rawSkill = (typeof data.skill === 'object' && data.skill !== null ? data.skill : data) as Partial<SkillConfig>
      const skill = createSkillConfig(rawSkill)
      broadcastToMobile({ event: 'skill:created', data: { skill } })
      return
    }

    if (command === 'skill:get-agent-links') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      if (!agentId) return
      reply({ event: 'skill:agent-links', data: { agentId, links: getSkillAgentLinks(agentId) } })
      return
    }

    if (command === 'skill:attach-to-agent') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      const skillId = typeof data.skillId === 'string' ? data.skillId : ''
      const attach = data.attach !== false
      if (!agentId || !skillId) return
      setSkillAgentAttachment(agentId, skillId, attach)
      broadcastToMobile({ event: 'skill:agent-links', data: { agentId, links: getSkillAgentLinks(agentId) } })
      return
    }

    if (command === 'skill:reorder-for-agent') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      const skillIds = Array.isArray(data.skillIds) ? (data.skillIds as unknown[]).filter((id): id is string => typeof id === 'string') : []
      if (!agentId) return
      reorderSkillsForAgent(agentId, skillIds)
      broadcastToMobile({ event: 'skill:agent-links', data: { agentId, links: getSkillAgentLinks(agentId) } })
      return
    }

    if (command === 'skill:get-agent-usage') {
      reply({ event: 'skill:agent-usage', data: { usage: getSkillAgentUsage() } })
      return
    }

    if (command === 'artifact:list') {
      const projectId = typeof data.projectId === 'string' ? data.projectId : null
      const rows = projectId
        ? (db.prepare('SELECT id, project_id, title, kind, description, storage_root, status, current_version_id, created_at, updated_at FROM artifacts WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as Record<string, unknown>[])
        : (db.prepare('SELECT id, project_id, title, kind, description, storage_root, status, current_version_id, created_at, updated_at FROM artifacts ORDER BY updated_at DESC LIMIT 50').all() as Record<string, unknown>[])
      const artifacts = rows.map((r) => ({
        id: String(r.id),
        projectId: r.project_id != null ? String(r.project_id) : null,
        title: String(r.title),
        kind: String(r.kind),
        description: r.description != null ? String(r.description) : null,
        storageRoot: r.storage_root != null ? String(r.storage_root) : null,
        status: String(r.status),
        currentVersionId: r.current_version_id != null ? String(r.current_version_id) : null,
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
      }))
      reply({ event: 'artifact:list', data: { artifacts } })
      return
    }

    if (command === 'artifact:get') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const r = db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as Record<string, unknown> | undefined
      if (!r) {
        reply({ event: 'artifact:detail', data: { artifact: null } })
        return
      }
      const currentVersionId = r.current_version_id != null ? String(r.current_version_id) : null
      let currentVersion = null
      if (currentVersionId) {
        const vRow = db.prepare('SELECT * FROM artifact_versions WHERE id = ?').get(currentVersionId) as Record<string, unknown> | undefined
        if (vRow) {
          const fileRows = db.prepare('SELECT id, version_id, relative_path, media_type, role FROM artifact_files WHERE version_id = ?').all(currentVersionId) as Record<string, unknown>[]
          currentVersion = {
            id: String(vRow.id),
            artifactId: String(vRow.artifact_id),
            versionNumber: Number(vRow.version_number),
            title: String(vRow.title),
            notes: vRow.notes != null ? String(vRow.notes) : null,
            createdAt: Number(vRow.created_at),
            files: fileRows.map((f) => ({
              id: String(f.id),
              relativePath: String(f.relative_path),
              mediaType: String(f.media_type),
              role: String(f.role),
            })),
          }
        }
      }
      reply({
        event: 'artifact:detail',
        data: {
          artifact: {
            id: String(r.id),
            projectId: r.project_id != null ? String(r.project_id) : null,
            title: String(r.title),
            kind: String(r.kind),
            description: r.description != null ? String(r.description) : null,
            storageRoot: r.storage_root != null ? String(r.storage_root) : null,
            status: String(r.status),
            currentVersionId,
            createdAt: Number(r.created_at),
            updatedAt: Number(r.updated_at),
            currentVersion,
          },
        },
      })
      return
    }

    if (command === 'artifact:list-versions') {
      const artifactId = typeof data.artifactId === 'string' ? data.artifactId : ''
      if (!artifactId) return
      const rows = db.prepare('SELECT * FROM artifact_versions WHERE artifact_id = ? ORDER BY version_number DESC').all(artifactId) as Record<string, unknown>[]
      const versions = rows.map((vRow) => {
        const versionId = String(vRow.id)
        const fileRows = db.prepare('SELECT id, version_id, relative_path, media_type, role FROM artifact_files WHERE version_id = ?').all(versionId) as Record<string, unknown>[]
        return {
          id: versionId,
          artifactId: String(vRow.artifact_id),
          versionNumber: Number(vRow.version_number),
          title: String(vRow.title),
          notes: vRow.notes != null ? String(vRow.notes) : null,
          createdAt: Number(vRow.created_at),
          files: fileRows.map((f) => ({
            id: String(f.id),
            relativePath: String(f.relative_path),
            mediaType: String(f.media_type),
            role: String(f.role),
          })),
        }
      })
      reply({ event: 'artifact:versions', data: { artifactId, versions } })
      return
    }

    if (command === 'artifact:delete') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const info = db.prepare('DELETE FROM artifacts WHERE id = ?').run(id)
      reply({ event: 'artifact:deleted', data: { id, deleted: info.changes > 0 } })
      const rows = db.prepare('SELECT id, project_id, title, kind, description, storage_root, status, current_version_id, created_at, updated_at FROM artifacts ORDER BY updated_at DESC LIMIT 50').all() as Record<string, unknown>[]
      reply({
        event: 'artifact:list',
        data: {
          artifacts: rows.map((r) => ({
            id: String(r.id),
            projectId: r.project_id != null ? String(r.project_id) : null,
            title: String(r.title),
            kind: String(r.kind),
            description: r.description != null ? String(r.description) : null,
            storageRoot: r.storage_root != null ? String(r.storage_root) : null,
            status: String(r.status),
            currentVersionId: r.current_version_id != null ? String(r.current_version_id) : null,
            createdAt: Number(r.created_at),
            updatedAt: Number(r.updated_at),
          })),
        },
      })
      return
    }

    if (command === 'artifact:export') {
      const versionId = typeof data.versionId === 'string' ? data.versionId : ''
      if (!versionId) return
      try {
        const vRow = db.prepare('SELECT * FROM artifact_versions WHERE id = ?').get(versionId) as Record<string, unknown> | undefined
        if (!vRow) { reply({ event: 'artifact:export-error', data: { message: 'Version not found' } }); return }
        const fileRows = db.prepare('SELECT id, relative_path, media_type, absolute_path, role FROM artifact_files WHERE version_id = ?').all(versionId) as Record<string, unknown>[]
        if (fileRows.length === 0) { reply({ event: 'artifact:export-error', data: { message: 'No files found for this version' } }); return }
        const files = fileRows
          .filter((f) => existsSync(String(f.absolute_path)))
          .map((f) => ({
            relativePath: String(f.relative_path),
            mediaType: String(f.media_type),
            contentBase64: readFileSync(String(f.absolute_path)).toString('base64'),
          }))
        if (files.length === 0) { reply({ event: 'artifact:export-error', data: { message: 'Artifact files not found on disk' } }); return }
        reply({ event: 'artifact:export-pack', data: { versionId, files } })
      } catch (err) {
        reply({ event: 'artifact:export-error', data: { message: String(err) } })
      }
      return
    }

    if (command === 'wiki:list') {
      const projectId = typeof data.projectId === 'string' ? data.projectId : ''
      if (!projectId) return
      const rows = db.prepare('SELECT * FROM project_wiki_entries WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as Record<string, unknown>[]
      const entries = rows.map((r) => ({
        id: String(r.id),
        projectId: String(r.project_id),
        title: String(r.title),
        body: String(r.body),
        tags: (() => { try { return JSON.parse(String(r.tags)) as string[] } catch { return [] } })(),
        sourceConversationId: r.source_conversation_id != null ? String(r.source_conversation_id) : null,
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
      }))
      reply({ event: 'wiki:list', data: { entries } })
      return
    }

    if (command === 'wiki:create') {
      const projectId = typeof data.projectId === 'string' ? data.projectId : ''
      const title = typeof data.title === 'string' ? data.title.trim() : ''
      const body = typeof data.body === 'string' ? data.body : ''
      const tags = Array.isArray(data.tags) ? (data.tags as string[]) : []
      if (!projectId || !title) return
      const entry = insertWikiEntry(db, projectId, title, body, tags)
      broadcastToMobile({ event: 'wiki:entry-created', data: { entry: { ...entry, projectId: entry.project_id, sourceConversationId: entry.source_conversation_id, createdAt: entry.created_at, updatedAt: entry.updated_at } } })
      return
    }

    if (command === 'wiki:update') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const fields: Record<string, unknown> = {}
      if (typeof data.title === 'string') fields.title = data.title
      if (typeof data.body === 'string') fields.body = data.body
      if (Array.isArray(data.tags)) fields.tags = data.tags as string[]
      const now = Date.now()
      const row = db.prepare('SELECT * FROM project_wiki_entries WHERE id = ?').get(id) as Record<string, unknown> | undefined
      if (!row) return
      const title = fields.title !== undefined ? String(fields.title).slice(0, 200) : String(row.title)
      const body = fields.body !== undefined ? String(fields.body) : String(row.body)
      const tags = fields.tags !== undefined ? JSON.stringify(fields.tags) : String(row.tags)
      db.prepare('UPDATE project_wiki_entries SET title = ?, body = ?, tags = ?, updated_at = ? WHERE id = ?').run(title, body, tags, now, id)
      const updated = db.prepare('SELECT * FROM project_wiki_entries WHERE id = ?').get(id) as Record<string, unknown>
      broadcastToMobile({ event: 'wiki:entry-updated', data: { entry: { id: String(updated.id), projectId: String(updated.project_id), title: String(updated.title), body: String(updated.body), tags: (() => { try { return JSON.parse(String(updated.tags)) as string[] } catch { return [] } })(), sourceConversationId: updated.source_conversation_id != null ? String(updated.source_conversation_id) : null, createdAt: Number(updated.created_at), updatedAt: Number(updated.updated_at) } } })
      return
    }

    if (command === 'wiki:delete') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      db.prepare('DELETE FROM project_wiki_entries WHERE id = ?').run(id)
      broadcastToMobile({ event: 'wiki:entry-deleted', data: { id } })
      return
    }

    if (command === 'prompt:list') {
      const projectId = typeof data.projectId === 'string' ? data.projectId : null
      type PromptRow = { id: string; title: string; body: string; description: string; category: string; tags: string; scope: string; project_id: string | null; created_at: number; updated_at: number }
      const rows = db.prepare(
        `SELECT * FROM prompt_library_entries WHERE scope = 'global' OR (scope = 'project' AND project_id = ?) ORDER BY category COLLATE NOCASE ASC, updated_at DESC`
      ).all(projectId) as PromptRow[]
      const entries = rows.map((r) => ({
        id: r.id, title: r.title, body: r.body, description: r.description, category: r.category,
        tags: (() => { try { return JSON.parse(r.tags) as string[] } catch { return [] } })(),
        scope: r.scope, projectId: r.project_id, createdAt: r.created_at, updatedAt: r.updated_at,
      }))
      reply({ event: 'prompt:list', data: { entries } })
      return
    }

    if (command === 'prompt:list-versions') {
      const promptId = typeof data.promptId === 'string' ? data.promptId : ''
      if (!promptId) return
      const versions = listPromptLibraryVersions(db, promptId).map(mobilePromptVersion)
      reply({ event: 'prompt:versions', data: { promptId, versions } })
      return
    }

    if (command === 'prompt:create') {
      const title = typeof data.title === 'string' ? data.title.trim() : ''
      const body = typeof data.body === 'string' ? data.body : ''
      const description = typeof data.description === 'string' ? data.description : ''
      const category = typeof data.category === 'string' ? data.category : 'Custom'
      const tags = Array.isArray(data.tags) ? (data.tags as string[]) : []
      const scope = data.scope === 'project' ? 'project' : 'global'
      const projectId = typeof data.projectId === 'string' ? data.projectId : undefined
      if (!title || !body.trim()) return
      const entry = insertPromptLibraryEntry(db, { title, body, description, category, tags, scope, project_id: projectId })
      broadcastToMobile({ event: 'prompt:entry-created', data: { entry: mobilePromptEntry(entry) } })
      return
    }

    if (command === 'prompt:update') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      try {
        const updated = updatePromptLibraryEntry(db, id, {
          title: typeof data.title === 'string' ? data.title : undefined,
          body: typeof data.body === 'string' ? data.body : undefined,
          description: typeof data.description === 'string' ? data.description : undefined,
          category: typeof data.category === 'string' ? data.category : undefined,
          tags: Array.isArray(data.tags) ? data.tags.map(String) : undefined,
        })
        broadcastToMobile({ event: 'prompt:entry-updated', data: { entry: mobilePromptEntry(updated) } })
      } catch (err: unknown) {
        reply({ event: 'prompt:error', data: { message: String(err) } })
      }
      return
    }

    if (command === 'prompt:rollback') {
      const promptId = typeof data.promptId === 'string' ? data.promptId : ''
      const version = typeof data.version === 'number' ? data.version : Number(data.version)
      if (!promptId || !Number.isFinite(version)) return
      try {
        const entry = rollbackPromptLibraryEntry(db, promptId, version)
        broadcastToMobile({ event: 'prompt:entry-updated', data: { entry: mobilePromptEntry(entry) } })
        const versions = listPromptLibraryVersions(db, promptId).map(mobilePromptVersion)
        reply({ event: 'prompt:versions', data: { promptId, versions } })
      } catch (err: unknown) {
        reply({ event: 'prompt:error', data: { message: String(err) } })
      }
      return
    }

    if (command === 'prompt:delete') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      db.prepare('DELETE FROM prompt_library_entries WHERE id = ?').run(id)
      broadcastToMobile({ event: 'prompt:entry-deleted', data: { id } })
      return
    }

    if (command === 'conversation:export-pack') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      const format = typeof data.format === 'string' ? data.format : 'json'
      if (!conversationId) return
      try {
        const pack = buildConversationExportPack(db, conversationId, { format: format as 'json' | 'markdown' | 'context-bundle' })
        reply({ event: 'conversation:export-pack', data: { pack } })
      } catch (err) {
        reply({ event: 'conversation:export-error', data: { message: String(err) } })
      }
      return
    }

    if (command === 'conversation:fork') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      try {
        const result = forkConversation(db, conversationId, {})
        broadcastToMobile({ event: 'conversation:forked', data: { conversationId: result.conversation.id, title: result.conversation.title, messageCount: result.message_count } })
      } catch (err) {
        reply({ event: 'conversation:fork-error', data: { message: String(err) } })
      }
      return
    }

    if (command === 'conversation:import-json') {
      const raw = typeof data.json === 'string' ? data.json : ''
      if (!raw) return
      try {
        const parsed = parseConversationExport(JSON.parse(raw))
        const result = importConversationExport(db, parsed, {})
        broadcastToMobile({ event: 'conversation:imported', data: { conversationId: result.conversation.id, title: result.conversation.title, messageCount: result.message_count } })
      } catch (err) {
        reply({ event: 'conversation:import-error', data: { message: String(err) } })
      }
      return
    }

    if (command === 'conversation:set-pinned') {
      const id = typeof data.id === 'string' ? data.id : ''
      const pinned = Boolean(data.pinned)
      if (!id) return
      db.prepare('UPDATE conversations SET pinned = ?, updated_at = ? WHERE id = ?').run(pinned ? 1 : 0, Date.now(), id)
      broadcastToMobile({ event: 'conversation:pinned', data: { id, pinned } })
      return
    }

    if (command === 'conversation:update-context') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      const assignments: string[] = []
      const values: (string | number | null)[] = []
      if (Object.prototype.hasOwnProperty.call(data, 'projectId')) {
        assignments.push('project_id = ?')
        values.push(typeof data.projectId === 'string' ? data.projectId : null)
      }
      if (Object.prototype.hasOwnProperty.call(data, 'agentId')) {
        assignments.push('agent_id = ?')
        values.push(typeof data.agentId === 'string' ? data.agentId : null)
      }
      if (assignments.length === 0) return
      assignments.push('updated_at = ?')
      values.push(Date.now())
      values.push(conversationId)
      db.prepare(`UPDATE conversations SET ${assignments.join(', ')} WHERE id = ?`).run(...values)
      broadcastToMobile({ event: 'conversation:context-updated', data: { conversationId, projectId: data.projectId ?? null, agentId: data.agentId ?? null } })
      return
    }

    if (command === 'conversation:insert-message') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      const role = typeof data.role === 'string' ? data.role : 'user'
      const content = typeof data.content === 'string' ? data.content : ''
      if (!conversationId || !content) return
      const id = randomUUID()
      const now = Date.now()
      db.prepare('INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)').run(id, conversationId, role, content, now)
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversationId)
      const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Record<string, unknown>
      reply({ event: 'message:inserted', data: { conversationId, message: row } })
      return
    }

    if (command === 'message:delete-after') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      const timestamp = typeof data.timestamp === 'number' ? data.timestamp : 0
      if (!conversationId || !timestamp) return
      db.prepare('DELETE FROM messages WHERE conversation_id = ? AND timestamp >= ?').run(conversationId, timestamp)
      reply({ event: 'message:deleted-after', data: { conversationId, timestamp } })
      return
    }

    if (command === 'conversation:compression-preview') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      try {
        const preview = getConversationCompressionPreview(db, conversationId)
        reply({ event: 'conversation:compression-preview', data: preview })
      } catch (err) {
        reply({ event: 'conversation:compression-error', data: { message: String(err) } })
      }
      return
    }

    if (command === 'conversation:prepare-compression-summary') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      try {
        const draft = prepareConversationCompressionSummary(db, conversationId)
        reply({ event: 'conversation:compression-draft', data: draft })
      } catch (err) {
        reply({ event: 'conversation:compression-error', data: { message: String(err) } })
      }
      return
    }

    if (command === 'conversation:save-compression-summary') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      try {
        const sections = (typeof data.sections === 'object' && data.sections !== null) ? data.sections as Record<string, string[]> : {}
        const input = {
          conversationId,
          sections: {
            goals: Array.isArray(sections.goals) ? sections.goals as string[] : [],
            decisions: Array.isArray(sections.decisions) ? sections.decisions as string[] : [],
            constraints: Array.isArray(sections.constraints) ? sections.constraints as string[] : [],
            filesTouched: Array.isArray(sections.filesTouched) ? sections.filesTouched as string[] : [],
            commandsRun: Array.isArray(sections.commandsRun) ? sections.commandsRun as string[] : [],
            openQuestions: Array.isArray(sections.openQuestions) ? sections.openQuestions as string[] : [],
            nextActions: Array.isArray(sections.nextActions) ? sections.nextActions as string[] : [],
            recentContextNotes: Array.isArray(sections.recentContextNotes) ? sections.recentContextNotes as string[] : [],
          },
          summarizedMessageCount: typeof data.summarizedMessageCount === 'number' ? data.summarizedMessageCount : 0,
          retainedMessageCount: typeof data.retainedMessageCount === 'number' ? data.retainedMessageCount : 0,
          omittedMessageCount: typeof data.omittedMessageCount === 'number' ? data.omittedMessageCount : 0,
          estimatedTokensBefore: typeof data.estimatedTokensBefore === 'number' ? data.estimatedTokensBefore : 0,
          targetBudget: typeof data.targetBudget === 'number' ? data.targetBudget : 0,
          strategy: typeof data.strategy === 'string' ? data.strategy : 'manual-structured-summary-plus-recent-turns',
        }
        const preview = saveConversationCompressionSummary(db, input)
        reply({ event: 'conversation:compression-saved', data: preview })
      } catch (err) {
        reply({ event: 'conversation:compression-error', data: { message: String(err) } })
      }
      return
    }

    if (command === 'project-generator:start' || command === 'project-generator:message') {
      const messages = Array.isArray(data.messages) ? data.messages : []
      const sessionId = typeof data.sessionId === 'string' && data.sessionId.trim()
        ? data.sessionId.trim()
        : `android-${Date.now()}`
      const existingAgents = Array.isArray(data.existingAgents) && data.existingAgents.length > 0
        ? data.existingAgents
        : getProjectGeneratorAgentSummaries()
      void runProjectGeneratorChatForAndroid(messages, existingAgents, sessionId)
        .catch((err: unknown) => {
          broadcastToMobile({ event: 'project-generator:error', data: { sessionId, message: String(err) } })
        })
      return
    }

    if (command === 'project-generator:confirm') {
      const spec = data.spec as ProjectGeneratorSpec
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      createProjectFromSpec(spec)
        .then((result) => {
          broadcastToMobile({ event: 'project-generator:created', data: { sessionId, ...result } })
        })
        .catch((err: unknown) => {
          broadcastToMobile({ event: 'project-generator:error', data: { sessionId, message: String(err) } })
        })
      return
    }

    if (command === 'project-generator:cancel') {
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      broadcastToMobile({ event: 'project-generator:cancelled', data: { sessionId } })
      return
    }

    if (command === 'agent-generator:start' || command === 'agent-generator:message') {
      const messages = Array.isArray(data.messages) ? data.messages : []
      const sessionId = typeof data.sessionId === 'string' && data.sessionId.trim()
        ? data.sessionId.trim()
        : `android-agent-${Date.now()}`
      void runAgentGeneratorChatForAndroid(messages, sessionId)
        .catch((err: unknown) => {
          broadcastToMobile({ event: 'agent-generator:error', data: { sessionId, message: String(err) } })
        })
      return
    }

    if (command === 'agent-generator:confirm') {
      const spec = data.spec as AgentGeneratorSpec
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      createAgentFromSpec(spec)
        .then((result) => {
          broadcastToMobile({ event: 'agent-generator:created', data: { sessionId, agentId: result.agentId, name: result.name } })
        })
        .catch((err: unknown) => {
          broadcastToMobile({ event: 'agent-generator:error', data: { sessionId, message: String(err) } })
        })
      return
    }

    if (command === 'agent-generator:cancel') {
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      broadcastToMobile({ event: 'agent-generator:cancelled', data: { sessionId } })
      return
    }

    if (command === 'skill-generator:start' || command === 'skill-generator:message') {
      const messages = Array.isArray(data.messages) ? data.messages : []
      const sessionId = typeof data.sessionId === 'string' && data.sessionId.trim()
        ? data.sessionId.trim()
        : `android-skill-${Date.now()}`
      void runSkillGeneratorChatForAndroid(messages, sessionId)
        .catch((err: unknown) => {
          broadcastToMobile({ event: 'skill-generator:error', data: { sessionId, message: String(err) } })
        })
      return
    }

    if (command === 'skill-generator:confirm') {
      const spec = data.spec as SkillGeneratorSpec
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      createSkillFromSpec(spec)
        .then((result) => {
          broadcastToMobile({ event: 'skill-generator:created', data: { sessionId, skillId: result.skillId, name: result.name } })
        })
        .catch((err: unknown) => {
          broadcastToMobile({ event: 'skill-generator:error', data: { sessionId, message: String(err) } })
        })
      return
    }

    if (command === 'skill-generator:cancel') {
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      broadcastToMobile({ event: 'skill-generator:cancelled', data: { sessionId } })
      return
    }

    if (command === 'artifact-generator:start' || command === 'artifact-generator:message') {
      const rawMessages = Array.isArray(data.messages) ? data.messages : []
      const messages: ArtifactGeneratorMessage[] = rawMessages
        .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
        .map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: typeof m.content === 'string' ? m.content : '',
        }))
      const sessionId = typeof data.sessionId === 'string' && data.sessionId.trim()
        ? data.sessionId.trim()
        : `android-artifact-${Date.now()}`
      void runArtifactGeneratorChatForAndroid(messages, sessionId)
        .catch((err: unknown) => {
          broadcastToMobile({ event: 'artifact-generator:error', data: { sessionId, message: String(err) } })
        })
      return
    }

    if (command === 'artifact-generator:cancel') {
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      broadcastToMobile({ event: 'artifact-generator:cancelled', data: { sessionId } })
      return
    }

    if (command === 'artifact-generator:generate') {
      const sessionId = typeof data.sessionId === 'string' && data.sessionId.trim()
        ? data.sessionId.trim()
        : `android-artifact-generate-${Date.now()}`
      const spec = data.spec && typeof data.spec === 'object' ? data.spec as ArtifactSpec : null
      if (!spec) {
        broadcastToMobile({ event: 'artifact-generator:error', data: { sessionId, message: 'Missing artifact spec' } })
        return
      }
      const fakeWin = {
        isDestroyed: () => false,
        webContents: {
          send: () => {},
        },
      } as unknown as BrowserWindow
      void (async () => {
        try {
          createArtifactGeneratorRunRecord(sessionId, spec.title)
          updateArtifactGeneratorRunRecord(sessionId, { specJson: JSON.stringify(spec) })
          const artifactId = await runArtifactGeneration(fakeWin, sessionId, spec)
          broadcastToMobile({ event: 'artifact-generator:created', data: { sessionId, artifactId, title: spec.title } })
          broadcastToMobile({ event: 'artifact-generator:turn-complete', data: { sessionId, content: '', hasSpec: true } })
        } catch (err: unknown) {
          broadcastToMobile({ event: 'artifact-generator:error', data: { sessionId, message: String(err) } })
        }
      })()
      return
    }

    if (command === 'build:get-records') {
      const platform = typeof data.platform === 'string' ? data.platform : undefined
      const limit = typeof data.limit === 'number' ? Math.min(data.limit, 50) : 20
      const rows = platform
        ? db.prepare(`SELECT * FROM build_records WHERE platform = ? ORDER BY started_at DESC LIMIT ?`).all(platform, limit) as Record<string, unknown>[]
        : db.prepare(`SELECT * FROM build_records ORDER BY started_at DESC LIMIT ?`).all(limit) as Record<string, unknown>[]
      const records = rows.map((r) => ({
        id: r.id, workspacePath: r.workspace_path, commitSha: r.commit_sha ?? null,
        branch: r.branch ?? null, version: r.version ?? null, versionCode: r.version_code ?? null,
        platform: r.platform, command: r.command, status: r.status, exitCode: r.exit_code ?? null,
        artifactPaths: JSON.parse((r.artifact_paths as string | null) ?? '[]'),
        logTail: (r.log_tail as string | null) ?? '',
        startedAt: r.started_at, finishedAt: r.finished_at ?? null,
      }))
      reply({ event: 'build:records', data: { records } })
      return
    }

    if (command === 'build:get-workspace-info') {
      void getWorkspaceInfo(db)
        .then((info) => reply({ event: 'build:workspace-info', data: info }))
        .catch((err: unknown) => reply({ event: 'build:workspace-info', data: { error: String(err) } }))
      return
    }

    if (command === 'build:run-preflight') {
      const workspacePath = (db.prepare("SELECT value FROM settings WHERE key = 'build_workspace_path'").get() as { value: string } | undefined)?.value ?? process.cwd()
      void (async () => {
        const { execFile } = await import('child_process')
        const { promisify } = await import('util')
        const execFileAsync = promisify(execFile)
        const checks: { label: string; status: string; detail: string }[] = []
        try {
          const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: workspacePath, timeout: 5000, maxBuffer: 1024 * 1024 })
          const statusOut = stdout.trim()
          checks.push(statusOut.length > 0
            ? { label: 'Git working tree', status: 'warn', detail: `${statusOut.split('\n').length} modified or untracked file(s)` }
            : { label: 'Git working tree', status: 'ok', detail: 'Clean' })
        } catch { checks.push({ label: 'Git working tree', status: 'warn', detail: 'Could not run git status' }) }
        const { join } = pathModule
        checks.push(fsExistsSync(join(workspacePath, 'node_modules', '.package-lock.json'))
          ? { label: 'node_modules', status: 'ok', detail: 'Present' }
          : { label: 'node_modules', status: 'fail', detail: 'Missing — run npm install' })
        const signingKey = process.platform === 'win32' ? process.env['WIN_CSC_LINK'] : process.env['CSC_LINK']
        checks.push(signingKey
          ? { label: 'Code signing', status: 'ok', detail: 'Signing key configured' }
          : { label: 'Code signing', status: 'warn', detail: 'No signing key env var set — unsigned build only' })
        return checks
      })().then((checks) => reply({ event: 'build:preflight-result', data: { checks } }))
        .catch((err: unknown) => reply({ event: 'build:preflight-result', data: { checks: [{ label: 'Preflight', status: 'fail', detail: String(err) }] } }))
      return
    }

    if (command === 'android:get-workspace-info') {
      void getAndroidWorkspaceInfo(db)
        .then((info) => reply({ event: 'android:workspace-info', data: info }))
        .catch((err: unknown) => reply({ event: 'android:workspace-info', data: { error: String(err) } }))
      return
    }

    if (command === 'android:validate-signing') {
      const config = (() => {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'android_signing_config'").get() as { value: string } | undefined
        if (!row?.value) return null
        try { return JSON.parse(row.value) as { keystorePath: string; keyAlias: string; keystorePassword: string; keyPassword: string } } catch { return null }
      })()
      const checks: { label: string; status: string; detail: string }[] = []
      if (!config) {
        checks.push({ label: 'Signing config', status: 'fail', detail: 'No signing config saved' })
        reply({ event: 'android:signing-validation', data: { valid: false, checks } })
        return
      }
      checks.push({ label: 'Signing config', status: 'ok', detail: 'Config present' })
      checks.push(fsExistsSync(config.keystorePath)
        ? { label: 'Keystore file', status: 'ok', detail: 'File exists' }
        : { label: 'Keystore file', status: 'fail', detail: `Not found: ${config.keystorePath}` })
      reply({ event: 'android:signing-validation', data: { valid: checks.every((c) => c.status !== 'fail'), checks } })
      return
    }

    if (command === 'android:publish-update') {
      const androidFeedDir = (() => {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'local_update_feed_path'").get() as { value: string } | undefined
        return row?.value ? pathModule.join(row.value, 'android') : null
      })()
      const workspacePath = (db.prepare("SELECT value FROM settings WHERE key = 'android_workspace_path'").get() as { value: string } | undefined)?.value ?? null
      if (!androidFeedDir) { reply({ event: 'android:publish-result', data: { published: false, error: 'No local update feed path configured' } }); return }
      if (!workspacePath) { reply({ event: 'android:publish-result', data: { published: false, error: 'Android workspace path not configured' } }); return }
      const releaseApkDir = pathModule.join(workspacePath, 'app', 'build', 'outputs', 'apk', 'release')
      let apkSrc: string | null = null
      if (fsExistsSync(releaseApkDir)) {
        let latestMtime = 0
        for (const entry of fsReaddirSync(releaseApkDir)) {
          if (entry.endsWith('.apk')) {
            const full = pathModule.join(releaseApkDir, entry)
            try { const st = fsStatSync(full); if (st.isFile() && st.mtimeMs > latestMtime) { apkSrc = full; latestMtime = st.mtimeMs } } catch { /* skip */ }
          }
        }
      }
      if (!apkSrc) { reply({ event: 'android:publish-result', data: { published: false, error: 'No release APK found in app/build/outputs/apk/release/' } }); return }
      const apkName = pathModule.basename(apkSrc)
      const destApk = pathModule.join(androidFeedDir, apkName)
      fsMkdirSync(androidFeedDir, { recursive: true })
      fsCopyFileSync(apkSrc, destApk)
      const feedPathRow = db.prepare("SELECT value FROM settings WHERE key = 'local_update_feed_path'").get() as { value: string } | undefined
      const feedRootPath = feedPathRow?.value ?? androidFeedDir
      void (async () => {
        const ifaces = networkInterfaces()
        const candidates: string[] = []
        for (const iface of Object.values(ifaces)) {
          if (!iface) continue
          for (const info of iface) { if (info.family === 'IPv4' && !info.internal) candidates.push(info.address) }
        }
        candidates.sort((a, b) => (a.startsWith('192.168.') ? 0 : a.startsWith('10.') ? 1 : 2) - (b.startsWith('192.168.') ? 0 : b.startsWith('10.') ? 1 : 2))
        const lanIp = candidates[0] ?? '127.0.0.1'
        await startFeedServer(feedRootPath, '0.0.0.0')
        const feedLanUrl = getFeedLanUrl(lanIp)
        const androidWsInfo = await getAndroidWorkspaceInfo(db)
        const checksum = await computeSha256(destApk)
        const manifest = {
          versionCode: androidWsInfo.versionCode ?? 1, versionName: androidWsInfo.versionName ?? '1.0',
          commitSha: androidWsInfo.commitSha, changelog: '', checksum,
          artifactUrl: `${feedLanUrl}/android/${apkName}`, publishedAt: Date.now(),
        }
        await fsWriteFile(pathModule.join(androidFeedDir, 'android-update.json'), JSON.stringify(manifest, null, 2), 'utf8')
        return manifest
      })().then((manifest) => reply({ event: 'android:publish-result', data: { published: true, manifest } }))
        .catch((err: unknown) => reply({ event: 'android:publish-result', data: { published: false, error: String(err) } }))
      return
    }

    if (command === 'android:restore-version') {
      const versionCode = typeof data.versionCode === 'number' ? data.versionCode : parseInt(String(data.versionCode), 10)
      if (!Number.isFinite(versionCode)) { reply({ event: 'android:restore-result', data: { restored: false, error: 'Invalid version code' } }); return }
      const androidFeedDir = (() => {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'local_update_feed_path'").get() as { value: string } | undefined
        return row?.value ? pathModule.join(row.value, 'android') : null
      })()
      if (!androidFeedDir) { reply({ event: 'android:restore-result', data: { restored: false, error: 'No local update feed path configured' } }); return }
      const historyPath = pathModule.join(androidFeedDir, 'android-update-history.json')
      if (!fsExistsSync(historyPath)) { reply({ event: 'android:restore-result', data: { restored: false, error: `Version ${versionCode} not found in publish history` } }); return }
      void (async () => {
        const history = JSON.parse(await fsReadFile(historyPath, 'utf8')) as (Record<string, unknown> & { versionCode: number; archiveApkPath?: string })[]
        const entry = history.find((e) => e.versionCode === versionCode)
        if (!entry || !entry.archiveApkPath || !fsExistsSync(String(entry.archiveApkPath))) {
          reply({ event: 'android:restore-result', data: { restored: false, error: `Archived APK for version ${versionCode} not found` } })
          return
        }
        const apkName = pathModule.basename(String(entry.archiveApkPath))
        const destApk = pathModule.join(androidFeedDir, apkName)
        fsCopyFileSync(String(entry.archiveApkPath), destApk)
        const ifaces = networkInterfaces()
        const candidates: string[] = []
        for (const iface of Object.values(ifaces)) {
          if (!iface) continue
          for (const info of iface) { if (info.family === 'IPv4' && !info.internal) candidates.push(info.address) }
        }
        candidates.sort((a, b) => (a.startsWith('192.168.') ? 0 : a.startsWith('10.') ? 1 : 2) - (b.startsWith('192.168.') ? 0 : b.startsWith('10.') ? 1 : 2))
        const lanIp = candidates[0] ?? '127.0.0.1'
        const feedPathRow = db.prepare("SELECT value FROM settings WHERE key = 'local_update_feed_path'").get() as { value: string } | undefined
        const feedRootPath = feedPathRow?.value ?? androidFeedDir
        await startFeedServer(feedRootPath, '0.0.0.0')
        const feedLanUrl = getFeedLanUrl(lanIp)
        const restoredManifest = { ...entry, artifactUrl: `${feedLanUrl}/android/${apkName}`, publishedAt: entry.publishedAt }
        await fsWriteFile(pathModule.join(androidFeedDir, 'android-update.json'), JSON.stringify(restoredManifest, null, 2), 'utf8')
        reply({ event: 'android:restore-result', data: { restored: true, manifest: restoredManifest } })
      })().catch((err: unknown) => reply({ event: 'android:restore-result', data: { restored: false, error: String(err) } }))
      return
    }

    if (command === 'provider:get-azure-endpoint') {
      reply({ event: 'provider:azure-endpoint', data: { endpoint: getAzureEndpoint() ?? '' } })
      return
    }

    if (command === 'provider:set-azure-endpoint') {
      const endpoint = typeof data.endpoint === 'string' ? data.endpoint : ''
      setAzureEndpoint(endpoint)
      reply({ event: 'provider:azure-endpoint-set', data: { endpoint } })
      return
    }

    if (command === 'provider:test-key') {
      const provider = typeof data.provider === 'string' ? data.provider : ''
      const key = typeof data.key === 'string' ? data.key : ''
      const endpoint = typeof data.endpoint === 'string' ? data.endpoint : undefined
      if (!provider || !key) {
        reply({ event: 'provider:test-result', data: { provider, valid: false, error: 'Missing provider or key' } })
        return
      }
      void testProviderKey(provider, key, endpoint)
        .then((result) => reply({ event: 'provider:test-result', data: { provider, valid: result.valid, error: result.error } }))
        .catch((err: unknown) => reply({ event: 'provider:test-result', data: { provider, valid: false, error: String(err) } }))
      return
    }
  })

  safeHandle('ws:start', async () => {
    const result = await startWsServer()
    const status = getWsStatus()
    const qrDataUrl = await getQrDataUrl()
    return { ...result, qrDataUrl, pairingUrl: status.pairingUrl, secure: status.secure }
  })

  safeHandle('ws:stop', () => {
    stopWsServer()
    return true
  })

  safeHandle('ws:status', async () => {
    const status = getWsStatus()
    const qrDataUrl = status.enabled ? await getQrDataUrl() : null
    return { ...status, qrDataUrl }
  })

  safeHandle('ws:regenerate-token', async () => {
    const token = regenerateToken()
    const status = getWsStatus()
    const qrDataUrl = await getQrDataUrl()
    return { token, qrDataUrl, pairingUrl: status.pairingUrl, secure: status.secure }
  })

  safeHandle('ws:wakelock-enabled', () => {
    return getWakelockEnabled()
  })

  safeHandle('ws:set-wakelock-enabled', (_event, enabled: boolean) => {
    setWakelockEnabled(enabled)
    return getWakelockEnabled()
  })

  safeHandle('ws:auto-start-enabled', () => {
    return app.getLoginItemSettings().openAtLogin
  })

  safeHandle('ws:set-auto-start-enabled', (_event, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled })
    return app.getLoginItemSettings().openAtLogin
  })
}
