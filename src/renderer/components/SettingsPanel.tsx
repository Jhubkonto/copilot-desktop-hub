import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Settings, Shield, Terminal, BookOpen, Smartphone, Wrench } from 'lucide-react'
import { useAppStore } from '../store/app-store'
import { getAvailableModelIds } from '../../shared/models'
import type { AdbDevice, AndroidBuildCommandName, AndroidSigningConfig, AndroidUpdateManifest, AndroidWorkspaceInfo, BuildCommandName, BuildRecord, BuildStatus, LocalUpdateFeed, PreflightCheck, PromptLibraryEntry, PromptLibraryInput, PromptLibraryVersion, PublishedEntry, WorkspaceInfo } from '../../shared/types'
import { extractPromptVariables } from '../../shared/prompt-variables'
import { ModalShell } from './ui/primitives'
import { GeneralTab } from './settings/GeneralTab'
import { ProvidersTab } from './settings/ProvidersTab'
import { CliTab } from './settings/CliTab'
import { PromptsTab } from './settings/PromptsTab'
import { MobileTab } from './settings/MobileTab'
import { DeveloperTab } from './settings/DeveloperTab'
import type { ProviderInfo } from './settings/types'

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
  return value.split(',').map((tag) => tag.trim()).filter(Boolean)
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
  const [availableModelGroups, setAvailableModelGroups] = useState<import('@shared/types').AvailableModelGroup[]>([])
  const [editingProvider, setEditingProvider] = useState<string | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [azureEndpoint, setAzureEndpoint] = useState('')
  const [testResult, setTestResult] = useState<{ valid: boolean; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [cliRefreshing, setCliRefreshing] = useState(false)
  const [defaultModel, setDefaultModel] = useState('gpt-5-mini')
  const [defaultModelSearch, setDefaultModelSearch] = useState('')
  const [showDefaultModelMenu, setShowDefaultModelMenu] = useState(false)
  const [defaultModelMenuRect, setDefaultModelMenuRect] = useState<DOMRect | null>(null)
  const defaultModelMenuRef = useRef<HTMLDivElement | null>(null)
  const defaultModelButtonRef = useRef<HTMLButtonElement | null>(null)
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
  // Local update feed state
  const [feedInfo, setFeedInfo] = useState<LocalUpdateFeed | null>(null)
  const [feedPathInput, setFeedPathInput] = useState('')
  const [publishedEntries, setPublishedEntries] = useState<PublishedEntry[]>([])
  const [publishing, setPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState<string | null>(null)

  // Android build state
  const [androidWorkspaceInfo, setAndroidWorkspaceInfo] = useState<AndroidWorkspaceInfo | null>(null)
  const [androidWorkspacePathInput, setAndroidWorkspacePathInput] = useState('')
  const [androidBuildRecords, setAndroidBuildRecords] = useState<BuildRecord[]>([])
  const [activeAndroidBuildId, setActiveAndroidBuildId] = useState<string | null>(null)
  const [activeAndroidCommand, setActiveAndroidCommand] = useState<AndroidBuildCommandName | null>(null)
  const [androidLogLines, setAndroidLogLines] = useState<string[]>([])
  const [androidLastBuildStatus, setAndroidLastBuildStatus] = useState<BuildStatus | null>(null)
  const [signingDraft, setSigningDraft] = useState<AndroidSigningConfig>({ keystorePath: '', keystorePassword: '', keyAlias: '', keyPassword: '' })
  const [signingValidation, setSigningValidation] = useState<PreflightCheck[] | null>(null)
  const [adbDevices, setAdbDevices] = useState<AdbDevice[]>([])
  const [adbInstalling, setAdbInstalling] = useState(false)
  const [androidPublishResult, setAndroidPublishResult] = useState<string | null>(null)
  const [androidUpdateManifest, setAndroidUpdateManifest] = useState<AndroidUpdateManifest | null>(null)
  const [androidPublishHistory, setAndroidPublishHistory] = useState<AndroidUpdateManifest[]>([])
  const [androidRestoring, setAndroidRestoring] = useState<number | null>(null)
  const [fcmStatus, setFcmStatus] = useState<{ configured: boolean; projectId?: string } | null>(null)
  const [fcmJsonDraft, setFcmJsonDraft] = useState('')
  const [fcmSaving, setFcmSaving] = useState(false)

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
    window.api.listAvailableModels().then(setAvailableModelGroups).catch(() => {})
    window.api.getAzureEndpoint().then((ep: string | null) => {
      if (ep) setAzureEndpoint(ep)
    })
  }, [visible])

  useEffect(() => {
    if (!showDefaultModelMenu) { setDefaultModelSearch(''); return }
    const handleClickOutside = (e: MouseEvent) => {
      if (defaultModelMenuRef.current && !defaultModelMenuRef.current.contains(e.target as Node)) {
        setShowDefaultModelMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showDefaultModelMenu])

  const refreshMobileStatus = useCallback(async () => {
    const status = await window.api.wsStatus()
    setMobileEnabled(status.enabled)
    setMobileQr(status.qrDataUrl ?? null)
    setMobileClients(status.connectedClients)
    setMobileLocalIp(status.localIp)
    setMobilePairingUrl(status.pairingUrl ?? null)
  }, [])

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
    void Promise.all([
      refreshWorkspaceInfo(),
      window.api.buildGetRecords(5).then(setBuildRecords).catch(() => {}),
      window.api.buildGetFeedInfo().then((info) => {
        setFeedInfo(info)
        setFeedPathInput(info?.feedPath ?? '')
      }).catch(() => {}),
      window.api.buildListPublished().then(setPublishedEntries).catch(() => {}),
      window.api.androidGetWorkspaceInfo().then((info) => {
        setAndroidWorkspaceInfo(info)
        setAndroidWorkspacePathInput(info.path)
      }).catch(() => {}),
      window.api.androidGetRecords(10).then(setAndroidBuildRecords).catch(() => {}),
      window.api.androidGetSigningConfig().then((config) => {
        if (config) setSigningDraft(config)
      }).catch(() => {}),
      window.api.androidGetUpdateManifest().then(setAndroidUpdateManifest).catch(() => {}),
      window.api.androidGetPublishHistory().then(setAndroidPublishHistory).catch(() => {}),
      window.api.androidGetFcmConfigStatus().then(setFcmStatus).catch(() => {}),
    ])
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
    const offAndroidChunk = window.api.onAndroidLogChunk(({ buildId, line }) => {
      if (buildId === activeAndroidBuildId || activeAndroidBuildId === null) {
        setAndroidLogLines((prev) => [...prev.slice(-299), line])
      }
    })
    const offAndroidDone = window.api.onAndroidCommandDone(({ buildId, status }) => {
      if (buildId === activeAndroidBuildId || activeAndroidBuildId === null) {
        setActiveAndroidBuildId(null)
        setActiveAndroidCommand(null)
        setAndroidLastBuildStatus(status)
        window.api.androidGetRecords(10).then(setAndroidBuildRecords).catch(() => {})
      }
    })
    return () => { offChunk(); offDone(); offAndroidChunk(); offAndroidDone() }
  }, [visible, activeBuildId, activeAndroidBuildId])

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

  const handleSaveFeedPath = async () => {
    const trimmed = feedPathInput.trim()
    if (!trimmed) return
    const info = await window.api.buildSetFeedPath(trimmed)
    setFeedInfo(info)
    addToast('Local update feed path saved', 'success')
  }

  const handlePublishUpdate = async () => {
    setPublishing(true)
    setPublishResult(null)
    try {
      const result = await window.api.buildPublishUpdate()
      if (result.published) {
        setPublishResult(`Published v${result.version ?? '?'} to local feed`)
        const [info, entries] = await Promise.all([
          window.api.buildGetFeedInfo(),
          window.api.buildListPublished(),
        ])
        setFeedInfo(info)
        setPublishedEntries(entries)
      } else {
        setPublishResult(result.error ?? 'Publish failed')
      }
    } catch {
      setPublishResult('Publish failed')
    } finally {
      setPublishing(false)
    }
  }

  const handleRollback = async (version: string) => {
    const result = await window.api.buildRollbackUpdate(version)
    if (!result.launched) addToast(result.error ?? 'Failed to launch installer', 'error')
    else addToast(`Launching v${version} installer…`, 'success')
  }

  const handleSaveAndroidWorkspacePath = async () => {
    const trimmed = androidWorkspacePathInput.trim()
    if (!trimmed) return
    const info = await window.api.androidSetWorkspacePath(trimmed)
    setAndroidWorkspaceInfo(info)
  }

  const handleRefreshAndroidWorkspace = async () => {
    const info = await window.api.androidGetWorkspaceInfo()
    setAndroidWorkspaceInfo(info)
  }

  const handleAndroidStartCommand = async (cmd: AndroidBuildCommandName) => {
    setAndroidLogLines([])
    setActiveAndroidCommand(cmd)
    const result = await window.api.androidStartCommand(cmd)
    setActiveAndroidBuildId(result.buildId)
  }

  const handleAndroidCancelCommand = async () => {
    if (!activeAndroidBuildId) return
    await window.api.androidCancelCommand(activeAndroidBuildId)
    setActiveAndroidBuildId(null)
    setActiveAndroidCommand(null)
  }

  const handleSaveSigningConfig = async () => {
    await window.api.androidSetSigningConfig(signingDraft)
    addToast('Signing config saved', 'success')
  }

  const handleValidateSigningConfig = async () => {
    const result = await window.api.androidValidateSigningConfig()
    setSigningValidation(result.checks)
  }

  const handleRefreshAdbDevices = async () => {
    const devices = await window.api.androidListAdbDevices()
    setAdbDevices(devices)
  }

  const latestAdbInstallRecord = androidBuildRecords
    .filter((r) =>
      (r.command === 'assembleDebug' || r.command === 'assembleRelease') &&
      r.status === 'success' &&
      r.artifactPaths.some((artifactPath) => artifactPath.toLowerCase().endsWith('.apk'))
    )
    .sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt))[0]
  const latestAdbInstallApk = latestAdbInstallRecord?.artifactPaths.find((artifactPath) =>
    artifactPath.toLowerCase().endsWith('.apk')
  )

  const handleAndroidInstallApk = async (serial: string) => {
    if (!latestAdbInstallApk || !latestAdbInstallRecord) {
      addToast('No successful debug or release APK build found', 'error')
      return
    }
    setAdbInstalling(true)
    try {
      const result = await window.api.androidInstallApk(serial, latestAdbInstallApk)
      if (result.success) addToast(`${latestAdbInstallRecord.command} installed successfully`, 'success')
      else addToast(result.error ?? 'Install failed', 'error')
    } finally {
      setAdbInstalling(false)
    }
  }

  const handleAndroidPublishUpdate = async () => {
    setAndroidPublishResult(null)
    const result = await window.api.androidPublishUpdate()
    if (result.published) {
      setAndroidPublishResult(`Published v${result.manifest?.versionName ?? '?'} (build ${result.manifest?.versionCode ?? '?'}) to feed`)
      setAndroidUpdateManifest(result.manifest ?? null)
      window.api.androidGetPublishHistory().then(setAndroidPublishHistory).catch(() => {})
    } else {
      setAndroidPublishResult(`Error: ${result.error ?? 'Unknown error'}`)
    }
  }

  const handleAndroidRestoreVersion = async (versionCode: number) => {
    setAndroidRestoring(versionCode)
    try {
      const result = await window.api.androidRestoreVersion(versionCode)
      if (result.restored) {
        setAndroidUpdateManifest(result.manifest ?? null)
        window.api.androidGetPublishHistory().then(setAndroidPublishHistory).catch(() => {})
      } else {
        console.error('Restore failed:', result.error)
      }
    } finally {
      setAndroidRestoring(null)
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
      window.api.listAvailableModels().then(setAvailableModelGroups).catch(() => {})
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
      window.api.listAvailableModels().then(setAvailableModelGroups).catch(() => {})
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

  // suppress unused variable warning — activeAgent is computed for potential future use
  void activeAgent

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
          <GeneralTab
            theme={theme}
            toggleTheme={toggleTheme}
            effectiveModel={effectiveModel}
            effectiveProvider={effectiveProvider}
            autoStart={autoStart}
            autoClipboard={autoClipboard}
            defaultModel={defaultModel}
            defaultModelSearch={defaultModelSearch}
            showDefaultModelMenu={showDefaultModelMenu}
            defaultModelMenuRect={defaultModelMenuRect}
            availableModelGroups={availableModelGroups}
            modelIds={modelIds}
            temperature={temperature}
            maxTokens={maxTokens}
            catalogModels={catalogModels}
            onToggleAutoStart={() => void handleAutoStartToggle()}
            onToggleAutoClipboard={() => void handleAutoClipboardToggle()}
            onSetDefaultModel={setDefaultModel}
            onSetDefaultModelSearch={setDefaultModelSearch}
            onSetShowDefaultModelMenu={setShowDefaultModelMenu}
            onSetDefaultModelMenuRect={setDefaultModelMenuRect}
            onSetTemperature={setTemperature}
            onSetMaxTokens={setMaxTokens}
            onSaveAdvanced={() => void handleSaveAdvanced()}
            onOpenMcp={onOpenMcp}
            defaultModelMenuRef={defaultModelMenuRef}
            defaultModelButtonRef={defaultModelButtonRef}
          />
        )}

        {category === 'providers' && (
          <ProvidersTab
            authMode={authMode}
            providers={providers}
            editingProvider={editingProvider}
            apiKeyInput={apiKeyInput}
            azureEndpoint={azureEndpoint}
            testResult={testResult}
            testing={testing}
            onSetEditingProvider={setEditingProvider}
            onSetApiKeyInput={setApiKeyInput}
            onSetAzureEndpoint={setAzureEndpoint}
            onSetTestResult={setTestResult}
            onSaveKey={() => void handleSaveKey()}
            onTestKey={() => void handleTestKey()}
            onRemoveKey={(p) => void handleRemoveKey(p)}
          />
        )}

        {category === 'cli' && (
          <CliTab
            installedClis={installedClis}
            cliRefreshing={cliRefreshing}
            onRefresh={async () => {
              setCliRefreshing(true)
              await checkAuth()
              setCliRefreshing(false)
              addToast('CLI status refreshed', 'success')
            }}
          />
        )}

        {category === 'prompts' && (
          <PromptsTab
            prompts={prompts}
            promptsLoading={promptsLoading}
            selectedPromptId={selectedPromptId}
            promptDraft={promptDraft}
            promptTagInput={promptTagInput}
            promptVersions={promptVersions}
            versionsLoading={versionsLoading}
            promptsByCategory={promptsByCategory}
            promptVariables={promptVariables}
            projectId={projectId}
            activeProject={activeProject}
            onSetPromptDraft={(updater) => setPromptDraft((d) => updater(d))}
            onSetPromptTagInput={setPromptTagInput}
            onNewPrompt={handleNewPrompt}
            onSelectPrompt={handleSelectPrompt}
            onSavePrompt={() => void handleSavePrompt()}
            onDeletePrompt={() => void handleDeletePrompt()}
            onRollbackPrompt={handleRollbackPrompt}
          />
        )}

        {category === 'mobile' && (
          <MobileTab
            mobileEnabled={mobileEnabled}
            mobileQr={mobileQr}
            mobileClients={mobileClients}
            mobileLoading={mobileLoading}
            mobileLocalIp={mobileLocalIp}
            mobilePairingUrl={mobilePairingUrl}
            mobileExternalUrl={mobileExternalUrl}
            onSetMobileExternalUrl={setMobileExternalUrl}
            onToggle={() => void handleMobileToggle()}
            onRegenerateToken={() => void handleRegenerateToken()}
            onSaveExternalUrl={() => void handleSaveMobileExternalUrl()}
            onRefreshStatus={() => void refreshMobileStatus()}
          />
        )}

        <div className={category !== 'developer' ? 'hidden' : undefined}>
          <DeveloperTab
            workspaceInfo={workspaceInfo}
            workspacePathInput={workspacePathInput}
            onSetWorkspacePathInput={setWorkspacePathInput}
            onRefreshWorkspace={() => void refreshWorkspaceInfo()}
            onSaveWorkspacePath={() => void handleSaveWorkspacePath()}
            buildRecords={buildRecords}
            activeBuildId={activeBuildId}
            activeBuildCommand={activeBuildCommand}
            buildLogLines={buildLogLines}
            lastBuildStatus={lastBuildStatus}
            onRunBuildCommand={(cmd) => void handleRunBuildCommand(cmd)}
            onCancelBuild={() => void handleCancelBuild()}
            preflightChecks={preflightChecks}
            preflightRunning={preflightRunning}
            onRunPreflight={() => void handleRunPreflight()}
            feedInfo={feedInfo}
            feedPathInput={feedPathInput}
            publishedEntries={publishedEntries}
            publishing={publishing}
            publishResult={publishResult}
            onSetFeedPathInput={setFeedPathInput}
            onSaveFeedPath={() => void handleSaveFeedPath()}
            onPublishUpdate={() => void handlePublishUpdate()}
            onRollback={(v) => void handleRollback(v)}
            launchDevError={launchDevError}
            onLaunchDev={() => void handleLaunchDev()}
            androidWorkspaceInfo={androidWorkspaceInfo}
            androidWorkspacePathInput={androidWorkspacePathInput}
            onSetAndroidWorkspacePathInput={setAndroidWorkspacePathInput}
            onSaveAndroidWorkspacePath={() => void handleSaveAndroidWorkspacePath()}
            onRefreshAndroidWorkspace={() => void handleRefreshAndroidWorkspace()}
            androidBuildRecords={androidBuildRecords}
            activeAndroidBuildId={activeAndroidBuildId}
            activeAndroidCommand={activeAndroidCommand}
            androidLogLines={androidLogLines}
            androidLastBuildStatus={androidLastBuildStatus}
            onAndroidStartCommand={(cmd) => void handleAndroidStartCommand(cmd)}
            onAndroidCancelCommand={() => void handleAndroidCancelCommand()}
            signingDraft={signingDraft}
            signingValidation={signingValidation}
            onSetSigningDraft={setSigningDraft}
            onSaveSigningConfig={() => void handleSaveSigningConfig()}
            onValidateSigningConfig={() => void handleValidateSigningConfig()}
            adbDevices={adbDevices}
            adbInstalling={adbInstalling}
            latestAdbInstallRecord={latestAdbInstallRecord}
            latestAdbInstallApk={latestAdbInstallApk}
            onRefreshAdbDevices={() => void handleRefreshAdbDevices()}
            onAndroidInstallApk={(serial) => void handleAndroidInstallApk(serial)}
            androidPublishResult={androidPublishResult}
            androidUpdateManifest={androidUpdateManifest}
            androidPublishHistory={androidPublishHistory}
            androidRestoring={androidRestoring}
            onAndroidPublishUpdate={() => void handleAndroidPublishUpdate()}
            onAndroidRestoreVersion={(vc) => void handleAndroidRestoreVersion(vc)}
            fcmStatus={fcmStatus}
            fcmJsonDraft={fcmJsonDraft}
            fcmSaving={fcmSaving}
            onSetFcmJsonDraft={setFcmJsonDraft}
            onSaveFcmServiceAccount={() => {
              setFcmSaving(true)
              void window.api.androidSaveFcmServiceAccount(fcmJsonDraft)
                .then((result) => {
                  if (result.saved) {
                    void window.api.androidGetFcmConfigStatus().then(setFcmStatus)
                    setFcmJsonDraft('')
                  }
                })
                .finally(() => setFcmSaving(false))
            }}
          />
        </div>
      </div>
    </ModalShell>
  )
}
