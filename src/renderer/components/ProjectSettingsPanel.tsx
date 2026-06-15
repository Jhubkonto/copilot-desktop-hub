import { useState, useEffect, useCallback, useRef } from 'react'
import { useAppStore } from '../store/app-store'
import type { Milestone, ProjectConfig, ScopeRule } from '../store/types'
import { DEFAULT_PROJECT_CONFIG } from '../store/types'
import { GeneralTab } from './project-settings/GeneralTab'
import { ScopeTab } from './project-settings/ScopeTab'
import { MilestonesTab } from './project-settings/MilestonesTab'
import { TeamTab } from './project-settings/TeamTab'
import { WikiTab } from './project-settings/WikiTab'
import { ArtifactsTab } from './project-settings/ArtifactsTab'

type TabId = 'general' | 'scope' | 'milestones' | 'team' | 'wiki' | 'artifacts'

interface EditProps {
  projectId: string
  draft?: false
  onClose: () => void
  onConfirm?: never
  initialTab?: TabId
  onMount?: () => void
  flashTeam?: boolean
}

interface DraftProps {
  projectId?: null
  draft: true
  onClose: () => void
  onConfirm: (name: string, color: string, config: Partial<ProjectConfig>) => Promise<void>
  initialTab?: TabId
}

type Props = EditProps | DraftProps

const VAR_KEY_REGEX = /^[A-Z0-9_]+$/

export function ProjectSettingsPanel(props: Props) {
  const { onClose } = props
  const isDraft = props.draft === true

  const projects = useAppStore((s) => s.projects)
  const projectConfigs = useAppStore((s) => s.projectConfigs)
  const renameProject = useAppStore((s) => s.renameProject)
  const updateProjectConfig = useAppStore((s) => s.updateProjectConfig)
  const projectAgents = useAppStore((s) => s.projectAgents)
  const loadProjectAgents = useAppStore((s) => s.loadProjectAgents)
  const agents = useAppStore((s) => s.agents)
  const addAgentToProject = useAppStore((s) => s.addAgentToProject)
  const removeAgentFromProject = useAppStore((s) => s.removeAgentFromProject)
  const setProjectPrimaryAgent = useAppStore((s) => s.setProjectPrimaryAgent)
  const reorderProjectAgents = useAppStore((s) => s.reorderProjectAgents)
  const updateProjectOrchestration = useAppStore((s) => s.updateProjectOrchestration)
  const loadProjectConfig = useAppStore((s) => s.loadProjectConfig)
  const addToast = useAppStore((s) => s.addToast)

  const projectId = isDraft ? null : (props as EditProps).projectId
  const project = projectId ? projects.find((p) => p.id === projectId) : null
  const cfg = projectId ? projectConfigs[projectId] : null

  const onMount = 'onMount' in props ? props.onMount : undefined
  const [activeTab, setActiveTab] = useState<TabId>(props.initialTab ?? 'general')
  const [name, setName] = useState(project?.name ?? '')
  const [color, setColor] = useState(project?.color ?? 'blue')
  const [instructions, setInstructions] = useState(cfg?.instructions ?? '')
  const [rootDirectory, setRootDirectory] = useState(cfg?.rootDirectory ?? '')
  const [instructionMode, setInstructionMode] = useState<ProjectConfig['instructionMode']>(cfg?.instructionMode ?? 'prepend')
  const [instructionsEnabled, setInstructionsEnabled] = useState(cfg?.instructionsEnabled ?? true)
  const [variables, setVariables] = useState<Array<{ key: string; value: string }>>(cfg?.variables ?? [])
  const [varErrors, setVarErrors] = useState<Record<number, string>>({})
  const [showModeDropdown, setShowModeDropdown] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [inScope, setInScope] = useState<ScopeRule[]>(cfg?.inScope ?? [])
  const [outOfScope, setOutOfScope] = useState<ScopeRule[]>(cfg?.outOfScope ?? [])
  const [milestones, setMilestones] = useState<Milestone[]>(cfg?.milestones ?? [])
  const [agentPickerQuery, setAgentPickerQuery] = useState('')
  const [showAgentPicker, setShowAgentPicker] = useState(false)
  const [teamDraggingId, setTeamDraggingId] = useState<string | null>(null)

  const flashTeam = !isDraft && 'flashTeam' in props ? props.flashTeam : false
  const [teamFlashOn, setTeamFlashOn] = useState(false)

  useEffect(() => {
    if (!flashTeam) return
    setTeamFlashOn(true)
    let on = true
    const interval = setInterval(() => {
      on = !on
      setTeamFlashOn(on)
    }, 350)
    const timeout = setTimeout(() => {
      clearInterval(interval)
      setTeamFlashOn(false)
    }, 2800)
    return () => { clearInterval(interval); clearTimeout(timeout) }
  }, [flashTeam])

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    onMount?.()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isDraft || !cfg) return
    setName(project?.name ?? '')
    setColor(project?.color ?? 'blue')
    setInstructions(cfg.instructions)
    setRootDirectory(cfg.rootDirectory)
    setInstructionMode(cfg.instructionMode)
    setInstructionsEnabled(cfg.instructionsEnabled)
    setVariables(cfg.variables)
    setInScope(cfg.inScope ?? [])
    setOutOfScope(cfg.outOfScope ?? [])
    setMilestones(cfg.milestones ?? [])
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isDraft && projectId) loadProjectAgents(projectId)
  }, [projectId, isDraft, loadProjectAgents])

  useEffect(() => {
    if (!isDraft && projectId) void loadProjectConfig(projectId)
  }, [projectId, isDraft, loadProjectConfig])

  const debounceSave = useCallback((partial: Partial<ProjectConfig>) => {
    if (isDraft || !projectId) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      updateProjectConfig(projectId, partial)
    }, 500)
  }, [isDraft, projectId, updateProjectConfig])

  // ── General tab handlers ──────────────────────────────────────────────────

  const handleNameBlur = async () => {
    if (isDraft || !projectId) return
    const trimmed = name.trim()
    if (trimmed && trimmed !== project?.name) {
      await renameProject(projectId, trimmed)
    }
  }

  const handleInstructionsChange = (val: string) => {
    setInstructions(val)
    debounceSave({ instructions: val })
  }

  const handleRootDirChange = (val: string) => {
    setRootDirectory(val)
    debounceSave({ rootDirectory: val })
  }

  const handleModeChange = (mode: ProjectConfig['instructionMode']) => {
    setInstructionMode(mode)
    setShowModeDropdown(false)
    if (!isDraft && projectId) updateProjectConfig(projectId, { instructionMode: mode })
  }

  const handleEnabledToggle = () => {
    const next = !instructionsEnabled
    setInstructionsEnabled(next)
    if (!isDraft && projectId) updateProjectConfig(projectId, { instructionsEnabled: next })
  }

  const handleBrowseDir = async () => {
    const result = await window.api.openDirectoryDialog()
    if (result && result.length > 0) {
      setRootDirectory(result[0])
      if (!isDraft && projectId) updateProjectConfig(projectId, { rootDirectory: result[0] })
    }
  }

  const handleAddVariable = () => {
    const next = [...variables, { key: '', value: '' }]
    setVariables(next)
    if (!isDraft && projectId) updateProjectConfig(projectId, { variables: next })
  }

  const handleRemoveVariable = (idx: number) => {
    const next = variables.filter((_, i) => i !== idx)
    setVariables(next)
    setVarErrors((prev) => { const e = { ...prev }; delete e[idx]; return e })
    if (!isDraft && projectId) updateProjectConfig(projectId, { variables: next })
  }

  const handleVarChange = (idx: number, field: 'key' | 'value', val: string) => {
    const next = variables.map((v, i) => i === idx ? { ...v, [field]: val } : v)
    setVariables(next)
    if (field === 'key') {
      const trimmed = val.trim()
      if (trimmed && !VAR_KEY_REGEX.test(trimmed)) {
        setVarErrors((prev) => ({ ...prev, [idx]: 'Key must be uppercase letters, digits, and underscores only' }))
      } else {
        setVarErrors((prev) => { const e = { ...prev }; delete e[idx]; return e })
        debounceSave({ variables: next })
      }
    } else {
      debounceSave({ variables: next })
    }
  }

  // ── Scope handlers ────────────────────────────────────────────────────────

  const mkId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

  const handleAddScopeRule = (type: 'inScope' | 'outOfScope') => {
    const newRule: ScopeRule = { id: mkId(), description: '' }
    if (type === 'inScope') {
      const next = [...inScope, newRule]
      setInScope(next)
      if (!isDraft && projectId) debounceSave({ inScope: next })
    } else {
      const next = [...outOfScope, newRule]
      setOutOfScope(next)
      if (!isDraft && projectId) debounceSave({ outOfScope: next })
    }
  }

  const handleRemoveScopeRule = (type: 'inScope' | 'outOfScope', id: string) => {
    if (type === 'inScope') {
      const next = inScope.filter((r) => r.id !== id)
      setInScope(next)
      if (!isDraft && projectId) debounceSave({ inScope: next })
    } else {
      const next = outOfScope.filter((r) => r.id !== id)
      setOutOfScope(next)
      if (!isDraft && projectId) debounceSave({ outOfScope: next })
    }
  }

  const handleScopeRuleChange = (type: 'inScope' | 'outOfScope', id: string, field: 'description' | 'pathGlob', val: string) => {
    const update = (rules: ScopeRule[]) => rules.map((r) => r.id === id ? { ...r, [field]: val || undefined } : r)
    if (type === 'inScope') {
      const next = update(inScope)
      setInScope(next)
      if (!isDraft && projectId) debounceSave({ inScope: next })
    } else {
      const next = update(outOfScope)
      setOutOfScope(next)
      if (!isDraft && projectId) debounceSave({ outOfScope: next })
    }
  }

  // ── Milestone handlers ────────────────────────────────────────────────────

  const handleAddMilestone = () => {
    const newMilestone: Milestone = { id: mkId(), title: '', status: 'upcoming' }
    const next = [...milestones, newMilestone]
    setMilestones(next)
    if (!isDraft && projectId) debounceSave({ milestones: next })
  }

  const handleRemoveMilestone = (id: string) => {
    const next = milestones.filter((m) => m.id !== id)
    setMilestones(next)
    if (!isDraft && projectId) debounceSave({ milestones: next })
  }

  const handleMilestoneChange = (id: string, field: 'title' | 'description', val: string) => {
    const next = milestones.map((m) => m.id === id ? { ...m, [field]: val } : m)
    setMilestones(next)
    if (!isDraft && projectId) debounceSave({ milestones: next })
  }

  const handleMilestoneStatus = (id: string, status: Milestone['status']) => {
    let next = milestones.map((m) => {
      if (m.id !== id) return m
      return { ...m, status, completedAt: status === 'completed' ? Date.now() : undefined }
    })
    if (status === 'active') {
      next = next.map((m) => m.id === id ? m : m.status === 'active' ? { ...m, status: 'upcoming' as const } : m)
    }
    setMilestones(next)
    if (!isDraft && projectId) debounceSave({ milestones: next })
  }

  // ── Team handlers ─────────────────────────────────────────────────────────

  const handleAddAgent = async (agentId: string) => {
    if (!projectId) return
    const currentMembers = projectAgents[projectId] ?? []
    const agent = agents.find((a) => a.id === agentId)
    await addAgentToProject(projectId, agentId)
    if (currentMembers.length === 0) await setProjectPrimaryAgent(projectId, agentId)
    if (agent) addToast(`🤖 ${agent.name} added to project`, 'success')
  }

  // ── Draft confirm ─────────────────────────────────────────────────────────

  const handleConfirm = async () => {
    if (!isDraft) return
    const trimmedName = name.trim()
    if (!trimmedName) return
    setIsSubmitting(true)
    try {
      await (props as DraftProps).onConfirm(trimmedName, color, {
        instructions,
        rootDirectory,
        instructionMode,
        instructionsEnabled,
        variables,
        inScope,
        outOfScope,
        milestones,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const hasVarErrors = Object.keys(varErrors).length > 0
  const activeMilestone = milestones.find((m) => m.status === 'active')
  const upcomingMilestones = milestones.filter((m) => m.status === 'upcoming')
  const completedMilestones = milestones.filter((m) => m.status === 'completed')
  const members = projectId ? (projectAgents[projectId] ?? []) : []
  const projectConfig = (projectId ? projectConfigs[projectId] : null) ?? DEFAULT_PROJECT_CONFIG

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-800/50 rounded-b-xl border-t border-gray-200 dark:border-gray-700">

      {/* Tab bar */}
      <div className="flex gap-0.5 px-3 pt-2 pb-0 flex-wrap" role="tablist">
        {(['general', 'scope', 'milestones', ...(!isDraft ? ['team', 'wiki', 'artifacts'] : [])] as TabId[]).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={`text-[11px] px-2.5 py-1 rounded-md font-medium transition-colors ${
              activeTab === tab
                ? 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 shadow-sm'
                : tab === 'team' && teamFlashOn
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {tab === 'general'
              ? 'General'
              : tab === 'scope'
                ? 'Scope'
                : tab === 'team'
                  ? 'Team'
                  : tab === 'wiki'
                    ? 'Wiki'
                    : tab === 'artifacts'
                      ? 'Artifacts'
                      : `Milestones${activeMilestone ? ' 🎯' : ''}`}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 pt-2 space-y-4">

        {activeTab === 'general' && (
          <GeneralTab
            isDraft={isDraft}
            name={name}
            color={color}
            rootDirectory={rootDirectory}
            instructions={instructions}
            instructionMode={instructionMode}
            instructionsEnabled={instructionsEnabled}
            variables={variables}
            varErrors={varErrors}
            showModeDropdown={showModeDropdown}
            hasVarErrors={hasVarErrors}
            onSetName={setName}
            onSetColor={setColor}
            onNameBlur={handleNameBlur}
            onConfirm={isDraft ? handleConfirm : undefined}
            onInstructionsChange={handleInstructionsChange}
            onRootDirChange={handleRootDirChange}
            onModeChange={handleModeChange}
            onEnabledToggle={handleEnabledToggle}
            onBrowseDir={handleBrowseDir}
            onSetShowModeDropdown={setShowModeDropdown}
            onAddVariable={handleAddVariable}
            onRemoveVariable={handleRemoveVariable}
            onVarChange={handleVarChange}
          />
        )}

        {activeTab === 'scope' && (
          <ScopeTab
            inScope={inScope}
            outOfScope={outOfScope}
            onAddScopeRule={handleAddScopeRule}
            onRemoveScopeRule={handleRemoveScopeRule}
            onScopeRuleChange={handleScopeRuleChange}
          />
        )}

        {activeTab === 'milestones' && (
          <MilestonesTab
            milestones={milestones}
            activeMilestone={activeMilestone}
            upcomingMilestones={upcomingMilestones}
            completedMilestones={completedMilestones}
            onAddMilestone={handleAddMilestone}
            onRemoveMilestone={handleRemoveMilestone}
            onMilestoneChange={handleMilestoneChange}
            onMilestoneStatus={handleMilestoneStatus}
          />
        )}

        {activeTab === 'wiki' && !isDraft && projectId && (
          <WikiTab projectId={projectId} />
        )}

        {activeTab === 'artifacts' && !isDraft && projectId && (
          <ArtifactsTab projectId={projectId} />
        )}

        {activeTab === 'team' && !isDraft && projectId && (
          <TeamTab
            projectId={projectId}
            agents={agents}
            members={members}
            projectConfig={projectConfig}
            agentPickerQuery={agentPickerQuery}
            showAgentPicker={showAgentPicker}
            teamDraggingId={teamDraggingId}
            onSetAgentPickerQuery={setAgentPickerQuery}
            onSetShowAgentPicker={setShowAgentPicker}
            onSetTeamDraggingId={setTeamDraggingId}
            onAddAgent={handleAddAgent}
            onRemoveAgent={(agentId) => removeAgentFromProject(projectId, agentId)}
            onSetPrimaryAgent={(agentId) => setProjectPrimaryAgent(projectId, agentId)}
            onReorderAgents={(orderedIds) => reorderProjectAgents(projectId, orderedIds)}
            onUpdateOrchestration={(partial) => updateProjectOrchestration(projectId, partial)}
          />
        )}
      </div>

      {/* Draft mode: Create / Cancel buttons */}
      {isDraft && (
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!name.trim() || hasVarErrors || isSubmitting}
            className="text-xs px-4 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            aria-label="Create project"
          >
            {isSubmitting ? 'Creating…' : 'Create project'}
          </button>
        </div>
      )}
    </div>
  )
}
