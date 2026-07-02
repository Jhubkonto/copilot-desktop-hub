import { Loader2, Trash2 } from 'lucide-react'
import type {
  ErrorReportEntry,
  RemoteEditGitPrepareResult,
  RemoteEditVerificationRun,
} from '@shared/types'
import { CODE_CHANGE_PHASE_LABELS, deriveCodeChangePhase, toCodeChangeRequest } from '@shared/code-changes'

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
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="max-h-[28rem] overflow-y-auto">
        {reports.length === 0 ? (
          <p className="p-3 text-xs text-gray-400">No change requests yet.</p>
        ) : (
          reports.map((report) => {
            const reportBusy = isReportBusy(report.id) ||
              report.status === 'investigating' ||
              report.fix_status === 'staging' ||
              report.fix_status === 'applying'
            const request = toCodeChangeRequest(report, { workspaceRoot })
            const phase = deriveCodeChangePhase(
              report,
              verificationRuns[report.id]?.[0] ?? null,
              gitPrepare[report.id]?.canCommit === false,
            )
            return (
              <div
                key={report.id}
                className={`group flex items-start gap-2 border-b border-gray-100 px-3 py-2 text-xs dark:border-gray-800 ${
                  selectedReportId === report.id ? 'bg-blue-50 dark:bg-blue-950/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
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
                  </span>
                  <span className="mt-0.5 block text-[11px] text-gray-400">
                    {reportBusy ? 'Working…' : CODE_CHANGE_PHASE_LABELS[phase]} · {new Date(request.createdAt).toLocaleString()}
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
    </div>
  )
}
