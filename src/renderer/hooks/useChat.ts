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
}

export function useChat({
  conversationId,
  effectiveModel,
  catalogModels,
  addToast,
  loadConversations,
  rateLimitSetterRef,
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

  const streamingContentRef = useRef('')
  const liveToolCallsRef = useRef<ChatMessage[]>([])
  const streamModelRef = useRef<string | null>(null)
  const activeConversationRef = useRef<string | null>(conversationId)
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

            return dbMessages.map((message) => ({
              id: message.id,
              role: message.role as ChatMessage['role'],
              content: message.content,
              timestamp: message.timestamp,
              model: message.model ?? null,
              isEdited: message.is_edited === 1,
              attachments: message.attachments ? JSON.parse(message.attachments) : undefined,
              images: imageMap.get(message.id),
              contextSnapshot: message.context_snapshot ?? undefined,
            }))
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
    liveToolCallsRef.current = []
    setLoadingFailed(false)
  }, [conversationId, addToast])

  useEffect(() => {
    const unsubscribeStream = window.api.onStreamResponse((chunk: string | null) => {
      if (chunk === null) {
        const finalContent = streamingContentRef.current
        if (finalContent) {
          const assistantMessage: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: finalContent,
            timestamp: Date.now(),
            model: streamModelRef.current,
          }
          setMessages((prev) => [...prev, assistantMessage])
        }
        streamingContentRef.current = ''
        streamModelRef.current = null
        setStreamingContent('')
        setIsGenerating(false)
        setLoadingFailed(false)
        setGenerationStartedAt(null)
        setLiveTeamActivity([])
        setCurrentActivity(null)
        liveToolCallsRef.current = []
        // Now that the new response arrived, delete the old assistant message from DB.
        if (pendingDeleteMessageRef.current) {
          void window.api.deleteMessage(pendingDeleteMessageRef.current.id)
          pendingDeleteMessageRef.current = null
        }
        preRegenMessagesRef.current = null
        void loadConversations()
        return
      }

      streamingContentRef.current += chunk
      setStreamingContent((prev) => prev + chunk)
    })

    const unsubscribeError = window.api.onStreamError((error: StreamError) => {
      streamingContentRef.current = ''
      streamModelRef.current = null
      setStreamingContent('')
      setIsGenerating(false)
      setLoadingFailed(false)
      setGenerationStartedAt(null)
      setCurrentActivity(null)
      setCliCost(null)
      liveToolCallsRef.current = []

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
      setMessages((prev) =>
        prev.map((message) =>
          message.toolCallId === id
            ? { ...message, toolResult: content, toolSuccess: !isError, toolInProgress: false }
            : message
        )
      )
    })

    const unsubscribeCliCost = window.api.onCliCost((data) => {
      setCliCost(data)
    })

    const unsubscribeActivity = window.api.onActivity((event) => {
      setCurrentActivity(event)
    })

    const unsubscribeStreamModel = window.api.onStreamModel((model) => {
      streamModelRef.current = model
    })

    return () => {
      unsubscribeStream()
      unsubscribeError()
      unsubscribeToolCall()
      unsubscribeCliToolStart()
      unsubscribeCliToolEnd()
      unsubscribeCliCost()
      unsubscribeActivity()
      unsubscribeStreamModel()
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

      setIsGenerating(true)
      setGenerationStartedAt(Date.now())
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
        if (lastUser.attachments?.length) options.attachments = lastUser.attachments

        const regenResult = await window.api.sendMessage(String(conversationId), String(lastUser.content), options) as unknown
        if (hasIpcError(regenResult)) throw new Error(regenResult.error)
      } catch (error) {
        console.error('Regenerate failed:', error)
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
    [conversationId, messages, isGenerating, effectiveModel, catalogModels, addToast],
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
    justCreatedConversationRef,
    lastUndoneUserMessageRef,
    pendingEditedResendRef,
    editCutoffTimestampRef,
    cancelEdit,
    clearEditState,
    handleRegenerate,
    handleEdit,
    pushSystemMessage,
    buildConversationMarkdown,
  }
}
