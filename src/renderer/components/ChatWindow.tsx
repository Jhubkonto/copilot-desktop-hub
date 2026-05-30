import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { getModelLabel } from '../../shared/models'
import { isApiError, type AgentConfig } from '../../shared/types'
import type { ContextRef, ToastType } from '../hooks/chat-types'
import { useAtMenu } from '../hooks/useAtMenu'
import { useChat } from '../hooks/useChat'
import { useChatWindowActions } from '../hooks/useChatWindowActions'
import { useFileInput } from '../hooks/useFileInput'
import { useSlashMenu } from '../hooks/useSlashMenu'
import { useTimers } from '../hooks/useTimers'
import { useAppStore } from '../store/app-store'
import { ChatComposer } from './chat/ChatComposer'
import { ChatMessages } from './chat/ChatMessages'

export function ChatWindow() {
  const conversationId = useAppStore((state) => state.currentConversationId)
  const activeAgentId = useAppStore((state) => state.activeAgentId)
  const activeProjectId = useAppStore((state) => state.activeProjectId)
  const projects = useAppStore((state) => state.projects)
  const agents = useAppStore((state) => state.agents)
  const conversations = useAppStore((state) => state.conversations)
  const authenticated = useAppStore((state) => state.authState.authenticated)
  const theme = useAppStore((state) => state.theme)
  const conversationCreated = useAppStore((state) => state.conversationCreated)
  const loadConversations = useAppStore((state) => state.loadConversations)
  const loadAgents = useAppStore((state) => state.loadAgents)
  const newChat = useAppStore((state) => state.newChat)
  const setActiveProjectId = useAppStore((state) => state.setActiveProjectId)
  const setActiveAgentId = useAppStore((state) => state.setActiveAgentId)
  const setTheme = useAppStore((state) => state.setTheme)
  const login = useAppStore((state) => state.login)
  const logout = useAppStore((state) => state.logout)
  const addToast = useAppStore((state) => state.addToast) as (
    message: string,
    type?: ToastType,
  ) => void
  const markConversationUnread = useAppStore((state) => state.markConversationUnread)
  const markConversationRead = useAppStore((state) => state.markConversationRead)

  const [defaultModelSetting, setDefaultModelSetting] = useState('default')
  const [pendingModel, setPendingModel] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [showContextInspector, setShowContextInspector] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [projectRootDir, setProjectRootDir] = useState<string | null>(null)
  const [inputPanelHeight, setInputPanelHeight] = useState<number | null>(null)
  const [openContextPicker, setOpenContextPicker] = useState<'project' | 'agent' | null>(null)
  const [hasUnreadBelow, setHasUnreadBelow] = useState(false)
  const [clipboardRef, setClipboardRef] = useState<ContextRef | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isUserScrolledUpRef = useRef(false)
  const prevGeneratingRef = useRef(false)
  const prevMessagesLengthRef = useRef(0)
  const modelPickerRef = useRef<HTMLButtonElement>(null)
  const contextPickerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const inputPanelResizeRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const inputHistoryRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  const historyDraftRef = useRef('')
  const rateLimitSetterRef = useRef<(seconds: number) => void>(() => {})
  const lastClipboardSigRef = useRef('')

  const currentConversation = conversationId
    ? (conversations.find((conversation) => conversation.id === conversationId) ?? null)
    : null
  const isNewChat = !currentConversation
  const conversationModel = currentConversation?.model ?? null
  const chatProjectId = isNewChat ? activeProjectId : (currentConversation?.project_id ?? null)
  const chatProject = chatProjectId
    ? (projects.find((project) => project.id === chatProjectId) ?? null)
    : null
  const chatAgentId = isNewChat ? activeAgentId : (currentConversation?.agent_id ?? null)
  const chatAgent = chatAgentId ? (agents.find((agent) => agent.id === chatAgentId) ?? null) : null
  const projectDefaultModel = chatProject?.default_model ?? null
  const effectiveModel = pendingModel || conversationModel || chatAgent?.model || projectDefaultModel || defaultModelSetting || 'default'
  const effectiveModelLabel = getModelLabel(effectiveModel)

  const chat = useChat({
    conversationId,
    activeAgentId: chatAgentId,
    activeProjectId: chatProjectId,
    effectiveModel,
    addToast,
    loadConversations,
    conversationCreated,
    rateLimitSetterRef,
  })
  const fileInput = useFileInput()
  const slashMenu = useSlashMenu()
  const atMenu = useAtMenu({ input, setInput })
  const mergedContextRefs = useMemo(() => {
    if (!clipboardRef) return atMenu.contextRefs
    return [...atMenu.contextRefs, clipboardRef]
  }, [atMenu.contextRefs, clipboardRef])
  const timers = useTimers({
    isGenerating: chat.isGenerating,
    generationStartedAt: chat.generationStartedAt,
  })
  rateLimitSetterRef.current = timers.setRateLimitRemainingSec

  const actions = useChatWindowActions({
    conversationId,
    chatAgentId,
    chatProjectId,
    activeAgent: chatAgent,
    effectiveModel,
    effectiveModelLabel,
    conversationModel,
    theme,
    input,
    setInput,
    messages: chat.messages,
    setMessages: chat.setMessages,
    isGenerating: chat.isGenerating,
    rateLimitRemainingSec: timers.rateLimitRemainingSec,
    pendingAttachments: fileInput.pendingAttachments,
    pendingImages: fileInput.pendingImages,
    setPendingAttachments: fileInput.setPendingAttachments,
    setPendingImages: fileInput.setPendingImages,
    contextRefs: mergedContextRefs,
    resolveContextBlock: atMenu.resolveContextBlock,
    showSlashMenu: slashMenu.showSlashMenu,
    closeSlashMenu: slashMenu.closeSlashMenu,
    openSlashMenu: slashMenu.openSlashMenu,
    filteredSlashCommands: slashMenu.filteredSlashCommands,
    selectedSlashIndex: slashMenu.selectedSlashIndex,
    setSelectedSlashIndex: slashMenu.setSelectedSlashIndex,
    showAtMenu: atMenu.showAtMenu,
    closeAtMenu: atMenu.closeAtMenu,
    openAtMenu: atMenu.openAtMenu,
    filteredAtOptions: atMenu.filteredAtOptions,
    selectedAtIndex: atMenu.selectedAtIndex,
    setSelectedAtIndex: atMenu.setSelectedAtIndex,
    inputRef,
    inputHistoryRef,
    historyIndexRef,
    historyDraftRef,
    activeConversationRef: chat.activeConversationRef,
    justCreatedConversationRef: chat.justCreatedConversationRef,
    pendingEditedResendRef: chat.pendingEditedResendRef,
    lastUndoneUserMessageRef: chat.lastUndoneUserMessageRef,
    streamModelRef: chat.streamModelRef,
    streamingContentRef: chat.streamingContentRef,
    conversationCreated,
    setIsGenerating: chat.setIsGenerating,
    setGenerationStartedAt: chat.setGenerationStartedAt,
    setStreamingContent: chat.setStreamingContent,
    setLoadingFailed: chat.setLoadingFailed,
    setLiveTeamActivity: chat.setLiveTeamActivity,
    addToast,
    pushSystemMessage: chat.pushSystemMessage,
    buildConversationMarkdown: chat.buildConversationMarkdown,
    newChat,
    login,
    logout,
    setTheme,
    loadAgents,
    loadConversations,
    onAfterSend: () => setClipboardRef(null),
  })

  useLayoutEffect(() => {
    const element = inputRef.current
    if (!element) return
    element.style.height = 'auto'
    const floor = inputPanelHeight ?? 0
    element.style.height = `${Math.min(Math.max(floor, element.scrollHeight), 400)}px`
  }, [input, inputPanelHeight])

  useEffect(() => {
    window.api
      .getSetting('default_model')
      .then((value) => setDefaultModelSetting(typeof value === 'string' ? value : 'default'))
      .catch(() => setDefaultModelSetting('default'))
  }, [conversationId])

  useEffect(() => {
    const goOnline = () => setIsOnline(true)
    const goOffline = () => setIsOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  useEffect(() => {
    if (!chatProjectId || chatProjectId === '__none__') {
      setProjectRootDir(null)
      return
    }

    window.api
      .getProjectConfig(chatProjectId)
      .then((config: unknown) => {
        const rootDir =
          config && typeof config === 'object' && 'rootDirectory' in config && typeof (config as Record<string, unknown>).rootDirectory === 'string'
            ? ((config as Record<string, unknown>).rootDirectory as string)
            : null
        setProjectRootDir(rootDir || null)
      })
      .catch(() => setProjectRootDir(null))
  }, [chatProjectId])

  useEffect(() => {
    setPendingModel(null)
  }, [conversationId])

  useEffect(() => {
    if (!openContextPicker) return

    const handlePointerDown = (event: MouseEvent) => {
      if (contextPickerRef.current?.contains(event.target as Node)) return
      setOpenContextPicker(null)
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [openContextPicker])

  useEffect(() => {
    if (chat.isGenerating) {
      setOpenContextPicker(null)
    }
  }, [chat.isGenerating])

  useEffect(() => {
    const unsubscribe = window.api.onAutoClipboardFocus(async () => {
      const setting = await window.api.getSetting('autoClipboard').catch(() => null)
      if (setting !== 'true') return

      const result = await window.api.readClipboardContent().catch(() => null)
      if (!result || isApiError(result)) return
      if (result.type !== 'text') return

      const sig = result.text.slice(0, 64)
      if (sig === lastClipboardSigRef.current) return
      lastClipboardSigRef.current = sig

      if (result.text.length > 4000) return
      setClipboardRef({ key: 'clipboard', token: '@clipboard', value: result.text })
    })
    return unsubscribe
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    isUserScrolledUpRef.current = false
    setHasUnreadBelow(false)
    if (conversationId) markConversationRead(conversationId)
  }, [conversationId, markConversationRead])

  const handleScrollContainerScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const SCROLL_UP_THRESHOLD = 80
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_UP_THRESHOLD
    isUserScrolledUpRef.current = !atBottom
    if (atBottom) {
      setHasUnreadBelow(false)
      if (conversationId) markConversationRead(conversationId)
    }
  }, [conversationId, markConversationRead])

  // Auto-scroll only when user is at the bottom
  useEffect(() => {
    if (!isUserScrolledUpRef.current) {
      scrollToBottom()
    }
  }, [chat.messages, chat.streamingContent, scrollToBottom])

  // Track new content arriving while user is scrolled up → mark unread
  useEffect(() => {
    const newMessages = chat.messages.length > prevMessagesLengthRef.current
    const hasStreaming = chat.streamingContent !== ''
    if (isUserScrolledUpRef.current && (newMessages || hasStreaming)) {
      setHasUnreadBelow(true)
      if (conversationId) markConversationUnread(conversationId)
    }
    prevMessagesLengthRef.current = chat.messages.length
  }, [chat.messages, chat.streamingContent, conversationId, markConversationUnread])

  // Force scroll to bottom whenever a new generation begins (user just sent a message)
  useEffect(() => {
    if (chat.isGenerating) {
      scrollToBottom()
    }
  }, [chat.isGenerating, scrollToBottom])

  // Reset scroll state on conversation switch
  useEffect(() => {
    prevMessagesLengthRef.current = 0
    isUserScrolledUpRef.current = false
    setHasUnreadBelow(false)
    if (conversationId) markConversationRead(conversationId)
    // Defer so the new messages have rendered before scrolling
    requestAnimationFrame(() => scrollToBottom())
  }, [conversationId, scrollToBottom, markConversationRead])

  // Completion notification — only for successful responses (not stopped/errored)
  useEffect(() => {
    if (prevGeneratingRef.current && !chat.isGenerating && isUserScrolledUpRef.current) {
      const lastMsg = chat.messages[chat.messages.length - 1]
      if (lastMsg && !lastMsg.isError && !lastMsg.isStopped) {
        addToast('Response complete ✓', 'success')
      }
    }
    prevGeneratingRef.current = chat.isGenerating
  }, [chat.isGenerating, chat.messages, addToast])

  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content)
  }, [])

  const handleCaptureScreen = useCallback(async () => {
    const permission = await window.api.checkScreenPermission()
    if (isApiError(permission)) {
      addToast('Failed to check screen permission', 'error')
      return
    }
    if (permission === 'denied') {
      addToast(
        'Screen recording permission denied. Enable in System Settings → Privacy & Security → Screen Recording.',
        'error',
      )
      return
    }
    const result = await window.api.captureScreen()
    if (isApiError(result)) {
      if (!result.error.includes('cancelled')) {
        addToast(result.error, 'error')
      }
      return
    }
    fileInput.setPendingImages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: 'Screen capture',
        dataUrl: result.dataUrl,
        ...(result.windowLabel ? { label: result.windowLabel } : {}),
      },
    ])
  }, [addToast, fileInput])

  const handlePasteClipboard = useCallback(async () => {
    const result = await window.api.readClipboardContent()
    if (!result) {
      addToast('No content found in clipboard', 'info')
      return
    }
    if (isApiError(result)) {
      addToast('Failed to read clipboard', 'error')
      return
    }
    if (result.type === 'image') {
      fileInput.setPendingImages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), name: 'Clipboard image', dataUrl: result.dataUrl },
      ])
    } else {
      if (result.text.length > 4000) {
        addToast('Clipboard text truncated to 4000 characters', 'info')
      }
      setClipboardRef({ key: 'clipboard', token: '@clipboard', value: result.text })
    }
  }, [addToast, fileInput])

  const handleToggleImageMode = useCallback(async (id: string) => {
    const image = fileInput.pendingImages.find((img) => img.id === id)
    if (!image) return

    if (image.mode === 'text') {
      fileInput.setPendingImages((prev) =>
        prev.map((img) => img.id === id ? { ...img, mode: undefined, ocrText: undefined, ocrPending: false } : img)
      )
      return
    }

    fileInput.setPendingImages((prev) =>
      prev.map((img) => img.id === id ? { ...img, ocrPending: true } : img)
    )

    const result = await window.api.ocrImage(image.dataUrl)
    if ('error' in result) {
      addToast(`OCR failed: ${result.error}`, 'error')
      fileInput.setPendingImages((prev) =>
        prev.map((img) => img.id === id ? { ...img, ocrPending: false } : img)
      )
      return
    }

    if (!result.text.trim()) {
      addToast('No text detected in image', 'info')
      fileInput.setPendingImages((prev) =>
        prev.map((img) => img.id === id ? { ...img, ocrPending: false } : img)
      )
      return
    }

    fileInput.setPendingImages((prev) =>
      prev.map((img) =>
        img.id === id ? { ...img, mode: 'text', ocrText: result.text, ocrPending: false } : img
      )
    )
  }, [addToast, fileInput])

  const handleEditMessage = useCallback(
    (index: number) => actions.handleEdit(index, chat.handleEdit),
    [actions.handleEdit, chat.handleEdit],
  )

  const handlePickModel = useCallback(() => {
    modelPickerRef.current?.focus()
  }, [])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      void actions.handleKeyDown(event, actions.handleSend)
    },
    [actions],
  )

  const handleInputResizePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    inputPanelResizeRef.current = {
      startY: event.clientY,
      startHeight: inputRef.current?.offsetHeight ?? 40,
    }
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      if (!inputPanelResizeRef.current) return
      const { startY, startHeight } = inputPanelResizeRef.current
      setInputPanelHeight(Math.max(40, Math.min(400, startHeight + (startY - moveEvent.clientY))))
    }
    const onUp = () => {
      inputPanelResizeRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  const updateConversationContext = useCallback(
    async (updates: { projectId?: string | null; agentId?: string | null }) => {
      if (!currentConversation) return
      try {
        const result = await window.api.updateConversationContext(currentConversation.id, updates)
        if (isApiError(result)) {
          addToast('Failed to update chat context', 'error')
          return
        }
        await loadConversations()
      } catch {
        addToast('Failed to update chat context', 'error')
      }
    },
    [addToast, currentConversation, loadConversations],
  )

  const handleProjectContextChange = useCallback(
    async (projectId: string | null) => {
      setOpenContextPicker(null)
      if (isNewChat) {
        setActiveProjectId(projectId)
        return
      }
      await updateConversationContext({ projectId })
    },
    [isNewChat, setActiveProjectId, updateConversationContext],
  )

  const handleAgentContextChange = useCallback(
    async (agentId: string | null) => {
      setOpenContextPicker(null)
      if (isNewChat) {
        setActiveAgentId(agentId)
        return
      }
      await updateConversationContext({ agentId })
    },
    [isNewChat, setActiveAgentId, updateConversationContext],
  )

  const contextBar = (
    <div
      ref={contextPickerRef}
      className="flex items-center gap-2 px-4 h-9 border-b border-gray-200 dark:border-gray-700/80 bg-gray-50 dark:bg-gray-800/50"
      aria-label="Chat context"
    >
      <div className="relative">
        <button
          type="button"
          disabled={chat.isGenerating}
          onClick={() => setOpenContextPicker((current) => (current === 'project' ? null : 'project'))}
          className="inline-flex items-center gap-1 px-2 rounded-full text-xs font-medium bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ lineHeight: '20px' }}
          aria-label="Select project context"
        >
          {chatProject ? (
            <>
              <span className={`w-2 h-2 rounded-full bg-${chatProject.color}-400`} aria-hidden="true" />
              {chatProject.name}
            </>
          ) : (
            'No project'
          )}
          <span className="text-gray-400" aria-hidden="true">▾</span>
        </button>
        {openContextPicker === 'project' && (
          <div className="absolute left-0 top-full mt-1 z-20 w-56 max-h-72 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg p-1">
            <button
              type="button"
              onClick={() => void handleProjectContextChange(null)}
              className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                chatProjectId === null ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <span>No project</span>
              {chatProjectId === null && <span aria-hidden="true">✓</span>}
            </button>
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => void handleProjectContextChange(project.id)}
                className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  chatProjectId === project.id ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 bg-${project.color}-400`} aria-hidden="true" />
                  <span className="truncate">{project.name}</span>
                </span>
                {chatProjectId === project.id && <span aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative">
        <button
          type="button"
          disabled={chat.isGenerating}
          onClick={() => setOpenContextPicker((current) => (current === 'agent' ? null : 'agent'))}
          className="inline-flex items-center gap-1 px-2 rounded-full text-xs font-medium bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ lineHeight: '20px' }}
          aria-label="Select agent context"
        >
          {chatAgent ? (
            <>
              <span aria-hidden="true">{chatAgent.icon}</span>
              {chatAgent.name}
            </>
          ) : (
            'No agent'
          )}
          <span className="text-gray-400" aria-hidden="true">▾</span>
        </button>
        {openContextPicker === 'agent' && (
          <div className="absolute left-0 top-full mt-1 z-20 w-56 max-h-72 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg p-1">
            <button
              type="button"
              onClick={() => void handleAgentContextChange(null)}
              className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                chatAgentId === null ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <span>No agent</span>
              {chatAgentId === null && <span aria-hidden="true">✓</span>}
            </button>
            {agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => void handleAgentContextChange(agent.id)}
                className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  chatAgentId === agent.id ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span aria-hidden="true">{agent.icon}</span>
                  <span className="truncate">{agent.name}</span>
                </span>
                {chatAgentId === agent.id && <span aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {projectRootDir && (
        <span
          className="inline-flex items-center gap-1 px-2 rounded-full text-xs font-medium bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400"
          style={{ lineHeight: '20px' }}
          title={`File structure context active: ${projectRootDir}`}
          aria-label={`File structure context active: ${projectRootDir}`}
        >
          📁
        </span>
      )}
    </div>
  )

  const composer = (
    <ChatComposer
      input={input}
      inputRef={inputRef}
      messages={chat.messages}
      activeAgent={chatAgent as AgentConfig | null}
      authenticated={authenticated}
      isOnline={isOnline}
      isGenerating={chat.isGenerating}
      rateLimitRemainingSec={timers.rateLimitRemainingSec}
      conversationId={conversationId}
      effectiveModel={effectiveModel}
      pendingAttachments={fileInput.pendingAttachments}
      pendingImages={fileInput.pendingImages}
      showContextInspector={showContextInspector}
      contextRefs={mergedContextRefs}
      showSlashMenu={slashMenu.showSlashMenu}
      slashFilter={slashMenu.slashFilter}
      selectedSlashIndex={slashMenu.selectedSlashIndex}
      slashCommands={actions.visibleSlashCommands}
      showAtMenu={atMenu.showAtMenu}
      atFilter={atMenu.atFilter}
      selectedAtIndex={atMenu.selectedAtIndex}
      atOptions={actions.visibleAtOptions}
      modelPickerRef={modelPickerRef}
      onResizePointerDown={handleInputResizePointerDown}
      onInputChange={(event) => actions.handleInputChange(event.target.value)}
      onKeyDown={handleKeyDown}
      onPaste={fileInput.handlePaste}
      onAttachFiles={fileInput.handleFilePick}
      onCaptureScreen={handleCaptureScreen}
      onPasteClipboardImage={handlePasteClipboard}
      onToggleContextInspector={() => setShowContextInspector((value) => !value)}
      onCloseContextInspector={() => setShowContextInspector(false)}
      onRemoveAttachment={fileInput.removeAttachment}
      onRemoveImage={fileInput.removeImage}
      onToggleImageMode={handleToggleImageMode}
      onRemoveContextToken={(token) => {
        if (token === '@clipboard') {
          setClipboardRef(null)
        } else {
          atMenu.removeContextToken(token)
        }
      }}
      onSelectSlashCommand={actions.handleSelectSlashCommand}
      onSelectAtOption={actions.handleSelectAtOption}
      onCloseSlashMenu={slashMenu.closeSlashMenu}
      onCloseAtMenu={atMenu.closeAtMenu}
      onSetConversationModel={actions.handleSetConversationModel}
      onSetPendingModel={setPendingModel}
      onStop={actions.handleStop}
      onSend={actions.handleSend}
    />
  )

  if (!conversationId && chat.messages.length === 0) {
    return (
      <div
        className={`flex-1 flex flex-col min-h-0 ${fileInput.isDragging ? 'ring-2 ring-blue-500 ring-inset bg-blue-50/5' : ''}`}
        onDragEnter={fileInput.handleDragEnter}
        onDragOver={fileInput.handleDragOver}
        onDragLeave={fileInput.handleDragLeave}
        onDrop={fileInput.handleDrop}
      >
        {contextBar}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            <h2 className="text-2xl font-medium text-gray-700 dark:text-gray-200 mb-2">
              {chatAgent ? `${chatAgent.icon} ${chatAgent.name}` : 'Copilot Desktop Hub'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              {chatAgent ? `Start a conversation with ${chatAgent.name}` : 'Start a conversation with GitHub Copilot'}
            </p>
            {!authenticated && (
              <button
                type="button"
                onClick={() => void login()}
                className="mb-4 px-4 py-2 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors"
              >
                Sign in with GitHub
              </button>
            )}
            {fileInput.isDragging && <p className="text-sm text-blue-500 animate-pulse">Drop files to attach</p>}
          </div>
        </div>
        {composer}
      </div>
    )
  }

  return (
    <div
      className={`flex-1 flex flex-col min-h-0 ${fileInput.isDragging ? 'ring-2 ring-blue-500 ring-inset bg-blue-50/5' : ''}`}
      onDragEnter={fileInput.handleDragEnter}
      onDragOver={fileInput.handleDragOver}
      onDragLeave={fileInput.handleDragLeave}
      onDrop={fileInput.handleDrop}
      role="region"
      aria-label="Chat conversation"
    >
      {contextBar}

      <div className="relative flex flex-col flex-1 min-h-0">
        <ChatMessages
          messages={chat.messages}
          effectiveModel={effectiveModel}
          isLoadingMessages={chat.isLoadingMessages}
          isGenerating={chat.isGenerating}
          liveTeamActivity={chat.liveTeamActivity}
          streamingContent={chat.streamingContent}
          currentActivity={chat.currentActivity}
          generationElapsedSec={timers.generationElapsedSec}
          loadingFailed={chat.loadingFailed}
          messagesEndRef={messagesEndRef}
          scrollContainerRef={scrollContainerRef}
          onScroll={handleScrollContainerScroll}
          onCopy={handleCopy}
          onRegenerate={chat.handleRegenerate}
          onRegenerateWithModel={chat.handleRegenerate}
          onEdit={handleEditMessage}
          onRetry={actions.handleRetry}
          onSignIn={actions.handleSignIn}
          onPickModel={handlePickModel}
          onUseImageAsContext={(dataUrl) => {
            fileInput.setPendingImages((prev) => [
              ...prev,
              { id: crypto.randomUUID(), dataUrl, name: 'browser-screenshot.png' }
            ])
          }}
        />
        {hasUnreadBelow && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
            <button
              onClick={scrollToBottom}
              className="pointer-events-auto flex items-center justify-center w-8 h-8 rounded-full bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-800 shadow-lg animate-bounce hover:animate-none hover:bg-gray-700 dark:hover:bg-gray-300 transition-colors"
              aria-label="Scroll to bottom"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {fileInput.isDragging && (
        <div className="absolute inset-0 flex items-center justify-center bg-blue-500/10 pointer-events-none z-10">
          <div className="text-lg font-medium text-blue-500 bg-white dark:bg-gray-800 px-6 py-3 rounded-xl shadow-lg">Drop files to attach</div>
        </div>
      )}
      {timers.rateLimitRemainingSec > 0 && (
        <div className="px-4 pb-2">
          <div className="max-w-3xl mx-auto text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
            Rate limited — you can send again in {timers.rateLimitRemainingSec}s.
          </div>
        </div>
      )}
      {composer}
    </div>
  )
}
