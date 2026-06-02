import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import type { ChatMessage, CliCostSummary } from '../../hooks/chat-types'
import { ToolCallCard } from './ToolCallCard'
import { CostFooter } from './CostFooter'

interface TerminalMessageListProps {
  messages: ChatMessage[]
  streamingContent: string
  isGenerating: boolean
  cliCost: CliCostSummary | null
}

export function TerminalMessageList({ messages, streamingContent, isGenerating, cliCost }: TerminalMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  const visibleMessages = messages.filter(
    (m) => m.role !== 'system' && m.role !== 'team-activity'
  )

  if (visibleMessages.length === 0 && !isGenerating) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-600 font-mono text-sm">
        Start a conversation with Claude CLI
      </div>
    )
  }

  const lastVisible = visibleMessages[visibleMessages.length - 1]
  const showThinking = isGenerating && !streamingContent && lastVisible?.role === 'user'

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 font-mono text-sm">
        {visibleMessages.map((msg) => {
          if (msg.role === 'user') {
            return (
              <div key={msg.id} className="flex items-start gap-2">
                <span className="text-green-400 shrink-0">$</span>
                <span className="text-gray-200 whitespace-pre-wrap break-words">{msg.content}</span>
              </div>
            )
          }

          if (msg.role === 'tool-call') {
            return (
              <div key={msg.id} className="pl-4 border-l-2 border-gray-700">
                <ToolCallCard message={msg} />
              </div>
            )
          }

          // assistant
          return (
            <div key={msg.id} className="pl-4 border-l-2 border-gray-700">
              {msg.content && (
                <p className="text-gray-300 whitespace-pre-wrap break-words">{msg.content}</p>
              )}
            </div>
          )
        })}

        {/* Live streaming content */}
        {streamingContent && (
          <div className="pl-4 border-l-2 border-gray-700">
            <p className="text-gray-300 whitespace-pre-wrap break-words">{streamingContent}</p>
            <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-0.5" aria-hidden />
          </div>
        )}

        {/* Thinking indicator before first token */}
        {showThinking && (
          <div className="pl-4 border-l-2 border-gray-700 flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 text-gray-500 animate-spin" />
            <span className="text-gray-600 text-xs">thinking…</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
      {cliCost && (cliCost.inputTokens > 0 || cliCost.outputTokens > 0 || cliCost.totalCostUsd > 0) && (
        <CostFooter
          totalCostUsd={cliCost.totalCostUsd}
          inputTokens={cliCost.inputTokens}
          outputTokens={cliCost.outputTokens}
        />
      )}
    </div>
  )
}
