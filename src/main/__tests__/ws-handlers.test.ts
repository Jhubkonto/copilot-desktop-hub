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
  const runManualWorkflowGeneratorChatForAndroid = vi.fn()
  const getManualWorkflowGeneratorModel = vi.fn(() => 'gpt-5.5')
  const setManualWorkflowGeneratorModel = vi.fn()
  const deleteErrorReport = vi.fn<(reportId: string) => boolean>(() => true)
  const applyStagedPatchToWorkspace = vi.fn<
    (reportId: string) => { appliedFiles: string[]; backupPaths: string[] } | { error: string } | null
  >(() => null)

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
    runManualWorkflowGeneratorChatForAndroid,
    getManualWorkflowGeneratorModel,
    setManualWorkflowGeneratorModel,
    deleteErrorReport,
    applyStagedPatchToWorkspace,
    get projectConfigJson() { return projectConfigJson },
    set projectConfigJson(value) { projectConfigJson = value },
  }
})

vi.mock('../safe-handle', () => ({
  safeHandle: vi.fn(),
}))

vi.mock('../database', () => ({
  getDatabase: () => ({
    prepare: (sql: string) => ({
      all: (..._args: unknown[]) => {
        if (sql.includes('FROM conversations c')) return [{ id: 'conv-1', title: 'Chat 1' }]
        if (sql.includes('FROM projects p')) return [{ id: 'proj-1', name: 'Project 1' }]
        if (sql.includes('FROM messages')) return [{ id: 'msg-1', role: 'user', content: 'hello', timestamp: 1 }]
        if (sql.includes('FROM agents')) return [{ id: 'agent-1', name: 'Codex', icon: 'C', backend: 'codex-cli', cli_model: 'gpt-5.5' }]
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

vi.mock('../manual-workflow-generator', () => ({
  runManualWorkflowGeneratorChatForAndroid: state.runManualWorkflowGeneratorChatForAndroid,
  getManualWorkflowGeneratorModel: state.getManualWorkflowGeneratorModel,
  setManualWorkflowGeneratorModel: state.setManualWorkflowGeneratorModel,
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
    state.runManualWorkflowGeneratorChatForAndroid.mockReset()
    state.runManualWorkflowGeneratorChatForAndroid.mockResolvedValue(undefined)
    state.getManualWorkflowGeneratorModel.mockReset()
    state.getManualWorkflowGeneratorModel.mockReturnValue('gpt-5.5')
    state.setManualWorkflowGeneratorModel.mockReset()
    state.deleteErrorReport.mockReset()
    state.deleteErrorReport.mockReturnValue(true)
    state.applyStagedPatchToWorkspace.mockReset()
    state.applyStagedPatchToWorkspace.mockReturnValue(null)
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
          { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6', vendor: 'Claude CLI' },
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
          { id: 'gpt-5.5', label: 'GPT-5.5', vendor: 'Codex CLI' },
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
          { id: 'gpt-5.5', label: 'GPT-5.5', vendor: 'Codex CLI' },
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
          { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6', vendor: 'Claude CLI' },
        ],
      },
    })
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

  it('normalizes project:get-config workflow mode for mobile consumers', () => {
    state.projectConfigJson = '{"workflowMode":"manual-delegation","orchestrationEnabled":true}'

    const reply = sendCommand('project:get-config', { id: 'proj-1' })

    expect(reply).toHaveBeenCalledWith({
      event: 'project:config',
      data: {
        id: 'proj-1',
        config: expect.objectContaining({
          workflowMode: 'manual-delegation',
          orchestrationEnabled: false,
        }),
      },
    })
  })

  it('broadcasts normalized workflow config after mobile project:update-config', () => {
    state.projectConfigJson = '{"orchestrationEnabled":true}'

    sendCommand('project:update-config', { id: 'proj-1', workflowMode: 'manual-delegation' })

    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'project:config-updated',
      data: {
        id: 'proj-1',
        config: expect.objectContaining({
          workflowMode: 'manual-delegation',
          orchestrationEnabled: false,
        }),
      },
    })
  })

  it('starts the manual workflow generator for mobile consumers', () => {
    sendCommand('manual-workflow-generator:start', {
      projectId: 'proj-1',
      messages: [{ role: 'user', content: 'Plan the release' }],
      sessionId: 'mw-1',
    })

    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'manual-workflow-generator:model',
      data: { sessionId: 'mw-1', modelId: 'gpt-5.5' },
    })
    expect(state.runManualWorkflowGeneratorChatForAndroid).toHaveBeenCalledWith(
      'proj-1',
      [{ role: 'user', content: 'Plan the release' }],
      'mw-1',
      undefined,
    )
  })

  it('updates the mobile manual workflow generator model', () => {
    sendCommand('manual-workflow-generator:set-model', { sessionId: 'mw-2', modelId: 'gpt-5.4-mini' })

    expect(state.setManualWorkflowGeneratorModel).toHaveBeenCalledWith('gpt-5.4-mini')
    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'manual-workflow-generator:model',
      data: { sessionId: 'mw-2', modelId: 'gpt-5.5' },
    })
  })
})
