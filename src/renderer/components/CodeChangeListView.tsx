import { Loader2, Trash2 } from 'lucide-react'
import type {
  CodeChangeRequestPhase,
  ErrorReportEntry,
  RemoteEditGitPrepareResult,
  RemoteEditVerificationRun,
} from '@shared/types'
import { CODE_CHANGE_PHASE_LABELS, deriveCodeChangePhase, toCodeChangeRequest } from '@shared/code-changes'

// Mirrors PhaseBar's coloring (ui/primitives.tsx): green for phases that represent completed
// work, red for the failure phase, blue for the in-progress planning phase, gray otherwise.
const PHASE_BADGE_CLASSES: Record<CodeChangeRequestPhase, string> = {
  draft: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  investigating: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  'patch-ready': 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  'ready-to-apply': 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  applied: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  verifying: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  'ready-to-commit': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  committed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  'needs-attention': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

interface CodeChangeListViewProps {
  reports: ErrorReportEntry[]
  selectedReportId: string | null
  workspaceRoot: string | null
  verificationRuns: Record<string, RemoteEditVerificationRun[]>
  gitPrepare: Record<string, RemoteEditGitPrepareResult | null>
  isReportBusy: (reportId: string) => boolean
  onSelectReport: (reportId: string) => void
  onRequestDelete: (report: ErrorReportEntry) => void
}

export function CodeChangeListView({
  reports,
  selectedReportId,
  workspaceRoot,
  verificationRuns,
  gitPrepare,
  isReportBusy,
  onSelectReport,
  onRequestDelete,
}: CodeChangeListViewProps) {
  return (
    <div className="space-y-1">
      {reports.length === 0 ? (
        <p className="p-3 text-xs text-gray-400">No change requests yet.</p>
      ) : (
        reports.map((report) => {
            // A report can sit in status 'investigating' indefinitely once its plan is complete
            // (it stays there until the user explicitly accepts it) — that's not "running," it's
            // "awaiting review." Only treat it as genuinely still running in the background when
            // no plan has landed yet, matching CodeChangeDetailView's resumedInBackground check.
            const resumedInBackground = report.status === 'investigating' && !report.investigation_markdown
            const reportBusy = isReportBusy(report.id) || resumedInBackground
            const request = toCodeChangeRequest(report, { workspaceRoot })
            const phase = deriveCodeChangePhase(
              report,
              verificationRuns[report.id]?.[0] ?? null,
              gitPrepare[report.id]?.canCommit === false,
            )
            return (
              <div
                key={report.id}
                className={`group flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
                  selectedReportId === report.id ? 'bg-blue-50 dark:bg-blue-950/30' : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectReport(report.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="flex items-center gap-1.5">
                    {reportBusy && (
                      <span title="Working…"><Loader2 className="h-3 w-3 shrink-0 animate-spin text-blue-500" /></span>
                    )}
                    <span className="block truncate font-medium text-gray-700 dark:text-gray-200">{request.title}</span>
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${PHASE_BADGE_CLASSES[phase]}`}>
                      {CODE_CHANGE_PHASE_LABELS[phase]}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[11px] text-gray-400">
                    {reportBusy ? 'Working…' : new Date(request.createdAt).toLocaleString()}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onRequestDelete(report)
                  }}
                  disabled={reportBusy}
                  className="invisible shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40 group-hover:visible dark:hover:bg-red-900/20"
                  title={reportBusy ? 'Wait for the current Code Changes action to finish before deleting' : 'Delete request'}
                  aria-label={`Delete ${report.title}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            )
          })
      )}
    </div>
  )
}
