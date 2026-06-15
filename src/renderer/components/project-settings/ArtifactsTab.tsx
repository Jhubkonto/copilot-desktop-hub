import { useState, useEffect, useRef, useCallback } from 'react'
import { CheckCircle, ChevronDown, ChevronRight, Package, Sparkles, Copy } from 'lucide-react'
import type { ArtifactRow, ArtifactVersion, ArtifactSpec, ArtifactGeneratorMessage } from '@shared/types'
import { BuildLog } from '../BuildLog'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Phase = 'idle' | 'chatting' | 'spec-ready' | 'generating' | 'ready' | 'failed'

interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function PhaseBar({ phase }: { phase: Phase }) {
  const steps: { id: Phase; label: string }[] = [
    { id: 'chatting', label: 'Discovery' },
    { id: 'spec-ready', label: 'Spec' },
    { id: 'generating', label: 'Generate' },
    { id: 'ready', label: 'Done' },
  ]
  const ORDER: Phase[] = ['idle', 'chatting', 'spec-ready', 'generating', 'ready']
  const currentIndex = ORDER.indexOf(phase)

  return (
    <div className="flex items-center gap-1 mb-3">
      {steps.map((step, i) => {
        const stepIndex = ORDER.indexOf(step.id)
        const done = currentIndex > stepIndex
        const active = currentIndex === stepIndex
        return (
          <div key={step.id} className="flex items-center gap-1">
            {i > 0 && <div className={`h-px w-4 ${done ? 'bg-green-400' : 'bg-gray-200 dark:bg-gray-700'}`} />}
            <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
              done ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : active ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
              : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600'
            }`}>
              {done && <CheckCircle className="w-2.5 h-2.5" />}
              {step.label}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Artifact row component
// ---------------------------------------------------------------------------

function ArtifactRowItem({ artifact, onRevise }: { artifact: ArtifactRow; onRevise: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [versions, setVersions] = useState<ArtifactVersion[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [copying, setCopying] = useState('')

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
    try {
      const result = await window.api.artifactExport(versionId, format)
      await window.api.artifactGet(artifact.id)
      alert(`Exported to: ${result.exportPath}`)
    } catch (e) {
      alert(`Export failed: ${String(e)}`)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Delete artifact "${artifact.title}"? The DB record will be removed but files on disk will remain.`)) return
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

          {currentVersion && currentVersion.files && currentVersion.files.length > 0 && (
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
                  <div key={v.id} className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-600 dark:text-gray-400 flex-1">v{v.versionNumber} — {new Date(v.createdAt).toLocaleDateString()}</span>
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

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onRevise}
              className="text-[11px] px-2 py-1 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
            >
              Generate new version
            </button>
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
// Main ArtifactsTab
// ---------------------------------------------------------------------------

export function ArtifactsTab({ projectId }: { projectId: string }) {
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([])
  const [loading, setLoading] = useState(true)
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

  const loadArtifacts = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.api.artifactList(projectId)
      setArtifacts(list)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void loadArtifacts()
  }, [loadArtifacts])

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
      await window.api.artifactGeneratorChat(newMessages as ArtifactGeneratorMessage[], projectId)
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
      await window.api.artifactGeneratorGenerate(runId, pendingSpec, projectId)
      setPhase('ready')
      await loadArtifacts()
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-purple-500" />
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">Project Artifacts</p>
        </div>
        {!showGenerator && (
          <button
            type="button"
            onClick={() => { setShowGenerator(true); setPhase('chatting') }}
            className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg bg-purple-500 text-white hover:bg-purple-600 transition-colors"
          >
            <Sparkles className="w-3 h-3" />
            Generate new artifact
          </button>
        )}
      </div>

      {/* Inline generator */}
      {showGenerator && (
        <div className="border border-purple-200 dark:border-purple-800 rounded-lg p-3 space-y-3 bg-purple-50/30 dark:bg-purple-900/5">
          <PhaseBar phase={phase} />

          {/* Chat messages */}
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

          {/* Spec preview */}
          {pendingSpec && phase === 'spec-ready' && (
            <div className="rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/10 p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <KindBadge kind={pendingSpec.kind} />
                <p className="text-xs font-semibold text-purple-800 dark:text-purple-300">{pendingSpec.title}</p>
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
                <button
                  type="button"
                  onClick={handleApproveSpec}
                  className="text-[11px] px-3 py-1 rounded bg-purple-500 text-white hover:bg-purple-600 transition-colors"
                >
                  Approve and generate
                </button>
                <button type="button" onClick={() => setPendingSpec(null)} className="text-[11px] px-2 py-1 rounded border border-gray-200 dark:border-gray-600 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                  Revise
                </button>
              </div>
            </div>
          )}

          {/* Generation progress */}
          {phase === 'generating' && (
            <BuildLog
              lines={fileEvents.map((e) => `${e.status === 'done' ? '✓' : '✗'} ${e.file}`)}
              className="h-24 text-[11px]"
            />
          )}

          {/* Ready */}
          {phase === 'ready' && (
            <div className="flex items-center gap-2 text-[11px] text-green-700 dark:text-green-400">
              <CheckCircle className="w-3.5 h-3.5" />
              Artifact generated successfully.
            </div>
          )}

          {/* Input */}
          {(phase === 'chatting' || phase === 'idle') && (
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend() } }}
                placeholder={reviseTitle ? `Tell me what to change in "${reviseTitle}"…` : 'Describe the artifact you want to create…'}
                className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-purple-500"
                disabled={sending}
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || !input.trim()}
                className="text-[11px] px-3 py-1.5 rounded-lg bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-50 transition-colors"
              >
                {sending ? '…' : 'Send'}
              </button>
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
        <p className="text-[11px] text-gray-400">No artifacts yet. Generate one above.</p>
      ) : (
        <div className="space-y-2">
          {artifacts.map((a) => (
            <ArtifactRowItem
              key={a.id}
              artifact={a}
              onRevise={() => handleRevise(a.title)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
