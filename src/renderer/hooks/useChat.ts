import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { getModelLabel } from '../../shared/models'
import type { ChatMessage, ConversationDbMessage, StreamError, TeamActivityStep, ToastType } from './chat-types'

interface UseChatParams {
  conversationId: string | null
  activeAgentId: string | null
  activeProjectId: string | null
  effectiveModel: string
  addToast: (message: string, type?: ToastType) => void
  loadConversations: () => Promise<void>
  conversationCreated: (id: string) => void
  rateLimitSetterRef?: MutableRefObject<(seconds: number) => void>
}

export function useChat({
  conversationId,
  effectiveModel,
  addToast,
  loadConversations,
  rateLimitSetterRef,
}: UseChatParams) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [loadingFailed, setLoadingFailed] = useState(false)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [liveTeamActivity, setLiveTeamActivity] = useState<TeamActivityStep[]>([])
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null)

  const streamingContentRef = useRef('')
  const streamModelRef = useRef<string | null>(null)
  const activeConversationRef = useRef<string | null>(conversationId)
  const justCreatedConversationRef = useRef(false)
  const lastUndoneUserMessageRef = useRef<string | null>(null)
  const pendingEditedResendRef = useRef(false)

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
    setGenerationStartedAt(null)
    setLiveTeamActivity([])
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
        void loadConversations()
        return
      }

      streamingContentRef.current += chunk
      setStreamingContent((prev) => prev + chunk)
    })

    const unsubscribeError = window.api.onStreamError((error: StreamError) => {
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: error.message,
        timestamp: Date.now(),
        isError: true,
        errorType: error.type,
        retryable: error.retryable,
      }

      streamingContentRef.current = ''
      streamModelRef.current = null
      setStreamingContent('')
      setIsGenerating(false)
      setLoadingFailed(true)
      setGenerationStartedAt(null)
      setMessages((prev) => [...prev, errorMessage])

      if (error.type === 'rate_limit') {
        const waitSeconds =
          typeof error.retryAfterSeconds === 'number' && error.retryAfterSeconds > 0
            ? error.retryAfterSeconds
            : 15
        rateLimitSetterRef?.current(waitSeconds)
      }

      void loadConversations()
    })

    return () => {
      unsubscribeStream()
      unsubscribeError()
    }
  }, [loadConversations, rateLimitSetterRef])

  useEffect(() => {
    const unsubscribe = window.api.onTeamActivity((step) => {
      setLiveTeamActivity((prev) => {
        const existing = prev.findIndex((entry) => entry.stepId === step.stepId)
        if (existing >= 0) {
          const next = [...prev]
          next[existing] = step
          return next
        }
        return [...prev, step]
      })
    })

    return () => {
      unsubscribe()
    }
  }, [])

  const handleRegenerate = useCallback(
    async (modelOverride?: string) => {
      if (!conversationId || messages.length < 2 || isGenerating) return

      const lastMessage = messages[messages.length - 1]
      if (lastMessage.role !== 'assistant') return

      const lastUser = [...messages].reverse().find((message) => message.role === 'user')
      if (!lastUser) return

      setMessages((prev) => prev.slice(0, -1))
      await window.api.deleteMessage(lastMessage.id)

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
              content: `Regenerating with ${getModelLabel(modelOverride)}.`,
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

        await window.api.sendMessage(String(conversationId), String(lastUser.content), options)
      } catch (error) {
        console.error('Regenerate failed:', error)
        setIsGenerating(false)
        setGenerationStartedAt(null)
        streamModelRef.current = null
        addToast('Failed to regenerate response', 'error')
      }
    },
    [conversationId, messages, isGenerating, effectiveModel, addToast],
  )

  const handleEdit = useCallback(
    (messageIndex: number) => {
      if (isGenerating) return

      const message = messages[messageIndex]
      if (!message) return

      pendingEditedResendRef.current = true
      setMessages((prev) => prev.slice(0, messageIndex))

      if (conversationId && message.timestamp) {
        window.api.deleteMessagesAfter(conversationId, message.timestamp).catch(() => {
          addToast('Failed to delete messages', 'error')
        })
      }
    },
    [conversationId, messages, isGenerating, addToast],
  )

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
    generationStartedAt,
    setGenerationStartedAt,
    streamingContentRef,
    streamModelRef,
    activeConversationRef,
    justCreatedConversationRef,
    lastUndoneUserMessageRef,
    pendingEditedResendRef,
    handleRegenerate,
    handleEdit,
    pushSystemMessage,
    buildConversationMarkdown,
  }
}
