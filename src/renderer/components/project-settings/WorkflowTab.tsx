import { useEffect, useRef, useState } from 'react'
import { Copy, Play, Sparkles, Loader2, Braces, Check, RotateCcw, Trash2, ArrowLeft, Clock, CheckCircle2 } from 'lucide-react'
import type {
  AvailableModelEntry,
  AvailableModelGroup,
  ManualWorkflowGeneratorMessage,
  ManualWorkflowRunDetail,
  ManualWorkflowRunStep,
  ManualWorkflowRunSummary,
  ManualWorkflowSpec,
  ManualWorkflowStepStatus,
} from '../../../shared/types'
import { isApiError } from '../../../shared/types'
import { formatRelativeTime } from '../../../shared/utils'
import type { ProjectAgent, ProjectConfig } from '../../store/types'
import { useAppStore } from '../../store/app-store'
import { ModelPicker } from '../chat/ModelPicker'
import { VoiceInputButton } from '../chat/VoiceInputButton'
import { clearManualWorkflowGeneration, trackManualWorkflowGeneration } from '../BackgroundActivityBridges'
import { DropdownPanel } from '../DropdownPanel'

interface Props {
  projectId: string
  members: ProjectAgent[]
  projectConfig: ProjectConfig
  onStartWorkflowStep: (agentId: string | null, prompt: string) => Promise<void>
  onToast: (message: string, type: 'success' | 'error' | 'info') => void
}

function stripSpecTags(content: string): string {
  return content.replace(/<manual-workflow-spec>[\s\S]*?<\/manual-workflow-spec>/g, '').trim()
}

function ChatBubble({ role, content }: { role: 'user' | 'assistant'; content: string }) {
  const displayContent = stripSpecTags(content)
  if (!displayContent) return null

  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-blue-500 text-white rounded-2xl rounded-tr-sm px-3 py-1.5 text-xs whitespace-pre-wrap">
          {displayContent}
        </div>
      </div>
    )
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-tl-sm px-3 py-1.5 text-xs text-gray-800 dark:text-gray-100 whitespace-pre-wrap">
        {displayContent}
      </div>
    </div>
  )
}

const STEP_STATUS_CONFIG: Record<ManualWorkflowStepStatus, { label: string; cls: string }> = {
  not_started: { label: 'Not started', cls: 'text-gray-400 dark:text-gray-500' },
  started: { label: 'Started', cls: 'text-blue-500' },
  done: { label: 'Done', cls: 'text-green-500' },
}

function StepStatusBadge({ status }: { status: ManualWorkflowStepStatus }) {
  const { label, cls } = STEP_STATUS_CONFIG[status]
  const Icon = status === 'done' ? CheckCircle2 : status === 'started' ? Loader2 : Clock
  return (
    <span className={`flex items-center gap-1 text-[10px] font-medium shrink-0 ${cls}`}>
      <Icon className="w-3 h-3 shrink-0" />
      {label}
    </span>
  )
}

function StepCard({
  step,
  waitingOn,
  onCopy,
  onStart,
  onMarkDone,
  onReopen,
}: {
  step: ManualWorkflowRunStep
  waitingOn?: string[]
  onCopy: (prompt: string) => void
  onStart: (step: ManualWorkflowRunStep) => void
  onMarkDone: (step: ManualWorkflowRunStep) => void
  onReopen: (step: ManualWorkflowRunStep) => void
}) {
  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-gray-800 dark:text-gray-100">
            {step.stepIndex + 1}. {step.title}
          </p>
          <p className="text-[10px] text-gray-500 dark:text-gray-400">
            {step.agentName ?? 'Unassigned'}{step.expectedOutput ? ` · Output: ${step.expectedOutput}` : ''}
          </p>
          {waitingOn && waitingOn.length > 0 && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">Waiting on: {waitingOn.join(', ')}</p>
          )}
        </div>
        <StepStatusBadge status={step.status} />
      </div>
      {step.summary && (
        <p className="text-[11px] text-gray-600 dark:text-gray-300">{step.summary}</p>
      )}
      <pre className="whitespace-pre-wrap rounded bg-gray-50 dark:bg-gray-800 px-2.5 py-2 text-[10px] text-gray-700 dark:text-gray-200">
        {step.prompt}
      </pre>
      <div className="flex items-center gap-1 flex-wrap">
        <button
          type="button"
          onClick={() => onCopy(step.prompt)}
          className="inline-flex items-center gap-1 rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-[10px] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <Copy className="w-3 h-3" />
          Copy
        </button>
        <button
          type="button"
          onClick={() => { void onStart(step) }}
          className="inline-flex items-center gap-1 rounded border border-blue-200 dark:border-blue-900/60 px-2 py-1 text-[10px] text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30"
        >
          <Play className="w-3 h-3" />
          Start in chat
        </button>
        {step.status !== 'done' && (
          <button
            type="button"
            onClick={() => { void onMarkDone(step) }}
            className="inline-flex items-center gap-1 rounded border border-green-200 dark:border-green-900/60 px-2 py-1 text-[10px] text-green-700 dark:text-green-300 hover:bg-green-50 dark:hover:bg-green-950/30"
          >
            <Check className="w-3 h-3" />
            Mark done
          </button>
        )}
        {step.status !== 'not_started' && (
          <button
            type="button"
            onClick={() => { void onReopen(step) }}
            className="inline-flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 px-1 py-1"
          >
            <RotateCcw className="w-3 h-3" />
            Reopen
          </button>
        )}
      </div>
    </div>
  )
}

function RunListRow({ run, onOpen, onDiscard }: { run: ManualWorkflowRunSummary; onOpen: () => void; onDiscard: () => void }) {
  const { total, done, started } = run.stepCounts
  return (
    <div
      onClick={onOpen}
      className="rounded-md border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/70 px-3 py-2.5 space-y-1 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/70 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">{run.title}</p>
        <span
          className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded font-medium ${
            run.status === 'completed'
              ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
              : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
          }`}
        >
          {run.status === 'completed' ? 'Completed' : 'Active'}
        </span>
      </div>
      {run.goalSummary && <p className="text-[10px] text-gray-500 dark:text-gray-400 line-clamp-1">{run.goalSummary}</p>}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-500 dark:text-gray-400">
          {done}/{total} steps done{started > 0 ? ` · ${started} in progress` : ''}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400 dark:text-gray-500">Updated {formatRelativeTime(run.updatedAt)}</span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDiscard() }}
            className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
            aria-label="Discard workflow plan"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  )
}

export function WorkflowTab({ projectId, members, projectConfig, onStartWorkflowStep, onToast }: Props) {
  const authState = useAppStore((s) => s.authState)
  const catalogModels = useAppStore((s) => s.catalogModels)
  const globalDefaultModel = useAppStore((s) => s.globalDefaultModel)
  const hasGeneratorBackend = authState.authenticated || authState.cliInstalled
  const [messages, setMessages] = useState<ManualWorkflowGeneratorMessage[]>([])
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
  const [runs, setRuns] = useState<ManualWorkflowRunSummary[]>([])
  const [activeRun, setActiveRun] = useState<ManualWorkflowRunDetail | null>(null)
  const [collapsedCompleted, setCollapsedCompleted] = useState(true)
  const activeRunRef = useRef<ManualWorkflowRunDetail | null>(null)
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
    window.api.listManualWorkflowRuns(projectId)
      .then((list) => {
        setRuns(list)
        setView(list.length > 0 ? 'list' : 'workspace')
      })
      .catch(() => setRuns([]))
  }, [projectId])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  useEffect(() => {
    const offToken = window.api.onManualWorkflowGeneratorToken((chunk) => {
      streamingTextRef.current += chunk
      setStreamingText((current) => current + chunk)
    })
    const offSpec = window.api.onManualWorkflowGeneratorSpecReady(async (incoming: ManualWorkflowSpec) => {
      setMissedSpec(false)
      const currentRun = activeRunRef.current
      const reuseId = currentRun && currentRun.steps.every((s) => s.status === 'not_started') ? currentRun.id : null
      try {
        const saved = await window.api.saveManualWorkflowRunFromSpec(projectId, incoming, genModelRef.current, reuseId)
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
    const offDone = window.api.onManualWorkflowGeneratorDone(({ hasSpec }) => {
      clearManualWorkflowGeneration(projectId)
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
    const nextMessages: ManualWorkflowGeneratorMessage[] = [...messages, { role: 'user', content: trimmed }]
    setMessages(nextMessages)
    setInputText('')
    setIsGenerating(true)
    trackManualWorkflowGeneration(projectId)
    setMissedSpec(false)
    setStreamingText('')
    streamingTextRef.current = ''
    try {
      const result = await window.api.manualWorkflowGeneratorChat(projectId, nextMessages, genModel ?? undefined)
      if (result && typeof result === 'object' && 'error' in result) {
        throw new Error(String((result as { error: unknown }).error))
      }
    } catch (error) {
      setIsGenerating(false)
      onToast(error instanceof Error ? error.message : 'Failed to generate workflow', 'error')
    } finally {
      clearManualWorkflowGeneration(projectId)
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

  const handleCopyPrompt = async (prompt: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard is not available')
      await navigator.clipboard.writeText(prompt)
      onToast('Step prompt copied', 'success')
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Failed to copy prompt', 'error')
    }
  }

  const applyRunUpdate = (updated: ManualWorkflowRunDetail | null) => {
    if (!updated) return
    setActiveRun(updated)
    setRuns((prev) => prev.map((r) => (r.id === updated.id ? updated : r)).sort((a, b) => b.updatedAt - a.updatedAt))
  }

  const handleStartStep = async (step: ManualWorkflowRunStep) => {
    await onStartWorkflowStep(step.agentId ?? null, step.prompt)
    if (step.status === 'not_started' && activeRun) {
      const updated = await window.api.updateManualWorkflowRunStepStatus(activeRun.id, step.dbId, 'started')
      if (updated && !isApiError(updated)) applyRunUpdate(updated)
    }
  }

  const handleMarkStepStatus = async (step: ManualWorkflowRunStep, status: ManualWorkflowStepStatus) => {
    if (!activeRun) return
    const updated = await window.api.updateManualWorkflowRunStepStatus(activeRun.id, step.dbId, status)
    if (updated && !isApiError(updated)) applyRunUpdate(updated)
  }

  const startNewWorkflow = () => {
    setMessages([])
    setActiveRun(null)
    setMissedSpec(false)
    setInputText('')
    setView('workspace')
  }

  const resumeRun = async (runId: string) => {
    const detail = await window.api.getManualWorkflowRun(runId)
    if (detail && !isApiError(detail)) {
      setActiveRun(detail)
      setMessages([])
      setView('workspace')
    }
  }

  const discardRun = async (runId: string) => {
    if (!confirm('Discard this workflow plan? This cannot be undone.')) return
    const ok = await window.api.discardManualWorkflowRun(runId)
    if (ok) {
      setRuns((prev) => prev.filter((r) => r.id !== runId))
      if (activeRun?.id === runId) setActiveRun(null)
    }
  }

  const byStepKey = new Map(activeRun ? activeRun.steps.map((s) => [s.id, s]) : [])
  const isDependencyDone = (key: string) => byStepKey.get(key)?.status === 'done'
  const readySteps = activeRun ? activeRun.steps.filter((s) => s.status !== 'done' && (s.dependsOnStepIds ?? []).every(isDependencyDone)) : []
  const waitingSteps = activeRun ? activeRun.steps.filter((s) => s.status !== 'done' && !(s.dependsOnStepIds ?? []).every(isDependencyDone)) : []
  const completedSteps = activeRun ? activeRun.steps.filter((s) => s.status === 'done') : []

  const waitingOnTitles = (step: ManualWorkflowRunStep) =>
    (step.dependsOnStepIds ?? [])
      .filter((depKey) => !isDependencyDone(depKey))
      .map((depKey) => byStepKey.get(depKey)?.title ?? depKey)

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 text-blue-700 dark:text-blue-300">
          <Sparkles className="w-3.5 h-3.5" />
          <span className="text-xs font-semibold">Manual delegation execution plan</span>
        </div>
        <p className="text-[10px] text-gray-500 dark:text-gray-400">
          This turns a project goal into a step-by-step plan you run yourself: copy each step's prompt into the right agent's chat, in dependency order, and track progress here as you complete each one. This is the planning tool behind this project's Manual delegation workflow mode.
        </p>
      </div>

      {!hasGeneratorBackend && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400">
          No provider or supported CLI backend is configured. Add an API key or install a CLI backend in Settings before generating a workflow.
        </p>
      )}

      {projectConfig.workflowMode !== 'manual-delegation' && (
        <p className="text-[10px] text-gray-500 dark:text-gray-400">
          This project's workflow mode is set to "{projectConfig.workflowMode === 'orchestrated' ? 'Orchestrated' : 'Single'}". You can still generate a plan here — switch to Manual mode in the Team tab if you want to execute it as manual delegation.
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
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold text-gray-800 dark:text-gray-100">{activeRun.title}</p>
                  {activeRun.status === 'completed' && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">
                      Plan completed
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

              {readySteps.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Ready now</p>
                  {readySteps.map((step) => (
                    <StepCard
                      key={step.dbId}
                      step={step}
                      onCopy={handleCopyPrompt}
                      onStart={handleStartStep}
                      onMarkDone={(s) => handleMarkStepStatus(s, 'done')}
                      onReopen={(s) => handleMarkStepStatus(s, 'not_started')}
                    />
                  ))}
                </div>
              )}

              {waitingSteps.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Waiting on earlier steps</p>
                  {waitingSteps.map((step) => (
                    <StepCard
                      key={step.dbId}
                      step={step}
                      waitingOn={waitingOnTitles(step)}
                      onCopy={handleCopyPrompt}
                      onStart={handleStartStep}
                      onMarkDone={(s) => handleMarkStepStatus(s, 'done')}
                      onReopen={(s) => handleMarkStepStatus(s, 'not_started')}
                    />
                  ))}
                </div>
              )}

              {completedSteps.length > 0 && (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setCollapsedCompleted((v) => !v)}
                    className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    Completed ({completedSteps.length}){collapsedCompleted ? ' — show' : ' — hide'}
                  </button>
                  {!collapsedCompleted && completedSteps.map((step) => (
                    <StepCard
                      key={step.dbId}
                      step={step}
                      onCopy={handleCopyPrompt}
                      onStart={handleStartStep}
                      onMarkDone={(s) => handleMarkStepStatus(s, 'done')}
                      onReopen={(s) => handleMarkStepStatus(s, 'not_started')}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
