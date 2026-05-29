import { useCallback, useMemo, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react'
import { getModelLabel } from '../../shared/models'
import type { AgentConfig } from '../../shared/types'
import type { Theme } from '../store/types'
import {
  executeSlashCommand,
  transformCodeSlashCommand,
  type SlashCommandContext,
  type SlashCommandDef,
} from '../slash-commands'
import type {
  AtContextOption,
  ChatMessage,
  ContextRef,
  ContextSnapshot,
  TeamActivityStep,
  ToastType,
} from './chat-types'

function hasIpcError(result: unknown): result is { error: string } {
  return typeof result === 'object' && result !== null && 'error' in result
}

interface UseChatWindowActionsParams {
  conversationId: string | null
  activeAgentId: string | null
  activeProjectId: string | null
  activeAgent: AgentConfig | null
  effectiveModel: string
  effectiveModelLabel: string
  conversationModel: string | null
  theme: Theme
  input: string
  setInput: Dispatch<SetStateAction<string>>
  messages: ChatMessage[]
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>
  isGenerating: boolean
  rateLimitRemainingSec: number
  pendingAttachments: Array<{ id: string; name: string; path: string; size: number }>
  pendingImages: Array<{ id: string; name: string; dataUrl: string }>
  setPendingAttachments: Dispatch<SetStateAction<Array<{ id: string; name: string; path: string; size: number }>>>
  setPendingImages: Dispatch<SetStateAction<Array<{ id: string; name: string; dataUrl: string }>>>
  contextRefs: ContextRef[]
  resolveContextBlock: (refs: ContextRef[]) => Promise<string>
  showSlashMenu: boolean
  closeSlashMenu: () => void
  openSlashMenu: (filter?: string) => void
  filteredSlashCommands: SlashCommandDef[]
  selectedSlashIndex: number
  setSelectedSlashIndex: Dispatch<SetStateAction<number>>
  showAtMenu: boolean
  closeAtMenu: () => void
  openAtMenu: (filter?: string) => void
  filteredAtOptions: AtContextOption[]
  selectedAtIndex: number
  setSelectedAtIndex: Dispatch<SetStateAction<number>>
  inputRef: RefObject<HTMLTextAreaElement | null>
  inputHistoryRef: MutableRefObject<string[]>
  historyIndexRef: MutableRefObject<number>
  historyDraftRef: MutableRefObject<string>
  activeConversationRef: MutableRefObject<string | null>
  justCreatedConversationRef: MutableRefObject<boolean>
  pendingEditedResendRef: MutableRefObject<boolean>
  lastUndoneUserMessageRef: MutableRefObject<string | null>
  streamModelRef: MutableRefObject<string | null>
  streamingContentRef: MutableRefObject<string>
  conversationCreated: (id: string) => void
  setIsGenerating: Dispatch<SetStateAction<boolean>>
  setGenerationStartedAt: Dispatch<SetStateAction<number | null>>
  setStreamingContent: Dispatch<SetStateAction<string>>
  setLoadingFailed: Dispatch<SetStateAction<boolean>>
  setLiveTeamActivity: Dispatch<SetStateAction<TeamActivityStep[]>>
  addToast: (message: string, type?: ToastType) => void
  pushSystemMessage: (content: string) => void
  buildConversationMarkdown: () => string
  newChat: () => void
  login: () => Promise<void>
  logout: () => Promise<void>
  setTheme: (theme: Theme) => void
  loadAgents: () => Promise<void>
  loadConversations: () => Promise<void>
}

export function useChatWindowActions({
  conversationId,
  activeAgentId,
  activeProjectId,
  activeAgent,
  effectiveModel,
  effectiveModelLabel,
  conversationModel,
  theme,
  input,
  setInput,
  messages,
  setMessages,
  isGenerating,
  rateLimitRemainingSec,
  pendingAttachments,
  pendingImages,
  setPendingAttachments,
  setPendingImages,
  contextRefs,
  resolveContextBlock,
  showSlashMenu,
  closeSlashMenu,
  openSlashMenu,
  filteredSlashCommands,
  selectedSlashIndex,
  setSelectedSlashIndex,
  showAtMenu,
  closeAtMenu,
  openAtMenu,
  filteredAtOptions,
  selectedAtIndex,
  setSelectedAtIndex,
  inputRef,
  inputHistoryRef,
  historyIndexRef,
  historyDraftRef,
  activeConversationRef,
  justCreatedConversationRef,
  pendingEditedResendRef,
  lastUndoneUserMessageRef,
  streamModelRef,
  streamingContentRef,
  conversationCreated,
  setIsGenerating,
  setGenerationStartedAt,
  setStreamingContent,
  setLoadingFailed,
  setLiveTeamActivity,
  addToast,
  pushSystemMessage,
  buildConversationMarkdown,
  newChat,
  login,
  logout,
  setTheme,
  loadAgents,
  loadConversations,
}: UseChatWindowActionsParams) {
  const slashCommandCtx = useMemo<SlashCommandContext>(
    () => ({
      conversationId,
      messages: messages.filter((message) => message.role !== 'team-activity') as SlashCommandContext['messages'],
      activeAgent,
      effectiveModelLabel,
      conversationModel,
      theme,
      pushSystemMessage,
      newChat,
      login,
      logout,
      setInput,
      setTheme,
      loadAgents,
      loadConversations,
      buildConversationMarkdown,
      deleteMessagesAfter: (convId: string, ts: number) => window.api.deleteMessagesAfter(convId, ts).then(() => undefined),
      lastUndoneUserMessageRef,
      setMessages: setMessages as SlashCommandContext['setMessages'],
    }),
    [
      conversationId,
      messages,
      activeAgent,
      effectiveModelLabel,
      conversationModel,
      theme,
      pushSystemMessage,
      newChat,
      login,
      logout,
      setInput,
      setTheme,
      loadAgents,
      loadConversations,
      buildConversationMarkdown,
      lastUndoneUserMessageRef,
      setMessages,
    ],
  )

  const customSlashCommands = useMemo<SlashCommandDef[]>(
    () =>
      (activeAgent?.customCommands ?? [])
        .filter((command) => command.name.slice(1).startsWith((input.match(/^\/([a-z-]*)$/i)?.[1] ?? '').toLowerCase()))
        .map((command) => ({
          name: command.name,
          usage: command.name,
          description: command.description,
        })),
    [activeAgent, input],
  )

  const visibleSlashCommands = useMemo(
    () => [...filteredSlashCommands, ...customSlashCommands].slice(0, 8),
    [filteredSlashCommands, customSlashCommands],
  )

  const visibleAtOptions = useMemo(() => filteredAtOptions.slice(0, 6), [filteredAtOptions])

  const handleSelectSlashCommand = useCallback(
    (command: SlashCommandDef) => {
      setInput(`${command.name} `)
      closeSlashMenu()
      inputRef.current?.focus()
    },
    [closeSlashMenu, inputRef, setInput],
  )

  const handleSelectAtOption = useCallback(
    (option: AtContextOption) => {
      const atMatch = input.match(/(^|\s)@([a-z]*)$/i)
      if (atMatch) {
        setInput((prev) => `${prev.slice(0, atMatch.index)}${atMatch[1]}${option.token} `)
      } else {
        setInput((prev) => `${prev} ${option.token} `.trimStart())
      }
      closeAtMenu()
      inputRef.current?.focus()
    },
    [closeAtMenu, input, inputRef, setInput],
  )

  const handleInputChange = useCallback(
    (next: string) => {
      setInput(next)
      historyIndexRef.current = -1
      historyDraftRef.current = ''

      const slashMatch = next.match(/^\/([a-z-]*)$/i)
      if (slashMatch) openSlashMenu(slashMatch[1] ?? '')
      else closeSlashMenu()

      const atMatch = next.match(/(^|\s)@([a-z]*)$/i)
      if (atMatch) openAtMenu(atMatch[2] ?? '')
      else closeAtMenu()
    },
    [closeAtMenu, closeSlashMenu, historyDraftRef, historyIndexRef, openAtMenu, openSlashMenu, setInput],
  )

  const handleSend = useCallback(async () => {
    if (!input.trim() || isGenerating || rateLimitRemainingSec > 0) return

    let content = input.trim()
    if (content.startsWith('/')) {
      const transformed = transformCodeSlashCommand(content)
      if (transformed) {
        content = transformed
      } else {
        const handled = await executeSlashCommand(content, slashCommandCtx)
        if (handled) {
          setInput('')
          closeSlashMenu()
          return
        }
      }
    }

    if (input.trim().startsWith('/')) closeSlashMenu()

    const attachments = pendingAttachments.length > 0 ? [...pendingAttachments] : undefined
    const images = pendingImages.length > 0 ? [...pendingImages] : undefined
    const autoRefs: ContextRef[] = []

    if (activeAgent?.contextRules?.autoInjectWorkspace && !contextRefs.some((ref) => ref.key === 'workspace')) {
      autoRefs.push({ key: 'workspace', token: '@workspace' })
    }
    if (activeAgent?.contextRules?.autoInjectGit && !contextRefs.some((ref) => ref.key === 'git')) {
      autoRefs.push({ key: 'git', token: '@git' })
    }

    const effectiveRefs = [...contextRefs, ...autoRefs]
    const cleanedContent = content
      .replace(/(?:^|\s)@(workspace|git)\b/gi, ' ')
      .replace(/(?:^|\s)@file:[^\s]+/gi, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()

    if (effectiveRefs.length > 0) {
      try {
        const contextBlock = await resolveContextBlock(effectiveRefs)
        if (contextBlock) {
          content = `${contextBlock}\n\n${cleanedContent || 'Please use the attached context.'}`
        }
      } catch {
        addToast('Failed to resolve @context references', 'error')
      }
    }

    const userDisplayContent = input.trim()
    const systemPrompt = activeAgent?.systemPrompt ?? ''
    const tokenEstimate = (value: string) => Math.ceil(value.length / 4)
    const contextSnapshot: ContextSnapshot = {
      systemPrompt,
      contextRefs: effectiveRefs.map((ref) => ({ token: ref.token, key: ref.key })),
      attachments: pendingAttachments.map((attachment) => ({ name: attachment.name, size: attachment.size })),
      historyLength: messages.filter((message) => message.role !== 'system').length,
      estimatedTokens:
        tokenEstimate(systemPrompt) +
        effectiveRefs.reduce((sum, ref) => sum + (ref.key === 'workspace' ? 500 : ref.key === 'git' ? 200 : 300), 0) +
        messages.filter((message) => message.role !== 'system').length * 200 +
        tokenEstimate(userDisplayContent),
      model: effectiveModel,
      timestamp: Date.now(),
    }
    const contextSnapshotJson = JSON.stringify(contextSnapshot)

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userDisplayContent,
      timestamp: Date.now(),
      attachments,
      images,
      isEdited: pendingEditedResendRef.current,
      contextSnapshot: contextSnapshotJson,
    }
    pendingEditedResendRef.current = false

    setMessages((prev) => [...prev, userMessage])
    const sent = input.trim()
    if (sent && inputHistoryRef.current[0] !== sent) {
      inputHistoryRef.current = [sent, ...inputHistoryRef.current].slice(0, 100)
    }
    historyIndexRef.current = -1
    historyDraftRef.current = ''
    setInput('')
    setPendingAttachments([])
    setPendingImages([])
    setLoadingFailed(false)
    setIsGenerating(true)
    setGenerationStartedAt(Date.now())
    setStreamingContent('')
    setLiveTeamActivity([])
    streamingContentRef.current = ''
    const requestModel = effectiveModel === 'default' ? undefined : effectiveModel
    streamModelRef.current = requestModel ?? null

    let conversation = activeConversationRef.current
    if (!conversation) {
      conversation = crypto.randomUUID()
      justCreatedConversationRef.current = true
      conversationCreated(conversation)
      activeConversationRef.current = conversation
    }

    try {
      await window.api.sendMessage(conversation, content, {
        attachments,
        images,
        agentId: activeAgentId ?? undefined,
        model: requestModel,
        messageId: userMessage.id,
        projectId: activeProjectId ?? undefined,
        contextSnapshot: contextSnapshotJson,
      })
    } catch (error) {
      console.error('Failed to send message:', error)
      setIsGenerating(false)
      setLoadingFailed(true)
      setGenerationStartedAt(null)
      streamModelRef.current = null
      addToast('Failed to send message. Please try again.', 'error')
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'Failed to send message. Please check your connection and try again.',
          timestamp: Date.now(),
          isError: true,
          errorType: 'network',
          retryable: true,
        },
      ])
    }
  }, [
    input,
    isGenerating,
    rateLimitRemainingSec,
    slashCommandCtx,
    setInput,
    closeSlashMenu,
    pendingAttachments,
    pendingImages,
    activeAgent,
    contextRefs,
    resolveContextBlock,
    addToast,
    messages,
    effectiveModel,
    pendingEditedResendRef,
    setMessages,
    inputHistoryRef,
    historyIndexRef,
    historyDraftRef,
    setPendingAttachments,
    setPendingImages,
    setLoadingFailed,
    setIsGenerating,
    setGenerationStartedAt,
    setStreamingContent,
    setLiveTeamActivity,
    streamingContentRef,
    streamModelRef,
    activeConversationRef,
    justCreatedConversationRef,
    conversationCreated,
    activeAgentId,
    activeProjectId,
  ])

  const handleRetry = useCallback(async () => {
    if (isGenerating || messages.length < 1) return

    const lastUser = [...messages].reverse().find((message) => message.role === 'user')
    if (!lastUser) return

    const trimmedMessages = [...messages]
    while (trimmedMessages.length > 0 && trimmedMessages[trimmedMessages.length - 1].isError) {
      const errorMessage = trimmedMessages.pop()!
      await window.api.deleteMessage(errorMessage.id).catch(() => {})
    }
    setMessages(trimmedMessages)

    setIsGenerating(true)
    setGenerationStartedAt(Date.now())
    setStreamingContent('')
    streamingContentRef.current = ''

    const conversation = activeConversationRef.current
    if (!conversation) return

    try {
      await window.api.sendMessage(conversation, lastUser.content, {
        regenerate: true,
        model: effectiveModel === 'default' ? undefined : effectiveModel,
      })
    } catch (error) {
      console.error('Retry failed:', error)
      setIsGenerating(false)
      setGenerationStartedAt(null)
      streamModelRef.current = null
      addToast('Retry failed. Please try again.', 'error')
    }
  }, [
    isGenerating,
    messages,
    setMessages,
    setIsGenerating,
    setGenerationStartedAt,
    setStreamingContent,
    streamingContentRef,
    activeConversationRef,
    effectiveModel,
    streamModelRef,
    addToast,
  ])

  const handleEdit = useCallback(
    (messageIndex: number, truncate: (index: number) => void) => {
      const message = messages[messageIndex]
      if (!message) return
      setInput(message.content)
      inputRef.current?.focus()
      truncate(messageIndex)
    },
    [messages, inputRef, setInput],
  )

  const handleSignIn = useCallback(() => {
    void login()
  }, [login])

  const handleSetConversationModel = useCallback(
    async (model: string) => {
      if (!conversationId) return
      const value = model === 'default' ? null : model
      try {
        const result = await window.api.setConversationModel(conversationId, value)
        if (hasIpcError(result)) throw new Error(result.error)
        await loadConversations()
        addToast(`Model set to ${getModelLabel(model)}`, 'success')
      } catch {
        addToast('Failed to set conversation model', 'error')
      }
    },
    [conversationId, loadConversations, addToast],
  )

  const handleStop = useCallback(async () => {
    try {
      await window.api.stopGeneration(conversationId ?? undefined)
      const partialContent = streamingContentRef.current
      if (partialContent) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: partialContent,
            timestamp: Date.now(),
            model: streamModelRef.current,
            isStopped: true,
          },
        ])
      }
      streamingContentRef.current = ''
      streamModelRef.current = null
      setStreamingContent('')
      setIsGenerating(false)
      setGenerationStartedAt(null)
    } catch {
      addToast('Failed to stop generation', 'error')
    }
  }, [
    conversationId,
    streamingContentRef,
    streamModelRef,
    setMessages,
    setStreamingContent,
    setIsGenerating,
    setGenerationStartedAt,
    addToast,
  ])

  const handleKeyDown = useCallback(
    async (event: React.KeyboardEvent<HTMLTextAreaElement>, onSend: () => Promise<void>) => {
      if (showAtMenu) {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setSelectedAtIndex((prev) => (visibleAtOptions.length === 0 ? 0 : (prev + 1) % visibleAtOptions.length))
          return
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setSelectedAtIndex((prev) =>
            visibleAtOptions.length === 0 ? 0 : (prev - 1 + visibleAtOptions.length) % visibleAtOptions.length,
          )
          return
        }
        if (event.key === 'Enter' && !event.shiftKey && visibleAtOptions.length > 0) {
          event.preventDefault()
          handleSelectAtOption(visibleAtOptions[selectedAtIndex] ?? visibleAtOptions[0])
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          closeAtMenu()
          return
        }
      }

      if (showSlashMenu) {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setSelectedSlashIndex((prev) => (visibleSlashCommands.length === 0 ? 0 : (prev + 1) % visibleSlashCommands.length))
          return
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setSelectedSlashIndex((prev) =>
            visibleSlashCommands.length === 0 ? 0 : (prev - 1 + visibleSlashCommands.length) % visibleSlashCommands.length,
          )
          return
        }
        if (((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') && visibleSlashCommands.length > 0) {
          event.preventDefault()
          handleSelectSlashCommand(visibleSlashCommands[selectedSlashIndex] ?? visibleSlashCommands[0])
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          closeSlashMenu()
          return
        }
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        await onSend()
        return
      }

      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault()
        const history = inputHistoryRef.current
        if (history.length === 0) return

        if (event.key === 'ArrowUp') {
          if (historyIndexRef.current === -1) historyDraftRef.current = input
          const nextIndex = Math.min(historyIndexRef.current + 1, history.length - 1)
          historyIndexRef.current = nextIndex
          setInput(history[nextIndex])
          return
        }

        if (historyIndexRef.current === -1) return
        const nextIndex = historyIndexRef.current - 1
        historyIndexRef.current = nextIndex
        setInput(nextIndex === -1 ? historyDraftRef.current : history[nextIndex])
      }
    },
    [
      showAtMenu,
      setSelectedAtIndex,
      visibleAtOptions,
      handleSelectAtOption,
      selectedAtIndex,
      closeAtMenu,
      showSlashMenu,
      setSelectedSlashIndex,
      visibleSlashCommands,
      handleSelectSlashCommand,
      selectedSlashIndex,
      closeSlashMenu,
      inputHistoryRef,
      historyIndexRef,
      historyDraftRef,
      input,
      setInput,
    ],
  )

  return {
    visibleSlashCommands,
    visibleAtOptions,
    handleSelectSlashCommand,
    handleSelectAtOption,
    handleInputChange,
    handleSend,
    handleRetry,
    handleEdit,
    handleSignIn,
    handleSetConversationModel,
    handleStop,
    handleKeyDown,
  }
}
