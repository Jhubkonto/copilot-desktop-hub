import { useEffect, useState } from 'react'
import type { NewContentConversation } from '../../../shared/types'
import { formatRelativeTime } from '../../../shared/utils'
import { useAppStore } from '../../store/app-store'
import { NexyIcon } from '../ui/icons/NexyIcon'
import { PaneEmptyState } from './pane-primitives'

const EMPTY_IDS: string[] = []

function previewText(value: string | null): string {
  if (!value) return 'New assistant content is ready.'
  return value.replace(/\s+/g, ' ').trim()
}

export function NewContentPane() {
  const unreadIds = useAppStore((s) => s.syncedUnreadConversationIds) ?? EMPTY_IDS
  const selectConversation = useAppStore((s) => s.selectConversation)
  const setSectionPane = useAppStore((s) => s.setSectionPane)
  const addToast = useAppStore((s) => s.addToast)
  const [items, setItems] = useState<NewContentConversation[]>([])
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    void window.api.getNewContentConversations()
      .then((next) => { if (active) setItems(next) })
      .catch(() => { if (active) addToast('Failed to load new content', 'error') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [addToast, unreadIds])

  const markAllRead = async () => {
    if (clearing) return
    setClearing(true)
    try {
      await window.api.markAllNewContentRead()
      setItems([])
    } catch {
      addToast('Failed to mark new content as read', 'error')
    } finally {
      setClearing(false)
    }
  }

  const openConversation = (conversationId: string) => {
    selectConversation(conversationId)
    if (items.length === 1) setSectionPane('new-content')
  }

  if (!loading && items.length === 0) {
    return (
      <PaneEmptyState>
        You're all caught up. Chats with new assistant content will appear here.
      </PaneEmptyState>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b-2 border-nexy-border px-3">
        <span className="text-[10px] text-nexy-muted">{items.length} unread chat{items.length === 1 ? '' : 's'}</span>
        <button
          type="button"
          onClick={() => { void markAllRead() }}
          disabled={clearing || items.length === 0}
          className="text-[10px] font-bold text-nexy-info hover:text-nexy-text disabled:opacity-40"
        >
          {clearing ? 'Clearing…' : 'Mark all as read'}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex h-24 items-center justify-center text-nexy-muted">
            <NexyIcon name="busy" className="h-4 w-4" />
          </div>
        ) : items.map((item) => (
          <button
            key={item.conversationId}
            type="button"
            onClick={() => openConversation(item.conversationId)}
            className="mb-1 flex w-full items-start gap-2 rounded-nexy-sm border border-transparent px-3 py-2 text-left hover:border-nexy-border-soft hover:bg-nexy-recessed"
          >
            <span className="nexy-notification-dot mt-1.5 h-2 w-2 shrink-0 bg-nexy-info" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-bold text-nexy-text">{item.title}</span>
              <span className="mt-0.5 block truncate text-[10px] text-nexy-muted">{previewText(item.preview)}</span>
              <span className="mt-1 block truncate text-[10px] text-nexy-muted">
                {[item.agentName, item.projectName, formatRelativeTime(item.newContentAt)].filter(Boolean).join(' · ')}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
