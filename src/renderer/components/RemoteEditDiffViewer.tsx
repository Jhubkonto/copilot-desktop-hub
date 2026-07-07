import type { ReactNode } from 'react'
import type {
  ErrorReportEntry,
  RemoteEditGitPrepareResult,
  RemoteEditRecoveryRun,
  RemoteEditStagedFileDiff,
  RemoteEditStagedFileEntry,
  RemoteEditVerificationRun,
  RemoteEditVerificationStep,
} from '@shared/types'
import { Button } from './ui/primitives'
import { RevisePlanControl } from './RevisePlanControl'
import { PlanPreview } from './CodeChangePlanPreview'

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
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800/60"
      >
        <span>{collapsed ? '▸' : '▾'}</span>
        {title}
      </button>
      {!collapsed && <div className="border-t border-gray-100 p-3 space-y-3 dark:border-gray-800">{children}</div>}
    </div>
  )
}

export function RemoteEditDiffViewer({
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
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
              Staged patch
              {' '}
              <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs font-medium ${
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
                  className="text-xs px-2 py-1 rounded-md border border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/30 disabled:opacity-50"
                >
                  {fixRunning === report.id ? 'Generating...' : 'Regenerate patch'}
                </button>
              </div>
            ) : null}
          </div>

          {report.fix_status === 'staging' && (
            <p className="text-xs text-gray-400">{fixStatus ?? 'Generating patch...'}</p>
          )}

          {report.fix_status === 'failed' && (
            <p className="text-xs text-red-600 dark:text-red-400">
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
                      <span className="flex-1 truncate font-mono text-xs text-gray-700 dark:text-gray-300">{file.relativePath}</span>
                      {reviewed && (
                        <span className="text-xs text-green-600 dark:text-green-400 font-medium">✓ Reviewed</span>
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
                        className="text-xs px-2 py-0.5"
                      >
                        {isExpanded ? 'Hide diff' : 'View diff'}
                      </Button>
                      {!reviewed && !isApplied && (
                        <button
                          onClick={() => onMarkReviewed(file.relativePath)}
                          className="text-xs px-2 py-0.5 rounded border border-green-300 text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-300 dark:hover:bg-green-950/30"
                        >
                          Mark reviewed
                        </button>
                      )}
                      {!isApplied && (
                        <Button
                          variant="danger"
                          onClick={() => void onRevertFile(report.id, file.relativePath)}
                          className="text-xs px-2 py-0.5"
                        >
                          Revert
                        </Button>
                      )}
                    </div>

                    {isExpanded && diff && (
                      <div className="max-h-80 overflow-auto font-mono text-xs leading-relaxed">
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
                      <div className="px-3 py-2 text-xs text-gray-400">Loading diff...</div>
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
                <p className="text-xs text-gray-400">Review all files before applying</p>
              )}
            </div>
          )}

          {fixStatus && report.fix_status !== 'applied' && (
            <p className="text-xs text-gray-400">{fixStatus}</p>
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
            <p className="text-xs text-green-600 dark:text-green-400">Selected changes applied to the workspace. Backups were saved.</p>
            <button
              onClick={() => void onStartVerification(report.id)}
              disabled={verificationRunning !== null}
              className="text-xs px-2 py-1 rounded-md border border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/30 disabled:opacity-50"
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
                    <span className="flex-1 text-xs font-medium text-gray-700 dark:text-gray-300">{step.command}</span>
                    <span className={`text-xs font-medium ${statusClass(step.status)}`}>{step.status}</span>
                  </Button>
                  {isExpanded && (
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap bg-white px-3 py-2 font-mono text-xs text-gray-600 dark:bg-gray-950 dark:text-gray-300">
                      {step.log || 'No log output yet.'}
                    </pre>
                  )}
                </div>
              )
            })}
          </div>

          {verificationFailed && (
            <div className="space-y-2 rounded border border-red-200 bg-red-50/60 p-3 dark:border-red-900 dark:bg-red-950/20">
              <p className="text-xs text-red-600 dark:text-red-400">{verificationRun?.error ?? 'Verification failed.'}</p>
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
                  className="text-xs px-2 py-1 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {fixRunning === report.id ? 'Generating...' : 'Revise patch'}
                </button>
                <button
                  onClick={() => void onStartVerification(report.id)}
                  disabled={verificationRunning !== null}
                  className="text-xs px-2 py-1 rounded-md border border-red-300 text-red-700 hover:bg-red-100 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40 disabled:opacity-50"
                >
                  {verificationRunning === report.id ? 'Verifying...' : 'Re-run verification'}
                </button>
              </div>
            </div>
          )}

          {recoveryRun?.status === 'rolled-back' ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Change undone. Files restored to their state before this change was applied.
            </p>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded border border-gray-200 p-2 dark:border-gray-700">
              <p className="text-xs text-gray-500">
                Restore the affected files to their state before this change was applied.
              </p>
              <Button
                variant="danger"
                onClick={() => void onUndoChange(report.id)}
                disabled={recoveryRunning}
                className="text-xs px-2 py-1"
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
              <p className="text-xs font-medium text-green-700 dark:text-green-300">Verification passed. Ready for git review.</p>
              {gitPrepare?.status && (
                <p className="mt-0.5 text-xs text-gray-500">
                  {gitPrepare.status.branch ?? 'detached'} · {gitPrepare.status.files.length} changed file{gitPrepare.status.files.length === 1 ? '' : 's'}
                  {gitPrepare.status.ahead > 0 ? ` · ahead ${gitPrepare.status.ahead}` : ''}
                </p>
              )}
            </div>
            <button
              onClick={() => void onPrepareGitCommit(report.id)}
              disabled={gitRunning !== null}
              className="text-xs px-2 py-1 rounded-md border border-green-300 text-green-700 hover:bg-green-100 dark:border-green-800 dark:text-green-300 dark:hover:bg-green-950/40 disabled:opacity-50"
            >
              {gitRunning === 'prepare' ? 'Checking...' : 'Check git'}
            </button>
          </div>

          {gitPrepare && (
            <div className="space-y-2">
              {gitPrepare.reason && (
                <p className="text-xs text-red-600 dark:text-red-400">{gitPrepare.reason}</p>
              )}
              {gitPrepare.authHelp && (
                <p className="text-xs text-amber-700 dark:text-amber-300">{gitPrepare.authHelp}</p>
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
                  className="text-xs px-2 py-1"
                >
                  {gitRunning === 'commit' ? 'Committing...' : 'Commit changes'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void onPushGitFix(report.id)}
                  disabled={gitRunning !== null || !gitPrepare.status.isRepo}
                  className="text-xs px-2 py-1"
                >
                  {gitRunning === 'push' ? 'Pushing...' : 'Push'}
                </Button>
              </div>
              {gitPrepare.files.length > 0 && (
                <div className="max-h-24 overflow-auto rounded bg-white px-2 py-1 dark:bg-gray-950">
                  {gitPrepare.files.map((file) => (
                    <p key={file} className="truncate font-mono text-xs text-gray-500">{file}</p>
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
          <p className="text-xs font-medium text-green-700 dark:text-green-300">
            Changes committed{gitPrepare?.status.branch ? ` to ${gitPrepare.status.branch}` : ''}.
          </p>
          <button
            onClick={() => void onPushGitFix(report.id)}
            disabled={gitRunning !== null || !gitPrepare?.status.isRepo}
            className="text-xs px-2 py-1 rounded-md border border-green-300 text-green-700 hover:bg-green-100 dark:border-green-800 dark:text-green-300 dark:hover:bg-green-950/40 disabled:opacity-50"
          >
            {gitRunning === 'push' ? 'Pushing...' : 'Push'}
          </button>
        </PhaseSection>
      )}
    </div>
  )
}
