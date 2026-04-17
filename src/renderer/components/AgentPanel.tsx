import { useState, useEffect } from 'react'

interface AgentConfig {
  id: string
  name: string
  icon: string
  systemPrompt: string
  model: string
  temperature: number
  maxTokens: number
  contextDirectories: string[]
  contextFiles: string[]
  mcpServers: string[]
  agenticMode: boolean
  tools: { fileEdit: boolean; terminal: boolean; webFetch: boolean }
  responseFormat: string
  isDefault?: boolean
}

interface AgentPanelProps {
  agent: AgentConfig | null
  onSave: (config: AgentConfig) => void
  onClose: () => void
  onDelete?: (id: string) => void
  onDuplicate?: (id: string) => void
  onExport?: (id: string) => void
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
  tools: { fileEdit: false, terminal: false, webFetch: false },
  responseFormat: 'default'
}

const EMOJI_OPTIONS = ['🤖', '🔍', '🐛', '💡', '📝', '🎨', '🔧', '🚀', '🧠', '⚡', '🛡️', '📊']
const MODEL_OPTIONS = ['default', 'gpt-4o', 'gpt-4o-mini', 'claude-3.5-sonnet', 'o1-preview']
const FORMAT_OPTIONS = ['default', 'concise', 'detailed', 'code-only']

export function AgentPanel({
  agent,
  onSave,
  onClose,
  onDelete,
  onDuplicate,
  onExport
}: AgentPanelProps) {
  const [tab, setTab] = useState<'settings' | 'json'>('settings')
  const [config, setConfig] = useState<AgentConfig>({
    id: '',
    ...EMPTY_AGENT,
    ...agent
  })
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState('')

  const isEditing = !!agent?.id
  const isDefault = agent?.isDefault === true

  useEffect(() => {
    if (tab === 'json') {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, isDefault: _d, ...rest } = config as AgentConfig & { isDefault?: boolean }
      setJsonText(JSON.stringify(rest, null, 2))
      setJsonError('')
    }
  }, [tab, config])

  const updateField = <K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
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

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Agent configuration">
      <div className="flex-1 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div className="w-[440px] bg-white dark:bg-gray-900 shadow-xl flex flex-col border-l border-gray-200 dark:border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            {isEditing ? 'Edit Agent' : 'Create Agent'}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTab(tab === 'settings' ? 'json' : 'settings')}
              className={`text-xs px-2 py-1 rounded ${
                tab === 'json'
                  ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {tab === 'json' ? '⚙ Settings' : '{ } JSON'}
            </button>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg"
            >
              ✕
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
                          ? 'bg-blue-100 dark:bg-blue-900/40 ring-1 ring-blue-400'
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

              {/* Agentic Mode + Tools */}
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

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                    Tools
                  </label>
                  <div className="flex gap-4">
                    {(['fileEdit', 'terminal', 'webFetch'] as const).map((tool) => (
                      <label key={tool} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={config.tools[tool]}
                          onChange={(e) =>
                            updateField('tools', { ...config.tools, [tool]: e.target.checked })
                          }
                          className="rounded border-gray-300 dark:border-gray-600 accent-blue-500"
                        />
                        <span className="text-xs text-gray-600 dark:text-gray-400 capitalize">
                          {tool === 'fileEdit'
                            ? 'File Edit'
                            : tool === 'webFetch'
                              ? 'Web Fetch'
                              : 'Terminal'}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
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
                          📁 {dir}
                        </span>
                        <button
                          onClick={() => removeContextDir(i)}
                          className="text-gray-400 hover:text-red-500"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  onClick={handleAddDirectories}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  + Add Directory
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
                          📄 {file}
                        </span>
                        <button
                          onClick={() => removeContextFile(i)}
                          className="text-gray-400 hover:text-red-500"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  onClick={handleAddFiles}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  + Add Files
                </button>
              </div>
            </>
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
                className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                Apply JSON
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          <div className="flex gap-2">
            {isEditing && !isDefault && onDelete && (
              <button
                onClick={() => onDelete(config.id)}
                className="text-xs px-3 py-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                Delete
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {isEditing && onDuplicate && (
              <button
                onClick={() => onDuplicate(config.id)}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                Duplicate
              </button>
            )}
            {isEditing && onExport && (
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
              className="text-xs px-4 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isEditing ? 'Save' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
