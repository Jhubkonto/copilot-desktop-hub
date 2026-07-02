import type { ReactNode } from 'react'
import type { CodeChangeRequest, CodeChangeRequestPhase, ErrorReportEntry, RemoteEditInvestigationActivity } from '@shared/types'
import { CODE_CHANGE_PHASE_GUIDANCE, CODE_CHANGE_PHASE_LABELS } from '@shared/code-changes'
import { Button } from './ui/primitives'
import { CodeChangeInvestigationSection } from './CodeChangeInvestigationSection'

interface CodeChangeDetailViewProps {
  report: ErrorReportEntry
  request: CodeChangeRequest | null
  phase: CodeChangeRequestPhase | null
  phaseBar: ReactNode
  runningReportId: string | null
  onStartInvestigation: () => void
  isWorkspaceConnected: boolean
  onRequestDelete: () => void
  reportBusy: boolean
  deleting: boolean
  investigationActivity: RemoteEditInvestigationActivity[]
  investigationOutput: string | undefined
  investigationCollapsed: boolean
  onToggleInvestigationCollapsed: () => void
  reviewAction: 'accept' | 'reject' | 'revise' | null
  investigationStatus: string | null
  onAcceptInvestigation: () => void
  onRejectInvestigation: () => void
  onReviseInvestigation: () => void
  onGeneratePatch: () => void
  fixRunning: string | null
  diffViewer: ReactNode
}

export function CodeChangeDetailView({
  report,
  request,
  phase,
  phaseBar,
  runningReportId,
  onStartInvestigation,
  isWorkspaceConnected,
  onRequestDelete,
  reportBusy,
  deleting,
  investigationActivity,
  investigationOutput,
  investigationCollapsed,
  onToggleInvestigationCollapsed,
  reviewAction,
  investigationStatus,
  onAcceptInvestigation,
  onRejectInvestigation,
  onReviseInvestigation,
  onGeneratePatch,
  fixRunning,
  diffViewer,
}: CodeChangeDetailViewProps) {
  return (
    <div className="space-y-3">
      {phase && phaseBar}
      {phase && (
        <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 dark:border-blue-900 dark:bg-blue-950/20">
          <p className="text-[11px] font-medium text-blue-800 dark:text-blue-200">
            Next step: {CODE_CHANGE_PHASE_LABELS[phase]}
          </p>
          <p className="mt-0.5 text-[11px] text-blue-700 dark:text-blue-300">
            {CODE_CHANGE_PHASE_GUIDANCE[phase]}
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-800 dark:text-gray-100">{request?.title}</p>
          <p className="mt-1 text-xs text-gray-500 break-words">{request?.description || 'No description.'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={onStartInvestigation}
            disabled={runningReportId !== null || !isWorkspaceConnected}
          >
            {runningReportId === report.id && reviewAction !== 'revise' ? 'Analysing...' : 'Analyse'}
          </Button>
          <Button
            variant="danger"
            onClick={onRequestDelete}
            disabled={reportBusy}
            className="px-2"
            title={reportBusy ? 'Wait for the current Code Changes action to finish before deleting' : 'Delete request'}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </div>

      <CodeChangeInvestigationSection
        report={report}
        activity={investigationActivity}
        output={investigationOutput}
        collapsed={investigationCollapsed}
        onToggleCollapsed={onToggleInvestigationCollapsed}
        reviewAction={reviewAction}
        runningReportId={runningReportId}
        investigationStatus={investigationStatus}
        onAccept={onAcceptInvestigation}
        onReject={onRejectInvestigation}
        onRevise={onReviseInvestigation}
      />

      {report.status === 'investigated' && report.fix_status === 'none' && (
        <div className="pt-1">
          <Button
            variant="primary"
            onClick={onGeneratePatch}
            disabled={fixRunning !== null}
          >
            {fixRunning === report.id ? 'Generating patch...' : 'Generate staged patch'}
          </Button>
        </div>
      )}

      {['staging', 'staged', 'applying', 'applied', 'failed'].includes(report.fix_status) && diffViewer}
    </div>
  )
}
