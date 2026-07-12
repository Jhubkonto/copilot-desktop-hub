import { useCallback, useEffect, useRef, useState } from 'react'
import { Sparkles, ArrowLeft, Ban, RefreshCw, Info, MessageSquare } from 'lucide-react'
import type {
  AutomatedWorkflowConfirmationMode,
  AutomatedWorkflowRunDetail,
  AutomatedWorkflowRunStep,
  AutomatedWorkflowRunSummary,
} from '../../../shared/types'
import { isApiError } from '../../../shared/types'
import { useAppStore } from '../../store/app-store'
import {
  ActionButton,
  ConfirmationModeToggle,
  RunListRow,
  StepCard,
} from '../automated-workflow/AutomatedWorkflowShared'
import { DiscardWorkflowRunDialog } from '../automated-workflow/DiscardWorkflowRunDialog'
import { AutomatedWorkflowGeneratorModal } from '../automated-workflow/AutomatedWorkflowGeneratorModal'

type FilterTab = 'all' | 'global'

// Global, top-level browse/manage surface for Automated Workflow runs — additive to (not a
// replacement for) the project-scoped generator in AutomatedWorkflowTab.tsx, which still owns
// project-specific plan generation (it needs scope/milestones/agent context this pane doesn't
// have). This pane reads the same underlying data via listAllAutomatedWorkflowRuns() and is also
// where a project-less (self-contained) workflow gets created and run, since project-scoped
// generation has nowhere else that makes sense for it.
export function AutomatedWorkflowsPane() {
  const projects = useAppStore((s) => s.projects)
  const selectProject = useAppStore((s) => s.selectProject)
  const selectConversation = useAppStore((s) => s.selectConversation)
  const setSectionPane = useAppStore((s) => s.setSectionPane)

  const [view, setView] = useState<'list' | 'detail'>('list')
  const [runs, setRuns] = useState<AutomatedWorkflowRunSummary[]>([])
  const [filter, setFilter] = useState<FilterTab>('all')
  const [loading, setLoading] = useState(true)
  const [activeRun, setActiveRun] = useState<AutomatedWorkflowRunDetail | null>(null)
  const [stepStreamText, setStepStreamText] = useState<Record<string, string>>({})
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [discardTarget, setDiscardTarget] = useState<AutomatedWorkflowRunSummary | AutomatedWorkflowRunDetail | null>(null)
  const [showGenerator, setShowGenerator] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const activeRunRef = useRef<AutomatedWorkflowRunDetail | null>(null)
  activeRunRef.current = activeRun

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

  const confirmDiscardRun = async () => {
    if (!discardTarget) return
    const runId = discardTarget.id
    setDiscardTarget(null)
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
  const runIsTerminal = activeRun?.status === 'done' || activeRun?.status === 'failed' || activeRun?.status === 'cancelled'

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

          {/* Each step below runs in its own dedicated conversation (see "Open conversation" on a
              step once it starts) — this run itself is a single, one-time execution of the plan,
              not a reusable template. To run this plan again, generate a new one. */}
          {activeRun.status === 'pending' ? (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <ConfirmationModeToggle
                mode={activeRun.confirmationMode}
                disabled={busyAction !== null}
                onChange={(mode: AutomatedWorkflowConfirmationMode) =>
                  void runAction('mode', () => window.api.setAutomatedWorkflowConfirmationMode(activeRun.id, mode))}
              />
              <ActionButton icon={Sparkles} variant="primary" disabled={busyAction !== null} onClick={() => void runAction('start', () => window.api.startAutomatedWorkflowRun(activeRun.id))}>
                Start workflow
              </ActionButton>
            </div>
          ) : (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-[10px] text-gray-500 dark:text-gray-400">
                {activeRun.confirmationMode === 'auto' ? 'Ran automatically' : 'Ran with step-by-step confirmation'}
              </span>
              {runInProgress && (
                <ActionButton icon={Ban} variant="danger" disabled={busyAction === 'abort'} onClick={() => void runAction('abort', () => window.api.abortAutomatedWorkflowRun(activeRun.id))}>
                  Abort run
                </ActionButton>
              )}
            </div>
          )}
          {activeRun.status === 'pending' && (
            <p className="text-[10px] text-gray-400 dark:text-gray-500">
              Choose how each step should run, then press Start. Each step's output appears below and also lives in its own conversation.
            </p>
          )}
          {runIsTerminal && (
            <p className="text-[10px] text-gray-400 dark:text-gray-500">
              This run has finished. To do this again, generate a new workflow from the list.
            </p>
          )}

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

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 h-9 border-b border-gray-100 dark:border-gray-800">
        <span className="text-xs text-gray-400 dark:text-gray-500">{runs.length} workflow{runs.length !== 1 ? 's' : ''}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowInfo((v) => !v)}
            className={`p-1 rounded ${showInfo ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
            title="How Automated Workflows work"
            aria-label="How Automated Workflows work"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setShowGenerator(true)}
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

      {showInfo && (
        <div className="mx-3 mt-2 rounded-md border border-blue-200 dark:border-blue-900/50 bg-blue-50/70 dark:bg-blue-950/20 px-3 py-2 space-y-1.5">
          <p className="text-[10px] text-gray-700 dark:text-gray-200 font-medium flex items-center gap-1">
            <MessageSquare className="w-3 h-3" /> How Automated Workflows work
          </p>
          <p className="text-[10px] text-gray-600 dark:text-gray-300">
            Generating a plan creates one workflow run — a single execution, not a reusable template.
            Each step runs via an agent (its own skills apply) or a bare model (no skills), in its own
            dedicated conversation. Tap "Open conversation" on any step to see its full transcript.
            To do the same thing again, generate a new plan.
          </p>
        </div>
      )}

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
            onDiscard={() => setDiscardTarget(run)}
          />
        ))}
      </div>
      {discardTarget && (
        <DiscardWorkflowRunDialog
          runTitle={discardTarget.title}
          onConfirm={() => void confirmDiscardRun()}
          onCancel={() => setDiscardTarget(null)}
        />
      )}
      {showGenerator && (
        <AutomatedWorkflowGeneratorModal
          projectId={null}
          onClose={() => setShowGenerator(false)}
          onCreated={(saved) => {
            setActiveRun(saved)
            setView('detail')
            void loadRuns()
          }}
        />
      )}
    </div>
  )
}
