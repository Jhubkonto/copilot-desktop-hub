import { useState, useEffect } from 'react'
import { X, Sun, Moon, Plug } from 'lucide-react'
import { useAppStore } from '../store/app-store'

interface ProviderInfo {
  name: string
  label: string
  models: string[]
  configured: boolean
}

export function SettingsPanel() {
  const visible = useAppStore((s) => s.showSettings)
  const theme = useAppStore((s) => s.theme)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const setShowSettings = useAppStore((s) => s.setShowSettings)
  const setShowMcpPanel = useAppStore((s) => s.setShowMcpPanel)
  const addToast = useAppStore((s) => s.addToast)

  const onClose = () => setShowSettings(false)
  const onOpenMcp = () => { setShowSettings(false); setShowMcpPanel(true) }
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
    try {
      await window.api.setSetting('autoStart', String(next))
      await window.api.setAutoStart(next)
    } catch {
      setAutoStart(!next)
      addToast('Failed to update auto-start setting', 'error')
    }
  }

  const handleSaveKey = async () => {
    if (!editingProvider || !apiKeyInput.trim()) return
    try {
      if (editingProvider === 'azure' && azureEndpoint.trim()) {
        await window.api.setAzureEndpoint(azureEndpoint.trim())
      }
      await window.api.setProviderKey(editingProvider, apiKeyInput.trim())
      setEditingProvider(null)
      setApiKeyInput('')
      setTestResult(null)
      window.api.listProviders().then(setProviders)
      addToast('API key saved', 'success')
    } catch {
      addToast('Failed to save API key', 'error')
    }
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
    try {
      await window.api.removeProviderKey(provider)
      window.api.listProviders().then(setProviders)
      addToast('API key removed', 'success')
    } catch {
      addToast('Failed to remove API key', 'error')
    }
  }

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="w-full max-w-lg bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-medium text-gray-800 dark:text-gray-100">Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Close settings">
            <X className="w-4 h-4" />
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
                  ? 'text-gray-900 dark:text-gray-100 border-b-2 border-gray-900 dark:border-gray-100'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
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
                  <span className="flex items-center gap-1.5">
                    {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                    {theme === 'dark' ? 'Light' : 'Dark'}
                  </span>
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
                  <span className="flex items-center gap-1.5">
                    <Plug className="w-3.5 h-3.5" />
                    Configure
                  </span>
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
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                          Default
                        </span>
                      ) : provider.configured ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
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
                          className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-50 font-medium"
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
