import { useState, useRef } from 'react'
import { Copy, RotateCcw, Pencil, AlertTriangle, RefreshCw, LogIn, StopCircle, ChevronDown } from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { MODEL_OPTIONS, getModelLabel, getModelMultiplier } from '../../shared/models'

interface Attachment {
  id: string
  name: string
  size: number
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
  isLastAssistant: boolean
  isGenerating: boolean
  isError?: boolean
  errorType?: string
  retryable?: boolean
  isStopped?: boolean
  onCopy: (content: string) => void
  onRegenerate?: () => void
  onRegenerateWithModel?: (model: string) => void
  onEdit?: () => void
  onRetry?: () => void
  onSignIn?: () => void
  onPickModel?: () => void
}

export function MessageBubble({
  role,
  content,
  isEdited,
  modelLabel,
  attachments,
  images,
  isLastAssistant,
  isGenerating,
  isError,
  errorType,
  retryable,
  isStopped,
  onCopy,
  onRegenerate,
  onRegenerateWithModel,
  onEdit,
  onRetry,
  onSignIn,
  onPickModel
}: MessageBubbleProps) {
  const [showActions, setShowActions] = useState(false)
  const [showRegenMenu, setShowRegenMenu] = useState(false)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMouseEnter = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => setShowActions(true), 200)
  }

  const handleMouseLeave = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => {
      setShowActions(false)
      setShowRegenMenu(false)
    }, 400)
  }

  return (
    <div
      className={`group flex ${
        role === 'user' ? 'justify-end' : role === 'system' ? 'justify-center' : 'justify-start'
      }`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onDoubleClick={role === 'user' && onEdit ? onEdit : undefined}
    >
      <div className="relative max-w-[80%]">
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            isError
              ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-red-800 dark:text-red-200'
              : role === 'system'
                ? 'bg-gray-50 dark:bg-gray-800/60 border border-dashed border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 italic'
              : role === 'user'
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

          {images && images.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {images.map((img) => (
                <img
                  key={img.id}
                  src={img.dataUrl}
                  alt={img.name}
                  className="h-32 max-w-[240px] object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                />
              ))}
            </div>
          )}

          {isError && (
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-red-500 dark:text-red-400" />
              <div className="flex-1">
                <div className="whitespace-pre-wrap">{content}</div>
                <div className="flex gap-2 mt-3">
                  {retryable && onRetry && (
                    <button
                      onClick={onRetry}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Retry
                    </button>
                  )}
                  {errorType === 'auth' && onSignIn && (
                    <button
                      onClick={onSignIn}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60 transition-colors"
                    >
                      <LogIn className="w-3 h-3" />
                      Sign in again
                    </button>
                  )}
                  {errorType === 'model_not_available' && onPickModel && (
                    <button
                      onClick={onPickModel}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                    >
                      Choose model
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {!isError && role === 'assistant' ? (
            <>
              <MarkdownRenderer content={content} />
              {isStopped && (
                <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500">
                  <StopCircle className="w-3 h-3" />
                  Generation stopped
                </div>
              )}
              {modelLabel && (
                <div className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
                  Model: {modelLabel}
                </div>
              )}
            </>
          ) : !isError ? (
            <>
              <div className="whitespace-pre-wrap">{content}</div>
              {role === 'user' && isEdited && (
                <div className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">edited</div>
              )}
            </>
          ) : null}
        </div>

        {!isGenerating && !isError && (
          <div
            className={`absolute -bottom-7 ${role === 'user' ? 'right-0' : 'left-0'} flex gap-1 z-20 transition-opacity duration-200 ${showActions ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          >
            <ActionButton icon={Copy} label="Copy" onClick={() => onCopy(content)} />
            {role === 'assistant' && isLastAssistant && onRegenerate && (
              <div className="relative flex items-center">
                <ActionButton icon={RotateCcw} label="Regenerate" onClick={onRegenerate} />
                {onRegenerateWithModel && (
                  <>
                    <button
                      type="button"
                      aria-label="Regenerate with model"
                      className="h-8 w-8 inline-flex items-center justify-center rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200 transition-colors shadow-sm"
                      onClick={() => setShowRegenMenu((prev) => !prev)}
                    >
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    {showRegenMenu && (
                      <div className="absolute right-0 top-9 z-20 w-56 max-h-64 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg p-1">
                        {MODEL_OPTIONS.filter((model) => model !== 'default').map((model) => (
                          <button
                            key={model}
                            type="button"
                            className="w-full text-left px-2 py-1.5 rounded text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-between gap-2"
                            onClick={() => {
                              setShowRegenMenu(false)
                              onRegenerateWithModel(model)
                            }}
                          >
                            <span>{getModelLabel(model)}</span>
                            {getModelMultiplier(model) && (
                              <span className="text-gray-400 dark:text-gray-500 shrink-0">{getModelMultiplier(model)}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
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
