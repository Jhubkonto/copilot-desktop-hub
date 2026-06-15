/**
 * Mock for window.api (preload bridge) used in renderer tests.
 * Call setupMockApi() in beforeEach to attach to globalThis.window.
 */
import { vi } from 'vitest'

export type MockApi = ReturnType<typeof createMockApi>

export function createMockApi() {
  return {
    platform: 'win32',

    // Settings
    getSettings: vi.fn().mockResolvedValue({}),
    getSetting: vi.fn().mockResolvedValue(null),
    setSetting: vi.fn().mockResolvedValue(undefined),
    getTheme: vi.fn().mockResolvedValue('dark'),
    setTheme: vi.fn().mockResolvedValue(undefined),
    getVersion: vi.fn().mockResolvedValue('0.1.0'),
    setDebugEnabled: vi.fn().mockResolvedValue(true),
    onDebugLog: vi.fn().mockReturnValue(() => {}),
    getErrorLogPath: vi.fn().mockResolvedValue(null),
    getRecentErrors: vi.fn().mockResolvedValue([]),
    getRendererConsoleErrors: vi.fn().mockResolvedValue([]),
    clearErrors: vi.fn().mockResolvedValue(true),
    captureErrorReport: vi.fn().mockResolvedValue({
      reportId: 'report-1',
      screenshotPath: null,
      createdAt: 1000,
    }),
    getErrorReport: vi.fn().mockResolvedValue(null),
    listErrorReports: vi.fn().mockResolvedValue([]),
    getInvestigationSettings: vi.fn().mockResolvedValue({
      backend: 'byok',
      model: 'gpt-5-mini',
      retryLimit: 1,
      autoApproveTools: true,
    }),
    setInvestigationSettings: vi.fn().mockImplementation(async (input) => input),
    setSelfHealReportStatus: vi.fn().mockResolvedValue(null),
    startInvestigation: vi.fn().mockResolvedValue({ reportId: 'report-1' }),
    onInvestigationActivity: vi.fn().mockReturnValue(() => {}),
    onInvestigationChunk: vi.fn().mockReturnValue(() => {}),
    onInvestigationDone: vi.fn().mockReturnValue(() => {}),
    onErrorLogEntry: vi.fn().mockReturnValue(() => {}),

    // Auth
    authStatus: vi.fn().mockResolvedValue({
      authenticated: false,
      mode: 'none',
      user: null,
      cliInstalled: false,
      clis: { claude: false, codex: false },
    }),
    authLoginByok: vi.fn().mockResolvedValue({ success: true }),
    authLogout: vi.fn().mockResolvedValue(undefined),

    // CLI
    checkCli: vi.fn().mockResolvedValue({ installed: false, path: null, version: null }),
    getCliStatus: vi.fn().mockResolvedValue({ installed: false, path: null, version: null }),
    detectAllClis: vi.fn().mockResolvedValue({}),
    getCliModels: vi.fn().mockResolvedValue([
      { id: 'gpt-5.5', label: 'GPT-5.5' },
      { id: 'gpt-5.4', label: 'GPT-5.4' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4-Mini' },
    ]),

    // Chat
    sendMessage: vi.fn().mockResolvedValue(undefined),
    onRemoteMessage: vi.fn().mockReturnValue(() => {}),
    onStreamResponse: vi.fn().mockReturnValue(() => {}),
    onStreamError: vi.fn().mockReturnValue(() => {}),
    onToolCallEvent: vi.fn().mockReturnValue(() => {}),
    onCliToolStart: vi.fn().mockReturnValue(() => {}),
    onCliToolEnd: vi.fn().mockReturnValue(() => {}),
    onCliCost: vi.fn().mockReturnValue(() => {}),
    onActivity: vi.fn().mockReturnValue(() => {}),
    onStreamModel: vi.fn().mockReturnValue(() => {}),
    stopGeneration: vi.fn().mockResolvedValue(undefined),
    onAutoClipboardFocus: vi.fn().mockReturnValue(() => {}),

    // Conversations
    listConversations: vi.fn().mockResolvedValue([]),
    createConversation: vi.fn().mockResolvedValue({ id: 'conv-1' }),
    getConversationCompressionPreview: vi.fn().mockResolvedValue({
      conversation_id: 'conv-1',
      has_summary: false,
      summarized_message_count: 0,
      retained_message_count: 0,
      omitted_message_count: 0,
      estimated_tokens_before: 0,
      target_budget: 0,
      strategy: null,
      updated_at: null,
      sections: null,
    }),
    prepareConversationCompressionSummary: vi.fn().mockResolvedValue({
      conversation_id: 'conv-1',
      summarized_message_count: 0,
      retained_message_count: 0,
      omitted_message_count: 0,
      estimated_tokens_before: 0,
      target_budget: 0,
      strategy: 'manual-structured-summary-plus-recent-turns',
      sections: {
        goals: [],
        decisions: [],
        constraints: [],
        filesTouched: [],
        commandsRun: [],
        openQuestions: [],
        nextActions: [],
        recentContextNotes: [],
      },
    }),
    saveConversationCompressionSummary: vi.fn().mockImplementation(async (input) => ({
      conversation_id: input.conversationId,
      has_summary: true,
      summarized_message_count: input.summarizedMessageCount,
      retained_message_count: input.retainedMessageCount,
      omitted_message_count: 0,
      estimated_tokens_before: input.estimatedTokensBefore,
      target_budget: input.targetBudget,
      strategy: input.strategy,
      updated_at: 1000,
      sections: input.sections,
    })),
    deleteConversation: vi.fn().mockResolvedValue(true),
    exportConversationJson: vi.fn().mockResolvedValue({
      schema: 'nexy.conversation.v1',
      exported_at: 1000,
      conversation: { id: 'conv-1', agent_id: null, project_id: null, title: 'Conversation', model: null, pinned: 0, created_at: 1000, updated_at: 1000 },
      project: null,
      agent: null,
      messages: [],
    }),
    exportConversationPack: vi.fn().mockResolvedValue({
      format: 'json',
      conversation_id: 'conv-1',
      file_name: 'Conversation.nexy-conversation.json',
      mime_type: 'application/json',
      content: '{}\n',
    }),
    forkConversation: vi.fn().mockResolvedValue({
      conversation: { id: 'conv-forked', agent_id: null, project_id: null, title: 'Continued: Conversation', model: 'gpt-5.5', pinned: 0, created_at: 1000, updated_at: 1000 },
      message_count: 0,
      rewritten_message_count: 0,
      compressed_message_count: 0,
    }),
    importConversationJson: vi.fn().mockResolvedValue({
      conversation: { id: 'conv-imported', agent_id: null, project_id: null, title: 'Imported: Conversation', model: null, pinned: 0, created_at: 1000, updated_at: 1000 },
      message_count: 0,
      imported_into_existing: false,
    }),
    getMessages: vi.fn().mockResolvedValue([]),
    searchConversations: vi.fn().mockResolvedValue([]),
    renameConversation: vi.fn().mockResolvedValue(undefined),
    setConversationModel: vi.fn().mockResolvedValue(true),
    setConversationPinned: vi.fn().mockResolvedValue(true),
    updateConversationContext: vi.fn().mockResolvedValue(true),

    // Messages
    deleteMessage: vi.fn().mockResolvedValue(true),
    deleteMessagesAfter: vi.fn().mockResolvedValue(true),

    // Files
    openFileDialog: vi.fn().mockResolvedValue([]),
    getWorkingDirectory: vi.fn().mockResolvedValue('C:\\'),
    setWorkingDirectory: vi.fn().mockResolvedValue(true),
    readContextFile: vi.fn().mockResolvedValue({ path: 'README.md', content: 'context', truncated: false }),
    getWorkspaceSummary: vi.fn().mockResolvedValue('workspace summary'),
    getGitContext: vi.fn().mockResolvedValue('branch: main'),

    // Agents
    listAgents: vi.fn().mockResolvedValue([]),
    getAgent: vi.fn().mockResolvedValue(null),
    createAgent: vi.fn().mockResolvedValue({ id: 'agent-1' }),
    updateAgent: vi.fn().mockResolvedValue(true),
    deleteAgentPreflight: vi.fn().mockResolvedValue({ affectedProjects: [], affectedConvCount: 0 }),
    deleteAgent: vi.fn().mockResolvedValue({ success: true, affectedProjects: [], affectedConvCount: 0 }),
    duplicateAgent: vi.fn().mockResolvedValue({ id: 'agent-2' }),
    exportAgent: vi.fn().mockResolvedValue(true),
    importAgent: vi.fn().mockResolvedValue(null),

    // Knowledge files
    listKnowledgeFiles: vi.fn().mockResolvedValue([]),
    addKnowledgeFile: vi.fn().mockResolvedValue({
      id: 'kf-1', agent_id: 'agent-1', file_path: '/docs/notes.md',
      inject_mode: 'always', sort_order: 0, created_at: 1000, updated_at: 1000
    }),
    removeKnowledgeFile: vi.fn().mockResolvedValue(true),
    updateKnowledgeInjectMode: vi.fn().mockResolvedValue(true),
    readKnowledgeFile: vi.fn().mockResolvedValue('# File Content'),
    writeKnowledgeFile: vi.fn().mockResolvedValue(true),

    // Directories
    openDirectoryDialog: vi.fn().mockResolvedValue(null),
    getRecentDirs: vi.fn().mockResolvedValue([]),
    addRecentDir: vi.fn().mockResolvedValue([]),

    // Models
    listModelCatalog: vi.fn().mockResolvedValue([]),
    listAvailableModels: vi.fn().mockResolvedValue([]),
    onCatalogUpdated: vi.fn().mockReturnValue(() => {}),

    // Tools
    listTools: vi.fn().mockResolvedValue([]),
    executeTool: vi.fn().mockResolvedValue(null),
    respondToToolApproval: vi.fn().mockResolvedValue(undefined),
    setToolPreference: vi.fn().mockResolvedValue(undefined),
    getToolPreferences: vi.fn().mockResolvedValue({}),
    onToolApprovalRequest: vi.fn().mockReturnValue(() => {}),

    // MCP
    listMcpServers: vi.fn().mockResolvedValue([]),
    addMcpServer: vi.fn().mockResolvedValue({ id: 'mcp-1' }),
    updateMcpServer: vi.fn().mockResolvedValue(true),
    removeMcpServer: vi.fn().mockResolvedValue(true),
    getMcpServerStatus: vi.fn().mockResolvedValue({ connected: false }),
    listMcpTools: vi.fn().mockResolvedValue([]),
    listMcpToolsForAgent: vi.fn().mockResolvedValue([]),
    getMcpToolOverrides: vi.fn().mockResolvedValue([]),
    setMcpToolOverride: vi.fn().mockResolvedValue(true),
    callMcpTool: vi.fn().mockResolvedValue(null),
    restartMcpServer: vi.fn().mockResolvedValue(true),

    // Providers
    listProviders: vi.fn().mockResolvedValue([]),
    setProviderKey: vi.fn().mockResolvedValue(undefined),
    removeProviderKey: vi.fn().mockResolvedValue(undefined),
    hasProviderKey: vi.fn().mockResolvedValue(false),
    testProviderKey: vi.fn().mockResolvedValue({ success: true }),
    getAzureEndpoint: vi.fn().mockResolvedValue(''),
    setAzureEndpoint: vi.fn().mockResolvedValue(undefined),

    // Prompt Library
    listPrompts: vi.fn().mockResolvedValue([]),
    listPromptVersions: vi.fn().mockResolvedValue([]),
    createPrompt: vi.fn().mockImplementation(async (input) => ({
      id: 'prompt-1',
      title: input.title,
      body: input.body,
      description: input.description ?? '',
      category: input.category ?? 'Custom',
      tags: input.tags ?? [],
      variables: [],
      scope: input.scope ?? 'global',
      project_id: input.project_id ?? null,
      created_at: 1000,
      updated_at: 1000,
    })),
    updatePrompt: vi.fn().mockImplementation(async (id, input) => ({
      id,
      title: input.title ?? 'Prompt',
      body: input.body ?? '',
      description: input.description ?? '',
      category: input.category ?? 'Custom',
      tags: input.tags ?? [],
      variables: [],
      scope: input.scope ?? 'global',
      project_id: input.project_id ?? null,
      created_at: 1000,
      updated_at: 1000,
    })),
    rollbackPrompt: vi.fn().mockResolvedValue({
      id: 'prompt-1',
      title: 'Prompt',
      body: 'Body',
      description: '',
      category: 'Custom',
      tags: [],
      variables: [],
      scope: 'global',
      project_id: null,
      created_at: 1000,
      updated_at: 1000,
    }),
    deletePrompt: vi.fn().mockResolvedValue(true),

    // Auto-start
    setAutoStart: vi.fn().mockResolvedValue(undefined),
    saveTextFile: vi.fn().mockResolvedValue('C:\\conversation.md'),
    createGist: vi.fn().mockResolvedValue('https://gist.github.com/example/abc123'),

    // Updates
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    installUpdate: vi.fn().mockResolvedValue(undefined),
    onUpdateAvailable: vi.fn().mockReturnValue(() => {}),
    onUpdateDownloaded: vi.fn().mockReturnValue(() => {}),

    // System events
    onNewChat: vi.fn().mockReturnValue(() => {}),

    // Projects
    listProjects: vi.fn().mockResolvedValue([]),
    createProject: vi.fn().mockResolvedValue({ id: 'proj-1' }),
    renameProject: vi.fn().mockResolvedValue(true),
    deleteProject: vi.fn().mockResolvedValue(true),
    duplicateProject: vi.fn().mockResolvedValue({ id: 'proj-2' }),
    exportProject: vi.fn().mockResolvedValue(true),
    setConversationProject: vi.fn().mockResolvedValue(true),
    setProjectDefaultModel: vi.fn().mockResolvedValue(true),

    // Project Agents
    listProjectAgents: vi.fn().mockResolvedValue([]),
    addAgentToProject: vi.fn().mockResolvedValue(true),
    removeAgentFromProject: vi.fn().mockResolvedValue(true),
    setProjectPrimaryAgent: vi.fn().mockResolvedValue(true),
    reorderProjectAgents: vi.fn().mockResolvedValue(true),
    updateProjectConfig: vi.fn().mockResolvedValue(true),
    getProjectConfig: vi.fn().mockResolvedValue({}),
    listWikiEntries: vi.fn().mockResolvedValue([]),
    createWikiEntry: vi.fn().mockResolvedValue({
      id: 'wiki-1',
      project_id: 'proj-1',
      title: 'Wiki entry',
      body: 'Body',
      tags: [],
      source_conversation_id: null,
      source_message_id: null,
      superseded_by: null,
      created_at: 1000,
      updated_at: 1000,
    }),
    updateWikiEntry: vi.fn().mockResolvedValue({
      id: 'wiki-1',
      project_id: 'proj-1',
      title: 'Wiki entry',
      body: 'Body',
      tags: [],
      source_conversation_id: null,
      source_message_id: null,
      superseded_by: null,
      created_at: 1000,
      updated_at: 1000,
    }),
    deleteWikiEntry: vi.fn().mockResolvedValue(true),
    extractWikiLearnings: vi.fn().mockResolvedValue({ candidates: [] }),
    onTeamActivity: vi.fn().mockReturnValue(() => {}),
    onTeamStepStream: vi.fn().mockReturnValue(() => {}),
    onWikiInjected: vi.fn().mockReturnValue(() => {}),

    // Local update feed
    buildGetFeedInfo: vi.fn().mockResolvedValue(null),
    buildSetFeedPath: vi.fn().mockResolvedValue({ feedPath: '/tmp/feed', feedUrl: 'http://127.0.0.1:12345', port: 12345, running: true }),
    buildPublishUpdate: vi.fn().mockResolvedValue({ published: true, version: '0.9.0' }),
    buildListPublished: vi.fn().mockResolvedValue([]),
    buildRollbackUpdate: vi.fn().mockResolvedValue({ launched: true }),

    // Build orchestrator
    buildGetWorkspaceInfo: vi.fn().mockResolvedValue({
      path: 'C:\\project',
      branch: 'main',
      commitSha: 'abc1234',
      dirty: false,
      version: '0.9.0',
      isGitRepo: true,
    }),
    buildSetWorkspacePath: vi.fn().mockResolvedValue({
      path: 'C:\\project',
      branch: 'main',
      commitSha: 'abc1234',
      dirty: false,
      version: '0.9.0',
      isGitRepo: true,
    }),
    buildStartCommand: vi.fn().mockResolvedValue({ buildId: 'build-1' }),
    buildCancelCommand: vi.fn().mockResolvedValue(true),
    buildGetRecords: vi.fn().mockResolvedValue([]),
    buildRunPreflight: vi.fn().mockResolvedValue({ checks: [] }),
    buildLaunchDev: vi.fn().mockResolvedValue({ launched: true }),
    onBuildLogChunk: vi.fn().mockReturnValue(() => {}),
    onBuildCommandDone: vi.fn().mockReturnValue(() => {}),

    // Window controls
    minimizeWindow: vi.fn().mockResolvedValue(undefined),
    maximizeWindow: vi.fn().mockResolvedValue(undefined),
    closeWindow: vi.fn().mockResolvedValue(undefined),
    isWindowMaximized: vi.fn().mockResolvedValue(false),
    editAction: vi.fn().mockResolvedValue(undefined),
    zoomIn: vi.fn().mockResolvedValue(undefined),
    zoomOut: vi.fn().mockResolvedValue(undefined),
    resetZoom: vi.fn().mockResolvedValue(undefined),
    onMaximizeChange: vi.fn().mockReturnValue(() => {}),
    captureScreen: vi.fn().mockResolvedValue({ dataUrl: 'data:image/png;base64,capture' }),
    checkScreenPermission: vi.fn().mockResolvedValue('granted'),
    readClipboardContent: vi.fn().mockResolvedValue(null),
    readClipboardImage: vi.fn().mockResolvedValue(null),
    ocrImage: vi.fn().mockResolvedValue({ text: '' }),

    // Android build and distribution
    androidGetWorkspaceInfo: vi.fn().mockResolvedValue({ path: '', branch: 'main', commitSha: 'abc1234', dirty: false, versionCode: 1, versionName: '1.0', isGitRepo: true }),
    androidSetWorkspacePath: vi.fn().mockResolvedValue({ path: '', branch: 'main', commitSha: 'abc1234', dirty: false, versionCode: 1, versionName: '1.0', isGitRepo: true }),
    androidStartCommand: vi.fn().mockResolvedValue({ buildId: 'android-build-1' }),
    androidCancelCommand: vi.fn().mockResolvedValue(true),
    androidGetRecords: vi.fn().mockResolvedValue([]),
    androidGetSigningConfig: vi.fn().mockResolvedValue(null),
    androidSetSigningConfig: vi.fn().mockResolvedValue(true),
    androidValidateSigningConfig: vi.fn().mockResolvedValue({ valid: true, checks: [] }),
    androidListAdbDevices: vi.fn().mockResolvedValue([]),
    androidInstallApk: vi.fn().mockResolvedValue({ success: true }),
    androidPublishUpdate: vi.fn().mockResolvedValue({ published: true }),
    androidGetUpdateManifest: vi.fn().mockResolvedValue(null),
    onAndroidLogChunk: vi.fn().mockReturnValue(() => {}),
    onAndroidCommandDone: vi.fn().mockReturnValue(() => {}),
  }
}

/**
 * Installs mock api on window.api for renderer tests.
 * Returns the mock for assertions.
 */
export function setupMockApi(): MockApi {
  const api = createMockApi()
  Object.defineProperty(window, 'api', {
    value: api,
    writable: true,
    configurable: true
  })
  return api
}
