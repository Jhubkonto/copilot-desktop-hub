/* eslint-disable react-hooks/exhaustive-deps -- callbacks use stable store functions and refs across conversations. */
import { useCallback, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react'
import { getModelLabel } from '../../shared/models'
import { isApiError, type AgentConfig, type CatalogModel, type CliBackend, type CliModeOverride, type CodexExecutionModeOverride } from '../../shared/types'
import { getProviderSlashCommands } from '../provider-slash-commands'
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

interface UseChatWindowActionsParams {
  conversationId: string | null
  chatAgentId: string | null
  chatProjectId: string | null
  activeAgent: AgentConfig | null
  /** The CLI backend answering this chat (from ChatWindow's backend detection), null for BYOK. */
  activeCliBackend?: CliBackend | null
  effectiveModel: string
  effectiveModelLabel: string
  conversationModel: string | null
  catalogModels: CatalogModel[]
  globalDefaultModel: string | null
  theme: Theme
  input: string
  setInput: Dispatch<SetStateAction<string>>
  messages: ChatMessage[]
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>
  isGenerating: boolean
  rateLimitRemainingSec: number
  pendingAttachments: Array<{ id: string; name: string; path: string; size: number }>
  pendingImages: Array<{ id: string; name: string; dataUrl: string; label?: string; mode?: 'vision' | 'text'; ocrText?: string; ocrPending?: boolean }>
  setPendingAttachments: Dispatch<SetStateAction<Array<{ id: string; name: string; path: string; size: number }>>>
  setPendingImages: Dispatch<SetStateAction<Array<{ id: string; name: string; dataUrl: string; label?: string; mode?: 'vision' | 'text'; ocrText?: string; ocrPending?: boolean }>>>
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
  editCutoffTimestampRef: MutableRefObject<number | null>
  lastUndoneUserMessageRef: MutableRefObject<string | null>
  streamModelRef: MutableRefObject<string | null>
  streamingContentRef: MutableRefObject<string>
  streamingConversationRef: MutableRefObject<string | null>
  conversationCreated: (id: string) => void
  markConversationGenerating: (id: string) => void
  markConversationDoneGenerating: (id: string) => void
  markConversationPending: (id: string) => void
  clearConversationPending: (id: string) => void
  setIsGenerating: Dispatch<SetStateAction<boolean>>
  setGenerationStartedAt: Dispatch<SetStateAction<number | null>>
  setStreamingContent: Dispatch<SetStateAction<string>>
  resetQueue: () => void
  setLoadingFailed: Dispatch<SetStateAction<boolean>>
  setLiveTeamActivity: Dispatch<SetStateAction<TeamActivityStep[]>>
  addToast: (message: string, type?: ToastType) => void
  pushSystemMessage: (content: string) => void
  buildConversationMarkdown: () => string
  newChat: (opts?: { projectId?: string | null; agentId?: string | null }) => void
  logout: () => Promise<void>
  setTheme: (theme: Theme) => void
  loadAgents: () => Promise<void>
  loadConversations: () => Promise<void>
  markConversationComplete: (id: string) => Promise<void>
  markConversationIncomplete: (id: string) => Promise<void>
  onAfterSend?: () => void
  onEditStateConsumed?: () => void
}

export function useChatWindowActions({
  conversationId,
  chatAgentId,
  chatProjectId,
  activeAgent,
  activeCliBackend = null,
  effectiveModel,
  effectiveModelLabel,
  conversationModel,
  catalogModels,
  globalDefaultModel,
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
  editCutoffTimestampRef,
  lastUndoneUserMessageRef,
  streamModelRef,
  streamingContentRef,
  streamingConversationRef,
  conversationCreated,
  markConversationGenerating,
  markConversationDoneGenerating,
  markConversationPending,
  clearConversationPending,
  setIsGenerating,
  setGenerationStartedAt,
  setStreamingContent,
  resetQueue,
  setLoadingFailed,
  setLiveTeamActivity,
  addToast,
  pushSystemMessage,
  buildConversationMarkdown,
  newChat,
  logout,
  setTheme,
  loadAgents,
  loadConversations,
  markConversationComplete,
  markConversationIncomplete,
  onAfterSend,
  onEditStateConsumed,
}: UseChatWindowActionsParams) {
  // Stores a CLI model and backend chosen before the conversation row exists (new chat), applied on first send.
  const pendingCliModelRef = useRef<string | null>(null)
  const pendingCliBackendRef = useRef<'claude-cli' | 'codex-cli' | null>(null)
  // Same idea for the per-chat thinking effort / auto-approve overrides picked before the
  // conversation row exists — applied when the first message creates it.
  const pendingThinkingEffortRef = useRef<'low' | 'medium' | 'high' | 'max' | 'disabled' | null>(null)
  const pendingFullAutoApproveRef = useRef<boolean | null>(null)
  const pendingAgenticModeRef = useRef<boolean | null>(null)
  const pendingTerminalSandboxRef = useRef<boolean | null>(null)
  const pendingCliModeOverrideRef = useRef<CliModeOverride | null>(null)
  const pendingCodexExecutionModeOverrideRef = useRef<CodexExecutionModeOverride | null>(null)
  // Slash commands (e.g. /debrief, /quiz) run an async IPC round-trip before clearing the
  // composer, so isGenerating alone doesn't block a second Enter press mid-flight. The ref is
  // the synchronous re-entrancy guard (state updates aren't visible synchronously); the state
  // mirror exists purely so the composer can show the same busy affordance it already shows for
  // isGenerating — some commands (/code-change, /code-execute) can run for a long time, and
  // without this the composer looked idle while actually silently ignoring input.
  const executingSlashCommandRef = useRef(false)
  const [isExecutingSlashCommand, setIsExecutingSlashCommand] = useState(false)

  // Kicks off learning-artifact generation and immediately attaches a durable chat card
  // referencing the artifact (created up front with status 'generating'). The actual LLM
  // call runs in the main process in the background, so this resolves fast — the composer
  // isn't blocked for the duration of generation, and the card keeps working if the user
  // navigates away and comes back, since its state lives in the artifacts table.
  const startArtifactGeneration = useCallback(
    async (kind: 'debrief' | 'quiz' | 'teachback', opts?: { model?: string; quizSpec?: import('@shared/types').QuizSpec; teachbackSpec?: import('@shared/types').TeachbackSpec }): Promise<{ ok: true } | { error: string }> => {
      if (!conversationId) return { error: 'No active conversation.' }
      const projectId = chatProjectId && chatProjectId !== '__none__' ? chatProjectId : null
      try {
        const result = kind === 'debrief'
          ? await window.api.startDebriefGeneration(conversationId, projectId, opts?.model)
          : kind === 'quiz'
            ? await window.api.startQuizGeneration(conversationId, projectId, opts?.model, opts?.quizSpec)
            : await window.api.startTeachbackGeneration(conversationId, projectId, opts?.model, opts?.teachbackSpec)
        if (isApiError(result)) return { error: result.error }

        const content = `__artifact-ref:${JSON.stringify({ artifactId: result.artifactId, kind, pending: true })}`
        const inserted = await window.api.insertConversationMessage(conversationId, 'system', content)
        if (isApiError(inserted)) return { error: 'Failed to attach artifact card.' }
        setMessages((prev) => prev.some((m) => m.id === inserted.id) ? prev : [...prev, {
          id: inserted.id,
          role: inserted.role as ChatMessage['role'],
          content: inserted.content,
          timestamp: inserted.timestamp,
          model: inserted.model ?? null,
        }])
        return { ok: true }
      } catch (error) {
        return { error: error instanceof Error ? error.message : `Failed to start ${kind} generation` }
      }
    },
    [conversationId, chatProjectId, setMessages],
  )

  // Resolves which git repo a code-change/git-housekeeping command should target, given an
  // optional repo path argument the user typed. The renderer never deals in raw workspace
  // roots — it only knows projectId + an optional repo argument, and the main process
  // resolves the rest (including "which repo, if the workspace has more than one").
  const resolveCodeChangeRepoOrMessage = useCallback(
    async (repoArg?: string): Promise<{ repoRoot: string; relativePath: string } | { error: string }> => {
      const projectId = chatProjectId && chatProjectId !== '__none__' ? chatProjectId : null
      if (!projectId) return { error: 'This action requires the conversation to be in a project.' }
      const result = await window.api.resolveCodeChangeRepo(projectId, repoArg)
      if (isApiError(result)) return result
      if (result.ok) return { repoRoot: result.repoRoot, relativePath: result.relativePath }
      if (result.reason === 'ambiguous') {
        const candidates = result.candidates ?? []
        return {
          error: `Multiple git repos found in this workspace: ${candidates.join(', ')}. Re-run this command with the repo path added as the last argument, e.g. "${candidates[0]}".`,
        }
      }
      return { error: "No git repository was found under this project's workspace. Run /code-init [path] to create one, then try again." }
    },
    [chatProjectId],
  )

  // Code-change commands like /code-execute can run for a long time (a real LLM/fix/verify
  // cycle, not a quick local op). ctx.pushSystemMessage only ever appends to this render's
  // local `messages` state — if the user switches to a different conversation before the await
  // resolves, that completion text would silently land in whichever conversation happens to be
  // open when it finishes, and vanish on next reload since it was never persisted. This persists
  // the message against the conversation the command was actually run against, and only mirrors
  // it into the live view if that conversation is still the one on screen.
  const appendPersistedSystemMessage = useCallback(
    async (targetConversationId: string, content: string) => {
      const inserted = await window.api.insertConversationMessage(targetConversationId, 'system', content)
      if (isApiError(inserted)) return
      if (activeConversationRef.current === targetConversationId) {
        setMessages((prev) => [...prev, {
          id: inserted.id,
          role: inserted.role as ChatMessage['role'],
          content: inserted.content,
          timestamp: inserted.timestamp,
          model: inserted.model ?? null,
        }])
      }
    },
    [setMessages, activeConversationRef],
  )

  const getCurrentCodeChangeReportId = useCallback(async (): Promise<string | { error: string }> => {
    if (!conversationId) return { error: 'No active conversation.' }
    try {
      const report = await window.api.getCodeChangeReportForConversation(conversationId)
      if (isApiError(report)) return report
      if (!report) return { error: 'No code change in this conversation yet. Run /code-change first.' }
      return report.id
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Failed to look up code change report' }
    }
  }, [conversationId])

  const codeChangeSubmitDescription = useCallback(
    async (description: string, repoArg?: string): Promise<{ reportId: string } | { error: string }> => {
      if (!conversationId) return { error: 'No active conversation. Send a message first, then create a code change.' }
      const projectId = chatProjectId && chatProjectId !== '__none__' ? chatProjectId : null
      if (!projectId) return { error: 'Code changes require this conversation to be in a project.' }
      try {
        const result = await window.api.submitCodeChangeDescription(conversationId, projectId, description, repoArg)
        return result
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to submit code change description' }
      }
    },
    [conversationId, chatProjectId],
  )

  const codeChangeGetStatus = useCallback(async () => {
    if (!conversationId) return { error: 'No active conversation.' as const }
    try {
      return await window.api.getCodeChangeStatus(conversationId)
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Failed to fetch code change status' }
    }
  }, [conversationId])

  const codeChangeExecute = useCallback(async () => {
    const reportId = await getCurrentCodeChangeReportId()
    if (typeof reportId !== 'string') return reportId
    try {
      await window.api.acceptCodeChangePlan(reportId)
      return { ok: true as const }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Failed to execute the plan' }
    }
  }, [getCurrentCodeChangeReportId])

  const codeChangePush = useCallback(async () => {
    const reportId = await getCurrentCodeChangeReportId()
    if (typeof reportId !== 'string') return reportId
    try {
      await window.api.pushCodeChange(reportId)
      return { ok: true as const }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Failed to push' }
    }
  }, [getCurrentCodeChangeReportId])

  const codeChangeUndo = useCallback(async () => {
    const reportId = await getCurrentCodeChangeReportId()
    if (typeof reportId !== 'string') return reportId
    try {
      return await window.api.undoCodeChange(reportId)
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Failed to undo' }
    }
  }, [getCurrentCodeChangeReportId])

  const codeChangeListBranches = useCallback(
    async (repoArg?: string) => {
      const resolved = await resolveCodeChangeRepoOrMessage(repoArg)
      if ('error' in resolved) return resolved
      try {
        return await window.api.listCodeChangeBranches(resolved.repoRoot)
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to list branches' }
      }
    },
    [resolveCodeChangeRepoOrMessage],
  )

  const codeChangeCheckoutBranch = useCallback(
    async (branchName: string, repoArg?: string) => {
      const resolved = await resolveCodeChangeRepoOrMessage(repoArg)
      if ('error' in resolved) return resolved
      try {
        return await window.api.checkoutCodeChangeBranch(resolved.repoRoot, branchName)
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to check out branch' }
      }
    },
    [resolveCodeChangeRepoOrMessage],
  )

  const codeChangeNewBranch = useCallback(
    async (branchName: string, fromRef?: string, repoArg?: string) => {
      const resolved = await resolveCodeChangeRepoOrMessage(repoArg)
      if ('error' in resolved) return resolved
      try {
        return await window.api.newCodeChangeBranch(resolved.repoRoot, branchName, fromRef)
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to create branch' }
      }
    },
    [resolveCodeChangeRepoOrMessage],
  )

  const codeChangeFetch = useCallback(
    async (remote?: string, repoArg?: string) => {
      const resolved = await resolveCodeChangeRepoOrMessage(repoArg)
      if ('error' in resolved) return resolved
      try {
        return await window.api.fetchCodeChangeRepo(resolved.repoRoot, remote)
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to fetch' }
      }
    },
    [resolveCodeChangeRepoOrMessage],
  )

  const codeChangeMergeBranch = useCallback(
    async (sourceBranch: string, repoArg?: string) => {
      const resolved = await resolveCodeChangeRepoOrMessage(repoArg)
      if ('error' in resolved) return resolved
      try {
        return await window.api.mergeCodeChangeBranch(resolved.repoRoot, sourceBranch)
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to merge' }
      }
    },
    [resolveCodeChangeRepoOrMessage],
  )

  // Deliberately does not go through resolveCodeChangeRepoOrMessage — that helper's whole job is
  // resolving an *existing* repo, which is exactly what's missing here. This is the action that
  // gets the user unstuck when resolution fails with "no-repo".
  const codeChangeInitRepo = useCallback(
    async (relativePath?: string) => {
      if (!chatProjectId || chatProjectId === '__none__') {
        return { error: 'This action requires the conversation to be in a project.' }
      }
      try {
        return await window.api.initCodeChangeRepo(chatProjectId, relativePath)
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to initialize repository' }
      }
    },
    [chatProjectId],
  )

  const codeChangeDetectCredentials = useCallback(
    async (repoArg?: string) => {
      const resolved = await resolveCodeChangeRepoOrMessage(repoArg)
      if ('error' in resolved) return resolved
      try {
        return await window.api.detectCodeChangeCredentials(resolved.repoRoot)
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to detect git credentials' }
      }
    },
    [resolveCodeChangeRepoOrMessage],
  )

  const codeChangePull = useCallback(
    async (repoArg?: string) => {
      const resolved = await resolveCodeChangeRepoOrMessage(repoArg)
      if ('error' in resolved) return resolved
      try {
        return await window.api.pullCodeChangeRepo(resolved.repoRoot)
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to pull' }
      }
    },
    [resolveCodeChangeRepoOrMessage],
  )

  const codeChangePushBranch = useCallback(
    async (repoArg?: string) => {
      const resolved = await resolveCodeChangeRepoOrMessage(repoArg)
      if ('error' in resolved) return resolved
      try {
        return await window.api.pushCodeChangeBranch(resolved.repoRoot)
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to push' }
      }
    },
    [resolveCodeChangeRepoOrMessage],
  )

  const codeChangeCommit = useCallback(
    async (message: string, repoArg?: string) => {
      const resolved = await resolveCodeChangeRepoOrMessage(repoArg)
      if ('error' in resolved) return resolved
      try {
        return await window.api.commitCodeChangeFiles(resolved.repoRoot, message)
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to commit' }
      }
    },
    [resolveCodeChangeRepoOrMessage],
  )

  const codeChangeDiscardFile = useCallback(
    async (relativePath: string, repoArg?: string) => {
      const resolved = await resolveCodeChangeRepoOrMessage(repoArg)
      if ('error' in resolved) return resolved
      try {
        return await window.api.discardCodeChangeFile(resolved.repoRoot, relativePath)
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to discard changes' }
      }
    },
    [resolveCodeChangeRepoOrMessage],
  )

  const codeChangeStageFiles = useCallback(
    async (relativePaths: string[], repoArg?: string) => {
      const resolved = await resolveCodeChangeRepoOrMessage(repoArg)
      if ('error' in resolved) return resolved
      try {
        return await window.api.stageCodeChangeFiles(resolved.repoRoot, relativePaths)
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to stage files' }
      }
    },
    [resolveCodeChangeRepoOrMessage],
  )

  const codeChangeUnstageFiles = useCallback(
    async (relativePaths: string[], repoArg?: string) => {
      const resolved = await resolveCodeChangeRepoOrMessage(repoArg)
      if ('error' in resolved) return resolved
      try {
        return await window.api.unstageCodeChangeFiles(resolved.repoRoot, relativePaths)
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to unstage files' }
      }
    },
    [resolveCodeChangeRepoOrMessage],
  )

  const codeChangeStash = useCallback(
    async (message?: string, repoArg?: string) => {
      const resolved = await resolveCodeChangeRepoOrMessage(repoArg)
      if ('error' in resolved) return resolved
      try {
        return await window.api.stashCodeChanges(resolved.repoRoot, message)
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to stash' }
      }
    },
    [resolveCodeChangeRepoOrMessage],
  )

  const codeChangeStashPop = useCallback(
    async (repoArg?: string) => {
      const resolved = await resolveCodeChangeRepoOrMessage(repoArg)
      if ('error' in resolved) return resolved
      try {
        return await window.api.stashPopCodeChanges(resolved.repoRoot)
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to pop stash' }
      }
    },
    [resolveCodeChangeRepoOrMessage],
  )

  const codeChangeDeleteBranch = useCallback(
    async (branchName: string, repoArg?: string) => {
      const resolved = await resolveCodeChangeRepoOrMessage(repoArg)
      if ('error' in resolved) return resolved
      try {
        return await window.api.deleteCodeChangeBranch(resolved.repoRoot, branchName)
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to delete branch' }
      }
    },
    [resolveCodeChangeRepoOrMessage],
  )

  const slashCommandCtx = useMemo<SlashCommandContext>(
    () => ({
      conversationId,
      chatProjectId,
      messages: messages.filter((message) => message.role !== 'team-activity') as SlashCommandContext['messages'],
      activeAgent,
      activeCliBackend,
      // Mirrors handleSetConversationMode's cliModeOverride path (that callback is declared
      // later in this hook, so it can't be referenced from this memo directly).
      setCliMode: async (mode: CliModeOverride | null) => {
        if (!conversationId) {
          pendingCliModeOverrideRef.current = mode
          return
        }
        const result = await window.api.setConversationMode(conversationId, { cliModeOverride: mode })
        if (isApiError(result)) throw new Error(result.error)
        await loadConversations()
      },
      effectiveModelLabel,
      conversationModel,
      catalogModels,
      theme,
      pushSystemMessage,
      // Falls back to the ephemeral (unpersisted) path when there's no conversation to persist
      // against — e.g. a code-change command erroring out with "No active conversation" itself
      // has no conversationId to attach to, and silently no-opping here would swallow that very
      // error message instead of showing it.
      pushPersistentMessage: (content: string) => {
        if (!conversationId) {
          pushSystemMessage(content)
          return Promise.resolve()
        }
        return appendPersistedSystemMessage(conversationId, content)
      },
      newChat,
      logout,
      setInput,
      setTheme,
      loadAgents,
      loadConversations,
      buildConversationMarkdown,
      deleteMessagesAfter: (convId: string, ts: number) => window.api.deleteMessagesAfter(convId, ts).then(() => undefined),
      lastUndoneUserMessageRef,
      setMessages: setMessages as SlashCommandContext['setMessages'],
      markComplete: () => (conversationId ? markConversationComplete(conversationId) : Promise.resolve()),
      markIncomplete: () => (conversationId ? markConversationIncomplete(conversationId) : Promise.resolve()),
      startArtifactGeneration,
      codeChangeSubmitDescription,
      codeChangeGetStatus,
      codeChangeExecute,
      codeChangePush,
      codeChangeUndo,
      codeChangeListBranches,
      codeChangeCheckoutBranch,
      codeChangeNewBranch,
      codeChangeFetch,
      codeChangeMergeBranch,
      codeChangeInitRepo,
      codeChangeDetectCredentials,
      codeChangePull,
      codeChangePushBranch,
      codeChangeCommit,
      codeChangeDiscardFile,
      codeChangeStash,
      codeChangeStashPop,
      codeChangeDeleteBranch,
      codeChangeStageFiles,
      codeChangeUnstageFiles,
    }),
    [
      conversationId,
      chatProjectId,
      messages,
      activeAgent,
      activeCliBackend,
      effectiveModelLabel,
      conversationModel,
      catalogModels,
      theme,
      pushSystemMessage,
      appendPersistedSystemMessage,
      newChat,
      logout,
      setInput,
      setTheme,
      loadAgents,
      loadConversations,
      buildConversationMarkdown,
      lastUndoneUserMessageRef,
      setMessages,
      markConversationComplete,
      markConversationIncomplete,
      startArtifactGeneration,
      codeChangeSubmitDescription,
      codeChangeGetStatus,
      codeChangeExecute,
      codeChangePush,
      codeChangeUndo,
      codeChangeListBranches,
      codeChangeCheckoutBranch,
      codeChangeNewBranch,
      codeChangeFetch,
      codeChangeMergeBranch,
      codeChangeInitRepo,
      codeChangeDetectCredentials,
      codeChangePull,
      codeChangePushBranch,
      codeChangeCommit,
      codeChangeDiscardFile,
      codeChangeStash,
      codeChangeStashPop,
      codeChangeDeleteBranch,
      codeChangeStageFiles,
      codeChangeUnstageFiles,
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
          source: 'agent' as const,
        })),
    [activeAgent, input],
  )

  // Commands specific to the CLI backend answering this chat (plan mode, sandbox levels, …) —
  // the list follows the active backend, so switching model/backend swaps the commands shown.
  const providerSlashCommands = useMemo<SlashCommandDef[]>(
    () =>
      getProviderSlashCommands(activeCliBackend).filter((command) =>
        command.name.slice(1).startsWith((input.match(/^\/([a-z-]*)$/i)?.[1] ?? '').toLowerCase()),
      ),
    [activeCliBackend, input],
  )

  const visibleSlashCommands = useMemo(
    () => [...filteredSlashCommands, ...customSlashCommands, ...providerSlashCommands].slice(0, 12),
    [filteredSlashCommands, customSlashCommands, providerSlashCommands],
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

  const handleSend = useCallback(async (inputOverride?: unknown) => {
    const draftInput = typeof inputOverride === 'string' ? inputOverride : input
    const hasContent = draftInput.trim().length > 0 || pendingImages.length > 0 || pendingAttachments.length > 0
    if (!hasContent || isGenerating || executingSlashCommandRef.current || rateLimitRemainingSec > 0) return

    // Block send while any OCR job is in progress
    if (pendingImages.some((img) => img.ocrPending)) return

    let content = draftInput.trim()
    if (!content && (pendingImages.length > 0 || pendingAttachments.length > 0)) {
      content = 'Please analyze the attached context.'
    }
    if (content.startsWith('/')) {
      const transformed = transformCodeSlashCommand(content)
      if (transformed) {
        content = transformed
      } else {
        executingSlashCommandRef.current = true
        setIsExecutingSlashCommand(true)
        let outcome: Awaited<ReturnType<typeof executeSlashCommand>>
        try {
          outcome = await executeSlashCommand(content, slashCommandCtx)
        } finally {
          executingSlashCommandRef.current = false
          setIsExecutingSlashCommand(false)
        }
        if (outcome === 'handled') {
          setInput('')
          closeSlashMenu()
          return
        }
        if (outcome === 'expanded') {
          // executeSlashCommand already placed the expanded prompt in the input via
          // ctx.setInput — leave it there for the user to review/send, don't clear it.
          closeSlashMenu()
          return
        }
      }
    }

    if (draftInput.trim().startsWith('/')) closeSlashMenu()

    const attachments = pendingAttachments.length > 0 ? [...pendingAttachments] : undefined
    // Separate OCR-text images from vision images
    const allPendingImages = [...pendingImages]
    const visionImages = allPendingImages.filter((img) => img.mode !== 'text')
    const ocrImages = allPendingImages.filter((img) => img.mode === 'text' && img.ocrText)
    const images = allPendingImages.length > 0 ? allPendingImages : undefined
    const visionImagesForSend = visionImages.length > 0 ? visionImages : undefined
    const autoRefs: ContextRef[] = []

    if (activeAgent?.contextRules?.autoInjectWorkspace && !contextRefs.some((ref) => ref.key === 'workspace')) {
      autoRefs.push({ key: 'workspace', token: '@workspace' })
    }
    if (activeAgent?.contextRules?.autoInjectGit && !contextRefs.some((ref) => ref.key === 'git')) {
      autoRefs.push({ key: 'git', token: '@git' })
    }

    // Inject OCR text blocks before context resolution so they are sent to LLM
    if (ocrImages.length > 0) {
      const ocrBlocks = ocrImages
        .map((img) => `[OCR from: ${img.name}${img.label ? ` (${img.label})` : ''}]\n${img.ocrText}`)
        .join('\n\n')
      content = `${ocrBlocks}\n\n${content}`
    }

    const effectiveRefs = [...contextRefs, ...autoRefs]
    const cleanedContent = content
      .replace(/(?:^|\s)@(workspace|git|wiki)\b/gi, ' ')
      .replace(/(?:^|\s)@file:[^\s]+/gi, ' ')
      .replace(/(?:^|\s)@prompt:[^\s]+/gi, ' ')
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

    const userDisplayContent = draftInput.trim()
    const editCutoffTimestamp =
      pendingEditedResendRef.current && editCutoffTimestampRef.current != null
        ? editCutoffTimestampRef.current
        : null
    const systemPrompt = activeAgent?.systemPrompt ?? ''
    const tokenEstimate = (value: string) => Math.ceil(value.length / 4)
    const contextSnapshot: ContextSnapshot = {
      systemPrompt,
      contextRefs: effectiveRefs.map((ref) => ({ token: ref.token, key: ref.key })),
      attachments: pendingAttachments.map((attachment) => ({ name: attachment.name, size: attachment.size })),
      historyLength: messages.filter((message) => message.role !== 'system').length,
      estimatedTokens:
        tokenEstimate(systemPrompt) +
        effectiveRefs.reduce((sum, ref) => sum + (ref.key === 'workspace' ? 500 : ref.key === 'git' ? 200 : ref.key === 'wiki' ? 1000 : ref.key === 'prompt-instruction' ? tokenEstimate(ref.value ?? '') : 300), 0) +
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
    onEditStateConsumed?.()

    setMessages((prev) => [...prev, userMessage])
    const sent = draftInput.trim()
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
    resetQueue()
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
      markConversationPending(conversation)
      activeConversationRef.current = conversation
    }
    streamingConversationRef.current = conversation
    markConversationGenerating(conversation)

    try {
      if (editCutoffTimestamp != null) {
        await window.api.deleteMessagesAfter(conversation, editCutoffTimestamp).catch(() => {
          addToast('Failed to delete messages from edited point', 'error')
        })
      }
      const effectiveRequestModel = requestModel ?? pendingCliModelRef.current ?? undefined
      pendingCliModelRef.current = null
      const effectiveRequestBackend = pendingCliBackendRef.current ?? undefined
      pendingCliBackendRef.current = null
      const effectiveThinkingEffortOverride = pendingThinkingEffortRef.current
      pendingThinkingEffortRef.current = null
      const effectiveFullAutoApproveOverride = pendingFullAutoApproveRef.current
      pendingFullAutoApproveRef.current = null
      const effectiveAgenticModeOverride = pendingAgenticModeRef.current
      pendingAgenticModeRef.current = null
      const effectiveTerminalSandboxOverride = pendingTerminalSandboxRef.current
      pendingTerminalSandboxRef.current = null
      const effectiveCliModeOverride = pendingCliModeOverrideRef.current
      pendingCliModeOverrideRef.current = null
      const effectiveCodexExecutionModeOverride = pendingCodexExecutionModeOverrideRef.current
      pendingCodexExecutionModeOverrideRef.current = null
      const sendResult = await window.api.sendMessage(conversation, content, {
        attachments,
        images: visionImagesForSend,
        agentId: chatAgentId ?? undefined,
        model: effectiveRequestModel,
        cliBackend: effectiveRequestBackend,
        messageId: userMessage.id,
        projectId: chatProjectId ?? undefined,
        contextSnapshot: contextSnapshotJson,
        displayContent: userDisplayContent,
        thinkingEffortOverride: effectiveThinkingEffortOverride,
        fullAutoApproveOverride: effectiveFullAutoApproveOverride,
        agenticModeOverride: effectiveAgenticModeOverride,
        terminalSandboxOverride: effectiveTerminalSandboxOverride,
        cliModeOverride: effectiveCliModeOverride,
        codexExecutionModeOverride: effectiveCodexExecutionModeOverride,
      }) as unknown
      if (isApiError(sendResult)) throw new Error(sendResult.error)
      void loadConversations()
      clearConversationPending(conversation)
      onAfterSend?.()
    } catch (error) {
      console.error('Failed to send message:', error)
      const failedConvId = streamingConversationRef.current ?? ''
      streamingConversationRef.current = null
      markConversationDoneGenerating(failedConvId)
      clearConversationPending(failedConvId)
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
    editCutoffTimestampRef,
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
    resetQueue,
    setLiveTeamActivity,
    streamingContentRef,
    streamModelRef,
    activeConversationRef,
    streamingConversationRef,
    justCreatedConversationRef,
    conversationCreated,
    markConversationGenerating,
    markConversationDoneGenerating,
    chatAgentId,
    chatProjectId,
    onAfterSend,
    onEditStateConsumed,
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

    const conversation = activeConversationRef.current
    if (!conversation) return

    streamingConversationRef.current = conversation
    markConversationGenerating(conversation)
    setIsGenerating(true)
    setGenerationStartedAt(Date.now())
    resetQueue()
    setStreamingContent('')
    streamingContentRef.current = ''

    try {
      await window.api.sendMessage(conversation, lastUser.content, {
        regenerate: true,
        model: effectiveModel === 'default' ? undefined : effectiveModel,
      })
    } catch (error) {
      console.error('Retry failed:', error)
      streamingConversationRef.current = null
      markConversationDoneGenerating(conversation)
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
    resetQueue,
    streamingContentRef,
    streamingConversationRef,
    activeConversationRef,
    markConversationGenerating,
    markConversationDoneGenerating,
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

  const handleSetConversationModel = useCallback(
    async (model: string) => {
      if (!conversationId) return
      const value = model === 'default' ? null : model
      try {
        const result = await window.api.setConversationModel(conversationId, value)
        if (isApiError(result)) throw new Error(result.error)
        await loadConversations()
        addToast(`Model set to ${getModelLabel(model, catalogModels, globalDefaultModel ?? undefined)}`, 'success')
      } catch {
        addToast('Failed to set conversation model', 'error')
      }
    },
    [conversationId, loadConversations, catalogModels, globalDefaultModel, addToast],
  )

  const handleSetCliModel = useCallback(
    async (model: string) => {
      if (!activeAgent?.id) {
        // Auto-fallback case (no agent): store as conversation model so chat-handlers can read it
        if (!conversationId) {
          pendingCliModelRef.current = model
          return
        }
        try {
          const result = await window.api.setConversationModel(conversationId, model)
          if (isApiError(result)) throw new Error(result.error)
          await loadConversations()
        } catch {
          addToast('Failed to set model', 'error')
        }
        return
      }
      try {
        const result = await window.api.updateAgent(activeAgent.id, { ...activeAgent, cliModel: model })
        if (isApiError(result)) throw new Error(result.error)
        await loadAgents()
      } catch {
        addToast('Failed to update CLI model', 'error')
      }
    },
    [activeAgent, conversationId, loadConversations, loadAgents, addToast],
  )

  const handleSetCliBackendAndModel = useCallback(
    async (backend: 'claude-cli' | 'codex-cli', modelId: string) => {
      if (conversationId) {
        try {
          const result = await window.api.setConversationModel(conversationId, modelId, backend)
          if (isApiError(result)) throw new Error(result.error)
          await loadConversations()
        } catch {
          addToast('Failed to set model', 'error')
        }
        return
      }
      pendingCliModelRef.current = modelId
      pendingCliBackendRef.current = backend
    },
    [conversationId, loadConversations, addToast],
  )

  const handleSetConversationMode = useCallback(
    async (mode: { thinkingEffortOverride?: 'low' | 'medium' | 'high' | 'max' | 'disabled' | null; fullAutoApproveOverride?: boolean | null; agenticModeOverride?: boolean | null; terminalSandboxOverride?: boolean | null; cliModeOverride?: CliModeOverride | null; codexExecutionModeOverride?: CodexExecutionModeOverride | null }) => {
      if (!conversationId) {
        if (mode.thinkingEffortOverride !== undefined) pendingThinkingEffortRef.current = mode.thinkingEffortOverride
        if (mode.fullAutoApproveOverride !== undefined) pendingFullAutoApproveRef.current = mode.fullAutoApproveOverride
        if (mode.agenticModeOverride !== undefined) pendingAgenticModeRef.current = mode.agenticModeOverride
        if (mode.terminalSandboxOverride !== undefined) pendingTerminalSandboxRef.current = mode.terminalSandboxOverride
        if (mode.cliModeOverride !== undefined) pendingCliModeOverrideRef.current = mode.cliModeOverride
        if (mode.codexExecutionModeOverride !== undefined) pendingCodexExecutionModeOverrideRef.current = mode.codexExecutionModeOverride
        return
      }
      try {
        const result = await window.api.setConversationMode(conversationId, mode)
        if (isApiError(result)) throw new Error(result.error)
        await loadConversations()
      } catch {
        addToast('Failed to set chat mode', 'error')
      }
    },
    [conversationId, loadConversations, addToast],
  )

  const handleStop = useCallback(async () => {
    try {
      await window.api.stopGeneration(conversationId ?? undefined)
      const stoppedConvId = streamingConversationRef.current ?? conversationId ?? ''
      streamingConversationRef.current = null
      markConversationDoneGenerating(stoppedConvId)
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
    streamingConversationRef,
    markConversationDoneGenerating,
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
    handleSetConversationModel,
    handleSetConversationMode,
    handleSetCliModel,
    handleSetCliBackendAndModel,
    handleStop,
    handleKeyDown,
    isExecutingSlashCommand,
  }
}
