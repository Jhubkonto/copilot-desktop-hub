import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { safeHandle } from './safe-handle'
import { getDatabase } from './database'
import { abortActiveStream, PROVIDERS, getOpenRouterModels, isProviderConfigured } from './providers'
import { dispatchChatSend } from './chat-handlers'
import { debugLog } from './debug-mode'
import { getCliModels } from './cli-detection'
import { getCachedCatalog } from './model-catalog'
import { getAndroidUpdateManifest, getAndroidWorkspaceInfo, computeSha256 } from './android-handlers'
import { getWorkspaceInfo, startBuildFromMobile, cancelMobileBuild, publishArtifactToFeed } from './build-handlers'
import { dbListTasks, dbGetTask, dbCreateTask, dbUpdateTask, dbDeleteTask, dbSetTaskEnabled, dbListRuns, schedulerEngine } from './scheduler-engine'
import { existsSync as fsExistsSync, copyFileSync as fsCopyFileSync, mkdirSync as fsMkdirSync, readdirSync as fsReaddirSync, statSync as fsStatSync } from 'fs'
import { writeFile as fsWriteFile, readFile as fsReadFile } from 'fs/promises'
import pathModule from 'path'
import { networkInterfaces } from 'os'
import { startFeedServer, getFeedLanUrl } from './local-feed-server'
import { createErrorReport, rowToErrorReport, deleteErrorReport } from './error-report-handlers'
import { applyStagedPatchToWorkspace, computeActiveCodeChangesByProject } from './remote-edit-handlers'
import { listHistory } from './remote-edit/history'
import {
  emitInvestigationEvent,
  loadInvestigationSettings,
  runInvestigation,
  saveInvestigationSettings,
} from './remote-edit/investigator'
import { runFix, emitFixEvent } from './remote-edit/fix-agent'
import { emitVerificationEvent, runVerification } from './remote-edit/verifier'
import { commitRemoteEditFix, prepareRemoteEditCommit, pushRemoteEditFix } from './remote-edit/git-ops'
import { approveRelaunch, getRecoveryRuns, prepareReload, rollbackHeal, startReload } from './remote-edit/recovery'
import { runProjectGeneratorChatForAndroid, createProjectFromSpec, getProjectGeneratorAgentSummaries, getProjectGeneratorModel } from './project-generator'
import { runAgentGeneratorChatForAndroid, createAgentFromSpec, getAgentGeneratorModel } from './agent-generator'
import { runSkillGeneratorChatForAndroid, createSkillFromSpec, getSkillGeneratorModel } from './skill-generator'
import {
  createScheduleFromSpec,
  getScheduleGeneratorModel,
  runScheduleGeneratorChatForAndroid,
  setScheduleGeneratorModel,
} from './scheduler-generator'
import {
  createArtifactGeneratorRunRecord,
  runArtifactGeneration,
  runArtifactGeneratorChatForAndroid,
  updateArtifactGeneratorRunRecord,
  getArtifactGeneratorModel,
} from './artifact-generator'
import { promoteConversationMessageToArtifact } from './artifacts'
import { getActiveChatTurnSnapshot } from './active-chat-turns'
import {
  getManualWorkflowGeneratorModel,
  runManualWorkflowGeneratorChatForAndroid,
  setManualWorkflowGeneratorModel,
  normalizeManualWorkflowSpec,
} from './manual-workflow-generator'
import {
  saveManualWorkflowRunFromSpec,
  listManualWorkflowRuns,
  getManualWorkflowRun,
  updateManualWorkflowRunStepStatus,
  discardManualWorkflowRun,
} from './manual-workflow-runs'
import type { ProjectGeneratorSpec, AgentGeneratorSpec, SkillConfig, SkillGeneratorSpec, ScheduleGeneratorMessage, ScheduleGeneratorSpec, ArtifactGeneratorMessage, ArtifactSpec, PromptLibraryEntry, PromptLibraryVersion, ManualWorkflowGeneratorMessage } from '../shared/types'
import { storeApiKey, removeApiKey, getAzureEndpoint, setAzureEndpoint } from './provider-secrets'
import { testProviderKey } from './providers'
import { detectAllClis } from './cli-detection'
import { ClaudeAdapter } from './cli-adapters/claude'
import { CodexAdapter } from './cli-adapters/codex'
import { insertWikiEntry, extractWikiLearningsForWs } from './wiki-handlers'
import { generateDebriefForWs, getDebriefForWs, markCompleteForWs, markIncompleteForWs } from './debrief-handlers'
import { generateQuizForWs } from './quiz-handlers'
import { getMcpServersWithStatus, getMcpServerStatus, addMcpServer, updateMcpServer, removeMcpServer, restartMcpServer, listMcpTools, listMcpToolsForAgent } from './mcp'
import {
  insertPromptLibraryEntry,
  listPromptLibraryVersions,
  rollbackPromptLibraryEntry,
  updatePromptLibraryEntry,
} from './prompt-handlers'
import { buildConversationExportPack, forkConversation, importConversationExport, getConversationCompressionPreview, prepareConversationCompressionSummary, saveConversationCompressionSummary } from './conversation-handlers'
import type { ContextInspectorSnapshot, CodeChangeRequestType, RemoteEditInvestigationSettings } from '../shared/types'
import { getProjectAuditDiff, getRemoteEditAuditDiff, listProjectAuditFiles, listProjectAuditSessions } from './project-audit'
import { parseProjectConfig } from './project-handlers'
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
import { handleStandaloneSyncCommand } from './standalone-sync'
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
  setMobileInForeground,
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

// Tracks conversationIds currently being dispatched from Android to prevent
// duplicate streams when the Android client reconnects mid-send (race-connect).
const activeAndroidDispatches = new Set<string>()

/**
 * Asks the focused renderer window for its live composer/draft state (system prompt,
 * @refs, attachments, current input) so the Android companion can render the same
 * "Context inspector" breakdown as the desktop app. Times out with null if no window
 * is open or the renderer doesn't reply (e.g. a different conversation is focused).
 */
function requestInspectorSnapshotFromRenderer(conversationId: string | null): Promise<ContextInspectorSnapshot | null> {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return Promise.resolve(null)

  const requestId = randomUUID()
  return new Promise((resolve) => {
    let settled = false
    const finish = (snapshot: ContextInspectorSnapshot | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      ipcMain.off('context:inspector-snapshot-reply', replyHandler)
      resolve(snapshot)
    }
    const replyHandler = (_event: Electron.IpcMainEvent, incomingRequestId: string, snapshot: ContextInspectorSnapshot | null) => {
      if (incomingRequestId !== requestId) return
      finish(snapshot)
    }
    const timer = setTimeout(() => finish(null), 2000)
    ipcMain.on('context:inspector-snapshot-reply', replyHandler)
    win.webContents.send('context:request-inspector-snapshot', { requestId, conversationId })
  })
}

export function registerWsHandlers(): void {
  setWsCommandHandler((command, data, reply) => {
    if (command === 'ping') return

    debugLog('ws', `command: ${command}`)

    if (command.startsWith('sync:')) {
      try {
        if (handleStandaloneSyncCommand(command, data, reply)) return
      } catch (error) {
        reply({
          event: 'sync:error',
          data: {
            code: 'sync-failed',
            message: error instanceof Error ? error.message : String(error),
          },
        })
        return
      }
    }

    if (command === 'android:log') {
      const tag = typeof data.tag === 'string' ? data.tag : 'Android'
      const message = typeof data.message === 'string' ? data.message : ''
      const ts = typeof data.ts === 'number' ? data.ts : Date.now()
      debugLog('android', `[${tag}] ${message}`)
      console.log(`[android][${tag}] ${message}`)
      BrowserWindow.getAllWindows().forEach((w) => {
        if (!w.isDestroyed()) w.webContents.send('android:log', { tag, message, ts })
      })
      return
    }

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

    if (command === 'mobile:app-foreground') {
      setMobileInForeground(true)
      return
    }

    if (command === 'mobile:app-background') {
      setMobileInForeground(false)
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
        const allowedRequestTypes: CodeChangeRequestType[] = ['edit', 'refactor', 'bugfix', 'feature', 'investigation', 'custom']
        const requestType: CodeChangeRequestType = allowedRequestTypes.includes(data.requestType as CodeChangeRequestType)
          ? (data.requestType as CodeChangeRequestType)
          : 'edit'
        const conversationId = typeof data.conversationId === 'string' && data.conversationId ? data.conversationId : undefined
        const result = createErrorReport({
          title: typeof data.title === 'string' ? data.title : 'Android edit request',
          description: typeof data.description === 'string' ? data.description : 'Requested from Android.',
          includeLog: data.includeLog !== false,
          includeScreenshot: false,
          requestType,
          customTypeLabel: typeof data.customTypeLabel === 'string' ? data.customTypeLabel : null,
          origin: conversationId ? 'chat' : 'android',
          projectId: typeof data.projectId === 'string' && data.projectId ? data.projectId : undefined,
          conversationId,
          workspaceRoot: (getDatabase()
            .prepare("SELECT value FROM settings WHERE key = 'build_workspace_path'")
            .get() as { value: string } | undefined)?.value ?? process.cwd(),
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
      // projectId is effectively required by both current callers (desktop's own error-report:list
      // IPC path is unaffected by this handler; Android always has a project in scope now) — kept
      // optional here only as a safety fallback for older clients, not a maintained path.
      const projectId = typeof data.projectId === 'string' && data.projectId ? data.projectId : null
      const rows = projectId
        ? getDatabase()
            .prepare('SELECT * FROM error_reports WHERE project_id = ? ORDER BY created_at DESC LIMIT 50')
            .all(projectId) as Record<string, unknown>[]
        : getDatabase()
            .prepare('SELECT * FROM error_reports ORDER BY created_at DESC LIMIT 50')
            .all() as Record<string, unknown>[]
      const reports = rows.map(rowToErrorReport)
      debugLog('ws', `self-heal:get-reports → projectId=${projectId ?? 'none'} returning ${reports.length} reports`)
      reply({ event: 'self-heal:reports', data: { reports } })
      return
    }

    if (command === 'self-heal:get-active-code-changes') {
      reply({ event: 'self-heal:active-code-changes-changed', data: computeActiveCodeChangesByProject() })
      return
    }

    if (command === 'self-heal:set-report-status') {
      const reportId = typeof data.reportId === 'string' ? data.reportId : ''
      const status = typeof data.status === 'string' ? data.status : ''
      if (!reportId || !['open', 'investigating', 'investigated', 'fixed', 'rejected'].includes(status)) return
      const now = Date.now()
      getDatabase().prepare('UPDATE error_reports SET status = ?, updated_at = ? WHERE id = ?').run(status, now, reportId)
      const projectId = typeof data.projectId === 'string' && data.projectId ? data.projectId : null
      const rows = projectId
        ? getDatabase()
            .prepare('SELECT * FROM error_reports WHERE project_id = ? ORDER BY created_at DESC LIMIT 50')
            .all(projectId) as Record<string, unknown>[]
        : getDatabase()
            .prepare('SELECT * FROM error_reports ORDER BY created_at DESC LIMIT 50')
            .all() as Record<string, unknown>[]
      const reports = rows.map(rowToErrorReport)
      reply({ event: 'self-heal:reports', data: { reports } })
      // Other connected clients may be viewing a different project's list — a full unfiltered
      // resend would silently overwrite whatever they're scoped to. Broadcast just the change and
      // let each client re-request its own project-scoped list (see self-heal:get-reports).
      broadcastToMobile({ event: 'self-heal:reports-changed', data: { reportId, status } })
      return
    }

    if (command === 'self-heal:get-investigation-settings') {
      reply({ event: 'self-heal:investigation-settings', data: loadInvestigationSettings() })
      return
    }

    if (command === 'self-heal:set-investigation-settings') {
      const settings = saveInvestigationSettings(data as unknown as RemoteEditInvestigationSettings)
      reply({ event: 'self-heal:investigation-settings', data: settings })
      return
    }

    if (command === 'self-heal:start-investigation') {
      const reportId = typeof data.reportId === 'string' ? data.reportId : ''
      if (!reportId) return
      const revisionNotes = typeof data.revisionNotes === 'string' ? data.revisionNotes : undefined
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return
      debugLog('ws', `self-heal:start-investigation reportId=${reportId}`)
      void runInvestigation(win, reportId, {
        onChunk: (chunk) => {
          emitInvestigationEvent(win, 'remote-edit:investigation-chunk', { reportId, chunk })
        },
        onActivity: (activity) => {
          emitInvestigationEvent(win, 'remote-edit:investigation-activity', activity)
        },
      }, revisionNotes).then((result) => {
        emitInvestigationEvent(win, 'remote-edit:investigation-done', result)
      })
      return
    }

    if (command === 'self-heal:start-fix') {
      const reportId = typeof data.reportId === 'string' ? data.reportId : ''
      if (!reportId) return
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return
      debugLog('ws', `self-heal:start-fix reportId=${reportId}`)
      void runFix(win, reportId, {
        onEvent: (event) => {
          emitFixEvent(win, 'remote-edit:fix-event', event)
        },
      }).then((result) => {
        emitFixEvent(win, 'remote-edit:fix-done', result)
      })
      return
    }

    if (command === 'self-heal:start-verification') {
      const reportId = typeof data.reportId === 'string' ? data.reportId : ''
      if (!reportId) return
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return
      const runId = `${reportId}-${Date.now()}`
      debugLog('ws', `self-heal:start-verification reportId=${reportId}`)
      void runVerification(reportId, (event) => {
        emitVerificationEvent(win, 'remote-edit:verification-event', event)
      }, runId).then((result) => {
        emitVerificationEvent(win, 'remote-edit:verification-done', result)
      })
      return
    }

    if (command === 'self-heal:get-staged-diff') {
      const reportId = typeof data.reportId === 'string' ? data.reportId : ''
      const relativePath = typeof data.relativePath === 'string' ? data.relativePath : ''
      if (!reportId || !relativePath) return
      const row = getDatabase()
        .prepare('SELECT diff_json FROM remote_edit_diffs WHERE report_id = ? AND relative_path = ?')
        .get(reportId, relativePath) as { diff_json: string } | undefined
      if (!row) {
        const auditDiff = getRemoteEditAuditDiff(reportId, relativePath)
        if (auditDiff) {
          reply({
            event: 'self-heal:staged-diff',
            data: { reportId, ...auditDiff },
          })
          return
        }
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
      void prepareRemoteEditCommit(reportId).then((result) => {
        reply({ event: 'self-heal:git-prepare-result', data: result })
      })
      return
    }

    if (command === 'self-heal:git-commit') {
      const reportId = typeof data.reportId === 'string' ? data.reportId : ''
      const message = typeof data.message === 'string' ? data.message : ''
      if (!reportId) return
      debugLog('ws', `self-heal:git-commit reportId=${reportId}`)
      void commitRemoteEditFix(reportId, message).then((result) => {
        reply({ event: 'self-heal:git-commit-result', data: result })
      })
      return
    }

    if (command === 'self-heal:git-push') {
      const reportId = typeof data.reportId === 'string' ? data.reportId : ''
      if (!reportId) return
      void pushRemoteEditFix(reportId).then((result) => {
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

    if (command === 'self-heal:delete-report') {
      const reportId = typeof data.reportId === 'string' ? data.reportId : ''
      if (!reportId) return
      debugLog('ws', `self-heal:delete-report reportId=${reportId}`)
      try {
        const deleted = deleteErrorReport(reportId)
        broadcastToMobile({ event: 'self-heal:report-deleted', data: { reportId, deleted } })
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        broadcastToMobile({ event: 'self-heal:report-deleted', data: { reportId, deleted: false, error: errorMsg } })
      }
      return
    }

    if (command === 'self-heal:apply-staged-patch') {
      const reportId = typeof data.reportId === 'string' ? data.reportId : ''
      if (!reportId) return
      debugLog('ws', `self-heal:apply-staged-patch reportId=${reportId}`)
      try {
        const result = applyStagedPatchToWorkspace(reportId)
        if (!result) {
          reply({ event: 'self-heal:apply-result', data: { reportId, error: 'Nothing to apply' } })
          return
        }
        if ('error' in result) {
          reply({ event: 'self-heal:apply-result', data: { reportId, error: result.error } })
          return
        }
        reply({ event: 'self-heal:apply-result', data: { reportId, ...result } })
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        reply({ event: 'self-heal:apply-result', data: { reportId, error: errorMsg } })
      }
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
      const byId = new Map<string, { id: string; label: string; vendor?: string; isCliSourced?: boolean }>()
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
            ? getCliModels('codex-cli').map((model) => ({ ...model, vendor: 'Codex CLI', isCliSourced: true }))
            : resolvedBackend === 'claude-cli'
              ? getCliModels('claude-cli').map((model) => ({ ...model, vendor: 'Claude CLI', isCliSourced: true }))
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
          if (!byId.has(model.id)) byId.set(model.id, { ...model, vendor: 'Claude CLI', isCliSourced: true })
        }
      }
      if (CodexAdapter.isAvailable()) {
        for (const model of getCliModels('codex-cli')) {
          if (!byId.has(model.id)) byId.set(model.id, { ...model, vendor: 'Codex CLI', isCliSourced: true })
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
      // Deduplicate: Android race-connect can open multiple sockets simultaneously,
      // causing the same chat:send-message to arrive multiple times. Skip if we're
      // already dispatching this conversation.
      if (activeAndroidDispatches.has(conversationId)) {
        debugLog('ws', `chat:send-message duplicate ignored for conv=${conversationId}`)
        return
      }
      const wins = BrowserWindow.getAllWindows()
      if (wins.length === 0) return
      wins[0].webContents.send('chat:remote-message', {
        conversationId,
        content,
        images: images.length > 0 ? images : undefined,
      })
      // If the requested model belongs to a CLI backend, tell the dispatcher so it
      // routes through that CLI instead of falling through to a BYOK provider.
      // When Android sends no model or "default", resolve against the desktop's
      // default_model setting so CLI-default setups work correctly.
      let inferredCliBackend: 'codex-cli' | 'claude-cli' | undefined
      const effectiveModel = (model && model !== 'default')
        ? model
        : (() => {
            const row = getDatabase().prepare("SELECT value FROM settings WHERE key = 'default_model'").get() as { value: string } | undefined
            return row?.value || undefined
          })()
      const codexModels = CodexAdapter.isAvailable() ? getCliModels('codex-cli').map((m) => m.id) : []
      const claudeModels = ClaudeAdapter.isAvailable() ? getCliModels('claude-cli').map((m) => m.id) : []
      const routeLog = (msg: string): void => {
        debugLog('ws', msg)
        broadcastToMobile({ event: 'android:log', data: { tag: 'WsRoute', message: msg, ts: Date.now() } })
      }
      routeLog(`chat:send model=${model ?? 'none'} effectiveModel=${effectiveModel ?? 'none'}`)
      routeLog(`codexAvail=${CodexAdapter.isAvailable()} codexModels=[${codexModels.join(',')}]`)
      routeLog(`claudeAvail=${ClaudeAdapter.isAvailable()} claudeModels=[${claudeModels.join(',')}]`)
      if (effectiveModel && effectiveModel !== 'default') {
        if (CodexAdapter.isAvailable() && codexModels.some((id) => id === effectiveModel)) {
          inferredCliBackend = 'codex-cli'
        } else if (ClaudeAdapter.isAvailable() && claudeModels.some((id) => id === effectiveModel)) {
          inferredCliBackend = 'claude-cli'
        }
      }
      routeLog(`inferredCliBackend=${inferredCliBackend ?? 'none'}`)
      activeAndroidDispatches.add(conversationId)
      void dispatchChatSend(wins[0], conversationId, content, { model, agentId, projectId, images: images.length > 0 ? images : undefined, cliBackend: inferredCliBackend })
        ?.then(() => { activeAndroidDispatches.delete(conversationId) })
        ?.catch((err: unknown) => {
          activeAndroidDispatches.delete(conversationId)
          const message = err instanceof Error ? err.message : 'Unexpected error'
          broadcastToMobile({ event: 'chat:activity', data: { conversationId, state: 'error', label: message } })
          broadcastToMobile({ event: 'chat:stream-end', data: { conversationId } })
          // Notify the renderer so it clears the generating spinner for this conversation
          if (!wins[0].isDestroyed()) wins[0].webContents.send('chat:activity-global', { conversationId, state: 'error', label: message })
        })
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
            c.pinned,
            c.archived,
            c.completed_at,
            c.thinking_effort_override,
            c.full_auto_approve_override,
            json_extract(a.config_json, '$.name') AS agent_name,
            json_extract(a.config_json, '$.icon') AS agent_icon,
            c.project_id,
            p.name AS project_name,
            (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY timestamp DESC LIMIT 1) AS last_message
          FROM conversations c
          LEFT JOIN agents a ON c.agent_id = a.id
          LEFT JOIN projects p ON c.project_id = p.id
          WHERE c.archived = 0
          ORDER BY c.pinned DESC, c.updated_at DESC
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

    if (command === 'conversation:set-mode') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      // Only the field(s) actually present in the payload are touched — see the matching
      // Electron-IPC handler in conversation-handlers.ts for why this can't just default to null.
      const existing = db
        .prepare('SELECT thinking_effort_override, full_auto_approve_override FROM conversations WHERE id = ?')
        .get(conversationId) as { thinking_effort_override: string | null; full_auto_approve_override: number | null } | undefined
      const validEfforts = ['low', 'medium', 'high', 'max', 'disabled']
      const thinkingEffortOverride = 'thinkingEffortOverride' in data
        ? (typeof data.thinkingEffortOverride === 'string' && validEfforts.includes(data.thinkingEffortOverride) ? data.thinkingEffortOverride : null)
        : (existing?.thinking_effort_override ?? null)
      const fullAutoApproveOverride = 'fullAutoApproveOverride' in data
        ? (data.fullAutoApproveOverride === true ? 1 : data.fullAutoApproveOverride === false ? 0 : null)
        : (existing?.full_auto_approve_override ?? null)
      db.prepare(
        'UPDATE conversations SET thinking_effort_override = ?, full_auto_approve_override = ?, updated_at = ? WHERE id = ?'
      ).run(thinkingEffortOverride, fullAutoApproveOverride, Date.now(), conversationId)
      broadcastToMobile({ event: 'conversation:mode-updated', data: { conversationId, thinkingEffortOverride, fullAutoApproveOverride } })
      return
    }

    if (command === 'project:list') {
      const rows = db.prepare(`
          SELECT p.id, p.name, p.color,
            (SELECT COUNT(*) FROM conversations WHERE project_id = p.id) AS chat_count,
            (SELECT GROUP_CONCAT(NULLIF(json_extract(a.config_json, '$.icon'), ''), ',')
             FROM project_agents pa JOIN agents a ON pa.agent_id = a.id
             WHERE pa.project_id = p.id
             ORDER BY pa.sort_order ASC) AS agent_icons,
            NULLIF(json_extract(p.config_json, '$.rootDirectory'), '') AS root_directory
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
            WHERE c.archived = 0 AND (c.title LIKE ? OR m.content LIKE ?)
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
            WHERE c.archived = 0
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
      const current = { ...parseProjectConfig(existing?.config_json ?? null) } as Record<string, unknown>
      const patch: Record<string, unknown> = {}
      if (typeof data.instructions === 'string') patch.instructions = data.instructions
      if (typeof data.rootDirectory === 'string') patch.rootDirectory = data.rootDirectory
      if (Array.isArray(data.variables)) patch.variables = data.variables
      if (typeof data.workflowMode === 'string' && ['single-agent', 'manual-delegation', 'orchestrated'].includes(data.workflowMode)) {
        patch.workflowMode = data.workflowMode
        patch.orchestrationEnabled = data.workflowMode === 'orchestrated'
      } else if (typeof data.orchestrationEnabled === 'boolean') {
        patch.orchestrationEnabled = data.orchestrationEnabled
        patch.workflowMode = data.orchestrationEnabled ? 'orchestrated' : 'single-agent'
      }
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
      broadcastToMobile({ event: 'project:config-updated', data: { id, config: parseProjectConfig(JSON.stringify(merged)) } })
      return
    }

    if (command === 'chat:get-active-turn') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      reply({
        event: 'chat:active-turn-snapshot',
        data: {
          conversationId,
          snapshot: getActiveChatTurnSnapshot(conversationId),
        },
      })
      return
    }

    if (command === 'project:get-config') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const row = db.prepare('SELECT config_json FROM projects WHERE id = ?').get(id) as { config_json: string | null } | undefined
      const config = parseProjectConfig(row?.config_json ?? null)
      reply({ event: 'project:config', data: { id, config } })
      return
    }

    if (command === 'project-audit:list-sessions') {
      const projectId = typeof data.projectId === 'string'
        ? data.projectId
        : data.projectId === null
          ? null
          : undefined
      reply({ event: 'project-audit:sessions', data: { projectId: projectId ?? null, sessions: listProjectAuditSessions(projectId) } })
      return
    }

    if (command === 'project-audit:list-files') {
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : ''
      if (!sessionId) return
      reply({ event: 'project-audit:files', data: { sessionId, files: listProjectAuditFiles(sessionId) } })
      return
    }

    if (command === 'project-audit:get-diff') {
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : ''
      const relativePath = typeof data.relativePath === 'string' ? data.relativePath : ''
      if (!sessionId || !relativePath) return
      reply({ event: 'project-audit:diff', data: { sessionId, diff: getProjectAuditDiff(sessionId, relativePath) } })
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

    if (command === 'provider:key-handoff-request') {
      const provider = typeof data.provider === 'string' ? data.provider : ''
      if (!provider) return
      // Notify desktop's renderer windows so a human can approve or decline sending the
      // key — the value itself is never sent from here. Approval flows through the
      // 'provider:key-handoff-confirm' IPC handler in providers.ts, triggered only by an
      // explicit "Send Key" click in ProvidersTab.tsx.
      BrowserWindow.getAllWindows().forEach((w) => {
        if (!w.isDestroyed()) w.webContents.send('provider:key-handoff-request', { provider })
      })
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
      const cutoffTimestamp = typeof data.cutoffTimestamp === 'number' ? data.cutoffTimestamp : null
      try {
        const result = forkConversation(db, conversationId, { cutoffTimestamp })
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

    if (command === 'artifact:promote-message') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      const messageId = typeof data.messageId === 'string' ? data.messageId : ''
      const title = typeof data.title === 'string' ? data.title : ''
      const kind = typeof data.kind === 'string' ? data.kind : 'document'
      const filePath = typeof data.filePath === 'string' ? data.filePath : ''
      const scopeObj = typeof data.scope === 'object' && data.scope !== null ? data.scope as Record<string, unknown> : {}
      const scopeType = scopeObj.type === 'project' ? 'project' : 'global'
      const scopeProjectId = typeof scopeObj.projectId === 'string' ? scopeObj.projectId : undefined
      if (!conversationId || !messageId || !filePath) return
      try {
        const result = promoteConversationMessageToArtifact({
          conversationId,
          messageId,
          title,
          kind: (['document', 'prompt', 'plan', 'code', 'other'].includes(kind) ? kind : 'document') as 'document' | 'prompt' | 'plan' | 'code' | 'other',
          scope: scopeType === 'project' ? { type: 'project', projectId: scopeProjectId } : { type: 'global' },
          filePath,
        })
        reply({ event: 'artifact:promoted', data: { ...result, messageId } })
      } catch (error) {
        reply({ event: 'artifact:promote-error', data: { message: error instanceof Error ? error.message : String(error), messageId } })
      }
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

    if (command === 'context:inspector-snapshot') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : null
      requestInspectorSnapshotFromRenderer(conversationId)
        .then((snapshot) => {
          reply({ event: 'context:inspector-snapshot', data: snapshot })
        })
        .catch((err) => {
          reply({ event: 'context:inspector-snapshot-error', data: { message: String(err) } })
        })
      return
    }

    if (command === 'project-generator:start' || command === 'project-generator:message') {
      const messages = Array.isArray(data.messages) ? data.messages : []
      const sessionId = typeof data.sessionId === 'string' && data.sessionId.trim()
        ? data.sessionId.trim()
        : `android-${Date.now()}`
      const modelOverride = typeof data.model === 'string' && data.model.trim() ? data.model.trim() : undefined
      const existingAgents = Array.isArray(data.existingAgents) && data.existingAgents.length > 0
        ? data.existingAgents
        : getProjectGeneratorAgentSummaries()
      if (command === 'project-generator:start') {
        try {
          const resolvedModel = modelOverride ?? getProjectGeneratorModel()
          broadcastToMobile({ event: 'project-generator:model', data: { sessionId, modelId: resolvedModel } })
        } catch { /* no configured provider — error will surface from runProjectGeneratorChatForAndroid */ }
      }
      void runProjectGeneratorChatForAndroid(messages, existingAgents, sessionId, modelOverride)
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
      const modelOverride = typeof data.model === 'string' && data.model.trim() ? data.model.trim() : undefined
      if (command === 'agent-generator:start') {
        try {
          const resolvedModel = modelOverride ?? getAgentGeneratorModel()
          broadcastToMobile({ event: 'agent-generator:model', data: { sessionId, modelId: resolvedModel } })
        } catch { /* no configured provider — error will surface from runAgentGeneratorChatForAndroid */ }
      }
      void runAgentGeneratorChatForAndroid(messages, sessionId, modelOverride)
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
      const modelOverride = typeof data.model === 'string' && data.model.trim() ? data.model.trim() : undefined
      if (command === 'skill-generator:start') {
        try {
          const resolvedModel = modelOverride ?? getSkillGeneratorModel()
          broadcastToMobile({ event: 'skill-generator:model', data: { sessionId, modelId: resolvedModel } })
        } catch { /* no configured provider — error will surface from runSkillGeneratorChatForAndroid */ }
      }
      void runSkillGeneratorChatForAndroid(messages, sessionId, modelOverride)
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

    if (command === 'scheduler-generator:start' || command === 'scheduler-generator:message') {
      const rawMessages = Array.isArray(data.messages) ? data.messages : []
      const messages: ScheduleGeneratorMessage[] = rawMessages
        .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
        .map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: typeof m.content === 'string' ? m.content : '',
        }))
      const sessionId = typeof data.sessionId === 'string' && data.sessionId.trim()
        ? data.sessionId.trim()
        : `android-schedule-${Date.now()}`
      const modelOverride = typeof data.model === 'string' && data.model.trim() ? data.model.trim() : undefined
      if (command === 'scheduler-generator:start') {
        try {
          const resolvedModel = modelOverride ?? getScheduleGeneratorModel()
          broadcastToMobile({ event: 'scheduler-generator:model', data: { sessionId, modelId: resolvedModel } })
        } catch { /* no configured provider; generator error will surface */ }
      }
      void runScheduleGeneratorChatForAndroid(messages, sessionId, modelOverride)
        .catch((err: unknown) => {
          broadcastToMobile({ event: 'scheduler-generator:error', data: { sessionId, message: String(err) } })
        })
      return
    }

    if (command === 'scheduler-generator:confirm') {
      const spec = data.spec as ScheduleGeneratorSpec
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      createScheduleFromSpec(spec)
        .then((result) => {
          broadcastToMobile({ event: 'scheduler-generator:created', data: { sessionId, taskId: result.taskId, name: result.name } })
        })
        .catch((err: unknown) => {
          broadcastToMobile({ event: 'scheduler-generator:error', data: { sessionId, message: String(err) } })
        })
      return
    }

    if (command === 'scheduler-generator:cancel') {
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      broadcastToMobile({ event: 'scheduler-generator:cancelled', data: { sessionId } })
      return
    }

    if (command === 'scheduler-generator:get-model') {
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      try {
        broadcastToMobile({ event: 'scheduler-generator:model', data: { sessionId, modelId: getScheduleGeneratorModel() } })
      } catch (err) {
        broadcastToMobile({ event: 'scheduler-generator:error', data: { sessionId, message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (command === 'scheduler-generator:set-model') {
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      const modelId = typeof data.modelId === 'string' ? data.modelId : ''
      setScheduleGeneratorModel(modelId)
      broadcastToMobile({ event: 'scheduler-generator:model', data: { sessionId, modelId: getScheduleGeneratorModel() } })
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
      const modelOverride = typeof data.model === 'string' && data.model.trim() ? data.model.trim() : undefined
      if (command === 'artifact-generator:start') {
        try {
          const resolvedModel = modelOverride ?? getArtifactGeneratorModel()
          broadcastToMobile({ event: 'artifact-generator:model', data: { sessionId, modelId: resolvedModel } })
        } catch { /* no configured provider — error will surface from runArtifactGeneratorChatForAndroid */ }
      }
      void runArtifactGeneratorChatForAndroid(messages, sessionId, modelOverride)
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

    if (command === 'manual-workflow-generator:start' || command === 'manual-workflow-generator:message') {
      const projectId = typeof data.projectId === 'string' ? data.projectId.trim() : ''
      if (!projectId) {
        const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
        broadcastToMobile({ event: 'manual-workflow-generator:error', data: { sessionId, message: 'Missing projectId' } })
        return
      }
      const rawMessages = Array.isArray(data.messages) ? data.messages : []
      const messages: ManualWorkflowGeneratorMessage[] = rawMessages
        .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
        .map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: typeof m.content === 'string' ? m.content : '',
        }))
      const sessionId = typeof data.sessionId === 'string' && data.sessionId.trim()
        ? data.sessionId.trim()
        : `android-manual-workflow-${Date.now()}`
      const modelOverride = typeof data.model === 'string' && data.model.trim() ? data.model.trim() : undefined
      if (command === 'manual-workflow-generator:start') {
        try {
          const resolvedModel = modelOverride ?? getManualWorkflowGeneratorModel()
          broadcastToMobile({ event: 'manual-workflow-generator:model', data: { sessionId, modelId: resolvedModel } })
        } catch { /* no configured provider; generator error will surface */ }
      }
      void runManualWorkflowGeneratorChatForAndroid(projectId, messages, sessionId, modelOverride)
        .catch((err: unknown) => {
          broadcastToMobile({ event: 'manual-workflow-generator:error', data: { sessionId, message: String(err) } })
        })
      return
    }

    if (command === 'manual-workflow-generator:cancel') {
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      broadcastToMobile({ event: 'manual-workflow-generator:cancelled', data: { sessionId } })
      return
    }

    if (command === 'manual-workflow-generator:get-model') {
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      try {
        broadcastToMobile({ event: 'manual-workflow-generator:model', data: { sessionId, modelId: getManualWorkflowGeneratorModel() } })
      } catch (err) {
        broadcastToMobile({ event: 'manual-workflow-generator:error', data: { sessionId, message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (command === 'manual-workflow-generator:set-model') {
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      const modelId = typeof data.modelId === 'string' ? data.modelId : ''
      setManualWorkflowGeneratorModel(modelId)
      broadcastToMobile({ event: 'manual-workflow-generator:model', data: { sessionId, modelId: getManualWorkflowGeneratorModel() } })
      return
    }

    // Persisted manual workflow runs (distinct from the ephemeral generator chat above).
    // These mirror the desktop-only IPC surface in manual-workflow-runs.ts so a plan
    // saved from Android is the same durable entity desktop's Workflow tab shows.
    function notifyManualWorkflowRunChanged(projectId: string, runId: string): void {
      BrowserWindow.getAllWindows().forEach((w) => {
        if (!w.isDestroyed()) w.webContents.send('manual-workflow-runs:changed', { projectId, runId })
      })
    }

    if (command === 'manual-workflow-runs:list') {
      const projectId = typeof data.projectId === 'string' ? data.projectId : ''
      if (!projectId) return
      reply({ event: 'manual-workflow-runs:list', data: { projectId, runs: listManualWorkflowRuns(projectId) } })
      return
    }

    if (command === 'manual-workflow-runs:get') {
      const runId = typeof data.runId === 'string' ? data.runId : ''
      if (!runId) return
      reply({ event: 'manual-workflow-runs:detail', data: { run: getManualWorkflowRun(runId) } })
      return
    }

    if (command === 'manual-workflow-runs:save-spec') {
      const projectId = typeof data.projectId === 'string' ? data.projectId : ''
      const specRaw = data.spec
      if (!projectId || !specRaw || typeof specRaw !== 'object') return
      const spec = normalizeManualWorkflowSpec(specRaw as Record<string, unknown>)
      const model = typeof data.model === 'string' ? data.model : null
      const existingRunId = typeof data.existingRunId === 'string' ? data.existingRunId : null
      const detail = saveManualWorkflowRunFromSpec(projectId, spec, model, existingRunId)
      broadcastToMobile({ event: 'manual-workflow-runs:detail', data: { run: detail } })
      notifyManualWorkflowRunChanged(projectId, detail.id)
      reply({ event: 'manual-workflow-runs:detail', data: { run: detail } })
      return
    }

    if (command === 'manual-workflow-runs:update-step-status') {
      const runId = typeof data.runId === 'string' ? data.runId : ''
      const stepDbId = typeof data.stepDbId === 'string' ? data.stepDbId : ''
      const status = data.status
      if (!runId || !stepDbId || (status !== 'not_started' && status !== 'started' && status !== 'done')) return
      const detail = updateManualWorkflowRunStepStatus(runId, stepDbId, status)
      if (detail) {
        broadcastToMobile({ event: 'manual-workflow-runs:detail', data: { run: detail } })
        notifyManualWorkflowRunChanged(detail.projectId, detail.id)
      }
      reply({ event: 'manual-workflow-runs:detail', data: { run: detail } })
      return
    }

    if (command === 'manual-workflow-runs:discard') {
      const runId = typeof data.runId === 'string' ? data.runId : ''
      if (!runId) return
      const existing = getManualWorkflowRun(runId)
      const ok = discardManualWorkflowRun(runId)
      if (ok && existing) {
        broadcastToMobile({ event: 'manual-workflow-runs:discarded', data: { runId } })
        notifyManualWorkflowRunChanged(existing.projectId, runId)
      }
      reply({ event: 'manual-workflow-runs:discarded', data: { runId, ok } })
      return
    }

    if (command === 'artifact:move-to-project') {
      const artifactId = typeof data.artifactId === 'string' ? data.artifactId : ''
      const projectId = typeof data.projectId === 'string' && data.projectId ? data.projectId : null
      if (!artifactId) {
        reply({ event: 'artifact:moved-to-project', data: { ok: false, artifactId, projectId } })
        return
      }
      const info = projectId
        ? db.prepare('UPDATE artifacts SET project_id = ?, updated_at = ? WHERE id = ?').run(projectId, Date.now(), artifactId)
        : db.prepare('UPDATE artifacts SET project_id = NULL, updated_at = ? WHERE id = ?').run(Date.now(), artifactId)
      broadcastToMobile({ event: 'artifact:moved-to-project', data: { ok: (info as { changes: number }).changes > 0, artifactId, projectId } })
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

    if (command === 'build:start-from-mobile') {
      const command_ = typeof data.command === 'string' ? data.command as import('../shared/types').BuildCommandName : null
      const validCommands = ['typecheck', 'test', 'build', 'package'] as const
      if (!command_ || !validCommands.includes(command_ as typeof validCommands[number])) {
        reply({ event: 'build:command-done', data: { buildId: null, status: 'failed', exitCode: -1, error: 'Invalid command' } })
        return
      }
      const win = BrowserWindow.getAllWindows()[0]
      void startBuildFromMobile(command_, win ?? undefined)
        .then(({ buildId }) => reply({ event: 'build:started', data: { buildId, command: command_ } }))
        .catch((err: unknown) => reply({ event: 'build:command-done', data: { buildId: null, status: 'failed', exitCode: -1, error: String(err) } }))
      return
    }

    if (command === 'build:cancel-from-mobile') {
      const buildId = typeof data.buildId === 'string' ? data.buildId : ''
      const cancelled = buildId ? cancelMobileBuild(buildId) : false
      reply({ event: 'build:cancelled', data: { buildId, cancelled } })
      return
    }

    if (command === 'build:update-from-artifact') {
      void publishArtifactToFeed(db).then((result) => {
        if (!result.published) {
          reply({ event: 'update:restarting', data: { eta: null, version: null, error: result.error } })
          return
        }
        broadcastToMobile({ event: 'update:restarting', data: { eta: 10, version: result.version ?? null } })
        BrowserWindow.getAllWindows().forEach((w) => {
          if (!w.isDestroyed()) w.webContents.send('update:restarting', { eta: 10, version: result.version ?? null })
        })
        setTimeout(() => { app.relaunch(); app.exit(0) }, 2000)
      })
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

    // ─── Scheduler WebSocket commands ───────────────────────────────────────

    if (command === 'scheduler:list') {
      reply({ event: 'scheduler:list', data: { tasks: dbListTasks() } })
      return
    }

    if (command === 'scheduler:get') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      reply({ event: 'scheduler:get', data: { task: dbGetTask(id) } })
      return
    }

    if (command === 'scheduler:create') {
      const input = data as unknown as import('../shared/types').ScheduledTaskCreateInput
      if (!input?.name || !input?.scheduleType || !input?.localTime || !input?.timezone) return
      const task = dbCreateTask(input)
      schedulerEngine.scheduleTask(task)
      reply({ event: 'scheduler:task-updated', data: task })
      return
    }

    if (command === 'scheduler:update') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const input = data.input as import('../shared/types').ScheduledTaskUpdateInput
      const task = dbUpdateTask(id, input)
      if (!task) return
      if (task.enabled) schedulerEngine.scheduleTask(task)
      else schedulerEngine.unscheduleTask(id)
      reply({ event: 'scheduler:task-updated', data: task })
      return
    }

    if (command === 'scheduler:delete') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      schedulerEngine.unscheduleTask(id)
      dbDeleteTask(id)
      reply({ event: 'scheduler:task-deleted', data: { taskId: id } })
      return
    }

    if (command === 'scheduler:set-enabled') {
      const id = typeof data.id === 'string' ? data.id : ''
      const enabled = typeof data.enabled === 'boolean' ? data.enabled : false
      if (!id) return
      const task = dbSetTaskEnabled(id, enabled)
      if (!task) return
      if (task.enabled) schedulerEngine.scheduleTask(task)
      else schedulerEngine.unscheduleTask(id)
      reply({ event: 'scheduler:task-updated', data: task })
      return
    }

    if (command === 'scheduler:run-now') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      void schedulerEngine.triggerRun(id, 'manual')
        .then((run) => reply({ event: 'scheduler:run-updated', data: run }))
        .catch((err: unknown) => reply({ event: 'scheduler:run-error', data: { taskId: id, error: String(err) } }))
      return
    }

    if (command === 'scheduler:list-runs') {
      const taskId = typeof data.taskId === 'string' ? data.taskId : ''
      const limit = typeof data.limit === 'number' ? data.limit : 50
      if (!taskId) return
      reply({ event: 'scheduler:runs', data: { taskId, runs: dbListRuns(taskId, limit) } })
      return
    }

    if (command === 'conversation:generate-debrief') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      const projectId = typeof data.projectId === 'string' ? data.projectId : null
      const model = typeof data.model === 'string' ? data.model : undefined
      if (!conversationId) return
      void generateDebriefForWs(conversationId, projectId, model)
        .then((result) => reply({ event: 'debrief:ready', data: result }))
        .catch((err: unknown) => reply({ event: 'debrief:error', data: { message: String(err) } }))
      return
    }

    if (command === 'conversation:get-debrief') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      const result = getDebriefForWs(conversationId)
      reply({ event: 'debrief:loaded', data: { debrief: result?.debrief ?? null, artifactId: result?.artifactId, versionId: result?.versionId } })
      return
    }

    if (command === 'conversation:mark-complete') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      const result = markCompleteForWs(conversationId)
      if (result) {
        reply({ event: 'debrief:conversation-completed', data: { conversationId, completedAt: result.completedAt } })
      }
      return
    }

    if (command === 'conversation:mark-incomplete') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      const ok = markIncompleteForWs(conversationId)
      if (ok) {
        reply({ event: 'debrief:conversation-incompleted', data: { conversationId } })
      }
      return
    }

    if (command === 'conversation:generate-quiz') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      const projectId = typeof data.projectId === 'string' ? data.projectId : null
      const model = typeof data.model === 'string' ? data.model : undefined
      if (!conversationId) return
      void generateQuizForWs(conversationId, projectId, model)
        .then((result) => reply({ event: 'quiz:ready', data: result }))
        .catch((err: unknown) => reply({ event: 'quiz:error', data: { message: String(err) } }))
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
