import { AlertCircle, Loader2 } from 'lucide-react'
import type { RefObject } from 'react'
import { getModelLabel } from '../../../shared/models'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { MessageBubble } from '../MessageBubble'
import { TeamActivityBlock } from '../TeamActivityBlock'
import type { ChatMessage, TeamActivityStep } from '../../hooks/chat-types'

interface ChatMessagesProps {
  messages: ChatMessage[]
  effectiveModel: string
  isLoadingMessages: boolean
  isGenerating: boolean
  liveTeamActivity: TeamActivityStep[]
  streamingContent: string
  generationElapsedSec: number
  loadingFailed: boolean
  messagesEndRef: RefObject<HTMLDivElement | null>
  onCopy: (content: string) => void
  onRegenerate: (modelOverride?: string) => void | Promise<void>
  onEdit: (messageIndex: number) => void
  onRetry: () => void | Promise<void>
  onSignIn: () => void
  onPickModel: () => void
}

export function ChatMessages({
  messages,
  effectiveModel,
  isLoadingMessages,
  isGenerating,
  liveTeamActivity,
  streamingContent,
  generationElapsedSec,
  loadingFailed,
  messagesEndRef,
  onCopy,
  onRegenerate,
  onEdit,
  onRetry,
  onSignIn,
  onPickModel,
}: ChatMessagesProps) {
  const lastAssistantIndex = (() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'assistant') return index
      if (messages[index].role === 'user') break
    }
    return -1
  })()

  return (
    <div
      className="flex-1 overflow-y-auto min-h-0 px-4 py-6"
      role="log"
      aria-live="polite"
      aria-label="Messages"
    >
      <div className="max-w-3xl mx-auto space-y-8">
        {isLoadingMessages && (
          <>
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className={`flex ${index % 2 === 0 ? 'justify-start' : 'justify-end'}`}
              >
                <div className="max-w-[80%] rounded-lg px-4 py-3 bg-gray-100 dark:bg-gray-800 animate-pulse">
                  <div className="h-3 w-48 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
                  <div className="h-3 w-36 bg-gray-200 dark:bg-gray-700 rounded" />
                </div>
              </div>
            ))}
          </>
        )}
        {messages.map((message, index) => {
          if (message.role === 'team-activity') {
            let steps: TeamActivityStep[] = []
            try {
              steps = (JSON.parse(message.content) as { steps: TeamActivityStep[] }).steps ?? []
            } catch {
              // ignore malformed stored team activity payloads
            }
            return (
              <div key={message.id} className="max-w-3xl mx-auto">
                <TeamActivityBlock steps={steps} isLive={false} />
              </div>
            )
          }

          return (
            <MessageBubble
              key={message.id}
              id={message.id}
              role={message.role}
              content={message.content}
              isEdited={message.isEdited}
              modelLabel={
                message.role === 'assistant'
                  ? getModelLabel(message.model ?? effectiveModel)
                  : undefined
              }
              attachments={message.attachments}
              images={message.images}
              contextSnapshot={message.contextSnapshot}
              isLastAssistant={index === lastAssistantIndex}
              isGenerating={isGenerating}
              isError={message.isError}
              errorType={message.errorType}
              retryable={message.retryable}
              isStopped={message.isStopped}
              onCopy={onCopy}
              onRegenerate={
                index === lastAssistantIndex ? () => onRegenerate() : undefined
              }
              onRegenerateWithModel={
                index === lastAssistantIndex ? (model) => onRegenerate(model) : undefined
              }
              onEdit={message.role === 'user' ? () => onEdit(index) : undefined}
              onRetry={message.isError && message.retryable ? onRetry : undefined}
              onSignIn={
                message.isError && message.errorType === 'auth' ? onSignIn : undefined
              }
              onPickModel={
                message.isError && message.errorType === 'model_not_available'
                  ? onPickModel
                  : undefined
              }
            />
          )
        })}
        {isGenerating && liveTeamActivity.length > 0 && (
          <div className="max-w-3xl mx-auto">
            <TeamActivityBlock steps={liveTeamActivity} isLive={true} />
          </div>
        )}
        {isGenerating && streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-[80%] bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
              <MarkdownRenderer content={streamingContent} />
              <span className="animate-pulse text-gray-400">▊</span>
            </div>
          </div>
        )}
        {isGenerating && !streamingContent && (
          <div className="flex justify-start">
            <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
              <div className="flex items-center gap-2 mb-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span>
                  Generating
                  {generationElapsedSec > 0 ? ` · ${generationElapsedSec}s` : '...'}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce" />
              </div>
            </div>
          </div>
        )}
        {loadingFailed && !isGenerating && !streamingContent && (
          <div className="flex justify-start">
            <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-2xl px-4 py-3 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Request failed — see error above</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  )
}
