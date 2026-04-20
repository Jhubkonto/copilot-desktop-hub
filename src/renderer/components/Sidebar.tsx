import { useState, useCallback } from 'react'
import { Plus, MessageSquare, Settings, X, LogIn, Pencil, Upload } from 'lucide-react'
import { SearchBar } from './SearchBar'
import { useAppStore, type Conversation } from '../store/app-store'

interface DateGroup {
  label: string
  conversations: Conversation[]
}

function groupByDate(conversations: Conversation[]): DateGroup[] {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86400000
  const weekStart = todayStart - 7 * 86400000

  const groups: DateGroup[] = []

  const today = conversations.filter((c) => c.updated_at >= todayStart)
  const yesterday = conversations.filter(
    (c) => c.updated_at >= yesterdayStart && c.updated_at < todayStart
  )
  const thisWeek = conversations.filter(
    (c) => c.updated_at >= weekStart && c.updated_at < yesterdayStart
  )
  const older = conversations.filter((c) => c.updated_at < weekStart)

  if (today.length) groups.push({ label: 'Today', conversations: today })
  if (yesterday.length) groups.push({ label: 'Yesterday', conversations: yesterday })
  if (thisWeek.length) groups.push({ label: 'This Week', conversations: thisWeek })
  if (older.length) groups.push({ label: 'Older', conversations: older })

  return groups
}

export function Sidebar() {
  const currentConversationId = useAppStore((s) => s.currentConversationId)
  const conversations = useAppStore((s) => s.conversations)
  const authState = useAppStore((s) => s.authState)
  const agents = useAppStore((s) => s.agents)
  const activeAgentId = useAppStore((s) => s.activeAgentId)
  const authLoading = useAppStore((s) => s.authLoading)
  const conversationsLoading = useAppStore((s) => s.conversationsLoading)
  const agentsLoading = useAppStore((s) => s.agentsLoading)

  const selectConversation = useAppStore((s) => s.selectConversation)
  const newChat = useAppStore((s) => s.newChat)
  const deleteConversation = useAppStore((s) => s.deleteConversation)
  const loadConversations = useAppStore((s) => s.loadConversations)
  const login = useAppStore((s) => s.login)
  const logout = useAppStore((s) => s.logout)
  const selectAgent = useAppStore((s) => s.selectAgent)
  const openEditAgent = useAppStore((s) => s.openEditAgent)
  const openCreateAgent = useAppStore((s) => s.openCreateAgent)
  const importAgent = useAppStore((s) => s.importAgent)
  const addToast = useAppStore((s) => s.addToast)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Conversation[] | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')

  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query)
    if (!query) {
      setSearchResults(null)
      return
    }
    try {
      const results = await window.api.searchConversations(query)
      setSearchResults(results)
    } catch {
      setSearchResults(null)
    }
  }, [])

  const handleRename = async () => {
    if (editingId && editTitle.trim()) {
      try {
        await window.api.renameConversation(editingId, editTitle.trim())
        loadConversations()
      } catch {
        addToast('Failed to rename conversation', 'error')
      }
    }
    setEditingId(null)
  }

  const displayConversations = searchResults ?? conversations
  const dateGroups = groupByDate(displayConversations)

  const renderConversation = (conv: Conversation) => {
    const agentForConv = agents.find((a) => a.id === conv.agent_id)
    return (
      <div
        key={conv.id}
        className={`group flex items-center justify-between px-2 py-1.5 rounded-lg cursor-pointer text-sm transition-colors ${
          currentConversationId === conv.id
            ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
        }`}
        onClick={() => selectConversation(conv.id)}
      >
        <div className="flex-1 min-w-0">
          {editingId === conv.id ? (
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename()
                if (e.key === 'Escape') setEditingId(null)
              }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
              className="w-full text-xs font-medium bg-white dark:bg-gray-700 border border-blue-400 rounded px-1 py-0.5 focus:outline-none"
            />
          ) : (
            <div
              className="truncate text-xs font-medium"
              onDoubleClick={(e) => {
                e.stopPropagation()
                setEditingId(conv.id)
                setEditTitle(conv.title)
              }}
              title="Double-click to rename"
            >
              {agentForConv && <span className="mr-1">{agentForConv.icon}</span>}
              {conv.title}
            </div>
          )}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            deleteConversation(conv.id)
          }}
          className="hidden group-hover:block text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 ml-1 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
          title="Delete conversation"
          aria-label="Delete conversation"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    )
  }

  return (
    <aside className="w-64 flex flex-col bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700/80" role="complementary" aria-label="Sidebar navigation">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700/80">
        <h2 className="text-sm font-medium text-gray-800 dark:text-gray-100 tracking-wide">
          Copilot Desktop Hub
        </h2>
      </div>

      <div className="p-3 space-y-2">
        <button
          onClick={newChat}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>New Chat</span>
        </button>
        <SearchBar onSearch={handleSearch} />
      </div>

      <div className="flex-1 overflow-y-auto px-3">
        <div className="mb-4">
          <h3 className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider px-2 mb-2">
            Agents
          </h3>
          {agentsLoading ? (
            <div className="space-y-1 px-2" aria-label="Loading agents">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-7 bg-gray-200 dark:bg-gray-800 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : agents.length === 0 ? (
            <div className="text-xs text-gray-400 dark:text-gray-500 px-2 italic">
              No agents configured
            </div>
          ) : (
            <div className="space-y-0.5">
              {/* None option */}
              <div
                className={`group flex items-center justify-between px-2 py-1.5 rounded-lg cursor-pointer text-sm transition-colors ${
                  activeAgentId === null
                    ? 'bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                onClick={() => selectAgent(null)}
              >
                <span className="flex items-center gap-2 text-xs font-medium">
                  <MessageSquare className="w-3.5 h-3.5" />
                  No Agent
                </span>
              </div>
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className={`group flex items-center justify-between px-2 py-1.5 rounded-lg cursor-pointer text-sm transition-colors ${
                    activeAgentId === agent.id
                      ? 'bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                  onClick={() => selectAgent(agent.id)}
                >
                  <span className="text-xs font-medium truncate">
                    {agent.icon} {agent.name}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      openEditAgent(agent.id)
                    }}
                    className="hidden group-hover:block text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 ml-1 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                    title="Edit agent"
                    aria-label="Edit agent"
                  >
                    <Settings className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 mt-2 px-2">
            <button
              onClick={openCreateAgent}
              className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              <Plus className="w-3 h-3" />
              New Agent
            </button>
            <button
              onClick={importAgent}
              className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              <Upload className="w-3 h-3" />
              Import
            </button>
          </div>
        </div>

        <div>
          <h3 className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider px-2 mb-2">
            {searchQuery ? `Results for "${searchQuery}"` : 'Conversations'}
          </h3>
          {conversationsLoading && displayConversations.length === 0 ? (
            <div className="space-y-1 px-2" aria-label="Loading conversations">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-7 bg-gray-200 dark:bg-gray-800 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : displayConversations.length === 0 ? (
            <div className="text-xs text-gray-400 dark:text-gray-500 px-2 italic">
              {searchQuery ? 'No matching conversations' : 'No conversations yet'}
            </div>
          ) : (
            <div className="space-y-3">
              {dateGroups.map((group) => (
                <div key={group.label}>
                  <div className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider px-2 mb-1">
                    {group.label}
                  </div>
                  <div className="space-y-0.5">
                    {group.conversations.map(renderConversation)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="p-3 border-t border-gray-200 dark:border-gray-700/80">
        {authState.authenticated && authState.user ? (
          <div className="flex items-center gap-2 px-2 py-1">
            <img
              src={authState.user.avatar_url}
              alt={authState.user.login}
              className="w-6 h-6 rounded-full"
            />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">
                {authState.user.name || authState.user.login}
              </div>
            </div>
            <button
              onClick={logout}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              title="Sign out"
            >
              Sign out
            </button>
          </div>
        ) : (
          <button
            onClick={login}
            disabled={authLoading}
            className="w-full flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 px-2 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            <LogIn className="w-3.5 h-3.5" />
            {authLoading ? 'Signing in...' : 'Sign in with GitHub'}
          </button>
        )}
      </div>
    </aside>
  )
}
