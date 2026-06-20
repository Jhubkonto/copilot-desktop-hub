import { AlertCircle, Loader2, Wrench } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useGenerationTimer } from '../../hooks/useGenerationTimer'
import { getModelLabel } from '../../../shared/models'
import { useAppStore } from '../../store/app-store'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { MessageBubble, stripInjectedBlocks } from '../MessageBubble'
import { TeamActivityBlock } from '../TeamActivityBlock'
import { ToolCallBlock } from './ToolCallBlock'
import { ThinkingBlock } from './ThinkingBlock'
import { ArtifactCard } from '../artifacts/ArtifactCard'
import type { ActivityEvent, ChatMessage, CliCostSummary, TeamActivityStep } from '../../hooks/chat-types'

interface ChatMessagesProps {
  messages: ChatMessage[]
  isLoadingMessages: boolean
  isGenerating: boolean
  liveTeamActivity: TeamActivityStep[]
  streamingContent: string
  cliCost?: CliCostSummary | null
  currentActivity?: ActivityEvent | null
  generationStartedAt: number | null
  loadingFailed: boolean
  messagesEndRef: RefObject<HTMLDivElement | null>
  scrollContainerRef?: RefObject<HTMLDivElement | null>
  onScroll?: () => void
  onCopy: (content: string) => void
  onSaveToWiki?: (messageId: string, content: string) => void
  wikiMessageIds: Set<string>
  onRegenerate: (modelOverride?: string) => void | Promise<void>
  onRegenerateWithModel: (model: string) => void | Promise<void>
  onEdit: (index: number) => void
  onRetry: () => void | Promise<void>
  onSignIn: () => void
  onPickModel: () => void
  onUseImageAsContext?: (dataUrl: string) => void
  liveThinkingBlocks?: Map<string, { blockId: string; content: string; done: boolean }>
}

interface RequestReference {
  requestId: string
  preview: string
}

function getRequestPreview(content: string): string {
  return stripInjectedBlocks(content).replace(/\s+/g, ' ').trim()
}

function truncatePreview(preview: string): string {
  return preview.length > 140 ? `${preview.slice(0, 137).trimEnd()}...` : preview
}

export function ChatMessagesBase({
  messages,
  isLoadingMessages,
  isGenerating,
  liveTeamActivity,
  streamingContent,
  cliCost,
  currentActivity,
  generationStartedAt,
  loadingFailed,
  messagesEndRef,
  scrollContainerRef,
  onScroll,
  onCopy,
  onSaveToWiki,
  wikiMessageIds,
  onRegenerate,
  onRegenerateWithModel,
  onEdit,
  onRetry,
  onSignIn,
  onPickModel,
  onUseImageAsContext,
  liveThinkingBlocks,
}: ChatMessagesProps) {
  const catalogModels = useAppStore((state) => state.catalogModels)
  const generationElapsedSec = useGenerationTimer(isGenerating, generationStartedAt)
  const messageElementsRef = useRef(new Map<string, HTMLDivElement>())
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [visibleMessageIds, setVisibleMessageIds] = useState<Set<string>>(new Set())
  const [topVisibleAssistantId, setTopVisibleAssistantId] = useState<string | null>(null)
  const [highlightedRequestId, setHighlightedRequestId] = useState<string | null>(null)
  const lastAssistantIndex = (() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'assistant') return index
      if (messages[index].role === 'user') break
    }
    return -1
  })()

  const requestByAssistantId = useMemo(() => {
    const mapping = new Map<string, ChatMessage>()
    let latestUserMessage: ChatMessage | null = null
    for (const message of messages) {
      if (message.role === 'user') {
        latestUserMessage = message
      } else if (message.role === 'assistant' && latestUserMessage) {
        mapping.set(message.id, latestUserMessage)
      }
    }
    return mapping
  }, [messages])

  const updateVisibleMessages = useCallback(() => {
    const container = scrollContainerRef?.current
    if (!container) return

    const containerRect = container.getBoundingClientRect()
    if (containerRect.height <= 0) return

    const nextVisibleIds = new Set<string>()
    let nextTopAssistant: { id: string; top: number } | null = null

    for (const message of messages) {
      const element = messageElementsRef.current.get(message.id)
      if (!element) continue

      const rect = element.getBoundingClientRect()
      const visibleTop = Math.max(rect.top, containerRect.top)
      const visibleBottom = Math.min(rect.bottom, containerRect.bottom)
      const isVisible = visibleBottom > visibleTop
      if (!isVisible) continue

      nextVisibleIds.add(message.id)
      if (message.role === 'assistant') {
        const top = Math.max(rect.top, containerRect.top)
        if (!nextTopAssistant || top < nextTopAssistant.top) {
          nextTopAssistant = { id: message.id, top }
        }
      }
    }

    setVisibleMessageIds((prev) => {
      if (prev.size === nextVisibleIds.size && Array.from(prev).every((id) => nextVisibleIds.has(id))) {
        return prev
      }
      return nextVisibleIds
    })
    setTopVisibleAssistantId((prev) => (prev === nextTopAssistant?.id ? prev : (nextTopAssistant?.id ?? null)))
  }, [messages, scrollContainerRef])

  const registerMessageElement = useCallback((messageId: string) => {
    return (element: HTMLDivElement | null) => {
      if (element) {
        messageElementsRef.current.set(messageId, element)
      } else {
        messageElementsRef.current.delete(messageId)
      }
    }
  }, [])

  useEffect(() => {
    const frame = requestAnimationFrame(updateVisibleMessages)
    return () => cancelAnimationFrame(frame)
  }, [messages, streamingContent, updateVisibleMessages])

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
    }
  }, [])

  const requestReference: RequestReference | null = (() => {
    if (!topVisibleAssistantId) return null
    const request = requestByAssistantId.get(topVisibleAssistantId)
    if (!request || visibleMessageIds.has(request.id)) return null
    const preview = getRequestPreview(request.content)
    if (!preview) return null
    return { requestId: request.id, preview: truncatePreview(preview) }
  })()

  const handleScrollToRequest = useCallback((requestId: string) => {
    const element = messageElementsRef.current.get(requestId)
    if (!element) return
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightedRequestId(requestId)
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
    highlightTimerRef.current = setTimeout(() => setHighlightedRequestId(null), 1600)
  }, [])

  const handleScroll = useCallback(() => {
    onScroll?.()
    updateVisibleMessages()
  }, [onScroll, updateVisibleMessages])

  return (
    <div
      ref={scrollContainerRef}
      className="flex-1 overflow-y-auto min-h-0 px-4 pt-0 pb-6 mr-1.5"
      role="log"
      aria-live="polite"
      aria-label="Messages"
      onScroll={handleScroll}
    >
      {requestReference && (
        <div className="sticky top-0 z-[5] -mx-4 h-0 pointer-events-none">
          <button
            type="button"
            onClick={() => handleScrollToRequest(requestReference.requestId)}
            className="pointer-events-auto flex h-9 w-full items-center border-b border-gray-100 bg-gray-100/95 px-4 text-left text-xs font-semibold text-gray-800 shadow-sm backdrop-blur transition-colors hover:bg-gray-200/95 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-400 dark:border-gray-800 dark:bg-gray-800/95 dark:text-gray-100 dark:hover:bg-gray-700/95 dark:focus:ring-blue-500"
            aria-label="Scroll to related request"
            title="Scroll to related request"
          >
            <span className="mx-auto flex w-full max-w-3xl items-center gap-2">
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                In reply to
              </span>
              <span className="min-w-0 flex-1 truncate font-bold">{requestReference.preview}</span>
            </span>
          </button>
        </div>
      )}
      <div className="max-w-3xl mx-auto space-y-8 pt-6">
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
              <div
                key={message.id}
                ref={registerMessageElement(message.id)}
                className="max-w-3xl mx-auto"
                data-message-id={message.id}
                data-message-role={message.role}
              >
                <TeamActivityBlock steps={steps} isLive={false} />
              </div>
            )
          }

          if (message.content.startsWith('__artifact-ref:')) {
            try {
              const ref = JSON.parse(message.content.slice('__artifact-ref:'.length)) as { artifactId: string; versionId?: string }
              return (
                <div
                  key={message.id}
                  ref={registerMessageElement(message.id)}
                  className="max-w-3xl mx-auto px-4 pb-2"
                  data-message-id={message.id}
                  data-message-role={message.role}
                >
                  <ArtifactCard artifactId={ref.artifactId} versionId={ref.versionId} />
                </div>
              )
            } catch {
              // malformed ref — fall through to normal render
            }
          }

          if (message.role === 'tool-call') {
            return (
              <div
                key={message.id}
                ref={registerMessageElement(message.id)}
                className="max-w-3xl mx-auto"
                data-message-id={message.id}
                data-message-role={message.role}
              >
                <ToolCallBlock
                  toolName={message.toolName ?? message.content}
                  serverName={message.serverName}
                  args={message.toolArgs}
                  result={message.toolResult}
                  success={message.toolSuccess ?? true}
                  inProgress={message.toolInProgress}
                  resultImages={message.toolResultImages}
                  onUseImageAsContext={onUseImageAsContext}
                />
              </div>
            )
          }

          return (
            <div
              key={message.id}
              ref={registerMessageElement(message.id)}
              data-message-id={message.id}
              data-message-role={message.role}
            >
              {message.role === 'assistant' && message.thinkingBlocks && message.thinkingBlocks.size > 0 && (
                <div className="flex justify-start mb-1">
                  <div className="w-full max-w-[80%]">
                    {Array.from(message.thinkingBlocks.values()).map((block) => (
                      <ThinkingBlock
                        key={block.blockId}
                        content={block.content}
                        done={block.done}
                        label={block.blockId.startsWith('codex-') ? 'Codex activity' : 'Reasoning'}
                      />
                    ))}
                  </div>
                </div>
              )}
              <MessageBubble
                id={message.id}
                role={message.role}
                content={message.content}
                isEdited={message.isEdited}
                modelLabel={
                  message.role === 'assistant' && message.model
                    ? getModelLabel(message.model, catalogModels)
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
                timestamp={message.timestamp}
                isHighlighted={message.id === highlightedRequestId}
                onCopy={onCopy}
                onSaveToWiki={message.role === 'assistant' ? onSaveToWiki : undefined}
                hasWikiEntry={wikiMessageIds.has(message.id)}
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
            </div>
          )
        })}
        {isGenerating && liveTeamActivity.length > 0 && (
          <div className="max-w-3xl mx-auto">
            <TeamActivityBlock steps={liveTeamActivity} isLive={true} />
          </div>
        )}
        {liveThinkingBlocks && liveThinkingBlocks.size > 0 && (
          <div className="flex justify-start">
            <div className="w-full max-w-[80%]">
              {Array.from(liveThinkingBlocks.values()).map((block) => (
                <ThinkingBlock
                  key={block.blockId}
                  content={block.content}
                  done={block.done}
                  label={block.blockId.startsWith('codex-') ? 'Codex activity' : 'Reasoning'}
                />
              ))}
            </div>
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
        {cliCost && !isGenerating && (
          <div className="mt-2 flex items-center gap-3 border-t border-gray-100 px-3 py-1.5 text-xs text-gray-400 dark:border-gray-800 dark:text-gray-500">
            <span className="font-mono">${cliCost.totalCostUsd.toFixed(4)}</span>
            <span>·</span>
            <span>{cliCost.inputTokens.toLocaleString()} in</span>
            <span>/</span>
            <span>{cliCost.outputTokens.toLocaleString()} out</span>
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
