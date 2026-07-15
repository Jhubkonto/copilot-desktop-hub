import { useEffect, useState } from 'react'
import { Loader2, Check, RotateCcw, SkipForward, MessageSquare, Ban, Trash2, Clock, CheckCircle2, AlertCircle, XCircle, Sparkles, Play } from 'lucide-react'
import type {
  AutomatedWorkflowConfirmationMode,
  AutomatedWorkflowRunStatus,
  AutomatedWorkflowRunStep,
  AutomatedWorkflowRunSummary,
} from '../../../shared/types'
import { formatRelativeTime } from '../../../shared/utils'

// Shared between the project-scoped AutomatedWorkflowTab.tsx and the global, top-level
// AutomatedWorkflowsPane.tsx — both render the same run/step shapes and need identical
// interactive behavior (agent/model badge, confirm/retry/skip/abort), so this is the single
// source of truth for that rendering rather than two copies drifting apart.

export function stripSpecTags(content: string): string {
  return content.replace(/<automated-workflow-spec>[\s\S]*?<\/automated-workflow-spec>/g, '').trim()
}

// The 4-stage flow, used identically in the generator modal's empty state and the pane/tab info
// panels — a single source of truth for the icons/wording so the two surfaces never drift apart.
// "Run it whenever you're ready" is deliberate: a saved plan sits as "Pending" indefinitely until
// the user presses Start — reviewing it does not commit you to running it immediately.
export const WORKFLOW_STAGES: { icon: typeof Check; label: string }[] = [
  { icon: MessageSquare, label: 'Describe your goal' },
  { icon: Sparkles, label: 'Review the generated plan' },
  { icon: Play, label: 'Run it whenever you\'re ready — step-by-step or automatic' },
  { icon: RotateCcw, label: 'Reuse it later with "Run again" — no need to re-describe the goal' },
]

export function ChatBubble({ role, content }: { role: 'user' | 'assistant'; content: string }) {
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

export function StepStatusBadge({ status }: { status: AutomatedWorkflowRunStep['status'] }) {
  const config = {
    pending: { label: 'Not started', cls: 'text-gray-400 dark:text-gray-500', icon: Clock },
    running: { label: 'Running…', cls: 'text-blue-500', icon: Loader2 },
    awaiting_confirmation: { label: 'Needs review', cls: 'text-amber-500', icon: AlertCircle },
    done: { label: 'Done', cls: 'text-green-500', icon: CheckCircle2 },
    failed: { label: 'Failed', cls: 'text-red-500', icon: AlertCircle },
    skipped: { label: 'Skipped', cls: 'text-gray-400 dark:text-gray-500', icon: Ban },
    cancelled: { label: 'Cancelled', cls: 'text-gray-400 dark:text-gray-500', icon: Ban },
  }[status]
  const Icon = config.icon
  return (
    <span className={`flex items-center gap-1 text-[10px] font-medium shrink-0 ${config.cls}`}>
      <Icon className={`w-3 h-3 shrink-0 ${status === 'running' ? 'animate-spin' : ''}`} />
      {config.label}
    </span>
  )
}

// Icon+label, no pill background — converges RunListRow's status indicator with ScheduledPane's
// own StatusBadge visual language instead of the colored-pill style this used to have.
export function RunStatusBadge({ status }: { status: AutomatedWorkflowRunStatus }) {
  const config = {
    pending: { label: 'Pending', cls: 'text-gray-400 dark:text-gray-500', icon: Clock },
    running: { label: 'Active', cls: 'text-blue-500', icon: Loader2 },
    awaiting_confirmation: { label: 'Active', cls: 'text-blue-500', icon: Loader2 },
    done: { label: 'Completed', cls: 'text-green-500', icon: CheckCircle2 },
    failed: { label: 'Failed', cls: 'text-red-500', icon: XCircle },
    cancelled: { label: 'Cancelled', cls: 'text-gray-400 dark:text-gray-500', icon: Ban },
  }[status]
  const Icon = config.icon
  return (
    <span className={`flex items-center gap-1 text-[9px] font-medium shrink-0 ${config.cls}`}>
      <Icon className={`w-3 h-3 shrink-0 ${status === 'running' ? 'animate-spin' : ''}`} />
      {config.label}
    </span>
  )
}

export function ActionButton({
  onClick,
  disabled,
  variant = 'default',
  icon: Icon,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  variant?: 'default' | 'primary' | 'danger'
  icon: typeof Check
  children: React.ReactNode
}) {
  const variantCls = {
    default: 'border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800',
    primary: 'bg-blue-600 text-white hover:bg-blue-700',
    danger: 'border border-red-200 dark:border-red-900/60 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/30',
  }[variant]
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variantCls}`}
    >
      <Icon className="w-3 h-3" />
      {children}
    </button>
  )
}

export function StepCard({
  step,
  confirmationMode,
  waitingOn,
  streamingText,
  busy,
  onApprove,
  onRetry,
  onSkip,
  onOpenConversation,
}: {
  step: AutomatedWorkflowRunStep
  confirmationMode: AutomatedWorkflowConfirmationMode
  waitingOn?: string[]
  streamingText?: string
  busy: boolean
  onApprove: (step: AutomatedWorkflowRunStep, editedOutput: string) => void
  onRetry: (step: AutomatedWorkflowRunStep) => void
  onSkip: (step: AutomatedWorkflowRunStep) => void
  onOpenConversation: (conversationId: string) => void
}) {
  const [draftOutput, setDraftOutput] = useState(step.output)
  useEffect(() => {
    setDraftOutput(step.output)
  }, [step.dbId, step.output])

  // Exactly one of agentName/model applies — a step is fulfilled by EITHER an agent (its own
  // attached skills apply) OR a bare model (no skills at all). Never show both, never neither.
  const fulfilledByLabel = step.agentName
    ? step.agentName
    : step.model
      ? `Model: ${step.model}`
      : 'Unassigned'

  const header = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-gray-800 dark:text-gray-100">
          {step.stepIndex + 1}. {step.title}
        </p>
        <p className="text-[10px] text-gray-500 dark:text-gray-400">
          {fulfilledByLabel}{step.expectedOutput ? ` · Output: ${step.expectedOutput}` : ''}
        </p>
        {waitingOn && waitingOn.length > 0 && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">Waiting on: {waitingOn.join(', ')}</p>
        )}
      </div>
      <StepStatusBadge status={step.status} />
    </div>
  )

  const openConversationButton = step.conversationId ? (
    <ActionButton icon={MessageSquare} onClick={() => onOpenConversation(step.conversationId!)}>
      Open conversation
    </ActionButton>
  ) : null

  if (step.status === 'running') {
    return (
      <div className="rounded-md border border-blue-200 dark:border-blue-900/50 bg-blue-50/40 dark:bg-blue-950/10 px-3 py-2 space-y-2">
        {header}
        <pre className="whitespace-pre-wrap rounded bg-gray-50 dark:bg-gray-800 px-2.5 py-2 text-[10px] text-gray-700 dark:text-gray-200 max-h-40 overflow-y-auto">
          {streamingText || 'Starting…'}
          <span className="inline-block w-1.5 h-3 bg-blue-400 align-middle animate-pulse ml-0.5" />
        </pre>
      </div>
    )
  }

  if (step.status === 'awaiting_confirmation') {
    // In 'auto' mode the executor self-confirms this step immediately after writing this status
    // (see advanceAutomatedWorkflowRun) — it's a transient snapshot of what just happened, not a
    // real checkpoint. Showing an editable Approve UI here would let a click race the executor's
    // own auto-advance and misfire against whatever step is running by the time it lands.
    if (confirmationMode === 'auto') {
      return (
        <div className="rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/10 px-3 py-2 space-y-2">
          {header}
          <p className="text-[10px] text-amber-600 dark:text-amber-400">Advancing automatically…</p>
        </div>
      )
    }
    return (
      <div className="rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/10 px-3 py-2 space-y-2">
        {header}
        <textarea
          value={draftOutput}
          onChange={(e) => setDraftOutput(e.target.value)}
          rows={4}
          aria-label={`Output for step ${step.stepIndex + 1}`}
          className="w-full resize-y rounded bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-2.5 py-2 text-[10px] text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-amber-400"
        />
        <div className="flex items-center gap-1 flex-wrap">
          <ActionButton icon={Check} variant="primary" disabled={busy} onClick={() => onApprove(step, draftOutput)}>
            Approve &amp; continue
          </ActionButton>
          {openConversationButton}
        </div>
      </div>
    )
  }

  if (step.status === 'failed') {
    return (
      <div className="rounded-md border border-red-200 dark:border-red-900/50 bg-red-50/40 dark:bg-red-950/10 px-3 py-2 space-y-2">
        {header}
        {step.error && <p className="text-[10px] text-red-600 dark:text-red-400">{step.error}</p>}
        <div className="flex items-center gap-1 flex-wrap">
          <ActionButton icon={RotateCcw} disabled={busy} onClick={() => onRetry(step)}>Retry</ActionButton>
          <ActionButton icon={SkipForward} disabled={busy} onClick={() => onSkip(step)}>Skip</ActionButton>
          {openConversationButton}
        </div>
      </div>
    )
  }

  if (step.status === 'done') {
    return (
      <details className="rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2">
        <summary className="cursor-pointer text-[11px] font-medium text-gray-700 dark:text-gray-200 flex items-center justify-between gap-3">
          <span className="min-w-0 truncate">{step.stepIndex + 1}. {step.title}</span>
          <StepStatusBadge status={step.status} />
        </summary>
        <div className="mt-2 space-y-2">
          {step.output && (
            <pre className="whitespace-pre-wrap rounded bg-gray-50 dark:bg-gray-800 px-2.5 py-2 text-[10px] text-gray-700 dark:text-gray-200">
              {step.output}
            </pre>
          )}
          {openConversationButton && <div className="flex">{openConversationButton}</div>}
        </div>
      </details>
    )
  }

  if (step.status === 'skipped') {
    return (
      <div className="rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2 space-y-1 opacity-70">
        {header}
        <p className="text-[10px] text-gray-500 dark:text-gray-400 italic">You skipped this step.</p>
      </div>
    )
  }

  if (step.status === 'cancelled') {
    return (
      <div className="rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2 space-y-1 opacity-70">
        {header}
        <p className="text-[10px] text-gray-500 dark:text-gray-400 italic">This step was cancelled.</p>
      </div>
    )
  }

  // pending
  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2 space-y-1 opacity-80">
      {header}
      {step.summary && <p className="text-[11px] text-gray-600 dark:text-gray-300">{step.summary}</p>}
    </div>
  )
}

export function ConfirmationModeToggle({
  mode,
  disabled,
  onChange,
}: {
  mode: AutomatedWorkflowConfirmationMode
  disabled: boolean
  onChange: (mode: AutomatedWorkflowConfirmationMode) => void
}) {
  return (
    <div className="inline-flex rounded-md overflow-hidden border border-gray-200 dark:border-gray-700 text-[10px]">
      {(['gated', 'auto'] as const).map((value) => (
        <button
          key={value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(value)}
          aria-pressed={mode === value}
          className={`px-2 py-1 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            mode === value
              ? 'bg-blue-600 text-white'
              : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
        >
          {value === 'gated' ? 'Confirm each step' : 'Run automatically'}
        </button>
      ))}
    </div>
  )
}

export function RunListRow({
  run,
  projectName,
  onOpen,
  onDiscard,
}: {
  run: AutomatedWorkflowRunSummary
  /** Shown as a badge when provided — the global pane passes "Project: X" / "Global"; the
   *  project-scoped tab's list (which is always exactly one project) omits it. */
  projectName?: string
  onOpen: () => void
  onDiscard: () => void
}) {
  const { total, done, running, awaitingConfirmation } = run.stepCounts
  const inProgress = running + awaitingConfirmation
  return (
    <div
      onClick={onOpen}
      className="rounded-md border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/70 px-3 py-2.5 space-y-1 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/70 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">{run.title}</p>
        <RunStatusBadge status={run.status} />
      </div>
      {run.goalSummary && <p className="text-[10px] text-gray-500 dark:text-gray-400 line-clamp-1">{run.goalSummary}</p>}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-500 dark:text-gray-400">
          {done}/{total} steps done{inProgress > 0 ? ` · ${inProgress} in progress` : ''}
        </span>
        <div className="flex items-center gap-2">
          {projectName && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 font-medium">
              {projectName}
            </span>
          )}
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
