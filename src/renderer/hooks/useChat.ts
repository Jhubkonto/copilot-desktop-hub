import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { getModelLabel } from '../../shared/models'
import type { CatalogModel } from '../../shared/types'
import type {
  ActivityEvent,
  ChatMessage,
  CliCostSummary,
  ConversationDbMessage,
  StreamError,
  TeamActivityStep,
  ToolCallEvent,
  ToastType,
} from './chat-types'

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
}: UseChatParams) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [loadingFailed, setLoadingFailed] = useState(false)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [isEditingMessage, setIsEditingMessage] = useState(false)
  const [liveTeamActivity, setLiveTeamActivity] = useState<TeamActivityStep[]>([])
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null)
  const [currentActivity, setCurrentActivity] = useState<ActivityEvent | null>(null)
  const [cliCost, setCliCost] = useState<CliCostSummary | null>(null)
  const [liveThinkingBlocks, setLiveThinkingBlocksState] = useState<Map<string, { blockId: string; content: string; done: boolean }>>(new Map())
  const liveThinkingBlocksRef = useRef<Map<string, { blockId: string; content: string; done: boolean }>>(new Map())
  const setLiveThinkingBlocks = (map: Map<string, { blockId: string; content: string; done: boolean }>) => {
    liveThinkingBlocksRef.current = map
    setLiveThinkingBlocksState(map)
  }

  const streamingContentRef = useRef('')
  const ignoreRemoteStreamRef = useRef(false)
  const liveToolCallsRef = useRef<ChatMessage[]>([])
  const streamModelRef = useRef<string | null>(null)
  const activeConversationRef = useRef<string | null>(conversationId)
  // Locked to the conversation that started the current stream; cleared on stream end/error.
  const streamingConversationRef = useRef<string | null>(null)
  const justCreatedConversationRef = useRef(false)
  const lastUndoneUserMessageRef = useRef<string | null>(null)
  const pendingEditedResendRef = useRef(false)
  const editCutoffTimestampRef = useRef<number | null>(null)
  const preEditMessagesRef = useRef<ChatMessage[] | null>(null)
  // Holds the previous assistant message during regeneration so it can be
  // restored to the UI if the API call fails, and deleted from the DB on success.
  const pendingDeleteMessageRef = useRef<ChatMessage | null>(null)
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
  }, [conversationId])

  useEffect(() => {
    if (justCreatedConversationRef.current) {
      justCreatedConversationRef.current = false
      return
    }

    if (conversationId) {
      setIsLoadingMessages(true)
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
        .finally(() => {
          setIsLoadingMessages(false)
        })
    } else {
      setMessages([])
      setIsLoadingMessages(false)
    }

    setStreamingContent('')
    streamingContentRef.current = ''
    setIsGenerating(false)
    setIsEditingMessage(false)
    preEditMessagesRef.current = null
    editCutoffTimestampRef.current = null
    pendingEditedResendRef.current = false
    setGenerationStartedAt(null)
    setLiveTeamActivity([])
    setCurrentActivity(null)
    setCliCost(null)
    setLiveThinkingBlocks(new Map())
    liveToolCallsRef.current = []
    setLoadingFailed(false)
  }, [conversationId, addToast])

  useEffect(() => {
    const unsubscribeRemoteMessage = window.api.onRemoteMessage(({ conversationId: remoteId, content, images }) => {
      if (remoteId !== activeConversationRef.current) {
        ignoreRemoteStreamRef.current = true
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
        ignoreRemoteStreamRef.current = false
        const doneConvId = streamingConversationRef.current ?? activeConversationRef.current ?? ''
        streamingConversationRef.current = null
        const finalContent = streamingContentRef.current
        const hadToolCalls = liveToolCallsRef.current.length > 0
        const displayContent = finalContent || (!hadToolCalls ? '_(no response)_' : '')
        const frozenThinking = liveThinkingBlocksRef.current.size > 0 ? new Map(liveThinkingBlocksRef.current) : null
        if (displayContent) {
          const assistantMessage: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: displayContent,
            timestamp: Date.now(),
            model: streamModelRef.current,
            ...(frozenThinking ? { thinkingBlocks: frozenThinking } : {}),
          }
          setMessages((prev) => [...prev, assistantMessage])
        } else if (frozenThinking) {
          // No text content but there were thinking blocks — attach to last assistant message
          setMessages((prev) => {
            const lastIdx = [...prev].map((m) => m.role).lastIndexOf('assistant')
            if (lastIdx === -1) return prev
            const updated = [...prev]
            updated[lastIdx] = { ...updated[lastIdx], thinkingBlocks: frozenThinking }
            return updated
          })
        }
        setLiveThinkingBlocks(new Map())
        streamingContentRef.current = ''
        streamModelRef.current = null
        setStreamingContent('')
        setIsGenerating(false)
        setLoadingFailed(false)
        setGenerationStartedAt(null)
        setLiveTeamActivity([])
        setCurrentActivity(null)
        liveToolCallsRef.current = []
        markConversationDoneGenerating(doneConvId)
        // Now that the new response arrived, delete the old assistant message from DB.
        if (pendingDeleteMessageRef.current) {
          void window.api.deleteMessage(pendingDeleteMessageRef.current.id)
          pendingDeleteMessageRef.current = null
        }
        preRegenMessagesRef.current = null
        void loadConversations()
        return
      }

      if (ignoreRemoteStreamRef.current) return
      if (streamingConversationRef.current && streamingConversationRef.current !== activeConversationRef.current) return
      streamingContentRef.current += chunk
      setStreamingContent((prev) => prev + chunk)
    })

    const unsubscribeError = window.api.onStreamError((error: StreamError) => {
      const errorConvId = streamingConversationRef.current ?? activeConversationRef.current ?? ''
      streamingConversationRef.current = null
      streamingContentRef.current = ''
      streamModelRef.current = null
      setStreamingContent('')
      setIsGenerating(false)
      setLoadingFailed(false)
      setGenerationStartedAt(null)
      setCurrentActivity(null)
      setCliCost(null)
      liveToolCallsRef.current = []
      markConversationDoneGenerating(errorConvId)

      if (preRegenMessagesRef.current) {
        // Restore the conversation to its state before the failed regeneration
        // so the user doesn't lose their previous response.
        setMessages(preRegenMessagesRef.current)
        preRegenMessagesRef.current = null
        pendingDeleteMessageRef.current = null
        addToastRef.current(error.message, 'error')
      } else {
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
      }

      if (error.type === 'rate_limit') {
        const waitSeconds =
          typeof error.retryAfterSeconds === 'number' && error.retryAfterSeconds > 0
            ? error.retryAfterSeconds
            : 15
        rateLimitSetterRef?.current(waitSeconds)
      }

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

    const unsubscribeCliCost = window.api.onCliCost((data) => {
      if (streamingConversationRef.current && streamingConversationRef.current !== activeConversationRef.current) return
      setCliCost(data)
    })

    const unsubscribeActivity = window.api.onActivity((event) => {
      if (streamingConversationRef.current && streamingConversationRef.current !== activeConversationRef.current) return
      setCurrentActivity(event)
    })

    const unsubscribeStreamModel = window.api.onStreamModel((model) => {
      if (streamingConversationRef.current && streamingConversationRef.current !== activeConversationRef.current) return
      streamModelRef.current = model
    })

    const unsubscribeThinkingDelta = window.api.onThinkingDelta(({ blockId, chunk }) => {
      if (streamingConversationRef.current && streamingConversationRef.current !== activeConversationRef.current) return
      setLiveThinkingBlocksState((prev) => {
        const existing = prev.get(blockId) ?? { blockId, content: '', done: false }
        const next = new Map(prev).set(blockId, { ...existing, content: existing.content + chunk })
        liveThinkingBlocksRef.current = next
        return next
      })
    })

    const unsubscribeThinkingEnd = window.api.onThinkingEnd(({ blockId }) => {
      if (streamingConversationRef.current && streamingConversationRef.current !== activeConversationRef.current) return
      setLiveThinkingBlocksState((prev) => {
        const existing = prev.get(blockId)
        if (!existing) return prev
        const next = new Map(prev).set(blockId, { ...existing, done: true })
        liveThinkingBlocksRef.current = next
        return next
      })
    })

    return () => {
      unsubscribeRemoteMessage()
      unsubscribeStream()
      unsubscribeError()
      unsubscribeToolCall()
      unsubscribeCliToolStart()
      unsubscribeCliToolEnd()
      unsubscribeCliCost()
      unsubscribeActivity()
      unsubscribeStreamModel()
      unsubscribeThinkingDelta()
      unsubscribeThinkingEnd()
    }
  }, [loadConversations, rateLimitSetterRef])

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
      setStreamingContent('')
      streamingContentRef.current = ''
      setLiveThinkingBlocks(new Map())

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
    setMessages,
    isGenerating,
    setIsGenerating,
    streamingContent,
    setStreamingContent,
    loadingFailed,
    setLoadingFailed,
    isLoadingMessages,
    liveTeamActivity,
    setLiveTeamActivity,
    currentActivity,
    setCurrentActivity,
    cliCost,
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
    liveThinkingBlocks,
    setLiveThinkingBlocks,
  }
}
