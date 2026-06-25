import { useState } from 'react'
import { CheckCircle, CheckCircle2, Circle, Plus, Search, X, Pin, Trash2 } from 'lucide-react'
import { useAppStore } from '../../store/app-store'
import type { Conversation } from '../../store/types'
import { DeleteConversationDialog } from '../DeleteConversationDialog'
import { formatRelativeTime } from '../../../shared/utils'
import { isPinned, groupByDate } from './shared'

export function AgentHistoryPane() {
  const conversations = useAppStore((s) => s.conversations)
  const currentConversationId = useAppStore((s) => s.currentConversationId)
  const historyAgentId = useAppStore((s) => s.historyAgentId)
  const agents = useAppStore((s) => s.agents)
  const projects = useAppStore((s) => s.projects)
  const selectConversation = useAppStore((s) => s.selectConversation)
  const deleteConversation = useAppStore((s) => s.deleteConversation)
  const newChat = useAppStore((s) => s.newChat)
  const unreadConversationIds = useAppStore((s) => s.unreadConversationIds)
  const completedConversationIds = useAppStore((s) => s.completedConversationIds)
  const markConversationComplete = useAppStore((s) => s.markConversationComplete)
  const markConversationIncomplete = useAppStore((s) => s.markConversationIncomplete)
  const [query, setQuery] = useState('')
  const [pendingDeleteConv, setPendingDeleteConv] = useState<{ id: string; title: string } | null>(null)

  const agent = historyAgentId ? agents.find((a) => a.id === historyAgentId) : null

  const filtered = conversations
    .filter((c) => c.agent_id === historyAgentId)
    .filter((c) =>
      query
        ? c.title.toLowerCase().includes(query.toLowerCase()) ||
          (c.project_id ? (projects.find((p) => p.id === c.project_id)?.name ?? '').toLowerCase().includes(query.toLowerCase()) : false)
        : true
    )

  const pinned = filtered.filter(isPinned)
  const unpinned = filtered.filter((c) => !isPinned(c))
  const groups = groupByDate(unpinned)

  const renderConv = (conv: Conversation) => {
    const isActive = currentConversationId === conv.id
    const project = conv.project_id ? projects.find((p) => p.id === conv.project_id) : null
    const isUnread = unreadConversationIds.includes(conv.id)
    const isCompleted = completedConversationIds.includes(conv.id)
    return (
      <div
        key={conv.id}
        onClick={() => selectConversation(conv.id)}
        className={`group flex items-start gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
          isActive ? 'bg-gray-200 dark:bg-gray-700' : 'hover:bg-gray-100 dark:hover:bg-gray-800'
        }`}
      >
        {isPinned(conv) && <Pin className="w-3 h-3 text-gray-400 shrink-0 mt-0.5" />}
        {isCompleted ? (
          <span title="Complete"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" /></span>
        ) : isUnread ? (
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shrink-0 mt-1.5" />
        ) : null}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">{conv.title}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[10px] text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-full">
              {project ? project.name : 'No project'}
            </span>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              {formatRelativeTime(conv.updated_at)}
            </span>
          </div>
        </div>
        <div className="invisible group-hover:visible flex items-center gap-0.5 shrink-0">
          {isCompleted ? (
            <button
              onClick={(e) => { e.stopPropagation(); void markConversationIncomplete(conv.id) }}
              className="p-1 rounded text-emerald-500 hover:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              title="Mark incomplete"
              aria-label="Mark conversation incomplete"
            >
              <Circle className="w-3 h-3" />
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); void markConversationComplete(conv.id) }}
              className="p-1 rounded text-gray-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
              title="Mark complete"
              aria-label="Mark conversation complete"
            >
              <CheckCircle className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setPendingDeleteConv({ id: conv.id, title: conv.title }) }}
            className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 shrink-0"
            title="Delete"
            aria-label="Delete conversation"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-gray-100 dark:border-gray-800">
        <div className="flex-1 flex items-center gap-1.5 bg-gray-100 dark:bg-gray-800 rounded-lg px-2 py-0.5">
          <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats…"
            className="flex-1 text-xs bg-transparent focus:outline-none text-gray-700 dark:text-gray-200 placeholder-gray-400"
            aria-label="Search agent chats"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <button
          onClick={() => newChat({ agentId: historyAgentId ?? undefined })}
          className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
          aria-label="New chat with this agent"
        >
          <Plus className="w-3.5 h-3.5" />
          New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto mr-1.5 p-2 space-y-4">
        {filtered.length === 0 && (
          <p className="text-center text-xs text-gray-400 dark:text-gray-500 pt-8 italic">
            {query ? 'No matching conversations' : `No chats with ${agent?.name ?? 'this agent'} yet`}
          </p>
        )}

        {pinned.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-3 mb-1">
              Pinned
            </p>
            {pinned.map(renderConv)}
          </div>
        )}

        {groups.map(({ label, items }) => (
          <div key={label}>
            <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-3 mb-1">
              {label}
            </p>
            {items.map(renderConv)}
          </div>
        ))}
      </div>

      {pendingDeleteConv && (
        <DeleteConversationDialog
          conversationTitle={pendingDeleteConv.title}
          onConfirm={() => {
            deleteConversation(pendingDeleteConv.id)
            setPendingDeleteConv(null)
          }}
          onCancel={() => setPendingDeleteConv(null)}
        />
      )}
    </div>
  )
}
