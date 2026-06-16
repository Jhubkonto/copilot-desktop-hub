import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { CheckCircle, ChevronDown, ChevronRight, Package, Sparkles, Copy, Settings } from 'lucide-react'
import type { ArtifactRow, ArtifactVersion, ArtifactSpec, ArtifactGeneratorMessage } from '@shared/types'
import { BuildLog } from '../BuildLog'
import { useAppStore } from '../../store/app-store'
import { Button, PhaseBar, TextField, type PhaseBarStep } from '../ui/primitives'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Phase = 'idle' | 'chatting' | 'spec-ready' | 'generating' | 'ready' | 'failed'

export type ArtifactScope = 'global' | 'project' | 'all'

interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

const KIND_LABELS: Record<string, string> = {
  document: 'Doc', code: 'Code', ui: 'UI', data: 'Data',
  prompt: 'Prompt', 'agent-config': 'Agent', plan: 'Plan', bundle: 'Bundle', other: 'Other',
}

const SUPPORTED_EXPORT_FORMATS = ['raw-files', 'markdown', 'json']

function KindBadge({ kind }: { kind: string }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-medium">
      {KIND_LABELS[kind] ?? kind}
    </span>
  )
}

const PHASE_BAR_STEPS: PhaseBarStep[] = [
  { id: 'chatting', label: 'Discovery' },
  { id: 'spec-ready', label: 'Spec' },
  { id: 'generating', label: 'Generate' },
  { id: 'ready', label: 'Done' },
]
const PHASE_ORDER: Phase[] = ['idle', 'chatting', 'spec-ready', 'generating', 'ready']

// ---------------------------------------------------------------------------
// Artifact row
// ---------------------------------------------------------------------------

function ArtifactRowItem({ artifact, onRevise, onUseInChat }: { artifact: ArtifactRow; onRevise?: () => void; onUseInChat?: (artifactId: string, versionId?: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [versions, setVersions] = useState<ArtifactVersion[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [copying, setCopying] = useState('')
  const [exportMsg, setExportMsg] = useState('')

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
    try {
      const result = await window.api.artifactExport(versionId, format)
      setExportMsg(`Exported to: ${result.exportPath}`)
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
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
          artifact.status === 'ready' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
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

          {exportMsg && <p className="text-[10px] font-mono text-gray-500 truncate">{exportMsg}</p>}

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
  /** Locks the browser to a single project and hides the scope picker. */
  fixedProjectId?: string
}

export function ArtifactsBrowser({ fixedProjectId }: ArtifactsBrowserProps) {
  const projects = useAppStore((s) => s.projects)
  const currentConversationId = useAppStore((s) => s.currentConversationId)
  const requestArtifactAttach = useAppStore((s) => s.requestArtifactAttach)
  const setShowArtifactsPanel = useAppStore((s) => s.setShowArtifactsPanel)
  const addToast = useAppStore((s) => s.addToast)

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
  const [phase, setPhase] = useState<Phase>('idle')
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [streamBuf, setStreamBuf] = useState('')
  const [pendingSpec, setPendingSpec] = useState<ArtifactSpec | null>(null)
  const [fileEvents, setFileEvents] = useState<{ file: string; status: string }[]>([])
  const [reviseTitle, setReviseTitle] = useState<string | null>(null)

  const unsubTokenRef = useRef<(() => void) | null>(null)
  const unsubSpecRef = useRef<(() => void) | null>(null)
  const unsubFileRef = useRef<(() => void) | null>(null)

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

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  useEffect(() => {
    unsubTokenRef.current = window.api.onArtifactGeneratorToken((chunk) => {
      setStreamBuf((b) => b + chunk)
    })
    unsubSpecRef.current = window.api.onArtifactGeneratorSpecReady((spec) => {
      setPendingSpec(spec)
      setPhase('spec-ready')
    })
    unsubFileRef.current = window.api.onArtifactGeneratorFileEvent((e) => {
      setFileEvents((prev) => [...prev, e])
    })
    return () => {
      unsubTokenRef.current?.()
      unsubSpecRef.current?.()
      unsubFileRef.current?.()
    }
  }, [])

  const handleSaveRoot = async () => {
    await window.api.artifactGeneratorSetStorageRoot(rootInput)
    setStorageRoot(rootInput)
    setEditingRoot(false)
  }

  const generatorProjectId = fixedProjectId ?? (scope === 'project' ? scopeProjectId : undefined)

  const handleSend = async () => {
    if (!input.trim() || sending) return
    const userMsg: ChatMsg = { role: 'user', content: input.trim() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setSending(true)
    setStreamBuf('')
    setPhase('chatting')

    try {
      await window.api.artifactGeneratorChat(newMessages as ArtifactGeneratorMessage[], generatorProjectId)
      setMessages((prev) => [...prev, { role: 'assistant', content: streamBuf || '…' }])
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${String(e)}` }])
      setPhase('failed')
    } finally {
      setSending(false)
    }
  }

  const handleApproveSpec = async () => {
    if (!pendingSpec) return
    setPhase('generating')
    setFileEvents([])
    const runId = crypto.randomUUID()
    try {
      await window.api.artifactGeneratorGenerate(runId, pendingSpec, generatorProjectId)
      setPhase('ready')
      await loadAll()
    } catch {
      setPhase('failed')
    }
  }

  const handleReset = () => {
    setPhase('idle')
    setMessages([])
    setInput('')
    setStreamBuf('')
    setPendingSpec(null)
    setFileEvents([])
    setReviseTitle(null)
    setShowGenerator(false)
  }

  const handleRevise = (title: string) => {
    setReviseTitle(title)
    setShowGenerator(true)
    setPhase('chatting')
    setMessages([{ role: 'user', content: `I want to generate a new version of "${title}"` }])
  }

  const emptyMessage = useMemo(() => {
    if (scope === 'global') return 'No global artifacts yet. Generate one above.'
    if (scope === 'all') return 'No artifacts yet. Generate one above.'
    return 'No artifacts yet for this project. Generate one above.'
  }, [scope])

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
              <Button
                variant="primary"
                onClick={handleSaveRoot}
                className="text-[10px] px-2 py-1"
              >
                Save
              </Button>
              <Button
                variant="secondary"
                onClick={() => setEditingRoot(false)}
                className="text-[10px] px-2 py-1"
              >
                Cancel
              </Button>
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
        {!showGenerator && (
          <Button
            variant="primary"
            onClick={() => { setShowGenerator(true); setPhase('chatting') }}
            disabled={scope === 'all'}
            title={scope === 'all' ? 'Pick "Global" or "This Project" to generate' : undefined}
          >
            <Sparkles className="w-3 h-3" />
            Generate artifact
          </Button>
        )}
      </div>

      {/* Inline generator */}
      {showGenerator && (
        <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-3 space-y-3 bg-blue-50/30 dark:bg-blue-900/5">
          <div className="mb-3">
            <PhaseBar steps={PHASE_BAR_STEPS} currentIndex={PHASE_ORDER.indexOf(phase)} />
          </div>

          <div className="space-y-2 max-h-48 overflow-y-auto">
            {messages.map((m, i) => (
              <div key={i} className={`text-[11px] px-2.5 py-1.5 rounded-lg ${
                m.role === 'user'
                  ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 ml-4'
                  : 'bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
              }`}>
                <span className="font-medium text-[10px] text-gray-400 block mb-0.5">{m.role === 'user' ? 'You' : 'Assistant'}</span>
                <span className="whitespace-pre-wrap">{m.content}</span>
              </div>
            ))}
            {sending && streamBuf && (
              <div className="text-[11px] px-2.5 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                <span className="font-medium text-[10px] text-gray-400 block mb-0.5">Assistant</span>
                <span className="whitespace-pre-wrap">{streamBuf}</span>
              </div>
            )}
          </div>

          {pendingSpec && phase === 'spec-ready' && (
            <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/10 p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <KindBadge kind={pendingSpec.kind} />
                <p className="text-xs font-semibold text-blue-800 dark:text-blue-300">{pendingSpec.title}</p>
              </div>
              <p className="text-[11px] text-gray-600 dark:text-gray-400">{pendingSpec.intendedUse}</p>
              {pendingSpec.outputFiles.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Output files</p>
                  {pendingSpec.outputFiles.map((f, i) => (
                    <p key={i} className="text-[11px] font-mono text-gray-600 dark:text-gray-400">{f.path}</p>
                  ))}
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <Button
                  variant="primary"
                  onClick={handleApproveSpec}
                  className="text-[11px] px-3 py-1"
                >
                  Approve and generate
                </Button>
                <Button variant="secondary" onClick={() => setPendingSpec(null)} className="text-[11px] px-2 py-1">
                  Revise
                </Button>
              </div>
            </div>
          )}

          {phase === 'generating' && (
            <BuildLog
              lines={fileEvents.map((e) => `${e.status === 'done' ? '✓' : '✗'} ${e.file}`)}
              className="h-24 text-[11px]"
            />
          )}

          {phase === 'ready' && (
            <div className="flex items-center gap-2 text-[11px] text-green-700 dark:text-green-400">
              <CheckCircle className="w-3.5 h-3.5" />
              Artifact generated successfully.
            </div>
          )}

          {(phase === 'chatting' || phase === 'idle') && (
            <div className="flex gap-2">
              <TextField
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend() } }}
                placeholder={reviseTitle ? `Tell me what to change in "${reviseTitle}"…` : 'Describe the artifact you want to create…'}
                className="flex-1 text-xs px-3 py-2"
                disabled={sending}
              />
              <Button
                variant="primary"
                onClick={handleSend}
                disabled={sending || !input.trim()}
                className="text-[11px] px-3 py-1.5"
              >
                {sending ? '…' : 'Send'}
              </Button>
            </div>
          )}

          <div className="flex justify-end">
            <button type="button" onClick={handleReset} className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Artifact list */}
      {loading ? (
        <p className="text-[11px] text-gray-400">Loading artifacts…</p>
      ) : artifacts.length === 0 ? (
        <p className="text-[11px] text-gray-400">{emptyMessage}</p>
      ) : (
        <div className="space-y-2">
          {artifacts.map((a) => (
            <ArtifactRowItem
              key={a.id}
              artifact={a}
              onRevise={a.projectId || fixedProjectId ? () => handleRevise(a.title) : undefined}
              onUseInChat={currentConversationId ? handleUseInChat : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}
