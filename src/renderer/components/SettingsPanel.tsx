import { useState, useEffect, useCallback, useMemo } from 'react'
import { Sun, Moon, Plug, Settings, Cpu, Shield, Smartphone, RefreshCw, Terminal, BookOpen, Plus, Trash2, Wrench, CheckCircle, AlertTriangle, XCircle } from 'lucide-react'
import { useAppStore } from '../store/app-store'
import { getAvailableModelIds, getModelLabel } from '../../shared/models'
import type { BuildCommandName, BuildRecord, BuildStatus, PreflightCheck, PromptLibraryEntry, PromptLibraryInput, PromptLibraryVersion, WorkspaceInfo } from '../../shared/types'
import { extractPromptVariables } from '../../shared/prompt-variables'
import { ModalShell, SelectField, TextareaField, TextField } from './ui/primitives'

interface ProviderInfo {
  name: string
  label: string
  models: string[]
  configured: boolean
}

type SettingsCategory = 'general' | 'providers' | 'cli' | 'mobile' | 'prompts' | 'developer'

const NAV_ITEMS: { id: SettingsCategory; label: string; icon: React.ReactNode }[] = [
  { id: 'general',   label: 'General',       icon: <Settings className="w-3.5 h-3.5" /> },
  { id: 'providers', label: 'API Providers', icon: <Shield className="w-3.5 h-3.5" /> },
  { id: 'cli',       label: 'CLI Tools',     icon: <Terminal className="w-3.5 h-3.5" /> },
  { id: 'prompts',   label: 'Prompts',       icon: <BookOpen className="w-3.5 h-3.5" /> },
  { id: 'mobile',    label: 'Mobile',        icon: <Smartphone className="w-3.5 h-3.5" /> },
  { id: 'developer', label: 'Developer',     icon: <Wrench className="w-3.5 h-3.5" /> },
]

const EMPTY_PROMPT_DRAFT: PromptLibraryInput = {
  title: '',
  description: '',
  body: '',
  category: 'Custom',
  tags: [],
  scope: 'global',
  project_id: null,
}

function tagsToInput(tags: string[] | undefined): string {
  return (tags ?? []).join(', ')
}

function inputToTags(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

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
  const installedClis = useAppStore((s) => s.authState.clis ?? { claude: s.authState.cliInstalled, codex: false })
  const checkAuth = useAppStore((s) => s.checkAuth)
  const settingsInitialTab = useAppStore((s) => s.settingsInitialTab)
  const setSettingsInitialTab = useAppStore((s) => s.setSettingsInitialTab)
  const onClose = () => setShowSettings(false)
  const onOpenMcp = () => { setShowSettings(false); setShowMcpPanel(true) }
  const [category, setCategory] = useState<SettingsCategory>(() =>
    authMode === 'byok' ? 'providers' : 'general'
  )

  useEffect(() => {
    if (visible && settingsInitialTab) {
      setCategory(settingsInitialTab as SettingsCategory)
      setSettingsInitialTab(null)
    }
  }, [visible, settingsInitialTab, setSettingsInitialTab])
  const [autoStart, setAutoStart] = useState(false)
  const [autoClipboard, setAutoClipboard] = useState(false)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [editingProvider, setEditingProvider] = useState<string | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [azureEndpoint, setAzureEndpoint] = useState('')
  const [testResult, setTestResult] = useState<{ valid: boolean; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [cliRefreshing, setCliRefreshing] = useState(false)
  const [defaultModel, setDefaultModel] = useState('gpt-5-mini')
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(4096)

  // Mobile companion state
  const [mobileEnabled, setMobileEnabled] = useState(false)
  const [mobileQr, setMobileQr] = useState<string | null>(null)
  const [mobileClients, setMobileClients] = useState(0)
  const [mobileLoading, setMobileLoading] = useState(false)
  const [mobileLocalIp, setMobileLocalIp] = useState('')
  const [mobilePairingUrl, setMobilePairingUrl] = useState<string | null>(null)
  const [mobileExternalUrl, setMobileExternalUrl] = useState('')

  // Developer / build orchestrator state
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo | null>(null)
  const [workspacePathInput, setWorkspacePathInput] = useState('')
  const [buildRecords, setBuildRecords] = useState<BuildRecord[]>([])
  const [activeBuildId, setActiveBuildId] = useState<string | null>(null)
  const [activeBuildCommand, setActiveBuildCommand] = useState<BuildCommandName | null>(null)
  const [buildLogLines, setBuildLogLines] = useState<string[]>([])
  const [preflightChecks, setPreflightChecks] = useState<PreflightCheck[] | null>(null)
  const [preflightRunning, setPreflightRunning] = useState(false)
  const [lastBuildStatus, setLastBuildStatus] = useState<BuildStatus | null>(null)
  const [launchDevError, setLaunchDevError] = useState<string | null>(null)

  // Prompt library state
  const [prompts, setPrompts] = useState<PromptLibraryEntry[]>([])
  const [promptsLoading, setPromptsLoading] = useState(false)
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null)
  const [promptDraft, setPromptDraft] = useState<PromptLibraryInput>(EMPTY_PROMPT_DRAFT)
  const [promptTagInput, setPromptTagInput] = useState('')
  const [promptVersions, setPromptVersions] = useState<PromptLibraryVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)

  const currentConversation = currentConversationId
    ? conversations.find((c) => c.id === currentConversationId) ?? null
    : null
  const activeAgent = activeAgentId ? agents.find((a) => a.id === activeAgentId) ?? null : null
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const projects = useAppStore((s) => s.projects)
  const projectId = currentConversation?.project_id ?? activeProjectId
  const projectDefaultModel = projectId ? (projects.find((p) => p.id === projectId)?.default_model ?? null) : null
  const activeProject = projectId ? projects.find((p) => p.id === projectId) ?? null : null
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
      setMobileExternalUrl(settings['ws_external_url'] || '')
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
    setMobilePairingUrl(status.pairingUrl ?? null)
    setMobileExternalUrl(status.externalUrl ?? mobileExternalUrl)
  }, [mobileExternalUrl])

  const loadPrompts = useCallback(async () => {
    setPromptsLoading(true)
    try {
      const entries = await window.api.listPrompts(projectId ?? null)
      setPrompts(entries)
      if (selectedPromptId && !entries.some((entry) => entry.id === selectedPromptId)) {
        setSelectedPromptId(null)
        setPromptDraft({ ...EMPTY_PROMPT_DRAFT, project_id: projectId ?? null })
        setPromptTagInput('')
        setPromptVersions([])
      }
    } catch {
      addToast('Failed to load prompt library', 'error')
    } finally {
      setPromptsLoading(false)
    }
  }, [addToast, projectId, selectedPromptId])

  useEffect(() => {
    if (visible && category === 'prompts') void loadPrompts()
  }, [visible, category, loadPrompts])

  const promptsByCategory = useMemo(() => {
    return prompts.reduce<Record<string, PromptLibraryEntry[]>>((groups, prompt) => {
      const categoryName = prompt.category || 'Custom'
      groups[categoryName] = groups[categoryName] ?? []
      groups[categoryName].push(prompt)
      return groups
    }, {})
  }, [prompts])

  const promptVariables = useMemo(
    () => extractPromptVariables(promptDraft.body),
    [promptDraft.body]
  )

  const handleNewPrompt = () => {
    const nextDraft = {
      ...EMPTY_PROMPT_DRAFT,
      scope: projectId ? 'project' as const : 'global' as const,
      project_id: projectId ?? null,
    }
    setSelectedPromptId(null)
    setPromptDraft(nextDraft)
    setPromptTagInput('')
    setPromptVersions([])
  }

  const handleSelectPrompt = (prompt: PromptLibraryEntry) => {
    setSelectedPromptId(prompt.id)
    setPromptDraft({
      title: prompt.title,
      body: prompt.body,
      description: prompt.description,
      category: prompt.category,
      tags: prompt.tags,
      scope: prompt.scope,
      project_id: prompt.project_id,
    })
    setPromptTagInput(tagsToInput(prompt.tags))
    setVersionsLoading(true)
    window.api.listPromptVersions(prompt.id)
      .then(setPromptVersions)
      .catch(() => {
        setPromptVersions([])
        addToast('Failed to load prompt history', 'error')
      })
      .finally(() => setVersionsLoading(false))
  }

  const handleSavePrompt = async () => {
    const tags = inputToTags(promptTagInput)
    const scope = promptDraft.scope === 'project' ? 'project' : 'global'
    const payload: PromptLibraryInput = {
      ...promptDraft,
      title: String(promptDraft.title ?? '').trim(),
      body: String(promptDraft.body ?? ''),
      description: String(promptDraft.description ?? '').trim(),
      category: String(promptDraft.category ?? 'Custom').trim() || 'Custom',
      tags,
      scope,
      project_id: scope === 'project' ? (projectId ?? promptDraft.project_id ?? null) : null,
    }
    if (!payload.title || !payload.body.trim()) {
      addToast('Prompt title and body are required', 'error')
      return
    }
    if (payload.scope === 'project' && !payload.project_id) {
      addToast('Select a project before saving a project prompt', 'error')
      return
    }

    try {
      const saved = selectedPromptId
        ? await window.api.updatePrompt(selectedPromptId, payload)
        : await window.api.createPrompt(payload)
      setSelectedPromptId(saved.id)
      setPromptDraft({
        title: saved.title,
        body: saved.body,
        description: saved.description,
        category: saved.category,
        tags: saved.tags,
        scope: saved.scope,
        project_id: saved.project_id,
      })
      setPromptTagInput(tagsToInput(saved.tags))
      await loadPrompts()
      setPromptVersions(await window.api.listPromptVersions(saved.id).catch(() => []))
      addToast('Prompt saved', 'success')
    } catch {
      addToast('Failed to save prompt', 'error')
    }
  }

  const handleDeletePrompt = async () => {
    if (!selectedPromptId) return
    try {
      await window.api.deletePrompt(selectedPromptId)
      setSelectedPromptId(null)
      setPromptDraft({ ...EMPTY_PROMPT_DRAFT, project_id: projectId ?? null })
      setPromptTagInput('')
      setPromptVersions([])
      await loadPrompts()
      addToast('Prompt deleted', 'success')
    } catch {
      addToast('Failed to delete prompt', 'error')
    }
  }

  const handleRollbackPrompt = async (version: PromptLibraryVersion) => {
    if (!selectedPromptId) return
    try {
      const restored = await window.api.rollbackPrompt(selectedPromptId, version.version)
      setPromptDraft({
        title: restored.title,
        body: restored.body,
        description: restored.description,
        category: restored.category,
        tags: restored.tags,
        scope: restored.scope,
        project_id: restored.project_id,
      })
      setPromptTagInput(tagsToInput(restored.tags))
      await loadPrompts()
      setPromptVersions(await window.api.listPromptVersions(restored.id).catch(() => []))
      addToast(`Rolled back to v${version.version}`, 'success')
    } catch {
      addToast('Failed to roll back prompt', 'error')
    }
  }

  useEffect(() => {
    if (visible && category === 'mobile') void refreshMobileStatus()
  }, [visible, category, refreshMobileStatus])

  const refreshWorkspaceInfo = useCallback(async () => {
    const info = await window.api.buildGetWorkspaceInfo()
    setWorkspaceInfo(info)
    setWorkspacePathInput(info.path)
  }, [])

  useEffect(() => {
    if (!visible || category !== 'developer') return
    void refreshWorkspaceInfo()
    window.api.buildGetRecords(5).then(setBuildRecords).catch(() => {})
  }, [visible, category, refreshWorkspaceInfo])

  useEffect(() => {
    if (!visible) return
    const offChunk = window.api.onBuildLogChunk(({ buildId, line }) => {
      if (buildId === activeBuildId || activeBuildId === null) {
        setBuildLogLines((prev) => [...prev.slice(-299), line])
      }
    })
    const offDone = window.api.onBuildCommandDone(({ buildId, status }) => {
      if (buildId === activeBuildId || activeBuildId === null) {
        setActiveBuildId(null)
        setActiveBuildCommand(null)
        setLastBuildStatus(status)
        window.api.buildGetRecords(5).then(setBuildRecords).catch(() => {})
      }
    })
    return () => { offChunk(); offDone() }
  }, [visible, activeBuildId])

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
        setMobilePairingUrl(result.pairingUrl ?? null)
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
      setMobilePairingUrl(result.pairingUrl ?? null)
      addToast('Pairing code regenerated — existing connections closed', 'success')
    } catch {
      addToast('Failed to regenerate pairing code', 'error')
    } finally {
      setMobileLoading(false)
    }
  }

  const handleSaveMobileExternalUrl = async () => {
    const value = mobileExternalUrl.trim()
    if (value && !value.startsWith('wss://')) {
      addToast('Secure mobile URL must start with wss://', 'error')
      return
    }
    setMobileLoading(true)
    try {
      await window.api.setSetting('ws_external_url', value)
      await refreshMobileStatus()
      addToast(value ? 'Secure mobile URL saved' : 'Secure mobile URL cleared', 'success')
    } catch {
      addToast('Failed to save secure mobile URL', 'error')
    } finally {
      setMobileLoading(false)
    }
  }

  const handleSaveWorkspacePath = async () => {
    const info = await window.api.buildSetWorkspacePath(workspacePathInput.trim())
    setWorkspaceInfo(info)
    addToast('Workspace path saved', 'success')
  }

  const handleRunBuildCommand = async (cmd: BuildCommandName) => {
    setBuildLogLines([])
    setActiveBuildCommand(cmd)
    const { buildId } = await window.api.buildStartCommand(cmd)
    setActiveBuildId(buildId)
  }

  const handleCancelBuild = async () => {
    if (!activeBuildId) return
    await window.api.buildCancelCommand(activeBuildId)
    setActiveBuildId(null)
    setActiveBuildCommand(null)
    window.api.buildGetRecords(5).then(setBuildRecords).catch(() => {})
  }

  const handleRunPreflight = async () => {
    setPreflightRunning(true)
    try {
      const result = await window.api.buildRunPreflight()
      setPreflightChecks(result.checks)
    } catch {
      addToast('Preflight check failed', 'error')
    } finally {
      setPreflightRunning(false)
    }
  }

  const handleLaunchDev = async () => {
    setLaunchDevError(null)
    const result = await window.api.buildLaunchDev()
    if (!result.launched) setLaunchDevError(result.error ?? 'Failed to launch')
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
    <ModalShell
      title="Settings"
      ariaLabel="Settings"
      maxWidth="max-w-5xl"
      bodyClassName="flex flex-1 overflow-hidden"
      onClose={onClose}
    >

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
            {category === 'general' && (
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
                    <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">
                      Fallback used when no agent or project default is set
                    </p>
                    <select
                      value={defaultModel}
                      onChange={(e) => setDefaultModel(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {providers.filter((p) => p.configured && p.name !== 'copilot').map((p) => (
                        <optgroup key={p.name} label={p.label}>
                          {p.models.map((modelId) => (
                            <option key={modelId} value={modelId}>
                              {getModelLabel(modelId, catalogModels)}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                      {providers.filter((p) => p.configured && p.name !== 'copilot').length === 0 && (
                        modelIds.map((modelId) => (
                          <option key={modelId} value={modelId}>
                            {getModelLabel(modelId, catalogModels)}
                          </option>
                        ))
                      )}
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
            )}
            {category === 'providers' && (
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

            {category === 'cli' && (
              <>
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100">CLI Tools</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Install CLI tools to chat without an API key. Each tool authenticates with its own provider.
                  </p>
                </div>

                {/* Claude CLI */}
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800 dark:text-gray-100">Claude CLI</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        installedClis.claude
                          ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-500'
                      }`}>
                        {installedClis.claude ? '✓ Installed' : 'Not installed'}
                      </span>
                    </div>
                    <button
                      disabled={cliRefreshing}
                      onClick={async () => {
                        setCliRefreshing(true)
                        await checkAuth()
                        setCliRefreshing(false)
                        addToast('CLI status refreshed', 'success')
                      }}
                      className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${cliRefreshing ? 'animate-spin' : ''}`} />
                      Refresh
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs text-gray-500">Install</p>
                    <pre className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-3 py-2 font-mono overflow-x-auto select-all">npm install -g @anthropic-ai/claude-code</pre>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs text-gray-500">Authenticate (run once)</p>
                    <pre className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-3 py-2 font-mono overflow-x-auto select-all">claude</pre>
                  </div>
                </div>

                {/* Codex CLI */}
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800 dark:text-gray-100">Codex CLI</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        installedClis.codex
                          ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-500'
                      }`}>
                        {installedClis.codex ? '✓ Installed' : 'Not installed'}
                      </span>
                    </div>
                    <button
                      disabled={cliRefreshing}
                      onClick={async () => {
                        setCliRefreshing(true)
                        await checkAuth()
                        setCliRefreshing(false)
                        addToast('CLI status refreshed', 'success')
                      }}
                      className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${cliRefreshing ? 'animate-spin' : ''}`} />
                      Refresh
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs text-gray-500">Install</p>
                    <pre className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-3 py-2 font-mono overflow-x-auto select-all">npm install -g @openai/codex</pre>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs text-gray-500">Authenticate (run once)</p>
                    <pre className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-3 py-2 font-mono overflow-x-auto select-all">codex login</pre>
                  </div>
                </div>
              </>
            )}

            {category === 'prompts' && (
              <div className="h-full min-h-[520px] flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Prompt library</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Save reusable prompts by category. Project prompts are shown with global prompts when a project is active.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleNewPrompt}
                    className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 font-medium"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New
                  </button>
                </div>

                <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-4 min-h-0 flex-1">
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-y-auto">
                    {promptsLoading && (
                      <p className="text-xs text-gray-400 p-3">Loading prompts...</p>
                    )}
                    {!promptsLoading && prompts.length === 0 && (
                      <p className="text-xs text-gray-400 p-3">No prompts yet.</p>
                    )}
                    {!promptsLoading && Object.entries(promptsByCategory).map(([categoryName, entries]) => (
                      <div key={categoryName} className="border-b border-gray-100 dark:border-gray-700 last:border-b-0">
                        <div className="px-3 py-2 bg-gray-50 dark:bg-gray-900/40 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                          {categoryName}
                        </div>
                        <div className="p-1">
                          {entries.map((prompt) => (
                            <button
                              key={prompt.id}
                              type="button"
                              onClick={() => handleSelectPrompt(prompt)}
                              className={`w-full text-left px-2.5 py-2 rounded-md transition-colors ${
                                selectedPromptId === prompt.id
                                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                  : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200'
                              }`}
                            >
                              <span className="block text-xs font-medium whitespace-normal break-words leading-4">{prompt.title}</span>
                              <span className="block text-[11px] text-gray-400 whitespace-normal break-words mt-0.5">
                                {prompt.scope === 'project' ? `Project: ${activeProject?.name ?? 'selected project'}` : 'Available everywhere'}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 overflow-y-auto space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <TextField
                          label="Title"
                          value={promptDraft.title}
                          onChange={(e) => setPromptDraft((draft) => ({ ...draft, title: e.target.value }))}
                          placeholder="Code review checklist"
                        />
                      <TextField
                          label="Category"
                          value={promptDraft.category ?? ''}
                          onChange={(e) => setPromptDraft((draft) => ({ ...draft, category: e.target.value }))}
                          placeholder="Coding"
                        />
                    </div>

                    <TextField
                        label="Description"
                        value={promptDraft.description ?? ''}
                        onChange={(e) => setPromptDraft((draft) => ({ ...draft, description: e.target.value }))}
                        placeholder="Short note about when to use this prompt"
                      />

                    <div className="grid grid-cols-2 gap-3">
                      <SelectField
                          label="Scope"
                          value={promptDraft.scope ?? 'global'}
                          onChange={(e) => setPromptDraft((draft) => ({
                            ...draft,
                            scope: e.target.value === 'project' ? 'project' : 'global',
                            project_id: e.target.value === 'project' ? (projectId ?? null) : null,
                          }))}
                        >
                          <option value="global">Available everywhere</option>
                          <option value="project" disabled={!projectId}>{activeProject?.name ? `Project: ${activeProject.name}` : 'Project prompt'}</option>
                        </SelectField>
                      <TextField
                          label="Tags"
                          value={promptTagInput}
                          onChange={(e) => setPromptTagInput(e.target.value)}
                          placeholder="review, typescript"
                        />
                    </div>

                    <TextareaField
                        label="Prompt"
                        value={promptDraft.body}
                        onChange={(e) => setPromptDraft((draft) => ({ ...draft, body: e.target.value }))}
                        className="min-h-[300px]"
                        placeholder="Write the reusable prompt..."
                      />
                      {promptVariables.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {promptVariables.map((variable) => (
                            <span
                              key={variable}
                              className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-700 text-[11px] font-mono text-gray-600 dark:text-gray-300"
                            >
                              {'{{'}{variable}{'}}'}
                            </span>
                          ))}
                        </div>
                      )}

                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        onClick={handleDeletePrompt}
                        disabled={!selectedPromptId}
                        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-40 disabled:hover:bg-transparent"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={handleSavePrompt}
                        className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 font-medium"
                      >
                        Save prompt
                      </button>
                    </div>

                    {selectedPromptId && (
                      <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-medium text-gray-600 dark:text-gray-300">Version history</p>
                          {versionsLoading && <span className="text-[11px] text-gray-400">Loading...</span>}
                        </div>
                        {!versionsLoading && promptVersions.length === 0 && (
                          <p className="text-xs text-gray-400">No versions recorded yet.</p>
                        )}
                        <div className="space-y-2">
                          {promptVersions.map((version) => {
                            const changedFields = [
                              version.diff.titleChanged ? 'title' : null,
                              version.diff.descriptionChanged ? 'description' : null,
                              version.diff.categoryChanged ? 'category' : null,
                              version.diff.tagsChanged ? 'tags' : null,
                              version.diff.scopeChanged ? 'scope' : null,
                            ].filter(Boolean)
                            return (
                              <details
                                key={version.id}
                                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40"
                              >
                                <summary className="cursor-pointer px-3 py-2 text-xs text-gray-700 dark:text-gray-200 flex items-center justify-between gap-3">
                                  <span>
                                    v{version.version} · {new Date(version.created_at).toLocaleString()} · {version.source}
                                  </span>
                                  <span className="text-[11px] text-gray-400">
                                    {version.diff.addedLines.length} added / {version.diff.removedLines.length} removed
                                  </span>
                                </summary>
                                <div className="px-3 pb-3 space-y-2">
                                  {changedFields.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                      {changedFields.map((field) => (
                                        <span key={field} className="px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-[11px] text-gray-600 dark:text-gray-300">
                                          {field}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  <div className="rounded-md overflow-hidden border border-gray-200 dark:border-gray-700">
                                    {version.diff.removedLines.slice(0, 8).map((line, index) => (
                                      <div key={`removed-${index}`} className="px-2 py-1 text-[11px] font-mono bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300">
                                        - {line}
                                      </div>
                                    ))}
                                    {version.diff.addedLines.slice(0, 8).map((line, index) => (
                                      <div key={`added-${index}`} className="px-2 py-1 text-[11px] font-mono bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300">
                                        + {line}
                                      </div>
                                    ))}
                                    {version.diff.addedLines.length === 0 && version.diff.removedLines.length === 0 && (
                                      <div className="px-2 py-1 text-[11px] text-gray-400">No body line changes</div>
                                    )}
                                  </div>
                                  {version.version !== promptVersions[0]?.version && (
                                    <div className="flex justify-end">
                                      <button
                                        type="button"
                                        onClick={() => void handleRollbackPrompt(version)}
                                        className="text-[11px] px-2.5 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                                      >
                                        Roll back to v{version.version}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </details>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
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
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-gray-500">Pairing URL</span>
                        <span className="font-mono text-right text-gray-800 dark:text-gray-200 break-all">
                          {mobilePairingUrl ?? 'Not available'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500">Connected devices</span>
                        <span className="font-mono text-gray-800 dark:text-gray-200">{mobileClients}</span>
                      </div>
                    </div>

                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 px-4 py-3 space-y-2">
                      <div>
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Secure external URL</p>
                        <p className="text-xs text-gray-500">
                          Optional. Use a public TLS endpoint such as Tailscale Funnel or a reverse proxy that forwards to this mobile server.
                        </p>
                      </div>
                      <input
                        value={mobileExternalUrl}
                        onChange={(event) => setMobileExternalUrl(event.target.value)}
                        placeholder="wss://your-host.example/mobile"
                        className="w-full px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-800 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                      />
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs text-gray-500">
                          Leave blank for local LAN pairing over ws://.
                        </p>
                        <button
                          type="button"
                          onClick={() => void handleSaveMobileExternalUrl()}
                          disabled={mobileLoading}
                          className="px-3 py-1.5 rounded-md text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
                        >
                          Save URL
                        </button>
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

            {category === 'developer' && (
              <>
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Developer</p>
                  <p className="text-xs text-gray-500 mt-0.5">Build, test, and package the app from within Nexy.</p>
                </div>

                {/* Workspace */}
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Workspace</p>
                    <button
                      onClick={() => void refreshWorkspaceInfo()}
                      className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Refresh
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={workspacePathInput}
                      onChange={(e) => setWorkspacePathInput(e.target.value)}
                      className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={() => void handleSaveWorkspacePath()}
                      className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 font-medium"
                    >
                      Save
                    </button>
                  </div>
                  {workspaceInfo && (
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      {workspaceInfo.isGitRepo ? (
                        <>
                          <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-mono">
                            {workspaceInfo.branch ?? '(detached)'}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 font-mono">
                            {workspaceInfo.commitSha ?? '—'}
                          </span>
                          {workspaceInfo.dirty && (
                            <span className="px-2 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300">
                              dirty
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-gray-400">Not a git repo</span>
                      )}
                      {workspaceInfo.version && (
                        <span className="px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
                          v{workspaceInfo.version}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Build actions */}
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Build commands</p>
                  <div className="flex flex-wrap gap-2">
                    {(['typecheck', 'test', 'build', 'package'] as const).map((cmd) => (
                      <button
                        key={cmd}
                        onClick={() => activeBuildId ? handleCancelBuild() : void handleRunBuildCommand(cmd)}
                        disabled={!!activeBuildId && activeBuildCommand !== cmd}
                        className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-40 ${
                          activeBuildCommand === cmd
                            ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        {activeBuildCommand === cmd ? `Cancel ${cmd}` : cmd}
                      </button>
                    ))}
                  </div>
                  {lastBuildStatus && !activeBuildId && (
                    <p className={`text-xs ${lastBuildStatus === 'success' ? 'text-green-600 dark:text-green-400' : lastBuildStatus === 'cancelled' ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}`}>
                      {lastBuildStatus === 'success' ? '✓ Completed successfully' : lastBuildStatus === 'cancelled' ? '⊘ Cancelled' : '✗ Failed'}
                    </p>
                  )}
                </div>

                {/* Live log */}
                {buildLogLines.length > 0 && (
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                      <p className="text-xs font-medium text-gray-500">Output {activeBuildId && <span className="text-blue-500 animate-pulse">● running</span>}</p>
                    </div>
                    <pre className="p-3 text-xs font-mono text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/50 overflow-y-auto max-h-48 whitespace-pre-wrap break-words">
                      {buildLogLines.join('\n')}
                    </pre>
                  </div>
                )}

                {/* Build history */}
                {buildRecords.length > 0 && (
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                      <p className="text-xs font-medium text-gray-500">Recent builds</p>
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-gray-700">
                      {buildRecords.map((rec) => (
                        <div key={rec.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                          <span className={`font-mono w-16 shrink-0 ${rec.status === 'success' ? 'text-green-600 dark:text-green-400' : rec.status === 'running' ? 'text-blue-500' : rec.status === 'cancelled' ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-500'}`}>
                            {rec.status}
                          </span>
                          <span className="font-mono text-gray-700 dark:text-gray-300 w-20 shrink-0">{rec.command}</span>
                          <span className="text-gray-400 font-mono truncate">{rec.branch ?? '—'}</span>
                          {rec.finishedAt && (
                            <span className="text-gray-400 ml-auto shrink-0">{Math.round((rec.finishedAt - rec.startedAt) / 1000)}s</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Preflight */}
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Preflight checks</p>
                    <button
                      onClick={() => void handleRunPreflight()}
                      disabled={preflightRunning}
                      className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
                    >
                      {preflightRunning ? 'Running...' : 'Run checks'}
                    </button>
                  </div>
                  {preflightChecks && (
                    <div className="space-y-1.5">
                      {preflightChecks.map((check) => (
                        <div key={check.label} className="flex items-start gap-2 text-xs">
                          {check.status === 'ok' && <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0 mt-px" />}
                          {check.status === 'warn' && <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 shrink-0 mt-px" />}
                          {check.status === 'fail' && <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-px" />}
                          <div>
                            <span className="font-medium text-gray-700 dark:text-gray-300">{check.label}</span>
                            <span className="text-gray-400 ml-1.5">{check.detail}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Launch dev build */}
                {lastBuildStatus === 'success' && (
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-2">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Launch dev build</p>
                    <p className="text-xs text-gray-500">Open the just-built app as a separate Electron process for smoke testing.</p>
                    <button
                      onClick={() => void handleLaunchDev()}
                      className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 font-medium"
                    >
                      Launch
                    </button>
                    {launchDevError && (
                      <p className="text-xs text-red-500">{launchDevError}</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
    </ModalShell>
  )
}
