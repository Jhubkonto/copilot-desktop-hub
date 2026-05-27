import { useRef, useState, useCallback, useEffect } from 'react'
import {
  X, Plus, Settings, Upload, MessageSquare, Search,
  Folder, FolderOpen, Pin, Trash2, Star, GripVertical, Cpu, FolderPlus, Check
} from 'lucide-react'
import { useAppStore, type Project, type AgentConfig, type Conversation, type ProjectAgent } from '../store/app-store'
import { ResizeHandle } from './ResizeHandle'
import { ProjectSettingsPanel } from './ProjectSettingsPanel'
import { DeleteProjectDialog } from './DeleteProjectDialog'
import { DeleteConversationDialog } from './DeleteConversationDialog'
import { formatRelativeTime } from '../../shared/utils'

type SectionType = 'projects' | 'agents' | 'chats'

const PANE_MIN = 220
const PANE_MAX = 680

// ─────────────────────────────────────────────────────────────────────────────
// Projects sub-pane
// ─────────────────────────────────────────────────────────────────────────────

const PROJECT_COLOR_MAP: Record<string, { bg: string; dot: string; ring: string }> = {
  blue:   { bg: 'bg-blue-50 dark:bg-blue-900/20',     dot: 'bg-blue-500',   ring: 'ring-blue-300 dark:ring-blue-700' },
  green:  { bg: 'bg-green-50 dark:bg-green-900/20',   dot: 'bg-green-500',  ring: 'ring-green-300 dark:ring-green-700' },
  red:    { bg: 'bg-red-50 dark:bg-red-900/20',       dot: 'bg-red-500',    ring: 'ring-red-300 dark:ring-red-700' },
  purple: { bg: 'bg-purple-50 dark:bg-purple-900/20', dot: 'bg-purple-500', ring: 'ring-purple-300 dark:ring-purple-700' },
  orange: { bg: 'bg-orange-50 dark:bg-orange-900/20', dot: 'bg-orange-500', ring: 'ring-orange-300 dark:ring-orange-700' },
  pink:   { bg: 'bg-pink-50 dark:bg-pink-900/20',     dot: 'bg-pink-500',   ring: 'ring-pink-300 dark:ring-pink-700' },
  yellow: { bg: 'bg-yellow-50 dark:bg-yellow-900/20', dot: 'bg-yellow-500', ring: 'ring-yellow-300 dark:ring-yellow-700' },
  gray:   { bg: 'bg-gray-50 dark:bg-gray-800',        dot: 'bg-gray-400',   ring: 'ring-gray-300 dark:ring-gray-700' },
}
const COLOR_OPTIONS = Object.keys(PROJECT_COLOR_MAP)

function ProjectsPane() {
  const projects = useAppStore((s) => s.projects)
  const conversations = useAppStore((s) => s.conversations)
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const projectAgents = useAppStore((s) => s.projectAgents)
  const projectConfigs = useAppStore((s) => s.projectConfigs)
  const pendingSettingsProjectId = useAppStore((s) => s.pendingSettingsProjectId)
  const showNewProjectForm = useAppStore((s) => s.showNewProjectForm)
  const selectProject = useAppStore((s) => s.selectProject)
  const createProject = useAppStore((s) => s.createProject)
  const updateProjectConfig = useAppStore((s) => s.updateProjectConfig)
  const renameProject = useAppStore((s) => s.renameProject)
  const deleteProject = useAppStore((s) => s.deleteProject)
  const loadProjectAgents = useAppStore((s) => s.loadProjectAgents)
  const loadProjectConfig = useAppStore((s) => s.loadProjectConfig)
  const clearPendingSettingsProject = useAppStore((s) => s.clearPendingSettingsProject)
  const setShowNewProjectForm = useAppStore((s) => s.setShowNewProjectForm)
  const addAgentToProject = useAppStore((s) => s.addAgentToProject)
  const removeAgentFromProject = useAppStore((s) => s.removeAgentFromProject)
  const setProjectPrimaryAgent = useAppStore((s) => s.setProjectPrimaryAgent)
  const reorderProjectAgents = useAppStore((s) => s.reorderProjectAgents)
  const updateProjectOrchestration = useAppStore((s) => s.updateProjectOrchestration)
  const agents = useAppStore((s) => s.agents)
  const addToast = useAppStore((s) => s.addToast)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null)
  const [draggingAgentId, setDraggingAgentId] = useState<string | null>(null)
  const [draggingInProjectId, setDraggingInProjectId] = useState<string | null>(null)
  const [expandedOrch, setExpandedOrch] = useState<Set<string>>(new Set())
  const [expandedSettings, setExpandedSettings] = useState<Set<string>>(new Set())
  const [pendingDeleteProject, setPendingDeleteProject] = useState<{ id: string; name: string } | null>(null)
  const [addingAgentToProjectId, setAddingAgentToProjectId] = useState<string | null>(null)
  const [agentPickerQuery, setAgentPickerQuery] = useState('')
  const agentPickerContainerRef = useRef<HTMLDivElement>(null)

  // Load agents and configs for all projects on mount
  useEffect(() => {
    projects.forEach((p) => {
      loadProjectAgents(p.id)
      loadProjectConfig(p.id)
    })
  }, [projects, loadProjectAgents, loadProjectConfig])

  // Auto-open settings panel for a newly created project
  useEffect(() => {
    if (!pendingSettingsProjectId) return
    setExpandedSettings((prev) => {
      const next = new Set(prev)
      next.add(pendingSettingsProjectId)
      return next
    })
    clearPendingSettingsProject()
  }, [pendingSettingsProjectId, clearPendingSettingsProject])

  const chatCountFor = (projectId: string) =>
    conversations.filter((c) => c.project_id === projectId).length

  useEffect(() => {
    if (!addingAgentToProjectId) return
    const handler = (e: MouseEvent) => {
      if (agentPickerContainerRef.current && !agentPickerContainerRef.current.contains(e.target as Node)) {
        setAddingAgentToProjectId(null)
        setAgentPickerQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [addingAgentToProjectId])

  const handlePickerAddAgent = async (projectId: string, agent: AgentConfig) => {
    const currentMembers = projectAgents[projectId] ?? []
    await addAgentToProject(projectId, agent.id)
    if (currentMembers.length === 0) {
      await setProjectPrimaryAgent(projectId, agent.id)
    }
    const projectName = projects.find((p) => p.id === projectId)?.name ?? 'project'
    addToast(`🤖 ${agent.name} added to ${projectName}`, 'success')
    setAddingAgentToProjectId(null)
    setAgentPickerQuery('')
  }

  const handleConfirmNewProject = async (name: string, color: string, config: Partial<import('../store/app-store').ProjectConfig>) => {
    await createProject(name, color)
    // The new project ID will be available via pendingSettingsProjectId after createProject resolves.
    // Also persist any config fields set during draft.
    const newProject = useAppStore.getState().projects.find((p) => p.name === name)
    if (newProject && Object.keys(config).some((k) => config[k as keyof typeof config] !== undefined)) {
      await updateProjectConfig(newProject.id, config)
    }
    setShowNewProjectForm(false)
  }

  const handleRename = async (id: string) => {
    const name = renameTitle.trim()
    if (name) await renameProject(id, name)
    setRenamingId(null)
  }

  // ── Drag handlers for member-list reordering ──
  const handleMemberDragStart = (e: React.DragEvent, projectId: string, agentId: string) => {
    e.dataTransfer.setData('member-agent-id', agentId)
    e.dataTransfer.setData('member-project-id', projectId)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingAgentId(agentId)
    setDraggingInProjectId(projectId)
  }

  const handleMemberDragEnd = () => {
    setDraggingAgentId(null)
    setDraggingInProjectId(null)
  }

  const handleMemberDrop = (e: React.DragEvent, targetProjectId: string, targetAgentId: string) => {
    e.preventDefault()
    e.stopPropagation()
    const srcAgentId = e.dataTransfer.getData('member-agent-id')
    const srcProjectId = e.dataTransfer.getData('member-project-id')
    if (!srcAgentId || srcProjectId !== targetProjectId || srcAgentId === targetAgentId) return

    const members = projectAgents[targetProjectId] ?? []
    const srcIdx = members.findIndex((a) => a.agentId === srcAgentId)
    const tgtIdx = members.findIndex((a) => a.agentId === targetAgentId)
    if (srcIdx === -1 || tgtIdx === -1) return

    const reordered = [...members]
    reordered.splice(srcIdx, 1)
    reordered.splice(tgtIdx, 0, members[srcIdx])
    reorderProjectAgents(targetProjectId, reordered.map((a) => a.agentId))
    setDraggingAgentId(null)
    setDraggingInProjectId(null)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-gray-800">
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {projects.length} project{projects.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={() => setShowNewProjectForm(true)}
          className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label="Create new project"
        >
          <Plus className="w-3.5 h-3.5" />
          New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {/* New project draft form */}
        {showNewProjectForm && (
          <div className="rounded-xl border border-blue-200 dark:border-blue-800 overflow-hidden">
            <div className="px-4 py-2.5 bg-blue-50 dark:bg-blue-900/20 flex items-center justify-between">
              <span className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wider">New Project</span>
              <button
                type="button"
                onClick={() => setShowNewProjectForm(false)}
                className="p-0.5 rounded text-blue-400 hover:text-blue-600 dark:hover:text-blue-300"
                aria-label="Cancel new project"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <ProjectSettingsPanel
              draft
              onClose={() => setShowNewProjectForm(false)}
              onConfirm={handleConfirmNewProject}
            />
          </div>
        )}

        {/* Project cards */}
        {projects.map((project) => {
          const colors = PROJECT_COLOR_MAP[project.color] ?? PROJECT_COLOR_MAP.blue
          const isActive = activeProjectId === project.id
          const count = chatCountFor(project.id)
          const isRenaming = renamingId === project.id
          const members: ProjectAgent[] = projectAgents[project.id] ?? []
          const isDragTarget = dragOverProjectId === project.id

          return (
            <div
              key={project.id}
              data-project-id={project.id}
              className={`group rounded-xl border transition-colors ${
                isActive
                  ? `${colors.bg} border-transparent ring-1 ${colors.ring}`
                  : isDragTarget
                    ? 'border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60'
              }`}
              onDragOver={(e) => {
                // Accept drags from AgentsPane grid ('agent-id') or Sidebar ('sidebar-agent-id')
                if (e.dataTransfer.types.includes('agent-id') || e.dataTransfer.types.includes('sidebar-agent-id')) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'copy'
                  setDragOverProjectId(project.id)
                }
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDragOverProjectId(null)
                }
              }}
              onDrop={async (e) => {
                const agentId = e.dataTransfer.getData('agent-id') || e.dataTransfer.getData('sidebar-agent-id')
                if (!agentId) return
                e.preventDefault()
                setDragOverProjectId(null)
                const agent = agents.find((a) => a.id === agentId)
                const alreadyMember = (projectAgents[project.id] ?? []).some((m) => m.agentId === agentId)
                if (alreadyMember) {
                  if (agent) addToast(`${agent.name} is already in ${project.name}`, 'info')
                  return
                }
                const currentMembers = projectAgents[project.id] ?? []
                await addAgentToProject(project.id, agentId)
                if (currentMembers.length === 0 && agent) {
                  await setProjectPrimaryAgent(project.id, agentId)
                }
                if (agent) addToast(`🤖 ${agent.name} added to ${project.name}`, 'success')
              }}
            >
              {/* Project header row */}
              <div
                className="flex items-start gap-3 px-4 py-3 cursor-pointer"
                onClick={() => !isRenaming && selectProject(project.id)}
              >
                {isActive
                  ? <FolderOpen className="w-5 h-5 text-gray-600 dark:text-gray-300 shrink-0 mt-0.5" />
                  : <Folder className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
                }
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${colors.dot}`} />
                    {isRenaming ? (
                      <input
                        autoFocus
                        value={renameTitle}
                        onChange={(e) => setRenameTitle(e.target.value)}
                        onBlur={() => handleRename(project.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRename(project.id)
                          if (e.key === 'Escape') setRenamingId(null)
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 text-sm bg-white dark:bg-gray-700 border border-blue-400 rounded px-1 py-0.5 focus:outline-none"
                      />
                    ) : (
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{project.name}</p>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 ml-4">
                    {count} chat{count !== 1 ? 's' : ''}
                  </p>
                </div>
                {/* Actions — visible on hover */}
                <div className="invisible group-hover:visible flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setExpandedSettings((prev) => {
                        const next = new Set(prev)
                        if (next.has(project.id)) next.delete(project.id)
                        else next.add(project.id)
                        return next
                      })
                    }}
                    className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
                    title="Project settings"
                    aria-label="Edit project settings"
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setPendingDeleteProject({ id: project.id, name: project.name }) }}
                    className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    title="Delete project"
                    aria-label="Delete project"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Agent team section */}
              <div className="px-4 pb-3 space-y-1" onClick={(e) => e.stopPropagation()}>
                <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">
                  Team agents
                </p>

                {/* No-primary notice */}
                {members.length > 0 && !members.some((m) => m.isPrimary) && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-2 py-1.5 mb-1">
                    No primary agent — drag one here or ★ to promote
                  </p>
                )}

                {members.map((member) => {
                  const isBeingDragged = draggingAgentId === member.agentId && draggingInProjectId === project.id
                  return (
                    <div
                      key={member.agentId}
                      draggable
                      data-agent-id={member.agentId}
                      onDragStart={(e) => handleMemberDragStart(e, project.id, member.agentId)}
                      onDragEnd={handleMemberDragEnd}
                      onDragOver={(e) => {
                        if (e.dataTransfer.types.includes('member-agent-id') || e.dataTransfer.getData('member-project-id') === project.id) {
                          e.preventDefault()
                          e.dataTransfer.dropEffect = 'move'
                        }
                      }}
                      onDrop={(e) => handleMemberDrop(e, project.id, member.agentId)}
                      className={`group/member flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors cursor-grab active:cursor-grabbing ${
                        isBeingDragged ? 'opacity-40' : ''
                      } ${
                        member.isPrimary
                          ? 'bg-yellow-50 dark:bg-yellow-900/20'
                          : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                      }`}
                    >
                      <GripVertical className="w-3 h-3 text-gray-300 dark:text-gray-600 shrink-0" />
                      <span className="text-base leading-none">{member.agentIcon}</span>
                      <span className={`flex-1 truncate ${member.isPrimary ? 'font-medium text-yellow-700 dark:text-yellow-400' : 'text-gray-700 dark:text-gray-300'}`}>
                        {member.agentName}
                      </span>
                      {member.isPrimary && (
                        <span className="text-[9px] bg-yellow-200 dark:bg-yellow-800 text-yellow-700 dark:text-yellow-300 px-1.5 py-0.5 rounded-full font-semibold shrink-0">
                          primary
                        </span>
                      )}
                      <div className="invisible group-hover/member:visible flex items-center gap-0.5">
                        {!member.isPrimary && (
                          <button
                            onClick={() => setProjectPrimaryAgent(project.id, member.agentId)}
                            className="p-0.5 rounded text-gray-400 hover:text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/20"
                            title="Set as primary agent"
                            aria-label={`Set ${member.agentName} as primary agent`}
                          >
                            <Star className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          onClick={() => removeAgentFromProject(project.id, member.agentId)}
                          className="p-0.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                          title="Remove agent from project"
                          aria-label={`Remove ${member.agentName} from project`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )
                })}

                {/* L.1 Inline agent picker */}
                <div ref={addingAgentToProjectId === project.id ? agentPickerContainerRef : null}>
                  {addingAgentToProjectId === project.id ? (
                    <div className="space-y-1">
                      <input
                        autoFocus
                        value={agentPickerQuery}
                        onChange={(e) => setAgentPickerQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') { setAddingAgentToProjectId(null); setAgentPickerQuery('') }
                        }}
                        placeholder="Search agents…"
                        aria-label="Search agents to add"
                        className="w-full text-xs bg-white dark:bg-gray-700 border border-blue-400 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                      <div className="max-h-36 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
                        {(() => {
                          const memberIds = new Set((projectAgents[project.id] ?? []).map((m) => m.agentId))
                          const filtered = agents.filter(
                            (a) => !memberIds.has(a.id) && a.name.toLowerCase().includes(agentPickerQuery.toLowerCase())
                          )
                          return filtered.length === 0 ? (
                            <p className="text-[10px] text-gray-400 dark:text-gray-500 px-3 py-2 italic">
                              {agents.length === 0 ? 'No agents configured' : 'All agents already added'}
                            </p>
                          ) : filtered.map((agent) => (
                            <button
                              key={agent.id}
                              type="button"
                              onClick={() => handlePickerAddAgent(project.id, agent)}
                              className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                              aria-label={`Add ${agent.name} to project`}
                            >
                              <span>{agent.icon}</span>
                              <span className="truncate">{agent.name}</span>
                            </button>
                          ))
                        })()}
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAddingAgentToProjectId(project.id)}
                      className="w-full flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                      aria-label="Add agent to project"
                    >
                      <Plus className="w-3 h-3" />
                      Add agent…
                    </button>
                  )}
                </div>

                {/* Drop zone (for drag from AgentsPane) */}
                <div
                  className={`flex items-center gap-2 rounded-lg border-2 border-dashed px-3 py-2 text-[10px] text-gray-400 dark:text-gray-500 transition-colors ${
                    isDragTarget
                      ? 'border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-500'
                      : 'border-gray-200 dark:border-gray-700'
                  }`}
                >
                  {isDragTarget ? '✦ Drop agent here' : '⇥ Or drag agents from sidebar…'}
                </div>

                {/* Orchestration settings — only shown if ≥2 agents */}
                {members.length >= 2 && (() => {
                  const cfg = projectConfigs[project.id] ?? { orchestrationEnabled: false, maxDelegationDepth: 5, showTeamActivity: true }
                  const isOrchExpanded = expandedOrch.has(project.id)
                  return (
                    <div className="mt-2">
                      <button
                        onClick={() => setExpandedOrch((prev) => {
                          const next = new Set(prev)
                          if (next.has(project.id)) next.delete(project.id)
                          else next.add(project.id)
                          return next
                        })}
                        className="w-full flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 py-1 transition-colors"
                      >
                        <Cpu className="w-3 h-3" />
                        <span>Orchestration</span>
                        {cfg.orchestrationEnabled && (
                          <span className="ml-1 px-1 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-[9px] font-semibold">ON</span>
                        )}
                      </button>
                      {isOrchExpanded && (
                        <div className="mt-1 pl-4 space-y-1.5 border-l-2 border-gray-100 dark:border-gray-700">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={cfg.orchestrationEnabled}
                              onChange={(e) => updateProjectOrchestration(project.id, { orchestrationEnabled: e.target.checked })}
                              className="w-3 h-3 rounded"
                            />
                            <span className="text-[10px] text-gray-600 dark:text-gray-400">Enable multi-agent orchestration</span>
                          </label>
                          {cfg.orchestrationEnabled && (
                            <>
                              <label className="flex items-center gap-2">
                                <span className="text-[10px] text-gray-500 dark:text-gray-500 w-20 shrink-0">Max depth</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={10}
                                  value={cfg.maxDelegationDepth}
                                  onChange={(e) => updateProjectOrchestration(project.id, { maxDelegationDepth: Number(e.target.value) })}
                                  className="w-12 text-[10px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                                />
                              </label>
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={cfg.showTeamActivity}
                                  onChange={(e) => updateProjectOrchestration(project.id, { showTeamActivity: e.target.checked })}
                                  className="w-3 h-3 rounded"
                                />
                                <span className="text-[10px] text-gray-600 dark:text-gray-400">Show team activity</span>
                              </label>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>

              {/* Project settings panel (inline expand) */}
              {expandedSettings.has(project.id) && (
                <ProjectSettingsPanel
                  projectId={project.id}
                  onClose={() => setExpandedSettings((prev) => { const next = new Set(prev); next.delete(project.id); return next })}
                />
              )}
            </div>
          )
        })}

        {projects.length === 0 && !showNewProjectForm && (
          <p className="text-center text-xs text-gray-400 dark:text-gray-500 pt-8 italic">
            No projects yet — create one to organise your chats
          </p>
        )}
      </div>

      {pendingDeleteProject && (
        <DeleteProjectDialog
          projectName={pendingDeleteProject.name}
          onConfirm={async () => {
            await deleteProject(pendingDeleteProject.id)
            setPendingDeleteProject(null)
          }}
          onCancel={() => setPendingDeleteProject(null)}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Agents sub-pane
// ─────────────────────────────────────────────────────────────────────────────

function AgentsPane() {
  const agents = useAppStore((s) => s.agents)
  const agentsLoading = useAppStore((s) => s.agentsLoading)
  const activeAgentId = useAppStore((s) => s.activeAgentId)
  const selectAgent = useAppStore((s) => s.selectAgent)
  const openEditAgent = useAppStore((s) => s.openEditAgent)
  const openCreateAgent = useAppStore((s) => s.openCreateAgent)
  const importAgent = useAppStore((s) => s.importAgent)
  const deleteAgent = useAppStore((s) => s.deleteAgent)
  const projects = useAppStore((s) => s.projects)
  const projectAgents = useAppStore((s) => s.projectAgents)
  const addAgentToProject = useAppStore((s) => s.addAgentToProject)
  const addToast = useAppStore((s) => s.addToast)

  const [addToProjectAgentId, setAddToProjectAgentId] = useState<string | null>(null)
  const addToProjectPopoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!addToProjectAgentId) return
    const handler = (e: MouseEvent) => {
      if (addToProjectPopoverRef.current && !addToProjectPopoverRef.current.contains(e.target as Node)) {
        setAddToProjectAgentId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [addToProjectAgentId])

  const handleAddToProject = async (projectId: string, agent: AgentConfig) => {
    await addAgentToProject(projectId, agent.id)
    const projectName = projects.find((p) => p.id === projectId)?.name ?? 'project'
    addToast(`🤖 ${agent.name} added to ${projectName}`, 'success')
    setAddToProjectAgentId(null)
  }

  if (agentsLoading) {
    return (
      <div className="p-4 grid grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-gray-800">
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {agents.length} agent{agents.length !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={importAgent}
            className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Import agent"
          >
            <Upload className="w-3.5 h-3.5" />
            Import
          </button>
          <button
            onClick={openCreateAgent}
            className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Create new agent"
          >
            <Plus className="w-3.5 h-3.5" />
            New
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {/* No Agent option */}
        <div
          onClick={() => selectAgent(null)}
          className={`group flex items-center gap-3 rounded-xl border px-4 py-3 mb-2 cursor-pointer transition-colors ${
            activeAgentId === null
              ? 'border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800'
              : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60'
          }`}
        >
          <MessageSquare className="w-5 h-5 text-gray-400 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">No Agent</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">Direct Copilot chat</p>
          </div>
        </div>

        {agents.length === 0 ? (
          <p className="text-center text-xs text-gray-400 dark:text-gray-500 pt-8 italic">
            No agents configured — create one to get started
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {agents.map((agent: AgentConfig) => {
              const isActive = activeAgentId === agent.id
              return (
                <div
                  key={agent.id}
                  data-agent-id={agent.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('agent-id', agent.id)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  onClick={() => selectAgent(agent.id)}
                  className={`group relative rounded-xl border p-3 cursor-grab active:cursor-grabbing transition-colors ${
                    isActive
                      ? 'border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800'
                      : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60'
                  }`}
                  title="Drag onto a project to add this agent to its team"
                >
                  <div className="text-2xl mb-2 leading-none">{agent.icon}</div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                    {agent.name}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">
                    {agent.model === 'default' ? 'Default model' : agent.model}
                  </p>
                  {/* Edit button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); openEditAgent(agent.id) }}
                    className="absolute top-2 right-2 invisible group-hover:visible p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
                    title="Edit agent"
                    aria-label={`Edit ${agent.name}`}
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </button>
                  {/* Add to project button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setAddToProjectAgentId(addToProjectAgentId === agent.id ? null : agent.id)
                    }}
                    className="absolute bottom-2 left-2 invisible group-hover:visible p-1 rounded text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                    title="Add to project"
                    aria-label={`Add ${agent.name} to project`}
                  >
                    <FolderPlus className="w-3.5 h-3.5" />
                  </button>
                  {/* Delete button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteAgent(agent.id) }}
                    className="absolute bottom-2 right-2 invisible group-hover:visible p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    title="Delete agent"
                    aria-label={`Delete ${agent.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  {/* L.2 Add-to-project popover */}
                  {addToProjectAgentId === agent.id && (
                    <div
                      ref={addToProjectPopoverRef}
                      className="absolute top-full left-0 mt-1 z-20 w-48 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl py-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <p className="px-3 py-1 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                        Add to project
                      </p>
                      {projects.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-gray-400 italic">No projects yet</p>
                      ) : projects.map((project) => {
                        const alreadyMember = (projectAgents[project.id] ?? []).some((m) => m.agentId === agent.id)
                        return (
                          <button
                            key={project.id}
                            type="button"
                            disabled={alreadyMember}
                            onClick={() => { if (!alreadyMember) handleAddToProject(project.id, agent) }}
                            className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
                              alreadyMember
                                ? 'text-gray-300 dark:text-gray-600 cursor-default'
                                : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                            }`}
                            aria-label={alreadyMember ? `${agent.name} already in ${project.name}` : `Add ${agent.name} to ${project.name}`}
                          >
                            {alreadyMember && <Check className="w-3 h-3 text-green-500 shrink-0" />}
                            <span className="truncate">{project.name}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Chats sub-pane
// ─────────────────────────────────────────────────────────────────────────────

function isPinned(c: Conversation) { return c.pinned === 1 }

function groupByDate(conversations: Conversation[]) {
  const now = Date.now()
  const todayStart = new Date().setHours(0, 0, 0, 0)
  const yesterdayStart = todayStart - 86400000
  const weekStart = todayStart - 7 * 86400000

  const groups: { label: string; items: Conversation[] }[] = []
  const add = (label: string, items: Conversation[]) => { if (items.length) groups.push({ label, items }) }
  add('Today',      conversations.filter((c) => c.updated_at >= todayStart))
  add('Yesterday',  conversations.filter((c) => c.updated_at >= yesterdayStart && c.updated_at < todayStart))
  add('This Week',  conversations.filter((c) => c.updated_at >= weekStart && c.updated_at < yesterdayStart))
  add('Older',      conversations.filter((c) => c.updated_at < weekStart))
  void now
  return groups
}

function ChatsPane() {
  const conversations = useAppStore((s) => s.conversations)
  const currentConversationId = useAppStore((s) => s.currentConversationId)
  const projects = useAppStore((s) => s.projects)
  const agents = useAppStore((s) => s.agents)
  const selectConversation = useAppStore((s) => s.selectConversation)
  const deleteConversation = useAppStore((s) => s.deleteConversation)
  const newChat = useAppStore((s) => s.newChat)
  const [query, setQuery] = useState('')
  const [pendingDeleteConv, setPendingDeleteConv] = useState<{ id: string; title: string } | null>(null)

  const filtered = query
    ? conversations.filter((c) => c.title.toLowerCase().includes(query.toLowerCase()))
    : conversations

  const pinned = filtered.filter(isPinned)
  const unpinned = filtered.filter((c) => !isPinned(c))
  const groups = groupByDate(unpinned)

  const renderConv = (conv: Conversation) => {
    const isActive = currentConversationId === conv.id
    const project = conv.project_id ? projects.find((p) => p.id === conv.project_id) : null
    const agent = conv.agent_id ? agents.find((a) => a.id === conv.agent_id) : null

    return (
      <div
        key={conv.id}
        onClick={() => selectConversation(conv.id)}
        className={`group flex items-start gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
          isActive
            ? 'bg-gray-200 dark:bg-gray-700'
            : 'hover:bg-gray-100 dark:hover:bg-gray-800'
        }`}
      >
        {isPinned(conv) && <Pin className="w-3 h-3 text-gray-400 shrink-0 mt-0.5" />}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">{conv.title}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {agent && (
              <span className="text-[10px] text-gray-400 dark:text-gray-500">
                {agent.icon} {agent.name}
              </span>
            )}
            {project && (
              <span className="text-[10px] text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-full">
                {project.name}
              </span>
            )}
              <span className="text-[10px] text-gray-400 dark:text-gray-500">
                {formatRelativeTime(conv.updated_at)}
              </span>
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setPendingDeleteConv({ id: conv.id, title: conv.title }) }}
          className="invisible group-hover:visible p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 shrink-0"
          title="Delete"
          aria-label="Delete conversation"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search + New */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
        <div className="flex-1 flex items-center gap-1.5 bg-gray-100 dark:bg-gray-800 rounded-lg px-2 py-1">
          <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats…"
            className="flex-1 text-xs bg-transparent focus:outline-none text-gray-700 dark:text-gray-200 placeholder-gray-400"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <button
          onClick={newChat}
          className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
          aria-label="New chat"
        >
          <Plus className="w-3.5 h-3.5" />
          New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        {filtered.length === 0 && (
          <p className="text-center text-xs text-gray-400 dark:text-gray-500 pt-8 italic">
            {query ? 'No matching conversations' : 'No conversations yet'}
          </p>
        )}

        {pinned.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-3 mb-1">
              Pinned
            </p>
            {pinned.map(renderConv)}
          </div>
        )}

        {groups.map(({ label, items }) => (
          <div key={label}>
            <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-3 mb-1">
              {label}
            </p>
            {items.map(renderConv)}
          </div>
        ))}
      </div>

      {pendingDeleteConv && (
        <DeleteConversationDialog
          conversationTitle={pendingDeleteConv.title}
          onConfirm={() => {
            deleteConversation(pendingDeleteConv.id)
            setPendingDeleteConv(null)
          }}
          onCancel={() => setPendingDeleteConv(null)}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SectionPane shell
// ─────────────────────────────────────────────────────────────────────────────

const SECTION_LABELS: Record<SectionType, string> = {
  projects: 'Projects',
  agents: 'Agents',
  chats: 'All Chats',
}

interface SectionPaneProps {
  section: SectionType
}

export function SectionPane({ section }: SectionPaneProps) {
  const setSectionPane = useAppStore((s) => s.setSectionPane)
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(320)

  const handleSetSize = useCallback((size: number) => {
    setWidth(Math.max(PANE_MIN, Math.min(PANE_MAX, size)))
  }, [])

  return (
    <div
      ref={containerRef}
      style={{ width }}
      className="relative flex flex-col min-h-0 shrink-0 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700"
      aria-label={`${SECTION_LABELS[section]} panel`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          {SECTION_LABELS[section]}
        </h2>
        <button
          onClick={() => setSectionPane(section)}
          className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label={`Close ${SECTION_LABELS[section]} panel`}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {section === 'projects' && <ProjectsPane />}
        {section === 'agents' && <AgentsPane />}
        {section === 'chats' && <ChatsPane />}
      </div>

      {/* Resize handle on the right edge */}
      <ResizeHandle
        direction="horizontal"
        containerRef={containerRef as React.RefObject<HTMLElement>}
        onSetSize={handleSetSize}
        align="end"
      />
    </div>
  )
}
