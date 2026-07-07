/* eslint-disable react-hooks/exhaustive-deps -- effects are keyed by reportId; load helpers and event-handler closures read fresh state each render. */
import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Diff } from 'lucide-react'
import type {
  AvailableModelEntry,
  AvailableModelGroup,
  ErrorReportEntry,
  RemoteEditBackend,
  RemoteEditFixDone,
  RemoteEditFixEvent,
  RemoteEditGitEvent,
  RemoteEditGitPrepareResult,
  RemoteEditInvestigationActivity,
  RemoteEditInvestigationSettings,
  RemoteEditRecoveryEvent,
  RemoteEditRecoveryRun,
  RemoteEditStagedFileDiff,
  RemoteEditVerificationDone,
  RemoteEditVerificationEvent,
  RemoteEditVerificationRun,
  RemoteEditVerificationStep,
} from '@shared/types'
import { isApiError } from '@shared/types'
import {
  CODE_CHANGE_PHASE_LABELS,
  deriveCodeChangePhase,
  toCodeChangeRequest,
} from '@shared/code-changes'
import { DEFAULT_PROJECT_CONFIG } from '../../store/types'
import { useAppStore } from '../../store/app-store'
import { PhaseBar } from '../ui/primitives'
import { DeleteRemoteEditReportDialog } from '../DeleteRemoteEditReportDialog'
import { CodeChangeDetailView } from '../CodeChangeDetailView'
import { ModelPicker } from './ModelPicker'
import { RemoteEditDiffViewer } from '../RemoteEditDiffViewer'

const CODE_CHANGE_PHASE_ORDER = [
  'draft', 'investigating', 'patch-ready', 'applied', 'verifying', 'ready-to-commit', 'committed',
] as const

function CodeChangePhaseBar({ phase }: { phase: ReturnType<typeof deriveCodeChangePhase> }) {
  const currentIndex = phase === 'needs-attention'
    ? CODE_CHANGE_PHASE_ORDER.indexOf('verifying')
    : Math.max(0, CODE_CHANGE_PHASE_ORDER.indexOf(phase as (typeof CODE_CHANGE_PHASE_ORDER)[number]))
  const steps = CODE_CHANGE_PHASE_ORDER.map((id) => ({ id, label: CODE_CHANGE_PHASE_LABELS[id] }))
  return <PhaseBar steps={steps} currentIndex={currentIndex} failedId={phase === 'needs-attention' ? 'verifying' : undefined} />
}

/**
 * Renders a single Code Changes request inline in the chat transcript, referenced by the
 * `__code-change-ref:` sentinel. Collapsed by default with a one-line phase summary; expands
 * in place to the same investigate/diff/apply/verify/commit flow the old standalone
 * CodeChangesScreen used, reusing its presentational sub-components unchanged.
 */
export function CodeChangeCard({ reportId }: { reportId: string }) {
  const projectConfigs = useAppStore((s) => s.projectConfigs)
  const loadProjectConfig = useAppStore((s) => s.loadProjectConfig)
  const catalogModels = useAppStore((s) => s.catalogModels)
  const addToast = useAppStore((s) => s.addToast)

  const [expanded, setExpanded] = useState(false)
  const [report, setReport] = useState<ErrorReportEntry | null>(null)
  const [investigationSettings, setInvestigationSettings] = useState<RemoteEditInvestigationSettings>({
    backend: 'byok', model: 'gpt-5-mini', retryLimit: 1, autoApproveTools: true,
  })
  const [availableModelGroups, setAvailableModelGroups] = useState<AvailableModelGroup[]>([])
  const [investigationOutput, setInvestigationOutput] = useState<string>('')
  const [investigationActivity, setInvestigationActivity] = useState<RemoteEditInvestigationActivity[]>([])
  const [running, setRunning] = useState(false)
  const [investigationStatus, setInvestigationStatus] = useState<string | null>(null)
  const [fixRunning, setFixRunning] = useState(false)
  const [fixStatus, setFixStatus] = useState<string | null>(null)
  const [stagedDiffs, setStagedDiffs] = useState<Record<string, RemoteEditStagedFileDiff | null>>({})
  const [reviewedFiles, setReviewedFiles] = useState<Record<string, boolean>>({})
  const [committingFix, setCommittingFix] = useState(false)
  const [expandedDiffFile, setExpandedDiffFile] = useState<string | null>(null)
  const [verificationRuns, setVerificationRuns] = useState<RemoteEditVerificationRun[]>([])
  const [verificationRunning, setVerificationRunning] = useState(false)
  const [expandedVerifyCommand, setExpandedVerifyCommand] = useState<string | null>(null)
  const [gitPrepare, setGitPrepare] = useState<RemoteEditGitPrepareResult | null>(null)
  const [gitMessage, setGitMessage] = useState('')
  const [gitRunning, setGitRunning] = useState<string | null>(null)
  const [recoveryRuns, setRecoveryRuns] = useState<RemoteEditRecoveryRun[]>([])
  const [recoveryRunning, setRecoveryRunning] = useState(false)
  const [investigationStepCollapsed, setInvestigationStepCollapsed] = useState(false)
  const [phaseSectionsCollapsed, setPhaseSectionsCollapsed] = useState<Record<string, boolean>>({})
  const [reviewAction, setReviewAction] = useState<'accept' | 'reject' | 'revise' | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(false)

  const projectId = report?.project_id ?? null
  const projectConfig = projectId ? (projectConfigs[projectId] ?? DEFAULT_PROJECT_CONFIG) : DEFAULT_PROJECT_CONFIG
  const rootDirectory = projectConfig.rootDirectory?.trim() ?? ''
  const workspaceBinding = {
    rootDirectory,
    isConnected: rootDirectory.length > 0 && (projectConfig.workspaceInfo?.exists ?? true),
  }

  const request = report ? toCodeChangeRequest(report, { projectId, workspaceRoot: workspaceBinding.rootDirectory || null }) : null
  const phase = report ? deriveCodeChangePhase(report, verificationRuns[0] ?? null, gitPrepare?.canCommit === false) : null

  const remoteEditModelGroups = availableModelGroups.filter((group) => {
    if (investigationSettings.backend === 'claude-cli') return group.sourceKey === 'claude-cli'
    if (investigationSettings.backend === 'codex-cli') return group.sourceKey === 'codex-cli'
    return group.sourceType === 'provider'
  })
  const selectedModelSourceLabel = remoteEditModelGroups.find((group) =>
    group.models.some((model) => model.id === investigationSettings.model)
  )?.sourceLabel
  const hasBackendGroup = (backend: RemoteEditBackend) => availableModelGroups.some((group) => group.sourceKey === backend)
  const backendOptions: Array<{ value: RemoteEditBackend; label: string }> = [
    { value: 'byok', label: 'BYOK' },
    ...(hasBackendGroup('claude-cli') || investigationSettings.backend === 'claude-cli' ? [{ value: 'claude-cli' as const, label: 'Claude CLI' }] : []),
    ...(hasBackendGroup('codex-cli') || investigationSettings.backend === 'codex-cli' ? [{ value: 'codex-cli' as const, label: 'Codex CLI' }] : []),
  ]
  const reportBusy = running || fixRunning || verificationRunning || recoveryRunning || deleting || committingFix || gitRunning !== null

  const handleSelectRemoteEditModel = (_group: AvailableModelGroup, model: AvailableModelEntry) => {
    setInvestigationSettings((settings) => ({ ...settings, model: model.id }))
  }
  const handleSelectReviseModel = (group: AvailableModelGroup, model: AvailableModelEntry) => {
    setInvestigationSettings((settings) => ({ ...settings, model: model.id, backend: group.sourceType === 'cli' ? (group.sourceKey as RemoteEditBackend) : 'byok' }))
  }
  const handleSetBackend = (backend: RemoteEditBackend) => {
    setInvestigationSettings((settings) => {
      const nextGroups = availableModelGroups.filter((group) => {
        if (backend === 'claude-cli') return group.sourceKey === 'claude-cli'
        if (backend === 'codex-cli') return group.sourceKey === 'codex-cli'
        return group.sourceType === 'provider'
      })
      const modelStillAvailable = nextGroups.some((group) => group.models.some((model) => model.id === settings.model))
      return { ...settings, backend, model: modelStillAvailable ? settings.model : (nextGroups[0]?.models[0]?.id ?? settings.model) }
    })
  }

  const reviseModelPicker = (
    <ModelPicker
      value={investigationSettings.model}
      sourceLabel={selectedModelSourceLabel}
      availableGroups={availableModelGroups}
      catalogModels={catalogModels}
      includeDefault={false}
      emptyLabel="No models configured"
      menuClassName="left-0 right-auto"
      onSelectAvailableModel={handleSelectReviseModel}
    />
  )

  const loadReport = async () => {
    const next = await window.api.getErrorReport(reportId)
    if (next) setReport(next)
  }
  const loadVerificationRuns = async () => setVerificationRuns(await window.api.getVerificationRuns(reportId))
  const loadRecoveryRuns = async () => setRecoveryRuns(await window.api.getRemoteEditRecoveryRuns(reportId))

  useEffect(() => { void loadReport() }, [reportId])
  useEffect(() => {
    if (projectId) void loadProjectConfig(projectId)
  }, [projectId, loadProjectConfig])
  useEffect(() => {
    window.api.getInvestigationSettings().then(setInvestigationSettings).catch(() => {})
    window.api.listAvailableModels().then(setAvailableModelGroups).catch(() => {})
  }, [])
  useEffect(() => {
    if (!expanded) return
    const interval = setInterval(() => { void loadReport() }, 4000)
    return () => clearInterval(interval)
  }, [expanded, reportId])
  useEffect(() => {
    void loadVerificationRuns()
    void loadRecoveryRuns()
  }, [reportId])

  useEffect(() => {
    const offActivity = window.api.onInvestigationActivity((activity) => {
      if (activity.reportId !== reportId) return
      setInvestigationActivity((prev) => [...prev.slice(-49), activity])
    })
    const offChunk = window.api.onInvestigationChunk(({ reportId: id, chunk }) => {
      if (id !== reportId) return
      setInvestigationOutput((prev) => `${prev}${chunk}`)
    })
    const offDone = window.api.onInvestigationDone((result) => {
      if (result.reportId !== reportId) return
      setRunning(false)
      setReviewAction(null)
      setInvestigationStatus(result.status === 'done' ? 'Planning complete' : result.error ?? 'Planning failed')
      setInvestigationOutput('')
      void loadReport()
    })
    return () => { offActivity(); offChunk(); offDone() }
  }, [reportId])

  useEffect(() => {
    const offEvent = window.api.onFixEvent((event: RemoteEditFixEvent) => {
      if (event.reportId !== reportId) return
      setFixStatus(event.label)
    })
    const offDone = window.api.onFixDone((result: RemoteEditFixDone) => {
      if (result.reportId !== reportId) return
      setFixRunning(false)
      setFixStatus(result.status === 'done' ? 'Staged patch ready' : result.error ?? 'Patch generation failed')
      void loadReport()
    })
    return () => { offEvent(); offDone() }
  }, [reportId])

  useEffect(() => {
    const offEvent = window.api.onVerificationEvent((event: RemoteEditVerificationEvent) => {
      if (event.reportId !== reportId) return
      setVerificationRunning(event.status === 'running')
      setVerificationRuns((prev) => {
        const nextRuns = [...prev]
        const index = nextRuns.findIndex((run) => run.id === event.runId)
        const existingRun = index === -1
          ? {
              id: event.runId, reportId, status: 'running' as const,
              steps: ['typecheck', 'lint', 'test', 'build'].map((command) => ({
                command: command as RemoteEditVerificationStep['command'], status: 'pending' as const,
                exitCode: null, log: '', startedAt: null, completedAt: null,
              })),
              startedAt: Date.now(), completedAt: null, retryCount: 0,
            }
          : nextRuns[index]
        const run = { ...existingRun, status: event.status === 'running' ? 'running' as const : existingRun.status }
        if (event.command) {
          run.steps = run.steps.map((step) => step.command !== event.command ? step : {
            ...step,
            status: event.status === 'running' || event.status === 'success' || event.status === 'failed' ? event.status : step.status,
            exitCode: event.exitCode ?? step.exitCode,
            log: event.line ? `${step.log}${event.line}` : step.log,
          })
        }
        if (index === -1) nextRuns.unshift(run)
        else nextRuns[index] = run
        return nextRuns
      })
    })
    const offDone = window.api.onVerificationDone((result: RemoteEditVerificationDone) => {
      if (result.reportId !== reportId) return
      setVerificationRunning(false)
      setVerificationRuns((prev) => {
        const run: RemoteEditVerificationRun = {
          id: result.runId, reportId, status: result.status, steps: result.steps,
          startedAt: Date.now(), completedAt: result.completedAt, retryCount: result.retryCount, error: result.error,
        }
        return [run, ...prev.filter((existing) => existing.id !== result.runId)].slice(0, 10)
      })
    })
    return () => { offEvent(); offDone() }
  }, [reportId])

  useEffect(() => {
    const off = window.api.onRemoteEditGitEvent((event: RemoteEditGitEvent) => {
      if (event.reportId !== reportId) return
      if (event.type === 'commit' || event.type === 'push') setGitRunning(null)
      if (event.status) {
        setGitPrepare((existing) => existing ? {
          ...existing,
          status: event.status!,
          canCommit: event.type === 'commit' && !event.error ? false : existing.canCommit,
          reason: event.error ?? existing.reason,
          authRequired: event.authRequired ?? existing.authRequired,
          authHelp: event.authHelp ?? existing.authHelp,
        } : existing)
      }
    })
    return off
  }, [reportId])

  useEffect(() => {
    const off = window.api.onRemoteEditRecoveryEvent((event: RemoteEditRecoveryEvent) => {
      if (event.reportId !== reportId) return
      if (event.type === 'prepare') { setRecoveryRunning(false); void loadRecoveryRuns() }
      if (event.type === 'reload') void loadRecoveryRuns()
    })
    return off
  }, [reportId])

  const persistInvestigationSettings = async () => {
    const saved = await window.api.setInvestigationSettings(investigationSettings)
    setInvestigationSettings(saved)
    return saved
  }

  const handleStartInvestigation = async (action?: 'revise', revisionNotes?: string) => {
    setRunning(true)
    setReviewAction(action ?? null)
    setInvestigationStatus('Planning started')
    setInvestigationOutput('')
    setInvestigationActivity([])
    if (action === 'revise') setInvestigationStepCollapsed(false)
    try {
      await persistInvestigationSettings()
      await window.api.startInvestigation(reportId, revisionNotes)
    } catch (error) {
      setRunning(false)
      setReviewAction(null)
      setInvestigationStatus(error instanceof Error ? error.message : String(error))
    }
  }

  const handleReviewInvestigation = async (status: 'investigated' | 'rejected') => {
    setReviewAction(status === 'investigated' ? 'accept' : 'reject')
    setInvestigationStatus(status === 'investigated' ? 'Accepting plan...' : 'Rejecting plan...')
    try {
      await window.api.setRemoteEditReportStatus(reportId, status)
      setInvestigationStatus(status === 'investigated' ? 'Plan accepted' : 'Plan rejected')
      await loadReport()
    } catch (error) {
      setInvestigationStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setReviewAction(null)
    }
  }

  const handleStartFix = async () => {
    setFixRunning(true)
    setFixStatus('Generating staged patch...')
    setStagedDiffs({})
    setReviewedFiles({})
    setExpandedDiffFile(null)
    try {
      await persistInvestigationSettings()
      await window.api.startFix(reportId)
    } catch (error) {
      setFixRunning(false)
      setFixStatus(error instanceof Error ? error.message : String(error))
    }
  }

  const handleLoadDiff = async (_reportId: string, relativePath: string) => {
    const diff = await window.api.getStagedDiff(reportId, relativePath)
    setStagedDiffs((prev) => ({ ...prev, [relativePath]: diff ?? null }))
    setExpandedDiffFile(relativePath)
  }
  const handleRevertFile = async (_reportId: string, relativePath: string) => {
    await window.api.revertStagedFile(reportId, relativePath)
    setStagedDiffs((prev) => { const next = { ...prev }; delete next[relativePath]; return next })
    setReviewedFiles((prev) => { const next = { ...prev }; delete next[relativePath]; return next })
    if (expandedDiffFile === relativePath) setExpandedDiffFile(null)
    void loadReport()
  }
  const handleMarkReviewed = (relativePath: string) => {
    setReviewedFiles((prev) => ({ ...prev, [relativePath]: true }))
    setExpandedDiffFile(null)
  }
  const handleCommitFix = async () => {
    setCommittingFix(true)
    setFixStatus('Applying to workspace...')
    await window.api.commitFixToWorkspace(reportId)
    setCommittingFix(false)
    void loadReport()
  }
  const handleStartVerification = async () => {
    setVerificationRunning(true)
    setExpandedVerifyCommand(null)
    let runId: string
    try {
      await persistInvestigationSettings()
      ;({ runId } = await window.api.startVerification(reportId))
    } catch {
      setVerificationRunning(false)
      return
    }
    setVerificationRuns((prev) => [
      {
        id: runId, reportId, status: 'running',
        steps: ['typecheck', 'lint', 'test', 'build'].map((command) => ({
          command: command as RemoteEditVerificationStep['command'], status: 'pending' as const,
          exitCode: null, log: '', startedAt: null, completedAt: null,
        })),
        startedAt: Date.now(), completedAt: null, retryCount: 0,
      },
      ...prev.filter((run) => run.id !== runId),
    ])
  }
  const handlePrepareGitCommit = async () => {
    setGitRunning('prepare')
    const result = await window.api.prepareRemoteEditCommit(reportId)
    setGitPrepare(result)
    setGitMessage((prev) => prev || result.suggestedMessage)
    setGitRunning(null)
  }
  const handleCommitGitFix = async () => {
    setGitRunning('commit')
    const result = await window.api.commitRemoteEditFix(reportId, gitMessage)
    setGitPrepare((existing) => existing ? { ...existing, status: result.status, canCommit: !result.committed, reason: result.error, authRequired: result.authRequired, authHelp: result.authHelp } : null)
    setGitRunning(null)
  }
  const handlePushGitFix = async () => {
    setGitRunning('push')
    const result = await window.api.pushRemoteEditFix(reportId)
    setGitPrepare((existing) => existing ? { ...existing, status: result.status, reason: result.error, authRequired: result.authRequired, authHelp: result.authHelp } : null)
    setGitRunning(null)
  }
  const handleRollbackHeal = async (recoveryId: string) => {
    await window.api.rollbackRemoteEdit(recoveryId)
    void loadReport()
  }
  const handleUndoChange = async () => {
    setRecoveryRunning(true)
    try {
      let recoveryId = recoveryRuns[0]?.id
      if (!recoveryId) {
        const prepared = await window.api.prepareRemoteEditReload(reportId)
        if (prepared.recovery) {
          recoveryId = prepared.recovery.id
          setRecoveryRuns((prev) => [prepared.recovery!, ...prev.filter((run) => run.id !== prepared.recovery!.id)].slice(0, 10))
        }
      }
      if (!recoveryId) {
        addToast('Nothing to undo for this change.', 'error')
        return
      }
      await handleRollbackHeal(recoveryId)
    } finally {
      setRecoveryRunning(false)
    }
  }
  const handleDelete = async () => {
    setDeleting(true)
    try {
      const result = await window.api.deleteErrorReport(reportId)
      if (isApiError(result)) {
        addToast(result.error, 'error')
        return
      }
      addToast('Change request deleted', 'success')
      setPendingDelete(false)
      setReport(null)
    } catch (error) {
      addToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setDeleting(false)
    }
  }

  if (!report) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-[11px] text-gray-400 max-w-2xl">
        <Diff className="w-3.5 h-3.5" />
        Loading code change…
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50/30 dark:bg-purple-900/10 max-w-2xl">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Diff className="w-3.5 h-3.5 text-purple-500 shrink-0" />
        <span className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex-1 truncate">{report.title}</span>
        {phase && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-medium shrink-0">
            {CODE_CHANGE_PHASE_LABELS[phase]}
          </span>
        )}
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3">
          <CodeChangeDetailView
            report={report}
            request={request}
            phase={phase}
            phaseBar={phase && <CodeChangePhaseBar phase={phase} />}
            runningReportId={running ? reportId : null}
            onStartInvestigation={() => void handleStartInvestigation()}
            isWorkspaceConnected={workspaceBinding.isConnected}
            currentWorkspaceRoot={workspaceBinding.rootDirectory || null}
            onRequestDelete={() => setPendingDelete(true)}
            reportBusy={reportBusy}
            deleting={deleting}
            investigationActivity={investigationActivity}
            investigationOutput={investigationOutput}
            reviewAction={reviewAction}
            investigationStatus={investigationStatus}
            onAcceptInvestigation={() => void handleReviewInvestigation('investigated')}
            onRejectInvestigation={() => void handleReviewInvestigation('rejected')}
            onReviseInvestigation={(notes) => void handleStartInvestigation('revise', notes)}
            onGeneratePatch={() => void handleStartFix()}
            fixRunning={fixRunning ? reportId : null}
            investigationSettings={investigationSettings}
            onSetInvestigationSettings={setInvestigationSettings}
            onSetBackend={handleSetBackend}
            backendOptions={backendOptions}
            remoteEditModelGroups={remoteEditModelGroups}
            selectedModelSourceLabel={selectedModelSourceLabel}
            catalogModels={catalogModels}
            onSelectRemoteEditModel={handleSelectRemoteEditModel}
            onSaveInvestigationSettings={() => void persistInvestigationSettings()}
            investigationStepCollapsed={investigationStepCollapsed}
            onToggleInvestigationStepCollapsed={() => setInvestigationStepCollapsed((c) => !c)}
            reviseModelPicker={reviseModelPicker}
            diffViewer={(
              <RemoteEditDiffViewer
                report={report}
                fixRunning={fixRunning ? reportId : null}
                fixStatus={fixStatus}
                runningReportId={running ? reportId : null}
                onReviseInvestigation={() => void handleStartInvestigation('revise')}
                reviseModelPicker={reviseModelPicker}
                verificationRun={verificationRuns[0] ?? null}
                verificationRunning={verificationRunning ? reportId : null}
                expandedVerifyCommand={expandedVerifyCommand}
                gitPrepare={gitPrepare}
                gitMessage={gitMessage}
                gitRunning={gitRunning}
                recoveryRun={recoveryRuns[0] ?? null}
                recoveryRunning={recoveryRunning}
                stagedDiffs={stagedDiffs}
                reviewedFiles={reviewedFiles}
                expandedDiffFile={expandedDiffFile}
                committingFix={committingFix}
                onStartFix={() => void handleStartFix()}
                onStartVerification={() => void handleStartVerification()}
                onExpandVerifyCommand={setExpandedVerifyCommand}
                onPrepareGitCommit={() => void handlePrepareGitCommit()}
                onCommitGitFix={() => void handleCommitGitFix()}
                onPushGitFix={() => void handlePushGitFix()}
                onSetGitMessage={setGitMessage}
                onUndoChange={() => void handleUndoChange()}
                onLoadDiff={handleLoadDiff}
                onRevertFile={handleRevertFile}
                onMarkReviewed={handleMarkReviewed}
                onCommitFix={() => void handleCommitFix()}
                onExpandDiff={setExpandedDiffFile}
                sectionsCollapsed={phaseSectionsCollapsed}
                onToggleSection={(phaseId) => setPhaseSectionsCollapsed((prev) => ({ ...prev, [phaseId]: !prev[phaseId] }))}
              />
            )}
          />
        </div>
      )}

      {pendingDelete && (
        <DeleteRemoteEditReportDialog
          reportTitle={report.title}
          deleting={deleting}
          onConfirm={() => void handleDelete()}
          onCancel={() => setPendingDelete(false)}
        />
      )}
    </div>
  )
}
