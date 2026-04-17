import { useState, useCallback } from 'react'
import { SearchBar } from './SearchBar'

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
  isDefault?: boolean
}

interface AuthState {
  authenticated: boolean
  user: { login: string; avatar_url: string; name: string | null } | null
}

interface SidebarProps {
  currentConversationId: string | null
  conversations: Conversation[]
  onSelectConversation: (id: string) => void
  onNewChat: () => void
  onDeleteConversation: (id: string) => void
  onRefresh: () => void
  authState: AuthState
  onLogin: () => void
  onLogout: () => void
  agents: AgentConfig[]
  activeAgentId: string | null
  onSelectAgent: (id: string | null) => void
  onEditAgent: (id: string) => void
  onCreateAgent: () => void
  onImportAgent: () => void
}

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

export function Sidebar({
  currentConversationId,
  conversations,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  onRefresh,
  authState,
  onLogin,
  onLogout,
  agents,
  activeAgentId,
  onSelectAgent,
  onEditAgent,
  onCreateAgent,
  onImportAgent
}: SidebarProps) {
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
      await window.api.renameConversation(editingId, editTitle.trim())
      onRefresh()
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
        onClick={() => onSelectConversation(conv.id)}
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
            onDeleteConversation(conv.id)
          }}
          className="hidden group-hover:block text-gray-400 hover:text-red-500 text-xs ml-1 px-1"
          title="Delete conversation"
        >
          ×
        </button>
      </div>
    )
  }

  return (
    <aside className="w-64 flex flex-col bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700" role="complementary" aria-label="Sidebar navigation">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 tracking-wide">
          Copilot Desktop Hub
        </h2>
      </div>

      <div className="p-3 space-y-2">
        <button
          onClick={onNewChat}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          <span>+</span>
          <span>New Chat</span>
        </button>
        <SearchBar onSearch={handleSearch} />
      </div>

      <div className="flex-1 overflow-y-auto px-3">
        <div className="mb-4">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-2 mb-2">
            Agents
          </h3>
          {agents.length === 0 ? (
            <div className="text-xs text-gray-400 dark:text-gray-500 px-2 italic">
              No agents configured
            </div>
          ) : (
            <div className="space-y-0.5">
              {/* None option */}
              <div
                className={`group flex items-center justify-between px-2 py-1.5 rounded-lg cursor-pointer text-sm transition-colors ${
                  activeAgentId === null
                    ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
                onClick={() => onSelectAgent(null)}
              >
                <span className="text-xs font-medium">💬 No Agent</span>
              </div>
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className={`group flex items-center justify-between px-2 py-1.5 rounded-lg cursor-pointer text-sm transition-colors ${
                    activeAgentId === agent.id
                      ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                  onClick={() => onSelectAgent(agent.id)}
                >
                  <span className="text-xs font-medium truncate">
                    {agent.icon} {agent.name}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onEditAgent(agent.id)
                    }}
                    className="hidden group-hover:block text-gray-400 hover:text-blue-500 text-xs ml-1 px-1"
                    title="Edit agent"
                  >
                    ⚙
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 mt-2 px-2">
            <button
              onClick={onCreateAgent}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              + New Agent
            </button>
            <button
              onClick={onImportAgent}
              className="text-xs text-gray-500 dark:text-gray-400 hover:underline"
            >
              Import
            </button>
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-2 mb-2">
            {searchQuery ? `Results for "${searchQuery}"` : 'Conversations'}
          </h3>
          {displayConversations.length === 0 ? (
            <div className="text-xs text-gray-400 dark:text-gray-500 px-2 italic">
              {searchQuery ? 'No matching conversations' : 'No conversations yet'}
            </div>
          ) : (
            <div className="space-y-3">
              {dateGroups.map((group) => (
                <div key={group.label}>
                  <div className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-2 mb-1">
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

      <div className="p-3 border-t border-gray-200 dark:border-gray-700">
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
              onClick={onLogout}
              className="text-[10px] text-gray-400 hover:text-red-500 transition-colors"
              title="Sign out"
            >
              Sign out
            </button>
          </div>
        ) : (
          <button
            onClick={onLogin}
            className="w-full text-left text-xs text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 px-2 py-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            🔑 Sign in with GitHub
          </button>
        )}
      </div>
    </aside>
  )
}
