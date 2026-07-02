import { memo, useEffect, useRef, useState } from 'react'
import { Copy, RotateCcw, Pencil, AlertTriangle, RefreshCw, LogIn, StopCircle, CheckCircle, BookOpen, Wrench } from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer'
import type { ContextSnapshot } from '../hooks/chat-types'
import { ContextSnapshotBadge } from './ContextInspector'

// Strip injected context blocks (e.g. [Project File Structure]...[/Project File Structure])
// from user-facing message content — these are internal and shouldn't be shown in the bubble.
const INJECTED_BLOCK_RE = /\[[A-Za-z][^\]]*\]\n[\s\S]*?\[\/[A-Za-z][^\]]*\]\n*/g
const CONTEXT_OBJECT_KEYS = [
  '"project',
  '"context',
  '"instructions',
  '"rootDirectory',
  '"sourceContext',
  '"scope',
  '"files',
  '"agents',
]
export function stripInjectedBlocks(text: string): string {
  return stripLeadingContextObject(text.replace(INJECTED_BLOCK_RE, '').trimStart()).trimStart()
}

function stripLeadingContextObject(text: string): string {
  const trimmed = text.trimStart()
  const opener = trimmed[0]
  const closer = opener === '{' ? '}' : opener === '[' ? ']' : null
  if (!closer) return text
  const end = findBalancedEnd(trimmed, opener, closer)
  if (end === -1) return text
  const candidate = trimmed.slice(0, end + 1)
  if (!CONTEXT_OBJECT_KEYS.some((key) => candidate.toLowerCase().includes(key.toLowerCase()))) return text
  return trimmed.slice(end + 1)
}

function findBalancedEnd(text: string, opener: string, closer: string): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\' && inString) {
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === opener) depth += 1
    if (ch === closer) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

interface Attachment {
  id: string
  name: string
  size: number
  type?: 'file' | 'image'
  thumbnailDataUrl?: string
}

interface PastedImage {
  id: string
  dataUrl: string
  name: string
}

interface MessageBubbleProps {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  isEdited?: boolean
  modelLabel?: string
  attachments?: Attachment[]
  images?: PastedImage[]
  contextSnapshot?: string
  isLastAssistant: boolean
  isGenerating: boolean
  isError?: boolean
  errorType?: string
  retryable?: boolean
  isStopped?: boolean
  messageIndex?: number
  onCopy: (content: string) => void
  onRegenerate?: () => void
  onEdit?: (index: number) => void
  onSaveToWiki?: (messageId: string, content: string) => void
  onSaveAsArtifact?: (messageId: string, content: string) => void
  onCreateCodeChange?: (messageId: string, content: string) => void
  canCreateCodeChange?: boolean
  hasWikiEntry?: boolean
  timestamp?: number
  isHighlighted?: boolean
  onRetry?: () => void
  onSignIn?: () => void
  onPickModel?: () => void
}

export function MessageBubbleBase({
  id,
  role,
  content,
  isEdited,
  modelLabel,
  attachments,
  images,
  contextSnapshot,
  isLastAssistant,
  isGenerating,
  isError,
  errorType,
  retryable,
  isStopped,
  messageIndex = 0,
  timestamp,
  onCopy,
  onRegenerate,
  onEdit,
  onSaveToWiki,
  onSaveAsArtifact,
  onCreateCodeChange,
  canCreateCodeChange = true,
  hasWikiEntry,
  onRetry,
  onSignIn,
  onPickModel,
  isHighlighted
}: MessageBubbleProps) {
  const [showActions, setShowActions] = useState(false)
  const [copied, setCopied] = useState(false)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
  }, [])

  const handleMouseEnter = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => setShowActions(true), 200)
  }

  const handleMouseLeave = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => {
      setShowActions(false)
    }, 400)
  }

  const isAssistant = role === 'assistant'
  const isUser = role === 'user'
  const isSystem = role === 'system'

  return (
    <div
      className={`group flex ${
        isUser ? 'justify-end' : isSystem ? 'justify-center' : 'justify-start'
      }`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onDoubleClick={isUser && onEdit ? () => onEdit(messageIndex) : undefined}
    >
      {/* Assistant: full-width, no background bubble — left-border accent only */}
      {isAssistant && !isError && (
        <div className={`relative w-full pl-3 border-l-2 text-sm text-gray-900 dark:text-gray-100 transition-shadow ${
          isHighlighted ? 'border-blue-400/70 dark:border-blue-300/70' : 'border-gray-200 dark:border-gray-700'
        }`}>
          <MarkdownRenderer content={content} />
          {isStopped && (
            <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500">
              <StopCircle className="w-3 h-3" />
              Generation stopped
            </div>
          )}
          <div className="flex items-center justify-between gap-2 mt-2">
            {modelLabel ? (
              <span className="text-[11px] text-gray-400 dark:text-gray-500">Model: {modelLabel}</span>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-1.5 shrink-0">
              {hasWikiEntry && (
                <span title="Saved to wiki" aria-label="Saved to wiki">
                  <BookOpen className="w-3 h-3 text-blue-400 dark:text-blue-500" />
                </span>
              )}
              {timestamp != null && (
                <span className="text-[10px] text-gray-400 dark:text-gray-500">
                  {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          </div>
          {!isGenerating && (
            <div
              className={`absolute -bottom-7 left-0 flex gap-1 z-20 transition-opacity duration-200 ${showActions ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            >
              <ActionButton
                icon={copied ? CheckCircle : Copy}
                label="Copy"
                onClick={() => {
                  onCopy(content)
                  setCopied(true)
                  if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
                  copiedTimerRef.current = setTimeout(() => setCopied(false), 1200)
                }}
                highlight={copied}
              />
              {onSaveToWiki && (
                <ActionButton
                  icon={BookOpen}
                  label={hasWikiEntry ? 'Saved' : 'Save to wiki'}
                  onClick={() => onSaveToWiki(id, content)}
                  highlight={hasWikiEntry}
                />
              )}
              {onSaveAsArtifact && (
                <ActionButton
                  icon={BookOpen}
                  label="Save as artifact"
                  onClick={() => onSaveAsArtifact(id, content)}
                />
              )}
              {onCreateCodeChange && (
                <ActionButton
                  icon={Wrench}
                  label="Create code change"
                  onClick={() => onCreateCodeChange(id, content)}
                  disabled={!canCreateCodeChange}
                  title={canCreateCodeChange ? 'Create code change' : 'Switch to a project to create a code change'}
                />
              )}
              {isLastAssistant && onRegenerate && (
                <ActionButton icon={RotateCcw} label="Regenerate" onClick={() => onRegenerate()} />
              )}
            </div>
          )}
        </div>
      )}

      {/* Error assistant: keep a subtle error card */}
      {isAssistant && isError && (
        <div className="relative w-full">
          <div className="rounded-lg px-4 py-3 text-sm bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-red-800 dark:text-red-200">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-red-500 dark:text-red-400" />
              <div className="flex-1">
                <div className="whitespace-pre-wrap break-words">{content}</div>
                <div className="flex gap-2 mt-3">
                  {retryable && onRetry && (
                    <button onClick={onRetry} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border border-red-200 dark:border-red-800/60 bg-red-100/80 dark:bg-red-900/40 text-red-700 dark:text-red-300 shadow-sm transition-all duration-150 hover:shadow-md hover:bg-red-200 dark:hover:bg-red-900/60 active:scale-95">
                      <RefreshCw className="w-3 h-3" />Retry
                    </button>
                  )}
                  {errorType === 'auth' && onSignIn && (
                    <button onClick={onSignIn} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border border-blue-200 dark:border-blue-800/60 bg-blue-100/80 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 shadow-sm transition-all duration-150 hover:shadow-md hover:bg-blue-200 dark:hover:bg-blue-900/60 active:scale-95">
                      <LogIn className="w-3 h-3" />Sign in again
                    </button>
                  )}
                  {errorType === 'model_not_available' && onPickModel && (
                    <button onClick={onPickModel} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-gray-800/90 text-gray-700 dark:text-gray-200 shadow-sm transition-all duration-150 hover:shadow-md hover:bg-gray-100 dark:hover:bg-gray-700 active:scale-95">
                      Choose model
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* User / system messages: retain existing bubble layout */}
      {!isAssistant && (
      <div className="relative max-w-[80%]">
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            isError
              ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-red-800 dark:text-red-200'
              : isSystem
                ? 'bg-gray-50 dark:bg-gray-800/60 border border-dashed border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 italic'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
          } transition-shadow ${isHighlighted ? 'ring-2 ring-blue-400/70 dark:ring-blue-300/70 shadow-md' : ''}`}
        >
          {/* User image attachments */}
          {attachments && attachments.length > 0 && (
            <div className="flex flex-col gap-1.5 mb-2">
              {attachments.filter(a => a.type === 'image' && a.thumbnailDataUrl).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {attachments.filter(a => a.type === 'image' && a.thumbnailDataUrl).map(att => (
                    <img key={att.id} src={att.thumbnailDataUrl} alt={att.name}
                      className="h-32 max-w-[240px] object-cover rounded-lg border border-gray-200 dark:border-gray-700" />
                  ))}
                </div>
              )}
              {attachments.filter(a => a.type !== 'image' || !a.thumbnailDataUrl).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {attachments.filter(a => a.type !== 'image' || !a.thumbnailDataUrl).map(att => (
                    <span key={att.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-200/60 dark:bg-gray-700/60 text-xs text-gray-600 dark:text-gray-400">
                      {att.name}<span className="opacity-60">({formatFileSize(att.size)})</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          {images && images.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {images.map((img) => (
                <img key={img.id} src={img.dataUrl} alt={img.name}
                  className="h-32 max-w-[240px] object-cover rounded-lg border border-gray-200 dark:border-gray-700" />
              ))}
            </div>
          )}

          <div className="whitespace-pre-wrap break-words">{isUser ? stripInjectedBlocks(content) : content}</div>
          {isUser && isEdited && (
            <div className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">edited</div>
          )}
          <div className="flex items-end justify-between gap-2 mt-2">
            <span className="min-w-0">
              {isUser && contextSnapshot && (() => {
                try {
                  const snap: ContextSnapshot = JSON.parse(contextSnapshot)
                  return <ContextSnapshotBadge snapshot={snap} />
                } catch { return null }
              })()}
            </span>
            {timestamp != null && (
              <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">
                {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>

        {!isGenerating && !isError && (
          <div className={`absolute -bottom-7 right-0 flex gap-1 z-20 transition-opacity duration-200 ${showActions ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <ActionButton
              icon={copied ? CheckCircle : Copy}
              label="Copy"
              onClick={() => {
                onCopy(content)
                setCopied(true)
                if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
                copiedTimerRef.current = setTimeout(() => setCopied(false), 1200)
              }}
              highlight={copied}
            />
            {isUser && onEdit && (
              <ActionButton icon={Pencil} label="Edit" onClick={() => onEdit(messageIndex)} />
            )}
          </div>
        )}
      </div>
      )}
    </div>
  )
}

export const MessageBubble = memo(MessageBubbleBase)

function ActionButton({
  icon: Icon,
  label,
  onClick,
  highlight = false,
  disabled = false,
  title,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
  highlight?: boolean
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border whitespace-nowrap backdrop-blur-sm transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-sm disabled:active:scale-100 ${
        highlight
          ? 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800/60 text-green-600 dark:text-green-400 shadow-sm'
          : 'bg-white/90 dark:bg-gray-800/90 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 shadow-sm hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/80 hover:text-gray-800 dark:hover:text-gray-100'
      }`}
      title={title ?? label}
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
