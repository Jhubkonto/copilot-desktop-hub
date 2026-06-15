import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, CheckCircle, AlertTriangle, XCircle, ChevronDown, ChevronRight } from 'lucide-react'
import type {
  AdbDevice,
  AndroidBuildCommandName,
  AndroidSigningConfig,
  AndroidUpdateManifest,
  AndroidWorkspaceInfo,
  BuildCommandName,
  BuildRecord,
  BuildStatus,
  ErrorReportEntry,
  ErrorLogEntry,
  LocalUpdateFeed,
  PreflightCheck,
  PublishedEntry,
  SelfHealFixDone,
  SelfHealFixEvent,
  SelfHealHistoryEntry,
  SelfHealVerificationDone,
  SelfHealVerificationEvent,
  SelfHealVerificationRun,
  SelfHealVerificationStep,
  SelfHealGitEvent,
  SelfHealGitPrepareResult,
  SelfHealRecoveryEvent,
  SelfHealRecoveryRun,
  SelfHealStagedFileDiff,
  SelfHealStagedFileEntry,
  SelfHealInvestigationActivity,
  SelfHealInvestigationSettings,
  WorkspaceInfo,
} from '@shared/types'
import { SegmentedTabs } from '../ui/primitives'
import { BuildLog } from '../BuildLog'

interface Props {
  // Desktop workspace
  workspaceInfo: WorkspaceInfo | null
  workspacePathInput: string
  onSetWorkspacePathInput: (v: string) => void
  onRefreshWorkspace: () => void
  onSaveWorkspacePath: () => void
  // Desktop build
  buildRecords: BuildRecord[]
  activeBuildId: string | null
  activeBuildCommand: BuildCommandName | null
  buildLogLines: string[]
  lastBuildStatus: BuildStatus | null
  onRunBuildCommand: (cmd: BuildCommandName) => void
  onCancelBuild: () => void
  // Preflight
  preflightChecks: PreflightCheck[] | null
  preflightRunning: boolean
  onRunPreflight: () => void
  // Feed
  feedInfo: LocalUpdateFeed | null
  feedPathInput: string
  publishedEntries: PublishedEntry[]
  publishing: boolean
  publishResult: string | null
  onSetFeedPathInput: (v: string) => void
  onSaveFeedPath: () => void
  onPublishUpdate: () => void
  onRollback: (version: string) => void
  // Launch dev
  launchDevError: string | null
  onLaunchDev: () => void
  // Android workspace
  androidWorkspaceInfo: AndroidWorkspaceInfo | null
  androidWorkspacePathInput: string
  onSetAndroidWorkspacePathInput: (v: string) => void
  onSaveAndroidWorkspacePath: () => void
  onRefreshAndroidWorkspace: () => void
  // Android build
  androidBuildRecords: BuildRecord[]
  activeAndroidBuildId: string | null
  activeAndroidCommand: AndroidBuildCommandName | null
  androidLogLines: string[]
  androidLastBuildStatus: BuildStatus | null
  onAndroidStartCommand: (cmd: AndroidBuildCommandName) => void
  onAndroidCancelCommand: () => void
  // Signing
  signingDraft: AndroidSigningConfig
  signingValidation: PreflightCheck[] | null
  onSetSigningDraft: (updater: (d: AndroidSigningConfig) => AndroidSigningConfig) => void
  onSaveSigningConfig: () => void
  onValidateSigningConfig: () => void
  // ADB
  adbDevices: AdbDevice[]
  adbInstalling: boolean
  latestAdbInstallRecord: BuildRecord | undefined
  latestAdbInstallApk: string | undefined
  onRefreshAdbDevices: () => void
  onAndroidInstallApk: (serial: string) => void
  // Android feed
  androidPublishResult: string | null
  androidUpdateManifest: AndroidUpdateManifest | null
  androidPublishHistory: AndroidUpdateManifest[]
  androidRestoring: number | null
  onAndroidPublishUpdate: () => void
  onAndroidRestoreVersion: (versionCode: number) => void
  // Debug
  debugLogging: boolean
  onToggleDebugLogging: () => void
}

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
                  <button
                    onClick={() => {
                      if (isExpanded) {
                        onExpandDiff(null)
                      } else if (diff) {
                        onExpandDiff(file.relativePath)
                      } else {
                        onLoadDiff(report.id, file.relativePath)
                      }
                    }}
                    className="text-[11px] px-2 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    {isExpanded ? 'Hide diff' : 'View diff'}
                  </button>
                  {!reviewed && !isApplied && (
                    <button
                      onClick={() => onMarkReviewed(file.relativePath)}
                      className="text-[11px] px-2 py-0.5 rounded border border-green-300 text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-300 dark:hover:bg-green-950/30"
                    >
                      Mark reviewed
                    </button>
                  )}
                  {!isApplied && (
                    <button
                      onClick={() => void onRevertFile(report.id, file.relativePath)}
                      className="text-[11px] px-2 py-0.5 rounded border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/30"
                    >
                      Revert
                    </button>
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
          <button
            onClick={() => void onCommitFix(report.id)}
            disabled={!canApply}
            className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 font-medium disabled:opacity-50"
            title={!allReviewed ? 'Mark all files as reviewed before applying' : ''}
          >
            {committingFix ? 'Applying...' : 'Apply to workspace'}
          </button>
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
                  <button
                    type="button"
                    onClick={() => onExpandVerifyCommand(isExpanded ? null : step.command)}
                    className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 text-left dark:bg-gray-900/50"
                  >
                    <span className="flex-1 text-[11px] font-medium text-gray-700 dark:text-gray-300">{step.command}</span>
                    <span className={`text-[10px] font-medium ${statusClass(step.status)}`}>{step.status}</span>
                  </button>
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
                    <button
                      onClick={() => void onCommitGitFix(report.id)}
                      disabled={!gitPrepare.canCommit || gitRunning !== null}
                      className="text-[11px] px-2 py-1 rounded-md bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-50"
                    >
                      {gitRunning === 'commit' ? 'Committing...' : 'Commit fix'}
                    </button>
                    <button
                      onClick={() => void onPushGitFix(report.id)}
                      disabled={gitRunning !== null || !gitPrepare.status.isRepo}
                      className="text-[11px] px-2 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 disabled:opacity-50"
                    >
                      {gitRunning === 'push' ? 'Pushing...' : 'Push'}
                    </button>
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
                          <button
                            onClick={() => void onStartReload(recoveryRun.id)}
                            disabled={reloadRunning || recoveryRun.status !== 'prepared'}
                            className="text-[11px] px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            {reloadRunning ? 'Packaging...' : 'Package for reload'}
                          </button>
                          <button
                            onClick={() => void onApproveRelaunch(recoveryRun.id)}
                            disabled={recoveryRun.status !== 'reloading'}
                            className="text-[11px] px-2 py-1 rounded-md border border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/30 disabled:opacity-50"
                          >
                            Relaunch now
                          </button>
                          {(recoveryRun.status === 'reloading' || recoveryRun.status === 'confirmed') && (
                            <button
                              onClick={() => void onRollbackHeal(recoveryRun.id)}
                              className="text-[11px] px-2 py-1 rounded-md border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/30"
                            >
                              {recoveryRun.status === 'confirmed' ? 'Reject & rollback' : 'Cancel & rollback'}
                            </button>
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
            <p className="text-[11px] text-red-600 dark:text-red-400">{verificationRun.error ?? 'Verification failed.'}</p>
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
// Main component
// ---------------------------------------------------------------------------

type DeveloperInnerTab = 'desktop' | 'android' | 'self-heal' | 'console'

export function DeveloperTab({
  workspaceInfo, workspacePathInput, onSetWorkspacePathInput, onRefreshWorkspace, onSaveWorkspacePath,
  buildRecords, activeBuildId, activeBuildCommand, buildLogLines, lastBuildStatus,
  onRunBuildCommand, onCancelBuild,
  preflightChecks, preflightRunning, onRunPreflight,
  feedInfo, feedPathInput, publishedEntries, publishing, publishResult,
  onSetFeedPathInput, onSaveFeedPath, onPublishUpdate, onRollback,
  launchDevError, onLaunchDev,
  androidWorkspaceInfo, androidWorkspacePathInput, onSetAndroidWorkspacePathInput,
  onSaveAndroidWorkspacePath, onRefreshAndroidWorkspace,
  androidBuildRecords, activeAndroidBuildId, activeAndroidCommand, androidLogLines, androidLastBuildStatus,
  onAndroidStartCommand, onAndroidCancelCommand,
  signingDraft, signingValidation, onSetSigningDraft, onSaveSigningConfig, onValidateSigningConfig,
  adbDevices, adbInstalling, latestAdbInstallRecord, latestAdbInstallApk,
  onRefreshAdbDevices, onAndroidInstallApk,
  androidPublishResult, androidUpdateManifest, androidPublishHistory, androidRestoring,
  onAndroidPublishUpdate, onAndroidRestoreVersion,
  debugLogging, onToggleDebugLogging,
}: Props) {
  const [developerTab, setDeveloperTab] = useState<DeveloperInnerTab>('desktop')

  // Console state
  const [consoleEntries, setConsoleEntries] = useState<ErrorLogEntry[]>([])
  const [consoleLevel, setConsoleLevel] = useState<'all' | 'error' | 'warn' | 'info'>('all')
  const [consoleStatus, setConsoleStatus] = useState<string | null>(null)
  const [unreadErrorCount, setUnreadErrorCount] = useState(0)

  // Self-heal state
  const [reports, setReports] = useState<ErrorReportEntry[]>([])
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [investigationSettings, setInvestigationSettings] = useState<SelfHealInvestigationSettings>({
    backend: 'byok',
    model: 'gpt-5-mini',
    retryLimit: 1,
    autoApproveTools: true,
  })
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

  // Build history expand
  const [expandedDesktopHistoryId, setExpandedDesktopHistoryId] = useState<string | null>(null)
  const [expandedAndroidHistoryId, setExpandedAndroidHistoryId] = useState<string | null>(null)

  // Preflight worst status for tab badge
  const preflightWorst = preflightChecks?.some((c) => c.status === 'fail') ? 'fail'
    : preflightChecks?.some((c) => c.status === 'warn') ? 'warn'
    : preflightChecks?.length ? 'pass'
    : null

  // Auto-run preflight when Desktop tab is first opened
  const preflightTriggeredRef = useRef(false)
  useEffect(() => {
    if (developerTab === 'desktop' && !preflightTriggeredRef.current && preflightChecks === null && !preflightRunning) {
      preflightTriggeredRef.current = true
      onRunPreflight()
    }
  }, [developerTab, preflightChecks, preflightRunning, onRunPreflight])

  // Reset unread count when Console tab becomes active
  useEffect(() => {
    if (developerTab === 'console') {
      setUnreadErrorCount(0)
    }
  }, [developerTab])

  // Console entries subscription
  useEffect(() => {
    if (
      typeof window.api.getRecentErrors !== 'function' ||
      typeof window.api.onErrorLogEntry !== 'function'
    ) {
      return
    }
    let cancelled = false
    window.api.getRecentErrors(100)
      .then((entries) => {
        if (!cancelled) setConsoleEntries(entries)
      })
      .catch(() => {
        if (!cancelled) setConsoleStatus('Failed to load error log')
      })
    const off = window.api.onErrorLogEntry((entry) => {
      setConsoleEntries((prev) => [...prev.slice(-199), entry])
      if (entry.level === 'error') {
        setUnreadErrorCount((n) => n + 1)
      }
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])

  const filteredConsoleEntries = useMemo(
    () => consoleEntries.filter((entry) => consoleLevel === 'all' || entry.level === consoleLevel),
    [consoleEntries, consoleLevel],
  )
  const selectedReport = reports.find((report) => report.id === selectedReportId) ?? reports[0] ?? null

  const loadReports = async () => {
    if (typeof window.api.listErrorReports !== 'function') return
    const nextReports = await window.api.listErrorReports(25)
    setReports(nextReports)
    if (!selectedReportId && nextReports[0]) setSelectedReportId(nextReports[0].id)
  }

  const loadSelfHealHistory = async () => {
    if (typeof window.api.getSelfHealHistory !== 'function') return
    const entries = await window.api.getSelfHealHistory()
    setSelfHealHistory(entries)
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
    if (
      typeof window.api.listErrorReports !== 'function' ||
      typeof window.api.getInvestigationSettings !== 'function'
    ) {
      return
    }
    void loadReports()
    void loadSelfHealHistory()
    window.api.getInvestigationSettings().then(setInvestigationSettings).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    await window.api.startFix(reportId)
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
    const { runId } = await window.api.startVerification(reportId)
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

  const handleClearConsole = async () => {
    await window.api.clearErrors()
    setConsoleEntries([])
    setConsoleStatus('Console cleared')
  }

  const handleCopyConsole = async () => {
    const text = filteredConsoleEntries
      .map((entry) => {
        const line = `${new Date(entry.timestamp).toLocaleTimeString()} [${entry.level}] [${entry.source}] ${entry.message}`
        return entry.stack ? `${line}\n${entry.stack}` : line
      })
      .join('\n')
    await navigator.clipboard.writeText(text)
    setConsoleStatus('Copied visible entries')
  }

  const handleSaveInvestigationSettings = async () => {
    const saved = await window.api.setInvestigationSettings(investigationSettings)
    setInvestigationSettings(saved)
    setInvestigationStatus('Investigation settings saved')
  }

  const handleStartInvestigation = async (reportId: string) => {
    setRunningReportId(reportId)
    setInvestigationStatus('Investigation started')
    setInvestigationOutput((prev) => ({ ...prev, [reportId]: '' }))
    await window.api.startInvestigation(reportId)
  }

  const handleReviewInvestigation = async (reportId: string, status: 'investigated' | 'rejected') => {
    await window.api.setSelfHealReportStatus(reportId, status)
    setInvestigationStatus(status === 'investigated' ? 'Investigation accepted' : 'Investigation rejected')
    await loadReports()
  }

  // Desktop tab label with preflight dot
  const desktopTabLabel = (
    <span className="inline-flex items-center gap-1.5">
      Desktop
      {preflightWorst && (
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          preflightWorst === 'fail' ? 'bg-red-500' :
          preflightWorst === 'warn' ? 'bg-yellow-400' :
          'bg-green-500'
        }`} />
      )}
    </span>
  )

  return (
    <>
      <div>
        <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Developer</p>
        <p className="text-xs text-gray-500 mt-0.5">Build, test, and package the app from within Nexy.</p>
      </div>

      <SegmentedTabs
        value={developerTab}
        items={[
          { id: 'desktop', label: desktopTabLabel },
          { id: 'android', label: 'Android' },
          { id: 'self-heal', label: 'Self-Heal' },
          { id: 'console', label: 'Console', badge: unreadErrorCount },
        ]}
        onChange={setDeveloperTab}
      />

      {/* ================================================================
          DESKTOP TAB
      ================================================================ */}
      {developerTab === 'desktop' && (
        <div className="space-y-4">
          {/* Workspace */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Workspace</p>
              <button
                onClick={onRefreshWorkspace}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                Refresh
              </button>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={workspacePathInput}
                onChange={(e) => onSetWorkspacePathInput(e.target.value)}
                className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={onSaveWorkspacePath}
                className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 font-medium"
              >
                Save
              </button>
            </div>
            {workspaceInfo && (
              <div className="flex flex-wrap gap-1.5 text-xs">
                {workspaceInfo.isGitRepo ? (
                  <>
                    <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-mono">
                      {workspaceInfo.branch ?? '(detached)'}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 font-mono">
                      {workspaceInfo.commitSha ?? '—'}
                    </span>
                    {workspaceInfo.dirty && (
                      <span className="px-2 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300">dirty</span>
                    )}
                  </>
                ) : (
                  <span className="text-gray-400">Not a git repo</span>
                )}
                {workspaceInfo.version && (
                  <span className="px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
                    v{workspaceInfo.version}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Build actions */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Build commands</p>
            <div className="flex flex-wrap gap-2">
              {(['typecheck', 'test', 'build', 'package'] as const).map((cmd) => (
                <button
                  key={cmd}
                  onClick={() => activeBuildId ? onCancelBuild() : onRunBuildCommand(cmd)}
                  disabled={!!activeBuildId && activeBuildCommand !== cmd}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-40 ${
                    activeBuildCommand === cmd
                      ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {activeBuildCommand === cmd ? `Cancel ${cmd}` : cmd}
                </button>
              ))}
            </div>
            {lastBuildStatus && !activeBuildId && (
              <p className={`text-xs ${lastBuildStatus === 'success' ? 'text-green-600 dark:text-green-400' : lastBuildStatus === 'cancelled' ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}`}>
                {lastBuildStatus === 'success' ? '✓ Completed successfully' : lastBuildStatus === 'cancelled' ? '⊘ Cancelled' : '✗ Failed'}
              </p>
            )}
          </div>

          {/* Live log */}
          {buildLogLines.length > 0 && (
            <BuildLog lines={buildLogLines} running={activeBuildId !== null} resizable />
          )}

          {/* Build history */}
          {buildRecords.length > 0 && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                <p className="text-xs font-medium text-gray-500">Recent builds</p>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {buildRecords.map((rec) => {
                  const isExpanded = expandedDesktopHistoryId === rec.id
                  const logLines = rec.logTail ? rec.logTail.split('\n') : []
                  return (
                    <div key={rec.id}>
                      <button
                        type="button"
                        onClick={() => setExpandedDesktopHistoryId(isExpanded ? null : rec.id)}
                        className="w-full flex items-center gap-3 px-3 py-2 text-xs text-left hover:bg-gray-50 dark:hover:bg-gray-800/40"
                      >
                        <span className={`font-mono w-16 shrink-0 ${rec.status === 'success' ? 'text-green-600 dark:text-green-400' : rec.status === 'running' ? 'text-blue-500' : rec.status === 'cancelled' ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-500'}`}>
                          {rec.status}
                        </span>
                        <span className="font-mono text-gray-700 dark:text-gray-300 w-20 shrink-0">{rec.command}</span>
                        <span className="text-gray-400 font-mono truncate">{rec.branch ?? '—'}</span>
                        {rec.finishedAt && (
                          <span className="text-gray-400 ml-auto shrink-0">{Math.round((rec.finishedAt - rec.startedAt) / 1000)}s</span>
                        )}
                        {isExpanded ? <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" /> : <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />}
                      </button>
                      {isExpanded && (
                        <div className="px-3 pb-3 space-y-2 border-t border-gray-100 dark:border-gray-700">
                          {logLines.length > 0 && (
                            <BuildLog lines={logLines} resizable={false} maxHeightPx={200} />
                          )}
                          <button
                            onClick={() => onRunBuildCommand(rec.command as BuildCommandName)}
                            disabled={!!activeBuildId}
                            className="text-[11px] px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
                          >
                            Re-run {rec.command}
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Preflight */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Preflight checks</p>
              <button
                onClick={onRunPreflight}
                disabled={preflightRunning}
                className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
              >
                {preflightRunning ? 'Running...' : 'Run checks'}
              </button>
            </div>
            {preflightChecks && (
              <div className="space-y-1.5">
                {preflightChecks.map((check) => (
                  <div key={check.label} className="flex items-start gap-2 text-xs">
                    {check.status === 'ok' && <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0 mt-px" />}
                    {check.status === 'warn' && <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 shrink-0 mt-px" />}
                    {check.status === 'fail' && <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-px" />}
                    <div>
                      <span className="font-medium text-gray-700 dark:text-gray-300">{check.label}</span>
                      <span className="text-gray-400 ml-1.5">{check.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Local update feed */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <div>
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Local update feed</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Serve signed installers from a local directory. The app's "Check for updates" points here when the server is running.
              </p>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={feedPathInput}
                onChange={(e) => onSetFeedPathInput(e.target.value)}
                placeholder="/path/to/feed-directory"
                className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={onSaveFeedPath}
                className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 font-medium"
              >
                Set
              </button>
            </div>
            {feedInfo && (
              <div className="flex items-center gap-2 text-xs">
                <span className={`w-2 h-2 rounded-full shrink-0 ${feedInfo.running ? 'bg-green-500' : 'bg-gray-400'}`} />
                <span className="text-gray-500 font-mono">
                  {feedInfo.running ? feedInfo.feedUrl : 'Server not running'}
                </span>
              </div>
            )}
            {feedInfo?.feedPath && (
              <button
                onClick={onPublishUpdate}
                disabled={publishing}
                className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium disabled:opacity-50"
              >
                {publishing ? 'Publishing…' : 'Publish latest build to feed'}
              </button>
            )}
            {publishResult && <p className="text-xs text-gray-500">{publishResult}</p>}

            {/* Version shelf */}
            {publishedEntries.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Published versions</p>
                <div className="max-h-[130px] overflow-y-auto rounded border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                  {publishedEntries.map((entry) => (
                    <div key={`${entry.version}-${String(entry.isBackup)}`} className="flex items-center gap-2 px-2.5 py-1.5 text-[10px]">
                      <span className={`font-mono ${entry.isBackup ? 'text-gray-400' : 'text-gray-700 dark:text-gray-300'}`}>
                        v{entry.version}
                      </span>
                      {entry.isBackup && <span className="text-[9px] text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">backup</span>}
                      <span className="text-gray-400 ml-auto text-[9px]">{new Date(entry.publishedAt).toLocaleDateString()}</span>
                      {entry.isBackup && (
                        <button
                          onClick={() => onRollback(entry.version)}
                          className="text-[10px] px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          Reinstall
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Launch dev build */}
          {lastBuildStatus === 'success' && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-2">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Launch dev build</p>
              <p className="text-xs text-gray-500">Open the just-built app as a separate Electron process for smoke testing.</p>
              <button
                onClick={onLaunchDev}
                className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 font-medium"
              >
                Launch
              </button>
              {launchDevError && <p className="text-xs text-red-500">{launchDevError}</p>}
            </div>
          )}
        </div>
      )}

      {/* ================================================================
          ANDROID TAB
      ================================================================ */}
      {developerTab === 'android' && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-4">
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Android Build</p>

          {/* Android workspace */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={androidWorkspacePathInput}
                onChange={(e) => onSetAndroidWorkspacePathInput(e.target.value)}
                placeholder="/path/to/nexy-android"
                className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 font-mono"
              />
              <button onClick={onSaveAndroidWorkspacePath} className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Save</button>
              <button onClick={onRefreshAndroidWorkspace} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><RefreshCw className="w-3.5 h-3.5" /></button>
            </div>
            {androidWorkspaceInfo && (
              <div className="flex flex-wrap gap-1.5">
                {androidWorkspaceInfo.branch && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-mono">{androidWorkspaceInfo.branch}</span>}
                {androidWorkspaceInfo.commitSha && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-mono">{androidWorkspaceInfo.commitSha}</span>}
                {androidWorkspaceInfo.dirty && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300">dirty</span>}
                {androidWorkspaceInfo.versionCode != null && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">build {androidWorkspaceInfo.versionCode}</span>}
                {androidWorkspaceInfo.versionName && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">v{androidWorkspaceInfo.versionName}</span>}
              </div>
            )}
          </div>

          {/* Android build commands */}
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {(['test', 'assembleDebug', 'assembleRelease', 'bundleRelease'] as AndroidBuildCommandName[]).map((cmd) => (
                <button
                  key={cmd}
                  onClick={() => onAndroidStartCommand(cmd)}
                  disabled={activeAndroidBuildId !== null}
                  className="text-xs px-2.5 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 font-mono"
                >
                  {cmd}
                </button>
              ))}
              {activeAndroidBuildId && (
                <button onClick={onAndroidCancelCommand} className="text-xs px-2.5 py-1 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700">
                  Cancel {activeAndroidCommand}
                </button>
              )}
            </div>
            {androidLastBuildStatus && !activeAndroidBuildId && (
              <p className={`text-xs ${androidLastBuildStatus === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                {androidLastBuildStatus === 'success' ? '✓ Build succeeded' : `✗ Build ${androidLastBuildStatus}`}
              </p>
            )}
          </div>

          {/* Android live log */}
          {androidLogLines.length > 0 && (
            <BuildLog lines={androidLogLines} running={activeAndroidBuildId !== null} resizable />
          )}

          {/* Android build history */}
          {androidBuildRecords.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Recent builds</p>
              <div className="rounded border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                {androidBuildRecords.slice(0, 5).map((r) => {
                  const isExpanded = expandedAndroidHistoryId === r.id
                  const logLines = r.logTail ? r.logTail.split('\n') : []
                  return (
                    <div key={r.id}>
                      <button
                        type="button"
                        onClick={() => setExpandedAndroidHistoryId(isExpanded ? null : r.id)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-left hover:bg-gray-50 dark:hover:bg-gray-800/40"
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.status === 'success' ? 'bg-green-500' : r.status === 'running' ? 'bg-blue-500 animate-pulse' : 'bg-red-400'}`} />
                        <span className="font-mono text-gray-600 dark:text-gray-300 w-32 truncate">{r.command}</span>
                        <span className="text-gray-400">{r.branch ?? '—'}</span>
                        {r.versionCode != null && <span className="text-gray-400">build {r.versionCode}</span>}
                        <span className="text-gray-400 ml-auto">{r.finishedAt ? `${Math.round((r.finishedAt - r.startedAt) / 1000)}s` : '…'}</span>
                        {isExpanded ? <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" /> : <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />}
                      </button>
                      {isExpanded && (
                        <div className="px-3 pb-3 space-y-2 border-t border-gray-100 dark:border-gray-700">
                          {r.artifactPaths.length > 0 && (
                            <div className="text-[10px] text-gray-400 font-mono space-y-0.5">
                              {r.artifactPaths.map((artifactPath) => {
                                const checksum = r.artifactChecksums[artifactPath]
                                return (
                                  <p key={artifactPath} className="truncate">
                                    {checksum ? `${artifactPath} · sha256 ${checksum.slice(0, 12)}` : artifactPath}
                                  </p>
                                )
                              })}
                            </div>
                          )}
                          {logLines.length > 0 && (
                            <BuildLog lines={logLines} resizable={false} maxHeightPx={200} />
                          )}
                          <button
                            onClick={() => onAndroidStartCommand(r.command as AndroidBuildCommandName)}
                            disabled={activeAndroidBuildId !== null}
                            className="text-[11px] px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
                          >
                            Re-run {r.command}
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Signing config */}
          <div className="space-y-2 border-t border-gray-100 dark:border-gray-700 pt-3">
            <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Signing config</p>
            <div className="grid grid-cols-2 gap-2">
              <input type="text" value={signingDraft.keystorePath} onChange={(e) => onSetSigningDraft((d) => ({ ...d, keystorePath: e.target.value }))} placeholder="Keystore path" className="col-span-2 text-xs px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 font-mono" />
              <input type="password" value={signingDraft.keystorePassword} onChange={(e) => onSetSigningDraft((d) => ({ ...d, keystorePassword: e.target.value }))} placeholder="Keystore password" className="text-xs px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200" />
              <input type="text" value={signingDraft.keyAlias} onChange={(e) => onSetSigningDraft((d) => ({ ...d, keyAlias: e.target.value }))} placeholder="Key alias" className="text-xs px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200" />
              <input type="password" value={signingDraft.keyPassword} onChange={(e) => onSetSigningDraft((d) => ({ ...d, keyPassword: e.target.value }))} placeholder="Key password" className="text-xs px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200" />
            </div>
            <div className="flex gap-2">
              <button onClick={onSaveSigningConfig} className="text-xs px-2.5 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Save</button>
              <button onClick={onValidateSigningConfig} className="text-xs px-2.5 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Validate</button>
            </div>
            {signingValidation && (
              <div className="space-y-1">
                {signingValidation.map((c) => (
                  <div key={c.label} className="flex items-center gap-1.5 text-[11px]">
                    {c.status === 'ok' ? <CheckCircle className="w-3 h-3 text-green-500 shrink-0" /> : c.status === 'warn' ? <AlertTriangle className="w-3 h-3 text-yellow-500 shrink-0" /> : <XCircle className="w-3 h-3 text-red-500 shrink-0" />}
                    <span className="text-gray-700 dark:text-gray-300">{c.label}</span>
                    <span className="text-gray-400 ml-auto">{c.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ADB Install */}
          <div className="space-y-2 border-t border-gray-100 dark:border-gray-700 pt-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">ADB Install</p>
              <button onClick={onRefreshAdbDevices} className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Refresh</button>
            </div>
            {latestAdbInstallRecord && latestAdbInstallApk ? (
              <p className="text-[11px] text-gray-500">
                Ready to install {latestAdbInstallRecord.command} artifact: <span className="font-mono">{latestAdbInstallApk.split(/[\\/]/).pop()}</span>
              </p>
            ) : (
              <p className="text-[11px] text-gray-400">Run assembleDebug or assembleRelease successfully before installing over ADB.</p>
            )}
            {adbDevices.length === 0 ? (
              <p className="text-[11px] text-gray-400">No devices connected. Connect via USB and enable USB debugging.</p>
            ) : (
              <div className="space-y-1">
                {adbDevices.map((d) => (
                  <div key={d.serial} className="flex items-center gap-2 text-[11px]">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${d.state === 'device' ? 'bg-green-500' : 'bg-gray-400'}`} />
                    <span className="font-mono text-gray-600 dark:text-gray-300">{d.model ?? d.serial}</span>
                    <span className="text-gray-400 text-[10px]">{d.state}</span>
                    <button
                      onClick={() => onAndroidInstallApk(d.serial)}
                      disabled={adbInstalling || d.state !== 'device' || !latestAdbInstallApk}
                      className="ml-auto text-[10px] px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
                    >
                      Install APK
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Distribution options */}
          <details className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 border-t border-gray-100 dark:border-gray-700 mt-3">
            <summary className="cursor-pointer px-3 py-2 text-[10px] font-medium text-gray-500 uppercase tracking-wide select-none">
              Distribution Options
            </summary>
            <div className="px-3 pb-3 space-y-3 text-[11px] text-gray-600 dark:text-gray-400">
              <div>
                <p className="font-semibold text-gray-700 dark:text-gray-300 mb-0.5">LAN Feed (default)</p>
                <p>Run <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">assembleRelease</code>, then click Publish below. The Android app's Settings → Updates section detects the new version automatically when on the same network.</p>
              </div>
              <div>
                <p className="font-semibold text-gray-700 dark:text-gray-300 mb-0.5">Play Internal App Sharing</p>
                <p>Run <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">bundleRelease</code> to produce an <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">.aab</code> artifact. In the Google Play Console, open your app → Internal App Sharing → Upload bundle. Share the generated link with testers — no store review required.</p>
              </div>
              <div>
                <p className="font-semibold text-gray-700 dark:text-gray-300 mb-0.5">Private APK Distribution</p>
                <p>Share the signed <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">assembleRelease</code> APK directly (email, cloud storage, etc.) or host it on any HTTPS server. For OTA delivery through the companion app, serve the APK at a stable URL and publish a matching <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">android-update.json</code> manifest with the same schema.</p>
              </div>
            </div>
          </details>

          {/* Android update feed */}
          <div className="space-y-2 border-t border-gray-100 dark:border-gray-700 pt-3">
            <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Android Update Feed</p>
            <button
              onClick={onAndroidPublishUpdate}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Publish release APK to feed
            </button>
            {androidPublishResult && <p className="text-[11px] text-gray-500">{androidPublishResult}</p>}
            {androidUpdateManifest && (
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">build {androidUpdateManifest.versionCode}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">v{androidUpdateManifest.versionName}</span>
                {androidUpdateManifest.commitSha && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-mono">{androidUpdateManifest.commitSha}</span>}
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500">{new Date(androidUpdateManifest.publishedAt).toLocaleDateString()}</span>
              </div>
            )}
          </div>

          {/* Android version shelf */}
          {androidPublishHistory.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Published history</p>
              <div className="max-h-[130px] overflow-y-auto rounded border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                {androidPublishHistory.map((entry) => (
                  <div key={entry.versionCode} className="flex items-center gap-2 px-2.5 py-1.5 text-[10px]">
                    <div className="flex flex-wrap gap-1 items-center min-w-0 flex-1">
                      <span className="font-mono text-gray-700 dark:text-gray-300">v{entry.versionName}</span>
                      <span className="text-gray-400">(build {entry.versionCode})</span>
                      <span className="text-gray-400">{new Date(entry.publishedAt).toLocaleDateString()}</span>
                      {entry.commitSha && <span className="font-mono text-gray-400 text-[9px]">{entry.commitSha}</span>}
                    </div>
                    <button
                      onClick={() => onAndroidRestoreVersion(entry.versionCode)}
                      disabled={androidRestoring === entry.versionCode}
                      className="shrink-0 text-[10px] px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                    >
                      {androidRestoring === entry.versionCode ? 'Restoring…' : 'Restore'}
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-gray-400 italic">To install a previous version on device, uninstall the current app first, then tap Install update in the Android app after restoring.</p>
            </div>
          )}
        </div>
      )}

      {/* ================================================================
          SELF-HEAL TAB
      ================================================================ */}
      {developerTab === 'self-heal' && (
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

          {/* Active pipeline status */}
          {runningReportId !== null || fixRunning !== null || verificationRunning !== null || gitRunning !== null || recoveryRunning !== null ? (
            <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-3 py-2">
              <p className="text-[11px] font-medium text-blue-700 dark:text-blue-300 mb-1.5">Active pipeline</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {(['Investigating', 'Fixing', 'Verifying', 'Git', 'Reloading'] as const).map((step, idx) => {
                  const active =
                    (idx === 0 && runningReportId !== null) ||
                    (idx === 1 && fixRunning !== null) ||
                    (idx === 2 && verificationRunning !== null) ||
                    (idx === 3 && gitRunning !== null) ||
                    (idx === 4 && recoveryRunning !== null)
                  return (
                    <span key={step} className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      active
                        ? 'bg-blue-600 text-white animate-pulse'
                        : 'bg-blue-100 dark:bg-blue-900/40 text-blue-500 dark:text-blue-400'
                    }`}>{step}</span>
                  )
                })}
              </div>
            </div>
          ) : null}

          {/* Self-heal investigation */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
              <div>
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Self-heal investigations</p>
                <p className="text-[11px] text-gray-500">Review bug reports and generate root-cause investigation notes.</p>
              </div>
              <button
                onClick={() => void loadReports()}
                className="text-[11px] px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Refresh
              </button>
            </div>
            <div className="grid gap-0 md:grid-cols-[260px_1fr]">
              <div className="border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-700">
                <div className="p-3 space-y-2 border-b border-gray-100 dark:border-gray-800">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[11px] text-gray-500">
                      Backend
                      <select
                        value={investigationSettings.backend}
                        onChange={(event) => setInvestigationSettings((s) => ({ ...s, backend: event.target.value === 'claude-cli' ? 'claude-cli' : 'byok' }))}
                        className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                      >
                        <option value="byok">BYOK</option>
                        <option value="claude-cli">Claude CLI</option>
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
                  <label className="text-[11px] text-gray-500">
                    Model
                    <input
                      value={investigationSettings.model}
                      onChange={(event) => setInvestigationSettings((s) => ({ ...s, model: event.target.value }))}
                      className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs font-mono dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-[11px] text-gray-500">
                    <input
                      type="checkbox"
                      checked={investigationSettings.autoApproveTools}
                      onChange={(event) => setInvestigationSettings((s) => ({ ...s, autoApproveTools: event.target.checked }))}
                    />
                    Auto-approve investigator tools
                  </label>
                  <button
                    onClick={() => void handleSaveInvestigationSettings()}
                    className="text-[11px] px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    Save settings
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {reports.length === 0 ? (
                    <p className="p-3 text-xs text-gray-400">No bug reports captured.</p>
                  ) : (
                    reports.map((report) => (
                      <button
                        key={report.id}
                        onClick={() => setSelectedReportId(report.id)}
                        className={`block w-full border-b border-gray-100 px-3 py-2 text-left text-xs dark:border-gray-800 ${
                          selectedReport?.id === report.id ? 'bg-blue-50 dark:bg-blue-950/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
                        }`}
                      >
                        <span className="block truncate font-medium text-gray-700 dark:text-gray-200">{report.title}</span>
                        <span className="mt-0.5 block text-[11px] text-gray-400">
                          {report.status} · {new Date(report.created_at).toLocaleString()}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
              <div className="min-h-72 p-3">
                {selectedReport ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-800 dark:text-gray-100">{selectedReport.title}</p>
                        <p className="mt-1 text-xs text-gray-500 break-words">{selectedReport.description || 'No description.'}</p>
                      </div>
                      <button
                        onClick={() => void handleStartInvestigation(selectedReport.id)}
                        disabled={runningReportId !== null}
                        className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 font-medium disabled:opacity-50"
                      >
                        {runningReportId === selectedReport.id ? 'Investigating...' : 'Investigate'}
                      </button>
                    </div>
                    {selectedReport.investigation_markdown && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => void handleReviewInvestigation(selectedReport.id, 'investigated')}
                          className="text-[11px] px-2 py-1 rounded-md border border-green-300 text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-300 dark:hover:bg-green-950/30"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => void handleReviewInvestigation(selectedReport.id, 'rejected')}
                          className="text-[11px] px-2 py-1 rounded-md border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/30"
                        >
                          Reject
                        </button>
                        <button
                          onClick={() => void handleStartInvestigation(selectedReport.id)}
                          disabled={runningReportId !== null}
                          className="text-[11px] px-2 py-1 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 disabled:opacity-50"
                        >
                          Revise
                        </button>
                      </div>
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

                    {selectedReport.status === 'investigated' && selectedReport.fix_status === 'none' && (
                      <div className="pt-1">
                        <button
                          onClick={() => void handleStartFix(selectedReport.id)}
                          disabled={fixRunning !== null}
                          className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
                        >
                          {fixRunning === selectedReport.id ? 'Generating fix...' : 'Generate Fix'}
                        </button>
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
              <div>
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Self-heal history</p>
                <p className="text-[11px] text-gray-500">Audit trail of all self-heal runs.</p>
              </div>
              <button
                onClick={() => void loadSelfHealHistory()}
                className="text-[11px] px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Refresh
              </button>
            </div>
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
          </div>
        </div>
      )}

      {/* ================================================================
          CONSOLE TAB
      ================================================================ */}
      {developerTab === 'console' && (
        <div className="space-y-3">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
              <div>
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Console</p>
                <p className="text-[11px] text-gray-500">Recent app errors and warnings captured inside Nexy.</p>
              </div>
              <div className="flex items-center gap-1.5">
                {(['all', 'error', 'warn', 'info'] as const).map((level) => (
                  <button
                    key={level}
                    onClick={() => setConsoleLevel(level)}
                    className={`text-[11px] px-2 py-1 rounded-md capitalize ${
                      consoleLevel === level
                        ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
                        : 'bg-white dark:bg-gray-900 text-gray-500 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    {level}
                  </button>
                ))}
                <button
                  onClick={() => void handleCopyConsole()}
                  disabled={filteredConsoleEntries.length === 0}
                  className="text-[11px] px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  Copy
                </button>
                <button
                  onClick={() => void handleClearConsole()}
                  disabled={consoleEntries.length === 0}
                  className="text-[11px] px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="max-h-[480px] overflow-y-auto bg-white dark:bg-gray-900">
              {filteredConsoleEntries.length === 0 ? (
                <p className="px-3 py-4 text-xs text-gray-400">
                  {consoleEntries.length === 0 ? 'No errors captured.' : 'No entries match this filter.'}
                </p>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {filteredConsoleEntries.map((entry) => (
                    <details key={entry.id} className="group">
                      <summary className="flex cursor-pointer items-start gap-2 px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-800/60">
                        <span className="shrink-0 font-mono text-[11px] text-gray-400">
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </span>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                          entry.level === 'error'
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                            : entry.level === 'warn'
                              ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
                              : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                        }`}>
                          {entry.level}
                        </span>
                        <span className="shrink-0 text-[11px] text-gray-400">{entry.source}</span>
                        <span className="min-w-0 flex-1 break-words text-gray-700 dark:text-gray-300">{entry.message}</span>
                      </summary>
                      {entry.stack && (
                        <pre className="mx-3 mb-2 overflow-x-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-[11px] text-gray-500 dark:bg-gray-950 dark:text-gray-400">
                          {entry.stack}
                        </pre>
                      )}
                    </details>
                  ))}
                </div>
              )}
            </div>
            {consoleStatus && (
              <p className="border-t border-gray-100 px-3 py-1.5 text-[11px] text-gray-400 dark:border-gray-800">
                {consoleStatus}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  )
}
