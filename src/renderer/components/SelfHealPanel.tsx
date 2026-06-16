import { useEffect, useState } from 'react'
import { Trash2, Wrench } from 'lucide-react'
import type {
  AvailableModelEntry,
  AvailableModelGroup,
  ErrorReportEntry,
  SelfHealBackend,
  SelfHealFixDone,
  SelfHealFixEvent,
  SelfHealGitEvent,
  SelfHealGitPrepareResult,
  SelfHealHistoryEntry,
  SelfHealInvestigationActivity,
  SelfHealInvestigationSettings,
  SelfHealRecoveryEvent,
  SelfHealRecoveryRun,
  SelfHealStagedFileDiff,
  SelfHealStagedFileEntry,
  SelfHealVerificationDone,
  SelfHealVerificationEvent,
  SelfHealVerificationRun,
  SelfHealVerificationStep,
} from '@shared/types'
import { useAppStore } from '../store/app-store'
import { Button, ModalShell, PhaseBar } from './ui/primitives'
import { ModelPicker } from './chat/ModelPicker'
import { DeleteSelfHealReportDialog } from './DeleteSelfHealReportDialog'

// ---------------------------------------------------------------------------
// Self-Heal Diff Viewer sub-component
// ---------------------------------------------------------------------------

interface DiffViewerProps {
  report: ErrorReportEntry
  fixRunning: string | null
  fixStatus: string | null
  verificationRun: SelfHealVerificationRun | null
  verificationRunning: string | null
  expandedVerifyCommand: string | null
  gitPrepare: SelfHealGitPrepareResult | null
  gitMessage: string
  gitRunning: string | null
  recoveryRun: SelfHealRecoveryRun | null
  recoveryRunning: boolean
  reloadRunning: boolean
  stagedDiffs: Record<string, SelfHealStagedFileDiff | null>
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
  onPrepareReload: (reportId: string) => void
  onStartReload: (recoveryId: string) => void
  onApproveRelaunch: (recoveryId: string) => void
  onRollbackHeal: (recoveryId: string) => void
  onLoadDiff: (reportId: string, relativePath: string) => void
  onRevertFile: (reportId: string, relativePath: string) => void
  onMarkReviewed: (relativePath: string) => void
  onCommitFix: (reportId: string) => void
  onExpandDiff: (relativePath: string | null) => void
}

function SelfHealDiffViewer({
  report, fixRunning, fixStatus, verificationRun, verificationRunning, expandedVerifyCommand,
  gitPrepare, gitMessage, gitRunning, recoveryRun, recoveryRunning, reloadRunning,
  stagedDiffs, reviewedFiles, expandedDiffFile,
  committingFix, onStartFix, onStartVerification, onExpandVerifyCommand,
  onPrepareGitCommit, onCommitGitFix, onPushGitFix, onSetGitMessage, onPrepareReload, onStartReload, onApproveRelaunch, onRollbackHeal,
  onLoadDiff, onRevertFile, onMarkReviewed, onCommitFix, onExpandDiff,
}: DiffViewerProps) {
  const stagedFiles: SelfHealStagedFileEntry[] = (() => {
    try { return JSON.parse(report.fix_staged_files || '[]') } catch { return [] }
  })()

  const allReviewed = stagedFiles.length > 0 && stagedFiles.every((f) => reviewedFiles[f.relativePath])
  const canApply = report.fix_status === 'staged' && allReviewed && !committingFix
  const verificationCommands: SelfHealVerificationStep['command'][] = ['typecheck', 'lint', 'test', 'build']
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
  const statusClass = (status: SelfHealVerificationStep['status']) => {
    if (status === 'success') return 'text-green-600 dark:text-green-400'
    if (status === 'failed') return 'text-red-600 dark:text-red-400'
    if (status === 'running') return 'text-blue-600 dark:text-blue-400'
    if (status === 'skipped') return 'text-gray-400 dark:text-gray-500'
    return 'text-gray-500 dark:text-gray-400'
  }

  return (
    <div className="space-y-3 pt-1">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-gray-700 dark:text-gray-300">
          Fix staging
          {' '}
          <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
            report.fix_status === 'applied' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' :
            report.fix_status === 'staged'  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' :
            report.fix_status === 'failed'  ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' :
                                              'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
          }`}>{report.fix_status}</span>
        </p>
        {report.fix_status === 'none' || report.fix_status === 'failed' ? (
          <button
            onClick={() => onStartFix(report.id)}
            disabled={fixRunning !== null}
            className="text-[11px] px-2 py-1 rounded-md border border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/30 disabled:opacity-50"
          >
            {fixRunning === report.id ? 'Generating...' : 'Retry Fix'}
          </button>
        ) : null}
      </div>

      {report.fix_status === 'staging' && (
        <p className="text-[11px] text-gray-400">{fixStatus ?? 'Generating fix...'}</p>
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

      {report.fix_status === 'applied' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-green-600 dark:text-green-400">Fix applied to workspace. Backups saved.</p>
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

          {verificationPassed && (
            <div className="space-y-2 rounded border border-green-200 bg-green-50/60 p-3 dark:border-green-900 dark:bg-green-950/20">
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
                      {gitRunning === 'commit' ? 'Committing...' : 'Commit fix'}
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
                  {!gitPrepare.canCommit && gitPrepare.status.isRepo && (
                    <div className="space-y-2 border-t border-green-200 pt-2 dark:border-green-900">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-medium text-gray-700 dark:text-gray-300">Reload preparation</p>
                          <p className="text-[10px] text-gray-500">
                            {recoveryRun
                              ? `Prepared ${recoveryRun.targetCommitSha ?? 'current commit'}${recoveryRun.targetVersion ? ` · v${recoveryRun.targetVersion}` : ''}`
                              : 'Save pre-reload state and rollback manifest before relaunch work begins.'}
                          </p>
                        </div>
                        <button
                          onClick={() => void onPrepareReload(report.id)}
                          disabled={recoveryRunning}
                          className="text-[11px] px-2 py-1 rounded-md border border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/30 disabled:opacity-50"
                        >
                          {recoveryRunning ? 'Preparing...' : 'Prepare reload'}
                        </button>
                      </div>
                      {recoveryRun && (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="primary"
                            onClick={() => void onStartReload(recoveryRun.id)}
                            disabled={reloadRunning || recoveryRun.status !== 'prepared'}
                            className="text-[11px] px-2 py-1"
                          >
                            {reloadRunning ? 'Packaging...' : 'Package for reload'}
                          </Button>
                          <button
                            onClick={() => void onApproveRelaunch(recoveryRun.id)}
                            disabled={recoveryRun.status !== 'reloading'}
                            className="text-[11px] px-2 py-1 rounded-md border border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/30 disabled:opacity-50"
                          >
                            Relaunch now
                          </button>
                          {(recoveryRun.status === 'reloading' || recoveryRun.status === 'confirmed') && (
                            <Button
                              variant="danger"
                              onClick={() => void onRollbackHeal(recoveryRun.id)}
                              className="text-[11px] px-2 py-1"
                            >
                              {recoveryRun.status === 'confirmed' ? 'Reject & rollback' : 'Cancel & rollback'}
                            </Button>
                          )}
                          {recoveryRun.status === 'rolled-back' && (
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">Rolled back to pre-heal state.</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {verificationRun?.status === 'failed' && (
            <div className="space-y-2 rounded border border-red-200 bg-red-50/60 p-3 dark:border-red-900 dark:bg-red-950/20">
              <p className="text-[11px] text-red-600 dark:text-red-400">{verificationRun.error ?? 'Verification failed.'}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => onStartFix(report.id)}
                  disabled={fixRunning !== null}
                  className="text-[11px] px-2 py-1 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {fixRunning === report.id ? 'Generating...' : 'Back to fix & retry'}
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
        </div>
      )}

      {fixStatus && report.fix_status !== 'applied' && (
        <p className="text-[11px] text-gray-400">{fixStatus}</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Phase progress bar
// ---------------------------------------------------------------------------

type SelfHealPhase =
  | 'captured'
  | 'investigating'
  | 'plan-accepted'
  | 'fixing'
  | 'verifying'
  | 'verify-failed'
  | 'committed'
  | 'reloaded'

const SELF_HEAL_PHASE_ORDER: SelfHealPhase[] = [
  'captured', 'investigating', 'plan-accepted', 'fixing', 'verifying', 'committed', 'reloaded',
]

function deriveSelfHealPhase(
  report: ErrorReportEntry,
  verificationRun: SelfHealVerificationRun | null,
  recoveryRun: SelfHealRecoveryRun | null,
  gitCommitted: boolean,
): SelfHealPhase {
  if (recoveryRun?.status === 'reloading' || recoveryRun?.status === 'confirmed') return 'reloaded'
  if (gitCommitted) return 'committed'
  if (verificationRun?.status === 'failed') return 'verify-failed'
  if (verificationRun?.status === 'success') return 'committed' // verified, awaiting git review — grouped with commit phase
  if (report.fix_status === 'applied') return 'verifying'
  if (['staging', 'staged', 'applying', 'failed'].includes(report.fix_status)) return 'fixing'
  if (report.status === 'investigated') return 'plan-accepted'
  if (report.status === 'investigating' || report.investigation_markdown) return 'investigating'
  return 'captured'
}

const SELF_HEAL_PHASE_STEPS: { id: SelfHealPhase; label: string }[] = [
  { id: 'captured', label: 'Captured' },
  { id: 'investigating', label: 'Investigating' },
  { id: 'plan-accepted', label: 'Plan accepted' },
  { id: 'fixing', label: 'Fixing' },
  { id: 'verifying', label: 'Verified' },
  { id: 'committed', label: 'Committed' },
  { id: 'reloaded', label: 'Reloaded' },
]

function SelfHealPhaseBar({ phase }: { phase: SelfHealPhase }) {
  const currentIndex = phase === 'verify-failed'
    ? SELF_HEAL_PHASE_ORDER.indexOf('verifying')
    : SELF_HEAL_PHASE_ORDER.indexOf(phase)
  const steps = SELF_HEAL_PHASE_STEPS.map((step) =>
    step.id === 'verifying' && phase === 'verify-failed' ? { ...step, label: 'Verify failed' } : step,
  )

  return (
    <PhaseBar
      steps={steps}
      currentIndex={currentIndex}
      failedId={phase === 'verify-failed' ? 'verifying' : undefined}
    />
  )
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function SelfHealPanel() {
  const visible = useAppStore((s) => s.showSelfHealPanel)
  const setShowSelfHealPanel = useAppStore((s) => s.setShowSelfHealPanel)
  const pendingSelfHealReportId = useAppStore((s) => s.pendingSelfHealReportId)
  const setPendingSelfHealReportId = useAppStore((s) => s.setPendingSelfHealReportId)
  const debugLogging = useAppStore((s) => s.debugLogging)
  const setDebugLogging = useAppStore((s) => s.setDebugLogging)
  const catalogModels = useAppStore((s) => s.catalogModels)
  const addToast = useAppStore((s) => s.addToast)
  const onClose = () => setShowSelfHealPanel(false)
  const onToggleDebugLogging = () => setDebugLogging(!debugLogging)

  const [reports, setReports] = useState<ErrorReportEntry[]>([])
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [investigationSettings, setInvestigationSettings] = useState<SelfHealInvestigationSettings>({
    backend: 'byok',
    model: 'gpt-5-mini',
    retryLimit: 1,
    autoApproveTools: true,
  })
  const [availableModelGroups, setAvailableModelGroups] = useState<AvailableModelGroup[]>([])
  const [investigationOutput, setInvestigationOutput] = useState<Record<string, string>>({})
  const [investigationActivity, setInvestigationActivity] = useState<Record<string, SelfHealInvestigationActivity[]>>({})
  const [runningReportId, setRunningReportId] = useState<string | null>(null)
  const [investigationStatus, setInvestigationStatus] = useState<string | null>(null)
  const [fixRunning, setFixRunning] = useState<string | null>(null)
  const [fixStatus, setFixStatus] = useState<string | null>(null)
  const [stagedDiffs, setStagedDiffs] = useState<Record<string, SelfHealStagedFileDiff | null>>({})
  const [reviewedFiles, setReviewedFiles] = useState<Record<string, boolean>>({})
  const [committingFix, setCommittingFix] = useState(false)
  const [expandedDiffFile, setExpandedDiffFile] = useState<string | null>(null)
  const [verificationRuns, setVerificationRuns] = useState<Record<string, SelfHealVerificationRun[]>>({})
  const [verificationRunning, setVerificationRunning] = useState<string | null>(null)
  const [expandedVerifyCommand, setExpandedVerifyCommand] = useState<string | null>(null)
  const [gitPrepare, setGitPrepare] = useState<Record<string, SelfHealGitPrepareResult | null>>({})
  const [gitMessage, setGitMessage] = useState<Record<string, string>>({})
  const [gitRunning, setGitRunning] = useState<string | null>(null)
  const [recoveryRuns, setRecoveryRuns] = useState<Record<string, SelfHealRecoveryRun[]>>({})
  const [recoveryRunning, setRecoveryRunning] = useState<string | null>(null)
  const [reloadRunning, setReloadRunning] = useState<string | null>(null)
  const [selfHealHistory, setSelfHealHistory] = useState<SelfHealHistoryEntry[]>([])
  const [investigationCollapsed, setInvestigationCollapsed] = useState(false)
  const [historyCollapsed, setHistoryCollapsed] = useState(true)
  const [reportsRefreshing, setReportsRefreshing] = useState(false)
  const [historyRefreshing, setHistoryRefreshing] = useState(false)
  const [reviewAction, setReviewAction] = useState<'accept' | 'reject' | 'revise' | null>(null)
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null)
  const [pendingDeleteReport, setPendingDeleteReport] = useState<ErrorReportEntry | null>(null)

  const selectedReport = reports.find((report) => report.id === selectedReportId) ?? reports[0] ?? null
  const selfHealModelGroups = availableModelGroups.filter((group) => {
    if (investigationSettings.backend === 'claude-cli') return group.sourceKey === 'claude-cli'
    if (investigationSettings.backend === 'codex-cli') return group.sourceKey === 'codex-cli'
    return group.sourceType === 'provider'
  })
  const selectedModelSourceLabel = selfHealModelGroups.find((group) =>
    group.models.some((model) => model.id === investigationSettings.model)
  )?.sourceLabel
  const isReportBusy = (reportId: string): boolean => (
    runningReportId === reportId ||
    fixRunning === reportId ||
    verificationRunning === reportId ||
    recoveryRunning === reportId ||
    deletingReportId === reportId ||
    committingFix ||
    gitRunning !== null ||
    recoveryRuns[reportId]?.some((run) => run.id === reloadRunning) === true
  )

  const hasBackendGroup = (backend: SelfHealBackend) => availableModelGroups.some((group) => group.sourceKey === backend)
  const backendOptions: Array<{ value: SelfHealBackend; label: string }> = [
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
    const nextReports = await window.api.listErrorReports(25)
    setReports(nextReports)
    if (pendingSelfHealReportId && nextReports.some((report) => report.id === pendingSelfHealReportId)) {
      setSelectedReportId(pendingSelfHealReportId)
      setPendingSelfHealReportId(null)
    } else if (selectedIdOverride !== undefined) {
      setSelectedReportId(selectedIdOverride ?? nextReports[0]?.id ?? null)
    } else if (!selectedReportId && nextReports[0]) {
      setSelectedReportId(nextReports[0].id)
    }
  }

  const loadSelfHealHistory = async () => {
    if (typeof window.api.getSelfHealHistory !== 'function') return
    const entries = await window.api.getSelfHealHistory()
    setSelfHealHistory(entries)
  }

  const handleRefreshReports = async () => {
    setReportsRefreshing(true)
    setInvestigationStatus('Refreshing reports...')
    try {
      await loadReports()
      setInvestigationStatus('Reports refreshed')
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
      await loadSelfHealHistory()
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

  const handleSetBackend = (backend: SelfHealBackend) => {
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

  const handleSelectSelfHealModel = (_group: AvailableModelGroup, model: AvailableModelEntry) => {
    setInvestigationSettings((settings) => ({ ...settings, model: model.id }))
  }

  const loadVerificationRuns = async (reportId: string) => {
    if (typeof window.api.getVerificationRuns !== 'function') return
    const runs = await window.api.getVerificationRuns(reportId)
    setVerificationRuns((prev) => ({ ...prev, [reportId]: runs }))
  }

  const loadRecoveryRuns = async (reportId: string) => {
    if (typeof window.api.getSelfHealRecoveryRuns !== 'function') return
    const runs = await window.api.getSelfHealRecoveryRuns(reportId)
    setRecoveryRuns((prev) => ({ ...prev, [reportId]: runs }))
  }

  useEffect(() => {
    if (!visible) return
    if (
      typeof window.api.listErrorReports !== 'function' ||
      typeof window.api.getInvestigationSettings !== 'function'
    ) {
      return
    }
    void loadReports()
    void loadSelfHealHistory()
    void loadAvailableModels()
    window.api.getInvestigationSettings().then(setInvestigationSettings).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, pendingSelfHealReportId])

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
      setInvestigationStatus(result.status === 'done' ? 'Investigation complete' : result.error ?? 'Investigation failed')
      setInvestigationOutput((prev) => ({ ...prev, [result.reportId]: result.markdown }))
      void loadReports()
    })
    return () => {
      offActivity()
      offChunk()
      offDone()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (
      typeof window.api.onFixEvent !== 'function' ||
      typeof window.api.onFixDone !== 'function'
    ) {
      return
    }
    const offEvent = window.api.onFixEvent((event: SelfHealFixEvent) => {
      setFixStatus(event.label)
    })
    const offDone = window.api.onFixDone((result: SelfHealFixDone) => {
      setFixRunning(null)
      setFixStatus(result.status === 'done' ? 'Fix staging complete' : result.error ?? 'Fix failed')
      void loadReports()
    })
    return () => {
      offEvent()
      offDone()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (selectedReport?.id) {
      void loadVerificationRuns(selectedReport.id)
      void loadRecoveryRuns(selectedReport.id)
      setInvestigationCollapsed(selectedReport.fix_status !== 'none')
    }
  }, [selectedReport?.id])

  useEffect(() => {
    if (
      typeof window.api.onVerificationEvent !== 'function' ||
      typeof window.api.onVerificationDone !== 'function'
    ) {
      return
    }
    const offEvent = window.api.onVerificationEvent((event: SelfHealVerificationEvent) => {
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
                command: command as SelfHealVerificationStep['command'],
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
    const offDone = window.api.onVerificationDone((result: SelfHealVerificationDone) => {
      setVerificationRunning(null)
      setVerificationRuns((prev) => {
        const runs = prev[result.reportId] ?? []
        const run: SelfHealVerificationRun = {
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
    if (typeof window.api.onSelfHealGitEvent !== 'function') return
    const off = window.api.onSelfHealGitEvent((event: SelfHealGitEvent) => {
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
            },
          }
        })
      }
    })
    return off
  }, [])

  useEffect(() => {
    if (typeof window.api.onSelfHealRecoveryEvent !== 'function') return
    const off = window.api.onSelfHealRecoveryEvent((event: SelfHealRecoveryEvent) => {
      if (event.type === 'prepare') {
        setRecoveryRunning(null)
        void loadRecoveryRuns(event.reportId)
      }
      if (event.type === 'reload') {
        setReloadRunning(null)
        void loadRecoveryRuns(event.reportId)
      }
    })
    return off
  }, [])

  const handleStartFix = async (reportId: string) => {
    setFixRunning(reportId)
    setFixStatus('Generating fix...')
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
            command: command as SelfHealVerificationStep['command'],
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
    const result = await window.api.prepareSelfHealCommit(reportId)
    setGitPrepare((prev) => ({ ...prev, [reportId]: result }))
    setGitMessage((prev) => ({ ...prev, [reportId]: prev[reportId] ?? result.suggestedMessage }))
    setGitRunning(null)
  }

  const handleCommitGitFix = async (reportId: string) => {
    setGitRunning('commit')
    const result = await window.api.commitSelfHealFix(reportId, gitMessage[reportId] ?? '')
    setGitPrepare((prev) => ({
      ...prev,
      [reportId]: prev[reportId]
        ? { ...prev[reportId]!, status: result.status, canCommit: !result.committed, reason: result.error }
        : null,
    }))
    setGitRunning(null)
  }

  const handlePushGitFix = async (reportId: string) => {
    setGitRunning('push')
    const result = await window.api.pushSelfHealFix(reportId)
    setGitPrepare((prev) => ({
      ...prev,
      [reportId]: prev[reportId]
        ? { ...prev[reportId]!, status: result.status, reason: result.error }
        : null,
    }))
    setGitRunning(null)
  }

  const handlePrepareReload = async (reportId: string) => {
    setRecoveryRunning(reportId)
    const result = await window.api.prepareSelfHealReload(reportId)
    if (result.recovery) {
      setRecoveryRuns((prev) => ({
        ...prev,
        [reportId]: [result.recovery!, ...(prev[reportId] ?? []).filter((run) => run.id !== result.recovery!.id)].slice(0, 10),
      }))
    }
    setRecoveryRunning(null)
  }

  const handleStartReload = async (recoveryId: string) => {
    setReloadRunning(recoveryId)
    const result = await window.api.startSelfHealReload(recoveryId)
    if (result.recovery) {
      setRecoveryRuns((prev) => ({
        ...prev,
        [result.reportId]: [result.recovery!, ...(prev[result.reportId] ?? []).filter((run) => run.id !== recoveryId)].slice(0, 10),
      }))
    }
    if (!result.started) setReloadRunning(null)
  }

  const handleApproveRelaunch = async (recoveryId: string) => {
    await window.api.approveSelfHealRelaunch(recoveryId)
  }

  const handleRollbackHeal = async (recoveryId: string) => {
    await window.api.rollbackSelfHeal(recoveryId)
    void loadReports()
    void loadSelfHealHistory()
  }

  const persistInvestigationSettings = async () => {
    const saved = await window.api.setInvestigationSettings(investigationSettings)
    setInvestigationSettings(saved)
    return saved
  }

  const handleSaveInvestigationSettings = async () => {
    await persistInvestigationSettings()
    setInvestigationStatus('Investigation settings saved')
  }

  const handleStartInvestigation = async (reportId: string, action?: 'revise') => {
    setRunningReportId(reportId)
    setReviewAction(action ?? null)
    setInvestigationStatus('Investigation started')
    setInvestigationOutput((prev) => ({ ...prev, [reportId]: '' }))
    try {
      await persistInvestigationSettings()
      await window.api.startInvestigation(reportId)
    } catch (error) {
      setRunningReportId(null)
      setReviewAction(null)
      setInvestigationStatus(error instanceof Error ? error.message : String(error))
    }
  }

  const handleReviewInvestigation = async (reportId: string, status: 'investigated' | 'rejected') => {
    const action = status === 'investigated' ? 'accept' : 'reject'
    setReviewAction(action)
    setInvestigationStatus(status === 'investigated' ? 'Accepting investigation...' : 'Rejecting investigation...')
    try {
      await window.api.setSelfHealReportStatus(reportId, status)
      const message = status === 'investigated' ? 'Investigation accepted' : 'Investigation rejected'
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
    setInvestigationStatus('Deleting report...')
    try {
      const deleted = await window.api.deleteErrorReport(reportId)
      if (!deleted) {
        setInvestigationStatus('Report was already deleted')
        await loadReports(null)
        return
      }
      setInvestigationOutput((prev) => { const next = { ...prev }; delete next[reportId]; return next })
      setInvestigationActivity((prev) => { const next = { ...prev }; delete next[reportId]; return next })
      setVerificationRuns((prev) => { const next = { ...prev }; delete next[reportId]; return next })
      setRecoveryRuns((prev) => { const next = { ...prev }; delete next[reportId]; return next })
      setGitPrepare((prev) => { const next = { ...prev }; delete next[reportId]; return next })
      setGitMessage((prev) => { const next = { ...prev }; delete next[reportId]; return next })
      setInvestigationStatus('Report deleted')
      setPendingDeleteReport(null)
      await loadReports(null)
      await loadSelfHealHistory()
    } catch (error) {
      setInvestigationStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setDeletingReportId(null)
    }
  }

  const selectedReportBusy = Boolean(selectedReport && (
    isReportBusy(selectedReport.id)
  ))

  if (!visible) return null

  return (
    <>
    <ModalShell
      title="Self-Heal"
      description="Investigate, fix, verify, and recover from captured bug reports."
      icon={<Wrench className="w-3.5 h-3.5" />}
      maxWidth="max-w-7xl"
      onClose={onClose}
    >
      <div className="space-y-4">
        {/* Debug logging */}
        <div className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div>
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Debug logging</p>
            <p className="text-xs text-gray-500 mt-0.5">Enable verbose developer diagnostics in terminal, log file, and console panel.</p>
          </div>
          <button
            onClick={onToggleDebugLogging}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${debugLogging ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
            aria-pressed={debugLogging}
            aria-label="Toggle debug logging"
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${debugLogging ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        {/* Self-heal investigation */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
            <div>
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Self-heal investigations</p>
              <p className="text-[11px] text-gray-500">Review bug reports and generate root-cause investigation notes.</p>
              {investigationStatus && (
                <p className="mt-1 text-[11px] text-blue-600 dark:text-blue-300">{investigationStatus}</p>
              )}
            </div>
            <Button
              variant="secondary"
              onClick={() => void handleRefreshReports()}
              disabled={reportsRefreshing}
              className="text-[11px] px-2 py-1"
            >
              {reportsRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
          <div className="grid gap-0 md:grid-cols-[260px_1fr]">
            <div className="border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-700">
              <div className="p-3 space-y-2 border-b border-gray-100 dark:border-gray-800">
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] text-gray-500">
                    Backend
                    <select
                      value={investigationSettings.backend}
                      onChange={(event) => handleSetBackend(event.target.value as SelfHealBackend)}
                      className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                    >
                      {backendOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[11px] text-gray-500">
                    Retries
                    <input
                      type="number"
                      min={0}
                      max={5}
                      value={investigationSettings.retryLimit}
                      onChange={(event) => setInvestigationSettings((s) => ({ ...s, retryLimit: Number(event.target.value) }))}
                      className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                    />
                  </label>
                </div>
                <div className="text-[11px] text-gray-500">
                  <p>Model</p>
                  <ModelPicker
                    value={investigationSettings.model}
                    sourceLabel={selectedModelSourceLabel}
                    availableGroups={selfHealModelGroups}
                    catalogModels={catalogModels}
                    includeDefault={false}
                    emptyLabel={
                      investigationSettings.backend === 'codex-cli'
                        ? 'Codex CLI is not available'
                        : investigationSettings.backend === 'claude-cli'
                          ? 'Claude CLI is not available'
                          : 'No provider models configured'
                    }
                    buttonClassName="mt-1 flex w-full items-center justify-between gap-2 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                    menuClassName="left-0 right-auto"
                    onSelectAvailableModel={handleSelectSelfHealModel}
                  />
                </div>
                <label className="flex items-center gap-2 text-[11px] text-gray-500">
                  <input
                    type="checkbox"
                    checked={investigationSettings.autoApproveTools}
                    onChange={(event) => setInvestigationSettings((s) => ({ ...s, autoApproveTools: event.target.checked }))}
                  />
                  Auto-approve investigator tools
                </label>
                <Button
                  variant="secondary"
                  onClick={() => void handleSaveInvestigationSettings()}
                  className="text-[11px] px-2 py-1"
                >
                  Save settings
                </Button>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {reports.length === 0 ? (
                  <p className="p-3 text-xs text-gray-400">No bug reports captured.</p>
                ) : (
                  reports.map((report) => {
                    const reportBusy = isReportBusy(report.id)
                    return (
                      <div
                        key={report.id}
                        className={`group flex items-start gap-2 border-b border-gray-100 px-3 py-2 text-xs dark:border-gray-800 ${
                          selectedReport?.id === report.id ? 'bg-blue-50 dark:bg-blue-950/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedReportId(report.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="block truncate font-medium text-gray-700 dark:text-gray-200">{report.title}</span>
                          <span className="mt-0.5 block text-[11px] text-gray-400">
                            {report.status} · {new Date(report.created_at).toLocaleString()}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            setPendingDeleteReport(report)
                          }}
                          disabled={reportBusy}
                          className="invisible shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40 group-hover:visible dark:hover:bg-red-900/20"
                          title={reportBusy ? 'Wait for the current Self-Heal action to finish before deleting' : 'Delete report'}
                          aria-label={`Delete ${report.title}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
            <div className="min-h-72 p-3">
              {selectedReport ? (
                <div className="space-y-3">
                  <SelfHealPhaseBar
                    phase={deriveSelfHealPhase(
                      selectedReport,
                      verificationRuns[selectedReport.id]?.[0] ?? null,
                      recoveryRuns[selectedReport.id]?.[0] ?? null,
                      gitPrepare[selectedReport.id]?.canCommit === false,
                    )}
                  />
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-800 dark:text-gray-100">{selectedReport.title}</p>
                      <p className="mt-1 text-xs text-gray-500 break-words">{selectedReport.description || 'No description.'}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="primary"
                        onClick={() => void handleStartInvestigation(selectedReport.id)}
                        disabled={runningReportId !== null}
                      >
                        {runningReportId === selectedReport.id && reviewAction !== 'revise' ? 'Investigating...' : 'Investigate'}
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => setPendingDeleteReport(selectedReport)}
                        disabled={selectedReportBusy}
                        className="px-2"
                        title={selectedReportBusy ? 'Wait for the current Self-Heal action to finish before deleting' : 'Delete report'}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {deletingReportId === selectedReport.id ? 'Deleting...' : 'Delete'}
                      </Button>
                    </div>
                  </div>
                  {(selectedReport.investigation_markdown || (investigationActivity[selectedReport.id]?.length ?? 0) > 0) && (
                    <Button
                      variant="ghost"
                      onClick={() => setInvestigationCollapsed((collapsed) => !collapsed)}
                      className="px-0 py-0 text-[11px]"
                    >
                      {investigationCollapsed ? '▸ Show investigation' : '▾ Hide investigation'}
                    </Button>
                  )}
                  {!investigationCollapsed && (
                    <>
                      {selectedReport.investigation_markdown && selectedReport.status === 'investigating' && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => void handleReviewInvestigation(selectedReport.id, 'investigated')}
                            disabled={reviewAction !== null || runningReportId !== null}
                            className="text-[11px] px-2 py-1 rounded-md border border-green-300 text-green-700 hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-green-800 dark:text-green-300 dark:hover:bg-green-950/30"
                          >
                            {reviewAction === 'accept' ? 'Accepting...' : 'Accept'}
                          </button>
                          <Button
                            variant="danger"
                            onClick={() => void handleReviewInvestigation(selectedReport.id, 'rejected')}
                            disabled={reviewAction !== null || runningReportId !== null}
                            className="text-[11px] px-2 py-1"
                          >
                            {reviewAction === 'reject' ? 'Rejecting...' : 'Reject'}
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => void handleStartInvestigation(selectedReport.id, 'revise')}
                            disabled={runningReportId !== null}
                            className="text-[11px] px-2 py-1"
                          >
                            {reviewAction === 'revise' ? 'Revising...' : 'Revise'}
                          </Button>
                        </div>
                      )}
                      {selectedReport.investigation_markdown && selectedReport.status === 'rejected' && (
                        <p className="text-[11px] font-medium text-red-600 dark:text-red-400">Investigation rejected.</p>
                      )}
                      {(investigationActivity[selectedReport.id]?.length ?? 0) > 0 && (
                        <div className="rounded border border-gray-200 p-2 dark:border-gray-700">
                          <p className="text-[11px] font-medium text-gray-500">Activity</p>
                          <div className="mt-1 space-y-1">
                            {investigationActivity[selectedReport.id].slice(-6).map((activity, index) => (
                              <p key={`${activity.label}-${index}`} className="text-[11px] text-gray-500">
                                {activity.type === 'thinking' ? 'Thinking' : activity.label}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                      <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-700 dark:bg-gray-950/50 dark:text-gray-300">
                        {investigationOutput[selectedReport.id] || selectedReport.investigation_markdown || 'No investigation has been generated yet.'}
                      </pre>
                      {investigationStatus && <p className="text-[11px] text-gray-400">{investigationStatus}</p>}
                    </>
                  )}

                  {selectedReport.status === 'investigated' && selectedReport.fix_status === 'none' && (
                    <div className="pt-1">
                      <Button
                        variant="primary"
                        onClick={() => void handleStartFix(selectedReport.id)}
                        disabled={fixRunning !== null}
                      >
                        {fixRunning === selectedReport.id ? 'Generating fix...' : 'Generate Fix'}
                      </Button>
                    </div>
                  )}

                  {['staging', 'staged', 'applying', 'applied', 'failed'].includes(selectedReport.fix_status) && (
                    <SelfHealDiffViewer
                      report={selectedReport}
                      fixRunning={fixRunning}
                      fixStatus={fixStatus}
                      verificationRun={verificationRuns[selectedReport.id]?.[0] ?? null}
                      verificationRunning={verificationRunning}
                      expandedVerifyCommand={expandedVerifyCommand}
                      gitPrepare={gitPrepare[selectedReport.id] ?? null}
                      gitMessage={gitMessage[selectedReport.id] ?? ''}
                      gitRunning={gitRunning}
                      recoveryRun={recoveryRuns[selectedReport.id]?.[0] ?? null}
                      recoveryRunning={recoveryRunning === selectedReport.id}
                      reloadRunning={reloadRunning === recoveryRuns[selectedReport.id]?.[0]?.id}
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
                      onPrepareReload={handlePrepareReload}
                      onStartReload={handleStartReload}
                      onApproveRelaunch={handleApproveRelaunch}
                      onRollbackHeal={handleRollbackHeal}
                      onLoadDiff={handleLoadDiff}
                      onRevertFile={handleRevertFile}
                      onMarkReviewed={handleMarkReviewed}
                      onCommitFix={handleCommitFix}
                      onExpandDiff={setExpandedDiffFile}
                    />
                  )}
                </div>
              ) : (
                <p className="text-xs text-gray-400">Select a bug report to investigate.</p>
              )}
            </div>
          </div>
        </div>

        {/* Self-heal history */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={() => setHistoryCollapsed((collapsed) => !collapsed)}
              className="text-left"
            >
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{historyCollapsed ? '▸' : '▾'} Self-heal history</p>
              <p className="text-[11px] text-gray-500">Audit trail of all self-heal runs.</p>
            </button>
            <Button
              variant="secondary"
              onClick={() => void handleRefreshHistory()}
              disabled={historyRefreshing}
              className="text-[11px] px-2 py-1"
            >
              {historyRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
          {!historyCollapsed && (
          <div className="max-h-52 overflow-y-auto">
            {selfHealHistory.length === 0 ? (
              <p className="p-3 text-xs text-gray-400">No self-heal history yet.</p>
            ) : (
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800/70">
                  <tr className="border-b border-gray-100 dark:border-gray-800">
                    <th className="px-3 py-1.5 text-left font-medium text-gray-500">Report</th>
                    <th className="px-2 py-1.5 text-left font-medium text-gray-500">Status</th>
                    <th className="px-2 py-1.5 text-left font-medium text-gray-500">Model</th>
                    <th className="px-2 py-1.5 text-left font-medium text-gray-500">Steps</th>
                    <th className="px-2 py-1.5 text-left font-medium text-gray-500">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {selfHealHistory.map((entry) => (
                    <tr key={entry.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                      <td className="px-3 py-1.5 max-w-[140px]">
                        <span className="block truncate text-gray-700 dark:text-gray-300 font-medium">{entry.reportTitle || entry.reportId.slice(0, 8)}</span>
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                          entry.status === 'reloaded' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' :
                          entry.status === 'rolled-back' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' :
                          entry.status === 'failed' || entry.status === 'verify-failed' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' :
                          entry.status === 'verified' || entry.status === 'committed' || entry.status === 'pushed' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' :
                          'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                        }`}>{entry.status}</span>
                      </td>
                      <td className="px-2 py-1.5 text-gray-500 font-mono max-w-[100px]">
                        <span className="block truncate">{entry.investigationModel ?? '—'}</span>
                      </td>
                      <td className="px-2 py-1.5 text-gray-400">
                        <span className="flex gap-1">
                          {entry.verificationPassed && <span title="Verified">✓V</span>}
                          {entry.committed && <span title="Committed">✓C</span>}
                          {entry.pushed && <span title="Pushed">✓P</span>}
                          {entry.reloaded && <span title="Reloaded">✓R</span>}
                          {entry.rolledBack && <span title="Rolled back">↩</span>}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-gray-400 whitespace-nowrap">
                        {new Date(entry.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          )}
        </div>
      </div>
    </ModalShell>
    {pendingDeleteReport && (
      <DeleteSelfHealReportDialog
        reportTitle={pendingDeleteReport.title}
        deleting={deletingReportId === pendingDeleteReport.id}
        onConfirm={() => void handleDeleteReport(pendingDeleteReport.id)}
        onCancel={() => setPendingDeleteReport(null)}
      />
    )}
    </>
  )
}
