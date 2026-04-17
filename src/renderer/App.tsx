import { useState, useEffect, useCallback } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatWindow } from './components/ChatWindow'

interface Conversation {
  id: string
  agent_id: string | null
  title: string
  created_at: number
  updated_at: number
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
  }, [])

  // Load conversations
  const loadConversations = useCallback(() => {
    window.api.listConversations().then(setConversations)
  }, [])

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

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
    // Refresh sidebar after a short delay to let the DB write complete
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

  return (
    <div className={`flex h-screen w-screen ${theme === 'dark' ? 'dark' : ''}`}>
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
      />
      <main className="flex-1 flex flex-col bg-white dark:bg-gray-900">
        <header className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              Copilot Desktop Hub
            </h1>
            {cliState && !cliState.installed && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300">
                Copilot CLI not found
              </span>
            )}
          </div>
          <button
            onClick={toggleTheme}
            className="text-xs px-3 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
          </button>
        </header>

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
        />
      </main>
    </div>
  )
}
