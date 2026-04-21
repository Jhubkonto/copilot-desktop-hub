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

    // Auth
    authStatus: vi.fn().mockResolvedValue({ authenticated: false, user: null }),
    authLogin: vi.fn().mockResolvedValue({ success: true, user: { login: 'testuser', avatar_url: 'https://example.com/avatar.png', name: 'Test User' } }),
    authLogout: vi.fn().mockResolvedValue(undefined),
    onDeviceCode: vi.fn().mockReturnValue(() => {}),

    // Chat
    sendMessage: vi.fn().mockResolvedValue(undefined),
    onStreamResponse: vi.fn().mockReturnValue(() => {}),
    onStreamError: vi.fn().mockReturnValue(() => {}),
    stopGeneration: vi.fn().mockResolvedValue(undefined),

    // Conversations
    listConversations: vi.fn().mockResolvedValue([]),
    createConversation: vi.fn().mockResolvedValue({ id: 'conv-1' }),
    deleteConversation: vi.fn().mockResolvedValue(true),
    getMessages: vi.fn().mockResolvedValue([]),
    searchConversations: vi.fn().mockResolvedValue([]),
    renameConversation: vi.fn().mockResolvedValue(undefined),
    setConversationModel: vi.fn().mockResolvedValue(true),
    setConversationPinned: vi.fn().mockResolvedValue(true),

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
    deleteAgent: vi.fn().mockResolvedValue(true),
    duplicateAgent: vi.fn().mockResolvedValue({ id: 'agent-2' }),
    exportAgent: vi.fn().mockResolvedValue(true),
    importAgent: vi.fn().mockResolvedValue(null),

    // Directories
    openDirectoryDialog: vi.fn().mockResolvedValue(null),

    // Tools
    listTools: vi.fn().mockResolvedValue([]),
    executeTool: vi.fn().mockResolvedValue(null),
    respondToToolApproval: vi.fn().mockResolvedValue(undefined),
    setToolPreference: vi.fn().mockResolvedValue(undefined),
    getToolPreferences: vi.fn().mockResolvedValue({}),
    onToolApprovalRequest: vi.fn().mockReturnValue(() => {}),

    // Terminal
    createTerminal: vi.fn().mockResolvedValue(undefined),
    writeTerminal: vi.fn().mockResolvedValue(undefined),
    disposeTerminal: vi.fn().mockResolvedValue(undefined),
    onTerminalData: vi.fn().mockReturnValue(() => {}),
    onTerminalExit: vi.fn().mockReturnValue(() => {}),

    // MCP
    listMcpServers: vi.fn().mockResolvedValue([]),
    addMcpServer: vi.fn().mockResolvedValue({ id: 'mcp-1' }),
    updateMcpServer: vi.fn().mockResolvedValue(true),
    removeMcpServer: vi.fn().mockResolvedValue(true),
    getMcpServerStatus: vi.fn().mockResolvedValue({ connected: false }),
    listMcpTools: vi.fn().mockResolvedValue([]),
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
