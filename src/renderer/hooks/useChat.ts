/* eslint-disable react-hooks/exhaustive-deps -- subscriptions use refs to avoid resubscribing during active streams. */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { getModelLabel } from '../../shared/models'
import type { CatalogModel } from '../../shared/types'
import type {
  ChatMessage,
  TeamActivityStep,
  ToolCallEvent,
  ToastType,
} from './chat-types'
import { useChatLiveTurn } from './useChatLiveTurn'
import { useStreamingQueue } from './useStreamingQueue'

function hasIpcError(result: unknown): result is { error: string } {
  return typeof result === 'object' && result !== null && 'error' in result
}

interface UseChatParams {
  conversationId: string | null
  activeAgentId: string | null
  activeProjectId: string | null
  effectiveModel: string
  catalogModels: CatalogModel[]
  addToast: (message: string, type?: ToastType) => void
  loadConversations: () => Promise<void>
  conversationCreated: (id: string) => void
  rateLimitSetterRef?: MutableRefObject<(seconds: number) => void>
  markConversationGenerating: (id: string) => void
  markConversationDoneGenerating: (id: string) => void
  isConversationGenerating?: boolean
  conversationGenerationStartedAt?: number | null
}

export function useChat({
  conversationId,
  effectiveModel,
  catalogModels,
  addToast,
  loadConversations,
  rateLimitSetterRef,
  markConversationGenerating,
  markConversationDoneGenerating,
  isConversationGenerating,
  conversationGenerationStartedAt,
}: UseChatParams) {
  const { displayedContent, isDraining, enqueue, flush, reset: resetQueue, snap: snapQueue } = useStreamingQueue()
  const liveTurnState = useChatLiveTurn(conversationId)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [loadingFailed, setLoadingFailed] = useState(false)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [isEditingMessage, setIsEditingMessage] = useState(false)
  const [liveTeamActivity, setLiveTeamActivity] = useState<TeamActivityStep[]>([])
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null)
  const liveTurnStateRef = useRef(liveTurnState)
  liveTurnStateRef.current = liveTurnState
  // The onStreamResponse handler below is registered in a useEffect whose deps don't
  // include isDraining (re-subscribing on every drain tick would be wasteful/racy) —
  // read the live value through this ref instead of the closed-over state value, which
  // would otherwise stay frozen at whatever isDraining was when the effect last ran.
  const isDrainingRef = useRef(isDraining)
  isDrainingRef.current = isDraining

  const streamingContentRef = useRef('')
  const ignoreRemoteStreamRef = useRef(false)
  // Set by the onStreamError handler so the failed-turn effect knows to skip UI updates.
  const errorWasBackgroundRef = useRef(false)
  const liveToolCallsRef = useRef<ChatMessage[]>([])
  const streamModelRef = useRef<string | null>(null)
  const activeConversationRef = useRef<string | null>(conversationId)
  // Locked to the conversation that started the current stream; cleared on stream end/error.
  const streamingConversationRef = useRef<string | null>(null)
  // Set to true when the WS stream ends; isGenerating stays true until the drain queue also empties.
  const streamEndedRef = useRef(false)
  // Set to true when the null sentinel arrives; gates late thinking_end events.
  const streamClosedRef = useRef(false)
  // Stores blockIds for thinking_end events that arrived before the matching chunk.
  const pendingThinkingEndsRef = useRef<Set<string>>(new Set())
  const justCreatedConversationRef = useRef(false)
  const lastUndoneUserMessageRef = useRef<string | null>(null)
  const pendingEditedResendRef = useRef(false)
  const editCutoffTimestampRef = useRef<number | null>(null)
  const preEditMessagesRef = useRef<ChatMessage[] | null>(null)
  // Holds the previous assistant message during regeneration so it can be
  // restored to the UI if the API call fails, and deleted from the DB on success.
  const pendingDeleteMessageRef = useRef<ChatMessage | null>(null)
  // Tracks the in-flight regen-cleanup deleteMessage IPC call so reloadMessages can
  // wait for it — otherwise a reload can race ahead of the delete and briefly show
  // both the old (pre-regen) and new assistant messages until the delete lands.
  const pendingDeletePromiseRef = useRef<Promise<unknown> | null>(null)
  // Holds the work computed at stream-end (final message to commit, frozen thinking
  // blocks) so it can be applied once the reveal animation actually finishes draining,
  // instead of immediately when the backend's turn-completion event arrives — otherwise
  // the reasoning bubble and full answer text pop in ahead of the in-progress animation.
  const pendingFinalizeRef = useRef<{
    assistantMessage: ChatMessage | null
    frozenThinking: Map<string, { blockId: string; content: string; done: boolean }> | null
  } | null>(null)
  const preRegenMessagesRef = useRef<ChatMessage[] | null>(null)
  // Stable ref so stream-event closures always call the current addToast.
  const addToastRef = useRef(addToast)
  useEffect(() => { addToastRef.current = addToast }, [addToast])

  const pushSystemMessage = useCallback((content: string) => {
    const systemMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'system',
      content,
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, systemMessage])
  }, [])

  const attachArtifact = useCallback(async (artifactId: string, versionId?: string) => {
    const activeId = activeConversationRef.current
    if (!activeId) return
    const content = `__artifact-ref:${JSON.stringify({ artifactId, versionId })}`
    const inserted = await window.api.insertConversationMessage(activeId, 'system', content)
    if (hasIpcError(inserted)) {
      addToastRef.current('Failed to attach artifact', 'error')
      return
    }
    setMessages((prev) => [...prev, {
      id: inserted.id,
      role: inserted.role as ChatMessage['role'],
      content: inserted.content,
      timestamp: inserted.timestamp,
      model: inserted.model ?? null,
    }])
  }, [])

  const buildConversationMarkdown = useCallback(() => {
    const lines: string[] = ['# Conversation Export', '']
    for (const message of messages) {
      if (message.role === 'system') {
        lines.push(`_System_: ${message.content}`)
      } else if (message.role === 'user') {
        lines.push('## User', '', message.content, '')
      } else {
        lines.push('## Assistant', '', message.content, '')
      }
    }
    return lines.join('\n')
  }, [messages])

  useEffect(() => {
    activeConversationRef.current = conversationId
    // If the user navigates into a conversation that already has an in-flight
    // background stream (ignoreRemoteStreamRef=true), flip the ignore flag off so
    // the pending stream-end / error handlers clear isGenerating when the stream
    // finishes rather than bailing out via the wasBackground early-return path.
    if (conversationId && streamingConversationRef.current === conversationId && ignoreRemoteStreamRef.current) {
      ignoreRemoteStreamRef.current = false
    }
  }, [conversationId])

  useEffect(() => {
    if (justCreatedConversationRef.current) {
      justCreatedConversationRef.current = false
      return
    }

    if (conversationId) {
      setIsLoadingMessages(true)
      void window.api.getActiveChatTurn(conversationId).then((snapshot) => {
        if (!snapshot || snapshot.conversationId !== activeConversationRef.current) return
        streamingConversationRef.current = snapshot.conversationId
        streamingContentRef.current = snapshot.assistantText
        setStreamingContent(snapshot.assistantText)
        snapQueue(snapshot.assistantText)
        if (snapshot.status === 'active') {
          setIsGenerating(true)
          markConversationGenerating(snapshot.conversationId)
        }
      })
      window.api
        .getMessages(conversationId)
        .then((dbMessages) => {
          setMessages((prev) => {
            const imageMap = new Map(
              prev.filter((message) => message.images).map((message) => [message.id, message.images!]),
            )

            return dbMessages.map((message) => {
              const base: ChatMessage = {
                id: message.id,
                role: message.role as ChatMessage['role'],
                content: message.content,
                timestamp: message.timestamp,
                model: message.model ?? null,
                isEdited: message.is_edited === 1,
                attachments: message.attachments ? JSON.parse(message.attachments) : undefined,
                images: imageMap.get(message.id),
                contextSnapshot: message.context_snapshot ?? undefined,
              }
              if (message.role === 'assistant' && message.thinking_blocks) {
                try {
                  const blocks = JSON.parse(message.thinking_blocks) as Array<{ blockId: string; content: string; done: boolean }>
                  base.thinkingBlocks = new Map(blocks.map((b) => [b.blockId, b]))
                } catch { /* malformed — ignore */ }
              }
              if (message.role === 'tool-call') {
                try {
                  const parsed = JSON.parse(message.content) as Record<string, unknown>
                  if (parsed.__type === 'tool-call') {
                    return {
                      ...base,
                      content: typeof parsed.toolResult === 'string' ? parsed.toolResult : '',
                      toolName: typeof parsed.toolName === 'string' ? parsed.toolName : undefined,
                      serverName: typeof parsed.serverName === 'string' ? parsed.serverName : undefined,
                      toolArgs: (typeof parsed.toolArgs === 'object' && parsed.toolArgs !== null)
                        ? parsed.toolArgs as Record<string, unknown>
                        : undefined,
                      toolResult: typeof parsed.toolResult === 'string' ? parsed.toolResult : undefined,
                      toolSuccess: typeof parsed.toolSuccess === 'boolean' ? parsed.toolSuccess : true,
                    }
                  }
                } catch { /* malformed tool-call JSON — skip */ }
              }
              return base
            })
          })
        })
        .catch(() => {
          addToast('Failed to load messages', 'error')
          setMessages([])
        })
        .then(() => {
          // If this conversation is still generating (user navigated away and back),
          // restore the Thinking animation so the UI reflects the active state.
          if (isConversationGenerating) {
            setIsGenerating(true)
            // Use the stored start time so the elapsed counter continues from where
            // it left off rather than restarting at 0 on every re-entry.
            setGenerationStartedAt(conversationGenerationStartedAt ?? Date.now())
          }
        })
        .finally(() => {
          setIsLoadingMessages(false)
        })
    } else {
      setMessages([])
      setIsLoadingMessages(false)
    }

    resetQueue()
    setStreamingContent('')
    streamingContentRef.current = ''
    setIsGenerating(false)
    setIsEditingMessage(false)
    preEditMessagesRef.current = null
    editCutoffTimestampRef.current = null
    pendingEditedResendRef.current = false
    setGenerationStartedAt(null)
    setLiveTeamActivity([])
    liveToolCallsRef.current = []
    streamClosedRef.current = false
    pendingThinkingEndsRef.current.clear()
    setLoadingFailed(false)
  }, [conversationId, addToast, snapQueue])

  // Re-fetch messages from DB and update state, preserving any in-memory images.
  // Called after stream end so the persisted team-activity row becomes visible without
  // requiring the user to navigate away and back.
  const reloadMessages = useCallback(() => {
    if (!conversationId) return
    // Wait for any in-flight regen cleanup delete so we don't fetch the DB mid-race
    // and briefly display both the pre-regen and newly-streamed assistant messages.
    void Promise.resolve(pendingDeletePromiseRef.current).then(() => window.api.getMessages(conversationId)).then((dbMessages) => {
      setMessages((prev) => {
        const imageMap = new Map(
          prev.filter((m) => m.images).map((m) => [m.id, m.images!]),
        )
        return dbMessages.map((message) => {
          const base: ChatMessage = {
            id: message.id,
            role: message.role as ChatMessage['role'],
            content: message.content,
            timestamp: message.timestamp,
            model: message.model ?? null,
            isEdited: message.is_edited === 1,
            attachments: message.attachments ? JSON.parse(message.attachments) : undefined,
            images: imageMap.get(message.id),
            contextSnapshot: message.context_snapshot ?? undefined,
          }
          if (message.role === 'assistant' && message.thinking_blocks) {
            try {
              const blocks = JSON.parse(message.thinking_blocks) as Array<{ blockId: string; content: string; done: boolean }>
              base.thinkingBlocks = new Map(blocks.map((b) => [b.blockId, b]))
            } catch { /* malformed — ignore */ }
          }
          if (message.role === 'tool-call') {
            try {
              const parsed = JSON.parse(message.content) as Record<string, unknown>
              if (parsed.__type === 'tool-call') {
                return {
                  ...base,
                  content: typeof parsed.toolResult === 'string' ? parsed.toolResult : '',
                  toolName: typeof parsed.toolName === 'string' ? parsed.toolName : undefined,
                  serverName: typeof parsed.serverName === 'string' ? parsed.serverName : undefined,
                  toolArgs: (typeof parsed.toolArgs === 'object' && parsed.toolArgs !== null)
                    ? parsed.toolArgs as Record<string, unknown>
                    : undefined,
                  toolResult: typeof parsed.toolResult === 'string' ? parsed.toolResult : undefined,
                  toolSuccess: typeof parsed.toolSuccess === 'boolean' ? parsed.toolSuccess : true,
                }
              }
            } catch { /* malformed tool-call JSON — skip */ }
          }
          return base
        })
      })
    })
  }, [conversationId])
  const reloadMessagesRef = useRef(reloadMessages)
  reloadMessagesRef.current = reloadMessages

  // Commits the message/thinking-block work computed at stream-end, once the reveal
  // animation has actually caught up — see pendingFinalizeRef for why this is deferred.
  const applyPendingFinalize = useCallback(() => {
    const pending = pendingFinalizeRef.current
    pendingFinalizeRef.current = null
    if (!pending) return
    if (pending.assistantMessage) {
      const assistantMessage = pending.assistantMessage
      setMessages((prev) => [...prev, assistantMessage])
    } else if (pending.frozenThinking) {
      const frozenThinking = pending.frozenThinking
      setMessages((prev) => {
        const lastIdx = [...prev].map((m) => m.role).lastIndexOf('assistant')
        if (lastIdx === -1) return prev
        const updated = [...prev]
        updated[lastIdx] = { ...updated[lastIdx], thinkingBlocks: frozenThinking }
        return updated
      })
    }
  }, [])

  // Defer isGenerating=false until the drain queue empties so the streaming cursor
  // stays visible until the last buffered character has actually been rendered.
  // Also the trigger point for committing the finished message (see applyPendingFinalize)
  // so the settled appearance lands in the same moment the animation finishes catching up.
  useEffect(() => {
    if (!isDraining && streamEndedRef.current) {
      streamEndedRef.current = false
      applyPendingFinalize()
      setStreamingContent('')
      setIsGenerating(false)
      setLoadingFailed(false)
      setGenerationStartedAt(null)
      setLiveTeamActivity([])
      liveToolCallsRef.current = []
      reloadMessagesRef.current()
    }
  }, [isDraining, applyPendingFinalize])

  // React to turn_failed reducer state — handle regen rollback or append error message.
  // Transport-level cleanup (refs, generating state) happens in onStreamError; this
  // effect handles the message-list consequences so rollback is expressed as a reaction
  // to reducer state rather than being buried in an IPC closure.
  const handledFailedTurnRef = useRef<string | null>(null)
  useEffect(() => {
    if (liveTurnState.status !== 'failed' || !liveTurnState.turnId) return
    if (handledFailedTurnRef.current === liveTurnState.turnId) return
    if (errorWasBackgroundRef.current) {
      errorWasBackgroundRef.current = false
      handledFailedTurnRef.current = liveTurnState.turnId
      return
    }
    handledFailedTurnRef.current = liveTurnState.turnId

    const error = liveTurnState.error
    if (preRegenMessagesRef.current) {
      setMessages(preRegenMessagesRef.current)
      preRegenMessagesRef.current = null
      pendingDeleteMessageRef.current = null
      if (error) addToastRef.current(error.message, 'error')
    } else if (error) {
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: error.message,
        timestamp: Date.now(),
        isError: true,
        errorType: error.type,
        retryable: error.retryable,
      }
      setLoadingFailed(true)
      setMessages((prev) => [...prev, errorMessage])

      if (error.type === 'rate_limit') {
        const waitSeconds =
          typeof error.retryAfterSeconds === 'number' && error.retryAfterSeconds > 0
            ? error.retryAfterSeconds
            : 15
        rateLimitSetterRef?.current(waitSeconds)
      }
    }
  }, [liveTurnState.status, liveTurnState.turnId, liveTurnState.error, rateLimitSetterRef])

  useEffect(() => {
    const unsubscribeRemoteMessage = window.api.onRemoteMessage(({ conversationId: remoteId, content, images }) => {
      if (remoteId !== activeConversationRef.current) {
        // Stream is for a background conversation — suppress all chunks but still
        // mark the streaming conversation so the stream-end handler can fire
        // loadConversations() and update the sidebar without touching the current view.
        streamingConversationRef.current = remoteId
        ignoreRemoteStreamRef.current = true
        markConversationGenerating(remoteId)
        return
      }
      ignoreRemoteStreamRef.current = false
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        images,
        timestamp: Date.now(),
      }
      streamingConversationRef.current = remoteId
      setMessages((prev) => [...prev, userMsg])
      setIsGenerating(true)
      setGenerationStartedAt(Date.now())
      markConversationGenerating(remoteId)
    })

    const unsubscribeStream = window.api.onStreamResponse((chunk: string | null) => {
      if (chunk === null) {
        const wasBackground = ignoreRemoteStreamRef.current
        ignoreRemoteStreamRef.current = false
        streamClosedRef.current = true
        const doneConvId = streamingConversationRef.current ?? activeConversationRef.current ?? ''
        streamingConversationRef.current = null
        markConversationDoneGenerating(doneConvId)
        void loadConversations()

        if (wasBackground) {
          // Stream ran for a background conversation — don't touch current view state.
          streamingContentRef.current = ''
          streamModelRef.current = null
          liveToolCallsRef.current = []
          streamClosedRef.current = false
          return
        }

        const finalContent = streamingContentRef.current
        const hadToolCalls = liveToolCallsRef.current.length > 0
        const displayContent = finalContent || (!hadToolCalls ? '_(no response)_' : '')

        // Mark all live thinking blocks done before freezing — handles late/missing thinking_end events (H1).
        // Read from the reducer state (via ref) since liveThinkingBlocks state has been removed.
        const currentBlocks = liveTurnStateRef.current.thinkingBlocks
        const frozenThinking: Map<string, { blockId: string; content: string; done: boolean }> | null =
          currentBlocks.size > 0
            ? new Map(Array.from(currentBlocks.entries()).map(([k, v]) => [k, { ...v, done: true }]))
            : null

        // Defer committing the finished message (and freezing thinking blocks) until
        // the reveal animation actually finishes draining — computed here from the
        // now-complete backend data, but only applied once isDraining goes false so
        // the settled appearance never pops in ahead of the in-progress animation.
        pendingFinalizeRef.current = {
          assistantMessage: displayContent
            ? {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: displayContent,
                timestamp: Date.now(),
                model: streamModelRef.current,
                ...(frozenThinking ? { thinkingBlocks: frozenThinking } : {}),
              }
            : null,
          frozenThinking: !displayContent ? frozenThinking : null,
        }
        pendingThinkingEndsRef.current.clear()
        streamClosedRef.current = false

        streamingContentRef.current = ''
        streamModelRef.current = null
        // Now that the new response arrived, delete the old assistant message from DB
        // (regen cleanup) before any reload — reloadMessages awaits this promise so a
        // re-fetch can never race ahead of the delete and briefly show both messages.
        if (pendingDeleteMessageRef.current) {
          pendingDeletePromiseRef.current = window.api.deleteMessage(pendingDeleteMessageRef.current.id).catch(() => {})
          pendingDeleteMessageRef.current = null
        }
        // Signal stream end — actual isGenerating=false deferred until drain queue empties
        // so the streaming cursor stays visible until all buffered chars are rendered.
        streamEndedRef.current = true
        // If the queue is already empty (no buffered content), the useEffect won't fire
        // because isDraining never changes — apply the finalize immediately in that case.
        // Read via ref: isDraining in this closure is stale (see isDrainingRef above).
        if (!isDrainingRef.current) {
          streamEndedRef.current = false
          applyPendingFinalize()
          setStreamingContent('')
          setIsGenerating(false)
          setLoadingFailed(false)
          setGenerationStartedAt(null)
          setLiveTeamActivity([])
          liveToolCallsRef.current = []
          reloadMessagesRef.current()
        }
        preRegenMessagesRef.current = null
        return
      }

      if (ignoreRemoteStreamRef.current) return
      if (streamingConversationRef.current && streamingConversationRef.current !== activeConversationRef.current) return
      streamingContentRef.current += chunk
      setStreamingContent((prev) => prev + chunk)
      enqueue(chunk)
    })

    const unsubscribeError = window.api.onStreamError(() => {
      const wasBackground = ignoreRemoteStreamRef.current
      ignoreRemoteStreamRef.current = false
      errorWasBackgroundRef.current = wasBackground
      streamClosedRef.current = true
      const errorConvId = streamingConversationRef.current ?? activeConversationRef.current ?? ''
      streamingConversationRef.current = null
      streamingContentRef.current = ''
      streamModelRef.current = null
      liveToolCallsRef.current = []
      pendingThinkingEndsRef.current.clear()
      streamClosedRef.current = false
      markConversationDoneGenerating(errorConvId)
      void loadConversations()

      if (wasBackground) {
        // Error from a background conversation — don't pollute the current view.
        return
      }

      // Message rollback and error insertion are handled by the liveTurnState.status==='failed'
      // useEffect above, which reacts to the turn_failed reducer event emitted alongside this error.
      flush()
      setStreamingContent('')
      setIsGenerating(false)
      setLoadingFailed(false)
      setGenerationStartedAt(null)

      void loadConversations()
    })

    const unsubscribeToolCall = window.api.onToolCallEvent((data: ToolCallEvent) => {
      if (data.conversationId === null || data.conversationId !== activeConversationRef.current) return
      const toolCallMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'tool-call',
        content: data.result,
        timestamp: Date.now(),
        toolName: data.toolName,
        serverName: data.serverName,
        toolArgs: data.args,
        toolResult: data.result,
        toolSuccess: data.success,
        ...(data.resultImages?.length && { toolResultImages: data.resultImages }),
      }
      liveToolCallsRef.current = [...liveToolCallsRef.current, toolCallMsg]
      setMessages((prev) => [...prev, toolCallMsg])
    })

    const unsubscribeCliToolStart = window.api.onCliToolStart(({ id, name, input }) => {
      if (streamingConversationRef.current && streamingConversationRef.current !== activeConversationRef.current) return
      // Flush pending streamed text before inserting the tool block so the text
      // always appears before the tool call in the DOM (C2).
      flush()
      const toolCallMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'tool-call',
        content: '',
        timestamp: Date.now(),
        toolCallId: id,
        toolName: name,
        toolArgs: input,
        toolInProgress: true,
        toolSuccess: true,
      }
      setMessages((prev) => [...prev, toolCallMsg])
    })

    const unsubscribeCliToolEnd = window.api.onCliToolEnd(({ id, content, isError }) => {
      if (streamingConversationRef.current && streamingConversationRef.current !== activeConversationRef.current) return
      setMessages((prev) =>
        prev.map((message) =>
          message.toolCallId === id
            ? { ...message, toolResult: content, toolSuccess: !isError, toolInProgress: false }
            : message
        )
      )
    })

    const unsubscribeStreamModel = window.api.onStreamModel((model) => {
      if (streamingConversationRef.current && streamingConversationRef.current !== activeConversationRef.current) return
      streamModelRef.current = model
    })

    return () => {
      unsubscribeRemoteMessage()
      unsubscribeStream()
      unsubscribeError()
      unsubscribeToolCall()
      unsubscribeCliToolStart()
      unsubscribeCliToolEnd()
      unsubscribeStreamModel()
    }
  }, [loadConversations, rateLimitSetterRef, flush])

  useEffect(() => {
    const unsubscribe = window.api.onTeamActivity((step) => {
      setLiveTeamActivity((prev) => {
        const existing = prev.findIndex((entry) => entry.stepId === step.stepId)
        if (existing >= 0) {
          const next = [...prev]
          // Preserve accumulated liveContent when the step transitions to done/error
          next[existing] = { ...step, liveContent: prev[existing].liveContent }
          return next
        }
        return [...prev, step]
      })
    })

    const unsubscribeStream = window.api.onTeamStepStream(({ stepId, chunk }) => {
      setLiveTeamActivity((prev) => {
        const idx = prev.findIndex((entry) => entry.stepId === stepId)
        if (idx < 0) return prev
        const next = [...prev]
        next[idx] = { ...next[idx], liveContent: (next[idx].liveContent ?? '') + chunk }
        return next
      })
    })

    return () => {
      unsubscribe()
      unsubscribeStream()
    }
  }, [])

  const handleRegenerate = useCallback(
    async (modelOverride?: string) => {
      if (!conversationId || messages.length < 2 || isGenerating) return

      const lastMessage = messages[messages.length - 1]
      if (lastMessage.role !== 'assistant') return

      const lastUser = [...messages].reverse().find((message) => message.role === 'user')
      if (!lastUser) return

      // Save the current conversation state so it can be restored if the API
      // call fails, and defer the DB deletion until the new response arrives.
      preRegenMessagesRef.current = [...messages]
      pendingDeleteMessageRef.current = lastMessage

      setMessages((prev) => prev.slice(0, -1))

      streamingConversationRef.current = conversationId
      markConversationGenerating(conversationId)
      setIsGenerating(true)
      setGenerationStartedAt(Date.now())
      resetQueue()
      setStreamingContent('')
      streamingContentRef.current = ''

      const regenerateModel =
        modelOverride ?? (effectiveModel === 'default' ? null : effectiveModel)
      streamModelRef.current = regenerateModel

      try {
        if (modelOverride) {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: 'system',
              content: `Regenerating with ${getModelLabel(modelOverride, catalogModels)}.`,
              timestamp: Date.now(),
            },
          ])
        }

        const options: {
          regenerate: true
          model?: string
          images?: { id: string; name: string; dataUrl: string }[]
          attachments?: { id: string; name: string; path: string; size: number }[]
        } = { regenerate: true }

        if (regenerateModel) options.model = String(regenerateModel)
        if (lastUser.images?.length) options.images = lastUser.images
        const fileAttachments = lastUser.attachments?.filter(
          (attachment): attachment is { id: string; name: string; path: string; size: number } =>
            typeof attachment.path === 'string' && attachment.path.length > 0,
        )
        if (fileAttachments?.length) options.attachments = fileAttachments

        const regenResult = await window.api.sendMessage(String(conversationId), String(lastUser.content), options) as unknown
        if (hasIpcError(regenResult)) throw new Error(regenResult.error)
      } catch (error) {
        console.error('Regenerate failed:', error)
        streamingConversationRef.current = null
        markConversationDoneGenerating(conversationId)
        // Restore the original conversation state on a synchronous IPC failure.
        if (preRegenMessagesRef.current) {
          setMessages(preRegenMessagesRef.current)
          preRegenMessagesRef.current = null
          pendingDeleteMessageRef.current = null
        }
        setIsGenerating(false)
        setGenerationStartedAt(null)
        streamModelRef.current = null
        addToast('Failed to regenerate response', 'error')
      }
    },
    [conversationId, messages, isGenerating, effectiveModel, catalogModels, addToast, markConversationGenerating, markConversationDoneGenerating],
  )

  const handleEdit = useCallback(
    (messageIndex: number) => {
      if (isGenerating) return

      const message = messages[messageIndex]
      if (!message) return

      preEditMessagesRef.current = [...messages]
      editCutoffTimestampRef.current = message.timestamp
      pendingEditedResendRef.current = true
      setIsEditingMessage(true)
      setMessages((prev) => prev.slice(0, messageIndex))
    },
    [messages, isGenerating],
  )

  const cancelEdit = useCallback(() => {
    if (!isEditingMessage) return
    if (preEditMessagesRef.current) {
      setMessages(preEditMessagesRef.current)
    }
    preEditMessagesRef.current = null
    editCutoffTimestampRef.current = null
    pendingEditedResendRef.current = false
    setIsEditingMessage(false)
  }, [isEditingMessage])

  const clearEditState = useCallback(() => {
    preEditMessagesRef.current = null
    editCutoffTimestampRef.current = null
    pendingEditedResendRef.current = false
    setIsEditingMessage(false)
  }, [])

  return {
    messages,
    liveTurnState,
    setMessages,
    isGenerating,
    setIsGenerating,
    streamingContent,
    displayedContent,
    isDraining,
    resetQueue,
    setStreamingContent,
    loadingFailed,
    setLoadingFailed,
    isLoadingMessages,
    liveTeamActivity,
    setLiveTeamActivity,
    generationStartedAt,
    setGenerationStartedAt,
    isEditingMessage,
    streamingContentRef,
    streamModelRef,
    activeConversationRef,
    streamingConversationRef,
    justCreatedConversationRef,
    lastUndoneUserMessageRef,
    pendingEditedResendRef,
    editCutoffTimestampRef,
    cancelEdit,
    clearEditState,
    handleRegenerate,
    handleEdit,
    pushSystemMessage,
    attachArtifact,
    buildConversationMarkdown,
  }
}
