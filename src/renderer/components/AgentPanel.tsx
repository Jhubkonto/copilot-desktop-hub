import { useState, useEffect, useRef } from 'react'
import { X, Settings, Folder, FileText, Plus, Pencil, Wrench, ToggleLeft, ToggleRight } from 'lucide-react'
import { useAppStore, type AgentConfig } from '../store/app-store'
import { MODEL_OPTIONS } from '../../shared/models'
import { ResizeHandle } from './ResizeHandle'
import { MarkdownRenderer } from './MarkdownRenderer'

interface KnowledgeFile {
  id: string
  agent_id: string
  file_path: string
  inject_mode: 'always' | 'on-demand'
  sort_order: number
  created_at: number
  updated_at: number
}

interface McpTool {
  name: string
  description?: string
  serverId: string
  serverName: string
}

interface McpToolOverride {
  agent_id: string
  server_id: string
  tool_name: string
  enabled: number
  approval: string
  instructions: string
}

const EMPTY_AGENT: Omit<AgentConfig, 'id'> = {
  name: '',
  icon: '🤖',
  systemPrompt: '',
  model: 'default',
  temperature: 0.7,
  maxTokens: 4096,
  contextDirectories: [],
  contextFiles: [],
  mcpServers: [],
  agenticMode: false,
  tools: {
    fileEdit: { enabled: false, approval: 'always-ask', instructions: '' },
    terminal: { enabled: false, approval: 'always-ask', instructions: '' },
    webFetch: { enabled: false, approval: 'always-ask', instructions: '' },
  },
  responseFormat: 'default',
  rootDirectory: '',
  contextRules: { ignoredGlobs: [], autoInjectWorkspace: false, autoInjectGit: false },
  memory: '',
  customCommands: []
}

const EMOJI_OPTIONS = ['🤖', '🔍', '🐛', '💡', '📝', '🎨', '🔧', '🚀', '🧠', '⚡', '🛡️', '📊']
const FORMAT_OPTIONS = ['default', 'concise', 'detailed', 'code-only']

export function AgentPanel({ width, onResize }: { width: number; onResize: (size: number) => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const editingAgentId = useAppStore((s) => s.editingAgentId)
  const agents = useAppStore((s) => s.agents)
  const onSave = useAppStore((s) => s.saveAgent)
  const onClose = useAppStore((s) => s.closeAgentPanel)
  const onDelete = useAppStore((s) => s.deleteAgent)
  const onDuplicate = useAppStore((s) => s.duplicateAgent)
  const onExport = useAppStore((s) => s.exportAgent)

  const agent = editingAgentId ? agents.find((a) => a.id === editingAgentId) ?? null : null
  const [tab, setTab] = useState<'settings' | 'skills' | 'knowledge' | 'json'>('settings')
  const [config, setConfig] = useState<AgentConfig>({
    id: '',
    ...EMPTY_AGENT,
    ...agent
  })
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState('')

  // Knowledge tab state
  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFile[]>([])
  const [editingKnowledgeFile, setEditingKnowledgeFile] = useState<{ id: string; filePath: string } | null>(null)
  const [editingFileContent, setEditingFileContent] = useState('')
  const [agentMcpTools, setAgentMcpTools] = useState<McpTool[]>([])
  const [mcpToolOverrides, setMcpToolOverrides] = useState<McpToolOverride[]>([])

  const isEditing = !!agent?.id
  const isDefault = agent?.isDefault === true

  useEffect(() => {
    if (tab === 'json') {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, isDefault: _d, ...rest } = config as AgentConfig & { isDefault?: boolean }
      setJsonText(JSON.stringify(rest, null, 2))
      setJsonError('')
    }
    if (tab === 'skills' && isEditing) {
      window.api.listMcpToolsForAgent(config.id).then((tools) => setAgentMcpTools(tools as McpTool[]))
      window.api.getMcpToolOverrides(config.id).then((overrides) => setMcpToolOverrides(overrides as McpToolOverride[]))
    }
    if (tab === 'knowledge' && isEditing) {
      window.api.listKnowledgeFiles(config.id).then((files) =>
        setKnowledgeFiles(files as KnowledgeFile[])
      )
    }
  }, [tab, config, isEditing])

  const updateField = <K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  const getMcpOverride = (serverId: string, toolName: string): McpToolOverride | undefined =>
    mcpToolOverrides.find((o) => o.server_id === serverId && o.tool_name === toolName)

  const handleSetMcpOverride = async (serverId: string, toolName: string, field: 'enabled' | 'approval' | 'instructions', value: string | boolean) => {
    const existing = getMcpOverride(serverId, toolName)
    const newOverride = {
      enabled: existing?.enabled ?? 1,
      approval: existing?.approval ?? 'always-ask',
      instructions: existing?.instructions ?? '',
      [field]: typeof value === 'boolean' ? (value ? 1 : 0) : value
    }
    await window.api.setMcpToolOverride(config.id, serverId, toolName, { ...newOverride, enabled: newOverride.enabled === 1 || newOverride.enabled === true })
    setMcpToolOverrides((prev) => {
      const filtered = prev.filter((o) => !(o.server_id === serverId && o.tool_name === toolName))
      return [...filtered, { agent_id: config.id, server_id: serverId, tool_name: toolName, ...newOverride } as McpToolOverride]
    })
  }

  const handleJsonSave = () => {
    try {
      const parsed = JSON.parse(jsonText)
      setConfig((prev) => ({
        ...prev,
        ...parsed,
        id: prev.id
      }))
      setJsonError('')
      setTab('settings')
    } catch (e) {
      setJsonError('Invalid JSON: ' + (e as Error).message)
    }
  }

  const handleSave = () => {
    if (!config.name.trim()) return
    onSave(config)
  }

  const handleAddDirectories = async () => {
    const dirs = await window.api.openDirectoryDialog()
    if (dirs && dirs.length > 0) {
      updateField('contextDirectories', [...config.contextDirectories, ...dirs])
    }
  }

  const handleAddFiles = async () => {
    const files = await window.api.openFileDialog()
    if (files && files.length > 0) {
      const paths = files.map((f: { path: string }) => f.path)
      updateField('contextFiles', [...config.contextFiles, ...paths])
    }
  }

  const removeContextDir = (index: number) => {
    updateField(
      'contextDirectories',
      config.contextDirectories.filter((_, i) => i !== index)
    )
  }

  const removeContextFile = (index: number) => {
    updateField(
      'contextFiles',
      config.contextFiles.filter((_, i) => i !== index)
    )
  }

  const handlePickRootDirectory = async () => {
    const dirs = await window.api.openDirectoryDialog()
    if (dirs && dirs.length > 0) {
      updateField('rootDirectory', dirs[0])
    }
  }

  const [newGlob, setNewGlob] = useState('')
  const addIgnoredGlob = () => {
    const g = newGlob.trim()
    if (!g) return
    const current = config.contextRules ?? { ignoredGlobs: [], autoInjectWorkspace: false, autoInjectGit: false }
    updateField('contextRules', { ...current, ignoredGlobs: [...current.ignoredGlobs, g] })
    setNewGlob('')
  }
  const removeIgnoredGlob = (i: number) => {
    const current = config.contextRules ?? { ignoredGlobs: [], autoInjectWorkspace: false, autoInjectGit: false }
    updateField('contextRules', { ...current, ignoredGlobs: current.ignoredGlobs.filter((_, idx) => idx !== i) })
  }

  const [newCmdName, setNewCmdName] = useState('')
  const [newCmdDesc, setNewCmdDesc] = useState('')
  const [newCmdPrompt, setNewCmdPrompt] = useState('')
  const addCustomCommand = () => {
    const name = newCmdName.trim().replace(/^\/+/, '')
    if (!name) return
    const cmd = { name: `/${name}`, description: newCmdDesc.trim(), prompt: newCmdPrompt.trim() }
    updateField('customCommands', [...(config.customCommands ?? []), cmd])
    setNewCmdName('')
    setNewCmdDesc('')
    setNewCmdPrompt('')
  }
  const removeCustomCommand = (i: number) => {
    updateField('customCommands', (config.customCommands ?? []).filter((_, idx) => idx !== i))
  }

  const handleAddKnowledgeFile = async () => {
    const files = await window.api.openFileDialog()
    if (!files || files.length === 0) return
    const filePath = (files[0] as { path: string }).path
    const row = await window.api.addKnowledgeFile(config.id, filePath, 'always')
    setKnowledgeFiles((prev) => [...prev, row as KnowledgeFile])
  }

  const handleRemoveKnowledgeFile = async (id: string) => {
    await window.api.removeKnowledgeFile(id)
    setKnowledgeFiles((prev) => prev.filter((f) => f.id !== id))
  }

  const handleToggleInjectMode = async (file: KnowledgeFile) => {
    const newMode = file.inject_mode === 'always' ? 'on-demand' : 'always'
    await window.api.updateKnowledgeInjectMode(file.id, newMode)
    setKnowledgeFiles((prev) =>
      prev.map((f) => (f.id === file.id ? { ...f, inject_mode: newMode } : f))
    )
  }

  const handleEditKnowledgeFile = async (file: KnowledgeFile) => {
    const content = (await window.api.readKnowledgeFile(config.id, file.file_path)) as string
    setEditingKnowledgeFile({ id: file.id, filePath: file.file_path })
    setEditingFileContent(content)
  }

  const handleSaveKnowledgeFile = async () => {
    if (!editingKnowledgeFile) return
    await window.api.writeKnowledgeFile(config.id, editingKnowledgeFile.filePath, editingFileContent)
    setEditingKnowledgeFile(null)
  }

  return (
    <div className="fixed inset-0 top-9 z-50 flex" role="dialog" aria-modal="true" aria-label="Agent configuration">
      <div className="flex-1 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} className="relative bg-white dark:bg-gray-900 shadow-xl flex flex-col border-l border-gray-200 dark:border-gray-700" style={{ width }}>
        <ResizeHandle direction="horizontal" align="start" containerRef={panelRef} onSetSize={onResize} />
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-medium text-gray-800 dark:text-gray-100">
            {isEditing ? 'Edit Agent' : 'Create Agent'}
          </h2>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
              {(['settings', 'skills', 'knowledge', 'json'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`text-xs px-2 py-1 ${
                    tab === t
                      ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  {t === 'settings' ? (
                    <span className="flex items-center gap-1"><Settings className="w-3 h-3" /> Settings</span>
                  ) : t === 'skills' ? (
                    <span className="flex items-center gap-1"><Wrench className="w-3 h-3" /> Skills</span>
                  ) : t === 'knowledge' ? (
                    <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> Knowledge</span>
                  ) : (
                    '{ } JSON'
                  )}
                </button>
              ))}
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
              aria-label="Close agent panel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {tab === 'settings' ? (
            <>
              {/* Name + Icon */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  Name
                </label>
                <input
                  value={config.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="Agent name..."
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  Icon
                </label>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <input
                    value={config.icon}
                    onChange={(e) => updateField('icon', e.target.value)}
                    maxLength={2}
                    className="w-12 text-center px-2 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {EMOJI_OPTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => updateField('icon', emoji)}
                      className={`w-8 h-8 rounded text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                        config.icon === emoji
                          ? 'bg-gray-200 dark:bg-gray-700 ring-1 ring-gray-400'
                          : ''
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              {/* System Prompt */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  System Prompt
                </label>
                <textarea
                  value={config.systemPrompt}
                  onChange={(e) => updateField('systemPrompt', e.target.value)}
                  placeholder="Instructions for the agent..."
                  rows={6}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                />
              </div>

              {/* Agent Memory */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  Agent Memory
                </label>
                <p className="text-[11px] text-gray-400 dark:text-gray-500">
                  Always appended to the system prompt in every message.
                </p>
                <textarea
                  value={config.memory ?? ''}
                  onChange={(e) => updateField('memory', e.target.value)}
                  placeholder="Persistent notes the agent always has access to..."
                  rows={3}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                />
              </div>

              {/* Model + Temperature + Max Tokens */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                    Model
                  </label>
                  <select
                    value={config.model}
                    onChange={(e) => updateField('model', e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {MODEL_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                    Response Format
                  </label>
                  <select
                    value={config.responseFormat}
                    onChange={(e) => updateField('responseFormat', e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {FORMAT_OPTIONS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  Temperature: {config.temperature.toFixed(1)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={config.temperature}
                  onChange={(e) => updateField('temperature', parseFloat(e.target.value))}
                  className="w-full accent-blue-500"
                />
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Precise</span>
                  <span>Creative</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  Max Tokens
                </label>
                <input
                  type="number"
                  value={config.maxTokens}
                  onChange={(e) => updateField('maxTokens', parseInt(e.target.value) || 4096)}
                  min={256}
                  max={128000}
                  step={256}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Agentic Mode */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.agenticMode}
                    onChange={(e) => updateField('agenticMode', e.target.checked)}
                    className="rounded border-gray-300 dark:border-gray-600 accent-blue-500"
                  />
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                    Agentic Mode
                  </span>
                </label>
              </div>

              {/* Context Directories */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  Context Directories
                </label>
                {config.contextDirectories.length > 0 && (
                  <div className="space-y-1">
                    {config.contextDirectories.map((dir, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 px-2 py-1 rounded bg-gray-50 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400"
                      >
                        <span className="flex-1 truncate" title={dir}>
                          <Folder className="w-3 h-3 inline mr-1" />{dir}
                        </span>
                        <button
                          onClick={() => removeContextDir(i)}
                          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                          aria-label="Remove directory"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  onClick={handleAddDirectories}
                  className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                >
                  <Plus className="w-3 h-3" />
                  Add Directory
                </button>
              </div>

              {/* Context Files */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  Context Files
                </label>
                {config.contextFiles.length > 0 && (
                  <div className="space-y-1">
                    {config.contextFiles.map((file, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 px-2 py-1 rounded bg-gray-50 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400"
                      >
                        <span className="flex-1 truncate" title={file}>
                          <FileText className="w-3 h-3 inline mr-1" />{file}
                        </span>
                        <button
                          onClick={() => removeContextFile(i)}
                          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                          aria-label="Remove file"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  onClick={handleAddFiles}
                  className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                >
                  <Plus className="w-3 h-3" />
                  Add Files
                </button>
              </div>

              {/* Root Directory */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  Root Directory
                </label>
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-xs text-gray-600 dark:text-gray-400 px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 min-h-[32px]">
                    {config.rootDirectory ? config.rootDirectory : <span className="italic text-gray-400 dark:text-gray-500">Inherit global CWD</span>}
                  </span>
                  <button
                    onClick={handlePickRootDirectory}
                    className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
                    aria-label="Pick root directory"
                  >
                    <Folder className="w-3 h-3" />
                    Browse
                  </button>
                  {config.rootDirectory && (
                    <button
                      onClick={() => updateField('rootDirectory', '')}
                      className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                      aria-label="Clear root directory"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Context Rules */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  Context Rules
                </label>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.contextRules?.autoInjectWorkspace ?? false}
                      onChange={(e) => updateField('contextRules', {
                        ...(config.contextRules ?? { ignoredGlobs: [], autoInjectWorkspace: false, autoInjectGit: false }),
                        autoInjectWorkspace: e.target.checked
                      })}
                      className="rounded border-gray-300 dark:border-gray-600 accent-blue-500"
                    />
                    <span className="text-xs text-gray-600 dark:text-gray-400">
                      Auto-inject <code className="font-mono">@workspace</code>
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.contextRules?.autoInjectGit ?? false}
                      onChange={(e) => updateField('contextRules', {
                        ...(config.contextRules ?? { ignoredGlobs: [], autoInjectWorkspace: false, autoInjectGit: false }),
                        autoInjectGit: e.target.checked
                      })}
                      className="rounded border-gray-300 dark:border-gray-600 accent-blue-500"
                    />
                    <span className="text-xs text-gray-600 dark:text-gray-400">
                      Auto-inject <code className="font-mono">@git</code>
                    </span>
                  </label>
                </div>
                {/* Ignored Globs */}
                <div className="space-y-1">
                  <p className="text-[11px] text-gray-400 dark:text-gray-500">Ignored glob patterns (workspace summary)</p>
                  {(config.contextRules?.ignoredGlobs ?? []).map((g, i) => (
                    <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-gray-50 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400">
                      <code className="flex-1 font-mono truncate">{g}</code>
                      <button
                        onClick={() => removeIgnoredGlob(i)}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                        aria-label={`Remove glob ${g}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <div className="flex gap-1.5">
                    <input
                      value={newGlob}
                      onChange={(e) => setNewGlob(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addIgnoredGlob() } }}
                      placeholder="**/node_modules/**"
                      className="flex-1 px-2 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                    />
                    <button
                      onClick={addIgnoredGlob}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                      aria-label="Add glob pattern"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Custom Commands */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  Custom Slash Commands
                </label>
                {(config.customCommands ?? []).map((cmd, i) => (
                  <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 space-y-1 text-xs text-gray-600 dark:text-gray-400">
                    <div className="flex items-center justify-between">
                      <code className="font-mono text-blue-600 dark:text-blue-400">{cmd.name}</code>
                      <button
                        onClick={() => removeCustomCommand(i)}
                        className="text-gray-400 hover:text-red-500 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                        aria-label={`Remove command ${cmd.name}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    {cmd.description && <p className="text-gray-400 dark:text-gray-500 italic">{cmd.description}</p>}
                    <p className="text-[11px] text-gray-400 truncate">{cmd.prompt}</p>
                  </div>
                ))}
                {/* Add new command */}
                <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-2 space-y-1.5">
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 font-medium">New command</p>
                  <div className="flex gap-1.5">
                    <input
                      value={newCmdName}
                      onChange={(e) => setNewCmdName(e.target.value)}
                      placeholder="/command-name"
                      className="w-32 px-2 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                    />
                    <input
                      value={newCmdDesc}
                      onChange={(e) => setNewCmdDesc(e.target.value)}
                      placeholder="Short description"
                      className="flex-1 px-2 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <textarea
                    value={newCmdPrompt}
                    onChange={(e) => setNewCmdPrompt(e.target.value)}
                    placeholder="Prompt text loaded into the input when this command is invoked..."
                    rows={2}
                    className="w-full px-2 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                  />
                  <button
                    onClick={addCustomCommand}
                    disabled={!newCmdName.trim()}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    Add Command
                  </button>
                </div>
              </div>
            </>
          ) : tab === 'skills' ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Built-in Tools</h3>
                {([
                  { key: 'fileEdit' as const, label: 'File Edit', icon: '🗂' },
                  { key: 'terminal' as const, label: 'Terminal', icon: '💻' },
                  { key: 'webFetch' as const, label: 'Web Fetch', icon: '🌐' }
                ]).map((tool) => {
                  const toolConfig = config.tools[tool.key]
                  return (
                    <div key={tool.key} className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/60">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium text-gray-800 dark:text-gray-100">{tool.icon} {tool.label}</div>
                        <button
                          type="button"
                          onClick={() => updateField('tools', {
                            ...config.tools,
                            [tool.key]: { ...toolConfig, enabled: !toolConfig.enabled }
                          })}
                          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
                          aria-label={`Toggle ${tool.label}`}
                        >
                          {toolConfig.enabled ? <ToggleRight className="h-4 w-4 text-green-500" /> : <ToggleLeft className="h-4 w-4 text-gray-400" />}
                          <span>{toolConfig.enabled ? 'Enabled' : 'Disabled'}</span>
                        </button>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Approval</label>
                        <select
                          value={toolConfig.approval}
                          onChange={(e) => updateField('tools', {
                            ...config.tools,
                            [tool.key]: { ...toolConfig, approval: e.target.value as 'auto' | 'always-ask' | 'disabled' }
                          })}
                          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                        >
                          <option value="auto">Auto</option>
                          <option value="always-ask">Always ask</option>
                          <option value="disabled">Disabled</option>
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Instructions</label>
                        <textarea
                          value={toolConfig.instructions}
                          onChange={(e) => updateField('tools', {
                            ...config.tools,
                            [tool.key]: { ...toolConfig, instructions: e.target.value }
                          })}
                          rows={3}
                          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                        />
                      </div>
                    </div>
                  )
                })}
              </div>

              {agentMcpTools.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">MCP Tools</h3>
                  {agentMcpTools.map((tool) => {
                    const override = getMcpOverride(tool.serverId, tool.name)
                    const enabled = (override?.enabled ?? 1) === 1
                    const approval = override?.approval ?? 'always-ask'
                    const instructions = override?.instructions ?? ''
                    return (
                      <div key={`${tool.serverId}:${tool.name}`} className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/60">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-gray-800 dark:text-gray-100">🔌 {tool.name}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">via {tool.serverName}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleSetMcpOverride(tool.serverId, tool.name, 'enabled', !enabled)}
                            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
                            aria-label={`Toggle ${tool.name}`}
                          >
                            {enabled ? <ToggleRight className="h-4 w-4 text-green-500" /> : <ToggleLeft className="h-4 w-4 text-gray-400" />}
                            <span>{enabled ? 'Enabled' : 'Disabled'}</span>
                          </button>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Approval</label>
                          <select
                            value={approval}
                            onChange={(e) => void handleSetMcpOverride(tool.serverId, tool.name, 'approval', e.target.value)}
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                          >
                            <option value="auto">Auto</option>
                            <option value="always-ask">Always ask</option>
                            <option value="disabled">Disabled</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Instructions</label>
                          <textarea
                            value={instructions}
                            onChange={(e) => void handleSetMcpOverride(tool.serverId, tool.name, 'instructions', e.target.value)}
                            rows={3}
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                          />
                        </div>
                        {tool.description && <p className="text-xs text-gray-500 dark:text-gray-400">{tool.description}</p>}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ) : tab === 'knowledge' ? (
            /* Knowledge Tab */
            editingKnowledgeFile ? (
              /* Split-pane editor */
              <div className="flex flex-col gap-2 h-full">
                <div className="flex items-center justify-between gap-2 shrink-0">
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                    {editingKnowledgeFile.filePath.split(/[\\/]/).pop()}
                  </span>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={handleSaveKnowledgeFile}
                      aria-label="Save file"
                      className="text-xs px-2.5 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingKnowledgeFile(null)}
                      className="text-xs px-2.5 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    >
                      Back
                    </button>
                  </div>
                </div>
                <div className="flex gap-2 flex-1" style={{ minHeight: 0, height: 'calc(100vh - 220px)' }}>
                  <textarea
                    value={editingFileContent}
                    onChange={(e) => setEditingFileContent(e.target.value)}
                    spellCheck={false}
                    className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                  />
                  <div className="flex-1 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2">
                    <MarkdownRenderer content={editingFileContent} />
                  </div>
                </div>
              </div>
            ) : (
              /* File list */
              <div className="space-y-2">
                {!isEditing ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400">Save the agent first to add knowledge files.</p>
                ) : (
                  <>
                    {knowledgeFiles.length === 0 ? (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        No knowledge files yet. Add <code className="font-mono">.md</code> files to give this agent structured context.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {knowledgeFiles.map((f) => (
                          <div
                            key={f.id}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50"
                          >
                            <FileText className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            <span
                              className="flex-1 text-xs text-gray-700 dark:text-gray-300 truncate"
                              title={f.file_path}
                            >
                              {f.file_path.split(/[\\/]/).pop()}
                            </span>
                            <button
                              onClick={() => handleToggleInjectMode(f)}
                              className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 transition-colors ${
                                f.inject_mode === 'always'
                                  ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                  : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                              }`}
                              title="Toggle inject mode"
                            >
                              {f.inject_mode === 'always' ? 'Always' : 'On demand'}
                            </button>
                            <button
                              onClick={() => handleEditKnowledgeFile(f)}
                              className="text-gray-400 hover:text-blue-500 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                              aria-label={`Edit ${f.file_path}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleRemoveKnowledgeFile(f.id)}
                              className="text-gray-400 hover:text-red-500 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                              aria-label={`Remove ${f.file_path}`}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={handleAddKnowledgeFile}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200 transition-colors w-full justify-center"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add file…
                    </button>
                  </>
                )}
              </div>
            )
          ) : (
            /* JSON Editor Tab */
            <div className="space-y-2">
              <textarea
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value)
                  setJsonError('')
                }}
                rows={24}
                spellCheck={false}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              />
              {jsonError && (
                <p className="text-xs text-red-500">{jsonError}</p>
              )}
              <button
                onClick={handleJsonSave}
                className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors"
              >
                Apply JSON
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          <div className="flex gap-2">
            {isEditing && !isDefault && (
              <button
                onClick={() => onDelete(config.id)}
                className="text-xs px-3 py-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                Delete
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {isEditing && (
              <button
                onClick={() => onDuplicate(config.id)}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                Duplicate
              </button>
            )}
            {isEditing && (
              <button
                onClick={() => onExport(config.id)}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                Export
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={!config.name.trim()}
              className="text-xs px-4 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isEditing ? 'Save' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
