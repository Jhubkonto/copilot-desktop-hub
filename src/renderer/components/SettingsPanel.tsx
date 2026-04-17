import { useState, useEffect } from 'react'

interface SettingsPanelProps {
  visible: boolean
  onClose: () => void
  theme: 'light' | 'dark'
  toggleTheme: () => void
  onOpenMcp: () => void
}

interface ProviderInfo {
  name: string
  label: string
  models: string[]
  configured: boolean
}

export function SettingsPanel({ visible, onClose, theme, toggleTheme, onOpenMcp }: SettingsPanelProps) {
  const [tab, setTab] = useState<'general' | 'providers'>('general')
  const [autoStart, setAutoStart] = useState(false)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [editingProvider, setEditingProvider] = useState<string | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [azureEndpoint, setAzureEndpoint] = useState('')
  const [testResult, setTestResult] = useState<{ valid: boolean; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (!visible) return
    window.api.getSettings().then((settings: Record<string, string>) => {
      setAutoStart(settings['autoStart'] === 'true')
    })
    window.api.listProviders().then(setProviders)
    window.api.getAzureEndpoint().then((ep: string | null) => {
      if (ep) setAzureEndpoint(ep)
    })
  }, [visible])

  const handleAutoStartToggle = async () => {
    const next = !autoStart
    setAutoStart(next)
    await window.api.setSetting('autoStart', String(next))
    await window.api.setAutoStart(next)
  }

  const handleSaveKey = async () => {
    if (!editingProvider || !apiKeyInput.trim()) return
    if (editingProvider === 'azure' && azureEndpoint.trim()) {
      await window.api.setAzureEndpoint(azureEndpoint.trim())
    }
    await window.api.setProviderKey(editingProvider, apiKeyInput.trim())
    setEditingProvider(null)
    setApiKeyInput('')
    setTestResult(null)
    window.api.listProviders().then(setProviders)
  }

  const handleTestKey = async () => {
    if (!editingProvider || !apiKeyInput.trim()) return
    setTesting(true)
    const endpoint = editingProvider === 'azure' ? azureEndpoint.trim() : undefined
    const result = await window.api.testProviderKey(editingProvider, apiKeyInput.trim(), endpoint)
    setTestResult(result)
    setTesting(false)
  }

  const handleRemoveKey = async (provider: string) => {
    await window.api.removeProviderKey(provider)
    window.api.listProviders().then(setProviders)
  }

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="w-full max-w-lg bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">⚙ Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-red-500 transition-colors" aria-label="Close settings">
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          {(['general', 'providers'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 text-xs py-2 font-medium transition-colors ${
                tab === t
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {t === 'general' ? 'General' : 'API Providers'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {tab === 'general' ? (
            <>
              {/* Theme */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Theme</p>
                  <p className="text-xs text-gray-500">Switch between light and dark mode</p>
                </div>
                <button
                  onClick={toggleTheme}
                  className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                >
                  {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
                </button>
              </div>

              {/* Auto-start */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
                    Start on login
                  </p>
                  <p className="text-xs text-gray-500">
                    Automatically launch when you log in
                  </p>
                </div>
                <button
                  onClick={handleAutoStartToggle}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    autoStart ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      autoStart ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Global Hotkey */}
              <div>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
                  Global Hotkey
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  <kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-xs font-mono">
                    {window.api.platform === 'darwin' ? 'Cmd+Shift+H' : 'Ctrl+Shift+H'}
                  </kbd>{' '}
                  to show/hide the app
                </p>
              </div>

              {/* MCP Servers */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
                    MCP Servers
                  </p>
                  <p className="text-xs text-gray-500">Manage Model Context Protocol servers</p>
                </div>
                <button
                  onClick={onOpenMcp}
                  className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                >
                  🔌 Configure
                </button>
              </div>
            </>
          ) : (
            <>
              {providers.map((provider) => (
                <div
                  key={provider.name}
                  className="p-3 rounded-lg border border-gray-200 dark:border-gray-700"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                        {provider.label}
                      </span>
                      {provider.name === 'copilot' ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                          Default
                        </span>
                      ) : provider.configured ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                          ✓ Configured
                        </span>
                      ) : (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500">
                          Not configured
                        </span>
                      )}
                    </div>
                    {provider.name !== 'copilot' && (
                      <div className="flex gap-1">
                        <button
                          onClick={() => {
                            setEditingProvider(
                              editingProvider === provider.name ? null : provider.name
                            )
                            setApiKeyInput('')
                            setTestResult(null)
                          }}
                          className="text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          {editingProvider === provider.name ? 'Cancel' : 'Set Key'}
                        </button>
                        {provider.configured && (
                          <button
                            onClick={() => handleRemoveKey(provider.name)}
                            className="text-xs px-2 py-1 rounded text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Models: {provider.models.join(', ')}
                  </p>

                  {editingProvider === provider.name && (
                    <div className="mt-3 space-y-2">
                      {provider.name === 'azure' && (
                        <input
                          type="text"
                          value={azureEndpoint}
                          onChange={(e) => setAzureEndpoint(e.target.value)}
                          placeholder="Azure endpoint (e.g. https://myresource.openai.azure.com)"
                          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      )}
                      <input
                        type="password"
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        placeholder={`Enter ${provider.label} API key...`}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      {testResult && (
                        <p
                          className={`text-xs ${testResult.valid ? 'text-green-500' : 'text-red-500'}`}
                        >
                          {testResult.valid
                            ? '✓ API key is valid'
                            : `✗ ${testResult.error || 'Invalid key'}`}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={handleTestKey}
                          disabled={!apiKeyInput.trim() || testing}
                          className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                        >
                          {testing ? 'Testing...' : 'Test'}
                        </button>
                        <button
                          onClick={handleSaveKey}
                          disabled={!apiKeyInput.trim()}
                          className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 font-medium"
                        >
                          Save Key
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              <p className="text-xs text-gray-400 dark:text-gray-500">
                API keys are stored securely using OS-level encryption. Select a provider's model
                in your agent settings to use it instead of GitHub Copilot.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
