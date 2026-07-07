/* eslint-disable react-hooks/exhaustive-deps -- chat/actions are aggregate hook objects; individual members are stable. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { shouldFollowAnimatedGrowth } from '../chat-scroll-policy'
import { CheckCircle, ChevronDown, ChevronRight, Download, Loader2, Lock, MoreHorizontal, Pin, PinOff, Sparkles, Upload, Zap } from 'lucide-react'
import { getAvailableModelIds, getModelLabel, modelIdSupportsTools } from '../../shared/models'
import { isApiError, type AgentConfig, type ArtifactPromotionRequest, type AvailableModelEntry, type AvailableModelGroup, type ConversationExportPackFormat, type WikiCandidate } from '../../shared/types'
import type { ContextRef, ToastType } from '../hooks/chat-types'
import { useAtMenu } from '../hooks/useAtMenu'
import { useChat } from '../hooks/useChat'
import { useChatWindowActions } from '../hooks/useChatWindowActions'
import { useFileInput } from '../hooks/useFileInput'
import { useSlashMenu } from '../hooks/useSlashMenu'
import { useRateLimitTimer } from '../hooks/useRateLimitTimer'
import { useVoiceInput } from '../hooks/useVoiceInput'
import { useAppStore } from '../store/app-store'
import { CONTEXT_INSPECTOR_MAX_TOKENS, estimateRefTokens, estimateTokens } from '../lib/context-token-estimate'
import type { ContextInspectorSnapshot } from '../../shared/types'
import { ChatComposer } from './chat/ChatComposer'
import { ChatMessages } from './chat/ChatMessages'
import { DropdownPanel } from './DropdownPanel'
import { PromptLibraryModal } from './PromptLibraryModal'
import { SaveToWikiModal } from './SaveToWikiModal'
import { WikiExtractionModal } from './WikiExtractionModal'

const FALLBACK_CLAUDE_MODELS = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
]

const FALLBACK_CODEX_MODELS = [
  { id: 'gpt-5.5', label: 'GPT-5.5' },
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4-Mini' },
]

const PROMOTABLE_ARTIFACT_KINDS: ArtifactPromotionRequest['kind'][] = ['document', 'prompt', 'plan', 'code', 'other']

function deriveArtifactPromotionTitle(messageContent: string, conversationTitle?: string | null): string {
  const heading = messageContent.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/m)?.[1]?.trim()
  return heading || conversationTitle?.trim() || 'New Artifact'
}

function defaultArtifactFilePath(kind: ArtifactPromotionRequest['kind']): string {
  switch (kind) {
    case 'prompt':
      return 'prompt.md'
    case 'plan':
      return 'output.md'
    case 'code':
      return 'output.ts'
    case 'other':
      return 'output.txt'
    case 'document':
    default:
      return 'output.md'
  }
}

export function ChatWindow() {
  const conversationId = useAppStore((state) => state.currentConversationId)
  const activeAgentId = useAppStore((state) => state.activeAgentId)
  const activeProjectId = useAppStore((state) => state.activeProjectId)
  const projects = useAppStore((state) => state.projects)
  const agents = useAppStore((state) => state.agents)
  const conversations = useAppStore((state) => state.conversations)
  const authenticated = useAppStore((state) => state.authState.authenticated)
  const authMode = useAppStore((state) => state.authState.mode)
  const cliInstalled = useAppStore((state) => state.authState.cliInstalled)
  const installedClis = useAppStore((state) => state.authState.clis ?? { claude: state.authState.cliInstalled, codex: false })
  const isReady = authenticated || cliInstalled
  const theme = useAppStore((state) => state.theme)
  const conversationCreated = useAppStore((state) => state.conversationCreated)
  const loadConversations = useAppStore((state) => state.loadConversations)
  const loadAgents = useAppStore((state) => state.loadAgents)
  const newChat = useAppStore((state) => state.newChat)
  const openSectionPane = useAppStore((state) => state.openSectionPane)
  const openArtifactPanel = useAppStore((state) => state.openArtifactPanel)
  const selectConversation = useAppStore((state) => state.selectConversation)
  const setTheme = useAppStore((state) => state.setTheme)
  const logout = useAppStore((state) => state.logout)
  const addToast = useAppStore((state) => state.addToast) as (
    message: string,
    type?: ToastType,
    action?: { label: string; onClick: () => void }
  ) => void
  const markConversationUnread = useAppStore((state) => state.markConversationUnread)
  const catalogModels = useAppStore((state) => state.catalogModels)
  const markConversationRead = useAppStore((state) => state.markConversationRead)
  const generatingConversationIds = useAppStore((state) => state.generatingConversationIds)
  const generatingStartTimes = useAppStore((state) => state.generatingStartTimes)
  const markConversationGenerating = useAppStore((state) => state.markConversationGenerating)
  const markConversationDoneGenerating = useAppStore((state) => state.markConversationDoneGenerating)
  const markConversationPending = useAppStore((state) => state.markConversationPending)
  const clearConversationPending = useAppStore((state) => state.clearConversationPending)
  const defaultModelSetting = useAppStore((state) => state.globalDefaultModel)
  const saveAgent = useAppStore((state) => state.saveAgent)
  const [isPinning, setIsPinning] = useState(false)

  const availableGroups = useAppStore((state) => state.availableModelGroups)
  const [pendingModel, setPendingModel] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [showContextInspector, setShowContextInspector] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [projectRootDir, setProjectRootDir] = useState<string | null>(null)
  const [inputPanelHeight, setInputPanelHeight] = useState<number | null>(null)
  const [hasUnreadBelow, setHasUnreadBelow] = useState(false)
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false)
  const [clipboardRef, setClipboardRef] = useState<ContextRef | null>(null)
  const [promptInstructionRef, setPromptInstructionRef] = useState<ContextRef | null>(null)
  const [wikiMessageIds, setWikiMessageIds] = useState<Set<string>>(new Set())
  const [wikiModalMessage, setWikiModalMessage] = useState<{ id: string; content: string } | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [showActionsMenu, setShowActionsMenu] = useState(false)
  const [menuExportOpen, setMenuExportOpen] = useState(false)
  const [menuContinueOpen, setMenuContinueOpen] = useState(false)
  const [continueModel, setContinueModel] = useState<string>('default')
  const [continueAgentId, setContinueAgentId] = useState<string | null>(null)
  const [continueCliModels, setContinueCliModels] = useState<{ id: string; label: string }[]>([])
  const [isForking, setIsForking] = useState(false)
  const [extractionCandidates, setExtractionCandidates] = useState<WikiCandidate[] | null>(null)
  const [showPromptLibrary, setShowPromptLibrary] = useState(false)
  const [artifactPromotion, setArtifactPromotion] = useState<{
    messageId: string
    content: string
    title: string
    kind: ArtifactPromotionRequest['kind']
    scopeType: 'global' | 'project'
    projectId: string
    filePath: string
    saving: boolean
  } | null>(null)
  const completedConversationIds = useAppStore((state) => state.completedConversationIds)
  const markConversationCompleteFn = useAppStore((state) => state.markConversationComplete)
  const markConversationIncompleteFn = useAppStore((state) => state.markConversationIncomplete)
  const handleVoiceText = useCallback((text: string) => {
    setInput((current) => current.trim() ? `${current.trimEnd()} ${text}` : text)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])
  const handleVoiceError = useCallback((message: string) => addToast(message, 'error'), [addToast])
  const { voiceState, toggleVoice, cancelVoice } = useVoiceInput(handleVoiceText, handleVoiceError)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isUserScrolledUpRef = useRef(false)
  // Set immediately before a programmatic scroll and cleared a frame later. Content
  // growing taller between the scrollTo() call and the browser's resulting scroll
  // event can make the container look momentarily short of the bottom by the
  // SCROLL_BOTTOM_THRESHOLD check — without this guard that misfire latches
  // isUserScrolledUpRef permanently true, silently breaking auto-follow for the
  // rest of the generation since nothing else resets it except the user manually
  // scrolling back down themselves.
  const isProgrammaticScrollRef = useRef(false)
  // Set while a manual "scroll to request" jump is in flight so the generation
  // auto-follow effect doesn't fight it and drag the view back to the bottom.
  const suppressAutoFollowUntilRef = useRef(0)
  // Coalesces auto-follow into at most one pending rAF at a time.
  const autoFollowRafRef = useRef<number | null>(null)
  const prevGeneratingRef = useRef(false)
  const prevMessagesLengthRef = useRef(0)
  // Single threshold for "is the view at the bottom", shared by scrollToBottom's
  // corrective-jump check and handleScrollContainerScroll's at-bottom classification.
  // They must agree — see scrollToBottom's comment for why a mismatch causes a
  // visible pause-then-jump.
  const SCROLL_BOTTOM_THRESHOLD = 80
  const modelPickerRef = useRef<HTMLButtonElement>(null)
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

  // An agent requires tool-capable models when it has MCP servers assigned.
  const agentNeedsTools = !!(chatAgent && (chatAgent.mcpServers?.length ?? 0) > 0)

  const nonDefault = (v: string | null | undefined): string | null =>
    v && v !== 'default' ? v : null

  const chatAgentBackend = chatAgent?.backend
  const chatAgentCliModel = nonDefault(chatAgent?.cliModel ?? null)
  const lockModelToAgentBackend =
    chatAgentBackend === 'claude-cli' || chatAgentBackend === 'codex-cli'
  const conversationCliModelForAgentBackend =
    lockModelToAgentBackend && nonDefault(conversationModel) && availableGroups.some((group) =>
      group.sourceKey === chatAgentBackend &&
      group.models.some((model) => model.id === nonDefault(conversationModel)),
    )
      ? nonDefault(conversationModel)
      : null

  let effectiveModel: string
  let modelSourceLabel: string | undefined
  if (chatAgentBackend === 'claude-cli' || chatAgentBackend === 'codex-cli') {
    // Forced CLI agents only honor per-conversation model choices within that backend.
    effectiveModel = conversationCliModelForAgentBackend ?? chatAgentCliModel ?? 'default'
  } else if (nonDefault(pendingModel)) {
    effectiveModel = pendingModel!
  } else if (nonDefault(conversationModel)) {
    effectiveModel = conversationModel!
    // Recover provenance: check which source originally provided this model
    if (nonDefault(projectDefaultModel) && projectDefaultModel === conversationModel) {
      modelSourceLabel = chatProject?.name ?? 'project'
    } else if (nonDefault(defaultModelSetting) && defaultModelSetting === conversationModel) {
      modelSourceLabel = 'global'
    }
  } else if (nonDefault(projectDefaultModel)) {
    effectiveModel = projectDefaultModel!
    modelSourceLabel = chatProject?.name ?? 'project'
  } else if (nonDefault(defaultModelSetting)) {
    effectiveModel = defaultModelSetting!
    modelSourceLabel = 'global'
  } else {
    effectiveModel = 'default'
  }

  // If the agent requires tool calling, auto-fallback to 'default' (GPT-4o)
  // when the resolved model is not known to support tools. This prevents
  // silently sending a chat-only model into the MCP tool loop.
  if (agentNeedsTools && !modelIdSupportsTools(effectiveModel, catalogModels)) {
    effectiveModel = 'default'
    modelSourceLabel = undefined
  }

  const effectiveModelLabel = getModelLabel(effectiveModel, catalogModels)
  const continueAgent = continueAgentId ? (agents.find((agent) => agent.id === continueAgentId) ?? null) : null
  const continueBackend = continueAgent?.backend ?? null
  const continueAgentNeedsTools = !!(continueAgent && (continueAgent.mcpServers?.length ?? 0) > 0)
  const continueProviderModelIds = useMemo(
    () => getAvailableModelIds(catalogModels, effectiveModel, continueAgentNeedsTools),
    [catalogModels, continueAgentNeedsTools, effectiveModel],
  )
  const continueModelOptions = useMemo(() => {
    if (continueBackend === 'gh-copilot') return []
    if (continueBackend === 'claude-cli' || continueBackend === 'codex-cli') {
      return continueCliModels.map((model) => ({ id: model.id, label: model.label }))
    }
    return continueProviderModelIds.map((model) => ({
      id: model,
      label: getModelLabel(model, catalogModels, defaultModelSetting ?? undefined),
    }))
  }, [catalogModels, continueBackend, continueCliModels, continueProviderModelIds, defaultModelSetting])

  const chat = useChat({
    conversationId,
    activeAgentId: chatAgentId,
    activeProjectId: chatProjectId,
    effectiveModel,
    catalogModels,
    addToast,
    loadConversations,
    conversationCreated,
    rateLimitSetterRef,
    markConversationGenerating,
    markConversationDoneGenerating,
    isConversationGenerating: conversationId ? generatingConversationIds.includes(conversationId) : false,
    conversationGenerationStartedAt: conversationId ? (generatingStartTimes[conversationId] ?? null) : null,
  })
  const fileInput = useFileInput()
  const slashMenu = useSlashMenu()
  const atMenu = useAtMenu({ input, setInput, projectId: chatProjectId, projectRootDir })
  const mergedContextRefs = useMemo(() => {
    const refs = [...atMenu.contextRefs]
    if (clipboardRef) refs.push(clipboardRef)
    if (promptInstructionRef) refs.push(promptInstructionRef)
    return refs
  }, [atMenu.contextRefs, clipboardRef, promptInstructionRef])
  const { rateLimitRemainingSec, setRateLimitRemainingSec } = useRateLimitTimer()
  rateLimitSetterRef.current = setRateLimitRemainingSec

  const actions = useChatWindowActions({
    conversationId,
    chatAgentId,
    chatProjectId,
    activeAgent: chatAgent,
    effectiveModel,
    effectiveModelLabel,
    conversationModel,
    catalogModels,
    globalDefaultModel: defaultModelSetting ?? null,
    theme,
    input,
    setInput,
    messages: chat.messages,
    setMessages: chat.setMessages,
    isGenerating: chat.isGenerating,
    rateLimitRemainingSec: rateLimitRemainingSec,
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
    streamingConversationRef: chat.streamingConversationRef,
    justCreatedConversationRef: chat.justCreatedConversationRef,
    pendingEditedResendRef: chat.pendingEditedResendRef,
    editCutoffTimestampRef: chat.editCutoffTimestampRef,
    lastUndoneUserMessageRef: chat.lastUndoneUserMessageRef,
    streamModelRef: chat.streamModelRef,
    streamingContentRef: chat.streamingContentRef,
    conversationCreated,
    markConversationGenerating,
    markConversationDoneGenerating,
    markConversationPending,
    clearConversationPending,
    setIsGenerating: chat.setIsGenerating,
    setGenerationStartedAt: chat.setGenerationStartedAt,
    setStreamingContent: chat.setStreamingContent,
    resetQueue: chat.resetQueue,
    setLoadingFailed: chat.setLoadingFailed,
    setLiveTeamActivity: chat.setLiveTeamActivity,
    addToast,
    pushSystemMessage: chat.pushSystemMessage,
    buildConversationMarkdown: chat.buildConversationMarkdown,
    newChat,
    logout,
    setTheme,
    loadAgents,
    loadConversations,
    markConversationComplete: markConversationCompleteFn,
    markConversationIncomplete: markConversationIncompleteFn,
    onAfterSend: () => {
      setClipboardRef(null)
      setPromptInstructionRef(null)
    },
    onEditStateConsumed: chat.clearEditState,
  })

  useLayoutEffect(() => {
    const element = inputRef.current
    if (!element) return
    element.style.height = 'auto'
    const floor = inputPanelHeight ?? 0
    element.style.height = `${Math.min(Math.max(floor, element.scrollHeight), 400)}px`
  }, [input, inputPanelHeight])

  const handleOpenArtifactPromotion = useCallback((messageId: string, content: string) => {
    setArtifactPromotion({
      messageId,
      content,
      title: deriveArtifactPromotionTitle(content, currentConversation?.title),
      kind: 'document',
      scopeType: chatProjectId && chatProjectId !== '__none__' ? 'project' : 'global',
      projectId: chatProjectId && chatProjectId !== '__none__' ? chatProjectId : '',
      filePath: defaultArtifactFilePath('document'),
      saving: false,
    })
  }, [chatProjectId, currentConversation?.title])

  const handleCreateCodeChange = useCallback((_messageId: string, content: string) => {
    const plainContent = content.replace(/\s+/g, ' ').trim()
    setInput(`/code-change ${plainContent}`)
    inputRef.current?.focus()
  }, [setInput])

  const handleConfirmArtifactPromotion = useCallback(async () => {
    if (!conversationId || !artifactPromotion) return
    const scope = artifactPromotion.scopeType === 'project'
      ? { type: 'project' as const, projectId: artifactPromotion.projectId }
      : { type: 'global' as const }
    setArtifactPromotion((current) => current ? { ...current, saving: true } : current)
    try {
      const result = await window.api.artifactPromoteMessage({
        conversationId,
        messageId: artifactPromotion.messageId,
        title: artifactPromotion.title.trim(),
        kind: artifactPromotion.kind,
        scope,
        filePath: artifactPromotion.filePath.trim(),
      })
      setArtifactPromotion(null)
      addToast('Artifact saved', 'success', {
        label: 'View artifact',
        onClick: () => {
          openSectionPane('artifacts')
          openArtifactPanel(result.artifactId)
        },
      })
    } catch (error) {
      setArtifactPromotion((current) => current ? { ...current, saving: false } : current)
      addToast(error instanceof Error ? error.message : 'Failed to save artifact', 'error')
    }
  }, [addToast, artifactPromotion, conversationId, openArtifactPanel, openSectionPane])

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
    if (!chatProjectId || chatProjectId === '__none__') {
      setWikiMessageIds(new Set())
      return
    }

    window.api
      .listWikiEntries(chatProjectId)
      .then((entries) => {
        setWikiMessageIds(new Set(entries
          .filter((entry) => entry.source_message_id != null)
          .map((entry) => entry.source_message_id as string)))
      })
      .catch(() => {})
  }, [chatProjectId])

  useEffect(() => {
    setPendingModel(null)
  }, [conversationId])

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

  useEffect(() => {
    const unsubscribe = window.api.onWikiInjected(({ count }) => {
      const label = count === 1 ? 'wiki entry' : 'wiki entries'
      chat.setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'system' as const,
          content: `📖 ${count} project ${label} auto-injected into this conversation.`,
          timestamp: Date.now(),
        },
      ])
    })
    return unsubscribe
  }, [chat.setMessages])

  const inspectorSnapshotStateRef = useRef({
    conversationId,
    effectiveModel,
    chatAgent,
    mergedContextRefs,
    pendingAttachments: fileInput.pendingAttachments,
    pendingImages: fileInput.pendingImages,
    historyMessages: chat.messages,
    input,
  })
  inspectorSnapshotStateRef.current = {
    conversationId,
    effectiveModel,
    chatAgent,
    mergedContextRefs,
    pendingAttachments: fileInput.pendingAttachments,
    pendingImages: fileInput.pendingImages,
    historyMessages: chat.messages,
    input,
  }

  useEffect(() => {
    if (typeof window.api.onRequestInspectorSnapshot !== 'function') return
    const unsubscribe = window.api.onRequestInspectorSnapshot(({ requestId, conversationId: requestedConversationId }) => {
      const state = inspectorSnapshotStateRef.current
      if (requestedConversationId && state.conversationId !== requestedConversationId) {
        window.api.replyInspectorSnapshot(requestId, null)
        return
      }
      const systemPrompt = state.chatAgent?.systemPrompt ?? ''
      const systemPromptTokens = estimateTokens(systemPrompt.length)
      const contextRefs = state.mergedContextRefs.map((ref) => ({
        token: ref.token,
        key: ref.key,
        estimatedTokens: estimateRefTokens(ref),
      }))
      const attachments = state.pendingAttachments.map((att) => ({
        name: att.name,
        size: att.size,
        estimatedTokens: estimateTokens(att.size),
      }))
      const historyMessages = state.historyMessages.filter((message) => message.role !== 'system')
      const currentInputTokens = estimateTokens(state.input.length)
      const refTokens = contextRefs.reduce((sum, r) => sum + r.estimatedTokens, 0)
      const attachTokens = attachments.reduce((sum, a) => sum + a.estimatedTokens, 0)
      const historyTokens = historyMessages.length * 200
      const snapshot: ContextInspectorSnapshot = {
        conversationId: state.conversationId,
        model: state.effectiveModel,
        systemPrompt,
        systemPromptTokens,
        contextRefs,
        attachments,
        imageCount: state.pendingImages.length,
        historyMessageCount: historyMessages.length,
        currentInputTokens,
        totalTokens: systemPromptTokens + refTokens + attachTokens + historyTokens + currentInputTokens,
        maxTokens: CONTEXT_INSPECTOR_MAX_TOKENS,
      }
      window.api.replyInspectorSnapshot(requestId, snapshot)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (typeof window.api.onToolAutoApproved !== 'function') return
    const unsubscribe = window.api.onToolAutoApproved(({ toolName }) => {
      chat.setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'system' as const,
          content: `⚡ ${toolName} auto-approved`,
          timestamp: Date.now(),
        },
      ])
    })
    return unsubscribe
  }, [chat.setMessages])

  const pendingArtifactAttach = useAppStore((state) => state.pendingArtifactAttach)
  const clearPendingArtifactAttach = useAppStore((state) => state.clearPendingArtifactAttach)
  useEffect(() => {
    if (!pendingArtifactAttach || !conversationId) return
    const { artifactId, versionId } = pendingArtifactAttach
    clearPendingArtifactAttach()
    void chat.attachArtifact(artifactId, versionId)
  }, [pendingArtifactAttach, conversationId, clearPendingArtifactAttach, chat.attachArtifact])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollContainerRef.current
    if (!el) return
    // Skip the programmatic scroll entirely if we're already at (or essentially at) the
    // bottom — e.g. right after the user manually scrolled there themselves. Calling
    // scrollTo() again here would re-animate over their own scroll gesture and read as
    // a jarring correction at the exact moment they reach the bottom. Uses the same
    // SCROLL_BOTTOM_THRESHOLD as handleScrollContainerScroll's at-bottom check below —
    // a mismatch here previously let a manual scroll/click land just inside the "at
    // bottom" zone while still outside this narrower epsilon, so a subsequent auto-follow
    // effect would issue one last corrective scrollTo() a tick later: a visible
    // pause-then-jump right as the user reached the end of the chat.
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom > SCROLL_BOTTOM_THRESHOLD) {
      isProgrammaticScrollRef.current = true
      el.scrollTo({ top: el.scrollHeight, behavior })
      // Cleared a frame later rather than synchronously — the resulting native scroll
      // event(s) can land a tick after this call, especially with behavior: 'smooth'.
      requestAnimationFrame(() => {
        isProgrammaticScrollRef.current = false
      })
    }
    isUserScrolledUpRef.current = false
    setIsUserScrolledUp(false)
    setHasUnreadBelow(false)
    if (conversationId) markConversationRead(conversationId)
  }, [conversationId, markConversationRead])

  const handleScrollContainerScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    // A scroll event immediately following our own programmatic scrollTo() can read
    // as "short of the bottom" if content grew taller in the interim — don't let that
    // misclassify as the user having scrolled up (see isProgrammaticScrollRef).
    if (isProgrammaticScrollRef.current) return
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_BOTTOM_THRESHOLD
    isUserScrolledUpRef.current = !atBottom
    setIsUserScrolledUp(!atBottom)
    if (atBottom) {
      setHasUnreadBelow(false)
      if (conversationId) markConversationRead(conversationId)
    }
  }, [conversationId, markConversationRead])

  // Cancel any pending coalesced auto-follow rAF on unmount.
  useEffect(() => {
    return () => {
      if (autoFollowRafRef.current !== null) cancelAnimationFrame(autoFollowRafRef.current)
    }
  }, [])

  // Suppresses the generation auto-follow effects for a short window so a manual
  // "scroll to request" jump isn't immediately dragged back to the bottom.
  const handleNavigateToRequest = useCallback(() => {
    suppressAutoFollowUntilRef.current = Date.now() + 2000
  }, [])

  // Auto-scroll only when user is at the bottom.
  // Fires on displayedContent (the drained queue output), which now updates on
  // nearly every animation frame while text streams in. Coalesce into at most one
  // pending rAF so we don't stack a scrollTo() call (and its forced layout read)
  // on every single tick, and skip entirely while a manual navigation (e.g. jump
  // to the in-reply-to request) is in flight so this doesn't drag the view back.
  // Uses a double rAF: a single rAF only guarantees "before the next paint", which
  // for a large one-shot layout change (e.g. the reasoning bubble mounting at up to
  // ~7.5rem tall in one render, as opposed to gradual per-character text growth)
  // can still read a stale scrollHeight from before that layout was committed —
  // scrolling to the wrong, too-short "bottom" and silently leaving the view behind.
  // The second rAF runs after the browser has actually painted the new layout.
  useEffect(() => {
    if (isUserScrolledUpRef.current) return
    if (autoFollowRafRef.current !== null) return
    autoFollowRafRef.current = requestAnimationFrame(() => {
      autoFollowRafRef.current = requestAnimationFrame(() => {
        autoFollowRafRef.current = null
        if (Date.now() < suppressAutoFollowUntilRef.current) return
        if (shouldFollowAnimatedGrowth(isUserScrolledUpRef.current)) scrollToBottom('auto')
      })
    })
  }, [chat.messages, chat.displayedContent, chat.liveTeamActivity, scrollToBottom])

  // Track new content arriving while user is scrolled up → mark unread
  useEffect(() => {
    const newMessages = chat.messages.length > prevMessagesLengthRef.current
    const hasStreaming = chat.streamingContent !== ''
    const hasTeamActivity = chat.liveTeamActivity.length > 0
    if (isUserScrolledUpRef.current && (newMessages || hasStreaming || hasTeamActivity)) {
      setHasUnreadBelow(true)
      if (conversationId) markConversationUnread(conversationId)
    }
    prevMessagesLengthRef.current = chat.messages.length
  }, [chat.messages, chat.streamingContent, chat.liveTeamActivity, conversationId, markConversationUnread])

  // Force scroll to bottom whenever a new generation begins (user just sent a message,
  // or regenerate just removed the previous — potentially very tall — assistant message).
  // Double rAF: a single rAF can still read scrollHeight from before the message-list
  // change has actually been painted, landing on a stale, too-tall "bottom".
  useEffect(() => {
    if (!chat.isGenerating) return
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => scrollToBottom('auto'))
    })
    return () => cancelAnimationFrame(raf1)
  }, [chat.isGenerating, scrollToBottom])

  // Scroll when live thinking blocks expand (new block added or content grows).
  // Shares the same coalesced-rAF + suppression guard as the content auto-follow
  // effect above — thinking blocks get a new Map reference on every streamed
  // chunk, so without coalescing this fires at the same high frequency.
  useEffect(() => {
    if (isUserScrolledUpRef.current || chat.liveTurnState.thinkingBlocks.size === 0) return
    if (autoFollowRafRef.current !== null) return
    autoFollowRafRef.current = requestAnimationFrame(() => {
      autoFollowRafRef.current = requestAnimationFrame(() => {
        autoFollowRafRef.current = null
        if (Date.now() < suppressAutoFollowUntilRef.current) return
        if (!isUserScrolledUpRef.current) scrollToBottom('auto')
      })
    })
  }, [chat.liveTurnState.thinkingBlocks, scrollToBottom])

  // Reset scroll state on conversation switch
  useEffect(() => {
    prevMessagesLengthRef.current = 0
    isUserScrolledUpRef.current = false
    setIsUserScrolledUp(false)
    setHasUnreadBelow(false)
    if (conversationId) markConversationRead(conversationId)
    // Defer so the new messages have rendered before scrolling
    requestAnimationFrame(() => scrollToBottom('auto'))
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

  const handleCopy = useCallback(async (content: string) => {
    try {
      await navigator.clipboard.writeText(content)
      addToast('Copied to clipboard', 'success')
    } catch {
      addToast('Failed to copy message', 'error')
    }
  }, [addToast])

  const handleSaveToWiki = useCallback((messageId: string, content: string) => {
    setWikiModalMessage({ id: messageId, content })
  }, [])

  const handleExtractLearnings = useCallback(async () => {
    if (!conversationId || !chatProjectId || chatProjectId === '__none__') return
    setIsExtracting(true)
    try {
      const result = await window.api.extractWikiLearnings(conversationId, chatProjectId)
      if (result.candidates.length === 0) {
        addToast('No notable learnings found in this conversation', 'info')
      } else {
        setExtractionCandidates(result.candidates)
      }
    } catch {
      addToast('Failed to extract learnings', 'error')
    } finally {
      setIsExtracting(false)
    }
  }, [addToast, chatProjectId, conversationId])

  const handleExportConversation = useCallback(async (format: ConversationExportPackFormat) => {
    if (!conversationId) return
    setIsExporting(true)
    setMenuExportOpen(false)
    try {
      const pack = await window.api.exportConversationPack(conversationId, { format })
      const savedPath = await window.api.saveTextFile(pack.file_name, pack.content)
      if (savedPath) {
        addToast('Conversation exported', 'success')
      }
    } catch {
      addToast('Failed to export conversation', 'error')
    } finally {
      setIsExporting(false)
    }
  }, [addToast, conversationId])

  const handleImportIntoConversation = useCallback(async () => {
    if (!conversationId) return
    setIsImporting(true)
    try {
      const result = await window.api.importConversationJson(conversationId)
      if (result) {
        await loadConversations()
        addToast(`Imported ${result.message_count} messages`, 'success')
      }
    } catch {
      addToast('Failed to import conversation', 'error')
    } finally {
      setIsImporting(false)
    }
  }, [addToast, conversationId, loadConversations])

  const handleOpenContinueWith = useCallback(() => {
    setContinueModel(effectiveModel === 'default' ? 'default' : effectiveModel)
    setContinueAgentId(chatAgentId)
    setMenuExportOpen(false)
    setMenuContinueOpen(true)
  }, [chatAgentId, effectiveModel])

  const handleContinueWith = useCallback(async () => {
    if (!conversationId) return
    setIsForking(true)
    try {
      const result = await window.api.forkConversation(conversationId, {
        model: continueBackend === 'gh-copilot' ? null : continueModel,
        agentId: continueAgentId,
      })
      await loadConversations()
      selectConversation(result.conversation.id)
      setMenuContinueOpen(false)
      const details = [
        result.rewritten_message_count > 0 ? `${result.rewritten_message_count} converted for compatibility` : null,
        result.compressed_message_count > 0 ? `${result.compressed_message_count} compressed for context` : null,
      ].filter(Boolean)
      addToast(
        details.length > 0
          ? `Forked ${result.message_count} messages (${details.join(', ')})`
          : `Forked ${result.message_count} messages`,
        'success',
      )
    } catch {
      addToast('Failed to continue conversation', 'error')
    } finally {
      setIsForking(false)
    }
  }, [addToast, continueAgentId, continueBackend, continueModel, conversationId, loadConversations, selectConversation])

  useEffect(() => {
    if (!menuContinueOpen) return
    if (continueBackend !== 'claude-cli' && continueBackend !== 'codex-cli') {
      setContinueCliModels([])
      return
    }

    const backend = continueBackend
    const fallbackModels = backend === 'codex-cli' ? FALLBACK_CODEX_MODELS : FALLBACK_CLAUDE_MODELS
    let cancelled = false
    setContinueCliModels(fallbackModels)
    window.api.getCliModels(backend)
      .then((models) => {
        if (!cancelled) setContinueCliModels(models.length > 0 ? models : fallbackModels)
      })
      .catch(() => {
        if (!cancelled) setContinueCliModels(fallbackModels)
      })
    return () => {
      cancelled = true
    }
  }, [continueBackend, menuContinueOpen])

  useEffect(() => {
    if (!menuContinueOpen) return
    if (continueBackend === 'gh-copilot') {
      setContinueModel('default')
      return
    }
    if (continueBackend === 'claude-cli' || continueBackend === 'codex-cli') {
      if (continueModelOptions.length === 0) return
      const preferred = continueAgent?.cliModel && continueModelOptions.some((model) => model.id === continueAgent.cliModel)
        ? continueAgent.cliModel
        : continueModelOptions[0].id
      if (!continueModelOptions.some((model) => model.id === continueModel)) {
        setContinueModel(preferred)
      }
      return
    }
    if (continueModelOptions.length > 0 && !continueModelOptions.some((model) => model.id === continueModel)) {
      setContinueModel(continueModelOptions[0].id)
    }
  }, [continueAgent?.cliModel, continueBackend, continueModel, continueModelOptions, menuContinueOpen])

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

  const handleTogglePin = useCallback(async () => {
    if (!conversationId || isPinning) return
    const newPinned = !(currentConversation?.pinned === 1)
    setIsPinning(true)
    try {
      await window.api.setConversationPinned(conversationId, newPinned)
      await loadConversations()
    } catch {
      addToast('Failed to update pin', 'error')
    } finally {
      setIsPinning(false)
    }
  }, [conversationId, isPinning, currentConversation?.pinned, loadConversations, addToast])

  const handleEditMessage = useCallback(
    (index: number) => actions.handleEdit(index, chat.handleEdit),
    [actions.handleEdit, chat.handleEdit],
  )

  const handleCancelEdit = useCallback(() => {
    chat.cancelEdit()
    setInput('')
  }, [chat.cancelEdit, setInput])

  const handleSelectAvailableModel = useCallback(
    (group: AvailableModelGroup, model: AvailableModelEntry) => {
      if (lockModelToAgentBackend) {
        // For CLI-backed agents, only allow picking within the same backend.
        // Store as a per-conversation override — does not mutate the agent config.
        if (group.sourceKey !== chatAgentBackend) return
        if (conversationId) {
          void actions.handleSetConversationModel(model.id)
        }
        return
      }
      if (group.sourceType === 'cli') {
        void actions.handleSetCliBackendAndModel(group.sourceKey as 'claude-cli' | 'codex-cli', model.id)
        // Also update the UI immediately when there is no conversation yet;
        // the backend is staged for the first send inside useChatWindowActions.
        if (!conversationId) {
          setPendingModel(model.id)
        }
      } else {
        if (conversationId) {
          void actions.handleSetConversationModel(model.id)
        } else {
          setPendingModel(model.id === 'default' ? null : model.id)
        }
      }
    },
    [actions, chatAgentBackend, conversationId, lockModelToAgentBackend],
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

  const handleInsertPrompt = useCallback((content: string) => {
    setInput((current) => current.trim() ? `${current.trimEnd()}\n\n${content}` : content)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  const handleRunPrompt = useCallback(async (content: string) => {
    setInput(content)
    await actions.handleSend(content)
  }, [actions])

  const handleAttachPromptInstruction = useCallback((content: string, title: string) => {
    const label = title.trim() || 'Prompt'
    setPromptInstructionRef({
      key: 'prompt-instruction',
      token: `@prompt:${label.slice(0, 32)}`,
      value: content,
    })
    addToast('Prompt attached as temporary instructions', 'success')
  }, [addToast])

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

  const hasByok = availableGroups.some((g) => g.sourceType === 'provider')

  const backendChip = useMemo(() => {
    const byokGroup = availableGroups.find((g) => {
      if (g.sourceType !== 'provider') return false
      if (effectiveModel === 'default') return true
      return g.models.some((m) => m.id === effectiveModel)
    })
    const cliGroup = availableGroups.find(
      (g) => g.sourceType === 'cli' && g.models.some((m) => m.id === effectiveModel),
    )
    const providerColorMap: Record<string, string> = {
      openrouter: 'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-700 text-violet-700 dark:text-violet-300',
      anthropic: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-700 text-orange-700 dark:text-orange-300',
      azure: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300',
    }

    const agentBackend = chatAgent?.backend
    if (agentBackend === 'gh-copilot') {
      return { label: 'gh copilot', cls: 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400' }
    }
    if (agentBackend === 'codex-cli' && cliInstalled) {
      return { label: 'Codex CLI', cls: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300' }
    }
    if (agentBackend === 'claude-cli' && cliInstalled) {
      return { label: 'Claude CLI', cls: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-700 text-purple-700 dark:text-purple-300' }
    }
    if (!agentBackend && authMode === 'none' && cliInstalled && !hasByok) {
      return installedClis.codex && !installedClis.claude
        ? { label: 'Codex CLI', cls: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300' }
        : { label: 'Claude CLI', cls: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-700 text-purple-700 dark:text-purple-300' }
    }
    if (byokGroup) {
      const cls = providerColorMap[byokGroup.sourceKey] ?? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700 text-green-700 dark:text-green-300'
      return { label: byokGroup.sourceLabel, cls }
    }
    if (cliGroup) {
      return cliGroup.sourceKey === 'codex-cli'
        ? { label: 'Codex CLI', cls: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300' }
        : { label: 'Claude CLI', cls: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-700 text-purple-700 dark:text-purple-300' }
    }
    return { label: 'No provider', cls: 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400' }
  }, [chatAgent?.backend, authMode, cliInstalled, installedClis.claude, installedClis.codex, effectiveModel, availableGroups, hasByok])

  const contextBar = (
    <div className="border-b border-gray-200 dark:border-gray-700/80 bg-gray-50 dark:bg-gray-800/50">
    <div
      className="flex items-center gap-2 px-4 h-9"
      aria-label="Chat context"
    >
      <span
        className="inline-flex items-center gap-1 px-2 rounded-full text-xs font-medium bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 select-none"
        style={{ lineHeight: '20px' }}
        aria-label="Project context"
      >
        {chatProject ? (
          <>
            <span className={`w-2 h-2 rounded-full bg-${chatProject.color}-400`} aria-hidden="true" />
            {chatProject.name}
          </>
        ) : (
          'No project'
        )}
      </span>

      <span
        className="inline-flex items-center gap-1 px-2 rounded-full text-xs font-medium bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 select-none"
        style={{ lineHeight: '20px' }}
        aria-label="Agent context"
      >
        {chatAgent ? (
          <>
            <span aria-hidden="true">{chatAgent.icon}</span>
            {chatAgent.name}
          </>
        ) : (
          'No agent'
        )}
      </span>

      <span
        className={`inline-flex items-center px-2 rounded-full text-xs font-medium border select-none ${backendChip.cls}`}
        style={{ lineHeight: '20px' }}
        title="Active backend for this conversation"
      >
        {backendChip.label}
      </span>
      {lockModelToAgentBackend && (
        <span
          className="inline-flex items-center gap-1 px-2 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-300 select-none"
          style={{ lineHeight: '20px' }}
          title={`This chat is locked to ${backendChip.label} by the selected agent's Chat Backend setting.`}
          aria-label={`Chat backend locked by agent settings to ${backendChip.label}`}
        >
          <Lock className="w-3 h-3" aria-hidden="true" />
          Agent locked
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
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
    </div>
    </div>
  )

  const composer = (
    <ChatComposer
      input={input}
      inputRef={inputRef}
      messages={chat.messages}
      activeAgent={chatAgent as AgentConfig | null}
      authenticated={isReady}
      isOnline={isOnline}
      isGenerating={chat.isGenerating}
      rateLimitRemainingSec={rateLimitRemainingSec}
      conversationId={conversationId}
      effectiveModel={effectiveModel}
      modelSourceLabel={modelSourceLabel}
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
      onOpenPromptLibrary={() => setShowPromptLibrary(true)}
      onAttachArtifact={conversationId ? () => openSectionPane('artifacts') : undefined}
      voiceState={voiceState}
      onToggleVoice={toggleVoice}
      onCancelVoice={cancelVoice}
      onToggleContextInspector={() => setShowContextInspector((value) => !value)}
      onCloseContextInspector={() => setShowContextInspector(false)}
      onRemoveAttachment={fileInput.removeAttachment}
      onRemoveImage={fileInput.removeImage}
      onToggleImageMode={handleToggleImageMode}
      onRemoveContextToken={(token) => {
        if (token === '@clipboard') {
          setClipboardRef(null)
        } else if (token.startsWith('@prompt:')) {
          setPromptInstructionRef(null)
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
      availableGroups={availableGroups}
      onSelectAvailableModel={handleSelectAvailableModel}
      isEditingMessage={chat.isEditingMessage}
      onCancelEdit={handleCancelEdit}
      onStop={actions.handleStop}
      onSend={actions.handleSend}
      cliLockedModels={
        lockModelToAgentBackend
          ? (availableGroups.find((g) => g.sourceKey === chatAgentBackend)?.models ?? [])
          : undefined
      }
      onSelectCliModel={
        lockModelToAgentBackend
          ? (modelId) => { if (conversationId) void actions.handleSetConversationModel(modelId) }
          : undefined
      }
      lockModelToAgentBackend={lockModelToAgentBackend}
    />
  )

  const promptLibraryModal = showPromptLibrary ? (
    <PromptLibraryModal
      projectId={chatProjectId && chatProjectId !== '__none__' ? chatProjectId : null}
      projectName={chatProject?.name ?? null}
      draftContent={input}
      onInsert={handleInsertPrompt}
      onRun={handleRunPrompt}
      onAttachInstruction={handleAttachPromptInstruction}
      onClose={() => setShowPromptLibrary(false)}
    />
  ) : null


  const autoApproveBanner = chatAgent?.fullAutoApprove ? (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs" role="alert" aria-live="polite" aria-label="Auto-approve warning">
      <Zap className="w-3 h-3 shrink-0" aria-hidden="true" />
      <span className="flex-1">Auto-approve is ON — all actions execute immediately</span>
      <button
        onClick={() => saveAgent({ ...chatAgent, fullAutoApprove: false })}
        className="underline hover:no-underline font-medium"
      >
        Disable
      </button>
    </div>
  ) : null

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
        {autoApproveBanner}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            <h2 className="text-2xl font-medium text-gray-700 dark:text-gray-200 mb-2">
              {chatAgent ? `${chatAgent.icon} ${chatAgent.name}` : 'Nexy'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              {chatAgent ? `Start a conversation with ${chatAgent.name}` : (cliInstalled || hasByok) ? 'Chat directly or select an agent' : 'Add an API key in Settings to start chatting'}
            </p>
            {authMode === 'none' && !cliInstalled && (
              <div className="mb-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                No provider configured. Add an API key in Settings.
              </div>
            )}
            {authMode === 'none' && cliInstalled && !hasByok && (() => {
              const both = installedClis.claude && installedClis.codex
              const label = both
                ? 'Claude CLI + Codex CLI ready — start typing'
                : installedClis.codex
                  ? 'Codex CLI is installed — just start typing to chat'
                  : 'Claude CLI is installed — just start typing to chat'
              const cls = both
                ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
                : installedClis.codex
                  ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                  : 'border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300'
              return (
                <div className="mb-4">
                  <div className={`rounded-lg border px-4 py-3 text-sm ${cls}`}>{label}</div>
                  <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                    Optionally select an agent from the sidebar to use a custom system prompt or settings.
                  </p>
                </div>
              )
            })()}
            {fileInput.isDragging && <p className="text-sm text-blue-500 animate-pulse">Drop files to attach</p>}
          </div>
        </div>
        {composer}
        {promptLibraryModal}
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
      {autoApproveBanner}

      <div className="relative flex flex-col flex-1 min-h-0">
        {conversationId && completedConversationIds.includes(conversationId) && !chat.isGenerating && (
          <div className="absolute left-4 top-4 z-10">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-emerald-200 dark:border-emerald-800 bg-emerald-50/95 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[11px] font-medium shadow-sm">
              <CheckCircle className="w-3 h-3" />
              Completed
            </span>
          </div>
        )}
        {(conversationId || chat.messages.length > 0) && !chat.isGenerating && (
          <div className="absolute right-4 top-4 z-10">
            <DropdownPanel
              open={showActionsMenu}
              onClose={() => {
                setShowActionsMenu(false)
                setMenuExportOpen(false)
                setMenuContinueOpen(false)
              }}
              align="right"
              width="w-64"
              trigger={
                <button
                  type="button"
                  onClick={() => setShowActionsMenu((v) => !v)}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-800/95 text-gray-600 dark:text-gray-300 opacity-70 shadow-sm hover:opacity-100 hover:bg-gray-100 dark:hover:bg-gray-700 transition-[background-color,opacity]"
                  aria-label="More options"
                  title="More options"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              }
            >
              <div className="p-1">
                {chatProjectId && chatProjectId !== '__none__' && (
                  <button
                    type="button"
                    onClick={() => { void handleExtractLearnings(); setShowActionsMenu(false) }}
                    disabled={isExtracting}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isExtracting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    Extract learnings
                  </button>
                )}

                {conversationId && !completedConversationIds.includes(conversationId) && chat.messages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { void markConversationCompleteFn(conversationId); setShowActionsMenu(false) }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    Mark complete
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => { setMenuContinueOpen(false); setMenuExportOpen((v) => !v) }}
                  disabled={isExporting || !conversationId || chat.messages.length === 0}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  <span className="flex-1">Export</span>
                  {menuExportOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </button>
                {menuExportOpen && (
                  <div className="ml-5 mb-1">
                    <button
                      type="button"
                      onClick={() => { void handleExportConversation('json'); setShowActionsMenu(false) }}
                      className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      JSON archive
                    </button>
                    <button
                      type="button"
                      onClick={() => { void handleExportConversation('markdown'); setShowActionsMenu(false) }}
                      className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      Markdown transcript
                    </button>
                    <button
                      type="button"
                      onClick={() => { void handleExportConversation('context-bundle'); setShowActionsMenu(false) }}
                      className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      Compact context bundle
                    </button>
                  </div>
                )}

                {conversationId && chat.messages.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuExportOpen(false)
                        if (menuContinueOpen) setMenuContinueOpen(false)
                        else handleOpenContinueWith()
                      }}
                      disabled={isForking}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isForking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      <span className="flex-1">Continue with</span>
                      {menuContinueOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </button>
                    {menuContinueOpen && (
                      <div className="mx-1 mb-2 mt-1 rounded-md border border-gray-100 dark:border-gray-700 p-2">
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">Fork this chat into a new conversation.</div>
                        <label className="block mb-2">
                          <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Model</span>
                          {continueBackend === 'gh-copilot' ? (
                            <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-2 py-1.5 text-xs text-gray-500 dark:text-gray-400">
                              Managed by GitHub Copilot CLI
                            </div>
                          ) : (
                            <select
                              value={continueModel}
                              onChange={(event) => setContinueModel(event.target.value)}
                              className="w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-xs text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500"
                            >
                              {continueModelOptions.map((model) => (
                                <option key={model.id} value={model.id}>
                                  {model.label}
                                </option>
                              ))}
                            </select>
                          )}
                          {continueBackend === 'claude-cli' && (
                            <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">Showing Claude CLI models only.</div>
                          )}
                          {continueBackend === 'codex-cli' && (
                            <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">Showing Codex CLI models only.</div>
                          )}
                        </label>
                        <label className="block mb-2">
                          <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Agent</span>
                          <select
                            value={continueAgentId ?? '__none__'}
                            onChange={(event) => setContinueAgentId(event.target.value === '__none__' ? null : event.target.value)}
                            className="w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-xs text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-600"
                          >
                            <option value="__none__">No agent</option>
                            {agents.map((agent) => (
                              <option key={agent.id} value={agent.id}>
                                {agent.icon} {agent.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setMenuContinueOpen(false)}
                            className="rounded-md px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleContinueWith()}
                            disabled={isForking}
                            className="rounded-md bg-gray-900 dark:bg-gray-100 px-2 py-1 text-xs font-medium text-white dark:text-gray-900 disabled:opacity-60"
                          >
                            {isForking ? 'Forking...' : 'Create fork'}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {conversationId && (
                  <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
                )}

                {conversationId && (
                  <button
                    type="button"
                    onClick={() => { void handleImportIntoConversation(); setShowActionsMenu(false) }}
                    disabled={isImporting}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    Import
                  </button>
                )}

                {conversationId && (
                  <button
                    type="button"
                    onClick={() => { void handleTogglePin(); setShowActionsMenu(false) }}
                    disabled={isPinning}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs disabled:cursor-not-allowed disabled:opacity-60 ${
                      currentConversation?.pinned === 1
                        ? 'text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/30'
                        : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                    aria-label={currentConversation?.pinned === 1 ? 'Unpin conversation' : 'Pin conversation'}
                  >
                    {isPinning
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : currentConversation?.pinned === 1
                        ? <PinOff className="w-3.5 h-3.5" />
                        : <Pin className="w-3.5 h-3.5" />
                    }
                    {currentConversation?.pinned === 1 ? 'Unpin' : 'Pin'}
                  </button>
                )}
              </div>
            </DropdownPanel>
          </div>
        )}
        <ChatMessages
          messages={chat.messages}
          isLoadingMessages={chat.isLoadingMessages}
          isGenerating={chat.isGenerating}
          liveTeamActivity={chat.liveTeamActivity}
          streamingContent={chat.displayedContent}
          generationStartedAt={chat.generationStartedAt}
          loadingFailed={chat.loadingFailed}
          messagesEndRef={messagesEndRef}
          scrollContainerRef={scrollContainerRef}
          onScroll={handleScrollContainerScroll}
          onNavigateToRequest={handleNavigateToRequest}
          onCopy={handleCopy}
          onSaveToWiki={chatProjectId && chatProjectId !== '__none__' ? handleSaveToWiki : undefined}
          onPromoteArtifact={handleOpenArtifactPromotion}
          onCreateCodeChange={(messageId, content) => void handleCreateCodeChange(messageId, content)}
          onCodeChangeDeleted={(messageId) => {
            chat.setMessages((prev) => prev.filter((message) => message.id !== messageId))
          }}
          canCreateCodeChange={Boolean(chatProjectId && chatProjectId !== '__none__')}
          codeChangeModel={effectiveModel}
          codeChangeBackend={chatAgentBackend === 'claude-cli' || chatAgentBackend === 'codex-cli' ? chatAgentBackend : 'byok'}
          wikiMessageIds={wikiMessageIds}
          onRegenerate={chat.handleRegenerate}
          onEdit={handleEditMessage}
          onRetry={actions.handleRetry}
          onSignIn={() => addToast('No provider configured. Add an API key in Settings.', 'info')}
          onPickModel={handlePickModel}
          onUseImageAsContext={(dataUrl) => {
            fileInput.setPendingImages((prev) => [
              ...prev,
              { id: crypto.randomUUID(), dataUrl, name: 'browser-screenshot.png' }
            ])
          }}
          liveTurnState={chat.liveTurnState}
        />
        {isUserScrolledUp && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
            <button
              onClick={() => scrollToBottom('smooth')}
              className={`pointer-events-auto flex items-center justify-center w-8 h-8 rounded-full shadow-lg transition-colors ${
                hasUnreadBelow
                  ? 'bg-blue-600 dark:bg-blue-500 text-white hover:bg-blue-700 dark:hover:bg-blue-400 animate-bounce hover:animate-none'
                  : 'bg-gray-800/70 dark:bg-gray-200/70 text-white dark:text-gray-800 hover:bg-gray-800 dark:hover:bg-gray-200'
              }`}
              aria-label="Scroll to bottom"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
        )}
        {wikiModalMessage && conversationId && chatProjectId && chatProjectId !== '__none__' && (
          <SaveToWikiModal
            projectId={chatProjectId}
            conversationId={conversationId}
            messageId={wikiModalMessage.id}
            initialContent={wikiModalMessage.content}
            onSaved={(entry) => {
              setWikiMessageIds((prev) => new Set([...prev, entry.source_message_id].filter(Boolean) as string[]))
              addToast('Saved to project wiki', 'success')
            }}
            onClose={() => setWikiModalMessage(null)}
          />
        )}
        {extractionCandidates && conversationId && chatProjectId && chatProjectId !== '__none__' && (
          <WikiExtractionModal
            projectId={chatProjectId}
            conversationId={conversationId}
            candidates={extractionCandidates}
            onClose={() => setExtractionCandidates(null)}
            onAllDone={(savedCount) => {
              addToast(`${savedCount} wiki ${savedCount === 1 ? 'entry' : 'entries'} saved`, 'success')
              setExtractionCandidates(null)
            }}
          />
        )}
        {artifactPromotion && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 px-4">
            <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-700 dark:bg-gray-900">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Save As Artifact</h2>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Create a saved, versioned artifact from this assistant response.</p>
                </div>
                <button
                  type="button"
                  onClick={() => artifactPromotion.saving ? undefined : setArtifactPromotion(null)}
                  className="text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
                >
                  Close
                </button>
              </div>
              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Title</span>
                  <input
                    type="text"
                    value={artifactPromotion.title}
                    onChange={(event) => setArtifactPromotion((current) => current ? { ...current, title: event.target.value } : current)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Kind</span>
                    <select
                      value={artifactPromotion.kind}
                      onChange={(event) => {
                        const kind = event.target.value as ArtifactPromotionRequest['kind']
                        setArtifactPromotion((current) => current ? { ...current, kind, filePath: defaultArtifactFilePath(kind) } : current)
                      }}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                    >
                      {PROMOTABLE_ARTIFACT_KINDS.map((kind) => (
                        <option key={kind} value={kind}>{kind}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Scope</span>
                    <select
                      value={artifactPromotion.scopeType}
                      onChange={(event) => setArtifactPromotion((current) => current ? { ...current, scopeType: event.target.value as 'global' | 'project' } : current)}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                    >
                      <option value="global">Global</option>
                      <option value="project" disabled={!chatProjectId || chatProjectId === '__none__'}>This project</option>
                    </select>
                  </label>
                </div>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">File path</span>
                  <input
                    type="text"
                    value={artifactPromotion.filePath}
                    onChange={(event) => setArtifactPromotion((current) => current ? { ...current, filePath: event.target.value } : current)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                  />
                </label>
              </div>
              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setArtifactPromotion(null)}
                  disabled={artifactPromotion.saving}
                  className="rounded-lg px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-60 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => { void handleConfirmArtifactPromotion() }}
                  disabled={artifactPromotion.saving || !artifactPromotion.filePath.trim()}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {artifactPromotion.saving ? 'Saving…' : 'Save artifact'}
                </button>
              </div>
            </div>
          </div>
        )}
        {promptLibraryModal}
      </div>


      {fileInput.isDragging && (
        <div className="absolute inset-0 flex items-center justify-center bg-blue-500/10 pointer-events-none z-10">
          <div className="text-lg font-medium text-blue-500 bg-white dark:bg-gray-800 px-6 py-3 rounded-xl shadow-lg">Drop files to attach</div>
        </div>
      )}
      {rateLimitRemainingSec > 0 && (
        <div className="px-4 pb-2">
          <div className="max-w-3xl mx-auto text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
            Rate limited — you can send again in {rateLimitRemainingSec}s.
          </div>
        </div>
      )}
      {composer}
    </div>
  )
}
