import { useDeferredValue, useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Loader2, Search, Trash2, X } from 'lucide-react'
import type { ArtifactRow } from '../../../shared/types'
import { useAppStore } from '../../store/app-store'
import { ArtifactKindBadge, artifactDisplayTitle } from '../artifacts/artifactDisplay'

function ArtifactListItem({ artifact, onDelete, onExport, onClick }: {
  artifact: ArtifactRow
  onDelete: (id: string) => void
  onExport: (artifact: ArtifactRow) => void
  onClick: (id: string) => void
}) {
  return (
    <div
      onClick={() => onClick(artifact.id)}
      className="group flex items-center gap-2 rounded-lg px-2 py-2 cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/60"
    >
      <ArtifactKindBadge kind={artifact.kind} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">{artifactDisplayTitle(artifact.title, artifact.kind)}</p>
        <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
          {artifact.status === 'generating' ? (
            <span className="text-purple-500">generating…</span>
          ) : (
            <>
              {artifact.currentVersion ? `v${artifact.currentVersion.versionNumber}` : '—'}
              {' · '}
              {artifact.status}
            </>
          )}
        </p>
      </div>
      {artifact.status === 'generating' && (
        <Loader2 className="w-3 h-3 text-purple-400 animate-spin shrink-0" />
      )}
      <div className="invisible group-hover:visible flex items-center gap-0.5 shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onExport(artifact) }}
          className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
          aria-label={`Export ${artifact.title}`}
          title="Export"
        >
          <Download className="w-3 h-3" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(artifact.id) }}
          className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
          aria-label={`Delete ${artifact.title}`}
          title="Delete"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}

export function ProjectArtifactsTab({ projectId }: { projectId: string }) {
  const pendingGen = useAppStore((s) => s.pendingArtifactGeneration)
  const openArtifactPanel = useAppStore((s) => s.openArtifactPanel)
  const addToast = useAppStore((s) => s.addToast)

  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      setArtifacts(await window.api.artifactList(projectId))
    } catch {
      // leave existing list
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { void loadAll() }, [loadAll])

  // Debrief/quiz generation (and other artifact updates) happen in the main process and can
  // complete while this tab isn't focused — without this, "0 artifacts" would keep showing
  // until the tab happened to remount. Refetch whenever any artifact for this project changes.
  useEffect(() => {
    return window.api.onArtifactUpdated(({ projectId: updatedProjectId }) => {
      if (updatedProjectId === projectId) void loadAll()
    })
  }, [projectId, loadAll])

  const filtered = useMemo(
    () => deferredQuery
      ? artifacts.filter((a) => {
        const q = deferredQuery.toLowerCase()
        return a.title.toLowerCase().includes(q) || a.kind.toLowerCase().includes(q)
      })
      : artifacts,
    [artifacts, deferredQuery],
  )

  const handleDelete = async (id: string) => {
    try {
      await window.api.artifactDelete(id)
      setArtifacts((prev) => prev.filter((a) => a.id !== id))
    } catch {
      addToast('Failed to delete artifact', 'error')
    }
  }

  const handleExport = async (artifact: ArtifactRow) => {
    if (!artifact.currentVersionId) {
      addToast('No version to export', 'error')
      return
    }
    try {
      const result = await window.api.artifactExport(artifact.currentVersionId, 'raw-files')
      addToast(`Exported to: ${result.exportPath}`, 'success')
    } catch {
      addToast('Export failed', 'error')
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {artifacts.length} artifact{artifacts.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search artifacts…"
          className="w-full pl-8 pr-7 py-1.5 text-xs bg-gray-100 dark:bg-gray-800 border border-transparent focus:border-blue-400 focus:bg-white dark:focus:bg-gray-900 rounded-lg outline-none transition-colors placeholder:text-gray-400"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            aria-label="Clear search"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* List */}
      <div className="space-y-0.5">
        {loading ? (
          <div className="space-y-0.5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            {pendingGen && (
              <div className="flex items-center gap-2 rounded-lg px-2 py-2 bg-purple-50/50 dark:bg-purple-900/10 border border-purple-200 dark:border-purple-800">
                <Loader2 className="w-3.5 h-3.5 text-purple-500 animate-spin shrink-0" />
                <ArtifactKindBadge kind={pendingGen.kind} />
                <span className="text-xs font-medium text-gray-800 dark:text-gray-200 flex-1 truncate">{pendingGen.title}</span>
              </div>
            )}
            {filtered.length === 0 && !pendingGen ? (
              <p className="text-center text-xs text-gray-400 dark:text-gray-500 pt-6 italic">
                {deferredQuery
                  ? `No artifacts match "${deferredQuery}"`
                  : 'No artifacts for this project yet'}
              </p>
            ) : (
              filtered.map((artifact) => (
                <ArtifactListItem
                  key={artifact.id}
                  artifact={artifact}
                  onClick={openArtifactPanel}
                  onDelete={(id) => void handleDelete(id)}
                  onExport={(a) => void handleExport(a)}
                />
              ))
            )}
          </>
        )}
      </div>

    </div>
  )
}
