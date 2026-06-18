import { useEffect, useRef, useState, useCallback } from 'react'
import { X, Send, Loader2, Sparkles, Pencil, FolderOpen, BookOpen, ClipboardPaste } from 'lucide-react'
import { useAppStore } from '../store/app-store'
import type { AgentGeneratorSpec, AgentGeneratorMessage, AvailableModelGroup, AvailableModelEntry } from '../../shared/types'
import { PromptLibraryModal } from './PromptLibraryModal'
import { ModelPicker } from './chat/ModelPicker'

// ─── Draft preview ────────────────────────────────────────────────────────────

function ToolBadge({ label, enabled }: { label: string; enabled: boolean }) {
  if (!enabled) return null
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300">
      {label}
    </span>
  )
}

function DraftPreview({ spec }: { spec: AgentGeneratorSpec | null }) {
  if (!spec) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400 dark:text-gray-500 select-none">
        <Sparkles className="w-8 h-8 opacity-40" />
        <p className="text-xs text-center max-w-[160px]">
          Your agent preview will appear here as the conversation progresses.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full text-sm">
      <div className="flex items-center gap-2">
        <span className="text-2xl leading-none">{spec.icon}</span>
        <span className="font-semibold text-gray-900 dark:text-gray-100 truncate">{spec.name}</span>
      </div>

      {spec.agenticMode && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
          Agentic mode
        </span>
      )}

      {spec.systemPrompt && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">System prompt</p>
          <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-5 whitespace-pre-wrap">{spec.systemPrompt}</p>
        </div>
      )}

      <div>
        <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Tools</p>
        <div className="flex flex-wrap gap-1">
          <ToolBadge label="File Edit" enabled={spec.tools.fileEdit} />
          <ToolBadge label="Terminal" enabled={spec.tools.terminal} />
          <ToolBadge label="Web Fetch" enabled={spec.tools.webFetch} />
          {!spec.tools.fileEdit && !spec.tools.terminal && !spec.tools.webFetch && (
            <span className="text-xs text-gray-400 italic">None</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 text-[10px] text-gray-400">
        <span>Temp: {spec.temperature}</span>
        {spec.responseFormat !== 'default' && <span>Format: {spec.responseFormat}</span>}
      </div>

      {spec.rootDirectory && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Root directory</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">{spec.rootDirectory}</p>
        </div>
      )}

      {spec.customCommands && spec.customCommands.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">
            Commands ({spec.customCommands.length})
          </p>
          <div className="space-y-0.5">
            {spec.customCommands.map((cmd, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="text-indigo-400 text-[10px]">/</span>
                <span className="text-xs text-gray-600 dark:text-gray-300 truncate">{cmd.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Creation overlay ─────────────────────────────────────────────────────────

const CREATION_STEPS = [
  'Creating agent…',
  'Configuring tools…',
  'Setting up context…',
  'Done ✓',
] as const

function CreationOverlay({ step, error, onRetry }: { step: number; error: string | null; onRetry: () => void }) {
  return (
    <div className="absolute inset-0 z-10 bg-white/90 dark:bg-gray-900/90 flex flex-col items-center justify-center gap-4">
      {error ? (
        <>
          <p className="text-sm text-red-600 dark:text-red-400 font-medium">Creation failed</p>
          <p className="text-xs text-gray-500 max-w-sm text-center">{error}</p>
          <button
            onClick={onRetry}
            className="px-4 py-2 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-200"
          >
            Try again
          </button>
        </>
      ) : (
        <>
          <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
          <div className="space-y-1.5 text-left min-w-[200px]">
            {CREATION_STEPS.map((label, i) => (
              <div key={i} className="flex items-center gap-2">
                {i < step ? (
                  <span className="w-3.5 h-3.5 rounded-full bg-green-500 flex items-center justify-center text-white text-[8px]">✓</span>
                ) : i === step ? (
                  <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin shrink-0" />
                ) : (
                  <span className="w-3.5 h-3.5 rounded-full border border-gray-300 dark:border-gray-600" />
                )}
                <span className={`text-xs ${i === step ? 'text-gray-900 dark:text-gray-100 font-medium' : i < step ? 'text-gray-400 line-through' : 'text-gray-400'}`}>
                  {label}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Edit form ────────────────────────────────────────────────────────────────

const RESPONSE_FORMAT_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'concise', label: 'Concise' },
  { value: 'detailed', label: 'Detailed' },
  { value: 'code-only', label: 'Code only' },
] as const

interface EditFormProps {
  spec: AgentGeneratorSpec
  onChange: (spec: AgentGeneratorSpec) => void
  onConfirm: () => void
  onCancel: () => void
}

function EditForm({ spec, onChange, onConfirm, onCancel }: EditFormProps) {
  const set = (patch: Partial<AgentGeneratorSpec>) => onChange({ ...spec, ...patch })
  const canCreate = spec.name.trim().length > 0

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-sm">

        <section>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-2">Agent</p>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                value={spec.icon}
                onChange={(e) => set({ icon: e.target.value })}
                maxLength={4}
                className="w-10 text-center text-xl border border-gray-200 dark:border-gray-700 rounded-lg px-1 py-1 bg-white dark:bg-gray-800 focus:outline-none"
                aria-label="Icon"
              />
              <input
                value={spec.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Agent name"
                className="flex-1 text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
            <textarea
              value={spec.systemPrompt}
              onChange={(e) => set({ systemPrompt: e.target.value })}
              placeholder="System prompt…"
              rows={5}
              className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
            />
          </div>
        </section>

        <section>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-2">Tools</p>
          <div className="flex flex-wrap gap-3">
            {(['fileEdit', 'terminal', 'webFetch'] as const).map((key) => {
              const labels: Record<string, string> = { fileEdit: 'File Edit', terminal: 'Terminal', webFetch: 'Web Fetch' }
              return (
                <label key={key} className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={spec.tools[key]}
                    onChange={(e) => set({ tools: { ...spec.tools, [key]: e.target.checked } })}
                    className="w-3.5 h-3.5 rounded"
                  />
                  <span className="text-xs text-gray-600 dark:text-gray-300">{labels[key]}</span>
                </label>
              )
            })}
          </div>
        </section>

        <section>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-2">Behaviour</p>
          <div className="space-y-2">
            <div>
              <p className="text-[10px] text-gray-400 mb-1">Temperature: {spec.temperature}</p>
              <input
                type="range"
                min={0} max={2} step={0.1}
                value={spec.temperature}
                onChange={(e) => set({ temperature: parseFloat(e.target.value) })}
                className="w-full"
              />
            </div>
            <div>
              <p className="text-[10px] text-gray-400 mb-1">Response format</p>
              <div className="flex gap-1 flex-wrap">
                {RESPONSE_FORMAT_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => set({ responseFormat: value })}
                    className={`px-2 py-1 rounded text-[10px] font-medium border transition-colors ${
                      spec.responseFormat === value
                        ? 'bg-indigo-600 border-indigo-600 text-white'
                        : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >{label}</button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={spec.agenticMode}
                onChange={(e) => set({ agenticMode: e.target.checked })}
                className="w-3.5 h-3.5 rounded"
              />
              <span className="text-xs text-gray-600 dark:text-gray-300">Agentic mode</span>
            </label>
          </div>
        </section>

        <section>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-2">Context</p>
          <div className="flex items-center gap-2 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800">
            <FolderOpen className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <input
              value={spec.rootDirectory ?? ''}
              onChange={(e) => set({ rootDirectory: e.target.value || undefined })}
              placeholder="/path/to/project (optional)"
              className="flex-1 text-xs bg-transparent text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none font-mono"
            />
          </div>
        </section>

      </div>

      <div className="px-4 pb-4 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          Back
        </button>
        <button
          onClick={onConfirm}
          disabled={!canCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-medium transition-colors ml-auto"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Create agent
        </button>
      </div>
    </div>
  )
}

// ─── Chat bubble ──────────────────────────────────────────────────────────────

function ChatBubble({ role, content }: { role: 'user' | 'assistant'; content: string }) {
  const displayContent = content.replace(/<agent-spec>[\s\S]*?<\/agent-spec>/g, '').trim()
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
      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0 mt-0.5">
        <Sparkles className="w-3 h-3 text-white" />
      </div>
      <div className="max-w-[85%] bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-tl-sm px-3 py-2 text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap">
        {displayContent}
      </div>
    </div>
  )
}

// ─── Session persistence ──────────────────────────────────────────────────────

const GREETING: AgentGeneratorMessage = {
  role: 'assistant',
  content: "Let's create a new agent. Tell me what you want this agent to do, and I'll help configure the perfect setup.",
}

interface AgentGeneratorSession {
  messages: AgentGeneratorMessage[]
  spec: AgentGeneratorSpec | null
}

let _session: AgentGeneratorSession | null = null

function getSession(): AgentGeneratorSession {
  return _session ?? { messages: [GREETING], spec: null }
}

function saveSession(session: AgentGeneratorSession) {
  _session = session
}

function clearSession() {
  _session = null
}

const BLANK_SPEC: AgentGeneratorSpec = {
  name: '',
  icon: '🤖',
  systemPrompt: '',
  temperature: 0.7,
  responseFormat: 'default',
  agenticMode: false,
  tools: { fileEdit: false, terminal: false, webFetch: false },
  contextDirectories: [],
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export function AgentGeneratorModal({ onClose }: { onClose: () => void }) {
  const agents = useAppStore((s) => s.agents)
  const catalogModels = useAppStore((s) => s.catalogModels)
  const globalDefaultModel = useAppStore((s) => s.globalDefaultModel)
  const addToast = useAppStore((s) => s.addToast)
  const loadAgents = useAppStore((s) => s.loadAgents)

  const [messages, setMessages] = useState<AgentGeneratorMessage[]>(() => getSession().messages)
  const [streamingText, setStreamingText] = useState('')
  const [inputText, setInputText] = useState('')
  const [spec, setSpec] = useState<AgentGeneratorSpec | null>(() => getSession().spec)
  const [isStreaming, setIsStreaming] = useState(false)
  const [creationStep, setCreationStep] = useState<number>(-1)
  const [creationError, setCreationError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editSpec, setEditSpec] = useState<AgentGeneratorSpec | null>(null)
  const [genModel, setGenModel] = useState<string | null>(null)
  const [availableGroups, setAvailableGroups] = useState<AvailableModelGroup[]>([])
  const [missedSpec, setMissedSpec] = useState(false)
  const [showPromptLibrary, setShowPromptLibrary] = useState(false)

  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const modelPickerRef = useRef<HTMLButtonElement>(null)
  const streamingTextRef = useRef('')
  const isCreating = creationStep >= 0

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  useEffect(() => {
    window.api.listAvailableModels().then(setAvailableGroups).catch(() => {})
  }, [])

  useEffect(() => {
    const offToken = window.api.onAgentGeneratorToken((chunk) => {
      streamingTextRef.current += chunk
      setStreamingText((prev) => prev + chunk)
    })
    const offSpec = window.api.onAgentGeneratorSpecReady((incoming) => {
      setSpec(incoming)
      setMissedSpec(false)
    })
    const offDone = window.api.onAgentGeneratorDone(({ hasSpec }) => {
      const capturedText = streamingTextRef.current
      const clean = capturedText.replace(/<agent-spec>[\s\S]*?<\/agent-spec>/g, '').trim()
      if (clean) {
        setMessages((prev) => [...prev, { role: 'assistant', content: clean }])
      }
      if (!hasSpec && !clean) setMissedSpec(true)
    })
    return () => {
      offToken()
      offSpec()
      offDone()
    }
  }, [])

  const sendMessage = useCallback(async (userText: string) => {
    if (isStreaming || !userText.trim()) return

    const userMsg: AgentGeneratorMessage = { role: 'user', content: userText.trim() }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setInputText('')
    setIsStreaming(true)
    setStreamingText('')
    streamingTextRef.current = ''
    setMissedSpec(false)

    try {
      const result = await window.api.agentGeneratorChat(nextMessages, genModel ?? undefined)
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
  }, [isStreaming, messages, addToast, genModel])

  useEffect(() => { saveSession({ messages, spec }) }, [messages, spec])

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items).filter((item) => item.type.startsWith('image/'))
    if (items.length === 0) return
    e.preventDefault()
    addToast('Image paste is not yet supported in agent generator', 'info')
  }, [addToast])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage(inputText)
    }
  }

  const handleCreate = useCallback(async (specToCreate: AgentGeneratorSpec) => {
    setCreationError(null)
    setCreationStep(0)

    try {
      setCreationStep(1)
      // Call createAgent so the renderer store refreshes
      setCreationStep(2)
      const t = specToCreate.tools
      await window.api.createAgent({
        name: specToCreate.name,
        icon: specToCreate.icon,
        systemPrompt: specToCreate.systemPrompt,
        temperature: specToCreate.temperature,
        responseFormat: specToCreate.responseFormat,
        maxTokens: 4096,
        agenticMode: specToCreate.agenticMode,
        contextDirectories: specToCreate.contextDirectories,
        contextFiles: [],
        mcpServers: [],
        rootDirectory: specToCreate.rootDirectory ?? '',
        memory: specToCreate.memory ?? '',
        customCommands: specToCreate.customCommands ?? [],
        contextRules: { ignoredGlobs: [], autoInjectWorkspace: false, autoInjectGit: false },
        tools: {
          fileEdit: { enabled: t.fileEdit, approval: 'always-ask', instructions: '' },
          terminal: { enabled: t.terminal, approval: 'always-ask', instructions: '' },
          webFetch: { enabled: t.webFetch, approval: 'always-ask', instructions: '' },
        },
      })

      setCreationStep(3)
      await loadAgents()
      clearSession()
      onClose()
      addToast(`Agent "${specToCreate.name}" created`, 'success')
    } catch (err) {
      setCreationError(err instanceof Error ? err.message : 'Creation failed')
      setCreationStep(-1)
    }
  }, [addToast, loadAgents, onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Generate new agent"
    >
      <div
        className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 'min(860px, 96vw)', height: 'min(640px, 90vh)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-500" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">New Agent</h2>
          </div>
          <div className="flex items-center gap-2">
            {!isEditing && !isCreating && (
              <>
                {messages.length > 1 && (
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
                  onClick={() => {
                    setEditSpec(spec ? { ...spec } : { ...BLANK_SPEC })
                    setIsEditing(true)
                  }}
                  className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  Set up manually
                </button>
              </>
            )}
            <button
              onClick={onClose}
              disabled={isCreating && !creationError}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body — two columns */}
        <div className="flex flex-1 min-h-0 divide-x divide-gray-200 dark:divide-gray-700">
          {/* Left: draft preview (38%) */}
          <div className="relative" style={{ width: '38%' }}>
            <div className="absolute inset-0 overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 shrink-0">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Draft preview</p>
              </div>
              <div className="h-[calc(100%-33px)] overflow-hidden">
                <DraftPreview spec={isEditing ? editSpec : spec} />
              </div>
            </div>
          </div>

          {/* Right: chat or edit form (62%) */}
          <div className="flex flex-col flex-1 min-w-0 relative">
            {isEditing && editSpec ? (
              <EditForm
                spec={editSpec}
                onChange={setEditSpec}
                onConfirm={() => void handleCreate(editSpec)}
                onCancel={() => setIsEditing(false)}
              />
            ) : (
              <>
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
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0">
                        <Sparkles className="w-3 h-3 text-white" />
                      </div>
                      <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-tl-sm">
                        <Loader2 className="w-3 h-3 text-indigo-400 animate-spin shrink-0" />
                        <span className="text-xs text-gray-500 dark:text-gray-400">Generating agent spec…</span>
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
                        {' — '}{spec.name}
                      </div>
                      <button
                        onClick={() => { setEditSpec({ ...spec }); setIsEditing(true) }}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      >
                        <Pencil className="w-3 h-3" />
                        Edit
                      </button>
                      <button
                        onClick={() => void handleCreate(spec)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium transition-colors"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        Create agent
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
                        onPaste={(e) => void handlePaste(e)}
                        placeholder={spec ? 'Refine or ask for changes…' : 'Describe your agent…'}
                        rows={1}
                        disabled={isStreaming}
                        className="chat-input w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed overflow-y-auto"
                      />
                      <div className="flex items-center justify-between px-2 pb-2">
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => setShowPromptLibrary(true)}
                            disabled={isStreaming}
                            className="p-1.5 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            title="Insert prompt from library"
                            aria-label="Insert prompt from library"
                          >
                            <BookOpen className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="flex items-center gap-1">
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
                    </div>
                    {missedSpec && (
                      <p className="text-[10px] text-amber-500 mt-1.5 text-center">
                        No spec was generated — try asking me to configure the agent.
                      </p>
                    )}
                    {!spec && !missedSpec && (
                      <p className="text-[10px] text-gray-400 mt-1.5 text-center">
                        Press Enter to send · Shift+Enter for newline
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Creation progress overlay */}
        {isCreating && (
          <CreationOverlay
            step={creationStep}
            error={creationError}
            onRetry={() => {
              const target = editSpec ?? spec
              if (target) void handleCreate(target)
            }}
          />
        )}
      </div>

      {showPromptLibrary && (
        <PromptLibraryModal
          projectId={null}
          draftContent={inputText}
          onInsert={(content) => {
            setInputText((prev) => prev ? `${prev}\n${content}` : content)
            inputRef.current?.focus()
          }}
          onRun={(content) => void sendMessage(content)}
          onClose={() => setShowPromptLibrary(false)}
        />
      )}
    </div>
  )
}
