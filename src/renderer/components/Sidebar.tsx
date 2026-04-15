interface SidebarProps {
  currentConversationId: string | null
  onSelectConversation: (id: string) => void
  onNewChat: () => void
}

export function Sidebar({ onNewChat }: SidebarProps) {
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
          <div className="text-xs text-gray-400 dark:text-gray-500 px-2 italic">
            No conversations yet
          </div>
        </div>
      </div>

      <div className="p-3 border-t border-gray-200 dark:border-gray-700">
        <button className="w-full text-left text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded transition-colors">
          Settings
        </button>
      </div>
    </aside>
  )
}
