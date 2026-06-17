import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { safeHandle } from './safe-handle'
import { getDatabase } from './database'
import { abortActiveStream, PROVIDERS, isProviderConfigured } from './providers'
import { dispatchChatSend } from './chat-handlers'
import { getCliModels } from './cli-detection'
import { getCachedCatalog } from './model-catalog'
import { retrieveAuthMode } from './auth'
import { getAndroidUpdateManifest } from './android-handlers'
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
import { runProjectGeneratorChatForAndroid, createProjectFromSpec } from './project-generator'
import {
  runFeatureGeneratorChatForAndroid,
  getFeatureGenStagingDir,
  generateImplementationPlan,
  runFeatureImplementation,
} from './feature-generator'
import type { ProjectGeneratorSpec, FeatureSpec, FeatureGeneratorMessage } from '../shared/types'
import { storeApiKey, removeApiKey } from './provider-secrets'
import { detectAllClis } from './cli-detection'
import { getWorkspacePath } from './self-heal/investigator'
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { ClaudeAdapter } from './cli-adapters/claude'
import { CodexAdapter } from './cli-adapters/codex'
import { insertWikiEntry } from './wiki-handlers'
import { insertPromptLibraryEntry } from './prompt-handlers'
import { buildConversationExportPack, forkConversation, importConversationExport } from './conversation-handlers'
import { parseConversationExport } from './conversation-serialization'
import {
  startWsServer,
  stopWsServer,
  getWsStatus,
  getQrDataUrl,
  regenerateToken,
  setWsCommandHandler,
  broadcastToMobile,
} from './ws-server'

// Filled in by tools.ts after registration to avoid a circular import
let resolveApprovalFn: ((requestId: string, approved: boolean) => boolean) | null = null
export function registerApprovalResolver(fn: (requestId: string, approved: boolean) => boolean): void {
  resolveApprovalFn = fn
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
      }
      return
    }

    if (command === 'tool:approve' || command === 'tool:reject') {
      const requestId = typeof data.requestId === 'string' ? data.requestId : ''
      resolveApprovalFn?.(requestId, command === 'tool:approve')
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

      const fallbackBackend =
        !backend && retrieveAuthMode() === 'none'
          ? (
              ClaudeAdapter.isAvailable()
                ? 'claude-cli'
                : (CodexAdapter.isAvailable() ? 'codex-cli' : undefined)
            )
          : undefined
      const resolvedBackend = backend ?? fallbackBackend
      const catalogById = new Map(getCachedCatalog().map((model) => [model.id, model]))
      const configuredProviders = PROVIDERS.filter((provider) => isProviderConfigured(provider.name))
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
                .flatMap((provider) => provider.models.map((model) => ({
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
      void dispatchChatSend(wins[0], conversationId, content, { model, agentId, projectId, images: images.length > 0 ? images : undefined })
      return
    }

    const db = getDatabase()

    if (command === 'android:update-manifest') {
      reply({ event: 'android:update-manifest', data: getAndroidUpdateManifest(db) })
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
        `SELECT id, role, content, model, attachments, timestamp FROM messages
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
          webFetch: { enabled: true, approval: 'never-ask' },
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
      const config = { ...JSON.parse(existing.config_json) as Record<string, unknown>, name, icon }
      db.prepare('UPDATE agents SET config_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(config), Date.now(), id)
      broadcastToMobile({ event: 'agent:updated', data: { agent: { id, name, icon } } })
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
      const rows = db.prepare('SELECT id, config_json, enabled FROM mcp_servers').all() as {
        id: string
        config_json: string
        enabled: number
      }[]
      const servers = rows.map((row) => {
        const cfg = JSON.parse(row.config_json) as { name?: string; command?: string }
        return { id: row.id, name: cfg.name ?? row.id, command: cfg.command ?? '', enabled: row.enabled === 1 }
      })
      reply({ event: 'mcp:list', data: { servers } })
      return
    }

    if (command === 'feature-generator:start' || command === 'feature-generator:message') {
      const messages = Array.isArray(data.messages) ? (data.messages as FeatureGeneratorMessage[]) : []
      void runFeatureGeneratorChatForAndroid(messages)
      return
    }

    if (command === 'feature-generator:confirm-spec') {
      const spec = data.spec as FeatureSpec
      if (!spec?.title) return
      const runId = typeof data.runId === 'string' ? data.runId : randomUUID()
      const now = Date.now()
      db.prepare(
        `INSERT OR REPLACE INTO feature_generator_runs (id, title, status, spec_json, created_at, updated_at) VALUES (?, ?, 'spec-ready', ?, ?, ?)`
      ).run(runId, spec.title, JSON.stringify(spec), now, now)
      reply({ event: 'feature-generator:run-created', data: { runId } })
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return
      void generateImplementationPlan(win, runId, spec).then((plan) => {
        broadcastToMobile({ event: 'feature-generator:plan-ready', data: { runId, plan } })
      }).catch((err: unknown) => {
        broadcastToMobile({ event: 'feature-generator:error', data: { runId, message: String(err) } })
      })
      return
    }

    if (command === 'feature-generator:start-implementation') {
      const runId = typeof data.runId === 'string' ? data.runId : ''
      if (!runId) return
      const row = db.prepare('SELECT spec_json, plan_markdown FROM feature_generator_runs WHERE id = ?').get(runId) as
        | { spec_json: string; plan_markdown: string }
        | undefined
      if (!row?.spec_json || !row?.plan_markdown) return
      const spec = JSON.parse(row.spec_json) as FeatureSpec
      const plan = row.plan_markdown
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return
      void runFeatureImplementation(win, runId, spec, plan).then(() => {
        broadcastToMobile({ event: 'feature-generator:diff-ready', data: { runId } })
      }).catch((err: unknown) => {
        broadcastToMobile({ event: 'feature-generator:error', data: { runId, message: String(err) } })
      })
      return
    }

    if (command === 'feature-generator:list-diffs') {
      const runId = typeof data.runId === 'string' ? data.runId : ''
      if (!runId) return
      const row = db.prepare('SELECT staged_files_json FROM feature_generator_runs WHERE id = ?').get(runId) as
        | { staged_files_json: string | null }
        | undefined
      const files: string[] = row?.staged_files_json ? (JSON.parse(row.staged_files_json) as string[]) : []
      reply({ event: 'feature-generator:diff-list', data: { runId, files } })
      return
    }

    if (command === 'feature-generator:apply-all') {
      const runId = typeof data.runId === 'string' ? data.runId : ''
      if (!runId) return
      const row = db.prepare('SELECT staged_files_json FROM feature_generator_runs WHERE id = ?').get(runId) as
        | { staged_files_json: string | null }
        | undefined
      const files: string[] = row?.staged_files_json ? (JSON.parse(row.staged_files_json) as string[]) : []
      const stagingDir = getFeatureGenStagingDir(runId)
      const workspacePath = getWorkspacePath()
      const applied: string[] = []
      for (const rel of files) {
        try {
          const src = path.join(stagingDir, rel)
          const dest = path.join(workspacePath, rel)
          if (existsSync(src)) {
            mkdirSync(path.dirname(dest), { recursive: true })
            copyFileSync(src, dest)
            applied.push(rel)
          }
        } catch {}
      }
      db.prepare('UPDATE feature_generator_runs SET applied_files_json = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(applied), 'applied', Date.now(), runId)
      reply({ event: 'feature-generator:applied', data: { runId, appliedFiles: applied } })
      return
    }

    if (command === 'feature-generator:commit') {
      const runId = typeof data.runId === 'string' ? data.runId : ''
      const message = typeof data.message === 'string' ? data.message : ''
      if (!runId || !message) return
      const row = db.prepare('SELECT applied_files_json FROM feature_generator_runs WHERE id = ?').get(runId) as
        | { applied_files_json: string | null }
        | undefined
      const applied: string[] = row?.applied_files_json ? (JSON.parse(row.applied_files_json) as string[]) : []
      const workspacePath = getWorkspacePath()
      try {
        for (const rel of applied) {
          execSync(`git add "${rel}"`, { cwd: workspacePath, encoding: 'utf8' })
        }
        const commitResult = execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
          cwd: workspacePath,
          encoding: 'utf8',
        })
        const shaMatch = /([a-f0-9]{7,40})/.exec(commitResult)
        const commitSha = shaMatch?.[1] ?? ''
        db.prepare('UPDATE feature_generator_runs SET commit_sha = ?, status = ?, updated_at = ? WHERE id = ?')
          .run(commitSha, 'committed', Date.now(), runId)
        reply({ event: 'feature-generator:committed', data: { runId, commitSha } })
      } catch (err) {
        reply({ event: 'feature-generator:error', data: { runId, message: String(err) } })
      }
      return
    }

    if (command === 'feature-generator:get-runs') {
      const rows = db.prepare('SELECT * FROM feature_generator_runs ORDER BY created_at DESC LIMIT 20').all() as Record<string, unknown>[]
      const runs = rows.map((r) => ({
        id: String(r.id),
        title: String(r.title),
        status: String(r.status),
        specJson: r.spec_json != null ? String(r.spec_json) : null,
        planMarkdown: r.plan_markdown != null ? String(r.plan_markdown) : null,
        stagedFilesJson: r.staged_files_json != null ? String(r.staged_files_json) : null,
        appliedFilesJson: r.applied_files_json != null ? String(r.applied_files_json) : null,
        commitSha: r.commit_sha != null ? String(r.commit_sha) : null,
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
      }))
      reply({ event: 'feature-generator:runs', data: { runs } })
      return
    }

    if (command === 'artifact:list') {
      const projectId = typeof data.projectId === 'string' ? data.projectId : null
      const rows = projectId
        ? (db.prepare('SELECT id, project_id, title, kind, description, status, current_version_id, created_at, updated_at FROM artifacts WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as Record<string, unknown>[])
        : (db.prepare('SELECT id, project_id, title, kind, description, status, current_version_id, created_at, updated_at FROM artifacts ORDER BY updated_at DESC LIMIT 50').all() as Record<string, unknown>[])
      const artifacts = rows.map((r) => ({
        id: String(r.id),
        projectId: r.project_id != null ? String(r.project_id) : null,
        title: String(r.title),
        kind: String(r.kind),
        description: r.description != null ? String(r.description) : null,
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
      broadcastToMobile({ event: 'prompt:entry-created', data: { entry: { id: entry.id, title: entry.title, body: entry.body, description: entry.description, category: entry.category, tags: entry.tags, scope: entry.scope, projectId: entry.project_id, createdAt: entry.created_at, updatedAt: entry.updated_at } } })
      return
    }

    if (command === 'prompt:update') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      type PromptRow = { id: string; title: string; body: string; description: string; category: string; tags: string; scope: string; project_id: string | null; created_at: number; updated_at: number }
      const row = db.prepare('SELECT * FROM prompt_library_entries WHERE id = ?').get(id) as PromptRow | undefined
      if (!row) return
      const title = typeof data.title === 'string' ? data.title.trim().slice(0, 200) : row.title
      const body = typeof data.body === 'string' ? data.body : row.body
      const description = typeof data.description === 'string' ? data.description.trim().slice(0, 500) : row.description
      const category = typeof data.category === 'string' ? (data.category.trim().slice(0, 80) || 'Custom') : row.category
      const tags = Array.isArray(data.tags) ? JSON.stringify(data.tags as string[]) : row.tags
      if (!title || !body.trim()) return
      const now = Date.now()
      db.prepare('UPDATE prompt_library_entries SET title = ?, body = ?, description = ?, category = ?, tags = ?, updated_at = ? WHERE id = ?').run(title, body, description, category, tags, now, id)
      const updated = db.prepare('SELECT * FROM prompt_library_entries WHERE id = ?').get(id) as PromptRow
      broadcastToMobile({ event: 'prompt:entry-updated', data: { entry: { id: updated.id, title: updated.title, body: updated.body, description: updated.description, category: updated.category, tags: (() => { try { return JSON.parse(updated.tags) as string[] } catch { return [] } })(), scope: updated.scope, projectId: updated.project_id, createdAt: updated.created_at, updatedAt: updated.updated_at } } })
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

    if (command === 'project-generator:start' || command === 'project-generator:message') {
      const messages = Array.isArray(data.messages) ? data.messages : []
      const existingAgents = Array.isArray(data.existingAgents) ? data.existingAgents : []
      void runProjectGeneratorChatForAndroid(messages, existingAgents)
      return
    }

    if (command === 'project-generator:confirm') {
      const spec = data.spec as ProjectGeneratorSpec
      createProjectFromSpec(spec)
        .then((result) => {
          broadcastToMobile({ event: 'project-generator:created', data: result })
        })
        .catch((err: unknown) => {
          broadcastToMobile({ event: 'project-generator:error', data: { message: String(err) } })
        })
      return
    }

    if (command === 'project-generator:cancel') {
      broadcastToMobile({ event: 'project-generator:cancelled', data: {} })
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
}
