import { ChevronDown, ChevronRight, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { useState } from 'react'
import type { ChatMessage } from '../../hooks/chat-types'

interface ToolCallCardProps {
  message: ChatMessage
}

export function ToolCallCard({ message }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)

  const name = message.toolName ?? 'tool'
  const input = message.toolArgs ?? {}
  const content = message.toolResult ?? ''
  const inProgress = message.toolInProgress ?? false
  const success = message.toolSuccess ?? true

  const status = inProgress ? 'pending' : success ? 'done' : 'error'

  const statusIcon =
    status === 'pending' ? <Loader2 className="w-3 h-3 animate-spin text-yellow-400" /> :
    status === 'error'   ? <AlertCircle className="w-3 h-3 text-red-400" /> :
                           <CheckCircle2 className="w-3 h-3 text-green-400" />

  const hasDetail = Object.keys(input).length > 0 || !!content

  return (
    <div className="my-1 rounded border border-gray-700 bg-gray-900 text-xs font-mono">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-gray-300 hover:bg-gray-800"
        onClick={() => hasDetail && setExpanded((v) => !v)}
        disabled={!hasDetail}
      >
        {hasDetail ? (
          expanded ? <ChevronDown className="w-3 h-3 shrink-0 text-gray-500" /> : <ChevronRight className="w-3 h-3 shrink-0 text-gray-500" />
        ) : (
          <span className="w-3 h-3 shrink-0" />
        )}
        {statusIcon}
        <span className="text-purple-300">{name}</span>
        {status === 'pending' && <span className="ml-auto text-gray-500">running…</span>}
        {status !== 'pending' && content && (
          <span className="ml-auto text-gray-500 truncate max-w-xs">{content.slice(0, 60)}</span>
        )}
      </button>
      {expanded && (
        <div className="border-t border-gray-700 px-3 py-2 text-gray-400 whitespace-pre-wrap break-words">
          {Object.keys(input).length > 0 && (
            <div className="mb-1">
              <span className="text-gray-500">input: </span>
              {JSON.stringify(input, null, 2)}
            </div>
          )}
          {content && (
            <div>
              <span className="text-gray-500">output: </span>
              {content}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
