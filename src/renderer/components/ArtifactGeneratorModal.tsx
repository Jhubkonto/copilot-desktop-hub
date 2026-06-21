import { useEffect, useRef, useState, useCallback } from 'react'
import { X, Send, Loader2, Sparkles, Package } from 'lucide-react'
import { useAppStore } from '../store/app-store'
import type { ArtifactSpec, ArtifactGeneratorMessage, AvailableModelGroup, AvailableModelEntry } from '../../shared/types'
import { ModelPicker } from './chat/ModelPicker'
import { VoiceInputButton } from './chat/VoiceInputButton'

// ─── Spec preview ─────────────────────────────────────────────────────────────

function SpecPreview({ spec }: { spec: ArtifactSpec | null }) {
  if (!spec) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400 dark:text-gray-500 select-none">
        <Package className="w-8 h-8 opacity-40" />
        <p className="text-xs text-center max-w-[160px]">
          Your artifact spec will appear here as the conversation progresses.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full text-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-medium uppercase">
          {spec.kind}
        </span>
        <span className="font-semibold text-gray-900 dark:text-gray-100 truncate">{spec.title}</span>
      </div>

      {spec.intendedUse && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Intended use</p>
          <p className="text-xs text-gray-600 dark:text-gray-300">{spec.intendedUse}</p>
        </div>
      )}

      {spec.audience && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Audience</p>
          <p className="text-xs text-gray-600 dark:text-gray-300">{spec.audience}</p>
        </div>
      )}

      {spec.outputFiles.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Output files</p>
          <div className="space-y-0.5">
            {spec.outputFiles.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[10px] px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 font-medium">{f.role}</span>
                <span className="text-xs font-mono text-gray-600 dark:text-gray-400 truncate">{f.path}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {spec.acceptanceCriteria.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Acceptance criteria</p>
          <ul className="space-y-0.5">
            {spec.acceptanceCriteria.map((c, i) => (
              <li key={i} className="text-xs text-gray-600 dark:text-gray-300 flex gap-1.5">
                <span className="text-green-500 shrink-0">✓</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ─── Chat bubble ──────────────────────────────────────────────────────────────

function ChatBubble({ role, content }: { role: 'user' | 'assistant'; content: string }) {
  const displayContent = content.replace(/<artifact-spec>[\s\S]*?<\/artifact-spec>/g, '').trim()
  if (!displayContent) return null

  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-blue-500 text-white rounded-2xl rounded-tr-sm px-3 py-2 text-sm whitespace-pre-wrap">
          {displayContent}
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2">
      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center shrink-0 mt-0.5">
        <Package className="w-3 h-3 text-white" />
      </div>
      <div className="max-w-[85%] bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-tl-sm px-3 py-2 text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap">
        {displayContent}
      </div>
    </div>
  )
}

// ─── Session persistence ──────────────────────────────────────────────────────

const GREETING: ArtifactGeneratorMessage = {
  role: 'assistant',
  content: "Let's create an artifact. Tell me what you want to build — a document, code file, prompt pack, data file, or anything else — and I'll help define it.",
}

interface ArtifactGeneratorSession {
  messages: ArtifactGeneratorMessage[]
  spec: ArtifactSpec | null
}

let _session: ArtifactGeneratorSession | null = null

function getSession(): ArtifactGeneratorSession {
  return _session ?? { messages: [GREETING], spec: null }
}
function saveSession(s: ArtifactGeneratorSession) { _session = s }
function clearSession() { _session = null }

// ─── Background generation lifecycle vars ────────────────────────────────────
// These survive modal unmount so the file-event listener stays active during generation.

let _lastGeneratedAbsPath = ''
let _cleanupFileListener: (() => void) | null = null
let _generationInFlight = false

// ─── Main modal ───────────────────────────────────────────────────────────────

interface ArtifactGeneratorModalProps {
  projectId?: string
  onClose: () => void
  onArtifactCreated?: () => void
}

export function ArtifactGeneratorModal({ projectId, onClose, onArtifactCreated }: ArtifactGeneratorModalProps) {
  const catalogModels = useAppStore((s) => s.catalogModels)
  const globalDefaultModel = useAppStore((s) => s.globalDefaultModel)
  const addToast = useAppStore((s) => s.addToast)
  const setPendingArtifactGeneration = useAppStore((s) => s.setPendingArtifactGeneration)
  const setShowArtifactsPanel = useAppStore((s) => s.setShowArtifactsPanel)

  const [messages, setMessages] = useState<ArtifactGeneratorMessage[]>(() => getSession().messages)
  const [streamingText, setStreamingText] = useState('')
  const [inputText, setInputText] = useState('')
  const [spec, setSpec] = useState<ArtifactSpec | null>(() => getSession().spec)
  const [isStreaming, setIsStreaming] = useState(false)
  const [genModel, setGenModel] = useState<string | null>(null)
  const [availableGroups, setAvailableGroups] = useState<AvailableModelGroup[]>([])
  const [missedSpec, setMissedSpec] = useState(false)

  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const modelPickerRef = useRef<HTMLButtonElement>(null)
  const streamingTextRef = useRef('')

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  useEffect(() => {
    window.api.listAvailableModels().then(setAvailableGroups).catch(() => {})
  }, [])

  useEffect(() => {
    const offToken = window.api.onArtifactGeneratorToken((chunk) => {
      streamingTextRef.current += chunk
      setStreamingText((prev) => prev + chunk)
    })
    const offSpec = window.api.onArtifactGeneratorSpecReady((incoming) => {
      const scoped = projectId ? { ...incoming, scope: { type: 'project' as const, projectId } } : incoming
      setSpec(scoped)
      setMissedSpec(false)
    })
    const offFile = window.api.onArtifactGeneratorFileEvent((e) => {
      if (e.absolutePath) _lastGeneratedAbsPath = e.absolutePath
    })
    _cleanupFileListener = offFile

    const offDone = window.api.onArtifactGeneratorDone(({ hasSpec }) => {
      const capturedText = streamingTextRef.current
      const clean = capturedText.replace(/<artifact-spec>[\s\S]*?<\/artifact-spec>/g, '').trim()
      if (clean) {
        setMessages((prev) => [...prev, { role: 'assistant', content: clean }])
      }
      if (!hasSpec && !clean) setMissedSpec(true)
    })

    return () => {
      offToken()
      offSpec()
      offDone()
      // Only tear down file listener if no generation is in flight
      if (!_generationInFlight) {
        offFile()
        _cleanupFileListener = null
      }
    }
  }, [projectId])

  const sendMessage = useCallback(async (userText: string) => {
    if (isStreaming || !userText.trim()) return
    const userMsg: ArtifactGeneratorMessage = { role: 'user', content: userText.trim() }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setInputText('')
    setIsStreaming(true)
    setStreamingText('')
    streamingTextRef.current = ''
    setMissedSpec(false)

    try {
      const result = await window.api.artifactGeneratorChat(nextMessages, projectId, genModel ?? undefined)
      if (result && typeof result === 'object' && 'error' in result) {
        throw new Error(String((result as { error: unknown }).error))
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to get response', 'error')
    } finally {
      setIsStreaming(false)
      setStreamingText('')
      streamingTextRef.current = ''
    }
  }, [isStreaming, messages, addToast, genModel, projectId])

  useEffect(() => { saveSession({ messages, spec }) }, [messages, spec])

  const handleGenerate = useCallback(async () => {
    if (!spec) return
    const runId = crypto.randomUUID()
    _generationInFlight = true
    setPendingArtifactGeneration({ title: spec.title, kind: spec.kind, startedAt: Date.now() })
    clearSession()
    onClose()

    const GENERATION_TIMEOUT_MS = 3 * 60 * 1000
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Generation timed out after 3 minutes. The model may be overloaded — try again.')), GENERATION_TIMEOUT_MS)
    )

    try {
      const result = await Promise.race([
        window.api.artifactGeneratorGenerate(runId, spec, projectId, genModel ?? undefined),
        timeoutPromise,
      ])
      if (result && typeof result === 'object' && 'error' in result) {
        throw new Error(String((result as { error: unknown }).error))
      }
      setPendingArtifactGeneration(null)
      onArtifactCreated?.()
      addToast('Artifact ready', 'success', {
        label: 'View',
        onClick: () => setShowArtifactsPanel(true),
      })
    } catch (err) {
      setPendingArtifactGeneration(null)
      addToast(err instanceof Error ? err.message : 'Generation failed', 'error')
    } finally {
      _generationInFlight = false
      _cleanupFileListener?.()
      _cleanupFileListener = null
    }
  }, [spec, projectId, genModel, onClose, onArtifactCreated, addToast, setPendingArtifactGeneration, setShowArtifactsPanel])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage(inputText)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Generate new artifact"
    >
      <div
        className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 'min(860px, 96vw)', height: 'min(640px, 90vh)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-purple-500" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {projectId ? 'New Project Artifact' : 'New Global Artifact'}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {(messages.length > 1 || spec) && (
              <button
                onClick={() => {
                  clearSession()
                  setMessages([GREETING])
                  setSpec(null)
                  setMissedSpec(false)
                  setInputText('')
                  setGenModel(null)
                }}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                Start over
              </button>
            )}
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body — two columns */}
        <div className="flex flex-1 min-h-0 divide-x divide-gray-200 dark:divide-gray-700">
          {/* Left: spec preview (38%) */}
          <div className="relative" style={{ width: '38%' }}>
            <div className="absolute inset-0 overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 shrink-0">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Artifact spec</p>
              </div>
              <div className="h-[calc(100%-33px)] overflow-hidden">
                <SpecPreview spec={spec} />
              </div>
            </div>
          </div>

          {/* Right: chat (62%) */}
          <div className="flex flex-col flex-1 min-w-0">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.map((msg, i) => (
                <ChatBubble key={i} role={msg.role} content={msg.content} />
              ))}
              {isStreaming && streamingText && (
                <ChatBubble role="assistant" content={streamingText} />
              )}
              {isStreaming && !streamingText && (
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center shrink-0">
                    <Package className="w-3 h-3 text-white" />
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-tl-sm">
                    <Loader2 className="w-3 h-3 text-purple-400 animate-spin shrink-0" />
                    <span className="text-xs text-gray-500 dark:text-gray-400">Generating artifact spec…</span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input / spec footer */}
            <div className="border-t border-gray-100 dark:border-gray-800">
              {spec && !isStreaming && (
                <div className="px-4 pt-3 pb-2 flex items-center gap-2">
                  <div className="flex-1 text-xs text-gray-500 dark:text-gray-400 truncate">
                    <span className="text-green-600 dark:text-green-400 font-medium">Spec ready</span>
                    {' — '}{spec.title}
                  </div>
                  <button
                    onClick={() => void handleGenerate()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Generate artifact
                  </button>
                </div>
              )}
              <div className="px-4 pb-4 pt-2">
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus-within:ring-2 focus-within:ring-gray-400 dark:focus-within:ring-gray-500 focus-within:border-transparent transition-colors">
                  <textarea
                    ref={inputRef}
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={spec ? 'Refine the spec or ask for changes…' : 'Describe the artifact you want to create…'}
                    rows={1}
                    disabled={isStreaming}
                    className="chat-input w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed overflow-y-auto"
                  />
                  <div className="flex items-center justify-end px-2 pb-2 gap-1">
                    <ModelPicker
                      value={genModel ?? 'default'}
                      availableGroups={availableGroups}
                      catalogModels={catalogModels}
                      globalDefaultModel={globalDefaultModel ?? undefined}
                      includeDefault={true}
                      buttonRef={modelPickerRef}
                      onSelectDefault={() => setGenModel(null)}
                      onSelectAvailableModel={(group: AvailableModelGroup, model: AvailableModelEntry) => {
                        const id = group.sourceType === 'cli' ? `${group.sourceKey}:${model.id}` : model.id
                        setGenModel(id)
                      }}
                    />
                    <VoiceInputButton disabled={isStreaming} onText={(text) => setInputText((current) => current.trim() ? `${current.trimEnd()} ${text}` : text)} />
                    <button
                      type="button"
                      onClick={() => void sendMessage(inputText)}
                      disabled={isStreaming || !inputText.trim()}
                      className={`p-1.5 rounded-md flex items-center justify-center transition-colors ${
                        inputText.trim() && !isStreaming
                          ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-300'
                          : 'bg-transparent text-gray-400 dark:text-gray-500 cursor-not-allowed'
                      }`}
                      aria-label="Send message"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {missedSpec && (
                  <p className="text-[10px] text-amber-500 mt-1.5 text-center">
                    No spec was generated — try describing what artifact you want.
                  </p>
                )}
                {!spec && !missedSpec && (
                  <p className="text-[10px] text-gray-400 mt-1.5 text-center">
                    Press Enter to send · Shift+Enter for newline
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
