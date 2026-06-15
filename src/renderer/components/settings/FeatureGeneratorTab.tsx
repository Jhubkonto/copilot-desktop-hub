import { useState, useEffect, useRef, useCallback } from 'react'
import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Crown,
  Sparkles,
  AlertTriangle,
  FileText,
  Play,
  RotateCcw,
} from 'lucide-react'
import type { FeatureSpec, FeatureGeneratorRun, FeatureSpecialist, SelfHealStagedFileDiff, SelfHealVerificationEvent, SelfHealVerificationDone } from '@shared/types'
import { BuildLog } from '../BuildLog'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Phase =
  | 'idle'
  | 'chatting'
  | 'spec-ready'
  | 'approving-spec'
  | 'planning'
  | 'plan-ready'
  | 'staging'
  | 'diff-ready'
  | 'applied'
  | 'verifying'
  | 'verified'
  | 'committing'
  | 'committed'
  | 'done'
  | 'failed'
  | 'cancelled'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// ---------------------------------------------------------------------------
// Inline components
// ---------------------------------------------------------------------------

function PhaseBar({ phase }: { phase: Phase }) {
  const steps: { id: Phase; label: string }[] = [
    { id: 'chatting', label: 'Discovery' },
    { id: 'spec-ready', label: 'Spec' },
    { id: 'plan-ready', label: 'Plan' },
    { id: 'diff-ready', label: 'Diffs' },
    { id: 'verifying', label: 'Verify' },
    { id: 'committed', label: 'Commit' },
    { id: 'done', label: 'Done' },
  ]

  const ORDER: Phase[] = ['idle', 'chatting', 'spec-ready', 'approving-spec', 'planning', 'plan-ready', 'staging', 'diff-ready', 'applied', 'verifying', 'verified', 'committing', 'committed', 'done']
  const currentIndex = ORDER.indexOf(phase)

  return (
    <div className="flex items-center gap-1 mb-4">
      {steps.map((step, i) => {
        const stepIndex = ORDER.indexOf(step.id)
        const done = currentIndex > stepIndex
        const active = currentIndex >= stepIndex && currentIndex <= stepIndex + 2
        return (
          <div key={step.id} className="flex items-center gap-1">
            {i > 0 && <div className={`h-px w-4 ${done ? 'bg-green-400' : 'bg-gray-200 dark:bg-gray-700'}`} />}
            <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
              done ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : active ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
              : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600'
            }`}>
              {done && <CheckCircle className="w-2.5 h-2.5" />}
              {step.label}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SpecPreview({ spec }: { spec: FeatureSpec }) {
  return (
    <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/10 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <FileText className="w-3.5 h-3.5 text-blue-500" />
        <p className="text-xs font-semibold text-blue-800 dark:text-blue-300">{spec.title}</p>
        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 font-medium">{spec.type}</span>
      </div>
      <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-snug">{spec.userStory}</p>
      {spec.acceptanceCriteria.length > 0 && (
        <div className="space-y-0.5">
          <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Acceptance criteria</p>
          {spec.acceptanceCriteria.map((ac, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] text-gray-600 dark:text-gray-400">
              <span className="text-blue-400 mt-0.5">•</span>
              <span>{ac}</span>
            </div>
          ))}
        </div>
      )}
      {spec.likelyAffectedFiles.length > 0 && (
        <div className="space-y-0.5">
          <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Likely affected files</p>
          <div className="flex flex-wrap gap-1">
            {spec.likelyAffectedFiles.map((f, i) => (
              <span key={i} className="text-[9px] font-mono px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">{f}</span>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center gap-3 pt-1">
        <span className="text-[10px] text-gray-400">Autonomy: <span className="text-gray-600 dark:text-gray-300 font-medium">{spec.autonomy}</span></span>
        {spec.targetAreas.map((a) => (
          <span key={a} className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">{a}</span>
        ))}
      </div>
    </div>
  )
}

function SpecialistCard({ specialist, index, tokens }: { specialist: FeatureSpecialist; index: number; tokens: string[] }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded border border-gray-200 dark:border-gray-700 overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50"
      >
        {index === 0 && <Crown className="w-3 h-3 text-amber-500 shrink-0" />}
        <span className="text-[11px] font-medium text-gray-800 dark:text-gray-200">{specialist.role}</span>
        {specialist.isTemporary && (
          <span className="text-[9px] px-1 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400 ml-1">temp</span>
        )}
        <span className="ml-auto text-[10px] text-gray-400 truncate max-w-[120px]">{specialist.description}</span>
        {expanded ? <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" /> : <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />}
      </button>
      {expanded && (
        <div className="border-t border-gray-100 dark:border-gray-700 p-3 space-y-2">
          <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">System prompt</p>
          <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-snug">{specialist.systemPrompt}</p>
          {tokens.length > 0 && (
            <>
              <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Activity</p>
              <BuildLog lines={tokens} resizable={false} maxHeightPx={160} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function DiffFileRow({
  relativePath,
  diff,
  reviewed,
  isExpanded,
  onLoadDiff,
  onRevert,
  onMarkReviewed,
}: {
  relativePath: string
  diff: SelfHealStagedFileDiff | null
  reviewed: boolean
  isExpanded: boolean
  onLoadDiff: () => void
  onRevert: () => void
  onMarkReviewed: () => void
}) {
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50"
        onClick={isExpanded ? onMarkReviewed : onLoadDiff}
      >
        {reviewed ? (
          <CheckCircle className="w-3 h-3 text-green-500 shrink-0" />
        ) : (
          <div className="w-3 h-3 rounded-full border border-gray-400 shrink-0" />
        )}
        <span className="text-[11px] font-mono text-gray-700 dark:text-gray-300 flex-1 truncate">{relativePath}</span>
        {!reviewed && (
          <button
            onClick={(e) => { e.stopPropagation(); onRevert() }}
            className="text-[10px] text-red-500 hover:text-red-700 px-1.5 py-0.5 rounded border border-red-200 dark:border-red-800"
          >
            Revert
          </button>
        )}
        {isExpanded ? <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" /> : <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />}
      </div>
      {isExpanded && diff && (
        <div className="border-t border-gray-100 dark:border-gray-700 overflow-y-auto max-h-64 font-mono text-[10px]">
          {diff.hunks.map((hunk, hi) => (
            <div key={hi}>
              <div className="px-3 py-1 bg-gray-100 dark:bg-gray-800 text-gray-500">{hunk.header}</div>
              {hunk.lines.map((line, li) => (
                <div
                  key={li}
                  className={`px-3 py-0.5 whitespace-pre-wrap ${
                    line.type === 'added' ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                    : line.type === 'removed' ? 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300'
                    : 'text-gray-600 dark:text-gray-400'
                  }`}
                >
                  {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}{line.content}
                </div>
              ))}
            </div>
          ))}
          {!reviewed && (
            <div className="p-2 border-t border-gray-100 dark:border-gray-700">
              <button onClick={onMarkReviewed} className="text-[10px] px-2.5 py-1 rounded bg-green-600 text-white hover:bg-green-700">
                Mark as reviewed
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RunHistoryList({ runs, onResume }: { runs: FeatureGeneratorRun[]; onResume: (run: FeatureGeneratorRun) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (runs.length === 0) return null

  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-2">Run history</p>
      {runs.map((run) => (
        <div key={run.id} className="rounded border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div
            className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50"
            onClick={() => setExpanded(expanded === run.id ? null : run.id)}
          >
            <span className="text-[11px] font-medium text-gray-700 dark:text-gray-300 flex-1 truncate">{run.title}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
              run.status === 'done' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : run.status === 'failed' || run.status === 'cancelled' ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
              : 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
            }`}>{run.status}</span>
            {(run.status !== 'done' && run.status !== 'failed' && run.status !== 'cancelled') && (
              <button
                onClick={(e) => { e.stopPropagation(); onResume(run) }}
                className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Resume
              </button>
            )}
            {expanded === run.id ? <ChevronDown className="w-3 h-3 text-gray-400" /> : <ChevronRight className="w-3 h-3 text-gray-400" />}
          </div>
          {expanded === run.id && (
            <div className="border-t border-gray-100 dark:border-gray-700 p-3 space-y-2">
              {run.specJson && (
                <>
                  <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Spec</p>
                  <SpecPreview spec={JSON.parse(run.specJson) as FeatureSpec} />
                </>
              )}
              {run.planMarkdown && (
                <>
                  <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Implementation plan</p>
                  <BuildLog lines={run.planMarkdown.split('\n')} resizable={false} maxHeightPx={200} />
                </>
              )}
              {run.commitSha && (
                <p className="text-[11px] text-gray-600 dark:text-gray-400">Commit: <span className="font-mono">{run.commitSha}</span></p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main FeatureGeneratorTab
// ---------------------------------------------------------------------------

export function FeatureGeneratorTab() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [runId, setRunId] = useState<string>(() => crypto.randomUUID())
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamBuffer, setStreamBuffer] = useState<string[]>([])
  const [currentAssistantMsg, setCurrentAssistantMsg] = useState('')

  const [spec, setSpec] = useState<FeatureSpec | null>(null)
  const [specialists, setSpecialists] = useState<FeatureSpecialist[]>([])
  const [specialistTokens, setSpecialistTokens] = useState<Record<number, string[]>>({})
  const [plan, setPlan] = useState('')
  const [planLoading, setPlanLoading] = useState(false)

  const [stagedFiles, setStagedFiles] = useState<string[]>([])
  const [stagedDiffs, setStagedDiffs] = useState<Record<string, SelfHealStagedFileDiff | null>>({})
  const [reviewedFiles, setReviewedFiles] = useState<Record<string, boolean>>({})
  const [expandedDiffFile, setExpandedDiffFile] = useState<string | null>(null)
  const [implementationRunning, setImplementationRunning] = useState(false)
  const [fixEvents, setFixEvents] = useState<string[]>([])

  const [verificationLines, setVerificationLines] = useState<string[]>([])
  const [verificationRunning, setVerificationRunning] = useState(false)
  const [gitMessage, setGitMessage] = useState('')
  const [gitRunning, setGitRunning] = useState(false)
  const [commitSha, setCommitSha] = useState('')

  const [runs, setRuns] = useState<FeatureGeneratorRun[]>([])
  const [error, setError] = useState<string | null>(null)

  const chatBottomRef = useRef<HTMLDivElement>(null)

  // Load run history on mount
  useEffect(() => {
    window.api.featureGeneratorGetRuns().then((r) => {
      if (!('error' in r)) setRuns(r as FeatureGeneratorRun[])
    }).catch(() => {})
  }, [])

  // Subscribe to streaming events
  useEffect(() => {
    const offToken = window.api.onFeatureGeneratorToken((chunk) => {
      if (phase === 'chatting' || phase === 'planning') {
        setCurrentAssistantMsg((prev) => prev + chunk)
      } else {
        setStreamBuffer((prev) => [...prev, chunk])
      }
    })
    const offSpec = window.api.onFeatureGeneratorSpecReady((s) => {
      setSpec(s)
      setStreaming(false)
      setPhase('spec-ready')
      // Finalize assistant message
      setMessages((prev) => {
        if (prev.length > 0 && prev[prev.length - 1].role === 'assistant') return prev
        return [...prev, { role: 'assistant', content: currentAssistantMsg }]
      })
    })
    const offFix = window.api.onFeatureGeneratorFixEvent((event) => {
      setFixEvents((prev) => [...prev, `${event.status}: ${event.file}`])
      if (event.status === 'staged') {
        setStagedFiles((prev) => prev.includes(event.file) ? prev : [...prev, event.file])
      }
    })
    const offSpecialist = window.api.onFeatureGeneratorSpecialistToken((payload) => {
      setSpecialistTokens((prev) => ({
        ...prev,
        [payload.specialistIndex]: [...(prev[payload.specialistIndex] ?? []), payload.chunk],
      }))
    })
    return () => { offToken(); offSpec(); offFix(); offSpecialist() }
  }, [phase, currentAssistantMsg])

  // Auto-scroll chat
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentAssistantMsg])

  // Finalize streaming assistant message when streaming stops
  useEffect(() => {
    if (!streaming && currentAssistantMsg && phase === 'chatting') {
      setMessages((prev) => {
        const last = prev[prev.length - 1]
        if (last?.role === 'assistant') return prev
        return [...prev, { role: 'assistant', content: currentAssistantMsg }]
      })
      setCurrentAssistantMsg('')
    }
  }, [streaming, currentAssistantMsg, phase])

  const sendMessage = useCallback(async () => {
    if (!input.trim() || streaming) return
    const userMsg: ChatMessage = { role: 'user', content: input.trim() }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setInput('')
    setStreaming(true)
    setCurrentAssistantMsg('')
    setPhase('chatting')
    setError(null)

    try {
      await window.api.featureGeneratorChat(nextMessages.map((m) => ({ role: m.role, content: m.content })))
    } catch (e) {
      setError(String(e))
    } finally {
      setStreaming(false)
    }
  }, [input, messages, streaming])

  const handleApproveSpec = useCallback(async () => {
    if (!spec) return
    setPhase('approving-spec')
    setPlanLoading(true)
    setCurrentAssistantMsg('')
    setError(null)
    try {
      const result = await window.api.featureGeneratorGeneratePlan(runId, spec)
      if ('error' in result) throw new Error((result as { error: string }).error)
      const r = result as { plan: string }
      setPlan(r.plan)

      // Extract specialists from the run record
      const runResult = await window.api.featureGeneratorGetRun(runId)
      if (runResult && !('error' in runResult) && (runResult as FeatureGeneratorRun).teamJson) {
        const s = JSON.parse((runResult as FeatureGeneratorRun).teamJson!) as FeatureSpecialist[]
        setSpecialists(s)
      }

      setPhase('plan-ready')
    } catch (e) {
      setError(String(e))
      setPhase('spec-ready')
    } finally {
      setPlanLoading(false)
    }
  }, [spec, runId])

  const handleApprovePlan = useCallback(async () => {
    if (!spec || !plan) return
    setPhase('staging')
    setImplementationRunning(true)
    setFixEvents([])
    setStagedFiles([])
    setError(null)
    try {
      const result = await window.api.featureGeneratorStartImplementation(runId, spec, plan)
      if ('error' in result) throw new Error((result as { error: string }).error)
      setPhase('diff-ready')
    } catch (e) {
      setError(String(e))
      setPhase('plan-ready')
    } finally {
      setImplementationRunning(false)
    }
  }, [spec, plan, runId])

  const handleLoadDiff = useCallback(async (relativePath: string) => {
    try {
      const diff = await window.api.getStagedDiff(runId, relativePath)
      setStagedDiffs((prev) => ({ ...prev, [relativePath]: diff ?? null }))
      setExpandedDiffFile(relativePath)
    } catch {}
  }, [runId])

  const handleRevertFile = useCallback(async (relativePath: string) => {
    try {
      await window.api.revertStagedFile(runId, relativePath)
      setStagedFiles((prev) => prev.filter((f) => f !== relativePath))
      setStagedDiffs((prev) => { const n = { ...prev }; delete n[relativePath]; return n })
      setReviewedFiles((prev) => { const n = { ...prev }; delete n[relativePath]; return n })
    } catch (e) {
      setError(String(e))
    }
  }, [runId])

  const handleApplyToWorkspace = useCallback(async () => {
    if (!allReviewed) return
    setPhase('applied')
    setError(null)
    try {
      await window.api.commitFixToWorkspace(runId)
      setPhase('verifying')
      setVerificationRunning(true)
      setVerificationLines([])

      const offLog = window.api.onVerificationEvent((event: SelfHealVerificationEvent) => {
        if (event.line) setVerificationLines((prev) => [...prev, event.line!])
      })
      const offDone = window.api.onVerificationDone((result: SelfHealVerificationDone) => {
        offLog(); offDone()
        setVerificationRunning(false)
        setPhase(result.status === 'success' ? 'verified' : 'failed')
      })

      await window.api.startVerification(runId)
    } catch (e) {
      setError(String(e))
      setPhase('diff-ready')
    }
  }, [runId, stagedFiles, reviewedFiles])

  const handleGitCommit = useCallback(async () => {
    if (!gitMessage.trim()) return
    setGitRunning(true)
    setError(null)
    try {
      await window.api.prepareSelfHealCommit(runId)
      const result = await window.api.commitSelfHealFix(runId, gitMessage)
      if ('error' in result) throw new Error((result as { error: string }).error)
      const sha = (result as { sha?: string }).sha ?? ''
      setCommitSha(sha)
      setPhase('committed')
      setRuns((prev) => {
        const updated = prev.map((r) => r.id === runId ? { ...r, status: 'committed', commitSha: sha } : r)
        return updated
      })
    } catch (e) {
      setError(String(e))
    } finally {
      setGitRunning(false)
    }
  }, [runId, gitMessage])

  const handleGitPush = useCallback(async () => {
    setGitRunning(true)
    try {
      await window.api.pushSelfHealFix(runId)
      setPhase('done')
    } catch (e) {
      setError(String(e))
    } finally {
      setGitRunning(false)
    }
  }, [runId])

  const handleReset = useCallback(() => {
    setPhase('idle')
    setRunId(crypto.randomUUID())
    setMessages([])
    setInput('')
    setSpec(null)
    setSpecialists([])
    setSpecialistTokens({})
    setPlan('')
    setStagedFiles([])
    setStagedDiffs({})
    setReviewedFiles({})
    setExpandedDiffFile(null)
    setFixEvents([])
    setVerificationLines([])
    setCommitSha('')
    setGitMessage('')
    setError(null)
    setStreamBuffer([])
    setCurrentAssistantMsg('')
    // Refresh history
    window.api.featureGeneratorGetRuns().then((r) => {
      if (!('error' in r)) setRuns(r as FeatureGeneratorRun[])
    }).catch(() => {})
  }, [])

  const handleResume = useCallback((run: FeatureGeneratorRun) => {
    setRunId(run.id)
    if (run.specJson) setSpec(JSON.parse(run.specJson) as FeatureSpec)
    if (run.planMarkdown) setPlan(run.planMarkdown)
    if (run.teamJson) setSpecialists(JSON.parse(run.teamJson) as FeatureSpecialist[])
    if (run.stagedFilesJson) setStagedFiles(JSON.parse(run.stagedFilesJson) as string[])
    const phaseMap: Record<string, Phase> = {
      'spec-ready': 'spec-ready', 'plan-ready': 'plan-ready',
      'staging': 'staging', 'diff-ready': 'diff-ready',
      'applied': 'applied', 'verifying': 'verifying',
      'verified': 'verified', 'committed': 'committed',
    }
    setPhase(phaseMap[run.status] ?? 'idle')
    setError(null)
  }, [])

  const allReviewed = stagedFiles.length > 0 && stagedFiles.every((f) => reviewedFiles[f])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-gray-800 dark:text-gray-100">Feature Generator</p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">Plan, implement, verify, and commit new features through a guided AI workflow.</p>
        </div>
        {phase !== 'idle' && (
          <button
            onClick={handleReset}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            <RotateCcw className="w-3 h-3" /> New run
          </button>
        )}
      </div>

      {/* Phase progress bar */}
      {phase !== 'idle' && <PhaseBar phase={phase} />}

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-2 p-2.5 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10">
          <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
          <p className="text-[11px] text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Idle start prompt */}
      {phase === 'idle' && (
        <div className="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-6 text-center space-y-3">
          <Sparkles className="w-8 h-8 text-purple-400 mx-auto" />
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Describe what you want to build</p>
            <p className="text-[11px] text-gray-500 mt-1">The assistant will ask clarifying questions, then produce a structured feature spec and implementation plan.</p>
          </div>
          <div className="flex gap-2 max-w-sm mx-auto">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              placeholder="e.g. Add a search bar to the agents list"
              className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-purple-400"
              autoFocus
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              className="px-3 py-2 rounded-lg bg-purple-600 text-white text-xs font-medium hover:bg-purple-700 disabled:opacity-40"
            >
              Start
            </button>
          </div>
        </div>
      )}

      {/* Chat panel */}
      {(phase === 'chatting' || phase === 'spec-ready') && (
        <div className="space-y-3">
          {/* Messages */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-y-auto max-h-64 space-y-0">
            {messages.map((msg, i) => (
              <div key={i} className={`px-3 py-2 ${msg.role === 'user' ? 'bg-gray-50 dark:bg-gray-800/50' : 'bg-white dark:bg-gray-900'}`}>
                <p className="text-[10px] font-medium text-gray-400 mb-0.5">{msg.role === 'user' ? 'You' : 'Assistant'}</p>
                <p className="text-[11px] text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              </div>
            ))}
            {currentAssistantMsg && (
              <div className="px-3 py-2 bg-white dark:bg-gray-900">
                <p className="text-[10px] font-medium text-gray-400 mb-0.5">Assistant</p>
                <p className="text-[11px] text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">{currentAssistantMsg}</p>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Spec preview */}
          {spec && phase === 'spec-ready' && <SpecPreview spec={spec} />}

          {/* Actions */}
          {phase === 'spec-ready' && spec && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleApproveSpec}
                disabled={planLoading}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 font-medium"
              >
                <CheckCircle className="w-3 h-3" /> Approve spec & generate plan
              </button>
              <button
                onClick={() => { setSpec(null); setPhase('chatting') }}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                Continue conversation
              </button>
            </div>
          )}

          {/* Input (only when no spec yet) */}
          {phase === 'chatting' && (
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                disabled={streaming}
                placeholder="Reply..."
                className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-purple-400 disabled:opacity-50"
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || streaming}
                className="px-3 py-2 rounded-lg bg-purple-600 text-white text-xs font-medium hover:bg-purple-700 disabled:opacity-40"
              >
                {streaming ? '...' : 'Send'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Plan generation loading */}
      {(phase === 'approving-spec' || phase === 'planning') && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] text-gray-500">
            <div className="w-3 h-3 rounded-full border-2 border-purple-400 border-t-transparent animate-spin" />
            Generating implementation plan…
          </div>
          {streamBuffer.length > 0 && (
            <BuildLog lines={streamBuffer} running resizable={false} maxHeightPx={200} />
          )}
        </div>
      )}

      {/* Plan review */}
      {phase === 'plan-ready' && plan && (
        <div className="space-y-3">
          {/* Specialists */}
          {specialists.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Specialist team</p>
              {specialists.map((s, i) => (
                <SpecialistCard key={i} specialist={s} index={i} tokens={specialistTokens[i] ?? []} />
              ))}
            </div>
          )}

          {/* Plan */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Implementation plan</p>
            <BuildLog lines={plan.split('\n')} resizable maxHeightPx={280} />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleApprovePlan}
              disabled={implementationRunning}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 font-medium"
            >
              <Play className="w-3 h-3" /> Approve plan & stage changes
            </button>
            <button
              onClick={() => setPhase('spec-ready')}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500"
            >
              Back to spec
            </button>
          </div>
        </div>
      )}

      {/* Staging progress */}
      {(phase === 'staging') && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] text-gray-500">
            <div className="w-3 h-3 rounded-full border-2 border-purple-400 border-t-transparent animate-spin" />
            Generating and staging file patches…
          </div>
          {fixEvents.length > 0 && <BuildLog lines={fixEvents} running resizable={false} maxHeightPx={160} />}
        </div>
      )}

      {/* Diff review */}
      {(phase === 'diff-ready' || phase === 'applied') && stagedFiles.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">
              Staged changes ({stagedFiles.filter((f) => reviewedFiles[f]).length}/{stagedFiles.length} reviewed)
            </p>
          </div>
          <div className="space-y-1.5">
            {stagedFiles.map((file) => (
              <DiffFileRow
                key={file}
                relativePath={file}
                diff={stagedDiffs[file] ?? null}
                reviewed={reviewedFiles[file] ?? false}
                isExpanded={expandedDiffFile === file}
                onLoadDiff={() => handleLoadDiff(file)}
                onRevert={() => handleRevertFile(file)}
                onMarkReviewed={() => {
                  setReviewedFiles((prev) => ({ ...prev, [file]: true }))
                  setExpandedDiffFile(null)
                }}
              />
            ))}
          </div>
          {allReviewed && (
            <button
              onClick={handleApplyToWorkspace}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 font-medium"
            >
              <CheckCircle className="w-3 h-3" /> Apply all to workspace
            </button>
          )}
          {!allReviewed && (
            <p className="text-[10px] text-gray-400">Review all diffs to enable workspace apply.</p>
          )}
        </div>
      )}

      {/* Verification */}
      {(phase === 'verifying' || phase === 'verified' || phase === 'failed') && (
        <div className="space-y-2">
          <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Verification</p>
          {verificationLines.length > 0 && (
            <BuildLog lines={verificationLines} running={verificationRunning} resizable maxHeightPx={200} />
          )}
          {phase === 'verified' && (
            <div className="flex items-center gap-2 text-[11px] text-green-600 dark:text-green-400">
              <CheckCircle className="w-3.5 h-3.5" /> All checks passed
            </div>
          )}
          {phase === 'failed' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[11px] text-red-600 dark:text-red-400">
                <AlertTriangle className="w-3.5 h-3.5" /> Verification failed — review the log above
              </div>
              <button
                onClick={() => setPhase('diff-ready')}
                className="text-[10px] px-2.5 py-1 rounded border border-gray-200 dark:border-gray-700 text-gray-500"
              >
                Back to diffs
              </button>
            </div>
          )}
        </div>
      )}

      {/* Git commit */}
      {phase === 'verified' && (
        <div className="space-y-2 border-t border-gray-100 dark:border-gray-700 pt-3">
          <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Commit changes</p>
          <input
            value={gitMessage}
            onChange={(e) => setGitMessage(e.target.value)}
            placeholder="feat(…): describe the change"
            className="w-full text-xs px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-purple-400"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleGitCommit}
              disabled={gitRunning || !gitMessage.trim()}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-white disabled:opacity-50 font-medium"
            >
              {gitRunning ? 'Committing…' : 'Commit'}
            </button>
            <button
              onClick={() => setPhase('done')}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500"
            >
              Skip commit
            </button>
          </div>
        </div>
      )}

      {/* Post-commit */}
      {phase === 'committed' && (
        <div className="space-y-2 border-t border-gray-100 dark:border-gray-700 pt-3">
          <div className="flex items-center gap-2 text-[11px] text-green-600 dark:text-green-400">
            <CheckCircle className="w-3.5 h-3.5" /> Committed
            {commitSha && <span className="font-mono text-gray-500 ml-1">{commitSha.slice(0, 8)}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleGitPush}
              disabled={gitRunning}
              className="text-xs px-3 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 font-medium"
            >
              {gitRunning ? 'Pushing…' : 'Push to remote'}
            </button>
            <button
              onClick={() => setPhase('done')}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500"
            >
              Skip push
            </button>
          </div>
        </div>
      )}

      {/* Done */}
      {phase === 'done' && (
        <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/10 p-4 text-center space-y-2">
          <CheckCircle className="w-6 h-6 text-green-500 mx-auto" />
          <p className="text-sm font-medium text-green-700 dark:text-green-400">Feature generator complete</p>
          {commitSha && <p className="text-[11px] text-gray-500">Commit: <span className="font-mono">{commitSha.slice(0, 12)}</span></p>}
          <button onClick={handleReset} className="text-xs px-3 py-1.5 rounded-lg border border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/20">
            Start another run
          </button>
        </div>
      )}

      {/* Run history */}
      {runs.length > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
          <RunHistoryList runs={runs} onResume={handleResume} />
        </div>
      )}
    </div>
  )
}
