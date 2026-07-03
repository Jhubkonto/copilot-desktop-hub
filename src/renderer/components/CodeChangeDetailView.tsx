import { useState, type ReactNode } from 'react'
import type {
  AvailableModelEntry,
  AvailableModelGroup,
  CatalogModel,
  CodeChangeRequest,
  CodeChangeRequestPhase,
  ErrorReportEntry,
  RemoteEditBackend,
  RemoteEditInvestigationActivity,
  RemoteEditInvestigationSettings,
} from '@shared/types'
import { CODE_CHANGE_PHASE_GUIDANCE, CODE_CHANGE_PHASE_LABELS, hasWorkspaceMismatch } from '@shared/code-changes'
import { Button } from './ui/primitives'
import { ModelPicker } from './chat/ModelPicker'
import { CodeChangeInvestigationSection } from './CodeChangeInvestigationSection'

interface CollapsibleStepProps {
  collapsed: boolean
  onToggleCollapsed: () => void
  summary: ReactNode
  children: ReactNode
}

function CollapsibleStep({ collapsed, onToggleCollapsed, summary, children }: CollapsibleStepProps) {
  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-700">
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="flex w-full items-center gap-1.5 rounded-t-md px-3 py-2 text-left text-[11px] font-semibold text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
      >
        <span className="text-gray-400 dark:text-gray-500">{collapsed ? '▸' : '▾'}</span>
        {summary}
      </button>
      {!collapsed && <div className="space-y-2 border-t border-gray-200 p-3 dark:border-gray-700">{children}</div>}
    </div>
  )
}

interface CodeChangeDetailViewProps {
  report: ErrorReportEntry
  request: CodeChangeRequest | null
  phase: CodeChangeRequestPhase | null
  phaseBar: ReactNode
  runningReportId: string | null
  onStartInvestigation: () => void
  isWorkspaceConnected: boolean
  currentWorkspaceRoot: string | null
  onRequestDelete: () => void
  reportBusy: boolean
  deleting: boolean
  investigationActivity: RemoteEditInvestigationActivity[]
  investigationOutput: string | undefined
  reviewAction: 'accept' | 'reject' | 'revise' | null
  investigationStatus: string | null
  onAcceptInvestigation: () => void
  onRejectInvestigation: () => void
  onReviseInvestigation: (notes: string) => void
  onGeneratePatch: () => void
  fixRunning: string | null
  diffViewer: ReactNode
  investigationSettings: RemoteEditInvestigationSettings
  onSetInvestigationSettings: (updater: (settings: RemoteEditInvestigationSettings) => RemoteEditInvestigationSettings) => void
  onSetBackend: (backend: RemoteEditBackend) => void
  backendOptions: Array<{ value: RemoteEditBackend; label: string }>
  remoteEditModelGroups: AvailableModelGroup[]
  selectedModelSourceLabel: string | undefined
  catalogModels: CatalogModel[]
  onSelectRemoteEditModel: (group: AvailableModelGroup, model: AvailableModelEntry) => void
  onSaveInvestigationSettings: () => void
  investigationStepCollapsed: boolean
  onToggleInvestigationStepCollapsed: () => void
  reviseModelPicker: ReactNode
}

export function CodeChangeDetailView({
  report,
  request,
  phase,
  phaseBar,
  runningReportId,
  onStartInvestigation,
  isWorkspaceConnected,
  currentWorkspaceRoot,
  onRequestDelete,
  reportBusy,
  deleting,
  investigationActivity,
  investigationOutput,
  reviewAction,
  investigationStatus,
  onAcceptInvestigation,
  onRejectInvestigation,
  onReviseInvestigation,
  onGeneratePatch,
  fixRunning,
  diffViewer,
  investigationSettings,
  onSetInvestigationSettings,
  onSetBackend,
  backendOptions,
  remoteEditModelGroups,
  selectedModelSourceLabel,
  catalogModels,
  onSelectRemoteEditModel,
  onSaveInvestigationSettings,
  investigationStepCollapsed,
  onToggleInvestigationStepCollapsed,
  reviseModelPicker,
}: CodeChangeDetailViewProps) {
  const workspaceMismatch = hasWorkspaceMismatch(request?.workspaceRoot ?? null, currentWorkspaceRoot)
  const planFailed = report.status === 'open' && report.investigation_root_cause === 'investigation_failed'
  const isRunningNow = runningReportId === report.id
  const resumedInBackground = !isRunningNow && report.status === 'investigating' && investigationActivity.length === 0 && !report.investigation_markdown
  const investigationStarted = (isRunningNow || report.status !== 'open' || Boolean(report.investigation_markdown) || investigationActivity.length > 0) && !planFailed
  const patchStarted = report.fix_status !== 'none'
  const planFailureMessage = report.investigation_markdown?.split('# Planning failed\n\n')[1]?.trim()
  const [planContentCollapsed, setPlanContentCollapsed] = useState(false)

  return (
    <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="space-y-3">
        {phase && phaseBar}
        {phase && (
          <div className="rounded-md border-l-4 border-blue-500 bg-blue-50 px-3 py-2 dark:bg-blue-950/30">
            <p className="text-[11px] font-semibold text-blue-900 dark:text-blue-200">
              Next step: {CODE_CHANGE_PHASE_LABELS[phase]}
            </p>
            <p className="mt-0.5 text-[11px] text-blue-800 dark:text-blue-300">
              {CODE_CHANGE_PHASE_GUIDANCE[phase]}
            </p>
          </div>
        )}
        {workspaceMismatch && (
          <div className="rounded-md border-l-4 border-amber-500 bg-amber-50 px-3 py-2 dark:bg-amber-950/30">
            <p className="text-[11px] font-semibold text-amber-900 dark:text-amber-200">Workspace mismatch</p>
            <p className="mt-0.5 text-[11px] text-amber-800 dark:text-amber-300">
              This request targets <span className="font-mono">{request?.workspaceRoot}</span>, but the connected workspace is now <span className="font-mono">{currentWorkspaceRoot}</span>. Apply, verify, and commit actions run against the currently connected workspace.
            </p>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-start justify-between gap-2 border-t border-gray-200 pt-3 dark:border-gray-700">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-50">{request?.title}</p>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400 break-words">{request?.description || 'No description.'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(!investigationStarted || isRunningNow || resumedInBackground) && (
            <Button
              variant="primary"
              onClick={onStartInvestigation}
              disabled={runningReportId !== null || resumedInBackground || !isWorkspaceConnected}
            >
              {(isRunningNow && reviewAction !== 'revise') || resumedInBackground
                ? 'Planning...'
                : planFailed ? 'Retry' : 'Plan'}
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={onRequestDelete}
            disabled={reportBusy}
            className="border-red-300 px-2 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
            title={reportBusy ? 'Wait for the current Code Changes action to finish before deleting' : 'Delete request'}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </div>

      {planFailed && (
        <div className="rounded-md border-l-4 border-red-500 bg-red-50 px-3 py-2 dark:bg-red-950/30">
          <p className="text-[11px] font-semibold text-red-900 dark:text-red-200">Planning failed</p>
          <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-red-800 dark:text-red-300">
            {planFailureMessage || 'The plan could not be generated.'}
          </p>
        </div>
      )}

      {resumedInBackground && (
        <div className="flex items-center gap-2 rounded-md border-l-4 border-blue-500 bg-blue-50 px-3 py-2 dark:bg-blue-950/30">
          <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
          <p className="text-[11px] text-blue-800 dark:text-blue-300">
            Planning is still running in the background. Reopen this request in a moment to see progress.
          </p>
        </div>
      )}

      {!investigationStarted && !isRunningNow && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/60">
          <p className="mb-2 text-[11px] font-semibold text-gray-700 dark:text-gray-200">Planning settings</p>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="text-[11px] text-gray-600 dark:text-gray-400">
              Backend
              <select
                value={investigationSettings.backend}
                onChange={(event) => onSetBackend(event.target.value as RemoteEditBackend)}
                className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              >
                {backendOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="text-[11px] text-gray-600 dark:text-gray-400">
              Retries
              <input
                type="number"
                min={0}
                max={5}
                value={investigationSettings.retryLimit}
                onChange={(event) => onSetInvestigationSettings((s) => ({ ...s, retryLimit: Number(event.target.value) }))}
                className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              />
            </label>
          </div>
          <div className="mt-2 text-[11px] text-gray-600 dark:text-gray-400">
            <p>Model</p>
            <ModelPicker
              value={investigationSettings.model}
              sourceLabel={selectedModelSourceLabel}
              availableGroups={remoteEditModelGroups}
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
              onSelectAvailableModel={onSelectRemoteEditModel}
            />
          </div>
          <label className="mt-2 flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={investigationSettings.autoApproveTools}
              onChange={(event) => onSetInvestigationSettings((s) => ({ ...s, autoApproveTools: event.target.checked }))}
            />
            Auto-approve investigator tools
          </label>
          <Button
            variant="secondary"
            onClick={onSaveInvestigationSettings}
            className="mt-2 text-[11px] px-2 py-1"
          >
            Save settings
          </Button>
        </div>
      )}

      {investigationStarted && !patchStarted && (
        <div id="code-change-plan-section" className="scroll-mt-3">
          <CodeChangeInvestigationSection
            report={report}
            activity={investigationActivity}
            output={investigationOutput}
            collapsed={planContentCollapsed}
            onToggleCollapsed={() => setPlanContentCollapsed((collapsed) => !collapsed)}
            reviewAction={reviewAction}
            runningReportId={runningReportId}
            investigationStatus={investigationStatus}
            onAccept={onAcceptInvestigation}
            onReject={onRejectInvestigation}
            onRevise={onReviseInvestigation}
            reviseModelPicker={reviseModelPicker}
          />
        </div>
      )}

      {investigationStarted && patchStarted && (
        <div id="code-change-plan-section" className="scroll-mt-3">
          <CollapsibleStep
            collapsed={investigationStepCollapsed}
            onToggleCollapsed={onToggleInvestigationStepCollapsed}
            summary={<span>Planning complete{report.status === 'rejected' ? ' — rejected' : ''}</span>}
          >
            <CodeChangeInvestigationSection
              report={report}
              activity={investigationActivity}
              output={investigationOutput}
              collapsed={false}
              onToggleCollapsed={() => {}}
              hideToggle
              reviewAction={reviewAction}
              runningReportId={runningReportId}
              investigationStatus={investigationStatus}
              onAccept={onAcceptInvestigation}
              onReject={onRejectInvestigation}
              onRevise={onReviseInvestigation}
              reviseModelPicker={reviseModelPicker}
            />
          </CollapsibleStep>
        </div>
      )}

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

      {patchStarted && diffViewer}
    </div>
  )
}
