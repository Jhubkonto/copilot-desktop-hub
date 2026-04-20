import { useState } from 'react'
import { Copy, RotateCcw, Pencil } from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer'

interface Attachment {
  id: string
  name: string
  size: number
}

interface MessageBubbleProps {
  id: string
  role: 'user' | 'assistant'
  content: string
  attachments?: Attachment[]
  isLastAssistant: boolean
  isGenerating: boolean
  onCopy: (content: string) => void
  onRegenerate?: () => void
  onEdit?: () => void
}

export function MessageBubble({
  role,
  content,
  attachments,
  isLastAssistant,
  isGenerating,
  onCopy,
  onRegenerate,
  onEdit
}: MessageBubbleProps) {
  const [showActions, setShowActions] = useState(false)

  return (
    <div
      className={`group flex ${role === 'user' ? 'justify-end' : 'justify-start'}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className="relative max-w-[80%]">
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            role === 'user'
              ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              : 'bg-gray-50 dark:bg-gray-800/50 text-gray-900 dark:text-gray-100'
          }`}
        >
          {attachments && attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {attachments.map((att) => (
                <span
                  key={att.id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-200/60 dark:bg-gray-700/60 text-xs text-gray-600 dark:text-gray-400"
                >
                  {att.name}
                  <span className="opacity-60">
                    ({formatFileSize(att.size)})
                  </span>
                </span>
              ))}
            </div>
          )}

          {role === 'assistant' ? (
            <MarkdownRenderer content={content} />
          ) : (
            <div className="whitespace-pre-wrap">{content}</div>
          )}
        </div>

        {showActions && !isGenerating && (
          <div
            className={`absolute -bottom-7 ${role === 'user' ? 'right-0' : 'left-0'} flex gap-1 z-20`}
          >
            <ActionButton icon={Copy} label="Copy" onClick={() => onCopy(content)} />
            {role === 'assistant' && isLastAssistant && onRegenerate && (
              <ActionButton icon={RotateCcw} label="Regenerate" onClick={onRegenerate} />
            )}
            {role === 'user' && onEdit && (
              <ActionButton icon={Pencil} label="Edit" onClick={onEdit} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ActionButton({
  icon: Icon,
  label,
  onClick
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200 transition-colors whitespace-nowrap shadow-sm"
      title={label}
      aria-label={label}
    >
      <Icon className="w-3 h-3" />
      <span>{label}</span>
    </button>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
