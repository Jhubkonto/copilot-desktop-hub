import { useState, useEffect, useCallback } from 'react'
import { Plug, X, RefreshCw, Settings, Trash2, Plus } from 'lucide-react'
import { useAppStore } from '../store/app-store'
import { Button, ModalShell } from './ui/primitives'

interface McpServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
  imageResponses?: 'allow' | 'omit'
  enabled: boolean
}

interface McpServerStatus extends McpServerConfig {
  status: 'connecting' | 'connected' | 'error' | 'disconnected'
  error?: string
  toolCount: number
}

const STATUS_COLORS: Record<string, string> = {
  connected: 'text-green-500',
  connecting: 'text-yellow-500',
  error: 'text-red-500',
  disconnected: 'text-gray-400'
}

const STATUS_ICONS: Record<string, string> = {
  connected: '●',
  connecting: '◐',
  error: '●',
  disconnected: '○'
}

function EnvEditor({
  env,
  onChange
}: {
  env: Record<string, string>
  onChange: (env: Record<string, string>) => void
}) {
  const entries = Object.entries(env)

  const addEntry = () => {
    onChange({ ...env, '': '' })
  }

  const removeEntry = (key: string) => {
    const next = { ...env }
    delete next[key]
    onChange(next)
  }

  const updateEntry = (oldKey: string, newKey: string, value: string) => {
    const next: Record<string, string> = {}
    for (const [k, v] of Object.entries(env)) {
      if (k === oldKey) {
        next[newKey] = value
      } else {
        next[k] = v
      }
    }
    onChange(next)
  }

  return (
    <div className="space-y-1">
      {entries.map(([key, value], i) => (
        <div key={i} className="flex gap-1">
          <input
            value={key}
            onChange={(e) => updateEntry(key, e.target.value, value)}
            placeholder="KEY"
            className="flex-1 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          />
          <input
            value={value}
            onChange={(e) => updateEntry(key, key, e.target.value)}
            placeholder="value"
            className="flex-1 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          />
          <button
            onClick={() => removeEntry(key)}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 px-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="Remove variable"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
      <button
        onClick={addEntry}
        className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
      >
        <Plus className="w-3 h-3" />
        Add variable
      </button>
    </div>
  )
}

const PLAYWRIGHT_PRESETS = [
  {
    label: 'Playwright (Chromium)',
    description: 'AI-controlled managed browser',
    config: { name: 'Playwright (Chromium)', command: 'npx', args: ['-y', '@playwright/mcp'], env: {}, cwd: undefined, enabled: true }
  },
  {
    label: 'Playwright (CDP attach)',
    description: 'Attach to existing Chrome/Edge — launch with --remote-debugging-port=9222',
    config: { name: 'Playwright (CDP)', command: 'npx', args: ['-y', '@playwright/mcp', '--cdp-endpoint', 'http://localhost:9222'], env: {}, cwd: undefined, enabled: true }
  },
]

export function McpServerPanel() {
  const visible = useAppStore((s) => s.showMcpPanel)
  const setShowMcpPanel = useAppStore((s) => s.setShowMcpPanel)
  const addToast = useAppStore((s) => s.addToast)
  const onClose = () => setShowMcpPanel(false)

  const [servers, setServers] = useState<McpServerStatus[]>([])
  const [editingServer, setEditingServer] = useState<McpServerConfig | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [jsonMode, setJsonMode] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)

  const loadServers = useCallback(() => {
    window.api.listMcpServers().then(setServers).catch(() => {
      addToast('Failed to load MCP servers', 'error')
    })
  }, [addToast])

  useEffect(() => {
    if (visible) loadServers()
  }, [visible, loadServers])

  useEffect(() => {
    if (!visible) return
    return window.api.onMcpServerStatusChanged((server) => {
      setServers((prev) => {
        const idx = prev.findIndex((s) => s.id === server.id)
        if (idx === -1) return prev
        const next = [...prev]
        next[idx] = server
        return next
      })
    })
  }, [visible])

  const handleNew = () => {
    setEditingServer({
      id: '',
      name: '',
      command: '',
      args: [],
      env: {},
      cwd: '',
      enabled: true
    })
    setIsNew(true)
  }

  const handleEdit = (server: McpServerStatus) => {
    setEditingServer({ ...server })
    setIsNew(false)
  }

  const handleSave = async () => {
    if (!editingServer || !editingServer.name || !editingServer.command) return

    try {
      if (isNew) {
        await window.api.addMcpServer({ ...editingServer })
        addToast(`Server "${editingServer.name}" added`, 'success')
      } else {
        await window.api.updateMcpServer(editingServer.id, { ...editingServer })
        addToast(`Server "${editingServer.name}" updated`, 'success')
      }
      setEditingServer(null)
      loadServers()
    } catch {
      addToast(`Failed to ${isNew ? 'add' : 'update'} server`, 'error')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await window.api.removeMcpServer(id)
      if (editingServer?.id === id) setEditingServer(null)
      loadServers()
      addToast('Server removed', 'success')
    } catch {
      addToast('Failed to remove server', 'error')
    }
  }

  const handleRestart = async (id: string) => {
    try {
      await window.api.restartMcpServer(id)
      // Status updates arrive via the mcp:server-status-changed push event.
    } catch {
      addToast('Failed to restart server', 'error')
    }
  }

  const handleToggle = async (server: McpServerStatus) => {
    try {
      await window.api.updateMcpServer(server.id, { enabled: !server.enabled })
      loadServers()
    } catch {
      addToast('Failed to toggle server', 'error')
    }
  }

  const handleJsonImport = () => {
    if (!jsonText.trim()) return
    try {
      const parsed = JSON.parse(jsonText)
      if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
        setJsonError('Expected { "mcpServers": { ... } } format')
        return
      }
      setJsonError(null)

      const promises = Object.entries(parsed.mcpServers).map(
        async ([name, config]: [string, unknown]) => {
          const c = config as { command?: string; args?: string[]; env?: Record<string, string> }
          await window.api.addMcpServer({
            name,
            command: c.command || '',
            args: c.args || [],
            env: c.env || {},
            enabled: true
          })
        }
      )
      Promise.all(promises).then(() => {
        setJsonMode(false)
        setJsonText('')
        loadServers()
        addToast('Servers imported successfully', 'success')
      }).catch(() => {
        addToast('Failed to import some servers', 'error')
      })
    } catch {
      setJsonError('Invalid JSON')
    }
  }

  if (!visible) return null

  return (
    <ModalShell
      title="MCP Servers"
      icon={<Plug className="w-4 h-4" />}
      ariaLabel="MCP panel"
      maxWidth="max-w-xl"
      height="max-h-[80vh]"
      bodyClassName="flex-1 min-h-0 overflow-y-auto p-5"
      onClose={onClose}
      headerActions={
        <Button
              onClick={() => {
                setJsonMode(!jsonMode)
                setJsonError(null)
                setEditingServer(null)
              }}
              className="px-2 py-1"
            >
              {jsonMode ? 'List' : 'Import JSON'}
        </Button>
      }
    >
          {jsonMode ? (
            <div className="space-y-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Paste a Claude Desktop / VS Code MCP config JSON:
              </p>
              <textarea
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                placeholder={'{\n  "mcpServers": {\n    "my-server": {\n      "command": "npx",\n      "args": ["-y", "@some/mcp-server"]\n    }\n  }\n}'}
                rows={10}
                className="w-full text-xs font-mono rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 p-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {jsonError && (
                <p className="text-xs text-red-500">{jsonError}</p>
              )}
              <Button
                onClick={handleJsonImport}
                variant="primary"
                className="w-full justify-center py-2"
              >
                Import Servers
              </Button>
            </div>
          ) : editingServer ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Name
                </label>
                <input
                  value={editingServer.name}
                  onChange={(e) =>
                    setEditingServer({ ...editingServer, name: e.target.value })
                  }
                  placeholder="My MCP Server"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Command
                </label>
                <input
                  value={editingServer.command}
                  onChange={(e) =>
                    setEditingServer({ ...editingServer, command: e.target.value })
                  }
                  placeholder="npx"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Arguments
                </label>
                <input
                  value={editingServer.args.join(' ')}
                  onChange={(e) =>
                    setEditingServer({
                      ...editingServer,
                      args: e.target.value.split(' ').filter(Boolean)
                    })
                  }
                  placeholder="-y @modelcontextprotocol/server-github"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Working Directory
                </label>
                <input
                  value={editingServer.cwd || ''}
                  onChange={(e) =>
                    setEditingServer({ ...editingServer, cwd: e.target.value || undefined })
                  }
                  placeholder="(optional)"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500"
                />
              </div>

              {(editingServer.command.toLowerCase().includes('playwright') ||
                editingServer.name.toLowerCase().includes('playwright') ||
                editingServer.args.some((a) => a.toLowerCase().includes('playwright'))) && (
                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingServer.imageResponses !== 'omit'}
                      onChange={(e) =>
                        setEditingServer({
                          ...editingServer,
                          imageResponses: e.target.checked ? 'allow' : 'omit',
                        })
                      }
                      className="rounded"
                    />
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                      Include screenshots in tool results
                    </span>
                  </label>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 ml-5">
                    Disable to reduce token usage on limited API plans
                  </p>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Environment Variables
                </label>
                <EnvEditor
                  env={editingServer.env}
                  onChange={(env) => setEditingServer({ ...editingServer, env })}
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  onClick={handleSave}
                  disabled={!editingServer.name || !editingServer.command}
                  variant="primary"
                  className="flex-1 justify-center py-2"
                >
                  {isNew ? 'Add Server' : 'Save Changes'}
                </Button>
                <Button
                  onClick={() => setEditingServer(null)}
                  className="py-2"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {servers.length === 0 ? (
                <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-8">
                  No MCP servers configured.
                  <br />
                  <span className="text-xs">Add a server or import from JSON.</span>
                </p>
              ) : (
                servers.map((server) => (
                  <div
                    key={server.id}
                    className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750"
                  >
                    <span className={`text-sm ${STATUS_COLORS[server.status]}`}>
                      {STATUS_ICONS[server.status]}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                          {server.name}
                        </span>
                        {server.toolCount > 0 && (
                          <span className="text-xs text-gray-400">
                            {server.toolCount} tool{server.toolCount !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {server.command} {server.args.join(' ')}
                      </p>
                      {server.error && (
                        <p className="text-xs text-red-400 truncate mt-0.5">
                          {server.error}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleToggle(server)}
                        className={`text-xs px-2 py-1 rounded ${
                          server.enabled
                            ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-medium'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-500'
                        }`}
                        title={server.enabled ? 'Disable' : 'Enable'}
                      >
                        {server.enabled ? 'ON' : 'OFF'}
                      </button>
                      <button
                        onClick={() => handleRestart(server.id)}
                        className="text-xs p-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                        title="Restart"
                        aria-label="Restart server"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleEdit(server)}
                        className="text-xs p-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                        title="Edit"
                        aria-label="Edit server"
                      >
                        <Settings className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(server.id)}
                        className="text-xs p-1 rounded text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                        title="Remove"
                        aria-label="Remove server"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}

              <Button
                onClick={handleNew}
                className="w-full justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-500 py-2"
              >
                <Plus className="w-3.5 h-3.5" />
                Add MCP Server
              </Button>

              <div className="space-y-1">
                <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide">Quick-add presets</p>
                {PLAYWRIGHT_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => setEditingServer({ id: '', ...preset.config })}
                    className="w-full text-left flex flex-col gap-0.5 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors"
                  >
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{preset.label}</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">{preset.description}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
    </ModalShell>
  )
}
