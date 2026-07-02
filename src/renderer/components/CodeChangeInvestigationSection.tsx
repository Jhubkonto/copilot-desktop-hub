import type { ErrorReportEntry, RemoteEditInvestigationActivity } from '@shared/types'
import { Button } from './ui/primitives'
import { RevisePlanControl } from './RevisePlanControl'

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
  onRevise: (notes: string) => void
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
  const isRunningNow = runningReportId === report.id
  const hasContent = Boolean(report.investigation_markdown) || activity.length > 0
  const affectedFiles: string[] = (() => {
    try { return JSON.parse(report.investigation_affected_files || '[]') } catch { return [] }
  })()
  const planHasNoFiles = report.status === 'investigating' && Boolean(report.investigation_markdown) && affectedFiles.length === 0

  return (
    <>
      {hasContent && (
        <Button
          variant="ghost"
          onClick={onToggleCollapsed}
          className="px-0 py-0 text-[11px]"
        >
          {collapsed ? '▸ Show plan' : '▾ Hide plan'}
        </Button>
      )}
      {!collapsed && (
        <div className="mt-2 space-y-2">
          {report.investigation_markdown && report.status === 'investigating' && (
            <>
              {planHasNoFiles && (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/20">
                  <p className="text-[11px] font-medium text-amber-800 dark:text-amber-200">This plan didn't identify any files to change</p>
                  <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                    Generating a patch from this plan will fail. Review the plan below, then revise it or reject it — accepting won't help without a file list.
                  </p>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={onAccept}
                  disabled={reviewAction !== null || runningReportId !== null || planHasNoFiles}
                  title={planHasNoFiles ? "This plan has no affected files — revise it instead of accepting" : undefined}
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
                <RevisePlanControl
                  reportId={report.id}
                  disabled={runningReportId !== null}
                  running={reviewAction === 'revise' && runningReportId === report.id}
                  onRevise={(_reportId, notes) => onRevise(notes)}
                />
              </div>
            </>
          )}
          {report.investigation_markdown && report.status === 'rejected' && (
            <p className="text-[11px] font-medium text-red-600 dark:text-red-400">Plan rejected.</p>
          )}
          {isRunningNow && activity.length === 0 && !output && (
            <div className="flex items-center gap-2 rounded border border-gray-200 p-2 dark:border-gray-700">
              <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
              <p className="text-[11px] text-gray-500">Starting...</p>
            </div>
          )}
          {activity.length > 0 && (
            <div className="rounded border border-gray-200 p-2 dark:border-gray-700">
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500">
                {isRunningNow && (
                  <span className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
                )}
                Activity
              </p>
              <div className="mt-1 space-y-1">
                {activity.slice(-6).map((entry, index) => (
                  <p key={`${entry.label}-${index}`} className="text-[11px] text-gray-500">
                    {entry.type === 'thinking' ? 'Thinking' : entry.label}
                  </p>
                ))}
              </div>
            </div>
          )}
          {(output || report.investigation_markdown || !isRunningNow) && (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-700 dark:bg-gray-950/50 dark:text-gray-300">
              {output || report.investigation_markdown || 'No plan has been created yet.'}
            </pre>
          )}
          {investigationStatus && <p className="text-[11px] text-gray-400">{investigationStatus}</p>}
        </div>
      )}
    </>
  )
}
