import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Download, Trash2, Package, History, Info, FolderOpen, Settings } from 'lucide-react'
import type { ArtifactRow, ArtifactVersion } from '../../shared/types'
import { useAppStore } from '../store/app-store'
import { ResizeHandle } from './ResizeHandle'
import { ArtifactGeneratorModal } from './ArtifactGeneratorModal'
import { DeleteArtifactDialog } from './DeleteArtifactDialog'

const SUPPORTED_EXPORT_FORMATS = ['raw-files', 'markdown', 'json'] as const
type ExportFormat = typeof SUPPORTED_EXPORT_FORMATS[number]

const KIND_LABELS: Record<string, string> = {
  document: 'Doc', code: 'Code', ui: 'UI', data: 'Data',
  prompt: 'Prompt', 'agent-config': 'Agent', plan: 'Plan', bundle: 'Bundle', other: 'Other',
}

function KindBadge({ kind }: { kind: string }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-medium">
      {KIND_LABELS[kind] ?? kind}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Details Tab
// ---------------------------------------------------------------------------

function DetailsTab({ artifact, projects, onRevise }: {
  artifact: ArtifactRow
  projects: { id: string; name: string }[]
  onRevise: () => void
}) {
  const project = artifact.projectId ? projects.find((p) => p.id === artifact.projectId) : null
  const addToast = useAppStore((s) => s.addToast)
  const [storageRoot, setStorageRoot] = useState('')
  const [editingRoot, setEditingRoot] = useState(false)
  const [rootInput, setRootInput] = useState('')

  useEffect(() => {
    window.api.artifactGeneratorGetStorageRoot()
      .then((r) => setStorageRoot(r.path))
      .catch(() => {})
  }, [])

  const handleSaveRoot = async () => {
    try {
      await window.api.artifactGeneratorSetStorageRoot(rootInput)
      setStorageRoot(rootInput)
      setEditingRoot(false)
    } catch {
      addToast('Failed to save storage root', 'error')
    }
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <div className="flex items-center gap-2 flex-wrap">
        <KindBadge kind={artifact.kind} />
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
          artifact.status === 'ready' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
          : artifact.status === 'generating' ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400'
          : artifact.status === 'failed' ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
          : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
        }`}>{artifact.status}</span>
        {artifact.currentVersion && (
          <span className="text-[10px] text-gray-400">v{artifact.currentVersion.versionNumber}</span>
        )}
      </div>

      {artifact.description && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Description</p>
          <p className="text-xs text-gray-600 dark:text-gray-300">{artifact.description}</p>
        </div>
      )}

      <div>
        <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Project</p>
        <p className="text-xs text-gray-600 dark:text-gray-300">
          {project ? project.name : 'Global (no project)'}
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Settings className="w-3.5 h-3.5 text-gray-400" />
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Artifact storage root</p>
          <button
            type="button"
            onClick={() => { setEditingRoot(true); setRootInput(storageRoot) }}
            className="ml-auto text-[10px] text-blue-500 hover:text-blue-600"
          >
            Change
          </button>
        </div>
        {editingRoot ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={rootInput}
              onChange={(e) => setRootInput(e.target.value)}
              className="flex-1 text-[11px] font-mono px-2 py-1 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={() => void handleSaveRoot()}
              className="text-[10px] px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditingRoot(false)}
              className="text-[10px] px-2 py-1 rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <p className="text-[11px] font-mono text-gray-500 dark:text-gray-400 truncate">{storageRoot || '—'}</p>
        )}
      </div>

      {artifact.currentVersion?.files && artifact.currentVersion.files.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">
            Files (v{artifact.currentVersion.versionNumber})
          </p>
          <div className="space-y-1">
            {artifact.currentVersion.files.map((f) => (
              <p key={f.id} className="text-[11px] font-mono text-gray-500 dark:text-gray-400 break-all">{f.relativePath}</p>
            ))}
          </div>
        </div>
      )}

      <div className="pt-2">
        <button
          onClick={onRevise}
          className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
        >
          Generate new version
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// History Tab
// ---------------------------------------------------------------------------

function HistoryTab({ artifactId }: { artifactId: string }) {
  const [versions, setVersions] = useState<ArtifactVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [exportMsg, setExportMsg] = useState('')
  const [exportedPath, setExportedPath] = useState('')
  const addToast = useAppStore((s) => s.addToast)

  useEffect(() => {
    setLoading(true)
    window.api.artifactListVersions(artifactId)
      .then(setVersions)
      .catch(() => addToast('Failed to load version history', 'error'))
      .finally(() => setLoading(false))
  }, [artifactId, addToast])

  const handleExport = async (versionId: string, format: ExportFormat) => {
    setExportMsg('')
    setExportedPath('')
    try {
      const result = await window.api.artifactExport(versionId, format)
      setExportMsg(`Exported to: ${result.exportPath}`)
      setExportedPath(result.exportPath)
    } catch {
      setExportMsg('Export failed')
    }
  }

  if (loading) {
    return <p className="p-4 text-xs text-gray-400">Loading…</p>
  }

  return (
    <div className="p-4 space-y-3 overflow-y-auto h-full">
      {versions.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No version history yet</p>
      ) : (
        versions.map((v) => (
          <div key={v.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">v{v.versionNumber}</span>
              <span className="text-[10px] text-gray-400">{new Date(v.createdAt).toLocaleDateString()}</span>
            </div>
            {v.files && v.files.length > 0 && (
              <p className="text-[10px] text-gray-400">{v.files.length} file{v.files.length !== 1 ? 's' : ''}</p>
            )}
            <div className="flex gap-1 flex-wrap">
              {SUPPORTED_EXPORT_FORMATS.map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => void handleExport(v.id, fmt)}
                  className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>
        ))
      )}
      {exportMsg && (
        <div className="flex items-center gap-2 mt-2">
          <p className="text-[10px] font-mono text-gray-500 truncate flex-1">{exportMsg}</p>
          {exportedPath && (
            <button
              type="button"
              onClick={() => void window.api.artifactOpenFolder(exportedPath)}
              className="text-[10px] text-blue-500 hover:text-blue-600 shrink-0 flex items-center gap-1"
            >
              <FolderOpen className="w-3 h-3" />
              Open
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Export Tab
// ---------------------------------------------------------------------------

function ExportTab({ artifact }: { artifact: ArtifactRow }) {
  const [exportMsg, setExportMsg] = useState('')
  const [exportedPath, setExportedPath] = useState('')

  const handleExport = async (format: ExportFormat) => {
    if (!artifact.currentVersionId) return
    setExportMsg('')
    setExportedPath('')
    try {
      const result = await window.api.artifactExport(artifact.currentVersionId, format)
      setExportMsg(`Exported to: ${result.exportPath}`)
      setExportedPath(result.exportPath)
    } catch {
      setExportMsg('Export failed')
    }
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Export the current version ({artifact.currentVersion ? `v${artifact.currentVersion.versionNumber}` : '—'}) in a format of your choice.
      </p>
      {!artifact.currentVersionId ? (
        <p className="text-xs text-gray-400 italic">No version available to export</p>
      ) : (
        <div className="flex gap-2 flex-wrap">
          {SUPPORTED_EXPORT_FORMATS.map((fmt) => (
            <button
              key={fmt}
              type="button"
              onClick={() => void handleExport(fmt)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              {fmt}
            </button>
          ))}
        </div>
      )}
      {exportMsg && (
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-mono text-gray-500 truncate flex-1">{exportMsg}</p>
          {exportedPath && (
            <button
              type="button"
              onClick={() => void window.api.artifactOpenFolder(exportedPath)}
              className="text-[10px] text-blue-500 hover:text-blue-600 shrink-0 flex items-center gap-1"
            >
              <FolderOpen className="w-3 h-3" />
              Open folder
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ArtifactPanel
// ---------------------------------------------------------------------------

const PANEL_MIN = 320
const PANEL_MAX = 700

export function ArtifactPanel({ artifactId }: { artifactId: string }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeArtifactPanel = useAppStore((s) => s.closeArtifactPanel)
  const requestArtifactAttach = useAppStore((s) => s.requestArtifactAttach)
  const currentConversationId = useAppStore((s) => s.currentConversationId)
  const projects = useAppStore((s) => s.projects)
  const addToast = useAppStore((s) => s.addToast)
  const setSectionPane = useAppStore((s) => s.setSectionPane)

  const [artifact, setArtifact] = useState<ArtifactRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'details' | 'history' | 'export'>('details')
  const [width, setWidth] = useState(440)
  const [showReviseGenerator, setShowReviseGenerator] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const getMaxSize = useCallback(() => Math.min(PANEL_MAX, Math.floor(window.innerWidth * 0.45)), [])

  const handleSetSize = useCallback((size: number) => {
    setWidth(Math.max(PANEL_MIN, Math.min(getMaxSize(), size)))
  }, [getMaxSize])

  useEffect(() => {
    setLoading(true)
    window.api.artifactGet(artifactId)
      .then((a) => setArtifact(a))
      .catch(() => addToast('Failed to load artifact', 'error'))
      .finally(() => setLoading(false))
  }, [artifactId, addToast])

  const handleDelete = async () => {
    if (!artifact) return
    try {
      await window.api.artifactDelete(artifact.id)
      closeArtifactPanel()
    } catch {
      addToast('Failed to delete artifact', 'error')
    }
  }

  const handleUseInChat = () => {
    if (!artifact) return
    requestArtifactAttach(artifact.id, artifact.currentVersionId ?? undefined)
    setSectionPane('artifacts')
    addToast('Artifact attached to conversation', 'success')
  }

  return (
    <div
      ref={panelRef}
      style={{ width, left: 'auto', right: 0 }}
      className="fixed inset-y-0 top-9 z-50 flex flex-col bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-2xl"
      aria-label="Artifact details panel"
    >
      <ResizeHandle
        direction="horizontal"
        containerRef={panelRef as React.RefObject<HTMLElement>}
        onSetSize={handleSetSize}
        align="start"
        minSize={PANEL_MIN}
        maxSize={getMaxSize}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-4 h-9 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Package className="w-3.5 h-3.5 text-purple-500 shrink-0" />
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
            {loading ? 'Loading…' : (artifact?.title ?? 'Artifact')}
          </h2>
        </div>
        <button
          onClick={closeArtifactPanel}
          className="p-0.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label="Close artifact panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0 border-b border-gray-200 dark:border-gray-700 shrink-0 px-4">
        {([
          { id: 'details', label: 'Details', Icon: Info },
          { id: 'history', label: 'History', Icon: History },
          { id: 'export', label: 'Export', Icon: Download },
        ] as const).map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              tab === id
                ? 'border-purple-500 text-purple-600 dark:text-purple-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            <Icon className="w-3 h-3" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {loading ? (
          <p className="p-4 text-xs text-gray-400">Loading artifact…</p>
        ) : artifact ? (
          <>
            {tab === 'details' && (
              <DetailsTab
                artifact={artifact}
                projects={projects}
                onRevise={() => setShowReviseGenerator(true)}
              />
            )}
            {tab === 'history' && <HistoryTab artifactId={artifact.id} />}
            {tab === 'export' && <ExportTab artifact={artifact} />}
          </>
        ) : (
          <p className="p-4 text-xs text-gray-400">Artifact not found</p>
        )}
      </div>

      {/* Footer */}
      {artifact && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700 shrink-0">
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
          {confirmDelete && (
            <DeleteArtifactDialog
              artifactTitle={artifact.title}
              onConfirm={() => { setConfirmDelete(false); void handleDelete() }}
              onCancel={() => setConfirmDelete(false)}
            />
          )}
          {currentConversationId && (
            <button
              onClick={handleUseInChat}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
            >
              Use in Chat
            </button>
          )}
        </div>
      )}

      {/* Revise generator */}
      {showReviseGenerator && artifact && (
        <ArtifactGeneratorModal
          projectId={artifact.projectId ?? undefined}
          onClose={() => setShowReviseGenerator(false)}
          onArtifactCreated={() => {
            setShowReviseGenerator(false)
            window.api.artifactGet(artifactId).then((a) => setArtifact(a)).catch(() => {})
          }}
        />
      )}
    </div>
  )
}
