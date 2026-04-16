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

interface SidebarProps {
  currentConversationId: string | null
  conversations: Conversation[]
  onSelectConversation: (id: string) => void
  onNewChat: () => void
  onDeleteConversation: (id: string) => void
  authState: AuthState
  onLogin: () => void
  onLogout: () => void
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  return date.toLocaleDateString()
}

export function Sidebar({
  currentConversationId,
  conversations,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  authState,
  onLogin,
  onLogout
}: SidebarProps) {
  return (
    <aside className="w-64 flex flex-col bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 tracking-wide">
          Copilot Desktop Hub
        </h2>
      </div>

      <div className="p-3">
        <button
          onClick={onNewChat}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          <span>+</span>
          <span>New Chat</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3">
        <div className="mb-4">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-2 mb-2">
            Agents
          </h3>
          <div className="text-xs text-gray-400 dark:text-gray-500 px-2 italic">
            No agents configured
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-2 mb-2">
            Conversations
          </h3>
          {conversations.length === 0 ? (
            <div className="text-xs text-gray-400 dark:text-gray-500 px-2 italic">
              No conversations yet
            </div>
          ) : (
            <div className="space-y-1">
              {conversations.map((conv) => (
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
                    <div className="truncate text-xs font-medium">{conv.title}</div>
                    <div className="text-[10px] text-gray-400 dark:text-gray-500">
                      {formatDate(conv.updated_at)}
                    </div>
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
