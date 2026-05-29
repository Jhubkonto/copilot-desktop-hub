import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { getModelLabel } from '../../shared/models'
import type { AgentConfig } from '../../shared/types'
import type { ToastType } from '../hooks/chat-types'
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
  const projectAgents = useAppStore((state) => state.projectAgents)
  const conversationCreated = useAppStore((state) => state.conversationCreated)
  const loadConversations = useAppStore((state) => state.loadConversations)
  const loadAgents = useAppStore((state) => state.loadAgents)
  const newChat = useAppStore((state) => state.newChat)
  const setTheme = useAppStore((state) => state.setTheme)
  const login = useAppStore((state) => state.login)
  const logout = useAppStore((state) => state.logout)
  const addToast = useAppStore((state) => state.addToast) as (
    message: string,
    type?: ToastType,
  ) => void

  const [defaultModelSetting, setDefaultModelSetting] = useState('default')
  const [pendingModel, setPendingModel] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [showContextInspector, setShowContextInspector] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [projectRootDir, setProjectRootDir] = useState<string | null>(null)
  const [inputPanelHeight, setInputPanelHeight] = useState<number | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const modelPickerRef = useRef<HTMLSelectElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const inputPanelResizeRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const inputHistoryRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  const historyDraftRef = useRef('')
  const rateLimitSetterRef = useRef<(seconds: number) => void>(() => {})

  const activeAgent = activeAgentId
    ? (agents.find((agent) => agent.id === activeAgentId) ?? null)
    : null
  const currentConversation = conversationId
    ? (conversations.find((conversation) => conversation.id === conversationId) ?? null)
    : null
  const conversationModel = currentConversation?.model ?? null
  const projectId = currentConversation?.project_id ?? activeProjectId
  const currentProject = projectId ? (projects.find((project) => project.id === projectId) ?? null) : null
  const projectDefaultModel = currentProject?.default_model ?? null
  const effectiveModel = pendingModel || conversationModel || activeAgent?.model || projectDefaultModel || defaultModelSetting || 'default'
  const effectiveModelLabel = getModelLabel(effectiveModel)
  const primaryProjectAgent = projectId ? ((projectAgents[projectId] ?? []).find((agent) => agent.isPrimary) ?? null) : null
  const displayAgent = activeAgent ?? (primaryProjectAgent ? (agents.find((agent) => agent.id === primaryProjectAgent.agentId) ?? null) : null)

  const chat = useChat({
    conversationId,
    activeAgentId,
    activeProjectId,
    effectiveModel,
    addToast,
    loadConversations,
    conversationCreated,
    rateLimitSetterRef,
  })
  const fileInput = useFileInput()
  const slashMenu = useSlashMenu()
  const atMenu = useAtMenu({ input, setInput })
  const timers = useTimers({
    isGenerating: chat.isGenerating,
    generationStartedAt: chat.generationStartedAt,
  })
  rateLimitSetterRef.current = timers.setRateLimitRemainingSec

  const actions = useChatWindowActions({
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
    messages: chat.messages,
    setMessages: chat.setMessages,
    isGenerating: chat.isGenerating,
    rateLimitRemainingSec: timers.rateLimitRemainingSec,
    pendingAttachments: fileInput.pendingAttachments,
    pendingImages: fileInput.pendingImages,
    setPendingAttachments: fileInput.setPendingAttachments,
    setPendingImages: fileInput.setPendingImages,
    contextRefs: atMenu.contextRefs,
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
    if (!projectId || projectId === '__none__') {
      setProjectRootDir(null)
      return
    }

    window.api
      .getProjectConfig(projectId)
      .then((config: unknown) => {
        const rootDir =
          config && typeof config === 'object' && 'rootDirectory' in config && typeof (config as Record<string, unknown>).rootDirectory === 'string'
            ? ((config as Record<string, unknown>).rootDirectory as string)
            : null
        setProjectRootDir(rootDir || null)
      })
      .catch(() => setProjectRootDir(null))
  }, [projectId])

  useEffect(() => {
    setPendingModel(null)
  }, [conversationId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat.messages, chat.streamingContent])

  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content)
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

  const composer = (
    <ChatComposer
      input={input}
      inputRef={inputRef}
      messages={chat.messages}
      activeAgent={activeAgent as AgentConfig | null}
      authenticated={authenticated}
      isOnline={isOnline}
      isGenerating={chat.isGenerating}
      rateLimitRemainingSec={timers.rateLimitRemainingSec}
      conversationId={conversationId}
      effectiveModel={effectiveModel}
      pendingAttachments={fileInput.pendingAttachments}
      pendingImages={fileInput.pendingImages}
      showContextInspector={showContextInspector}
      contextRefs={atMenu.contextRefs}
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
      onToggleContextInspector={() => setShowContextInspector((value) => !value)}
      onCloseContextInspector={() => setShowContextInspector(false)}
      onRemoveAttachment={fileInput.removeAttachment}
      onRemoveImage={fileInput.removeImage}
      onRemoveContextToken={atMenu.removeContextToken}
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
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            <h2 className="text-2xl font-medium text-gray-700 dark:text-gray-200 mb-2">
              {activeAgent ? `${activeAgent.icon} ${activeAgent.name}` : 'Copilot Desktop Hub'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              {activeAgent ? `Start a conversation with ${activeAgent.name}` : 'Start a conversation with GitHub Copilot'}
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
      {(currentProject || displayAgent) && (
        <div className="flex items-center gap-2 px-4 h-9 border-b border-gray-200 dark:border-gray-700/80 bg-gray-50 dark:bg-gray-800/50" aria-label="Chat context">
          {currentProject && (
            <span className="inline-flex items-center gap-1 px-2 rounded-full text-xs font-medium bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300" style={{lineHeight: '20px'}}>
              <span className={`w-2 h-2 rounded-full bg-${currentProject.color}-400`} aria-hidden="true" />
              {currentProject.name}
            </span>
          )}
          {displayAgent && (
            <span className="inline-flex items-center gap-1 px-2 rounded-full text-xs font-medium bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300" style={{lineHeight: '20px'}}>
              <span aria-hidden="true">{displayAgent.icon}</span>
              {displayAgent.name}
            </span>
          )}
          {projectRootDir && (
            <span
              className="inline-flex items-center gap-1 px-2 rounded-full text-xs font-medium bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400"
              style={{lineHeight: '20px'}}
              title={`File structure context active: ${projectRootDir}`}
              aria-label={`File structure context active: ${projectRootDir}`}
            >
              📁
            </span>
          )}
        </div>
      )}

      <ChatMessages
        messages={chat.messages}
        effectiveModel={effectiveModel}
        isLoadingMessages={chat.isLoadingMessages}
        isGenerating={chat.isGenerating}
        liveTeamActivity={chat.liveTeamActivity}
        streamingContent={chat.streamingContent}
        generationElapsedSec={timers.generationElapsedSec}
        loadingFailed={chat.loadingFailed}
        messagesEndRef={messagesEndRef}
        onCopy={handleCopy}
        onRegenerate={chat.handleRegenerate}
        onEdit={(index) => actions.handleEdit(index, chat.handleEdit)}
        onRetry={actions.handleRetry}
        onSignIn={actions.handleSignIn}
        onPickModel={() => modelPickerRef.current?.focus()}
      />

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
