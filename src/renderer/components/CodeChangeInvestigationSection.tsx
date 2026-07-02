import type { ErrorReportEntry, RemoteEditInvestigationActivity } from '@shared/types'
import { Button } from './ui/primitives'

interface CodeChangeInvestigationSectionProps {
  report: ErrorReportEntry
  activity: RemoteEditInvestigationActivity[]
  output: string | undefined
  collapsed: boolean
  onToggleCollapsed: () => void
  reviewAction: 'accept' | 'reject' | 'revise' | null
  runningReportId: string | null
  investigationStatus: string | null
  onAccept: () => void
  onReject: () => void
  onRevise: () => void
}

export function CodeChangeInvestigationSection({
  report,
  activity,
  output,
  collapsed,
  onToggleCollapsed,
  reviewAction,
  runningReportId,
  investigationStatus,
  onAccept,
  onReject,
  onRevise,
}: CodeChangeInvestigationSectionProps) {
  const hasContent = Boolean(report.investigation_markdown) || activity.length > 0

  return (
    <>
      {hasContent && (
        <Button
          variant="ghost"
          onClick={onToggleCollapsed}
          className="px-0 py-0 text-[11px]"
        >
          {collapsed ? '▸ Show investigation' : '▾ Hide investigation'}
        </Button>
      )}
      {!collapsed && (
        <>
          {report.investigation_markdown && report.status === 'investigating' && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={onAccept}
                disabled={reviewAction !== null || runningReportId !== null}
                className="text-[11px] px-2 py-1 rounded-md border border-green-300 text-green-700 hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-green-800 dark:text-green-300 dark:hover:bg-green-950/30"
              >
                {reviewAction === 'accept' ? 'Accepting...' : 'Accept'}
              </button>
              <Button
                variant="danger"
                onClick={onReject}
                disabled={reviewAction !== null || runningReportId !== null}
                className="text-[11px] px-2 py-1"
              >
                {reviewAction === 'reject' ? 'Rejecting...' : 'Reject'}
              </Button>
              <Button
                variant="secondary"
                onClick={onRevise}
                disabled={runningReportId !== null}
                className="text-[11px] px-2 py-1"
              >
                {reviewAction === 'revise' ? 'Revising...' : 'Revise'}
              </Button>
            </div>
          )}
          {report.investigation_markdown && report.status === 'rejected' && (
            <p className="text-[11px] font-medium text-red-600 dark:text-red-400">Investigation rejected.</p>
          )}
          {activity.length > 0 && (
            <div className="rounded border border-gray-200 p-2 dark:border-gray-700">
              <p className="text-[11px] font-medium text-gray-500">Activity</p>
              <div className="mt-1 space-y-1">
                {activity.slice(-6).map((entry, index) => (
                  <p key={`${entry.label}-${index}`} className="text-[11px] text-gray-500">
                    {entry.type === 'thinking' ? 'Thinking' : entry.label}
                  </p>
                ))}
              </div>
            </div>
          )}
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-700 dark:bg-gray-950/50 dark:text-gray-300">
            {output || report.investigation_markdown || 'No analysis has been run yet.'}
          </pre>
          {investigationStatus && <p className="text-[11px] text-gray-400">{investigationStatus}</p>}
        </>
      )}
    </>
  )
}
