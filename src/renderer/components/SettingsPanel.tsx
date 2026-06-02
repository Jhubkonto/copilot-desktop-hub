import { useState, useEffect, useCallback } from 'react'
import { X, Sun, Moon, Plug, Settings, Cpu, Shield, Smartphone, RefreshCw } from 'lucide-react'
import { useAppStore } from '../store/app-store'
import { getAvailableModelIds, getModelLabel } from '../../shared/models'

interface ProviderInfo {
  name: string
  label: string
  models: string[]
  configured: boolean
}

type SettingsCategory = 'general' | 'providers' | 'mobile'

const NAV_ITEMS: { id: SettingsCategory; label: string; icon: React.ReactNode }[] = [
  { id: 'general',   label: 'General',       icon: <Settings className="w-3.5 h-3.5" /> },
  { id: 'providers', label: 'API Providers', icon: <Shield className="w-3.5 h-3.5" /> },
  { id: 'mobile',    label: 'Mobile',        icon: <Smartphone className="w-3.5 h-3.5" /> },
]

export function SettingsPanel() {
  const visible = useAppStore((s) => s.showSettings)
  const theme = useAppStore((s) => s.theme)
  const conversations = useAppStore((s) => s.conversations)
  const currentConversationId = useAppStore((s) => s.currentConversationId)
  const agents = useAppStore((s) => s.agents)
  const activeAgentId = useAppStore((s) => s.activeAgentId)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const setShowSettings = useAppStore((s) => s.setShowSettings)
  const setShowMcpPanel = useAppStore((s) => s.setShowMcpPanel)
  const addToast = useAppStore((s) => s.addToast)
  const setGlobalDefaultModel = useAppStore((s) => s.setGlobalDefaultModel)
  const catalogModels = useAppStore((s) => s.catalogModels)

  const authMode = useAppStore((s) => s.authState.mode)
  const onClose = () => setShowSettings(false)
  const onOpenMcp = () => { setShowSettings(false); setShowMcpPanel(true) }
  const [category, setCategory] = useState<SettingsCategory>(() =>
    authMode === 'byok' ? 'providers' : 'general'
  )
  const [autoStart, setAutoStart] = useState(false)
  const [autoClipboard, setAutoClipboard] = useState(false)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [editingProvider, setEditingProvider] = useState<string | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [azureEndpoint, setAzureEndpoint] = useState('')
  const [testResult, setTestResult] = useState<{ valid: boolean; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [defaultModel, setDefaultModel] = useState('gpt-5-mini')
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(4096)

  // Mobile companion state
  const [mobileEnabled, setMobileEnabled] = useState(false)
  const [mobileQr, setMobileQr] = useState<string | null>(null)
  const [mobileClients, setMobileClients] = useState(0)
  const [mobileLoading, setMobileLoading] = useState(false)
  const [mobileLocalIp, setMobileLocalIp] = useState('')

  const currentConversation = currentConversationId
    ? conversations.find((c) => c.id === currentConversationId) ?? null
    : null
  const activeAgent = activeAgentId ? agents.find((a) => a.id === activeAgentId) ?? null : null
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const projects = useAppStore((s) => s.projects)
  const projectId = currentConversation?.project_id ?? activeProjectId
  const projectDefaultModel = projectId ? (projects.find((p) => p.id === projectId)?.default_model ?? null) : null
  const effectiveModel = currentConversation?.model || projectDefaultModel || defaultModel || 'gpt-5-mini'
  const effectiveProvider =
    effectiveModel.startsWith('claude')
      ? 'Anthropic'
      : effectiveModel.startsWith('azure:')
        ? 'Azure OpenAI'
        : 'OpenAI'
  const modelIds = getAvailableModelIds(catalogModels, defaultModel)

  useEffect(() => {
    if (!visible) return
    window.api.getSettings().then((settings: Record<string, string>) => {
      setAutoStart(settings['autoStart'] === 'true')
      setAutoClipboard(settings['autoClipboard'] === 'true')
      setDefaultModel(settings['default_model'] || 'gpt-5-mini')
      setTemperature(Number.parseFloat(settings['temperature'] || '0.7') || 0.7)
      setMaxTokens(Number.parseInt(settings['max_tokens'] || '4096', 10) || 4096)
    })
    window.api.listProviders().then(setProviders)
    window.api.getAzureEndpoint().then((ep: string | null) => {
      if (ep) setAzureEndpoint(ep)
    })
  }, [visible])

  const refreshMobileStatus = useCallback(async () => {
    const status = await window.api.wsStatus()
    setMobileEnabled(status.enabled)
    setMobileQr(status.qrDataUrl ?? null)
    setMobileClients(status.connectedClients)
    setMobileLocalIp(status.localIp)
  }, [])

  useEffect(() => {
    if (visible && category === 'mobile') void refreshMobileStatus()
  }, [visible, category, refreshMobileStatus])

  const handleMobileToggle = async () => {
    setMobileLoading(true)
    try {
      if (mobileEnabled) {
        await window.api.wsStop()
        setMobileEnabled(false)
        setMobileQr(null)
        setMobileClients(0)
      } else {
        const result = await window.api.wsStart()
        setMobileEnabled(true)
        setMobileQr(result.qrDataUrl ?? null)
        setMobileClients(0)
        await refreshMobileStatus()
      }
    } catch {
      addToast('Failed to toggle mobile server', 'error')
    } finally {
      setMobileLoading(false)
    }
  }

  const handleRegenerateToken = async () => {
    setMobileLoading(true)
    try {
      const result = await window.api.wsRegenerateToken()
      setMobileQr(result.qrDataUrl ?? null)
      addToast('Pairing code regenerated — existing connections closed', 'success')
    } catch {
      addToast('Failed to regenerate pairing code', 'error')
    } finally {
      setMobileLoading(false)
    }
  }

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

  const handleAutoClipboardToggle = async () => {
    const next = !autoClipboard
    setAutoClipboard(next)
    try {
      await window.api.setSetting('autoClipboard', String(next))
    } catch {
      setAutoClipboard(!next)
      addToast('Failed to update auto-clipboard setting', 'error')
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

  const handleSaveAdvanced = async () => {
    try {
      const safeTemp = Math.min(2, Math.max(0, temperature))
      const safeMaxTokens = Math.min(16384, Math.max(256, maxTokens))
      await window.api.setSetting('default_model', defaultModel)
      await window.api.setSetting('temperature', String(safeTemp))
      await window.api.setSetting('max_tokens', String(safeMaxTokens))
      setGlobalDefaultModel(defaultModel)
      addToast('Advanced settings saved', 'success')
    } catch {
      addToast('Failed to save advanced settings', 'error')
    }
  }

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-label="Settings" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col" style={{ maxHeight: '80vh' }} onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h2 className="text-sm font-medium text-gray-800 dark:text-gray-100">Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Close settings">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Two-panel body */}
        <div className="flex flex-1 overflow-hidden">

          {/* Left navigation */}
          <nav className="w-44 shrink-0 border-r border-gray-200 dark:border-gray-700 py-2 flex flex-col gap-0.5 px-2" aria-label="Settings navigation">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => setCategory(item.id)}
                className={`flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  category === item.id
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
                aria-current={category === item.id ? 'page' : undefined}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>

          {/* Right content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {category === 'general' ? (
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

                {/* Active model */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Active model</p>
                    <p className="text-xs text-gray-500">Current chat model and provider</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-200">
                      {getModelLabel(effectiveModel, catalogModels)}
                    </p>
                    <p className="text-[11px] text-gray-500">{effectiveProvider}</p>
                  </div>
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

                {/* Auto clipboard on focus */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
                      Auto-read clipboard on focus
                    </p>
                    <p className="text-xs text-gray-500">
                      Automatically paste clipboard text when app gains focus
                    </p>
                  </div>
                  <button
                    onClick={handleAutoClipboardToggle}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      autoClipboard ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        autoClipboard ? 'translate-x-6' : 'translate-x-1'
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

                {/* Advanced generation settings */}
                <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 space-y-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center gap-1.5">
                      <Cpu className="w-3.5 h-3.5 text-gray-400" />
                      Advanced
                    </p>
                    <p className="text-xs text-gray-500">Default model and generation parameters</p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Default model
                    </label>
                    <select
                      value={defaultModel}
                      onChange={(e) => setDefaultModel(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {modelIds.map((modelId) => (
                        <option key={modelId} value={modelId}>
                          {getModelLabel(modelId, catalogModels)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Temperature: {temperature.toFixed(1)}
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.1"
                      value={temperature}
                      onChange={(e) => setTemperature(Number.parseFloat(e.target.value))}
                      className="w-full accent-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Max tokens
                    </label>
                    <input
                      type="number"
                      min={256}
                      max={16384}
                      step={256}
                      value={maxTokens}
                      onChange={(e) => setMaxTokens(Number.parseInt(e.target.value, 10) || 4096)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <button
                    onClick={handleSaveAdvanced}
                    className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 font-medium"
                  >
                    Save advanced settings
                  </button>
                </div>
              </>
            ) : (
              <>
                {authMode === 'byok' && providers.every((p) => !p.configured) && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 mb-1">
                    <span className="text-blue-500 shrink-0 mt-0.5">🔑</span>
                    <p className="text-xs text-blue-700 dark:text-blue-300">
                      You're in API key mode — configure at least one provider below to start chatting.
                    </p>
                  </div>
                )}
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
                  API keys are stored securely using OS-level encryption. Select a provider model
                  in chat, project, or agent settings to use it.
                </p>
              </>
            )}

            {category === 'mobile' && (
              <>
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Android companion app</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Let your phone approve tool calls and monitor agent output over local WiFi.
                  </p>
                </div>

                {/* Enable toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Enable mobile server</p>
                    <p className="text-xs text-gray-500">Starts a local WebSocket server on your network</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleMobileToggle()}
                    disabled={mobileLoading}
                    className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50"
                    style={{ backgroundColor: mobileEnabled ? '#3b82f6' : '#d1d5db' }}
                    aria-checked={mobileEnabled}
                    role="switch"
                  >
                    <span
                      className="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200"
                      style={{ transform: mobileEnabled ? 'translateX(16px)' : 'translateX(0)' }}
                    />
                  </button>
                </div>

                {mobileEnabled && (
                  <>
                    {/* Status */}
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-4 py-3 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500">Local IP</span>
                        <span className="font-mono text-gray-800 dark:text-gray-200">{mobileLocalIp}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500">Connected devices</span>
                        <span className="font-mono text-gray-800 dark:text-gray-200">{mobileClients}</span>
                      </div>
                    </div>

                    {/* QR code */}
                    {mobileQr ? (
                      <div className="flex flex-col items-center gap-3">
                        <p className="text-xs text-gray-500 text-center">
                          Scan with the Nexy Android app to pair
                        </p>
                        <img
                          src={mobileQr}
                          alt="Pairing QR code"
                          className="rounded-lg border border-gray-200 dark:border-gray-700"
                          style={{ width: 200, height: 200 }}
                        />
                        <button
                          type="button"
                          onClick={() => void handleRegenerateToken()}
                          disabled={mobileLoading}
                          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-50"
                        >
                          <RefreshCw className="w-3 h-3" />
                          Regenerate pairing code
                        </button>
                      </div>
                    ) : (
                      <div className="flex justify-center">
                        <div className="w-[200px] h-[200px] rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 animate-pulse" />
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => void refreshMobileStatus()}
                      className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      Refresh status
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
