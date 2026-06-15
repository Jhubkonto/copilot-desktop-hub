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
import { createErrorReport } from './error-report-handlers'
import { listHistory } from './self-heal/history'
import {
  emitInvestigationEvent,
  runInvestigation,
} from './self-heal/investigator'
import { runFix, emitFixEvent } from './self-heal/fix-agent'
import { emitVerificationEvent, runVerification } from './self-heal/verifier'
import { commitSelfHealFix, prepareSelfHealCommit, pushSelfHealFix } from './self-heal/git-ops'
import { approveRelaunch, getRecoveryRuns, prepareReload, rollbackHeal, startReload } from './self-heal/recovery'
import { ClaudeAdapter } from './cli-adapters/claude'
import { CodexAdapter } from './cli-adapters/codex'
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
        .all()
      reply({ event: 'self-heal:reports', data: { reports: rows } })
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
