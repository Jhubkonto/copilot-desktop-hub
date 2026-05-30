import { AlertCircle, Loader2, Wrench } from 'lucide-react'
import { memo, type RefObject } from 'react'
import { getModelLabel } from '../../../shared/models'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { MessageBubble } from '../MessageBubble'
import { TeamActivityBlock } from '../TeamActivityBlock'
import { ToolCallBlock } from './ToolCallBlock'
import type { ActivityEvent, ChatMessage, TeamActivityStep } from '../../hooks/chat-types'

interface ChatMessagesProps {
  messages: ChatMessage[]
  effectiveModel: string
  isLoadingMessages: boolean
  isGenerating: boolean
  liveTeamActivity: TeamActivityStep[]
  streamingContent: string
  currentActivity?: ActivityEvent | null
  generationElapsedSec: number
  loadingFailed: boolean
  messagesEndRef: RefObject<HTMLDivElement | null>
  scrollContainerRef?: RefObject<HTMLDivElement | null>
  onScroll?: () => void
  onCopy: (content: string) => void
  onRegenerate: (modelOverride?: string) => void | Promise<void>
  onRegenerateWithModel: (model: string) => void | Promise<void>
  onEdit: (index: number) => void
  onRetry: () => void | Promise<void>
  onSignIn: () => void
  onPickModel: () => void
  onUseImageAsContext?: (dataUrl: string) => void
}

export function ChatMessagesBase({
  messages,
  effectiveModel,
  isLoadingMessages,
  isGenerating,
  liveTeamActivity,
  streamingContent,
  currentActivity,
  generationElapsedSec,
  loadingFailed,
  messagesEndRef,
  scrollContainerRef,
  onScroll,
  onCopy,
  onRegenerate,
  onRegenerateWithModel,
  onEdit,
  onRetry,
  onSignIn,
  onPickModel,
  onUseImageAsContext,
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
      ref={scrollContainerRef}
      className="flex-1 overflow-y-auto min-h-0 px-4 py-6"
      role="log"
      aria-live="polite"
      aria-label="Messages"
      onScroll={onScroll}
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

          if (message.role === 'tool-call') {
            return (
              <div key={message.id} className="max-w-3xl mx-auto">
                <ToolCallBlock
                  toolName={message.toolName ?? message.content}
                  serverName={message.serverName}
                  args={message.toolArgs}
                  result={message.toolResult}
                  success={message.toolSuccess ?? true}
                  resultImages={message.toolResultImages}
                  onUseImageAsContext={onUseImageAsContext}
                />
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
              messageIndex={index}
              onCopy={onCopy}
              onRegenerate={index === lastAssistantIndex ? onRegenerate : undefined}
              onRegenerateWithModel={index === lastAssistantIndex ? onRegenerateWithModel : undefined}
              onEdit={message.role === 'user' ? onEdit : undefined}
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
                {currentActivity?.type === 'tool' ? (
                  <Wrench className="w-3.5 h-3.5 animate-pulse shrink-0 text-blue-500 dark:text-blue-400" />
                ) : (
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                )}
                <span>
                  {currentActivity?.type === 'tool'
                    ? <>Using <span className="font-mono text-blue-600 dark:text-blue-400">{currentActivity.name}</span>{currentActivity.server ? <span className="text-gray-400 dark:text-gray-500"> · {currentActivity.server}</span> : null}</>
                    : <>Thinking{generationElapsedSec > 0 ? ` · ${generationElapsedSec}s` : '...'}</>
                  }
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

export const ChatMessages = memo(ChatMessagesBase)
