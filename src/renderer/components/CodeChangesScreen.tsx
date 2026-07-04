/* eslint-disable react-hooks/exhaustive-deps -- polling is keyed by report identity; status is handled inside. */
import { useEffect, useState, type ReactNode } from 'react'
import type {
  AvailableModelEntry,
  AvailableModelGroup,
  ErrorReportEntry,
  RemoteEditBackend,
  RemoteEditFixDone,
  RemoteEditFixEvent,
  RemoteEditGitEvent,
  RemoteEditGitPrepareResult,
  RemoteEditHistoryEntry,
  RemoteEditInvestigationActivity,
  RemoteEditInvestigationSettings,
  RemoteEditRecoveryEvent,
  RemoteEditRecoveryRun,
  RemoteEditStagedFileDiff,
  RemoteEditStagedFileEntry,
  RemoteEditVerificationDone,
  RemoteEditVerificationEvent,
  RemoteEditVerificationRun,
  RemoteEditVerificationStep,
  CodeChangeRequestType,
} from '@shared/types'
import { isApiError } from '@shared/types'
import {
  CODE_CHANGE_PHASE_LABELS,
  deriveCodeChangePhase,
  toCodeChangeRequest,
} from '@shared/code-changes'
import type { ProjectConfig } from '../store/types'
import { useAppStore } from '../store/app-store'
import { Button, ModalShell, PhaseBar } from './ui/primitives'
import { DeleteRemoteEditReportDialog } from './DeleteRemoteEditReportDialog'
import { CodeChangeListView } from './CodeChangeListView'
import { CodeChangeDetailView } from './CodeChangeDetailView'
import { CodeChangeHistorySection } from './CodeChangeHistorySection'
import { CodeChangeNewRequestForm } from './CodeChangeNewRequestForm'
import { RevisePlanControl } from './RevisePlanControl'
import { ModelPicker } from './chat/ModelPicker'
import { PlanPreview } from './CodeChangePlanPreview'

// ---------------------------------------------------------------------------
// Remote Edit Diff Viewer sub-component
// ---------------------------------------------------------------------------

interface DiffViewerProps {
  report: ErrorReportEntry
  fixRunning: string | null
  fixStatus: string | null
  runningReportId: string | null
  onReviseInvestigation: (reportId: string, notes: string) => void
  reviseModelPicker: ReactNode
  verificationRun: RemoteEditVerificationRun | null
  verificationRunning: string | null
  expandedVerifyCommand: string | null
  gitPrepare: RemoteEditGitPrepareResult | null
  gitMessage: string
  gitRunning: string | null
  recoveryRun: RemoteEditRecoveryRun | null
  recoveryRunning: boolean
  stagedDiffs: Record<string, RemoteEditStagedFileDiff | null>
  reviewedFiles: Record<string, boolean>
  expandedDiffFile: string | null
  committingFix: boolean
  onStartFix: (reportId: string) => void
  onStartVerification: (reportId: string) => void
  onExpandVerifyCommand: (command: string | null) => void
  onPrepareGitCommit: (reportId: string) => void
  onCommitGitFix: (reportId: string) => void
  onPushGitFix: (reportId: string) => void
  onSetGitMessage: (message: string) => void
  onUndoChange: (reportId: string) => void
  onLoadDiff: (reportId: string, relativePath: string) => void
  onRevertFile: (reportId: string, relativePath: string) => void
  onMarkReviewed: (relativePath: string) => void
  onCommitFix: (reportId: string) => void
  onExpandDiff: (relativePath: string | null) => void
  sectionsCollapsed: Record<string, boolean>
  onToggleSection: (phaseId: string) => void
}

function PhaseSection({
  phaseId,
  title,
  collapsed,
  onToggle,
  children,
}: {
  phaseId: string
  title: string
  collapsed: boolean
  onToggle: (phaseId: string) => void
  children: ReactNode
}) {
  return (
    <div id={`code-change-phase-${phaseId}`} className="rounded-md border border-gray-200 dark:border-gray-700 scroll-mt-3">
      <button
        type="button"
        onClick={() => onToggle(phaseId)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] font-medium text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800/60"
      >
        <span>{collapsed ? '▸' : '▾'}</span>
        {title}
      </button>
      {!collapsed && <div className="border-t border-gray-100 p-3 space-y-3 dark:border-gray-800">{children}</div>}
    </div>
  )
}

function RemoteEditDiffViewer({
  report, fixRunning, fixStatus, runningReportId, onReviseInvestigation, reviseModelPicker,
  verificationRun, verificationRunning, expandedVerifyCommand,
  gitPrepare, gitMessage, gitRunning, recoveryRun, recoveryRunning,
  stagedDiffs, reviewedFiles, expandedDiffFile,
  committingFix, onStartFix, onStartVerification, onExpandVerifyCommand,
  onPrepareGitCommit, onCommitGitFix, onPushGitFix, onSetGitMessage, onUndoChange,
  onLoadDiff, onRevertFile, onMarkReviewed, onCommitFix, onExpandDiff,
  sectionsCollapsed, onToggleSection,
}: DiffViewerProps) {
  const stagedFiles: RemoteEditStagedFileEntry[] = (() => {
    try { return JSON.parse(report.fix_staged_files || '[]') } catch { return [] }
  })()

  const allReviewed = stagedFiles.length > 0 && stagedFiles.every((f) => reviewedFiles[f.relativePath])
  const canApply = report.fix_status === 'staged' && allReviewed && !committingFix
  const verificationCommands: RemoteEditVerificationStep['command'][] = ['typecheck', 'lint', 'test', 'build']
  const verificationSteps = verificationCommands.map((command) => {
    return verificationRun?.steps.find((step) => step.command === command) ?? {
      command,
      status: 'pending' as const,
      exitCode: null,
      log: '',
      startedAt: null,
      completedAt: null,
    }
  })
  const verificationPassed = verificationRun?.status === 'success'
  const verificationFailed = verificationRun?.status === 'failed'
  const committed = gitPrepare?.canCommit === false && !gitPrepare.reason
  const statusClass = (status: RemoteEditVerificationStep['status']) => {
    if (status === 'success') return 'text-green-600 dark:text-green-400'
    if (status === 'failed') return 'text-red-600 dark:text-red-400'
    if (status === 'running') return 'text-blue-600 dark:text-blue-400'
    if (status === 'skipped') return 'text-gray-400 dark:text-gray-500'
    return 'text-gray-500 dark:text-gray-400'
  }

  const patchReadyReached = report.fix_status !== 'none'
  const appliedReached = ['applied'].includes(report.fix_status) || verificationRun !== null
  const readyToCommitReached = verificationPassed || committed
  const committedReached = committed

  return (
    <div className="space-y-3 pt-1">
      {patchReadyReached && (
        <PhaseSection
          phaseId="patch-ready"
          title={`Patch ready · ${report.fix_status}`}
          collapsed={sectionsCollapsed['patch-ready'] ?? false}
          onToggle={onToggleSection}
        >
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium text-gray-700 dark:text-gray-300">
              Staged patch
              {' '}
              <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                report.fix_status === 'applied' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' :
                report.fix_status === 'staged'  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' :
                report.fix_status === 'failed'  ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' :
                                                  'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
              }`}>{report.fix_status}</span>
            </p>
            {report.fix_status === 'none' || report.fix_status === 'failed' ? (
              <div className="flex flex-wrap gap-2">
                {report.fix_status === 'failed' && (
                  <RevisePlanControl
                    reportId={report.id}
                    projectId={report.project_id}
                    disabled={fixRunning !== null || runningReportId !== null}
                    running={runningReportId === report.id}
                    onRevise={onReviseInvestigation}
                    modelPicker={reviseModelPicker}
                    planPreview={<PlanPreview report={report} />}
                  />
                )}
                <button
                  onClick={() => onStartFix(report.id)}
                  disabled={fixRunning !== null || runningReportId !== null}
                  className="text-[11px] px-2 py-1 rounded-md border border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/30 disabled:opacity-50"
                >
                  {fixRunning === report.id ? 'Generating...' : 'Regenerate patch'}
                </button>
              </div>
            ) : null}
          </div>

          {report.fix_status === 'staging' && (
            <p className="text-[11px] text-gray-400">{fixStatus ?? 'Generating patch...'}</p>
          )}

          {report.fix_status === 'failed' && (
            <p className="text-[11px] text-red-600 dark:text-red-400">
              {fixStatus || report.fix_error || 'Patch generation failed.'}
            </p>
          )}

          {stagedFiles.length > 0 && (
            <div className="rounded border border-gray-200 dark:border-gray-700 overflow-hidden">
              {stagedFiles.map((file) => {
                const diff = stagedDiffs[file.relativePath]
                const reviewed = reviewedFiles[file.relativePath] ?? false
                const isExpanded = expandedDiffFile === file.relativePath
                const isApplied = report.fix_status === 'applied'

                return (
                  <div key={file.relativePath} className="border-b border-gray-200 dark:border-gray-700 last:border-b-0">
                    <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-900/50">
                      <span className="flex-1 truncate font-mono text-[11px] text-gray-700 dark:text-gray-300">{file.relativePath}</span>
                      {reviewed && (
                        <span className="text-[10px] text-green-600 dark:text-green-400 font-medium">✓ Reviewed</span>
                      )}
                      <Button
                        variant="secondary"
                        onClick={() => {
                          if (isExpanded) {
                            onExpandDiff(null)
                          } else if (diff) {
                            onExpandDiff(file.relativePath)
                          } else {
                            onLoadDiff(report.id, file.relativePath)
                          }
                        }}
                        className="text-[11px] px-2 py-0.5"
                      >
                        {isExpanded ? 'Hide diff' : 'View diff'}
                      </Button>
                      {!reviewed && !isApplied && (
                        <button
                          onClick={() => onMarkReviewed(file.relativePath)}
                          className="text-[11px] px-2 py-0.5 rounded border border-green-300 text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-300 dark:hover:bg-green-950/30"
                        >
                          Mark reviewed
                        </button>
                      )}
                      {!isApplied && (
                        <Button
                          variant="danger"
                          onClick={() => void onRevertFile(report.id, file.relativePath)}
                          className="text-[11px] px-2 py-0.5"
                        >
                          Revert
                        </Button>
                      )}
                    </div>

                    {isExpanded && diff && (
                      <div className="max-h-80 overflow-auto font-mono text-[11px] leading-relaxed">
                        {diff.hunks.map((hunk, hi) => (
                          <div key={hi}>
                            <div className="bg-blue-50 dark:bg-blue-950/30 px-3 py-0.5 text-blue-600 dark:text-blue-400 select-none">
                              {hunk.header}
                            </div>
                            {hunk.lines.map((line, li) => (
                              <div
                                key={li}
                                className={`px-3 whitespace-pre-wrap ${
                                  line.type === 'added'   ? 'bg-green-50 text-green-800 dark:bg-green-950/30 dark:text-green-300' :
                                  line.type === 'removed' ? 'bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300' :
                                                            'text-gray-600 dark:text-gray-400'
                                }`}
                              >
                                <span className="select-none mr-2 text-gray-400 dark:text-gray-600 inline-block w-8 text-right">
                                  {line.lineNumber.after ?? line.lineNumber.before ?? ''}
                                </span>
                                <span className="select-none mr-1">{line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}</span>
                                {line.content}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}

                    {isExpanded && !diff && (
                      <div className="px-3 py-2 text-[11px] text-gray-400">Loading diff...</div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {report.fix_status === 'staged' && (
            <div className="flex items-center gap-3">
              <Button
                variant="primary"
                onClick={() => void onCommitFix(report.id)}
                disabled={!canApply}
                title={!allReviewed ? 'Mark all files as reviewed before applying' : ''}
              >
                {committingFix ? 'Applying...' : 'Apply to workspace'}
              </Button>
              {!allReviewed && stagedFiles.length > 0 && (
                <p className="text-[11px] text-gray-400">Review all files before applying</p>
              )}
            </div>
          )}

          {fixStatus && report.fix_status !== 'applied' && (
            <p className="text-[11px] text-gray-400">{fixStatus}</p>
          )}
        </PhaseSection>
      )}

      {appliedReached && (
        <PhaseSection
          phaseId="applied"
          title={verificationFailed ? 'Applied · verification failed' : verificationPassed ? 'Applied · verified' : 'Applied'}
          collapsed={sectionsCollapsed['applied'] ?? false}
          onToggle={onToggleSection}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-green-600 dark:text-green-400">Selected changes applied to the workspace. Backups were saved.</p>
            <button
              onClick={() => void onStartVerification(report.id)}
              disabled={verificationRunning !== null}
              className="text-[11px] px-2 py-1 rounded-md border border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/30 disabled:opacity-50"
            >
              {verificationRunning === report.id ? 'Verifying...' : 'Run verification'}
            </button>
          </div>

          <div className="rounded border border-gray-200 dark:border-gray-700 overflow-hidden">
            {verificationSteps.map((step) => {
              const isExpanded = expandedVerifyCommand === step.command
              return (
                <div key={step.command} className="border-b border-gray-200 dark:border-gray-700 last:border-b-0">
                  <Button
                    variant="ghost"
                    onClick={() => onExpandVerifyCommand(isExpanded ? null : step.command)}
                    className="w-full justify-start gap-2 px-3 py-2 bg-gray-50 text-left dark:bg-gray-900/50"
                  >
                    <span className="flex-1 text-[11px] font-medium text-gray-700 dark:text-gray-300">{step.command}</span>
                    <span className={`text-[10px] font-medium ${statusClass(step.status)}`}>{step.status}</span>
                  </Button>
                  {isExpanded && (
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap bg-white px-3 py-2 font-mono text-[11px] text-gray-600 dark:bg-gray-950 dark:text-gray-300">
                      {step.log || 'No log output yet.'}
                    </pre>
                  )}
                </div>
              )
            })}
          </div>

          {verificationFailed && (
            <div className="space-y-2 rounded border border-red-200 bg-red-50/60 p-3 dark:border-red-900 dark:bg-red-950/20">
              <p className="text-[11px] text-red-600 dark:text-red-400">{verificationRun?.error ?? 'Verification failed.'}</p>
              <div className="flex flex-wrap gap-2">
                <RevisePlanControl
                  reportId={report.id}
                  projectId={report.project_id}
                  disabled={fixRunning !== null || runningReportId !== null}
                  running={runningReportId === report.id}
                  onRevise={onReviseInvestigation}
                  planPreview={<PlanPreview report={report} />}
                />
                <button
                  onClick={() => onStartFix(report.id)}
                  disabled={fixRunning !== null}
                  className="text-[11px] px-2 py-1 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {fixRunning === report.id ? 'Generating...' : 'Revise patch'}
                </button>
                <button
                  onClick={() => void onStartVerification(report.id)}
                  disabled={verificationRunning !== null}
                  className="text-[11px] px-2 py-1 rounded-md border border-red-300 text-red-700 hover:bg-red-100 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40 disabled:opacity-50"
                >
                  {verificationRunning === report.id ? 'Verifying...' : 'Re-run verification'}
                </button>
              </div>
            </div>
          )}

          {recoveryRun?.status === 'rolled-back' ? (
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              Change undone. Files restored to their state before this change was applied.
            </p>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded border border-gray-200 p-2 dark:border-gray-700">
              <p className="text-[10px] text-gray-500">
                Restore the affected files to their state before this change was applied.
              </p>
              <Button
                variant="danger"
                onClick={() => void onUndoChange(report.id)}
                disabled={recoveryRunning}
                className="text-[11px] px-2 py-1"
              >
                {recoveryRunning ? 'Undoing...' : 'Undo this change'}
              </Button>
            </div>
          )}
        </PhaseSection>
      )}

      {readyToCommitReached && (
        <PhaseSection
          phaseId="ready-to-commit"
          title={committed ? 'Ready to commit · committed' : 'Ready to commit'}
          collapsed={sectionsCollapsed['ready-to-commit'] ?? false}
          onToggle={onToggleSection}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium text-green-700 dark:text-green-300">Verification passed. Ready for git review.</p>
              {gitPrepare?.status && (
                <p className="mt-0.5 text-[10px] text-gray-500">
                  {gitPrepare.status.branch ?? 'detached'} · {gitPrepare.status.files.length} changed file{gitPrepare.status.files.length === 1 ? '' : 's'}
                  {gitPrepare.status.ahead > 0 ? ` · ahead ${gitPrepare.status.ahead}` : ''}
                </p>
              )}
            </div>
            <button
              onClick={() => void onPrepareGitCommit(report.id)}
              disabled={gitRunning !== null}
              className="text-[11px] px-2 py-1 rounded-md border border-green-300 text-green-700 hover:bg-green-100 dark:border-green-800 dark:text-green-300 dark:hover:bg-green-950/40 disabled:opacity-50"
            >
              {gitRunning === 'prepare' ? 'Checking...' : 'Check git'}
            </button>
          </div>

          {gitPrepare && (
            <div className="space-y-2">
              {gitPrepare.reason && (
                <p className="text-[11px] text-red-600 dark:text-red-400">{gitPrepare.reason}</p>
              )}
              {gitPrepare.authHelp && (
                <p className="text-[11px] text-amber-700 dark:text-amber-300">{gitPrepare.authHelp}</p>
              )}
              <input
                value={gitMessage}
                onChange={(event) => onSetGitMessage(event.target.value)}
                disabled={!gitPrepare.canCommit}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 disabled:opacity-60"
                placeholder="Commit message"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  onClick={() => void onCommitGitFix(report.id)}
                  disabled={!gitPrepare.canCommit || gitRunning !== null}
                  className="text-[11px] px-2 py-1"
                >
                  {gitRunning === 'commit' ? 'Committing...' : 'Commit changes'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void onPushGitFix(report.id)}
                  disabled={gitRunning !== null || !gitPrepare.status.isRepo}
                  className="text-[11px] px-2 py-1"
                >
                  {gitRunning === 'push' ? 'Pushing...' : 'Push'}
                </Button>
              </div>
              {gitPrepare.files.length > 0 && (
                <div className="max-h-24 overflow-auto rounded bg-white px-2 py-1 dark:bg-gray-950">
                  {gitPrepare.files.map((file) => (
                    <p key={file} className="truncate font-mono text-[10px] text-gray-500">{file}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </PhaseSection>
      )}

      {committedReached && (
        <PhaseSection
          phaseId="committed"
          title="Committed"
          collapsed={sectionsCollapsed['committed'] ?? false}
          onToggle={onToggleSection}
        >
          <p className="text-[11px] font-medium text-green-700 dark:text-green-300">
            Changes committed{gitPrepare?.status.branch ? ` to ${gitPrepare.status.branch}` : ''}.
          </p>
          <button
            onClick={() => void onPushGitFix(report.id)}
            disabled={gitRunning !== null || !gitPrepare?.status.isRepo}
            className="text-[11px] px-2 py-1 rounded-md border border-green-300 text-green-700 hover:bg-green-100 dark:border-green-800 dark:text-green-300 dark:hover:bg-green-950/40 disabled:opacity-50"
          >
            {gitRunning === 'push' ? 'Pushing...' : 'Push'}
          </button>
        </PhaseSection>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Phase progress bar
// ---------------------------------------------------------------------------

const CODE_CHANGE_PHASE_ORDER = [
  'draft', 'investigating', 'patch-ready', 'applied', 'verifying', 'ready-to-commit', 'committed',
] as const

function CodeChangePhaseBar({
  phase,
}: {
  phase: ReturnType<typeof deriveCodeChangePhase>
}) {
  const currentIndex = phase === 'needs-attention'
    ? CODE_CHANGE_PHASE_ORDER.indexOf('verifying')
    : Math.max(0, CODE_CHANGE_PHASE_ORDER.indexOf(phase as (typeof CODE_CHANGE_PHASE_ORDER)[number]))
  const steps = CODE_CHANGE_PHASE_ORDER.map((id) => ({ id, label: CODE_CHANGE_PHASE_LABELS[id] }))

  return (
    <PhaseBar
      steps={steps}
      currentIndex={currentIndex}
      failedId={phase === 'needs-attention' ? 'verifying' : undefined}
    />
  )
}

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------

type CodeChangesView =
  | { mode: 'list' }
  | { mode: 'new-request' }
  | { mode: 'detail'; reportId: string }
  | { mode: 'history' }

interface CodeChangesScreenProps {
  projectId: string
  projectConfig: ProjectConfig
  onOpenGeneralSettings: () => void
}

export function CodeChangesScreen({ projectId, projectConfig, onOpenGeneralSettings }: CodeChangesScreenProps) {
  const pendingRemoteEditReportId = useAppStore((s) => s.pendingRemoteEditReportId)
  const setPendingRemoteEditReportId = useAppStore((s) => s.setPendingRemoteEditReportId)
  const pendingNewRequestDraft = useAppStore((s) => s.pendingNewRequestDraft)
  const setPendingNewRequestDraft = useAppStore((s) => s.setPendingNewRequestDraft)
  const catalogModels = useAppStore((s) => s.catalogModels)
  const addToast = useAppStore((s) => s.addToast)

  const [reports, setReports] = useState<ErrorReportEntry[]>([])
  const [investigationSettings, setInvestigationSettings] = useState<RemoteEditInvestigationSettings>({
    backend: 'byok',
    model: 'gpt-5-mini',
    retryLimit: 1,
    autoApproveTools: true,
  })
  const [availableModelGroups, setAvailableModelGroups] = useState<AvailableModelGroup[]>([])
  const [investigationOutput, setInvestigationOutput] = useState<Record<string, string>>({})
  const [investigationActivity, setInvestigationActivity] = useState<Record<string, RemoteEditInvestigationActivity[]>>({})
  const [runningReportId, setRunningReportId] = useState<string | null>(null)
  const [investigationStatus, setInvestigationStatus] = useState<string | null>(null)
  const [fixRunning, setFixRunning] = useState<string | null>(null)
  const [fixStatus, setFixStatus] = useState<string | null>(null)
  const [stagedDiffs, setStagedDiffs] = useState<Record<string, RemoteEditStagedFileDiff | null>>({})
  const [reviewedFiles, setReviewedFiles] = useState<Record<string, boolean>>({})
  const [committingFix, setCommittingFix] = useState(false)
  const [expandedDiffFile, setExpandedDiffFile] = useState<string | null>(null)
  const [verificationRuns, setVerificationRuns] = useState<Record<string, RemoteEditVerificationRun[]>>({})
  const [verificationRunning, setVerificationRunning] = useState<string | null>(null)
  const [expandedVerifyCommand, setExpandedVerifyCommand] = useState<string | null>(null)
  const [gitPrepare, setGitPrepare] = useState<Record<string, RemoteEditGitPrepareResult | null>>({})
  const [gitMessage, setGitMessage] = useState<Record<string, string>>({})
  const [gitRunning, setGitRunning] = useState<string | null>(null)
  const [recoveryRuns, setRecoveryRuns] = useState<Record<string, RemoteEditRecoveryRun[]>>({})
  const [recoveryRunning, setRecoveryRunning] = useState<string | null>(null)
  const [remoteEditHistory, setRemoteEditHistory] = useState<RemoteEditHistoryEntry[]>([])
  const [investigationStepCollapsed, setInvestigationStepCollapsed] = useState(false)
  const [phaseSectionsCollapsed, setPhaseSectionsCollapsed] = useState<Record<string, boolean>>({})
  const [reportsRefreshing, setReportsRefreshing] = useState(false)
  const [historyRefreshing, setHistoryRefreshing] = useState(false)
  const [reviewAction, setReviewAction] = useState<'accept' | 'reject' | 'revise' | null>(null)
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null)
  const [pendingDeleteReport, setPendingDeleteReport] = useState<ErrorReportEntry | null>(null)
  const [newRequestTitle, setNewRequestTitle] = useState('')
  const [newRequestDescription, setNewRequestDescription] = useState('')
  const [creatingRequest, setCreatingRequest] = useState(false)
  const [newRequestType, setNewRequestType] = useState<CodeChangeRequestType>('edit')
  const [newRequestCustomTypeLabel, setNewRequestCustomTypeLabel] = useState('')
  const [newRequestOrigin, setNewRequestOrigin] = useState<'manual' | 'chat'>('manual')
  const [newRequestConversationTitle, setNewRequestConversationTitle] = useState<string | null>(null)
  const [view, setView] = useState<CodeChangesView>({ mode: 'list' })

  const rootDirectory = projectConfig.rootDirectory?.trim() ?? ''
  const hasRootDirectory = rootDirectory.length > 0
  const workspaceExists = projectConfig.workspaceInfo?.exists ?? true
  const workspaceBinding = {
    rootDirectory,
    isGitRepo: projectConfig.workspaceInfo?.isGitRepo ?? false,
    repoRoot: projectConfig.workspaceInfo?.isGitRepo ? rootDirectory : null,
    branch: projectConfig.workspaceInfo?.branch ?? null,
    dirty: projectConfig.workspaceInfo?.dirty ?? false,
    isConnected: hasRootDirectory && workspaceExists,
    lastValidatedAt: projectConfig.workspaceInfo ? Date.now() : null,
  }

  const selectedReportId = view.mode === 'detail' ? view.reportId : null
  const selectedReport = reports.find((report) => report.id === selectedReportId) ?? null
  const selectedRequest = selectedReport
    ? toCodeChangeRequest(selectedReport, {
        projectId,
        workspaceRoot: workspaceBinding.rootDirectory || null,
      })
    : null
  const selectedPhase = selectedReport
    ? deriveCodeChangePhase(
        selectedReport,
        verificationRuns[selectedReport.id]?.[0] ?? null,
        gitPrepare[selectedReport.id]?.canCommit === false,
      )
    : null
  const remoteEditModelGroups = availableModelGroups.filter((group) => {
    if (investigationSettings.backend === 'claude-cli') return group.sourceKey === 'claude-cli'
    if (investigationSettings.backend === 'codex-cli') return group.sourceKey === 'codex-cli'
    return group.sourceType === 'provider'
  })
  const selectedModelSourceLabel = remoteEditModelGroups.find((group) =>
    group.models.some((model) => model.id === investigationSettings.model)
  )?.sourceLabel
  const isReportBusy = (reportId: string): boolean => (
    runningReportId === reportId ||
    fixRunning === reportId ||
    verificationRunning === reportId ||
    recoveryRunning === reportId ||
    deletingReportId === reportId ||
    committingFix ||
    gitRunning !== null
  )

  const hasBackendGroup = (backend: RemoteEditBackend) => availableModelGroups.some((group) => group.sourceKey === backend)
  const backendOptions: Array<{ value: RemoteEditBackend; label: string }> = [
    { value: 'byok', label: 'BYOK' },
    ...(hasBackendGroup('claude-cli') || investigationSettings.backend === 'claude-cli'
      ? [{ value: 'claude-cli' as const, label: 'Claude CLI' }]
      : []),
    ...(hasBackendGroup('codex-cli') || investigationSettings.backend === 'codex-cli'
      ? [{ value: 'codex-cli' as const, label: 'Codex CLI' }]
      : []),
  ]

  const loadReports = async (selectedIdOverride?: string | null) => {
    if (typeof window.api.listErrorReports !== 'function') return
    const nextReports = await window.api.listErrorReports(25, projectId)
    setReports(nextReports)
    if (pendingRemoteEditReportId && nextReports.some((report) => report.id === pendingRemoteEditReportId)) {
      setView({ mode: 'detail', reportId: pendingRemoteEditReportId })
      setPendingRemoteEditReportId(null)
    } else if (selectedIdOverride) {
      setView({ mode: 'detail', reportId: selectedIdOverride })
    } else if (selectedIdOverride === null) {
      setView({ mode: 'list' })
    }
  }

  const loadRemoteEditHistory = async () => {
    if (typeof window.api.getRemoteEditHistory !== 'function') return
    const entries = await window.api.getRemoteEditHistory()
    setRemoteEditHistory(entries)
  }

  const handleRefreshReports = async () => {
    setReportsRefreshing(true)
    setInvestigationStatus('Refreshing change requests...')
    try {
      await loadReports()
      setInvestigationStatus('Change requests refreshed')
    } catch (error) {
      setInvestigationStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setReportsRefreshing(false)
    }
  }

  const handleRefreshHistory = async () => {
    setHistoryRefreshing(true)
    setInvestigationStatus('Refreshing history...')
    try {
      await loadRemoteEditHistory()
      setInvestigationStatus('History refreshed')
    } catch (error) {
      setInvestigationStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setHistoryRefreshing(false)
    }
  }

  const loadAvailableModels = async () => {
    if (typeof window.api.listAvailableModels !== 'function') return
    const groups = await window.api.listAvailableModels().catch(() => [])
    setAvailableModelGroups(groups)
  }

  const handleSetBackend = (backend: RemoteEditBackend) => {
    setInvestigationSettings((settings) => {
      const nextGroups = availableModelGroups.filter((group) => {
        if (backend === 'claude-cli') return group.sourceKey === 'claude-cli'
        if (backend === 'codex-cli') return group.sourceKey === 'codex-cli'
        return group.sourceType === 'provider'
      })
      const modelStillAvailable = nextGroups.some((group) => group.models.some((model) => model.id === settings.model))
      return {
        ...settings,
        backend,
        model: modelStillAvailable ? settings.model : (nextGroups[0]?.models[0]?.id ?? settings.model),
      }
    })
  }

  const handleSelectRemoteEditModel = (_group: AvailableModelGroup, model: AvailableModelEntry) => {
    setInvestigationSettings((settings) => ({ ...settings, model: model.id }))
  }

  // Unlike the picker in "Planning settings" (which is backend-filtered because the user picks a
  // backend first via a separate dropdown), this picker has no companion backend selector, so it
  // shows every available group — CLI and BYOK provider alike — and switches the backend to match
  // whichever group the picked model came from.
  const handleSelectReviseModel = (group: AvailableModelGroup, model: AvailableModelEntry) => {
    setInvestigationSettings((settings) => ({
      ...settings,
      model: model.id,
      backend: group.sourceType === 'cli' ? (group.sourceKey as RemoteEditBackend) : 'byok',
    }))
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

  const loadVerificationRuns = async (reportId: string) => {
    if (typeof window.api.getVerificationRuns !== 'function') return
    const runs = await window.api.getVerificationRuns(reportId)
    setVerificationRuns((prev) => ({ ...prev, [reportId]: runs }))
  }

  const loadRecoveryRuns = async (reportId: string) => {
    if (typeof window.api.getRemoteEditRecoveryRuns !== 'function') return
    const runs = await window.api.getRemoteEditRecoveryRuns(reportId)
    setRecoveryRuns((prev) => ({ ...prev, [reportId]: runs }))
  }

  const handleCreateRequest = async () => {
    if (!workspaceBinding.isConnected || !newRequestTitle.trim()) return
    if (newRequestType === 'custom' && !newRequestCustomTypeLabel.trim()) return
    setCreatingRequest(true)
    try {
      const result = await window.api.captureErrorReport({
        title: newRequestTitle.trim(),
        description: newRequestDescription.trim(),
        includeLog: false,
        includeScreenshot: false,
        requestType: newRequestType,
        customTypeLabel: newRequestType === 'custom' ? newRequestCustomTypeLabel.trim() : null,
        origin: newRequestOrigin,
        workspaceRoot: workspaceBinding.rootDirectory,
        projectId,
      })
      setNewRequestTitle('')
      setNewRequestDescription('')
      setNewRequestCustomTypeLabel('')
      setNewRequestOrigin('manual')
      setNewRequestConversationTitle(null)
      await loadReports(result.reportId)
      setInvestigationStatus('Change request created')
    } finally {
      setCreatingRequest(false)
    }
  }

  useEffect(() => {
    if (
      typeof window.api.listErrorReports !== 'function' ||
      typeof window.api.getInvestigationSettings !== 'function'
    ) {
      return
    }
    void loadReports()
    void loadRemoteEditHistory()
    void loadAvailableModels()
    window.api.getInvestigationSettings().then(setInvestigationSettings).catch(() => {})

  }, [projectId, pendingRemoteEditReportId])

  useEffect(() => {
    if (view.mode !== 'list') return
    if (typeof window.api.listErrorReports !== 'function') return
    const interval = setInterval(() => {
      window.api.listErrorReports(25, projectId).then(setReports).catch(() => {})
    }, 4000)
    return () => clearInterval(interval)
  }, [projectId, view.mode])

  useEffect(() => {
    if (!pendingNewRequestDraft) return
    setNewRequestTitle(pendingNewRequestDraft.title)
    setNewRequestDescription(pendingNewRequestDraft.description)
    setNewRequestType(pendingNewRequestDraft.requestType)
    setNewRequestCustomTypeLabel(pendingNewRequestDraft.customTypeLabel)
    setNewRequestOrigin('chat')
    setNewRequestConversationTitle(pendingNewRequestDraft.conversationTitle)
    setView({ mode: 'new-request' })
    setPendingNewRequestDraft(null)
  }, [pendingNewRequestDraft, setPendingNewRequestDraft])

  useEffect(() => {
    if (
      typeof window.api.onInvestigationActivity !== 'function' ||
      typeof window.api.onInvestigationChunk !== 'function' ||
      typeof window.api.onInvestigationDone !== 'function'
    ) {
      return
    }
    const offActivity = window.api.onInvestigationActivity((activity) => {
      setInvestigationActivity((prev) => ({
        ...prev,
        [activity.reportId]: [...(prev[activity.reportId] ?? []).slice(-49), activity],
      }))
    })
    const offChunk = window.api.onInvestigationChunk(({ reportId, chunk }) => {
      setInvestigationOutput((prev) => ({
        ...prev,
        [reportId]: `${prev[reportId] ?? ''}${chunk}`,
      }))
    })
    const offDone = window.api.onInvestigationDone((result) => {
      setRunningReportId(null)
      setReviewAction(null)
      setInvestigationStatus(result.status === 'done' ? 'Planning complete' : result.error ?? 'Planning failed')
      setInvestigationOutput((prev) => { const next = { ...prev }; delete next[result.reportId]; return next })
      void loadReports()
    })
    return () => {
      offActivity()
      offChunk()
      offDone()
    }

  }, [])

  useEffect(() => {
    if (!selectedReportId || typeof window.api.getActiveInvestigation !== 'function') return
    let cancelled = false
    window.api.getActiveInvestigation(selectedReportId).then((progress) => {
      if (cancelled || !progress) return
      // Only rehydrate when the backend confirms the run is still active — otherwise leave local
      // state alone so a just-finished run's onInvestigationDone handler (or the persisted report
      // from loadReports()) remains the source of truth instead of being overwritten with stale data.
      if (!progress.running) return
      setRunningReportId(selectedReportId)
      setInvestigationActivity((prev) => ({ ...prev, [selectedReportId]: progress.activity }))
      setInvestigationOutput((prev) => ({ ...prev, [selectedReportId]: progress.output }))
      setInvestigationStatus('Planning in progress')
    }).catch(() => {})
    return () => { cancelled = true }
  }, [selectedReportId])

  useEffect(() => {
    if (
      typeof window.api.onFixEvent !== 'function' ||
      typeof window.api.onFixDone !== 'function'
    ) {
      return
    }
    const offEvent = window.api.onFixEvent((event: RemoteEditFixEvent) => {
      setFixStatus(event.label)
    })
    const offDone = window.api.onFixDone((result: RemoteEditFixDone) => {
      setFixRunning(null)
      setFixStatus(result.status === 'done' ? 'Staged patch ready' : result.error ?? 'Patch generation failed')
      void loadReports()
    })
    return () => {
      offEvent()
      offDone()
    }

  }, [])

  useEffect(() => {
    if (selectedReport?.id) {
      void loadVerificationRuns(selectedReport.id)
      void loadRecoveryRuns(selectedReport.id)
      setInvestigationStepCollapsed(false)
      setPhaseSectionsCollapsed({})
    }
  }, [selectedReport?.id])

  useEffect(() => {
    if (
      typeof window.api.onVerificationEvent !== 'function' ||
      typeof window.api.onVerificationDone !== 'function'
    ) {
      return
    }
    const offEvent = window.api.onVerificationEvent((event: RemoteEditVerificationEvent) => {
      setVerificationRunning(event.status === 'running' ? event.reportId : null)
      setVerificationRuns((prev) => {
        const runs = prev[event.reportId] ?? []
        const nextRuns = [...runs]
        const index = nextRuns.findIndex((run) => run.id === event.runId)
        const existingRun = index === -1
          ? {
              id: event.runId,
              reportId: event.reportId,
              status: 'running' as const,
              steps: ['typecheck', 'lint', 'test', 'build'].map((command) => ({
                command: command as RemoteEditVerificationStep['command'],
                status: 'pending' as const,
                exitCode: null,
                log: '',
                startedAt: null,
                completedAt: null,
              })),
              startedAt: Date.now(),
              completedAt: null,
              retryCount: 0,
            }
          : nextRuns[index]
        const run = { ...existingRun, status: event.status === 'running' ? 'running' as const : existingRun.status }
        if (event.command) {
          run.steps = run.steps.map((step) => {
            if (step.command !== event.command) return step
            return {
              ...step,
              status: event.status === 'running' || event.status === 'success' || event.status === 'failed'
                ? event.status
                : step.status,
              exitCode: event.exitCode ?? step.exitCode,
              log: event.line ? `${step.log}${event.line}` : step.log,
            }
          })
        }
        if (index === -1) {
          nextRuns.unshift(run)
        } else {
          nextRuns[index] = run
        }
        return { ...prev, [event.reportId]: nextRuns }
      })
    })
    const offDone = window.api.onVerificationDone((result: RemoteEditVerificationDone) => {
      setVerificationRunning(null)
      setVerificationRuns((prev) => {
        const runs = prev[result.reportId] ?? []
        const run: RemoteEditVerificationRun = {
          id: result.runId,
          reportId: result.reportId,
          status: result.status,
          steps: result.steps,
          startedAt: Date.now(),
          completedAt: result.completedAt,
          retryCount: result.retryCount,
          error: result.error,
        }
        const nextRuns = [run, ...runs.filter((existing) => existing.id !== result.runId)].slice(0, 10)
        return { ...prev, [result.reportId]: nextRuns }
      })
    })
    return () => {
      offEvent()
      offDone()
    }
  }, [])

  useEffect(() => {
    if (typeof window.api.onRemoteEditGitEvent !== 'function') return
    const off = window.api.onRemoteEditGitEvent((event: RemoteEditGitEvent) => {
      if (event.type === 'commit' || event.type === 'push') {
        setGitRunning(null)
      }
      if (event.status) {
        setGitPrepare((prev) => {
          const existing = prev[event.reportId]
          if (!existing) return prev
          return {
            ...prev,
            [event.reportId]: {
              ...existing,
              status: event.status!,
              canCommit: event.type === 'commit' && !event.error ? false : existing.canCommit,
              reason: event.error ?? existing.reason,
              authRequired: event.authRequired ?? existing.authRequired,
              authHelp: event.authHelp ?? existing.authHelp,
            },
          }
        })
      }
    })
    return off
  }, [])

  useEffect(() => {
    if (typeof window.api.onRemoteEditRecoveryEvent !== 'function') return
    const off = window.api.onRemoteEditRecoveryEvent((event: RemoteEditRecoveryEvent) => {
      if (event.type === 'prepare') {
        setRecoveryRunning(null)
        void loadRecoveryRuns(event.reportId)
      }
      if (event.type === 'reload') {
        void loadRecoveryRuns(event.reportId)
      }
    })
    return off
  }, [])

  const handleStartFix = async (reportId: string) => {
    setFixRunning(reportId)
    setFixStatus('Generating staged patch...')
    setStagedDiffs({})
    setReviewedFiles({})
    setExpandedDiffFile(null)
    try {
      await persistInvestigationSettings()
      await window.api.startFix(reportId)
    } catch (error) {
      setFixRunning(null)
      setFixStatus(error instanceof Error ? error.message : String(error))
    }
  }

  const handleLoadDiff = async (reportId: string, relativePath: string) => {
    const diff = await window.api.getStagedDiff(reportId, relativePath)
    setStagedDiffs((prev) => ({ ...prev, [relativePath]: diff ?? null }))
    setExpandedDiffFile(relativePath)
  }

  const handleRevertFile = async (reportId: string, relativePath: string) => {
    await window.api.revertStagedFile(reportId, relativePath)
    setStagedDiffs((prev) => { const next = { ...prev }; delete next[relativePath]; return next })
    setReviewedFiles((prev) => { const next = { ...prev }; delete next[relativePath]; return next })
    if (expandedDiffFile === relativePath) setExpandedDiffFile(null)
    void loadReports()
  }

  const handleMarkReviewed = (relativePath: string) => {
    setReviewedFiles((prev) => ({ ...prev, [relativePath]: true }))
    setExpandedDiffFile(null)
  }

  const handleCommitFix = async (reportId: string) => {
    setCommittingFix(true)
    setFixStatus('Applying to workspace...')
    await window.api.commitFixToWorkspace(reportId)
    setCommittingFix(false)
    void loadReports()
  }

  const handleStartVerification = async (reportId: string) => {
    setVerificationRunning(reportId)
    setExpandedVerifyCommand(null)
    let runId: string
    try {
      await persistInvestigationSettings()
      ;({ runId } = await window.api.startVerification(reportId))
    } catch {
      setVerificationRunning(null)
      return
    }
    setVerificationRuns((prev) => ({
      ...prev,
      [reportId]: [
        {
          id: runId,
          reportId,
          status: 'running',
          steps: ['typecheck', 'lint', 'test', 'build'].map((command) => ({
            command: command as RemoteEditVerificationStep['command'],
            status: 'pending' as const,
            exitCode: null,
            log: '',
            startedAt: null,
            completedAt: null,
          })),
          startedAt: Date.now(),
          completedAt: null,
          retryCount: 0,
        },
        ...(prev[reportId] ?? []).filter((run) => run.id !== runId),
      ],
    }))
  }

  const handlePrepareGitCommit = async (reportId: string) => {
    setGitRunning('prepare')
    const result = await window.api.prepareRemoteEditCommit(reportId)
    setGitPrepare((prev) => ({ ...prev, [reportId]: result }))
    setGitMessage((prev) => ({ ...prev, [reportId]: prev[reportId] ?? result.suggestedMessage }))
    setGitRunning(null)
  }

  const handleCommitGitFix = async (reportId: string) => {
    setGitRunning('commit')
    const result = await window.api.commitRemoteEditFix(reportId, gitMessage[reportId] ?? '')
    setGitPrepare((prev) => ({
      ...prev,
      [reportId]: prev[reportId]
        ? {
            ...prev[reportId]!,
            status: result.status,
            canCommit: !result.committed,
            reason: result.error,
            authRequired: result.authRequired,
            authHelp: result.authHelp,
          }
        : null,
    }))
    setGitRunning(null)
  }

  const handlePushGitFix = async (reportId: string) => {
    setGitRunning('push')
    const result = await window.api.pushRemoteEditFix(reportId)
    setGitPrepare((prev) => ({
      ...prev,
      [reportId]: prev[reportId]
        ? {
            ...prev[reportId]!,
            status: result.status,
            reason: result.error,
            authRequired: result.authRequired,
            authHelp: result.authHelp,
          }
        : null,
    }))
    setGitRunning(null)
  }

  const handleRollbackHeal = async (recoveryId: string) => {
    await window.api.rollbackRemoteEdit(recoveryId)
    void loadReports()
    void loadRemoteEditHistory()
  }

  const handleUndoChange = async (reportId: string) => {
    setRecoveryRunning(reportId)
    try {
      let recoveryId = recoveryRuns[reportId]?.[0]?.id
      if (!recoveryId) {
        const prepared = await window.api.prepareRemoteEditReload(reportId)
        if (prepared.recovery) {
          recoveryId = prepared.recovery.id
          setRecoveryRuns((prev) => ({
            ...prev,
            [reportId]: [prepared.recovery!, ...(prev[reportId] ?? []).filter((run) => run.id !== prepared.recovery!.id)].slice(0, 10),
          }))
        }
      }
      if (!recoveryId) {
        addToast('Nothing to undo for this change.', 'error')
        return
      }
      await handleRollbackHeal(recoveryId)
    } finally {
      setRecoveryRunning(null)
    }
  }

  const persistInvestigationSettings = async () => {
    const saved = await window.api.setInvestigationSettings(investigationSettings)
    setInvestigationSettings(saved)
    return saved
  }

  const handleSaveInvestigationSettings = async () => {
    await persistInvestigationSettings()
    setInvestigationStatus('Planning settings saved')
  }

  const handleStartInvestigation = async (reportId: string, action?: 'revise', revisionNotes?: string) => {
    setRunningReportId(reportId)
    setReviewAction(action ?? null)
    setInvestigationStatus('Planning started')
    setInvestigationOutput((prev) => ({ ...prev, [reportId]: '' }))
    setInvestigationActivity((prev) => ({ ...prev, [reportId]: [] }))
    if (action === 'revise') setInvestigationStepCollapsed(false)
    try {
      await persistInvestigationSettings()
      await window.api.startInvestigation(reportId, revisionNotes)
    } catch (error) {
      setRunningReportId(null)
      setReviewAction(null)
      setInvestigationStatus(error instanceof Error ? error.message : String(error))
    }
  }

  const handleReviewInvestigation = async (reportId: string, status: 'investigated' | 'rejected') => {
    const action = status === 'investigated' ? 'accept' : 'reject'
    setReviewAction(action)
    setInvestigationStatus(status === 'investigated' ? 'Accepting plan...' : 'Rejecting plan...')
    try {
      await window.api.setRemoteEditReportStatus(reportId, status)
      const message = status === 'investigated' ? 'Plan accepted' : 'Plan rejected'
      setInvestigationStatus(message)
      addToast(message, 'success')
      await loadReports()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setInvestigationStatus(message)
      addToast(message, 'error')
    } finally {
      setReviewAction(null)
    }
  }

  const handleDeleteReport = async (reportId: string) => {
    if (typeof window.api.deleteErrorReport !== 'function') return
    setDeletingReportId(reportId)
    setInvestigationStatus('Deleting change request...')
    try {
      const result = await window.api.deleteErrorReport(reportId)
      if (isApiError(result)) {
        setInvestigationStatus(result.error)
        addToast(result.error, 'error')
        return
      }
      if (!result) {
        setInvestigationStatus('Report was already deleted')
        addToast('Report was already deleted', 'error')
        await loadReports(null)
        return
      }
      setInvestigationOutput((prev) => { const next = { ...prev }; delete next[reportId]; return next })
      setInvestigationActivity((prev) => { const next = { ...prev }; delete next[reportId]; return next })
      setVerificationRuns((prev) => { const next = { ...prev }; delete next[reportId]; return next })
      setRecoveryRuns((prev) => { const next = { ...prev }; delete next[reportId]; return next })
      setGitPrepare((prev) => { const next = { ...prev }; delete next[reportId]; return next })
      setGitMessage((prev) => { const next = { ...prev }; delete next[reportId]; return next })
      setInvestigationStatus('Change request deleted')
      addToast('Change request deleted', 'success')
      setPendingDeleteReport(null)
      await loadReports(null)
      await loadRemoteEditHistory()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setInvestigationStatus(message)
      addToast(message, 'error')
    } finally {
      setDeletingReportId(null)
    }
  }

  const selectedReportBusy = Boolean(selectedReport && (
    isReportBusy(selectedReport.id)
  ))

  if (!hasRootDirectory) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center space-y-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Set a root directory in General to enable Code Changes for this project.
        </p>
        <Button variant="secondary" onClick={onOpenGeneralSettings} className="mx-auto">
          Go to General
        </Button>
      </div>
    )
  }

  const backToListButton = (
    <Button variant="ghost" onClick={() => setView({ mode: 'list' })} className="text-[11px] px-2 py-1">
      ← Code Changes
    </Button>
  )

  const workspaceMissingBanner = !workspaceExists && (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/20">
      <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300">Workspace directory not found on disk</p>
      <p className="mt-0.5 truncate font-mono text-[11px] text-amber-700/80 dark:text-amber-300/80">{rootDirectory}</p>
      <p className="mt-1 text-[10px] text-amber-700/80 dark:text-amber-300/80">
        Existing requests can still be viewed, but new requests are disabled until this path exists.
      </p>
    </div>
  )

  const closeModal = () => {
    setView({ mode: 'list' })
    setNewRequestOrigin('manual')
    setNewRequestConversationTitle(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-200">
            {view.mode === 'history' ? 'History' : 'Code Changes'}
          </h3>
          <p className="text-[10px] text-gray-500 dark:text-gray-400">
            {view.mode === 'history'
              ? 'Audit trail of investigations, patches, verification, and git actions.'
              : 'Create and track change requests for this project.'}
          </p>
        </div>
        {view.mode === 'history' && backToListButton}
      </div>

      {workspaceMissingBanner}

      {view.mode !== 'history' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="primary"
              onClick={() => setView({ mode: 'new-request' })}
              disabled={!workspaceBinding.isConnected}
            >
              New request
            </Button>
            <div className="flex items-center gap-2">
              {investigationStatus && (
                <p className="text-[11px] text-blue-600 dark:text-blue-300">{investigationStatus}</p>
              )}
              <Button
                variant="secondary"
                onClick={() => void handleRefreshReports()}
                disabled={reportsRefreshing}
                className="text-[11px] px-2 py-1"
              >
                {reportsRefreshing ? 'Refreshing...' : 'Refresh'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setView({ mode: 'history' })}
                className="text-[11px] px-2 py-1"
              >
                History
              </Button>
            </div>
          </div>

          <CodeChangeListView
            reports={reports}
            selectedReportId={null}
            workspaceRoot={workspaceBinding.rootDirectory || null}
            verificationRuns={verificationRuns}
            gitPrepare={gitPrepare}
            isReportBusy={isReportBusy}
            onSelectReport={(reportId) => setView({ mode: 'detail', reportId })}
            onRequestDelete={setPendingDeleteReport}
          />
        </div>
      )}

      {view.mode === 'history' && (
        <CodeChangeHistorySection
          history={remoteEditHistory}
          refreshing={historyRefreshing}
          onRefresh={() => void handleRefreshHistory()}
        />
      )}

      {view.mode === 'new-request' && (
        <ModalShell title="New request" description="Describe the outcome you want." maxWidth="max-w-2xl" height="h-auto max-h-[84vh]" onClose={closeModal}>
          <CodeChangeNewRequestForm
            onClose={closeModal}
            requestType={newRequestType}
            onSetRequestType={setNewRequestType}
            customTypeLabel={newRequestCustomTypeLabel}
            onSetCustomTypeLabel={setNewRequestCustomTypeLabel}
            title={newRequestTitle}
            onSetTitle={setNewRequestTitle}
            description={newRequestDescription}
            onSetDescription={setNewRequestDescription}
            isWorkspaceConnected={workspaceBinding.isConnected}
            creating={creatingRequest}
            onCreate={() => void handleCreateRequest()}
            fromChatConversationTitle={newRequestOrigin === 'chat' ? newRequestConversationTitle : null}
          />
        </ModalShell>
      )}

      {view.mode === 'detail' && selectedReport && (
        <ModalShell title={selectedRequest?.title ?? 'Code Changes'} maxWidth="max-w-6xl" onClose={closeModal}>
          <CodeChangeDetailView
            report={selectedReport}
            request={selectedRequest}
            phase={selectedPhase}
            phaseBar={selectedPhase && <CodeChangePhaseBar phase={selectedPhase} />}
            runningReportId={runningReportId}
            onStartInvestigation={() => void handleStartInvestigation(selectedReport.id)}
            isWorkspaceConnected={workspaceBinding.isConnected}
            currentWorkspaceRoot={workspaceBinding.rootDirectory || null}
            onRequestDelete={() => setPendingDeleteReport(selectedReport)}
            reportBusy={selectedReportBusy}
            deleting={deletingReportId === selectedReport.id}
            investigationActivity={investigationActivity[selectedReport.id] ?? []}
            investigationOutput={investigationOutput[selectedReport.id]}
            reviewAction={reviewAction}
            investigationStatus={investigationStatus}
            onAcceptInvestigation={() => void handleReviewInvestigation(selectedReport.id, 'investigated')}
            onRejectInvestigation={() => void handleReviewInvestigation(selectedReport.id, 'rejected')}
            onReviseInvestigation={(notes) => void handleStartInvestigation(selectedReport.id, 'revise', notes)}
            onGeneratePatch={() => void handleStartFix(selectedReport.id)}
            fixRunning={fixRunning}
            investigationSettings={investigationSettings}
            onSetInvestigationSettings={setInvestigationSettings}
            onSetBackend={handleSetBackend}
            backendOptions={backendOptions}
            remoteEditModelGroups={remoteEditModelGroups}
            selectedModelSourceLabel={selectedModelSourceLabel}
            catalogModels={catalogModels}
            onSelectRemoteEditModel={handleSelectRemoteEditModel}
            onSaveInvestigationSettings={() => void handleSaveInvestigationSettings()}
            investigationStepCollapsed={investigationStepCollapsed}
            onToggleInvestigationStepCollapsed={() => setInvestigationStepCollapsed((collapsed) => !collapsed)}
            reviseModelPicker={reviseModelPicker}
            diffViewer={(
              <RemoteEditDiffViewer
                report={selectedReport}
                fixRunning={fixRunning}
                fixStatus={fixStatus}
                runningReportId={runningReportId}
                onReviseInvestigation={(reportId, notes) => void handleStartInvestigation(reportId, 'revise', notes)}
                reviseModelPicker={reviseModelPicker}
                verificationRun={verificationRuns[selectedReport.id]?.[0] ?? null}
                verificationRunning={verificationRunning}
                expandedVerifyCommand={expandedVerifyCommand}
                gitPrepare={gitPrepare[selectedReport.id] ?? null}
                gitMessage={gitMessage[selectedReport.id] ?? ''}
                gitRunning={gitRunning}
                recoveryRun={recoveryRuns[selectedReport.id]?.[0] ?? null}
                recoveryRunning={recoveryRunning === selectedReport.id}
                stagedDiffs={stagedDiffs}
                reviewedFiles={reviewedFiles}
                expandedDiffFile={expandedDiffFile}
                committingFix={committingFix}
                onStartFix={handleStartFix}
                onStartVerification={handleStartVerification}
                onExpandVerifyCommand={setExpandedVerifyCommand}
                onPrepareGitCommit={handlePrepareGitCommit}
                onCommitGitFix={handleCommitGitFix}
                onPushGitFix={handlePushGitFix}
                onSetGitMessage={(message) => setGitMessage((prev) => ({ ...prev, [selectedReport.id]: message }))}
                onUndoChange={handleUndoChange}
                onLoadDiff={handleLoadDiff}
                onRevertFile={handleRevertFile}
                onMarkReviewed={handleMarkReviewed}
                onCommitFix={handleCommitFix}
                onExpandDiff={setExpandedDiffFile}
                sectionsCollapsed={phaseSectionsCollapsed}
                onToggleSection={(phaseId) => setPhaseSectionsCollapsed((prev) => ({ ...prev, [phaseId]: !prev[phaseId] }))}
              />
            )}
          />
        </ModalShell>
      )}

      {pendingDeleteReport && (
        <DeleteRemoteEditReportDialog
          reportTitle={pendingDeleteReport.title}
          deleting={deletingReportId === pendingDeleteReport.id}
          onConfirm={() => void handleDeleteReport(pendingDeleteReport.id)}
          onCancel={() => setPendingDeleteReport(null)}
        />
      )}
    </div>
  )
}
