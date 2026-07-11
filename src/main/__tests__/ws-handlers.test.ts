import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectEditSession, ProjectTouchedFile, RemoteEditStagedFileDiff } from '../../shared/types'

const state = vi.hoisted(() => {
  let commandHandler: ((command: string, data: Record<string, unknown>, reply: (event: unknown) => void) => void) | null = null
  const replies: unknown[] = []
  const runs: Array<{ sql: string; args: unknown[] }> = []
  const abortActiveStream = vi.fn()
  const dispatchChatSend = vi.fn()
  const webContentsSend = vi.fn()
  const broadcastToMobile = vi.fn()
  const listProjectAuditSessions = vi.fn<(projectId?: string | null) => ProjectEditSession[]>(() => [])
  const listProjectAuditFiles = vi.fn<(sessionId: string) => ProjectTouchedFile[]>(() => [])
  const getProjectAuditDiff = vi.fn<(sessionId: string, relativePath: string) => RemoteEditStagedFileDiff | null>(() => null)
  const getRemoteEditAuditDiff = vi.fn<(reportId: string, relativePath: string) => RemoteEditStagedFileDiff | null>(() => null)
  let projectConfigJson: string | null = null
  let errorReportRows: Record<string, unknown>[] = []
  const runAutomatedWorkflowGeneratorChatForAndroid = vi.fn()
  const getAutomatedWorkflowGeneratorModel = vi.fn(() => 'gpt-5.5')
  const setAutomatedWorkflowGeneratorModel = vi.fn()
  const deleteErrorReport = vi.fn<(reportId: string) => boolean>(() => true)
  const applyStagedPatchToWorkspace = vi.fn<
    (reportId: string) => { appliedFiles: string[]; backupPaths: string[] } | { error: string } | null
  >(() => null)
  const markStagedFileReviewed = vi.fn<(reportId: string, relativePath: string) => boolean>(() => false)

  return {
    get commandHandler() { return commandHandler },
    set commandHandler(handler) { commandHandler = handler },
    replies,
    runs,
    abortActiveStream,
    dispatchChatSend,
    webContentsSend,
    broadcastToMobile,
    listProjectAuditSessions,
    listProjectAuditFiles,
    getProjectAuditDiff,
    getRemoteEditAuditDiff,
    runAutomatedWorkflowGeneratorChatForAndroid,
    getAutomatedWorkflowGeneratorModel,
    setAutomatedWorkflowGeneratorModel,
    deleteErrorReport,
    applyStagedPatchToWorkspace,
    markStagedFileReviewed,
    get projectConfigJson() { return projectConfigJson },
    set projectConfigJson(value) { projectConfigJson = value },
    get errorReportRows() { return errorReportRows },
    set errorReportRows(value) { errorReportRows = value },
  }
})

vi.mock('../safe-handle', () => ({
  safeHandle: vi.fn(),
}))

vi.mock('../database', () => ({
  getDatabase: () => ({
    prepare: (sql: string) => ({
      all: (...args: unknown[]) => {
        if (sql.includes('FROM conversations c')) return [{ id: 'conv-1', title: 'Chat 1' }]
        if (sql.includes('FROM projects p')) return [{ id: 'proj-1', name: 'Project 1' }]
        if (sql.includes('FROM messages')) return [{ id: 'msg-1', role: 'user', content: 'hello', timestamp: 1 }]
        if (sql.includes('FROM agents')) return [{ id: 'agent-1', name: 'Codex', icon: 'C', backend: 'codex-cli', cli_model: 'gpt-5.5' }]
        if (sql.includes('FROM error_reports')) {
          if (sql.includes('WHERE project_id = ?')) {
            return state.errorReportRows.filter((row) => row.project_id === args[0])
          }
          return state.errorReportRows
        }
        return []
      },
      get: (..._args: unknown[]) => {
        if (sql.includes('SELECT config_json FROM projects WHERE id = ?')) return { config_json: state.projectConfigJson }
        if (sql.includes('FROM agents')) return { backend: 'codex-cli' }
        return undefined
      },
      run: (...args: unknown[]) => {
        state.runs.push({ sql, args })
        return { changes: 1 }
      },
    }),
  }),
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: vi.fn(() => false), webContents: { send: state.webContentsSend } }],
  },
}))

vi.mock('../providers', () => ({
  abortActiveStream: state.abortActiveStream,
  PROVIDERS: [
    { name: 'openai', label: 'OpenAI', models: ['gpt-5-mini'] },
    { name: 'anthropic', label: 'Anthropic', models: ['claude-haiku-4.5'] },
  ],
  isProviderConfigured: vi.fn((provider: string) => provider === 'openai'),
}))

vi.mock('../model-catalog', () => ({
  getCachedCatalog: vi.fn(() => [
    { id: 'gpt-5-mini', name: 'GPT-5 mini', vendor: 'OpenAI' },
    { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', vendor: 'Anthropic' },
  ]),
}))

vi.mock('../chat-handlers', () => ({
  dispatchChatSend: state.dispatchChatSend,
}))

vi.mock('../project-audit', () => ({
  listProjectAuditSessions: state.listProjectAuditSessions,
  listProjectAuditFiles: state.listProjectAuditFiles,
  getProjectAuditDiff: state.getProjectAuditDiff,
  getRemoteEditAuditDiff: state.getRemoteEditAuditDiff,
}))

vi.mock('../cli-detection', () => ({
  getCliModels: vi.fn((backend: string) => backend === 'codex-cli'
    ? [{ id: 'gpt-5.5', label: 'GPT-5.5' }]
    : [{ id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6' }]
  ),
}))

vi.mock('../auth', () => ({
  retrieveAuthMode: vi.fn(() => 'byok'),
}))

vi.mock('../android-handlers', () => ({
  getAndroidUpdateManifest: vi.fn(),
}))

vi.mock('../cli-adapters/claude', () => ({
  ClaudeAdapter: { isAvailable: vi.fn(() => false) },
}))

vi.mock('../cli-adapters/codex', () => ({
  CodexAdapter: { isAvailable: vi.fn(() => false) },
}))

vi.mock('../ws-server', () => ({
  startWsServer: vi.fn(),
  stopWsServer: vi.fn(),
  getWsStatus: vi.fn(() => ({ enabled: false })),
  getQrDataUrl: vi.fn(),
  regenerateToken: vi.fn(),
  broadcastToMobile: state.broadcastToMobile,
  setWsCommandHandler: vi.fn((handler) => { state.commandHandler = handler }),
}))

vi.mock('../scheduler-engine', () => ({
  dbListTasks: vi.fn(() => []),
  dbGetTask: vi.fn(() => null),
  dbCreateTask: vi.fn((input: Record<string, unknown>) => ({ id: 'task-1', ...input })),
  dbUpdateTask: vi.fn(() => null),
  dbDeleteTask: vi.fn(),
  dbSetTaskEnabled: vi.fn(() => null),
  dbListRuns: vi.fn(() => []),
  schedulerEngine: {
    scheduleTask: vi.fn(),
    unscheduleTask: vi.fn(),
    triggerRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
  },
}))

vi.mock('../automated-workflow-generator', () => ({
  runAutomatedWorkflowGeneratorChatForAndroid: state.runAutomatedWorkflowGeneratorChatForAndroid,
  getAutomatedWorkflowGeneratorModel: state.getAutomatedWorkflowGeneratorModel,
  setAutomatedWorkflowGeneratorModel: state.setAutomatedWorkflowGeneratorModel,
  normalizeAutomatedWorkflowSpec: (raw: Record<string, unknown>) => raw,
}))

vi.mock('../error-report-handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../error-report-handlers')>()
  return {
    ...actual,
    deleteErrorReport: state.deleteErrorReport,
  }
})

vi.mock('../remote-edit-handlers', () => ({
  applyStagedPatchToWorkspace: state.applyStagedPatchToWorkspace,
  markStagedFileReviewed: state.markStagedFileReviewed,
}))

import { registerWsHandlers, registerApprovalResolver } from '../ws-handlers'
import { retrieveAuthMode } from '../auth'
import { getAndroidUpdateManifest } from '../android-handlers'
import { isProviderConfigured } from '../providers'
import { ClaudeAdapter } from '../cli-adapters/claude'
import { CodexAdapter } from '../cli-adapters/codex'

function sendCommand(command: string, data: Record<string, unknown> = {}) {
  if (!state.commandHandler) throw new Error('WS command handler not registered')
  const reply = vi.fn((event: unknown) => state.replies.push(event))
  state.commandHandler(command, data, reply)
  return reply
}

describe('ws handlers', () => {
  beforeEach(() => {
    state.replies.length = 0
    state.runs.length = 0
    state.abortActiveStream.mockClear()
    state.dispatchChatSend.mockClear()
    state.dispatchChatSend.mockResolvedValue(undefined)
    state.webContentsSend.mockClear()
    state.broadcastToMobile.mockClear()
    state.projectConfigJson = null
    state.listProjectAuditSessions.mockReset()
    state.listProjectAuditSessions.mockReturnValue([])
    state.listProjectAuditFiles.mockReset()
    state.listProjectAuditFiles.mockReturnValue([])
    state.getProjectAuditDiff.mockReset()
    state.getProjectAuditDiff.mockReturnValue(null)
    state.getRemoteEditAuditDiff.mockReset()
    state.getRemoteEditAuditDiff.mockReturnValue(null)
    state.runAutomatedWorkflowGeneratorChatForAndroid.mockReset()
    state.runAutomatedWorkflowGeneratorChatForAndroid.mockResolvedValue(undefined)
    state.getAutomatedWorkflowGeneratorModel.mockReset()
    state.getAutomatedWorkflowGeneratorModel.mockReturnValue('gpt-5.5')
    state.setAutomatedWorkflowGeneratorModel.mockReset()
    state.deleteErrorReport.mockReset()
    state.deleteErrorReport.mockReturnValue(true)
    state.applyStagedPatchToWorkspace.mockReset()
    state.applyStagedPatchToWorkspace.mockReturnValue(null)
    state.markStagedFileReviewed.mockReset()
    state.markStagedFileReviewed.mockReturnValue(true)
    state.errorReportRows = []
    vi.mocked(retrieveAuthMode).mockReturnValue('byok')
    vi.mocked(getAndroidUpdateManifest).mockResolvedValue(null)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(false)
    vi.mocked(CodexAdapter.isAvailable).mockReturnValue(false)
    registerWsHandlers()
  })

  it('replies to the requesting client for conversation lists', () => {
    const reply = sendCommand('conversation:list')

    expect(reply).toHaveBeenCalledWith({
      event: 'conversation:list',
      data: [{ id: 'conv-1', title: 'Chat 1' }],
    })
  })

  it('replies to the requesting client for message history', () => {
    const reply = sendCommand('conversation:get-messages', { conversationId: 'conv-1' })

    expect(reply).toHaveBeenCalledWith({
      event: 'conversation:messages',
      data: {
        conversationId: 'conv-1',
        messages: [{ id: 'msg-1', role: 'user', content: 'hello', timestamp: 1 }],
      },
    })
  })

  it('replies to the requesting client when creating a conversation', () => {
    const reply = sendCommand('conversation:create', { agentId: 'agent-1', projectId: 'proj-1' })

    expect(state.runs).toHaveLength(1)
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      event: 'conversation:created',
      data: expect.objectContaining({ agentId: 'agent-1', projectId: 'proj-1', title: 'New Chat' }),
    }))
  })

  it('does not send request replies for approval and stop commands', () => {
    const resolve = vi.fn()
    registerApprovalResolver(resolve)

    const approvalReply = sendCommand('tool:approve', { requestId: 'req-1' })
    const stopReply = sendCommand('agent:stop', { conversationId: 'conv-1' })

    expect(resolve).toHaveBeenCalledWith('req-1', true)
    expect(state.abortActiveStream).toHaveBeenCalledWith('conv-1')
    expect(approvalReply).not.toHaveBeenCalled()
    expect(stopReply).not.toHaveBeenCalled()
  })

  it('dispatches remote chat without sending a request reply', () => {
    const reply = sendCommand('chat:send-message', {
      conversationId: 'conv-1',
      content: 'hello',
      agentId: 'agent-1',
      projectId: 'project-1',
    })

    expect(state.webContentsSend).toHaveBeenCalledWith('chat:remote-message', { conversationId: 'conv-1', content: 'hello', images: undefined })
    expect(state.dispatchChatSend).toHaveBeenCalledWith(
      expect.anything(),
      'conv-1',
      'hello',
      expect.objectContaining({ agentId: 'agent-1', projectId: 'project-1' }),
    )
    expect(reply).not.toHaveBeenCalled()
  })

  it('dispatches mobile image attachments to the desktop chat path', () => {
    const images = [{ id: 'img-1', name: 'photo.png', dataUrl: 'data:image/png;base64,abc123' }]
    const reply = sendCommand('chat:send-message', {
      conversationId: 'conv-1',
      content: '',
      images,
    })

    expect(state.webContentsSend).toHaveBeenCalledWith('chat:remote-message', { conversationId: 'conv-1', content: '', images })
    expect(state.dispatchChatSend).toHaveBeenCalledWith(
      expect.anything(),
      'conv-1',
      '',
      expect.objectContaining({ images }),
    )
    expect(reply).not.toHaveBeenCalled()
  })

  it('replies with configured BYOK provider models when no mobile backend is provided', () => {
    const reply = sendCommand('model:list')

    expect(reply).toHaveBeenCalledWith({
      event: 'model:list',
      data: {
        source: { type: 'provider', label: 'OpenAI' },
        models: [
          { id: 'default', label: 'Default model' },
          { id: 'gpt-5-mini', label: 'GPT-5 mini', vendor: 'OpenAI' },
        ],
      },
    })
  })

  it('falls back to installed Claude CLI models when no BYOK backend is active', () => {
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(isProviderConfigured).mockReturnValue(false)

    const reply = sendCommand('model:list')

    expect(reply).toHaveBeenCalledWith({
      event: 'model:list',
      data: {
        source: { type: 'provider', label: 'Claude CLI' },
        models: [
          { id: 'default', label: 'Default model' },
          { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6', vendor: 'Claude CLI', isCliSourced: true },
        ],
      },
    })
  })

  it('replies with Codex CLI models for Codex-backed mobile chats', () => {
    const reply = sendCommand('model:list', { backend: 'codex-cli' })

    expect(reply).toHaveBeenCalledWith({
      event: 'model:list',
      data: {
        source: { type: 'cli', label: 'Codex CLI models', backend: 'codex-cli' },
        models: [
          { id: 'default', label: 'Default model' },
          { id: 'gpt-5.5', label: 'GPT-5.5', vendor: 'Codex CLI', isCliSourced: true },
        ],
      },
    })
  })

  it('replies with CLI models using the mobile chat agent backend', () => {
    const reply = sendCommand('model:list', { agentId: 'agent-1' })

    expect(reply).toHaveBeenCalledWith({
      event: 'model:list',
      data: {
        source: { type: 'cli', label: 'Codex CLI models', backend: 'codex-cli' },
        models: [
          { id: 'default', label: 'Default model' },
          { id: 'gpt-5.5', label: 'GPT-5.5', vendor: 'Codex CLI', isCliSourced: true },
        ],
      },
    })
  })

  it('replies with Claude CLI models for Claude-backed mobile chats', () => {
    const reply = sendCommand('model:list', { backend: 'claude-cli' })

    expect(reply).toHaveBeenCalledWith({
      event: 'model:list',
      data: {
        source: { type: 'cli', label: 'Claude CLI models', backend: 'claude-cli' },
        models: [
          { id: 'default', label: 'Default model' },
          { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6', vendor: 'Claude CLI', isCliSourced: true },
        ],
      },
    })
  })

  it('marks CLI-sourced models with isCliSourced so standalone clients can filter them out', () => {
    const reply = sendCommand('model:list', { backend: 'claude-cli' })
    const models = (reply.mock.calls[0][0] as { data: { models: Array<{ id: string; isCliSourced?: boolean }> } }).data.models
    const cliModel = models.find((m) => m.id === 'claude-sonnet-4.6')
    const defaultModel = models.find((m) => m.id === 'default')

    expect(cliModel?.isCliSourced).toBe(true)
    expect(defaultModel?.isCliSourced).toBeUndefined()
  })

  it('updates a conversation model over mobile websocket', () => {
    const reply = sendCommand('conversation:set-model', { conversationId: 'conv-1', model: 'gpt-5.5' })

    expect(state.runs[0]).toEqual(expect.objectContaining({
      sql: expect.stringContaining('UPDATE conversations SET model'),
      args: ['gpt-5.5', expect.any(Number), 'conv-1'],
    }))
    expect(reply).toHaveBeenCalledWith({
      event: 'conversation:model-updated',
      data: { conversationId: 'conv-1', model: 'gpt-5.5' },
    })
  })

  it('serves the Android update manifest over the paired websocket', async () => {
    const manifest = {
      versionCode: 42,
      versionName: '1.2.3',
      commitSha: 'abc123',
      changelog: '',
      checksum: 'sha256',
      artifactUrl: 'http://192.168.1.100:12345/android/app-release.apk',
      publishedAt: 123456,
    }
    vi.mocked(getAndroidUpdateManifest).mockResolvedValue(manifest)

    const reply = sendCommand('android:update-manifest')
    await Promise.resolve()

    expect(reply).toHaveBeenCalledWith({
      event: 'android:update-manifest',
      data: manifest,
    })
  })

  it('returns null when no Android update manifest has been published', async () => {
    vi.mocked(getAndroidUpdateManifest).mockResolvedValue(null)

    const reply = sendCommand('android:update-manifest')
    await Promise.resolve()

    expect(reply).toHaveBeenCalledWith({
      event: 'android:update-manifest',
      data: null,
    })
  })

  it('replies with project audit sessions/files/diffs for mobile consumers', () => {
    state.listProjectAuditSessions.mockReturnValue([
      {
        id: 'session-1',
        projectId: 'proj-1',
        conversationId: null,
        agentId: null,
        title: 'Remote edit fix',
        source: 'remote-edit',
        createdAt: 1,
        updatedAt: 2,
        fileCount: 1,
      },
    ])
    state.listProjectAuditFiles.mockReturnValue([
      {
        sessionId: 'session-1',
        relativePath: 'src/example.ts',
        status: 'modified',
        lastOperation: 'apply',
        firstTouchedAt: 1,
        lastTouchedAt: 2,
        diffAvailable: true,
      },
    ])
    state.getProjectAuditDiff.mockReturnValue({
      relativePath: 'src/example.ts',
      hunks: [],
    })

    const sessionsReply = sendCommand('project-audit:list-sessions', { projectId: 'proj-1' })
    const filesReply = sendCommand('project-audit:list-files', { sessionId: 'session-1' })
    const diffReply = sendCommand('project-audit:get-diff', { sessionId: 'session-1', relativePath: 'src/example.ts' })

    expect(sessionsReply).toHaveBeenCalledWith({
      event: 'project-audit:sessions',
      data: {
        projectId: 'proj-1',
        sessions: expect.arrayContaining([expect.objectContaining({ id: 'session-1' })]),
      },
    })
    expect(filesReply).toHaveBeenCalledWith({
      event: 'project-audit:files',
      data: {
        sessionId: 'session-1',
        files: expect.arrayContaining([expect.objectContaining({ relativePath: 'src/example.ts' })]),
      },
    })
    expect(diffReply).toHaveBeenCalledWith({
      event: 'project-audit:diff',
      data: {
        sessionId: 'session-1',
        diff: { relativePath: 'src/example.ts', hunks: [] },
      },
    })
  })

  it('falls back to shared project audit diffs for mobile self-heal staged diff requests', () => {
    state.getRemoteEditAuditDiff.mockReturnValue({
      relativePath: 'src/example.ts',
      hunks: [{ header: '@@ -1,1 +1,1 @@', lines: [] }],
    })

    const reply = sendCommand('self-heal:get-staged-diff', { reportId: 'report-1', relativePath: 'src/example.ts' })

    expect(state.getRemoteEditAuditDiff).toHaveBeenCalledWith('report-1', 'src/example.ts')
    expect(reply).toHaveBeenCalledWith({
      event: 'self-heal:staged-diff',
      data: {
        reportId: 'report-1',
        relativePath: 'src/example.ts',
        hunks: [{ header: '@@ -1,1 +1,1 @@', lines: [] }],
      },
    })
  })

  it('marks a staged file reviewed for mobile self-heal requests, mirroring the desktop IPC path', () => {
    const reply = sendCommand('self-heal:mark-file-reviewed', { reportId: 'report-1', relativePath: 'src/example.ts' })

    expect(state.markStagedFileReviewed).toHaveBeenCalledWith('report-1', 'src/example.ts')
    expect(reply).toHaveBeenCalledWith({
      event: 'self-heal:file-reviewed-result',
      data: { reportId: 'report-1', relativePath: 'src/example.ts', reviewed: true },
    })
  })

  it('replies with the persisted history entry for a report, the source of truth for the Committed phase on mobile', () => {
    // getHistoryEntryForReport runs against the real (mocked-DB) history.ts module here — the
    // mocked getDatabase() has no matching handler for remote_edit_history SELECTs, so it
    // resolves to no row / entry: null. This exercises the WS command's wiring and reply shape,
    // not the SQL itself (covered with a real DB in remote-edit-history.test.ts).
    const reply = sendCommand('self-heal:get-history-for-report', { reportId: 'report-1' })

    expect(reply).toHaveBeenCalledWith({
      event: 'self-heal:history-for-report',
      data: { reportId: 'report-1', entry: null },
    })
  })

  it('filters self-heal:get-reports by projectId when provided', () => {
    state.errorReportRows = [
      { id: 'report-1', title: 'Report 1', status: 'open', created_at: 1, updated_at: 1, project_id: 'proj-1' },
      { id: 'report-2', title: 'Report 2', status: 'open', created_at: 2, updated_at: 2, project_id: 'proj-2' },
    ]

    const reply = sendCommand('self-heal:get-reports', { projectId: 'proj-1' })

    expect(reply).toHaveBeenCalledWith({
      event: 'self-heal:reports',
      data: { reports: expect.arrayContaining([expect.objectContaining({ id: 'report-1' })]) },
    })
    const [[sentEvent]] = reply.mock.calls
    expect((sentEvent as { data: { reports: unknown[] } }).data.reports).toHaveLength(1)
  })

  it('returns all reports for self-heal:get-reports when projectId is omitted', () => {
    state.errorReportRows = [
      { id: 'report-1', title: 'Report 1', status: 'open', created_at: 1, updated_at: 1, project_id: 'proj-1' },
      { id: 'report-2', title: 'Report 2', status: 'open', created_at: 2, updated_at: 2, project_id: 'proj-2' },
    ]

    const reply = sendCommand('self-heal:get-reports', {})

    const [[sentEvent]] = reply.mock.calls
    expect((sentEvent as { data: { reports: unknown[] } }).data.reports).toHaveLength(2)
  })

  it('scopes the direct reply for self-heal:set-report-status by projectId and broadcasts a lightweight change signal', () => {
    state.errorReportRows = [
      { id: 'report-1', title: 'Report 1', status: 'open', created_at: 1, updated_at: 1, project_id: 'proj-1' },
      { id: 'report-2', title: 'Report 2', status: 'open', created_at: 2, updated_at: 2, project_id: 'proj-2' },
    ]

    const reply = sendCommand('self-heal:set-report-status', { reportId: 'report-1', status: 'investigated', projectId: 'proj-1' })

    const [[sentEvent]] = reply.mock.calls
    expect((sentEvent as { data: { reports: unknown[] } }).data.reports).toHaveLength(1)
    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'self-heal:reports-changed',
      data: { reportId: 'report-1', status: 'investigated' },
    })
  })

  it('broadcasts a successful delete for self-heal:delete-report', () => {
    state.deleteErrorReport.mockReturnValue(true)

    sendCommand('self-heal:delete-report', { reportId: 'report-1' })

    expect(state.deleteErrorReport).toHaveBeenCalledWith('report-1')
    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'self-heal:report-deleted',
      data: { reportId: 'report-1', deleted: true },
    })
  })

  it('broadcasts an unambiguous failure for self-heal:delete-report when nothing was deleted', () => {
    state.deleteErrorReport.mockReturnValue(false)

    sendCommand('self-heal:delete-report', { reportId: 'missing-report' })

    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'self-heal:report-deleted',
      data: { reportId: 'missing-report', deleted: false },
    })
  })

  it('broadcasts an error for self-heal:delete-report when the handler throws', () => {
    state.deleteErrorReport.mockImplementation(() => {
      throw new Error('database is locked')
    })

    sendCommand('self-heal:delete-report', { reportId: 'report-1' })

    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'self-heal:report-deleted',
      data: { reportId: 'report-1', deleted: false, error: 'database is locked' },
    })
  })

  it('ignores self-heal:delete-report with no reportId', () => {
    sendCommand('self-heal:delete-report', {})

    expect(state.deleteErrorReport).not.toHaveBeenCalled()
    expect(state.broadcastToMobile).not.toHaveBeenCalled()
  })

  it('replies with applied files for self-heal:apply-staged-patch on success', () => {
    state.applyStagedPatchToWorkspace.mockReturnValue({
      appliedFiles: ['src/App.tsx'],
      backupPaths: ['/backups/report-1/src/App.tsx'],
    })

    const reply = sendCommand('self-heal:apply-staged-patch', { reportId: 'report-1' })

    expect(state.applyStagedPatchToWorkspace).toHaveBeenCalledWith('report-1')
    expect(reply).toHaveBeenCalledWith({
      event: 'self-heal:apply-result',
      data: {
        reportId: 'report-1',
        appliedFiles: ['src/App.tsx'],
        backupPaths: ['/backups/report-1/src/App.tsx'],
      },
    })
  })

  it('replies with an error for self-heal:apply-staged-patch when there is nothing staged', () => {
    state.applyStagedPatchToWorkspace.mockReturnValue(null)

    const reply = sendCommand('self-heal:apply-staged-patch', { reportId: 'report-1' })

    expect(reply).toHaveBeenCalledWith({
      event: 'self-heal:apply-result',
      data: { reportId: 'report-1', error: 'Nothing to apply' },
    })
  })

  it('replies with an error for self-heal:apply-staged-patch when applying fails', () => {
    state.applyStagedPatchToWorkspace.mockReturnValue({ error: 'permission denied' })

    const reply = sendCommand('self-heal:apply-staged-patch', { reportId: 'report-1' })

    expect(reply).toHaveBeenCalledWith({
      event: 'self-heal:apply-result',
      data: { reportId: 'report-1', error: 'permission denied' },
    })
  })

  it('replies with an error for self-heal:apply-staged-patch when the handler throws', () => {
    state.applyStagedPatchToWorkspace.mockImplementation(() => {
      throw new Error('disk full')
    })

    const reply = sendCommand('self-heal:apply-staged-patch', { reportId: 'report-1' })

    expect(reply).toHaveBeenCalledWith({
      event: 'self-heal:apply-result',
      data: { reportId: 'report-1', error: 'disk full' },
    })
  })

  it('ignores self-heal:apply-staged-patch with no reportId', () => {
    sendCommand('self-heal:apply-staged-patch', {})

    expect(state.applyStagedPatchToWorkspace).not.toHaveBeenCalled()
  })

  it('normalizes project:get-config workflow mode for mobile consumers, self-healing the pre-rename value', () => {
    state.projectConfigJson = '{"workflowMode":"manual-delegation","orchestrationEnabled":true}'

    const reply = sendCommand('project:get-config', { id: 'proj-1' })

    expect(reply).toHaveBeenCalledWith({
      event: 'project:config',
      data: {
        id: 'proj-1',
        config: expect.objectContaining({
          workflowMode: 'automated-delegation',
          orchestrationEnabled: false,
        }),
      },
    })
  })

  it('broadcasts normalized workflow config after mobile project:update-config', () => {
    state.projectConfigJson = '{"orchestrationEnabled":true}'

    sendCommand('project:update-config', { id: 'proj-1', workflowMode: 'automated-delegation' })

    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'project:config-updated',
      data: {
        id: 'proj-1',
        config: expect.objectContaining({
          workflowMode: 'automated-delegation',
          orchestrationEnabled: false,
        }),
      },
    })
  })

  it('starts the automated workflow generator for mobile consumers', () => {
    sendCommand('automated-workflow-generator:start', {
      projectId: 'proj-1',
      messages: [{ role: 'user', content: 'Plan the release' }],
      sessionId: 'mw-1',
    })

    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'automated-workflow-generator:model',
      data: { sessionId: 'mw-1', modelId: 'gpt-5.5' },
    })
    expect(state.runAutomatedWorkflowGeneratorChatForAndroid).toHaveBeenCalledWith(
      'proj-1',
      [{ role: 'user', content: 'Plan the release' }],
      'mw-1',
      undefined,
    )
  })

  it('updates the mobile automated workflow generator model', () => {
    sendCommand('automated-workflow-generator:set-model', { sessionId: 'mw-2', modelId: 'gpt-5.4-mini' })

    expect(state.setAutomatedWorkflowGeneratorModel).toHaveBeenCalledWith('gpt-5.4-mini')
    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'automated-workflow-generator:model',
      data: { sessionId: 'mw-2', modelId: 'gpt-5.5' },
    })
  })

  it('replies with every automated workflow run regardless of project for :list-all', () => {
    const reply = sendCommand('automated-workflow-runs:list-all')

    expect(reply).toHaveBeenCalledWith({ event: 'automated-workflow-runs:list-all', data: { runs: [] } })
  })

  it('treats a null/omitted projectId on :list as "project-less runs", not an error', () => {
    const reply = sendCommand('automated-workflow-runs:list', {})

    expect(reply).toHaveBeenCalledWith({
      event: 'automated-workflow-runs:list',
      data: { projectId: null, runs: [] },
    })
  })

  it('replies with saved workflow runs as schedule-attachment candidates', () => {
    const reply = sendCommand('scheduler:list-workflow-templates')

    expect(reply).toHaveBeenCalledWith({ event: 'scheduler:list-workflow-templates', data: { runs: [] } })
  })
})
