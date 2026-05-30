import { useState } from 'react'
import { X, ChevronDown, ChevronUp } from 'lucide-react'
import type { ContextSnapshot } from '../hooks/chat-types'

interface ContextRef {
  key: 'workspace' | 'git' | 'file' | 'clipboard'
  token: string
  value?: string
}

interface Attachment {
  id: string
  name: string
  path: string
  size: number
}

interface PastedImage {
  id: string
  dataUrl: string
  name: string
}

interface ContextInspectorProps {
  systemPrompt: string
  contextRefs: ContextRef[]
  attachments: Attachment[]
  images: PastedImage[]
  historyMessages: { role: string }[]
  currentInput: string
  model: string
  onClose: () => void
}

/** Tokens per resolved @ref (rough estimate before actual resolution). */
const REF_TOKEN_ESTIMATE: Record<string, number> = {
  workspace: 500,
  git: 200,
  file: 300,
}

function estimateTokens(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4))
}

function fmtTokens(n: number): string {
  if (n >= 1000) return `~${(n / 1000).toFixed(1)}k`
  return `~${n}`
}

const MAX_TOKENS = 16000

/** Collapsible panel showing what will be included in the next message payload. */
export function ContextInspector({
  systemPrompt,
  contextRefs,
  attachments,
  images,
  historyMessages,
  currentInput,
  onClose,
}: ContextInspectorProps) {
  const [showPrompt, setShowPrompt] = useState(false)

  const systemTokens = estimateTokens(systemPrompt.length)
  const refTokens = contextRefs.reduce((sum, r) => sum + (REF_TOKEN_ESTIMATE[r.key] ?? 300), 0)
  const attachTokens = attachments.reduce((sum, a) => sum + estimateTokens(a.size), 0)
  const historyTokens = historyMessages.length * 200
  const inputTokens = estimateTokens(currentInput.length)
  const totalTokens = systemTokens + refTokens + attachTokens + historyTokens + inputTokens

  const pct = Math.min(1, totalTokens / MAX_TOKENS)
  const barColor =
    pct >= 0.8 ? 'bg-red-500' : pct >= 0.5 ? 'bg-amber-500' : 'bg-emerald-500'
  const countColor =
    pct >= 0.8
      ? 'text-red-500'
      : pct >= 0.5
        ? 'text-amber-500'
        : 'text-gray-500 dark:text-gray-400'

  return (
    <div
      className="mb-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 overflow-hidden"
      aria-label="Context inspector"
    >
      {/* Header with budget bar */}
      <div className="px-3 py-2 flex items-center gap-3 border-b border-gray-100 dark:border-gray-700/50">
        <span className="font-medium text-gray-600 dark:text-gray-300">Context payload</span>
        <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-200 ${barColor}`}
            style={{ width: `${(pct * 100).toFixed(1)}%` }}
          />
        </div>
        <span className={`shrink-0 tabular-nums ${countColor}`}>
          {fmtTokens(totalTokens)}&thinsp;/&thinsp;{fmtTokens(MAX_TOKENS)} tok
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          aria-label="Close context inspector"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
        {/* System prompt */}
        {systemPrompt.length > 0 && (
          <div className="px-3 py-1.5">
            <button
              type="button"
              className="w-full flex items-center gap-2 text-left hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
              onClick={() => setShowPrompt((v) => !v)}
            >
              <span className="text-gray-500 dark:text-gray-400">System Prompt</span>
              <span className="ml-auto flex items-center gap-1 text-gray-400">
                {fmtTokens(systemTokens)} tok
                {showPrompt ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </span>
            </button>
            {showPrompt && (
              <pre className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400 whitespace-pre-wrap font-mono bg-gray-50 dark:bg-gray-800/80 rounded p-2 max-h-28 overflow-auto">
                {systemPrompt}
              </pre>
            )}
          </div>
        )}

        {/* @-context refs */}
        {contextRefs.map((ref, i) => (
          <div key={`${ref.token}-${i}`} className="px-3 py-1.5 flex items-center gap-2">
            <span className="font-mono text-blue-600 dark:text-blue-400">{ref.token}</span>
            <span className="text-gray-400 dark:text-gray-500 text-[11px] italic">resolved on dispatch</span>
            <span className="ml-auto text-gray-400">{fmtTokens(REF_TOKEN_ESTIMATE[ref.key] ?? 300)} tok</span>
          </div>
        ))}

        {/* File attachments */}
        {attachments.map((att) => (
          <div key={att.id} className="px-3 py-1.5 flex items-center gap-2">
            <span className="truncate max-w-[55%]">{att.name}</span>
            <span className="ml-auto text-gray-400">{fmtTokens(estimateTokens(att.size))} tok</span>
          </div>
        ))}

        {/* Pasted images */}
        {images.length > 0 && (
          <div className="px-3 py-1.5 flex items-center gap-2">
            <span className="text-gray-500 dark:text-gray-400">
              {images.length} image{images.length !== 1 ? 's' : ''}
            </span>
            <span className="ml-auto text-gray-400 italic">varies</span>
          </div>
        )}

        {/* Conversation history */}
        {historyMessages.length > 0 && (
          <div className="px-3 py-1.5 flex items-center gap-2">
            <span className="text-gray-500 dark:text-gray-400">History</span>
            <span className="text-gray-400 dark:text-gray-500">{historyMessages.length} messages</span>
            <span className="ml-auto text-gray-400">{fmtTokens(historyTokens)} tok</span>
          </div>
        )}

        {/* Current input */}
        {currentInput.length > 0 && (
          <div className="px-3 py-1.5 flex items-center gap-2">
            <span className="text-gray-500 dark:text-gray-400">Current message</span>
            <span className="ml-auto text-gray-400">{fmtTokens(inputTokens)} tok</span>
          </div>
        )}
      </div>
    </div>
  )
}

/** Read-only panel shown inside a MessageBubble when a context snapshot is present. */
export function ContextSnapshotBadge({ snapshot }: { snapshot: ContextSnapshot }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
      <button
        type="button"
        className="flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        aria-label="Toggle context snapshot"
        onClick={() => setExpanded((v) => !v)}
      >
        ⓘ Context snapshot
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {expanded && (
        <div className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400 space-y-1">
          {snapshot.systemPrompt && (
            <div>
              <span className="font-medium">System Prompt:</span>{' '}
              <span className="italic">{snapshot.systemPrompt.slice(0, 120)}{snapshot.systemPrompt.length > 120 ? '…' : ''}</span>
            </div>
          )}
          {snapshot.contextRefs.length > 0 && (
            <div>
              <span className="font-medium">@refs:</span>{' '}
              {snapshot.contextRefs.map((r) => r.token).join(', ')}
            </div>
          )}
          {snapshot.attachments.length > 0 && (
            <div>
              <span className="font-medium">Files:</span> {snapshot.attachments.map((a) => a.name).join(', ')}
            </div>
          )}
          <div className="flex gap-3">
            <span><span className="font-medium">History:</span> {snapshot.historyLength} messages</span>
            <span><span className="font-medium">Model:</span> {snapshot.model}</span>
            <span><span className="font-medium">~{snapshot.estimatedTokens}</span> tok total</span>
          </div>
        </div>
      )}
    </div>
  )
}
