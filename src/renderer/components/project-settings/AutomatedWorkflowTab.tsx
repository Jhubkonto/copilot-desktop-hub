import { useEffect, useRef, useState } from 'react'
import { Sparkles, Ban, ArrowLeft, Info, MessageSquare, RotateCcw } from 'lucide-react'
import type {
  AutomatedWorkflowConfirmationMode,
  AutomatedWorkflowRunDetail,
  AutomatedWorkflowRunStep,
  AutomatedWorkflowRunSummary,
} from '../../../shared/types'
import { isApiError } from '../../../shared/types'
import type { ProjectAgent, ProjectConfig } from '../../store/types'
import { useAppStore } from '../../store/app-store'
import {
  ActionButton,
  ConfirmationModeToggle,
  RunListRow,
  StepCard,
  WORKFLOW_STAGES,
} from '../automated-workflow/AutomatedWorkflowShared'
import { DiscardWorkflowRunDialog } from '../automated-workflow/DiscardWorkflowRunDialog'
import { AutomatedWorkflowGeneratorModal } from '../automated-workflow/AutomatedWorkflowGeneratorModal'

interface Props {
  projectId: string
  members: ProjectAgent[]
  projectConfig: ProjectConfig
  onOpenConversation: (conversationId: string) => void
  onToast: (message: string, type: 'success' | 'error' | 'info') => void
}

export function AutomatedWorkflowTab({ projectId, members, projectConfig, onOpenConversation, onToast }: Props) {
  const authState = useAppStore((s) => s.authState)
  const hasGeneratorBackend = authState.authenticated || authState.cliInstalled

  const [view, setView] = useState<'list' | 'detail'>('list')
  const [runs, setRuns] = useState<AutomatedWorkflowRunSummary[]>([])
  const [activeRun, setActiveRun] = useState<AutomatedWorkflowRunDetail | null>(null)
  const [discardTarget, setDiscardTarget] = useState<AutomatedWorkflowRunSummary | null>(null)
  const [stepStreamText, setStepStreamText] = useState<Record<string, string>>({})
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [showGenerator, setShowGenerator] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const activeRunRef = useRef<AutomatedWorkflowRunDetail | null>(null)
  activeRunRef.current = activeRun

  useEffect(() => {
    setActiveRun(null)
    setView('list')
    window.api.listAutomatedWorkflowRuns(projectId)
      .then((list) => setRuns(list))
      .catch(() => setRuns([]))
  }, [projectId])

  // Reflects runs/steps saved or updated from another connected client (e.g. Android), and — now
  // that steps execute automatically — every transition the runner makes on this device too, since
  // the runner never mutates React state directly; it persists to SQLite and broadcasts a change
  // event that this effect turns into a refetch. Safe to refetch unconditionally: run/step data
  // has no local unsaved-draft concept.
  useEffect(() => {
    const off = window.api.onAutomatedWorkflowRunsChanged(({ projectId: changedProjectId, runId }) => {
      if (changedProjectId !== projectId) return
      window.api.listAutomatedWorkflowRuns(projectId).then((list) => {
        if (!isApiError(list)) setRuns(list)
      }).catch(() => {})
      if (activeRunRef.current?.id === runId) {
        window.api.getAutomatedWorkflowRun(runId).then((detail) => {
          if (detail && !isApiError(detail)) setActiveRun(detail)
        }).catch(() => {})
      }
    })
    return off
  }, [projectId])

  useEffect(() => {
    const off = window.api.onAutomatedWorkflowStepStream(({ runId, stepDbId, chunk }) => {
      if (activeRunRef.current?.id !== runId) return
      setStepStreamText((prev) => ({ ...prev, [stepDbId]: (prev[stepDbId] ?? '') + chunk }))
    })
    return off
  }, [])

  // Prune stream text for steps that are no longer running, so a re-run of the same step doesn't
  // briefly flash the previous attempt's leftover streamed text before new chunks arrive.
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

  const runAction = async (key: string, action: () => Promise<AutomatedWorkflowRunDetail | null | { error: string }>, failureMessage: string) => {
    setBusyAction(key)
    try {
      const updated = await action()
      if (updated && !isApiError(updated)) applyRunUpdate(updated)
    } catch (error) {
      onToast(error instanceof Error ? error.message : failureMessage, 'error')
    } finally {
      setBusyAction(null)
    }
  }

  const handleModeChange = (mode: AutomatedWorkflowConfirmationMode) => {
    if (!activeRun) return
    void runAction('mode', () => window.api.setAutomatedWorkflowConfirmationMode(activeRun.id, mode), 'Failed to change confirmation mode')
  }

  const handleApproveStep = (step: AutomatedWorkflowRunStep, editedOutput: string) => {
    if (!activeRun) return
    const finalOutput = editedOutput !== step.output ? editedOutput : undefined
    void runAction(step.dbId, () => window.api.confirmAutomatedWorkflowStep(activeRun.id, step.dbId, finalOutput), 'Failed to confirm step')
  }

  const handleRetryStep = (step: AutomatedWorkflowRunStep) => {
    if (!activeRun) return
    void runAction(step.dbId, () => window.api.retryAutomatedWorkflowStep(activeRun.id, step.dbId), 'Failed to retry step')
  }

  const handleSkipStep = (step: AutomatedWorkflowRunStep) => {
    if (!activeRun) return
    void runAction(step.dbId, () => window.api.skipAutomatedWorkflowStep(activeRun.id, step.dbId), 'Failed to skip step')
  }

  const handleAbortRun = () => {
    if (!activeRun) return
    void runAction('abort', () => window.api.abortAutomatedWorkflowRun(activeRun.id), 'Failed to abort workflow')
  }

  const handleRunAgain = () => {
    if (!activeRun?.templateId) return
    void runAction('run-again', () => window.api.runAutomatedWorkflowFromTemplate(activeRun.templateId!), 'Failed to start a new run from this plan')
  }

  const resumeRun = async (runId: string) => {
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

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-blue-700 dark:text-blue-300">
            <Sparkles className="w-3.5 h-3.5" />
            <span className="text-xs font-semibold">Automated Workflow</span>
          </div>
          <button
            onClick={() => setShowInfo((v) => !v)}
            className={`p-1 rounded ${showInfo ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
            title="How Automated Workflows work"
            aria-label="How Automated Workflows work"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-[10px] text-gray-500 dark:text-gray-400">
          This turns a project goal into a step-by-step plan. Each step runs automatically with an assigned agent or model — choose whether to review and approve every step, or let the whole plan run through on its own.
        </p>
      </div>

      {showInfo && (
        <div className="rounded-md border border-blue-200 dark:border-blue-900/50 bg-blue-50/70 dark:bg-blue-950/20 px-3 py-2 space-y-2">
          <p className="text-[10px] text-gray-700 dark:text-gray-200 font-medium flex items-center gap-1">
            <MessageSquare className="w-3 h-3" /> How Automated Workflows work
          </p>
          <div className="space-y-1">
            {WORKFLOW_STAGES.map(({ icon: Icon, label }, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Icon className="w-3 h-3 shrink-0 text-blue-500" />
                <span className="text-[10px] text-gray-600 dark:text-gray-300">{label}</span>
              </div>
            ))}
          </div>
          <div className="pt-1 border-t border-blue-200/60 dark:border-blue-900/40 space-y-1">
            <p className="text-[10px] text-gray-700 dark:text-gray-200 font-medium">Good to know</p>
            <ul className="text-[10px] text-gray-600 dark:text-gray-300 list-disc pl-3.5 space-y-0.5">
              <li>Each step runs in its own dedicated conversation, not this project's main chat — open it via "Open conversation" once the step starts.</li>
              <li>Gated mode pauses for your approval after every step; automatic mode advances immediately and only pauses if a step fails.</li>
              <li>The planner assigns each step to one of this project's agents (that agent's own skills apply) or a plain model — this isn't editable after the plan is generated.</li>
            </ul>
          </div>
        </div>
      )}

      {!hasGeneratorBackend && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400">
          No provider or supported CLI backend is configured. Add an API key or install a CLI backend in Settings before generating a workflow.
        </p>
      )}

      {projectConfig.workflowMode !== 'automated-delegation' && (
        <p className="text-[10px] text-gray-500 dark:text-gray-400">
          This project's workflow mode is set to "{projectConfig.workflowMode === 'orchestrated' ? 'Orchestrated' : 'Single'}". Automated Workflow runs independently of this setting — no mode switch is needed to generate or execute a plan here.
        </p>
      )}

      {view === 'list' && (
        <div className="rounded-md border border-blue-200/70 dark:border-blue-900/50 bg-blue-50/70 dark:bg-blue-950/20 p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-gray-500 dark:text-gray-400">
              {members.length > 0 ? `${members.length} project agent${members.length === 1 ? '' : 's'} available` : 'No project agents assigned yet'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowGenerator(true)}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-blue-700"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Start a new workflow
          </button>
          {runs.length === 0 ? (
            <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center py-2">No workflows yet for this project</p>
          ) : (
            <div className="space-y-2">
              {runs.map((run) => (
                <RunListRow key={run.id} run={run} onOpen={() => { void resumeRun(run.id) }} onDiscard={() => setDiscardTarget(run)} />
              ))}
            </div>
          )}
        </div>
      )}

      {view === 'detail' && activeRun && (
        <div className="space-y-3 rounded-md border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/70 p-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => { setActiveRun(null); setView('list') }}
              className="inline-flex items-center gap-1 text-[10px] text-blue-700 dark:text-blue-300 hover:underline"
            >
              <ArrowLeft className="w-3 h-3" />
              My workflows
            </button>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-xs font-semibold text-gray-800 dark:text-gray-100">{activeRun.title}</p>
              {activeRun.status === 'done' && (
                <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">
                  Plan completed
                </span>
              )}
              {activeRun.status === 'cancelled' && (
                <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                  Aborted
                </span>
              )}
            </div>
            {activeRun.goalSummary && (
              <p className="text-[11px] text-gray-600 dark:text-gray-300">{activeRun.goalSummary}</p>
            )}
            {activeRun.assumptions.length > 0 && (
              <p className="text-[10px] text-gray-500 dark:text-gray-400">
                Assumptions: {activeRun.assumptions.join(' • ')}
              </p>
            )}
            <p className="text-[10px] text-gray-500 dark:text-gray-400">
              {activeRun.stepCounts.done}/{activeRun.stepCounts.total} steps done
            </p>
          </div>

          {activeRun.status === 'failed' && activeRun.lastError && (
            <p className="text-[10px] text-red-600 dark:text-red-400 rounded bg-red-50 dark:bg-red-950/20 px-2 py-1.5">
              {activeRun.lastError}
            </p>
          )}

          {activeRun.status === 'pending' ? (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <ConfirmationModeToggle
                mode={activeRun.confirmationMode}
                disabled={busyAction !== null}
                onChange={handleModeChange}
              />
              <ActionButton icon={Sparkles} variant="primary" disabled={busyAction !== null} onClick={() => void runAction('start', () => window.api.startAutomatedWorkflowRun(activeRun.id), 'Failed to start workflow')}>
                Start workflow
              </ActionButton>
            </div>
          ) : (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-[10px] text-gray-500 dark:text-gray-400">
                {activeRun.confirmationMode === 'auto' ? 'Ran automatically' : 'Ran with step-by-step confirmation'}
              </span>
              {runInProgress && (
                <ActionButton icon={Ban} variant="danger" disabled={busyAction === 'abort'} onClick={handleAbortRun}>
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
            activeRun.templateId ? (
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-[10px] text-gray-400 dark:text-gray-500">This run has finished.</span>
                <ActionButton icon={RotateCcw} disabled={busyAction !== null} onClick={handleRunAgain}>
                  Run again
                </ActionButton>
              </div>
            ) : (
              <p className="text-[10px] text-gray-400 dark:text-gray-500">
                This run has finished. To do this again, generate a new workflow from the list.
              </p>
            )
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
                onApprove={handleApproveStep}
                onRetry={handleRetryStep}
                onSkip={handleSkipStep}
                onOpenConversation={onOpenConversation}
              />
            ))}
          </div>
        </div>
      )}
      {discardTarget && (
        <DiscardWorkflowRunDialog
          runTitle={discardTarget.title}
          onConfirm={() => void confirmDiscardRun()}
          onCancel={() => setDiscardTarget(null)}
        />
      )}
      {showGenerator && (
        <AutomatedWorkflowGeneratorModal
          projectId={projectId}
          projectVariables={projectConfig.variables}
          onClose={() => setShowGenerator(false)}
          onCreated={(saved) => {
            setActiveRun(saved)
            setView('detail')
            setRuns((prev) => {
              const withoutSaved = prev.filter((r) => r.id !== saved.id)
              return [{ ...saved }, ...withoutSaved].sort((a, b) => b.updatedAt - a.updatedAt)
            })
          }}
        />
      )}
    </div>
  )
}
