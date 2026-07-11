import { useEffect, useRef, useState } from 'react'
import { Sparkles, Loader2, Braces, Ban, ArrowLeft } from 'lucide-react'
import type {
  AvailableModelEntry,
  AvailableModelGroup,
  AutomatedWorkflowConfirmationMode,
  AutomatedWorkflowGeneratorMessage,
  AutomatedWorkflowRunDetail,
  AutomatedWorkflowRunStep,
  AutomatedWorkflowRunSummary,
  AutomatedWorkflowSpec,
} from '../../../shared/types'
import { isApiError } from '../../../shared/types'
import type { ProjectAgent, ProjectConfig } from '../../store/types'
import { useAppStore } from '../../store/app-store'
import { ModelPicker } from '../chat/ModelPicker'
import { VoiceInputButton } from '../chat/VoiceInputButton'
import { clearAutomatedWorkflowGeneration, trackAutomatedWorkflowGeneration } from '../BackgroundActivityBridges'
import { DropdownPanel } from '../DropdownPanel'
import {
  ActionButton,
  ChatBubble,
  ConfirmationModeToggle,
  RunListRow,
  StepCard,
  stripSpecTags,
} from '../automated-workflow/AutomatedWorkflowShared'

interface Props {
  projectId: string
  members: ProjectAgent[]
  projectConfig: ProjectConfig
  onOpenConversation: (conversationId: string) => void
  onToast: (message: string, type: 'success' | 'error' | 'info') => void
}

export function AutomatedWorkflowTab({ projectId, members, projectConfig, onOpenConversation, onToast }: Props) {
  const authState = useAppStore((s) => s.authState)
  const catalogModels = useAppStore((s) => s.catalogModels)
  const globalDefaultModel = useAppStore((s) => s.globalDefaultModel)
  const hasGeneratorBackend = authState.authenticated || authState.cliInstalled
  const [messages, setMessages] = useState<AutomatedWorkflowGeneratorMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [streamingText, setStreamingText] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [missedSpec, setMissedSpec] = useState(false)
  const [genModel, setGenModel] = useState<string | null>(null)
  const [availableGroups, setAvailableGroups] = useState<AvailableModelGroup[]>([])
  const [showVariablePicker, setShowVariablePicker] = useState(false)
  const modelPickerRef = useRef<HTMLButtonElement>(null)
  const variablePickerRef = useRef<HTMLButtonElement>(null)
  const streamingTextRef = useRef('')
  const chatEndRef = useRef<HTMLDivElement>(null)

  const [view, setView] = useState<'list' | 'workspace'>('workspace')
  const [runs, setRuns] = useState<AutomatedWorkflowRunSummary[]>([])
  const [activeRun, setActiveRun] = useState<AutomatedWorkflowRunDetail | null>(null)
  const [stepStreamText, setStepStreamText] = useState<Record<string, string>>({})
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const activeRunRef = useRef<AutomatedWorkflowRunDetail | null>(null)
  const genModelRef = useRef<string | null>(null)
  activeRunRef.current = activeRun
  genModelRef.current = genModel

  useEffect(() => {
    window.api.listAvailableModels().then(setAvailableGroups).catch(() => {})
  }, [])

  useEffect(() => {
    setMessages([])
    setActiveRun(null)
    setMissedSpec(false)
    window.api.listAutomatedWorkflowRuns(projectId)
      .then((list) => {
        setRuns(list)
        setView(list.length > 0 ? 'list' : 'workspace')
      })
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

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  useEffect(() => {
    const offToken = window.api.onAutomatedWorkflowGeneratorToken((chunk) => {
      streamingTextRef.current += chunk
      setStreamingText((current) => current + chunk)
    })
    const offSpec = window.api.onAutomatedWorkflowGeneratorSpecReady(async (incoming: AutomatedWorkflowSpec) => {
      setMissedSpec(false)
      const currentRun = activeRunRef.current
      const reuseId = currentRun && currentRun.steps.every((s) => s.status === 'pending') ? currentRun.id : null
      try {
        const saved = await window.api.saveAutomatedWorkflowRunFromSpec(projectId, incoming, genModelRef.current, reuseId)
        if (saved && !isApiError(saved)) {
          const branched = reuseId !== null && saved.id !== reuseId
          setActiveRun(saved)
          setRuns((prev) => {
            const withoutSaved = prev.filter((r) => r.id !== saved.id)
            return [{ ...saved }, ...withoutSaved].sort((a, b) => b.updatedAt - a.updatedAt)
          })
          if (branched) onToast('Your changes were saved as a new workflow plan', 'info')
        }
      } catch (error) {
        onToast(error instanceof Error ? error.message : 'Failed to save workflow plan', 'error')
      }
    })
    const offDone = window.api.onAutomatedWorkflowGeneratorDone(({ hasSpec }) => {
      clearAutomatedWorkflowGeneration(projectId)
      const capturedText = streamingTextRef.current
      const clean = stripSpecTags(capturedText)
      if (clean) {
        setMessages((prev) => [...prev, { role: 'assistant', content: clean }])
      }
      setIsGenerating(false)
      setStreamingText('')
      streamingTextRef.current = ''
      if (!hasSpec && !clean) setMissedSpec(true)
    })
    return () => { offToken(); offSpec(); offDone() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onToast is stable from the parent; activeRun/genModel are read via refs to avoid re-subscribing on every change
  }, [projectId])

  const sendMessage = async (userText: string) => {
    const trimmed = userText.trim()
    if (!trimmed || isGenerating) return
    const nextMessages: AutomatedWorkflowGeneratorMessage[] = [...messages, { role: 'user', content: trimmed }]
    setMessages(nextMessages)
    setInputText('')
    setIsGenerating(true)
    trackAutomatedWorkflowGeneration(projectId)
    setMissedSpec(false)
    setStreamingText('')
    streamingTextRef.current = ''
    try {
      const result = await window.api.automatedWorkflowGeneratorChat(projectId, nextMessages, genModel ?? undefined)
      if (result && typeof result === 'object' && 'error' in result) {
        throw new Error(String((result as { error: unknown }).error))
      }
    } catch (error) {
      setIsGenerating(false)
      onToast(error instanceof Error ? error.message : 'Failed to generate workflow', 'error')
    } finally {
      clearAutomatedWorkflowGeneration(projectId)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage(inputText)
    }
  }

  const handleInsertVariable = (key: string) => {
    setInputText((current) => `${current}{{${key}}}`)
    setShowVariablePicker(false)
  }

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

  const handleStartRun = () => {
    if (!activeRun) return
    void runAction('start', () => window.api.startAutomatedWorkflowRun(activeRun.id), 'Failed to start workflow')
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

  const startNewWorkflow = () => {
    setMessages([])
    setActiveRun(null)
    setMissedSpec(false)
    setInputText('')
    setView('workspace')
  }

  const resumeRun = async (runId: string) => {
    const detail = await window.api.getAutomatedWorkflowRun(runId)
    if (detail && !isApiError(detail)) {
      setActiveRun(detail)
      setMessages([])
      setView('workspace')
    }
  }

  const discardRun = async (runId: string) => {
    if (!confirm('Discard this workflow plan? This cannot be undone.')) return
    const ok = await window.api.discardAutomatedWorkflowRun(runId)
    if (ok) {
      setRuns((prev) => prev.filter((r) => r.id !== runId))
      if (activeRun?.id === runId) setActiveRun(null)
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

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 text-blue-700 dark:text-blue-300">
          <Sparkles className="w-3.5 h-3.5" />
          <span className="text-xs font-semibold">Automated delegation execution plan</span>
        </div>
        <p className="text-[10px] text-gray-500 dark:text-gray-400">
          This turns a project goal into a step-by-step plan. Each step runs automatically with the assigned agent — choose whether to review and approve every step, or let the whole plan run through on its own. This is the planning tool behind this project's Automated delegation workflow mode.
        </p>
      </div>

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
          <button
            type="button"
            onClick={startNewWorkflow}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-blue-700"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Start a new workflow
          </button>
          <div className="space-y-2">
            {runs.map((run) => (
              <RunListRow key={run.id} run={run} onOpen={() => { void resumeRun(run.id) }} onDiscard={() => { void discardRun(run.id) }} />
            ))}
          </div>
        </div>
      )}

      {view === 'workspace' && (
        <div className="rounded-md border border-blue-200/70 dark:border-blue-900/50 bg-blue-50/70 dark:bg-blue-950/20 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-500 dark:text-gray-400">
              {members.length > 0 ? `${members.length} project agent${members.length === 1 ? '' : 's'} available` : 'No project agents assigned yet'}
            </span>
            {runs.length > 0 && (
              <button
                type="button"
                onClick={() => setView('list')}
                className="inline-flex items-center gap-1 text-[10px] text-blue-700 dark:text-blue-300 hover:underline"
              >
                <ArrowLeft className="w-3 h-3" />
                My workflows
              </button>
            )}
          </div>

          {messages.length > 0 && (
            <div className="max-h-56 overflow-y-auto space-y-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/70 px-3 py-2">
              {messages.map((msg, i) => (
                <ChatBubble key={i} role={msg.role} content={msg.content} />
              ))}
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
              onKeyDown={handleKeyDown}
              rows={3}
              placeholder={messages.length > 0 ? 'Reply to refine the workflow…' : 'Describe the project goal or milestone you want the team to execute.'}
              className="w-full resize-none bg-transparent px-2.5 pt-2 pb-1.5 text-xs text-gray-800 dark:text-gray-100 focus:outline-none"
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1 border-t border-blue-100 dark:border-blue-900/40">
              <div className="flex items-center gap-0.5">
                <DropdownPanel
                  open={showVariablePicker}
                  onClose={() => setShowVariablePicker(false)}
                  align="left"
                  width="w-56"
                  trigger={
                    <button
                      type="button"
                      ref={variablePickerRef}
                      onClick={() => setShowVariablePicker((v) => !v)}
                      disabled={projectConfig.variables.length === 0}
                      title={projectConfig.variables.length === 0 ? 'No project variables defined (Settings → General)' : 'Insert a project variable'}
                      className="p-1.5 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      aria-label="Insert project variable"
                    >
                      <Braces className="w-4 h-4" />
                    </button>
                  }
                >
                  <div className="max-h-48 overflow-y-auto py-1">
                    {projectConfig.variables.length === 0 ? (
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 px-3 py-2 italic">No project variables defined</p>
                    ) : projectConfig.variables.map((v) => (
                      <button
                        key={v.key}
                        type="button"
                        onClick={() => handleInsertVariable(v.key)}
                        className="w-full text-left flex flex-col px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      >
                        <span className="font-mono">{`{{${v.key}}}`}</span>
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{v.value}</span>
                      </button>
                    ))}
                  </div>
                </DropdownPanel>
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
                <VoiceInputButton disabled={isGenerating} onText={(text) => setInputText((current) => current.trim() ? `${current.trimEnd()} ${text}` : text)} />
              </div>
              <button
                type="button"
                onClick={() => { void sendMessage(inputText) }}
                disabled={isGenerating || !inputText.trim() || !hasGeneratorBackend}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 shrink-0"
              >
                {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {messages.length > 0 ? 'Send' : 'Generate workflow'}
              </button>
            </div>
          </div>

          {missedSpec && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400">
              No structured workflow was returned yet. Reply above with more detail about the goal or expected deliverables.
            </p>
          )}
          {activeRun && (
            <div className="space-y-3 rounded-md border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/70 p-3">
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

              <div className="flex items-center justify-between flex-wrap gap-2">
                <ConfirmationModeToggle
                  mode={activeRun.confirmationMode}
                  disabled={busyAction !== null}
                  onChange={handleModeChange}
                />
                {activeRun.status === 'pending' && (
                  <ActionButton icon={Sparkles} variant="primary" disabled={busyAction !== null} onClick={handleStartRun}>
                    Start workflow
                  </ActionButton>
                )}
                {runInProgress && (
                  <ActionButton icon={Ban} variant="danger" disabled={busyAction === 'abort'} onClick={handleAbortRun}>
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
                    onApprove={handleApproveStep}
                    onRetry={handleRetryStep}
                    onSkip={handleSkipStep}
                    onOpenConversation={onOpenConversation}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
