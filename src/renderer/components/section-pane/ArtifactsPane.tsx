import { useDeferredValue, useEffect, useMemo, useState, useCallback } from 'react'
import { Download, Loader2, Search, Trash2, X } from 'lucide-react'
import type { ArtifactRow } from '../../../shared/types'
import { useAppStore } from '../../store/app-store'

// ---------------------------------------------------------------------------
// KindBadge (local; also duplicated in ProjectArtifactsTab)
// ---------------------------------------------------------------------------

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

function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(id)
  }, [startedAt])
  const m = Math.floor(elapsed / 60)
  const s = elapsed % 60
  return <span className="text-[10px] tabular-nums text-purple-500 shrink-0">{m}:{String(s).padStart(2, '0')}</span>
}

// ---------------------------------------------------------------------------
// Scope types
// ---------------------------------------------------------------------------

type ArtifactScope = 'project' | 'all'

// ---------------------------------------------------------------------------
// ArtifactListItem row
// ---------------------------------------------------------------------------

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
      <KindBadge kind={artifact.kind} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">{artifact.title}</p>
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

// ---------------------------------------------------------------------------
// ArtifactsPane
// ---------------------------------------------------------------------------

export function ArtifactsPane() {
  const projects = useAppStore((s) => s.projects)
  const pendingGen = useAppStore((s) => s.pendingArtifactGeneration)
  const openArtifactPanel = useAppStore((s) => s.openArtifactPanel)
  const addToast = useAppStore((s) => s.addToast)

  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [scope, setScope] = useState<ArtifactScope>('all')
  const [scopeProjectId, setScopeProjectId] = useState(projects[0]?.id ?? '')

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      if (scope === 'all') {
        const [global, project] = await Promise.all([
          window.api.artifactList(),
          scopeProjectId ? window.api.artifactList(scopeProjectId) : Promise.resolve([]),
        ])
        const seen = new Set<string>()
        const merged: ArtifactRow[] = []
        for (const a of [...global, ...project]) {
          if (!seen.has(a.id)) { seen.add(a.id); merged.push(a) }
        }
        setArtifacts(merged)
      } else {
        const effectiveProjectId = scope === 'project' ? scopeProjectId : undefined
        setArtifacts(await window.api.artifactList(effectiveProjectId))
      }
    } catch {
      // leave existing list
    } finally {
      setLoading(false)
    }
  }, [scope, scopeProjectId])

  useEffect(() => { void loadAll() }, [loadAll])

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
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 h-9 border-b border-gray-100 dark:border-gray-800">
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {artifacts.length} artifact{artifacts.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800">
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
      </div>

      {/* Scope pills */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex-wrap">
        {(['all', 'project'] as ArtifactScope[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            className={`text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors ${
              scope === s
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {s === 'project' ? 'Project' : 'All'}
          </button>
        ))}
        {(scope === 'project' || scope === 'all') && projects.length > 0 && (
          <select
            value={scopeProjectId}
            onChange={(e) => setScopeProjectId(e.target.value)}
            className="text-[11px] px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">Select project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto mr-1.5 p-2 space-y-0.5">
        {loading ? (
          <div className="p-2 space-y-0.5">
            {[1, 2, 3].map((i) => <div key={i} className="h-12 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />)}
          </div>
        ) : (
          <>
            {pendingGen && (
              <div className="flex items-center gap-2 rounded-lg px-2 py-2 bg-purple-50/50 dark:bg-purple-900/10 border border-purple-200 dark:border-purple-800">
                <Loader2 className="w-3.5 h-3.5 text-purple-500 animate-spin shrink-0" />
                <KindBadge kind={pendingGen.kind} />
                <span className="text-xs font-medium text-gray-800 dark:text-gray-200 flex-1 truncate">{pendingGen.title}</span>
                <ElapsedTimer startedAt={pendingGen.startedAt} />
              </div>
            )}
            {filtered.length === 0 && !pendingGen ? (
              <p className="text-center text-xs text-gray-400 dark:text-gray-500 pt-8 italic">
                {deferredQuery
                    ? `No artifacts match "${deferredQuery}"`
                    : scope === 'project'
                      ? 'No artifacts for this project yet'
                      : 'No artifacts yet'}
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
