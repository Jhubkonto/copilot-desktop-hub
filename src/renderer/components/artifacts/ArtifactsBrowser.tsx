import { useState, useEffect, useCallback, useMemo } from 'react'
import { CheckCircle, ChevronDown, ChevronRight, Loader2, Package, Sparkles, Copy, Settings } from 'lucide-react'
import type { ArtifactRow, ArtifactVersion } from '@shared/types'
import { useAppStore } from '../../store/app-store'
import { Button, TextField } from '../ui/primitives'
import { ArtifactGeneratorModal } from '../ArtifactGeneratorModal'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ArtifactScope = 'global' | 'project' | 'all'

const SUPPORTED_EXPORT_FORMATS = ['raw-files', 'markdown', 'json']

const KIND_LABELS: Record<string, string> = {
  document: 'Doc', code: 'Code', ui: 'UI', data: 'Data',
  prompt: 'Prompt', 'agent-config': 'Agent', plan: 'Plan', bundle: 'Bundle', other: 'Other',
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

function KindBadge({ kind }: { kind: string }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-medium">
      {KIND_LABELS[kind] ?? kind}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Artifact row
// ---------------------------------------------------------------------------

function ArtifactRowItem({ artifact, onRevise, onUseInChat }: {
  artifact: ArtifactRow
  onRevise?: () => void
  onUseInChat?: (artifactId: string, versionId?: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [versions, setVersions] = useState<ArtifactVersion[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [copying, setCopying] = useState('')
  const [exportMsg, setExportMsg] = useState('')
  const [exportedPath, setExportedPath] = useState('')

  const handleExpand = async () => {
    if (!expanded && versions.length === 0) {
      setLoadingVersions(true)
      try {
        const v = await window.api.artifactListVersions(artifact.id)
        setVersions(v)
      } finally {
        setLoadingVersions(false)
      }
    }
    setExpanded((e) => !e)
  }

  const handleCopyPath = async (absPath: string) => {
    await navigator.clipboard.writeText(absPath)
    setCopying(absPath)
    setTimeout(() => setCopying(''), 1500)
  }

  const handleExport = async (versionId: string, format: string) => {
    setExportMsg('')
    setExportedPath('')
    try {
      const result = await window.api.artifactExport(versionId, format)
      setExportMsg(`Exported to: ${result.exportPath}`)
      setExportedPath(result.exportPath)
    } catch (e) {
      setExportMsg(`Export failed: ${String(e)}`)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Delete artifact "${artifact.title}"? DB record removed; files on disk stay.`)) return
    await window.api.artifactDelete(artifact.id)
  }

  const currentVersion = artifact.currentVersion

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={handleExpand}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
        <KindBadge kind={artifact.kind} />
        <span className="text-xs font-medium text-gray-800 dark:text-gray-200 flex-1 truncate">{artifact.title}</span>
        {!artifact.projectId && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 font-medium">Global</span>
        )}
        {artifact.status === 'generating' && <Loader2 className="w-3 h-3 text-purple-400 animate-spin shrink-0" />}
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
          artifact.status === 'ready' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
          : artifact.status === 'generating' ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400'
          : artifact.status === 'failed' ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
          : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
        }`}>{artifact.status}</span>
        <span className="text-[10px] text-gray-400 shrink-0">
          {currentVersion ? `v${currentVersion.versionNumber}` : '—'}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 dark:border-gray-700 px-3 py-2 space-y-2">
          {loadingVersions && <p className="text-[11px] text-gray-400">Loading versions…</p>}

          {currentVersion?.files && currentVersion.files.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-1">Files (v{currentVersion.versionNumber})</p>
              <div className="space-y-1">
                {currentVersion.files.map((f) => (
                  <div key={f.id} className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-gray-600 dark:text-gray-400 flex-1 truncate">{f.absolutePath}</span>
                    <button
                      type="button"
                      onClick={() => handleCopyPath(f.absolutePath)}
                      className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      title="Copy path"
                    >
                      {copying === f.absolutePath ? <CheckCircle className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {versions.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-1">Version history</p>
              <div className="space-y-1">
                {versions.map((v) => (
                  <div key={v.id} className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] text-gray-600 dark:text-gray-400">v{v.versionNumber} — {new Date(v.createdAt).toLocaleDateString()}</span>
                    <div className="flex gap-1">
                      {SUPPORTED_EXPORT_FORMATS.map((fmt) => (
                        <button
                          key={fmt}
                          type="button"
                          onClick={() => handleExport(v.id, fmt)}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500 transition-colors"
                        >
                          {fmt}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {exportMsg && (
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[10px] font-mono text-gray-500 truncate flex-1">{exportMsg}</p>
              {exportedPath && (
                <button
                  type="button"
                  onClick={() => void window.api.artifactOpenFolder(exportedPath)}
                  className="text-[10px] text-blue-500 hover:text-blue-600 shrink-0"
                >
                  Open folder
                </button>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            {onRevise && (
              <button
                type="button"
                onClick={onRevise}
                className="text-[11px] px-2 py-1 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
              >
                Generate new version
              </button>
            )}
            {onUseInChat && currentVersion && (
              <Button
                variant="secondary"
                onClick={() => onUseInChat(artifact.id, currentVersion.id)}
                className="text-[11px] px-2 py-1"
              >
                Use in chat
              </Button>
            )}
            <button
              type="button"
              onClick={handleDelete}
              className="text-[11px] px-2 py-1 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main ArtifactsBrowser
// ---------------------------------------------------------------------------

interface ArtifactsBrowserProps {
  fixedProjectId?: string
}

export function ArtifactsBrowser({ fixedProjectId }: ArtifactsBrowserProps) {
  const projects = useAppStore((s) => s.projects)
  const currentConversationId = useAppStore((s) => s.currentConversationId)
  const requestArtifactAttach = useAppStore((s) => s.requestArtifactAttach)
  const setShowArtifactsPanel = useAppStore((s) => s.setShowArtifactsPanel)
  const addToast = useAppStore((s) => s.addToast)
  const pendingGen = useAppStore((s) => s.pendingArtifactGeneration)

  const handleUseInChat = (artifactId: string, versionId?: string) => {
    requestArtifactAttach(artifactId, versionId)
    setShowArtifactsPanel(false)
    addToast('Artifact attached to conversation', 'success')
  }

  const [scope, setScope] = useState<ArtifactScope>(fixedProjectId ? 'project' : 'global')
  const [scopeProjectId, setScopeProjectId] = useState(fixedProjectId ?? projects[0]?.id ?? '')
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([])
  const [loading, setLoading] = useState(true)
  const [storageRoot, setStorageRoot] = useState('')
  const [editingRoot, setEditingRoot] = useState(false)
  const [rootInput, setRootInput] = useState('')
  const [showGenerator, setShowGenerator] = useState(false)
  const [reviseProjectId, setReviseProjectId] = useState<string | undefined>(undefined)

  const effectiveProjectId = fixedProjectId ?? (scope === 'project' ? scopeProjectId : undefined)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      if (scope === 'all' && !fixedProjectId) {
        const [global, project] = await Promise.all([
          window.api.artifactList(),
          scopeProjectId ? window.api.artifactList(scopeProjectId) : Promise.resolve([]),
        ])
        setArtifacts([...global, ...project])
      } else {
        const list = await window.api.artifactList(effectiveProjectId)
        setArtifacts(list)
      }
      if (!fixedProjectId && scope === 'global') {
        const root = await window.api.artifactGeneratorGetStorageRoot()
        setStorageRoot(root.path)
      }
    } finally {
      setLoading(false)
    }
  }, [scope, scopeProjectId, effectiveProjectId, fixedProjectId])

  useEffect(() => { void loadAll() }, [loadAll])

  const handleSaveRoot = async () => {
    await window.api.artifactGeneratorSetStorageRoot(rootInput)
    setStorageRoot(rootInput)
    setEditingRoot(false)
  }

  const handleRevise = (projectId: string | null) => {
    setReviseProjectId(projectId ?? undefined)
    setShowGenerator(true)
  }

  const emptyMessage = useMemo(() => {
    if (scope === 'global') return 'No global artifacts yet. Generate one above.'
    if (scope === 'all') return 'No artifacts yet. Generate one above.'
    return 'No artifacts yet for this project. Generate one above.'
  }, [scope])

  const generatorProjectId = fixedProjectId ?? (scope === 'project' ? scopeProjectId : undefined)

  return (
    <div className="space-y-4">
      {/* Scope picker */}
      {!fixedProjectId && (
        <div className="flex items-center gap-2 flex-wrap">
          {(['global', 'project', 'all'] as ArtifactScope[]).map((s) => (
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
              {s === 'global' ? 'Global' : s === 'project' ? 'This Project' : 'All'}
            </button>
          ))}
          {(scope === 'project' || scope === 'all') && (
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
      )}

      {/* Storage root config (global scope only) */}
      {!fixedProjectId && scope === 'global' && (
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
              <TextField
                type="text"
                value={rootInput}
                onChange={(e) => setRootInput(e.target.value)}
                className="flex-1 text-[11px] font-mono px-2 py-1"
              />
              <Button variant="primary" onClick={handleSaveRoot} className="text-[10px] px-2 py-1">Save</Button>
              <Button variant="secondary" onClick={() => setEditingRoot(false)} className="text-[10px] px-2 py-1">Cancel</Button>
            </div>
          ) : (
            <p className="text-[11px] font-mono text-gray-500 dark:text-gray-400 truncate">{storageRoot || '—'}</p>
          )}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-blue-500" />
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
            {fixedProjectId ? 'Project Artifacts' : scope === 'global' ? 'Global Artifacts' : scope === 'all' ? 'All Artifacts' : 'Project Artifacts'}
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => { setReviseProjectId(undefined); setShowGenerator(true) }}
          disabled={scope === 'all'}
          title={scope === 'all' ? 'Pick "Global" or "This Project" to generate' : undefined}
        >
          <Sparkles className="w-3 h-3" />
          Generate artifact
        </Button>
      </div>

      {/* Artifact list */}
      {loading ? (
        <p className="text-[11px] text-gray-400">Loading artifacts…</p>
      ) : (
        <div className="space-y-2">
          {pendingGen && (
            <div className="border border-purple-200 dark:border-purple-800 rounded-lg px-3 py-2.5 flex items-center gap-2 bg-purple-50/50 dark:bg-purple-900/10">
              <Loader2 className="w-3.5 h-3.5 text-purple-500 animate-spin shrink-0" />
              <KindBadge kind={pendingGen.kind} />
              <span className="text-xs font-medium text-gray-800 dark:text-gray-200 flex-1 truncate">{pendingGen.title}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400 font-medium">generating…</span>
              <ElapsedTimer startedAt={pendingGen.startedAt} />
            </div>
          )}
          {artifacts.length === 0 && !pendingGen ? (
            <p className="text-[11px] text-gray-400">{emptyMessage}</p>
          ) : (
            artifacts.map((a) => (
              <ArtifactRowItem
                key={a.id}
                artifact={a}
                onRevise={a.projectId || fixedProjectId ? () => handleRevise(a.projectId) : undefined}
                onUseInChat={currentConversationId ? handleUseInChat : undefined}
              />
            ))
          )}
        </div>
      )}

      {/* Generator modal */}
      {showGenerator && (
        <ArtifactGeneratorModal
          projectId={reviseProjectId ?? generatorProjectId}
          onClose={() => setShowGenerator(false)}
          onArtifactCreated={() => { void loadAll() }}
        />
      )}
    </div>
  )
}
