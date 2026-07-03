import type { ReactNode } from 'react'
import { useState } from 'react'
import { Maximize2 } from 'lucide-react'
import type { ErrorReportEntry, RemoteEditInvestigationActivity } from '@shared/types'
import { Button, ModalShell } from './ui/primitives'
import { RevisePlanControl } from './RevisePlanControl'
import { PlanCard, parseAffectedFiles, stripFrontMatter } from './CodeChangePlanPreview'

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
  reviseModelPicker?: ReactNode
  hideToggle?: boolean
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
  reviseModelPicker,
  hideToggle,
}: CodeChangeInvestigationSectionProps) {
  const [planExpanded, setPlanExpanded] = useState(false)
  const isRunningNow = runningReportId === report.id
  const hasContent = Boolean(report.investigation_markdown) || activity.length > 0
  const affectedFiles = parseAffectedFiles(report)
  const planHasNoFiles = (report.status === 'investigating' || report.status === 'rejected') && Boolean(report.investigation_markdown) && affectedFiles.length === 0
  // Only the persisted report has parsed confidence/root_cause fields — the live `output` stream
  // during an active run hasn't been through persistResult() yet, so show the raw stream as-is and
  // reserve the structured summary for the finalized plan.
  const showSummary = !output && Boolean(report.investigation_markdown)
  const displayedBody = output ? output : report.investigation_markdown ? stripFrontMatter(report.investigation_markdown) : null
  const planPreview = displayedBody ? (
    <PlanCard report={report} affectedFiles={affectedFiles} showSummary={showSummary} body={displayedBody} />
  ) : undefined

  return (
    <>
      {hasContent && !hideToggle && (
        <Button
          variant="ghost"
          onClick={onToggleCollapsed}
          className="px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
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
                  className="text-[11px] px-3 py-1.5 rounded-md bg-green-600 text-white font-medium hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-green-700 dark:hover:bg-green-600"
                >
                  {reviewAction === 'accept' ? 'Accepting...' : 'Accept'}
                </button>
                <Button
                  variant="secondary"
                  onClick={onReject}
                  disabled={reviewAction !== null || runningReportId !== null}
                  className="border-red-300 text-[11px] px-3 py-1.5 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
                >
                  {reviewAction === 'reject' ? 'Rejecting...' : 'Reject'}
                </Button>
                <RevisePlanControl
                  reportId={report.id}
                  projectId={report.project_id}
                  disabled={runningReportId !== null}
                  running={reviewAction === 'revise' && runningReportId === report.id}
                  onRevise={(_reportId, notes) => onRevise(notes)}
                  modelPicker={reviseModelPicker}
                  planPreview={planPreview}
                />
              </div>
            </>
          )}
          {report.investigation_markdown && report.status === 'rejected' && !isRunningNow && (
            <div className="space-y-2 rounded-md border-l-4 border-red-500 bg-red-50 px-3 py-2 dark:bg-red-950/30">
              <p className="text-[11px] font-semibold text-red-800 dark:text-red-300">
                Plan rejected. Revise it with new instructions, delete this request, or accept the plan as-is if you've changed your mind.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-red-400 dark:text-red-500" aria-hidden="true">→</span>
                <RevisePlanControl
                  reportId={report.id}
                  projectId={report.project_id}
                  disabled={runningReportId !== null}
                  running={reviewAction === 'revise' && runningReportId === report.id}
                  onRevise={(_reportId, notes) => onRevise(notes)}
                  modelPicker={reviseModelPicker}
                  planPreview={planPreview}
                  triggerClassName="text-[11px] px-3 py-1.5 rounded-md bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-50 dark:bg-red-700 dark:hover:bg-red-600"
                />
                <button
                  onClick={onAccept}
                  disabled={reviewAction !== null || runningReportId !== null || planHasNoFiles}
                  title={planHasNoFiles ? "This plan has no affected files — revise it instead of accepting" : "Undo the rejection and accept this plan as-is"}
                  className="text-[11px] px-3 py-1.5 rounded-md border border-red-300 text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/50"
                >
                  {reviewAction === 'accept' ? 'Accepting...' : 'Accept anyway'}
                </button>
              </div>
            </div>
          )}
          {isRunningNow && activity.length === 0 && !output && (
            <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-800/60">
              <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
              <p className="text-[11px] text-gray-600 dark:text-gray-400">Starting...</p>
            </div>
          )}
          {activity.length > 0 && (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-800/60">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-600 dark:text-gray-300">
                {isRunningNow && (
                  <span className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
                )}
                Activity
              </p>
              <div className="mt-1 space-y-1">
                {activity.slice(-6).map((entry, index) => (
                  <p key={`${entry.label}-${index}`} className="text-[11px] text-gray-600 dark:text-gray-400">
                    {entry.type === 'thinking' ? 'Thinking' : entry.label}
                  </p>
                ))}
              </div>
            </div>
          )}
          {(output || report.investigation_markdown || !isRunningNow) && (
            <PlanCard
              report={report}
              affectedFiles={affectedFiles}
              showSummary={showSummary}
              body={displayedBody || 'No plan has been created yet.'}
              className="relative space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-950/60"
              bodyClassName="max-h-96 overflow-auto pr-9 text-xs"
              actions={displayedBody && (
                <button
                  type="button"
                  onClick={() => setPlanExpanded(true)}
                  className="rounded-md border border-gray-300 bg-white p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                  aria-label="Expand plan"
                  title="Expand plan"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>
              )}
            />
          )}
          {planExpanded && (
            <ModalShell
              title="Plan"
              ariaLabel="Expanded plan"
              maxWidth="max-w-4xl"
              bodyClassName="flex-1 min-h-0 overflow-y-auto p-5"
              onClose={() => setPlanExpanded(false)}
            >
              <PlanCard
                report={report}
                affectedFiles={affectedFiles}
                showSummary={showSummary}
                body={displayedBody ?? ''}
                className="space-y-3"
              />
            </ModalShell>
          )}
          {investigationStatus && <p className="text-[11px] text-gray-500 dark:text-gray-400">{investigationStatus}</p>}
        </div>
      )}
    </>
  )
}
