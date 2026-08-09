import { useEffect, useState } from 'react'
import type {
  ProjectEditSession,
  ProjectRepository,
  ProjectWorkspaceMetadata,
  ProjectTouchedFile,
  ProjectFileDiff,
} from '@shared/types'

interface AuditTabProps {
  projectId: string
  workspaceInfo?: ProjectWorkspaceMetadata | null
  repositories?: ProjectRepository[]
}

function repositoryGroup(file: ProjectTouchedFile): string {
  if (file.repositoryId) return file.repositoryId
  if (file.sourceId) return `source:${file.sourceId}`
  return 'legacy-unknown'
}

function repositoryLabel(file: ProjectTouchedFile): string {
  if (file.repositoryLabel) return file.repositoryLabel
  if (file.sourceLabel) return `${file.sourceLabel} · outside repository`
  return 'Legacy / repository unknown'
}

export function AuditTab({ projectId, workspaceInfo, repositories = [] }: AuditTabProps) {
  const [sessions, setSessions] = useState<ProjectEditSession[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [filesBySession, setFilesBySession] = useState<Record<string, ProjectTouchedFile[]>>({})
  const [diffs, setDiffs] = useState<Record<string, ProjectFileDiff | null>>({})
  const [expandedDiffKey, setExpandedDiffKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [repositoryFilter, setRepositoryFilter] = useState('all')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setSelectedSessionId(null)
    setFilesBySession({})
    setDiffs({})
    setExpandedDiffKey(null)
    setRepositoryFilter('all')
    void window.api.listProjectAuditSessions(projectId)
      .then((rows) => {
        if (cancelled) return
        setSessions(rows)
        setSelectedSessionId((current) => current ?? rows[0]?.id ?? null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [projectId])

  useEffect(() => {
    if (!selectedSessionId || filesBySession[selectedSessionId]) return
    let cancelled = false
    void window.api.listProjectAuditFiles(selectedSessionId).then((rows) => {
      if (cancelled) return
      setFilesBySession((prev) => ({ ...prev, [selectedSessionId]: rows }))
    })
    return () => { cancelled = true }
  }, [filesBySession, selectedSessionId])

  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null
  const files = selectedSessionId ? (filesBySession[selectedSessionId] ?? []) : []
  const repositoryOptions = Array.from(new Map(files.map((file) => [repositoryGroup(file), repositoryLabel(file)])).entries())
  const visibleFiles = repositoryFilter === 'all' ? files : files.filter((file) => repositoryGroup(file) === repositoryFilter)

  const loadDiff = async (file: ProjectTouchedFile) => {
    const key = file.id
    if (!(key in diffs)) {
      const diff = await window.api.getProjectAuditDiff(file.sessionId, file.relativePath, file.id)
      setDiffs((prev) => ({ ...prev, [key]: diff }))
    }
    setExpandedDiffKey((current) => current === key ? null : key)
  }

  if (loading) {
    return <p className="text-xs text-gray-400">Loading project changes...</p>
  }

  return (
    <div className="grid min-h-[24rem] gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40">
          <p className="text-[11px] font-medium text-gray-600 dark:text-gray-300">Sessions</p>
        </div>
        <div className="max-h-[28rem] overflow-y-auto">
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => {
                setSelectedSessionId(session.id)
                setRepositoryFilter('all')
              }}
              className={`block w-full border-b border-gray-100 px-3 py-2 text-left last:border-b-0 dark:border-gray-800 ${
                selectedSessionId === session.id ? 'bg-blue-50 dark:bg-blue-950/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800/40'
              }`}
            >
              <p className="truncate text-xs font-medium text-gray-700 dark:text-gray-200">{session.title}</p>
              <p className="mt-0.5 text-[11px] text-gray-500">
                {session.source} · {session.fileCount} file{session.fileCount === 1 ? '' : 's'}
              </p>
              <p className="text-[10px] text-gray-400">{new Date(session.updatedAt).toLocaleString()}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="min-w-0 space-y-3">
        {workspaceInfo && !workspaceInfo.isGitRepo && repositories.length === 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/20">
            <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300">Best-effort file audit</p>
            <p className="mt-0.5 text-[10px] text-amber-700/80 dark:text-amber-300/80">
              Full git-aware diffs and branch context are limited until this project has a registered Git repository.
            </p>
          </div>
        )}
        {sessions.length === 0 ? (
          <p className="text-xs text-gray-400">No recorded agent changes for this project yet.</p>
        ) : null}
        {selectedSession && (
          <div className="rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/30">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-200">{selectedSession.title}</p>
            <p className="mt-0.5 text-[11px] text-gray-500">
              {selectedSession.source} · {new Date(selectedSession.updatedAt).toLocaleString()}
            </p>
          </div>
        )}

        {repositoryOptions.length > 1 && (
          <label className="flex items-center gap-2 text-[11px] text-gray-500">
            Repository
            <select
              value={repositoryFilter}
              onChange={(event) => setRepositoryFilter(event.target.value)}
              className="min-w-0 rounded border border-gray-300 bg-white px-2 py-1 text-[11px] text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            >
              <option value="all">All repositories</option>
              {repositoryOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
        )}

        {sessions.length > 0 && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          {files.length === 0 ? (
            <p className="p-3 text-xs text-gray-400">No files recorded for this session.</p>
          ) : visibleFiles.length === 0 ? (
            <p className="p-3 text-xs text-gray-400">No files from this repository were recorded in this session.</p>
          ) : (
            visibleFiles.map((file, index) => {
              const key = file.id
              const diff = diffs[key]
              const expanded = expandedDiffKey === key
              const previous = visibleFiles[index - 1]
              const showRepositoryHeader = !previous || repositoryGroup(previous) !== repositoryGroup(file)
              return (
                <div key={key} className="border-b border-gray-200 last:border-b-0 dark:border-gray-700">
                  {showRepositoryHeader && (
                    <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-100 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:bg-gray-800/70 dark:text-gray-400">
                      <span>{repositoryLabel(file)}</span>
                      {file.branch && <span className="font-normal normal-case">branch {file.branch}</span>}
                      {file.repositoryAvailable === false && <span className="font-normal normal-case text-amber-600">unavailable</span>}
                    </div>
                  )}
                  <div className="flex items-center gap-2 bg-gray-50 px-3 py-2 dark:bg-gray-900/40">
                    <span title={file.displayPath} className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-700 dark:text-gray-300">{file.relativePath}</span>
                    <span className="text-[10px] text-gray-500">{file.status}</span>
                    <span className="text-[10px] text-gray-400">{file.lastOperation}</span>
                    {file.diffAvailable && (
                      <button
                        type="button"
                        onClick={() => void loadDiff(file)}
                        className="rounded border border-blue-300 px-2 py-0.5 text-[11px] text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/30"
                      >
                        {expanded ? 'Hide diff' : 'View diff'}
                      </button>
                    )}
                  </div>
                  {expanded && diff && (
                    <div className="max-h-80 overflow-auto font-mono text-[11px] leading-relaxed">
                      {diff.hunks.map((hunk, hi) => (
                        <div key={hi}>
                          <div className="bg-blue-50 px-3 py-0.5 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400">{hunk.header}</div>
                          {hunk.lines.map((line, li) => (
                            <div
                              key={li}
                              className={`px-3 whitespace-pre-wrap ${
                                line.type === 'added'
                                  ? 'bg-green-50 text-green-800 dark:bg-green-950/30 dark:text-green-300'
                                  : line.type === 'removed'
                                    ? 'bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300'
                                    : 'text-gray-600 dark:text-gray-400'
                              }`}
                            >
                              <span className="mr-2 inline-block w-8 select-none text-right text-gray-400 dark:text-gray-600">
                                {line.lineNumber.after ?? line.lineNumber.before ?? ''}
                              </span>
                              <span className="mr-1 select-none">{line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}</span>
                              {line.content}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                  {expanded && !diff && (
                    <div className="px-3 py-2 text-[11px] text-gray-400">Loading diff...</div>
                  )}
                </div>
              )
            })
          )}
        </div>
        )}
      </div>
    </div>
  )
}
