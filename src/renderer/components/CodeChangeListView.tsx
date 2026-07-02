import { Trash2 } from 'lucide-react'
import type {
  AvailableModelEntry,
  AvailableModelGroup,
  CatalogModel,
  ErrorReportEntry,
  RemoteEditBackend,
  RemoteEditGitPrepareResult,
  RemoteEditInvestigationSettings,
  RemoteEditVerificationRun,
} from '@shared/types'
import { CODE_CHANGE_PHASE_LABELS, deriveCodeChangePhase, toCodeChangeRequest } from '@shared/code-changes'
import { Button } from './ui/primitives'
import { ModelPicker } from './chat/ModelPicker'

interface CodeChangeListViewProps {
  reports: ErrorReportEntry[]
  selectedReportId: string | null
  workspaceRoot: string | null
  verificationRuns: Record<string, RemoteEditVerificationRun[]>
  gitPrepare: Record<string, RemoteEditGitPrepareResult | null>
  isReportBusy: (reportId: string) => boolean
  onSelectReport: (reportId: string) => void
  onRequestDelete: (report: ErrorReportEntry) => void
  investigationSettings: RemoteEditInvestigationSettings
  onSetInvestigationSettings: (updater: (settings: RemoteEditInvestigationSettings) => RemoteEditInvestigationSettings) => void
  onSetBackend: (backend: RemoteEditBackend) => void
  backendOptions: Array<{ value: RemoteEditBackend; label: string }>
  remoteEditModelGroups: AvailableModelGroup[]
  selectedModelSourceLabel: string | undefined
  catalogModels: CatalogModel[]
  onSelectRemoteEditModel: (group: AvailableModelGroup, model: AvailableModelEntry) => void
  onSaveInvestigationSettings: () => void
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
  investigationSettings,
  onSetInvestigationSettings,
  onSetBackend,
  backendOptions,
  remoteEditModelGroups,
  selectedModelSourceLabel,
  catalogModels,
  onSelectRemoteEditModel,
  onSaveInvestigationSettings,
}: CodeChangeListViewProps) {
  return (
    <div className="border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-700">
      <div className="p-3 space-y-2 border-b border-gray-100 dark:border-gray-800">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-gray-500">
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
          <label className="text-[11px] text-gray-500">
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
        <div className="text-[11px] text-gray-500">
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
        <label className="flex items-center gap-2 text-[11px] text-gray-500">
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
          className="text-[11px] px-2 py-1"
        >
          Save settings
        </Button>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {reports.length === 0 ? (
          <p className="p-3 text-xs text-gray-400">No edit requests yet.</p>
        ) : (
          reports.map((report) => {
            const reportBusy = isReportBusy(report.id)
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
                  <span className="block truncate font-medium text-gray-700 dark:text-gray-200">{request.title}</span>
                  <span className="mt-0.5 block text-[11px] text-gray-400">
                    {CODE_CHANGE_PHASE_LABELS[phase]} · {new Date(request.createdAt).toLocaleString()}
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
