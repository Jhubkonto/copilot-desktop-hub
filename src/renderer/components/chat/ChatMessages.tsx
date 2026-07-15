import { AlertCircle, Loader2, Wrench } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useGenerationTimer } from '../../hooks/useGenerationTimer'
import { useThrottledValue } from '../../hooks/useThrottledValue'
import { CHAT_MARKDOWN_THROTTLE_MS } from '../../../shared/chat-animation'
import { getModelLabel } from '../../../shared/models'
import { useAppStore } from '../../store/app-store'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { MessageBubble, stripInjectedBlocks } from '../MessageBubble'
import { TeamActivityBlock } from '../TeamActivityBlock'
import { ToolCallBlock } from './ToolCallBlock'
import { ThinkingBlock } from './ThinkingBlock'
import { CodexActionLine } from './CodexActionLine'
import { ArtifactCard } from '../artifacts/ArtifactCard'
import type { ChatMessage, CliCostSummary, TeamActivityStep } from '../../hooks/chat-types'
import { buildChatRenderItems } from '../../hooks/chat-render-items'
import { createEmptyChatTurnState, type ChatTurnState } from '../../hooks/chat-turn-reducer'

interface ChatMessagesProps {
  messages: ChatMessage[]
  isLoadingMessages: boolean
  isGenerating: boolean
  liveTeamActivity: TeamActivityStep[]
  streamingContent: string
  /** True while streamed text is still being revealed (useStreamingQueue) — drives a subtle
   *  fade/breathing effect on the live text so new tokens feel like they're settling in rather
   *  than popping to full opacity. */
  isDraining?: boolean
  cliCost?: CliCostSummary | null
  generationStartedAt: number | null
  loadingFailed: boolean
  messagesEndRef: RefObject<HTMLDivElement | null>
  scrollContainerRef?: RefObject<HTMLDivElement | null>
  contentContainerRef?: RefObject<HTMLDivElement | null>
  onScroll?: () => void
  onNavigateToRequest?: () => void
  onCopy: (content: string) => void
  onSaveToWiki?: (messageId: string, content: string) => void
  onPromoteArtifact?: (messageId: string, content: string) => void
  onCreateCodeChange?: (messageId: string, content: string) => void
  canCreateCodeChange?: boolean
  wikiMessageIds: Set<string>
  onRegenerate: (modelOverride?: string) => void | Promise<void>
  onEdit: (index: number) => void
  onRetry: () => void | Promise<void>
  onSignIn: () => void
  onPickModel: () => void
  onUseImageAsContext?: (dataUrl: string) => void
  liveTurnState?: ChatTurnState
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
  if (blockId.startsWith('codex-reasoning-summary')) return 'Reasoning summary'
  return 'Reasoning'
}

// Codex CLI turns render their reasoning/tool-call timeline as short bulleted lines
// (matching Codex's own CLI output) instead of the boxed ThinkingBlock/ToolCallBlock
// cards every other backend uses — both signals below already exist on the data
// without any extra backend plumbing.
function isCodexThinkingBlock(blockId: string): boolean {
  return blockId.startsWith('codex-reasoning-summary')
}
function isCodexToolCall(serverName: string | undefined): boolean {
  return serverName === 'codex-cli'
}

// A status-colored bead sitting directly on the shared timeline border, marking each
// step's position along it — mirrors the connected dot-and-line action list used for
// tool calls in Claude Code's own CLI output.
function TimelineEntry({ children, colorClass, pulse }: { children: ReactNode; colorClass: string; pulse?: boolean }) {
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className={`absolute -left-[17px] top-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white dark:ring-gray-900 ${colorClass} ${pulse ? 'animate-pulse' : ''}`}
      />
      {children}
    </div>
  )
}

function toolCallDotColor(inProgress: boolean | undefined, success: boolean | undefined): string {
  if (inProgress) return 'bg-blue-500'
  return success === false ? 'bg-red-500' : 'bg-green-500'
}

function thinkingDotColor(done: boolean): string {
  return done ? 'bg-purple-500' : 'bg-purple-400'
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
  isDraining = false,
  cliCost,
  generationStartedAt,
  loadingFailed,
  messagesEndRef,
  scrollContainerRef,
  contentContainerRef,
  onScroll,
  onNavigateToRequest,
  onCopy,
  onSaveToWiki,
  onPromoteArtifact,
  onCreateCodeChange,
  canCreateCodeChange = true,
  wikiMessageIds,
  onRegenerate,
  onEdit,
  onRetry,
  onSignIn,
  onPickModel,
  onUseImageAsContext,
  liveTurnState,
}: ChatMessagesProps) {
  const catalogModels = useAppStore((state) => state.catalogModels)
  const generationElapsedSec = useGenerationTimer(isGenerating, generationStartedAt)
  // ReactMarkdown + rehype-highlight re-parse their entire input on every render, which is
  // too expensive (and visually flickery on incomplete code fences) to run at the reveal
  // animation's ~60fps cadence — throttle what's handed to MarkdownRenderer while streaming.
  const throttledStreamingContent = useThrottledValue(streamingContent, CHAT_MARKDOWN_THROTTLE_MS, isGenerating)
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
  // Dangling tool calls with no assistant message yet (mid-turn: they're inserted into
  // `messages` immediately for progress display, before the turn commits) are further
  // merged with each other into one chained group instead of one group per call — without
  // this, each landed as its own top-level item with the generous space-y-8 gap between
  // top-level items, then visibly "condensed" down to the tighter chained-timeline spacing
  // the instant the turn committed and they got grouped with the assistant message.
  const msgGroups = useMemo<MsgGroup[]>(() => {
    const rawItems = buildChatRenderItems(messages, createEmptyChatTurnState(null), { includeLiveTurn: false })
    const groups: MsgGroup[] = []
    let pendingDanglingToolCalls: ChatMessage[] = []
    const flushDangling = () => {
      if (pendingDanglingToolCalls.length === 0) return
      const [main, ...rest] = pendingDanglingToolCalls
      groups.push({ main, toolCalls: rest, index: messages.length })
      pendingDanglingToolCalls = []
    }
    for (const item of rawItems) {
      if (item.type === 'historical-tool-group') {
        flushDangling()
        groups.push({ main: item.message, toolCalls: item.toolCalls, index: item.index })
      } else if (item.type === 'historical-message' && item.message.role === 'tool-call') {
        pendingDanglingToolCalls.push(item.message)
      } else if (item.type === 'historical-message') {
        flushDangling()
        groups.push({ main: item.message, toolCalls: [], index: item.index })
      }
    }
    flushDangling()
    return groups
  }, [messages])
  const effectiveLiveTurnState = liveTurnState ?? createEmptyChatTurnState(null)
  // buildChatRenderItems already de-dupes against committed historical messages and
  // interleaves thinking blocks/tool calls by firstSeenSequence — the live area below
  // renders this directly instead of maintaining separate parallel derivations.
  const liveRenderItems = useMemo(
    () => buildChatRenderItems(messages, effectiveLiveTurnState, { includeLiveTurn: true })
      .filter((item) => item.type !== 'historical-message' && item.type !== 'historical-tool-group'),
    [messages, effectiveLiveTurnState],
  )
  const effectiveCliCost = cliCost ?? liveTurnState?.cost ?? null

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
    onNavigateToRequest?.()
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightedRequestId(requestId)
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
    highlightTimerRef.current = setTimeout(() => setHighlightedRequestId(null), 1600)
  }, [onNavigateToRequest])

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
      <div ref={contentContainerRef} className="max-w-3xl mx-auto space-y-8 pt-6">
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
              const ref = JSON.parse(main.content.slice('__artifact-ref:'.length)) as {
                artifactId: string
                versionId?: string
                pending?: boolean
              }
              return (
                <div
                  key={main.id}
                  ref={registerMessageElement(main.id)}
                  className="max-w-3xl mx-auto px-4 pb-2 message-enter"
                  data-message-id={main.id}
                  data-message-role={main.role}
                >
                  <ArtifactCard artifactId={ref.artifactId} versionId={ref.versionId} pending={ref.pending === true} />
                </div>
              )
            } catch {
              // malformed ref — fall through to normal render
            }
          }

          // Standalone tool-call chain (dangling calls with no assistant message yet —
          // either still mid-turn, or the edge case of a turn that ends in tool calls
          // with no trailing text). All merged into one shared-border chained group so
          // this reads the same whether the turn is still generating or already settled.
          if (main.role === 'tool-call') {
            return (
              <div
                key={main.id}
                ref={registerMessageElement(main.id)}
                className="max-w-3xl mx-auto message-enter pl-3 border-l-2 border-gray-200 dark:border-gray-700 space-y-3"
                data-message-id={main.id}
                data-message-role={main.role}
              >
                {[main, ...toolCalls].map((tc) => (
                  <TimelineEntry key={tc.id} colorClass={toolCallDotColor(tc.toolInProgress, tc.toolSuccess ?? true)} pulse={tc.toolInProgress}>
                    {isCodexToolCall(tc.serverName) ? (
                      <CodexActionLine
                        kind="tool"
                        toolName={tc.toolName ?? tc.content}
                        args={tc.toolArgs}
                        result={tc.toolResult}
                        success={tc.toolSuccess ?? true}
                        inProgress={tc.toolInProgress}
                      />
                    ) : (
                      <ToolCallBlock
                        toolName={tc.toolName ?? tc.content}
                        serverName={tc.serverName}
                        args={tc.toolArgs}
                        result={tc.toolResult}
                        success={tc.toolSuccess ?? true}
                        inProgress={tc.toolInProgress}
                        resultImages={tc.toolResultImages}
                        onUseImageAsContext={onUseImageAsContext}
                      />
                    )}
                  </TimelineEntry>
                ))}
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
              {((main.role === 'assistant' && main.thinkingBlocks && main.thinkingBlocks.size > 0) || toolCalls.length > 0) && (
                // One shared left-border thread for the whole sequence — reasoning and
                // tool calls read as chained steps rather than separately-bordered blocks,
                // with generous spacing between them along it.
                <div className="mb-2 pl-3 border-l-2 border-gray-200 dark:border-gray-700 space-y-3">
                  {main.role === 'assistant' && main.thinkingBlocks && Array.from(main.thinkingBlocks.values()).map((block) => (
                    <TimelineEntry key={block.blockId} colorClass={thinkingDotColor(block.done)} pulse={!block.done}>
                      {isCodexThinkingBlock(block.blockId) ? (
                        <CodexActionLine kind="reasoning" content={block.content} />
                      ) : (
                        <ThinkingBlock
                          content={block.content}
                          done={block.done}
                          label={getThinkingBlockLabel(block.blockId)}
                        />
                      )}
                    </TimelineEntry>
                  ))}
                  {toolCalls.map((tc) => (
                    <TimelineEntry key={tc.id} colorClass={toolCallDotColor(tc.toolInProgress, tc.toolSuccess ?? true)} pulse={tc.toolInProgress}>
                      {isCodexToolCall(tc.serverName) ? (
                        <CodexActionLine
                          kind="tool"
                          toolName={tc.toolName ?? tc.content}
                          args={tc.toolArgs}
                          result={tc.toolResult}
                          success={tc.toolSuccess ?? true}
                          inProgress={tc.toolInProgress}
                        />
                      ) : (
                        <ToolCallBlock
                          toolName={tc.toolName ?? tc.content}
                          serverName={tc.serverName}
                          args={tc.toolArgs}
                          result={tc.toolResult}
                          success={tc.toolSuccess ?? true}
                          inProgress={tc.toolInProgress}
                          resultImages={tc.toolResultImages}
                          onUseImageAsContext={onUseImageAsContext}
                        />
                      )}
                    </TimelineEntry>
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
                onSaveAsArtifact={main.role === 'assistant' ? onPromoteArtifact : undefined}
                onCreateCodeChange={onCreateCodeChange}
                canCreateCodeChange={canCreateCodeChange}
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
        {/* Live generation area: thinking blocks, tool calls, streaming text, and the
            activity indicator, rendered in true chronological order via liveRenderItems
            (see chat-render-items.ts) — a bubble never jumps out of the sequence it
            actually happened in, and each distinct reasoning burst gets its own block.
            Thinking/tool-call items render whenever present, independent of isGenerating
            (they can legitimately outlive the turn briefly); the text/activity items are
            explicitly gated on isGenerating below since liveTurnState.text/activity stay
            populated after completion until the next turn resets them — without that gate
            the streaming cursor would linger after the committed message already replaced it. */}
        {(liveRenderItems.length > 0 || isGenerating) && (
          // One shared left-border thread for the whole live sequence, with generous
          // spacing between steps along it — reads as a chained timeline rather than a
          // stack of separately-bordered blocks.
          <div className="pl-3 border-l-2 border-gray-200 dark:border-gray-700 space-y-3">
            {liveRenderItems.map((item) => {
              if (item.type === 'live-thinking-block') {
                // The reducer marks blocks done the instant the backend's turn-completion
                // event arrives, ahead of the text reveal animation. Keep showing the
                // live/streaming style for as long as isGenerating is true (i.e. until the
                // reveal animation actually finishes draining) so the two don't decouple.
                const done = item.block.done && !isGenerating
                return (
                  <TimelineEntry key={item.id} colorClass={thinkingDotColor(done)} pulse={!done}>
                    {isCodexThinkingBlock(item.block.blockId) ? (
                      <CodexActionLine kind="reasoning" content={item.block.content} />
                    ) : (
                      <ThinkingBlock
                        content={item.block.content}
                        done={done}
                        label={getThinkingBlockLabel(item.block.blockId)}
                      />
                    )}
                  </TimelineEntry>
                )
              }
              if (item.type === 'live-tool-call') {
                return (
                  <TimelineEntry key={item.id} colorClass={toolCallDotColor(item.toolCall.inProgress, item.toolCall.success)} pulse={item.toolCall.inProgress}>
                    {isCodexToolCall(item.toolCall.serverName) ? (
                      <CodexActionLine
                        kind="tool"
                        toolName={item.toolCall.toolName}
                        args={item.toolCall.args}
                        result={item.toolCall.result}
                        success={item.toolCall.success}
                        inProgress={item.toolCall.inProgress}
                      />
                    ) : (
                      <ToolCallBlock
                        toolName={item.toolCall.toolName}
                        serverName={item.toolCall.serverName}
                        args={item.toolCall.args}
                        result={item.toolCall.result}
                        success={item.toolCall.success}
                        inProgress={item.toolCall.inProgress}
                        resultImages={item.toolCall.resultImages}
                        onUseImageAsContext={onUseImageAsContext}
                      />
                    )}
                  </TimelineEntry>
                )
              }
              if (item.type === 'live-assistant-text') {
                if (!isGenerating) return null
                return (
                  <div className={`message-enter text-sm text-gray-900 dark:text-gray-100 transition-opacity duration-150 ease-out ${isDraining ? 'opacity-95' : 'opacity-100'}`} key={item.id}>
                    <MarkdownRenderer content={throttledStreamingContent} />
                    <span className="animate-pulse text-gray-400">▊</span>
                  </div>
                )
              }
              if (item.type === 'live-activity') {
                if (!isGenerating) return null
                return (
                  <TimelineEntry key={item.id} colorClass={item.state === 'tool' ? 'bg-blue-500' : 'bg-gray-400'} pulse>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      <div className="flex items-center gap-2 mb-2">
                        {item.state === 'tool' ? (
                          <Wrench className="w-3.5 h-3.5 animate-pulse shrink-0 text-blue-500 dark:text-blue-400" />
                        ) : (
                          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                        )}
                        <span>
                          {item.state === 'tool'
                            ? <>Using <span className="font-mono text-blue-600 dark:text-blue-400">{item.toolName ?? item.label}</span>{item.serverName ? <span className="text-gray-400 dark:text-gray-500"> · {item.serverName}</span> : null}</>
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
                  </TimelineEntry>
                )
              }
              return null
            })}
            {/* Covers the brief window after isGenerating flips true but before the first
                turn_started/activity_changed event has arrived, so there's no dead gap. */}
            {isGenerating && liveRenderItems.length === 0 && (
              <TimelineEntry colorClass="bg-gray-400" pulse>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  <div className="flex items-center gap-2 mb-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    <span>Thinking{generationElapsedSec > 0 ? ` · ${generationElapsedSec}s` : '...'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce" />
                  </div>
                </div>
              </TimelineEntry>
            )}
          </div>
        )}
        {effectiveCliCost && !isGenerating && (
          <div className="mt-2 flex items-center gap-3 border-t border-gray-100 px-3 py-1.5 text-xs text-gray-400 dark:border-gray-800 dark:text-gray-500">
            <span className="font-mono">${effectiveCliCost.totalCostUsd.toFixed(4)}</span>
            <span>·</span>
            <span>{effectiveCliCost.inputTokens.toLocaleString()} in</span>
            <span>/</span>
            <span>{effectiveCliCost.outputTokens.toLocaleString()} out</span>
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
