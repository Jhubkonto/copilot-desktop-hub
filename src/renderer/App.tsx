import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatWindow } from './components/ChatWindow'
import { ToolApproval } from './components/ToolApproval'

const AgentPanel = lazy(() =>
  import('./components/AgentPanel').then((m) => ({ default: m.AgentPanel }))
)
const TerminalPanel = lazy(() =>
  import('./components/TerminalPanel').then((m) => ({ default: m.TerminalPanel }))
)
const McpServerPanel = lazy(() =>
  import('./components/McpServerPanel').then((m) => ({ default: m.McpServerPanel }))
)
const SettingsPanel = lazy(() =>
  import('./components/SettingsPanel').then((m) => ({ default: m.SettingsPanel }))
)
const OnboardingModal = lazy(() =>
  import('./components/OnboardingModal').then((m) => ({ default: m.OnboardingModal }))
)

interface Conversation {
  id: string
  agent_id: string | null
  title: string
  created_at: number
  updated_at: number
}

interface AgentConfig {
  id: string
  name: string
  icon: string
  systemPrompt: string
  model: string
  temperature: number
  maxTokens: number
  contextDirectories: string[]
  contextFiles: string[]
  mcpServers: string[]
  agenticMode: boolean
  tools: { fileEdit: boolean; terminal: boolean; webFetch: boolean }
  responseFormat: string
  isDefault?: boolean
}

interface AuthState {
  authenticated: boolean
  user: { login: string; avatar_url: string; name: string | null } | null
}

interface CliState {
  installed: boolean
  path: string | null
  version: string | null
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [authState, setAuthState] = useState<AuthState>({ authenticated: false, user: null })
  const [cliState, setCliState] = useState<CliState | null>(null)
  const [agents, setAgents] = useState<AgentConfig[]>([])
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)
  const [showAgentPanel, setShowAgentPanel] = useState(false)
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null)
  const [showTerminal, setShowTerminal] = useState(false)
  const [showMcpPanel, setShowMcpPanel] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState<{ version: string } | null>(null)
  const [updateDownloaded, setUpdateDownloaded] = useState(false)
  const [toolApprovalRequests, setToolApprovalRequests] = useState<
    { requestId: string; tool: string; args: Record<string, unknown>; description: string }[]
  >([])

  // Listen for tool approval requests
  useEffect(() => {
    const unsubscribe = window.api.onToolApprovalRequest(
      (data: { requestId: string; tool: string; args: Record<string, unknown>; description: string }) => {
        setToolApprovalRequests((prev) => [...prev, data])
      }
    )
    return () => { unsubscribe() }
  }, [])

  // Listen for auto-update events
  useEffect(() => {
    const unsub1 = window.api.onUpdateAvailable((info: { version: string }) => {
      setUpdateAvailable(info)
    })
    const unsub2 = window.api.onUpdateDownloaded(() => {
      setUpdateDownloaded(true)
    })
    return () => { unsub1(); unsub2() }
  }, [])

  // Load persisted theme on mount
  useEffect(() => {
    window.api.getTheme().then((savedTheme: string) => {
      const t = savedTheme === 'light' ? 'light' : 'dark'
      setTheme(t)
      document.documentElement.classList.toggle('dark', t === 'dark')
    })
  }, [])

  // Check auth status and CLI on mount
  useEffect(() => {
    window.api.authStatus().then(setAuthState)
    window.api.cliStatus().then(setCliState)
    // Check if onboarding is completed
    window.api.getSetting('onboarding_complete').then((val: string | null) => {
      if (val !== 'true') setShowOnboarding(true)
    })
  }, [])

  // Load conversations
  const loadConversations = useCallback(() => {
    window.api.listConversations().then(setConversations)
  }, [])

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  // Load agents
  const loadAgents = useCallback(() => {
    window.api.listAgents().then(setAgents)
  }, [])

  useEffect(() => {
    loadAgents()
  }, [loadAgents])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.classList.toggle('dark', next === 'dark')
    window.api.setTheme(next)
  }

  const handleNewChat = () => {
    setCurrentConversationId(null)
  }

  const handleConversationCreated = (id: string) => {
    setCurrentConversationId(id)
    setTimeout(loadConversations, 200)
  }

  const handleDeleteConversation = async (id: string) => {
    await window.api.deleteConversation(id)
    if (currentConversationId === id) {
      setCurrentConversationId(null)
    }
    loadConversations()
  }

  const handleLogin = async () => {
    const result = await window.api.authLogin()
    if (result.success) {
      setAuthState({ authenticated: true, user: result.user ?? null })
    }
  }

  const handleLogout = async () => {
    await window.api.authLogout()
    setAuthState({ authenticated: false, user: null })
  }

  // Agent panel handlers
  const handleCreateAgent = () => {
    setEditingAgentId(null)
    setShowAgentPanel(true)
  }

  const handleEditAgent = (id: string) => {
    setEditingAgentId(id)
    setShowAgentPanel(true)
  }

  const handleSaveAgent = async (config: AgentConfig) => {
    if (config.id && editingAgentId) {
      await window.api.updateAgent(config.id, config)
    } else {
      const result = await window.api.createAgent(config)
      if (result && !activeAgentId) {
        setActiveAgentId(result.id)
      }
    }
    loadAgents()
    setShowAgentPanel(false)
  }

  const handleDeleteAgent = async (id: string) => {
    const success = await window.api.deleteAgent(id)
    if (success) {
      if (activeAgentId === id) setActiveAgentId(null)
      loadAgents()
      setShowAgentPanel(false)
    }
  }

  const handleDuplicateAgent = async (id: string) => {
    await window.api.duplicateAgent(id)
    loadAgents()
    setShowAgentPanel(false)
  }

  const handleExportAgent = async (id: string) => {
    await window.api.exportAgent(id)
  }

  const handleImportAgent = async () => {
    const result = await window.api.importAgent()
    if (result) loadAgents()
  }

  const handleToolApprovalRespond = async (
    requestId: string,
    approved: boolean,
    remember: boolean
  ) => {
    await window.api.respondToToolApproval(requestId, approved, remember)
    setToolApprovalRequests((prev) => prev.filter((r) => r.requestId !== requestId))
  }

  const editingAgent = editingAgentId ? agents.find((a) => a.id === editingAgentId) ?? null : null
  const activeAgent = activeAgentId ? agents.find((a) => a.id === activeAgentId) ?? null : null

  return (
    <div className={`flex h-screen w-screen ${theme === 'dark' ? 'dark' : ''}`} role="application">
      <Sidebar
        currentConversationId={currentConversationId}
        conversations={conversations}
        onSelectConversation={(id) => {
          setCurrentConversationId(id)
        }}
        onNewChat={handleNewChat}
        onDeleteConversation={handleDeleteConversation}
        onRefresh={loadConversations}
        authState={authState}
        onLogin={handleLogin}
        onLogout={handleLogout}
        agents={agents}
        activeAgentId={activeAgentId}
        onSelectAgent={setActiveAgentId}
        onEditAgent={handleEditAgent}
        onCreateAgent={handleCreateAgent}
        onImportAgent={handleImportAgent}
      />
      <main className="flex-1 flex flex-col bg-white dark:bg-gray-900" role="main">
        <header className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700" role="banner">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              Copilot Desktop Hub
            </h1>
            {activeAgent && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800" aria-label={`Active agent: ${activeAgent.name}`}>
                {activeAgent.icon} {activeAgent.name}
              </span>
            )}
            {cliState && !cliState.installed && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300">
                Copilot CLI not found
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(true)}
              className="text-xs px-3 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              title="Settings"
              aria-label="Open settings"
            >
              ⚙️ Settings
            </button>
          </div>
        </header>

        {/* Update notification banner */}
        {updateAvailable && !updateDownloaded && (
          <div className="mx-4 mt-2 p-2 rounded-lg bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 flex items-center justify-between" role="alert">
            <p className="text-xs text-blue-700 dark:text-blue-300">
              Update v{updateAvailable.version} is available
            </p>
            <button
              onClick={() => window.api.downloadUpdate()}
              className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
            >
              Download
            </button>
          </div>
        )}
        {updateDownloaded && (
          <div className="mx-4 mt-2 p-2 rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 flex items-center justify-between" role="alert">
            <p className="text-xs text-green-700 dark:text-green-300">
              Update downloaded — restart to install
            </p>
            <button
              onClick={() => window.api.installUpdate()}
              className="text-xs px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700"
            >
              Restart
            </button>
          </div>
        )}

        {cliState && !cliState.installed && (
          <div className="mx-4 mt-3 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800">
            <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
              GitHub Copilot CLI not detected
            </p>
            <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
              Install it with{' '}
              <code className="px-1 py-0.5 bg-yellow-100 dark:bg-yellow-800 rounded text-xs">
                npm install -g @githubnext/github-copilot-cli
              </code>{' '}
              then restart the app. Chat will use placeholder responses until the CLI is available.
            </p>
          </div>
        )}

        <ChatWindow
          conversationId={currentConversationId}
          onConversationCreated={handleConversationCreated}
          onRefresh={loadConversations}
          activeAgentId={activeAgentId}
          activeAgent={activeAgent}
          onToggleTerminal={() => setShowTerminal((v) => !v)}
          showTerminal={showTerminal}
        />

        {showTerminal && (
          <Suspense fallback={null}>
            <TerminalPanel
              visible={showTerminal}
              onClose={() => setShowTerminal(false)}
            />
          </Suspense>
        )}
      </main>

      <Suspense fallback={null}>
        {showAgentPanel && (
          <AgentPanel
            agent={editingAgent}
            onSave={handleSaveAgent}
            onClose={() => setShowAgentPanel(false)}
            onDelete={handleDeleteAgent}
            onDuplicate={handleDuplicateAgent}
            onExport={handleExportAgent}
          />
        )}

        <McpServerPanel
          visible={showMcpPanel}
          onClose={() => setShowMcpPanel(false)}
        />

        <SettingsPanel
          visible={showSettings}
          onClose={() => setShowSettings(false)}
          theme={theme}
          toggleTheme={toggleTheme}
          onOpenMcp={() => {
            setShowSettings(false)
            setShowMcpPanel(true)
          }}
        />

        {showOnboarding && (
          <OnboardingModal
            onComplete={() => {
              window.api.setSetting('onboarding_complete', 'true')
              setShowOnboarding(false)
            }}
          />
        )}
      </Suspense>

      <ToolApproval
        requests={toolApprovalRequests}
        onRespond={handleToolApprovalRespond}
      />
    </div>
  )
}
