import { useState, useEffect, useRef, useMemo } from 'react'
import { X, Settings, FileText, Wrench } from 'lucide-react'
import { useAppStore } from '../store/app-store'
import type { AgentConfig, AvailableModelGroup } from '../../shared/types'
import { PROVIDER_THINKING_SUPPORT } from '../../shared/types'
import { ResizeHandle } from './ResizeHandle'
import { Button } from './ui/primitives'
import { SettingsTab } from './agent-panel/SettingsTab'
import { SkillsTab } from './agent-panel/SkillsTab'
import { KnowledgeTab } from './agent-panel/KnowledgeTab'
import { JsonTab } from './agent-panel/JsonTab'
import type { KnowledgeFile, McpTool, McpServerInfo, McpToolOverride, McpTrustTier } from './agent-panel/types'

const EMPTY_AGENT: Omit<AgentConfig, 'id'> = {
  name: '',
  icon: '🤖',
  systemPrompt: '',
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
  customCommands: [],
  backend: undefined,
}

export function AgentPanel({ width, onResize }: { width: number; onResize: (size: number) => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const editingAgentId = useAppStore((s) => s.editingAgentId)
  const agents = useAppStore((s) => s.agents)
  const onSave = useAppStore((s) => s.saveAgent)
  const onClose = useAppStore((s) => s.closeAgentPanel)
  const onDelete = useAppStore((s) => s.deleteAgent)
  const onDuplicate = useAppStore((s) => s.duplicateAgent)
  const onExport = useAppStore((s) => s.exportAgent)
  const skills = useAppStore((s) => s.skills)
  const loadSkills = useAppStore((s) => s.loadSkills)
  const setShowMcpPanel = useAppStore((s) => s.setShowMcpPanel)
  const setShowSettings = useAppStore((s) => s.setShowSettings)
  const setSettingsInitialTab = useAppStore((s) => s.setSettingsInitialTab)
  const globalDefaultModel = useAppStore((s) => s.globalDefaultModel)
  const schedulerTasks = useAppStore((s) => s.schedulerTasks ?? [])

  const [availableGroups, setAvailableGroups] = useState<AvailableModelGroup[]>([])
  useEffect(() => {
    window.api.listAvailableModels().then(setAvailableGroups).catch(() => {})
  }, [])

  const agent = editingAgentId ? agents.find((a) => a.id === editingAgentId) ?? null : null
  const [tab, setTab] = useState<'settings' | 'skills' | 'knowledge' | 'json'>('settings')
  const [config, setConfig] = useState<AgentConfig>(() => ({ id: '', ...EMPTY_AGENT, ...agent }))
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState('')

  // Knowledge tab state
  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFile[]>([])
  const [editingKnowledgeFile, setEditingKnowledgeFile] = useState<{ id: string; filePath: string } | null>(null)
  const [editingFileContent, setEditingFileContent] = useState('')

  // Skills tab state
  const [agentMcpTools, setAgentMcpTools] = useState<McpTool[]>([])
  const [mcpToolOverrides, setMcpToolOverrides] = useState<McpToolOverride[]>([])
  const [mcpServerTrust, setMcpServerTrust] = useState<{ server_id: string; trust: string }[]>([])
  const [globalMcpServers, setGlobalMcpServers] = useState<McpServerInfo[]>([])
  const [expandedCustomServers, setExpandedCustomServers] = useState<Set<string>>(new Set())
  const [attachedSkillIds, setAttachedSkillIds] = useState<string[]>([])

  // Settings tab local state
  const [newGlob, setNewGlob] = useState('')
  const [newCmdName, setNewCmdName] = useState('')
  const [newCmdDesc, setNewCmdDesc] = useState('')
  const [newCmdPrompt, setNewCmdPrompt] = useState('')

  const isEditing = !!agent?.id
  const autoApproveDisabled = isEditing && schedulerTasks.some((task) => task.agentId === config.id)

  const thinkingSupported = useMemo(() => {
    if (config.backend === 'claude-cli' || config.backend === 'codex-cli') return true
    if (config.backend) return false
    // BYOK: derive provider from available groups + global default model
    const model = globalDefaultModel ?? 'default'
    const group = availableGroups.find(
      (g) => g.sourceType === 'provider' && (model === 'default' || g.models.some((m) => m.id === model)),
    )
    if (!group) return true // no groups loaded yet — optimistic
    const support = PROVIDER_THINKING_SUPPORT[group.sourceKey]
    return support === true || support === 'o-series-only'
  }, [config.backend, globalDefaultModel, availableGroups])

  useEffect(() => {
    if (tab === 'json') {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, isDefault: _d, ...rest } = config as AgentConfig & { isDefault?: boolean }
      setJsonText(JSON.stringify(rest, null, 2))
      setJsonError('')
    }
    if (tab === 'skills' && isEditing) {
      loadSkills().catch(() => {})
      window.api.getSkillAgentLinks(config.id).then((links) => setAttachedSkillIds(links.map((link) => link.skill_id)))
      window.api.getMcpToolOverrides(config.id).then((overrides) => setMcpToolOverrides(overrides as McpToolOverride[]))
      window.api.getMcpServerTrust(config.id).then((rows) => setMcpServerTrust(rows as { server_id: string; trust: string }[]))
    }
    if (tab === 'skills' && !isEditing) {
      loadSkills().catch(() => {})
      setAttachedSkillIds([])
    }
    if (tab === 'knowledge' && isEditing) {
      window.api.listKnowledgeFiles(config.id).then((files) => setKnowledgeFiles(files as KnowledgeFile[]))
    }
  }, [tab, config, isEditing, loadSkills])

  useEffect(() => {
    if (tab !== 'skills') return
    window.api.listMcpServers().then((servers) => setGlobalMcpServers(servers as McpServerInfo[]))
    window.api.listMcpTools(config.mcpServers).then((tools) => setAgentMcpTools(tools as McpTool[]))
  }, [tab, config.mcpServers])

  const updateField = <K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) =>
    setConfig((prev) => ({ ...prev, [key]: value }))

  // ── MCP helpers ───────────────────────────────────────────────────────────

  const getMcpOverride = (serverId: string, toolName: string): McpToolOverride | undefined =>
    mcpToolOverrides.find((o) => o.server_id === serverId && o.tool_name === toolName)

  const deriveServerTier = (serverId: string): McpTrustTier => {
    const serverTools = agentMcpTools.filter((t) => t.serverId === serverId)
    if (serverTools.length === 0) {
      // No tools loaded (server offline) — fall back to persisted server-level trust.
      const saved = mcpServerTrust.find((r) => r.server_id === serverId)
      if (saved) return saved.trust as McpTrustTier
      return 'always-ask'
    }
    const effective = serverTools.map((t) => {
      const o = getMcpOverride(serverId, t.name)
      return { enabled: o?.enabled ?? 1, approval: o?.approval ?? 'always-ask' }
    })
    if (effective.every((e) => e.enabled === 1 && e.approval === 'auto')) return 'auto'
    if (effective.every((e) => e.enabled === 1 && e.approval === 'always-ask')) return 'always-ask'
    if (effective.every((e) => e.enabled === 0)) return 'block'
    return 'custom'
  }

  const getServerTierValue = (serverId: string): McpTrustTier =>
    expandedCustomServers.has(serverId) ? 'custom' : deriveServerTier(serverId)

  const handleSetServerTier = async (serverId: string, tier: McpTrustTier) => {
    if (tier === 'custom') {
      setExpandedCustomServers((prev) => new Set([...prev, serverId]))
      return
    }
    setExpandedCustomServers((prev) => { const next = new Set(prev); next.delete(serverId); return next })
    // Persist server-level trust so it is enforced even when the server is offline
    // and per-tool override rows haven't been written yet.
    const trustValue = tier === 'auto' ? 'auto' : tier === 'block' ? 'block' : 'always-ask'
    await window.api.setMcpServerTrust(config.id, serverId, trustValue)
    setMcpServerTrust((prev) => {
      const filtered = prev.filter((r) => r.server_id !== serverId)
      return [...filtered, { server_id: serverId, trust: trustValue }]
    })
    const serverTools = agentMcpTools.filter((t) => t.serverId === serverId)
    const settings =
      tier === 'auto' ? { enabled: true, approval: 'auto', instructions: '' }
      : tier === 'always-ask' ? { enabled: true, approval: 'always-ask', instructions: '' }
      : { enabled: false, approval: 'always-ask', instructions: '' }
    await Promise.all(serverTools.map((tool) => window.api.setMcpToolOverride(config.id, serverId, tool.name, settings)))
    const fresh = await window.api.getMcpToolOverrides(config.id)
    setMcpToolOverrides(fresh as McpToolOverride[])
  }

  const toggleServerAssignment = (serverId: string) => {
    const next = config.mcpServers.includes(serverId)
      ? config.mcpServers.filter((id) => id !== serverId)
      : [...config.mcpServers, serverId]
    updateField('mcpServers', next)
  }

  const handleSetMcpOverride = async (serverId: string, toolName: string, field: 'enabled' | 'approval' | 'instructions', value: string | boolean) => {
    const existing = getMcpOverride(serverId, toolName)
    const newOverride = {
      enabled: existing?.enabled ?? 1,
      approval: existing?.approval ?? 'always-ask',
      instructions: existing?.instructions ?? '',
      [field]: typeof value === 'boolean' ? (value ? 1 : 0) : value
    }
    await window.api.setMcpToolOverride(config.id, serverId, toolName, { ...newOverride, enabled: newOverride.enabled === 1 })
    setMcpToolOverrides((prev) => {
      const filtered = prev.filter((o) => !(o.server_id === serverId && o.tool_name === toolName))
      return [...filtered, { agent_id: config.id, server_id: serverId, tool_name: toolName, ...newOverride } as McpToolOverride]
    })
  }

  const refreshAttachedSkills = async () => {
    if (!config.id) return
    const links = await window.api.getSkillAgentLinks(config.id)
    setAttachedSkillIds(links.map((link) => link.skill_id))
  }

  const handleAttachSkill = async (skillId: string) => {
    if (!config.id) return
    await window.api.attachSkillToAgent(config.id, skillId, true)
    await refreshAttachedSkills()
  }

  const handleDetachSkill = async (skillId: string) => {
    if (!config.id) return
    await window.api.attachSkillToAgent(config.id, skillId, false)
    await refreshAttachedSkills()
  }

  const handleMoveSkill = async (skillId: string, direction: -1 | 1) => {
    const currentIndex = attachedSkillIds.indexOf(skillId)
    const nextIndex = currentIndex + direction
    if (currentIndex === -1 || nextIndex < 0 || nextIndex >= attachedSkillIds.length) return
    const next = [...attachedSkillIds]
    const [moved] = next.splice(currentIndex, 1)
    next.splice(nextIndex, 0, moved)
    setAttachedSkillIds(next)
    await window.api.reorderSkillsForAgent(config.id, next)
  }

  // ── Settings tab handlers ─────────────────────────────────────────────────

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

  const addCustomCommand = () => {
    const name = newCmdName.trim().replace(/^\/+/, '')
    if (!name) return
    const cmd = { name: `/${name}`, description: newCmdDesc.trim(), prompt: newCmdPrompt.trim() }
    updateField('customCommands', [...(config.customCommands ?? []), cmd])
    setNewCmdName('')
    setNewCmdDesc('')
    setNewCmdPrompt('')
  }

  const removeCustomCommand = (i: number) =>
    updateField('customCommands', (config.customCommands ?? []).filter((_, idx) => idx !== i))

  const handleAddDirectories = async () => {
    const dirs = await window.api.openDirectoryDialog()
    if (dirs && dirs.length > 0) updateField('contextDirectories', [...config.contextDirectories, ...dirs])
  }

  const handleAddFiles = async () => {
    const files = await window.api.openFileDialog()
    if (files && files.length > 0) {
      const paths = files.map((f: { path: string }) => f.path)
      updateField('contextFiles', [...config.contextFiles, ...paths])
    }
  }

  const handlePickRootDirectory = async () => {
    const dirs = await window.api.openDirectoryDialog()
    if (dirs && dirs.length > 0) updateField('rootDirectory', dirs[0])
  }

  // ── Knowledge tab handlers ────────────────────────────────────────────────

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
    setKnowledgeFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, inject_mode: newMode } : f)))
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

  // ── JSON tab handlers ─────────────────────────────────────────────────────

  const handleJsonSave = () => {
    try {
      const parsed = JSON.parse(jsonText)
      const { model: _model, ...rest } = parsed
      void _model
      setConfig((prev) => ({ ...prev, ...rest, id: prev.id }))
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

  return (
    <div className="fixed inset-0 top-9 z-50 flex" role="dialog" aria-modal="true" aria-label="Agent configuration">
      <div className="flex-1 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} className="relative bg-white dark:bg-gray-900 shadow-xl flex flex-col border-l border-gray-200 dark:border-gray-700" style={{ width }}>
        <ResizeHandle direction="horizontal" align="start" containerRef={panelRef} onSetSize={onResize} minSize={280} maxSize={() => Math.min(700, Math.floor(window.innerWidth * 0.45))} />

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
        <div className="flex-1 overflow-y-auto p-4 space-y-4 mr-1.5">
          {tab === 'settings' && (
            <SettingsTab
              config={config}
              onUpdateField={updateField}
              thinkingSupported={thinkingSupported}
              newGlob={newGlob}
              onSetNewGlob={setNewGlob}
              onAddIgnoredGlob={addIgnoredGlob}
              onRemoveIgnoredGlob={removeIgnoredGlob}
              newCmdName={newCmdName}
              newCmdDesc={newCmdDesc}
              newCmdPrompt={newCmdPrompt}
              onSetNewCmdName={setNewCmdName}
              onSetNewCmdDesc={setNewCmdDesc}
              onSetNewCmdPrompt={setNewCmdPrompt}
              onAddCustomCommand={addCustomCommand}
              onRemoveCustomCommand={removeCustomCommand}
              onAddDirectories={handleAddDirectories}
              onAddFiles={handleAddFiles}
              onRemoveContextDir={(i) => updateField('contextDirectories', config.contextDirectories.filter((_, idx) => idx !== i))}
              onRemoveContextFile={(i) => updateField('contextFiles', config.contextFiles.filter((_, idx) => idx !== i))}
              onPickRootDirectory={handlePickRootDirectory}
              onOpenCliSettings={() => { setSettingsInitialTab('cli'); setShowSettings(true) }}
              autoApproveDisabled={autoApproveDisabled}
            />
          )}

          {tab === 'skills' && (
            <SkillsTab
              config={config}
              isEditing={isEditing}
              agentMcpTools={agentMcpTools}
              mcpToolOverrides={mcpToolOverrides}
              globalMcpServers={globalMcpServers}
              skills={skills}
              attachedSkillIds={attachedSkillIds}
              onAttachSkill={handleAttachSkill}
              onDetachSkill={handleDetachSkill}
              onMoveSkill={handleMoveSkill}
              onUpdateField={updateField}
              onToggleServerAssignment={toggleServerAssignment}
              onGetServerTierValue={getServerTierValue}
              onSetServerTier={handleSetServerTier}
              onGetMcpOverride={getMcpOverride}
              onSetMcpOverride={handleSetMcpOverride}
              onOpenMcpPanel={() => setShowMcpPanel(true)}
            />
          )}

          {tab === 'knowledge' && (
            <KnowledgeTab
              isEditing={isEditing}
              knowledgeFiles={knowledgeFiles}
              editingKnowledgeFile={editingKnowledgeFile}
              editingFileContent={editingFileContent}
              onSetEditingFileContent={setEditingFileContent}
              onSetEditingKnowledgeFile={setEditingKnowledgeFile}
              onAddKnowledgeFile={handleAddKnowledgeFile}
              onRemoveKnowledgeFile={handleRemoveKnowledgeFile}
              onToggleInjectMode={handleToggleInjectMode}
              onEditKnowledgeFile={handleEditKnowledgeFile}
              onSaveKnowledgeFile={handleSaveKnowledgeFile}
            />
          )}

          {tab === 'json' && (
            <JsonTab
              jsonText={jsonText}
              jsonError={jsonError}
              onSetJsonText={setJsonText}
              onSetJsonError={setJsonError}
              onApply={handleJsonSave}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          <div className="flex gap-2">
            {isEditing && (
              <Button
                variant="secondary"
                onClick={() => onDelete(config.id)}
                className="border-red-300 px-2 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
              >
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {isEditing && (
              <Button variant="secondary" onClick={() => onDuplicate(config.id)}>
                Duplicate
              </Button>
            )}
            {isEditing && (
              <Button variant="secondary" onClick={() => onExport(config.id)}>
                Export
              </Button>
            )}
            <div className="flex gap-2">
              {!isEditing && (
                <Button variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
              )}
              <Button variant="primary" onClick={handleSave} disabled={!config.name.trim()}>
                {isEditing ? 'Save' : 'Create'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
