import { useCallback, useEffect, useRef, useState } from 'react'
import { Sparkles, Loader2, ArrowLeft, Ban, RefreshCw } from 'lucide-react'
import type {
  AutomatedWorkflowConfirmationMode,
  AutomatedWorkflowGeneratorMessage,
  AutomatedWorkflowRunDetail,
  AutomatedWorkflowRunStep,
  AutomatedWorkflowRunSummary,
  AutomatedWorkflowSpec,
  AvailableModelEntry,
  AvailableModelGroup,
} from '../../../shared/types'
import { isApiError } from '../../../shared/types'
import { useAppStore } from '../../store/app-store'
import { ModelPicker } from '../chat/ModelPicker'
import {
  ActionButton,
  ChatBubble,
  ConfirmationModeToggle,
  RunListRow,
  StepCard,
  stripSpecTags,
} from '../automated-workflow/AutomatedWorkflowShared'
import { clearAutomatedWorkflowGeneration, trackAutomatedWorkflowGeneration } from '../BackgroundActivityBridges'

type FilterTab = 'all' | 'global'

// Global, top-level browse/manage surface for Automated Workflow runs — additive to (not a
// replacement for) the project-scoped generator in AutomatedWorkflowTab.tsx, which still owns
// project-specific plan generation (it needs scope/milestones/agent context this pane doesn't
// have). This pane reads the same underlying data via listAllAutomatedWorkflowRuns() and is also
// where a project-less (self-contained) workflow gets created and run, since project-scoped
// generation has nowhere else that makes sense for it.
export function AutomatedWorkflowsPane() {
  const projects = useAppStore((s) => s.projects)
  const catalogModels = useAppStore((s) => s.catalogModels)
  const globalDefaultModel = useAppStore((s) => s.globalDefaultModel)
  const selectProject = useAppStore((s) => s.selectProject)
  const selectConversation = useAppStore((s) => s.selectConversation)
  const setSectionPane = useAppStore((s) => s.setSectionPane)

  const [view, setView] = useState<'list' | 'generate' | 'detail'>('list')
  const [runs, setRuns] = useState<AutomatedWorkflowRunSummary[]>([])
  const [filter, setFilter] = useState<FilterTab>('all')
  const [loading, setLoading] = useState(true)
  const [activeRun, setActiveRun] = useState<AutomatedWorkflowRunDetail | null>(null)
  const [stepStreamText, setStepStreamText] = useState<Record<string, string>>({})
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const activeRunRef = useRef<AutomatedWorkflowRunDetail | null>(null)
  activeRunRef.current = activeRun

  // Generator (project-less) state
  const [messages, setMessages] = useState<AutomatedWorkflowGeneratorMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [streamingText, setStreamingText] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [genModel, setGenModel] = useState<string | null>(null)
  const [availableGroups, setAvailableGroups] = useState<AvailableModelGroup[]>([])
  const modelPickerRef = useRef<HTMLButtonElement>(null)
  const streamingTextRef = useRef('')
  const chatEndRef = useRef<HTMLDivElement>(null)

  const projectName = (projectId: string | null) =>
    projectId ? (projects.find((p) => p.id === projectId)?.name ?? 'Project') : 'Global'

  const loadRuns = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.api.listAllAutomatedWorkflowRuns()
      if (!isApiError(result)) setRuns(result)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRuns()
  }, [loadRuns])

  useEffect(() => {
    window.api.listAvailableModels().then(setAvailableGroups).catch(() => {})
  }, [])

  // Same reasoning as AutomatedWorkflowTab.tsx: the executor persists to SQLite and broadcasts a
  // change event rather than mutating renderer state directly, so any run's transition — on this
  // device or another connected client — needs a refetch to be reflected here.
  useEffect(() => {
    const off = window.api.onAutomatedWorkflowRunsChanged(({ runId }) => {
      void loadRuns()
      if (activeRunRef.current?.id === runId) {
        window.api.getAutomatedWorkflowRun(runId).then((detail) => {
          if (detail && !isApiError(detail)) setActiveRun(detail)
        }).catch(() => {})
      }
    })
    return off
  }, [loadRuns])

  useEffect(() => {
    const off = window.api.onAutomatedWorkflowStepStream(({ runId, stepDbId, chunk }) => {
      if (activeRunRef.current?.id !== runId) return
      setStepStreamText((prev) => ({ ...prev, [stepDbId]: (prev[stepDbId] ?? '') + chunk }))
    })
    return off
  }, [])

  useEffect(() => {
    if (!activeRun) { setStepStreamText({}); return }
    const runningIds = new Set(activeRun.steps.filter((s) => s.status === 'running').map((s) => s.dbId))
    setStepStreamText((prev) => {
      const next: Record<string, string> = {}
      for (const id of Object.keys(prev)) {
        if (runningIds.has(id)) next[id] = prev[id]
      }
      return next
    })
  }, [activeRun])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  useEffect(() => {
    const offToken = window.api.onAutomatedWorkflowGeneratorToken((chunk) => {
      streamingTextRef.current += chunk
      setStreamingText((current) => current + chunk)
    })
    const offSpec = window.api.onAutomatedWorkflowGeneratorSpecReady(async (incoming: AutomatedWorkflowSpec) => {
      try {
        const saved = await window.api.saveAutomatedWorkflowRunFromSpec(null, incoming, genModel, null)
        if (saved && !isApiError(saved)) {
          setActiveRun(saved)
          setView('detail')
          void loadRuns()
        }
      } catch {
        // surfaced via the generator's own error event below
      }
    })
    const offDone = window.api.onAutomatedWorkflowGeneratorDone(({ hasSpec }) => {
      const capturedText = streamingTextRef.current
      const clean = stripSpecTags(capturedText)
      if (clean) setMessages((prev) => [...prev, { role: 'assistant', content: clean }])
      setIsGenerating(false)
      setStreamingText('')
      streamingTextRef.current = ''
      void hasSpec
    })
    return () => { offToken(); offSpec(); offDone() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- genModel read at send-time is fine; avoids resubscribing on every keystroke
  }, [loadRuns])

  const sendMessage = async (userText: string) => {
    const trimmed = userText.trim()
    if (!trimmed || isGenerating) return
    const nextMessages: AutomatedWorkflowGeneratorMessage[] = [...messages, { role: 'user', content: trimmed }]
    setMessages(nextMessages)
    setInputText('')
    setIsGenerating(true)
    trackAutomatedWorkflowGeneration(null)
    setStreamingText('')
    streamingTextRef.current = ''
    try {
      const result = await window.api.automatedWorkflowGeneratorChat(null, nextMessages, genModel ?? undefined)
      if (result && typeof result === 'object' && 'error' in result) {
        throw new Error(String((result as { error: unknown }).error))
      }
    } catch {
      setIsGenerating(false)
    } finally {
      clearAutomatedWorkflowGeneration(null)
    }
  }

  const applyRunUpdate = (updated: AutomatedWorkflowRunDetail | null) => {
    if (!updated) return
    setActiveRun(updated)
    setRuns((prev) => prev.map((r) => (r.id === updated.id ? updated : r)).sort((a, b) => b.updatedAt - a.updatedAt))
  }

  const runAction = async (key: string, action: () => Promise<AutomatedWorkflowRunDetail | null | { error: string }>) => {
    setBusyAction(key)
    try {
      const updated = await action()
      if (updated && !isApiError(updated)) applyRunUpdate(updated)
    } catch {
      // best-effort — the run's own error/lastError surfaces in the detail view
    } finally {
      setBusyAction(null)
    }
  }

  const openRun = async (runId: string) => {
    const detail = await window.api.getAutomatedWorkflowRun(runId)
    if (detail && !isApiError(detail)) {
      setActiveRun(detail)
      setView('detail')
    }
  }

  const discardRun = async (runId: string) => {
    if (!confirm('Discard this workflow plan? This cannot be undone.')) return
    const ok = await window.api.discardAutomatedWorkflowRun(runId)
    if (ok) {
      setRuns((prev) => prev.filter((r) => r.id !== runId))
      if (activeRun?.id === runId) { setActiveRun(null); setView('list') }
    }
  }

  const handleOpenConversation = (conversationId: string) => {
    if (activeRun?.projectId) selectProject(activeRun.projectId)
    selectConversation(conversationId)
    setSectionPane('workflows')
  }

  const byStepKey = new Map(activeRun ? activeRun.steps.map((s) => [s.id, s]) : [])
  const isDependencySatisfied = (key: string) => {
    const dep = byStepKey.get(key)
    return dep?.status === 'done' || dep?.status === 'skipped'
  }
  const waitingOnTitles = (step: AutomatedWorkflowRunStep) =>
    (step.dependsOnStepIds ?? [])
      .filter((depKey) => !isDependencySatisfied(depKey))
      .map((depKey) => byStepKey.get(depKey)?.title ?? depKey)

  const runInProgress = activeRun?.status === 'running' || activeRun?.status === 'awaiting_confirmation'

  const filtered = runs.filter((r) => (filter === 'global' ? !r.projectId : true))

  if (view === 'detail' && activeRun) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 h-9 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <button
            onClick={() => { setActiveRun(null); setView('list') }}
            className="p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            aria-label="Back to workflows"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">{activeRun.title}</span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
          <div className="space-y-1">
            <span className="inline-block text-[9px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 font-medium">
              {projectName(activeRun.projectId)}
            </span>
            {activeRun.goalSummary && <p className="text-[11px] text-gray-600 dark:text-gray-300">{activeRun.goalSummary}</p>}
            <p className="text-[10px] text-gray-500 dark:text-gray-400">
              {activeRun.stepCounts.done}/{activeRun.stepCounts.total} steps done
            </p>
          </div>

          {activeRun.status === 'failed' && activeRun.lastError && (
            <p className="text-[10px] text-red-600 dark:text-red-400 rounded bg-red-50 dark:bg-red-950/20 px-2 py-1.5">
              {activeRun.lastError}
            </p>
          )}

          <div className="flex items-center justify-between flex-wrap gap-2">
            <ConfirmationModeToggle
              mode={activeRun.confirmationMode}
              disabled={busyAction !== null}
              onChange={(mode: AutomatedWorkflowConfirmationMode) =>
                void runAction('mode', () => window.api.setAutomatedWorkflowConfirmationMode(activeRun.id, mode))}
            />
            {activeRun.status === 'pending' && (
              <ActionButton icon={Sparkles} variant="primary" disabled={busyAction !== null} onClick={() => void runAction('start', () => window.api.startAutomatedWorkflowRun(activeRun.id))}>
                Start workflow
              </ActionButton>
            )}
            {runInProgress && (
              <ActionButton icon={Ban} variant="danger" disabled={busyAction === 'abort'} onClick={() => void runAction('abort', () => window.api.abortAutomatedWorkflowRun(activeRun.id))}>
                Abort run
              </ActionButton>
            )}
          </div>

          <div className="space-y-2">
            {activeRun.steps.map((step) => (
              <StepCard
                key={step.dbId}
                step={step}
                confirmationMode={activeRun.confirmationMode}
                waitingOn={waitingOnTitles(step)}
                streamingText={stepStreamText[step.dbId]}
                busy={busyAction === step.dbId}
                onApprove={(s, editedOutput) => {
                  const finalOutput = editedOutput !== s.output ? editedOutput : undefined
                  void runAction(s.dbId, () => window.api.confirmAutomatedWorkflowStep(activeRun.id, s.dbId, finalOutput))
                }}
                onRetry={(s) => void runAction(s.dbId, () => window.api.retryAutomatedWorkflowStep(activeRun.id, s.dbId))}
                onSkip={(s) => void runAction(s.dbId, () => window.api.skipAutomatedWorkflowStep(activeRun.id, s.dbId))}
                onOpenConversation={handleOpenConversation}
              />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (view === 'generate') {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 h-9 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <button
            onClick={() => setView('list')}
            className="p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            aria-label="Back to workflows"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-semibold text-gray-800 dark:text-gray-100">New standalone workflow</span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
          <p className="text-[10px] text-gray-500 dark:text-gray-400">
            Describe a goal. This plan has no project — each step runs via whichever agent or model you (or the
            planner) choose; steps with no agent run as a plain model with no skill augmentation.
          </p>
          {messages.length > 0 && (
            <div className="max-h-64 overflow-y-auto space-y-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/70 px-3 py-2">
              {messages.map((msg, i) => <ChatBubble key={i} role={msg.role} content={msg.content} />)}
              {isGenerating && streamingText && <ChatBubble role="assistant" content={streamingText} />}
              {isGenerating && !streamingText && (
                <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Generating…
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          )}
          <div className="rounded-lg border border-blue-200 dark:border-blue-900/60 bg-white/90 dark:bg-gray-900/60 focus-within:ring-1 focus-within:ring-blue-400">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(inputText) } }}
              rows={3}
              placeholder={messages.length > 0 ? 'Reply to refine the workflow…' : 'Describe the goal you want a step-by-step plan for.'}
              className="w-full resize-none bg-transparent px-2.5 pt-2 pb-1.5 text-xs text-gray-800 dark:text-gray-100 focus:outline-none"
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1 border-t border-blue-100 dark:border-blue-900/40">
              <ModelPicker
                value={genModel ?? 'default'}
                availableGroups={availableGroups}
                catalogModels={catalogModels}
                globalDefaultModel={globalDefaultModel ?? undefined}
                includeDefault={true}
                buttonRef={modelPickerRef}
                buttonClassName="flex items-center gap-1 text-[11px] text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 px-1.5 py-1 rounded-md transition-colors max-w-[120px]"
                onSelectDefault={() => setGenModel(null)}
                onSelectAvailableModel={(group: AvailableModelGroup, model: AvailableModelEntry) => {
                  const id = group.sourceType === 'cli' ? `${group.sourceKey}:${model.id}` : model.id
                  setGenModel(id)
                }}
              />
              <button
                type="button"
                onClick={() => void sendMessage(inputText)}
                disabled={isGenerating || !inputText.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 shrink-0"
              >
                {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {messages.length > 0 ? 'Send' : 'Generate workflow'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 h-9 border-b border-gray-100 dark:border-gray-800">
        <span className="text-xs text-gray-400 dark:text-gray-500">{runs.length} workflow{runs.length !== 1 ? 's' : ''}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setMessages([]); setActiveRun(null); setInputText(''); setView('generate') }}
            className="flex items-center gap-1 text-xs text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200 px-2 py-1 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
            aria-label="Generate a new standalone workflow"
          >
            <Sparkles className="w-3.5 h-3.5" />
            New
          </button>
          <button
            onClick={loadRuns}
            className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
            title="Refresh"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
        {(['all', 'global'] as FilterTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-2 py-0.5 rounded text-xs font-medium transition-colors capitalize ${
              filter === tab
                ? 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {tab === 'all' ? 'All' : 'Global only'}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
        {loading && (
          <div className="p-2 space-y-1">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
            ))}
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-6">
            {filter === 'global' ? 'No standalone (project-less) workflows yet' : 'No automated workflows yet'}
          </p>
        )}
        {!loading && filtered.map((run) => (
          <RunListRow
            key={run.id}
            run={run}
            projectName={projectName(run.projectId)}
            onOpen={() => void openRun(run.id)}
            onDiscard={() => void discardRun(run.id)}
          />
        ))}
      </div>
    </div>
  )
}
