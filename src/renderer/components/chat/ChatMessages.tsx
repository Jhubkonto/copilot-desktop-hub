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

interface MsgGroup {
  main: ChatMessage
  toolCalls: ChatMessage[]
  index: number
}

export function getThinkingBlockLabel(blockId: string): string {
  if (blockId === 'codex-reasoning-summary') return 'Reasoning summary'
  if (blockId === 'codex-activity') return 'Codex activity'
  return 'Reasoning'
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

  // Group consecutive tool-call messages with the assistant message that follows them.
  // This ensures one message-enter animation per turn rather than one per block.
  const msgGroups = useMemo<MsgGroup[]>(() => {
    const groups: MsgGroup[] = []
    let pendingToolCalls: ChatMessage[] = []
    messages.forEach((msg, index) => {
      if (msg.role === 'tool-call') {
        pendingToolCalls.push(msg)
      } else {
        // Only group tool calls that preceded this message chronologically (C2 guard).
        const orderedToolCalls = pendingToolCalls.filter(
          (tc) => msg.role !== 'assistant' || tc.timestamp <= msg.timestamp,
        )
        const unorderedToolCalls = pendingToolCalls.filter(
          (tc) => msg.role === 'assistant' && tc.timestamp > msg.timestamp,
        )
        groups.push({ main: msg, toolCalls: orderedToolCalls, index })
        // Demote out-of-order tool calls to standalone entries.
        for (const tc of unorderedToolCalls) {
          groups.push({ main: tc, toolCalls: [], index: groups.length })
        }
        pendingToolCalls = []
      }
    })
    // Flush trailing tool-calls (edge case: tool calls without a following assistant message)
    for (const tc of pendingToolCalls) {
      groups.push({ main: tc, toolCalls: [], index: groups.length })
    }
    return groups
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
        {/* Conversation start marker — decorative top treatment */}
        {!isLoadingMessages && messages.length > 0 && (
          <div className="chat-start-divider pb-6 pt-2">
            <div className="flex flex-col gap-2">
              <div className="h-px w-full bg-gray-200 dark:bg-gray-700" />
              <div className="h-px w-full bg-gray-200 dark:bg-gray-700" />
            </div>
          </div>
        )}
        {isLoadingMessages && (
          <>
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className={`flex ${index % 2 === 0 ? 'justify-start' : 'justify-end'}`}
              >
                <div className={`max-w-[80%] rounded-lg px-4 py-3 overflow-hidden ${index % 2 === 0 ? 'w-64' : 'w-48'}`}>
                  <div className="h-3 rounded mb-2 skeleton-shimmer" />
                  <div className="h-3 rounded w-4/5 skeleton-shimmer" />
                </div>
              </div>
            ))}
          </>
        )}
        {msgGroups.map(({ main, toolCalls, index }) => {
          if (main.role === 'team-activity') {
            let steps: TeamActivityStep[] = []
            try {
              steps = (JSON.parse(main.content) as { steps: TeamActivityStep[] }).steps ?? []
            } catch {
              // ignore malformed stored team activity payloads
            }
            return (
              <div
                key={main.id}
                ref={registerMessageElement(main.id)}
                className="max-w-3xl mx-auto message-enter"
                data-message-id={main.id}
                data-message-role={main.role}
              >
                <TeamActivityBlock steps={steps} isLive={false} />
              </div>
            )
          }

          if (main.content.startsWith('__artifact-ref:')) {
            try {
              const ref = JSON.parse(main.content.slice('__artifact-ref:'.length)) as { artifactId: string; versionId?: string }
              return (
                <div
                  key={main.id}
                  ref={registerMessageElement(main.id)}
                  className="max-w-3xl mx-auto px-4 pb-2 message-enter"
                  data-message-id={main.id}
                  data-message-role={main.role}
                >
                  <ArtifactCard artifactId={ref.artifactId} versionId={ref.versionId} />
                </div>
              )
            } catch {
              // malformed ref — fall through to normal render
            }
          }

          // Standalone tool-call (edge case: flushed trailing tool-call with no following assistant message)
          if (main.role === 'tool-call' && toolCalls.length === 0) {
            return (
              <div
                key={main.id}
                ref={registerMessageElement(main.id)}
                className="max-w-3xl mx-auto message-enter"
                data-message-id={main.id}
                data-message-role={main.role}
              >
                <ToolCallBlock
                  toolName={main.toolName ?? main.content}
                  serverName={main.serverName}
                  args={main.toolArgs}
                  result={main.toolResult}
                  success={main.toolSuccess ?? true}
                  inProgress={main.toolInProgress}
                  resultImages={main.toolResultImages}
                  onUseImageAsContext={onUseImageAsContext}
                />
              </div>
            )
          }

          // Normal message (user / assistant) — tool calls that preceded it are grouped in.
          return (
            <div
              key={main.id}
              ref={registerMessageElement(main.id)}
              className="message-enter"
              data-message-id={main.id}
              data-message-role={main.role}
            >
              {main.role === 'assistant' && main.thinkingBlocks && main.thinkingBlocks.size > 0 && (
                <div className="mb-1">
                  {Array.from(main.thinkingBlocks.values()).map((block) => (
                    <ThinkingBlock
                      key={block.blockId}
                      content={block.content}
                      done={block.done}
                      label={getThinkingBlockLabel(block.blockId)}
                    />
                  ))}
                </div>
              )}
              {toolCalls.length > 0 && (
                <div className="mb-1">
                  {toolCalls.map((tc) => (
                    <ToolCallBlock
                      key={tc.id}
                      toolName={tc.toolName ?? tc.content}
                      serverName={tc.serverName}
                      args={tc.toolArgs}
                      result={tc.toolResult}
                      success={tc.toolSuccess ?? true}
                      inProgress={tc.toolInProgress}
                      resultImages={tc.toolResultImages}
                      onUseImageAsContext={onUseImageAsContext}
                    />
                  ))}
                </div>
              )}
              <MessageBubble
                id={main.id}
                role={main.role as 'user' | 'assistant' | 'system'}
                content={main.content}
                isEdited={main.isEdited}
                modelLabel={
                  main.role === 'assistant' && main.model
                    ? getModelLabel(main.model, catalogModels)
                    : undefined
                }
                attachments={main.attachments}
                images={main.images}
                contextSnapshot={main.contextSnapshot}
                isLastAssistant={index === lastAssistantIndex}
                isGenerating={isGenerating}
                isError={main.isError}
                errorType={main.errorType}
                retryable={main.retryable}
                isStopped={main.isStopped}
                messageIndex={index}
                timestamp={main.timestamp}
                isHighlighted={main.id === highlightedRequestId}
                onCopy={onCopy}
                onSaveToWiki={main.role === 'assistant' ? onSaveToWiki : undefined}
                hasWikiEntry={wikiMessageIds.has(main.id)}
                onRegenerate={index === lastAssistantIndex ? onRegenerate : undefined}
                onEdit={main.role === 'user' ? onEdit : undefined}
                onRetry={main.isError && main.retryable ? onRetry : undefined}
                onSignIn={
                  main.isError && main.errorType === 'auth' ? onSignIn : undefined
                }
                onPickModel={
                  main.isError && main.errorType === 'model_not_available'
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
        {/* Live generation area: thinking + streaming text + activity dots in one container */}
        {(liveThinkingBlocks && liveThinkingBlocks.size > 0 || isGenerating) && (
          <div>
            {liveThinkingBlocks && liveThinkingBlocks.size > 0 && (() => {
              // Collect blockIds already committed to a historical message to avoid
              // rendering both the live block and the frozen copy simultaneously (C1).
              const lastAssistant = messages.length > 0
                ? [...messages].reverse().find((m) => m.role === 'assistant')
                : null
              const committedBlockIds = lastAssistant?.thinkingBlocks
                ? new Set(lastAssistant.thinkingBlocks.keys())
                : new Set<string>()
              const visibleLiveBlocks = Array.from(liveThinkingBlocks.values()).filter(
                (block) => !committedBlockIds.has(block.blockId),
              )
              if (visibleLiveBlocks.length === 0) return null
              return (
                <div>
                  {visibleLiveBlocks.map((block) => (
                    <ThinkingBlock
                      key={block.blockId}
                      content={block.content}
                      done={block.done}
                      label={getThinkingBlockLabel(block.blockId)}
                      isResponseStreaming={!!streamingContent}
                    />
                  ))}
                </div>
              )
            })()}
            {isGenerating && streamingContent && (
              <div className="pl-3 border-l-2 border-gray-200 dark:border-gray-700 text-sm text-gray-900 dark:text-gray-100">
                <MarkdownRenderer content={streamingContent} />
                <span className="animate-pulse text-gray-400">▊</span>
              </div>
            )}
            {isGenerating && !streamingContent && (
              <div className="pl-3 border-l-2 border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400">
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
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce" />
                </div>
              </div>
            )}
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
