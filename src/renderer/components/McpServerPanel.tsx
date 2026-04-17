import { useState, useEffect, useCallback } from 'react'

interface McpServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
  enabled: boolean
}

interface McpServerStatus extends McpServerConfig {
  status: 'connecting' | 'connected' | 'error' | 'disconnected'
  error?: string
  toolCount: number
}

interface McpServerPanelProps {
  visible: boolean
  onClose: () => void
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
            className="text-xs text-red-400 hover:text-red-600 px-1"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        onClick={addEntry}
        className="text-xs text-blue-500 hover:text-blue-600"
      >
        + Add variable
      </button>
    </div>
  )
}

export function McpServerPanel({ visible, onClose }: McpServerPanelProps) {
  const [servers, setServers] = useState<McpServerStatus[]>([])
  const [editingServer, setEditingServer] = useState<McpServerConfig | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [jsonMode, setJsonMode] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)

  const loadServers = useCallback(() => {
    window.api.listMcpServers().then(setServers)
  }, [])

  useEffect(() => {
    if (visible) loadServers()
  }, [visible, loadServers])

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

    if (isNew) {
      await window.api.addMcpServer({ ...editingServer })
    } else {
      await window.api.updateMcpServer(editingServer.id, { ...editingServer })
    }
    setEditingServer(null)
    loadServers()
  }

  const handleDelete = async (id: string) => {
    await window.api.removeMcpServer(id)
    if (editingServer?.id === id) setEditingServer(null)
    loadServers()
  }

  const handleRestart = async (id: string) => {
    await window.api.restartMcpServer(id)
    setTimeout(loadServers, 1000)
  }

  const handleToggle = async (server: McpServerStatus) => {
    await window.api.updateMcpServer(server.id, { enabled: !server.enabled })
    loadServers()
  }

  const handleJsonImport = () => {
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
      })
    } catch {
      setJsonError('Invalid JSON')
    }
  }

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-xl bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            🔌 MCP Servers
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setJsonMode(!jsonMode)
                setEditingServer(null)
              }}
              className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              {jsonMode ? 'List' : 'Import JSON'}
            </button>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-red-500 transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
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
              <button
                onClick={handleJsonImport}
                className="w-full text-xs px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium"
              >
                Import Servers
              </button>
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
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

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
                <button
                  onClick={handleSave}
                  disabled={!editingServer.name || !editingServer.command}
                  className="flex-1 text-xs px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 font-medium"
                >
                  {isNew ? 'Add Server' : 'Save Changes'}
                </button>
                <button
                  onClick={() => setEditingServer(null)}
                  className="text-xs px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
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
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-500'
                        }`}
                        title={server.enabled ? 'Disable' : 'Enable'}
                      >
                        {server.enabled ? 'ON' : 'OFF'}
                      </button>
                      <button
                        onClick={() => handleRestart(server.id)}
                        className="text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                        title="Restart"
                      >
                        ↻
                      </button>
                      <button
                        onClick={() => handleEdit(server)}
                        className="text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                        title="Edit"
                      >
                        ⚙
                      </button>
                      <button
                        onClick={() => handleDelete(server.id)}
                        className="text-xs px-2 py-1 rounded text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
                        title="Remove"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                ))
              )}

              <button
                onClick={handleNew}
                className="w-full text-xs px-3 py-2 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors"
              >
                + Add MCP Server
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
