import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, CheckCircle, AlertTriangle, XCircle } from 'lucide-react'
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
  SelfHealInvestigationActivity,
  SelfHealInvestigationSettings,
  WorkspaceInfo,
} from '@shared/types'

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
  // FCM
  fcmStatus: { configured: boolean; projectId?: string } | null
  fcmJsonDraft: string
  fcmSaving: boolean
  onSetFcmJsonDraft: (v: string) => void
  debugLogging: boolean
  onToggleDebugLogging: () => void
  onSaveFcmServiceAccount: () => void
}

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
  fcmStatus, fcmJsonDraft, fcmSaving, onSetFcmJsonDraft,
  debugLogging, onToggleDebugLogging, onSaveFcmServiceAccount,
}: Props) {
  const [consoleEntries, setConsoleEntries] = useState<ErrorLogEntry[]>([])
  const [consoleLevel, setConsoleLevel] = useState<'all' | 'error' | 'warn' | 'info'>('all')
  const [consoleStatus, setConsoleStatus] = useState<string | null>(null)
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

  useEffect(() => {
    if (
      typeof window.api.listErrorReports !== 'function' ||
      typeof window.api.getInvestigationSettings !== 'function'
    ) {
      return
    }
    void loadReports()
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

  return (
    <>
      <div>
        <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Developer</p>
        <p className="text-xs text-gray-500 mt-0.5">Build, test, and package the app from within Nexy.</p>
      </div>

      {/* Debug logging */}
      <div className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <div>
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Debug logging</p>
          <p className="text-xs text-gray-500 mt-0.5">Enable verbose developer diagnostics in terminal, log file, and future console panel.</p>
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

      {/* Console */}
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
        <div className="max-h-56 overflow-y-auto bg-white dark:bg-gray-900">
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
              </div>
            ) : (
              <p className="text-xs text-gray-400">Select a bug report to investigate.</p>
            )}
          </div>
        </div>
      </div>

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
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
            <p className="text-xs font-medium text-gray-500">Output {activeBuildId && <span className="text-blue-500 animate-pulse">● running</span>}</p>
          </div>
          <pre className="p-3 text-xs font-mono text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/50 overflow-y-auto max-h-48 whitespace-pre-wrap break-words">
            {buildLogLines.join('\n')}
          </pre>
        </div>
      )}

      {/* Build history */}
      {buildRecords.length > 0 && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
            <p className="text-xs font-medium text-gray-500">Recent builds</p>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {buildRecords.map((rec) => (
              <div key={rec.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                <span className={`font-mono w-16 shrink-0 ${rec.status === 'success' ? 'text-green-600 dark:text-green-400' : rec.status === 'running' ? 'text-blue-500' : rec.status === 'cancelled' ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-500'}`}>
                  {rec.status}
                </span>
                <span className="font-mono text-gray-700 dark:text-gray-300 w-20 shrink-0">{rec.command}</span>
                <span className="text-gray-400 font-mono truncate">{rec.branch ?? '—'}</span>
                {rec.finishedAt && (
                  <span className="text-gray-400 ml-auto shrink-0">{Math.round((rec.finishedAt - rec.startedAt) / 1000)}s</span>
                )}
              </div>
            ))}
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
        {publishedEntries.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Published versions</p>
            {publishedEntries.map((entry) => (
              <div key={`${entry.version}-${String(entry.isBackup)}`} className="flex items-center gap-2 text-xs">
                <span className={`font-mono ${entry.isBackup ? 'text-gray-400' : 'text-gray-700 dark:text-gray-300'}`}>
                  v{entry.version}
                </span>
                {entry.isBackup && <span className="text-[11px] text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">backup</span>}
                <span className="text-gray-400 ml-auto text-[11px]">{new Date(entry.publishedAt).toLocaleDateString()}</span>
                {entry.isBackup && (
                  <button
                    onClick={() => onRollback(entry.version)}
                    className="text-[11px] px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    Reinstall
                  </button>
                )}
              </div>
            ))}
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

      {/* Android Build */}
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
          {androidLogLines.length > 0 && (
            <pre className="text-[10px] font-mono bg-gray-950 text-gray-200 rounded-lg p-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
              {androidLogLines.join('\n')}
            </pre>
          )}
        </div>

        {/* Android build history */}
        {androidBuildRecords.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Recent builds</p>
            <div className="space-y-1">
              {androidBuildRecords.slice(0, 5).map((r) => (
                <div key={r.id} className="space-y-0.5 text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.status === 'success' ? 'bg-green-500' : r.status === 'running' ? 'bg-blue-500 animate-pulse' : 'bg-red-400'}`} />
                    <span className="font-mono text-gray-600 dark:text-gray-300 w-32 truncate">{r.command}</span>
                    <span className="text-gray-400">{r.branch ?? '—'}</span>
                    {r.versionCode != null && <span className="text-gray-400">build {r.versionCode}</span>}
                    <span className="text-gray-400 ml-auto">{r.finishedAt ? `${Math.round((r.finishedAt - r.startedAt) / 1000)}s` : '…'}</span>
                  </div>
                  {r.artifactPaths.length > 0 && (
                    <div className="pl-3.5 text-[10px] text-gray-400 font-mono truncate">
                      {r.artifactPaths.map((artifactPath) => {
                        const checksum = r.artifactChecksums[artifactPath]
                        return checksum ? `${artifactPath} · sha256 ${checksum.slice(0, 12)}` : artifactPath
                      }).join(', ')}
                    </div>
                  )}
                </div>
              ))}
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

        {/* Published history + rollback */}
        {androidPublishHistory.length > 0 && (
          <details className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 border-t border-gray-100 dark:border-gray-700 mt-1">
            <summary className="cursor-pointer px-3 py-2 text-[10px] font-medium text-gray-500 uppercase tracking-wide select-none">
              Published History ({androidPublishHistory.length})
            </summary>
            <div className="px-3 pb-3 space-y-2">
              {androidPublishHistory.map((entry) => (
                <div key={entry.versionCode} className="flex items-center justify-between gap-2 text-[11px] py-1 border-b border-gray-100 dark:border-gray-700 last:border-0">
                  <div className="flex flex-wrap gap-1 items-center min-w-0">
                    <span className="font-mono text-gray-700 dark:text-gray-300">v{entry.versionName}</span>
                    <span className="text-gray-400">(build {entry.versionCode})</span>
                    <span className="text-gray-400">{new Date(entry.publishedAt).toLocaleDateString()}</span>
                    {entry.commitSha && <span className="font-mono text-gray-400 text-[10px]">{entry.commitSha}</span>}
                    <span className="font-mono text-gray-400 text-[10px]">{entry.checksum.slice(0, 12)}…</span>
                  </div>
                  <button
                    onClick={() => onAndroidRestoreVersion(entry.versionCode)}
                    disabled={androidRestoring === entry.versionCode}
                    className="shrink-0 text-[11px] px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                  >
                    {androidRestoring === entry.versionCode ? 'Restoring…' : 'Restore to feed'}
                  </button>
                </div>
              ))}
              <p className="text-[10px] text-gray-400 italic mt-1">To install a previous version on device, uninstall the current app first, then tap Install update in the Android app after restoring.</p>
            </div>
          </details>
        )}

        {/* FCM Push Notifications */}
        <details className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 border-t border-gray-100 dark:border-gray-700 mt-1">
          <summary className="cursor-pointer px-3 py-2 text-[10px] font-medium text-gray-500 uppercase tracking-wide select-none">
            FCM Push Notifications
            {fcmStatus && (
              <span className={`ml-2 normal-case font-normal ${fcmStatus.configured ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}>
                — {fcmStatus.configured ? `configured (project: ${fcmStatus.projectId})` : 'not configured'}
              </span>
            )}
          </summary>
          <div className="px-3 pb-3 space-y-2 text-[11px] text-gray-600 dark:text-gray-400">
            <p>Sends push notifications to offline devices when tool approvals are requested. Paste your Firebase service account JSON key below. Get it from Firebase Console → Project Settings → Service accounts → Generate new private key.</p>
            <textarea
              value={fcmJsonDraft}
              onChange={(e) => onSetFcmJsonDraft(e.target.value)}
              placeholder={'{\n  "type": "service_account",\n  "project_id": "my-project",\n  ...\n}'}
              rows={4}
              className="w-full font-mono text-[10px] p-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 resize-none"
            />
            <button
              onClick={onSaveFcmServiceAccount}
              disabled={fcmSaving || !fcmJsonDraft.trim()}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
            >
              {fcmSaving ? 'Saving…' : 'Save configuration'}
            </button>
          </div>
        </details>
      </div>
    </>
  )
}
