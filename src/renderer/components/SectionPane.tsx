import { useRef, useState, useCallback, useEffect } from 'react'
import {
  X, Plus, Settings, Upload, MessageSquare, Search,
  Folder, FolderOpen, Pin, Trash2, FolderPlus, Check, ArrowLeft
} from 'lucide-react'
import { useAppStore } from '../store/app-store'
import type { Conversation, Project, ProjectAgent } from '../store/types'
import type { AgentConfig } from '../../shared/types'
import { ResizeHandle } from './ResizeHandle'
import { DeleteProjectDialog } from './DeleteProjectDialog'
import { DeleteConversationDialog } from './DeleteConversationDialog'
import { formatRelativeTime } from '../../shared/utils'

type SectionType = 'projects' | 'agents' | 'chats'

const PANE_MIN = 220
const PANE_MAX = 500

// ─────────────────────────────────────────────────────────────────────────────
// AgentAvatarStack helper
// ─────────────────────────────────────────────────────────────────────────────

function AgentAvatarStack({ members }: { members: ProjectAgent[] }) {
  if (members.length === 0) return null
  const visible = members.slice(0, 3)
  const overflow = members.length - visible.length
  return (
    <div className="flex items-center -space-x-1 shrink-0">
      {visible.map((m) => (
        <span
          key={m.agentId}
          className="w-5 h-5 rounded-full bg-gray-100 dark:bg-gray-700 border border-white dark:border-gray-800 flex items-center justify-center text-[10px] leading-none"
          title={m.agentName}
        >
          {m.agentIcon}
        </span>
      ))}
      {overflow > 0 && (
        <span className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-600 border border-white dark:border-gray-800 flex items-center justify-center text-[9px] font-medium text-gray-500 dark:text-gray-400 leading-none">
          +{overflow}
        </span>
      )}
    </div>
  )
}

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
  const pendingSettingsProjectId = useAppStore((s) => s.pendingSettingsProjectId)
  const selectProject = useAppStore((s) => s.selectProject)
  const renameProject = useAppStore((s) => s.renameProject)
  const deleteProject = useAppStore((s) => s.deleteProject)
  const loadProjectAgents = useAppStore((s) => s.loadProjectAgents)
  const loadProjectConfig = useAppStore((s) => s.loadProjectConfig)
  const clearPendingSettingsProject = useAppStore((s) => s.clearPendingSettingsProject)
  const setShowNewProjectForm = useAppStore((s) => s.setShowNewProjectForm)
  const openEditProject = useAppStore((s) => s.openEditProject)
  const addAgentToProject = useAppStore((s) => s.addAgentToProject)
  const setProjectPrimaryAgent = useAppStore((s) => s.setProjectPrimaryAgent)
  const agents = useAppStore((s) => s.agents)
  const addToast = useAppStore((s) => s.addToast)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null)
  const [pendingDeleteProject, setPendingDeleteProject] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    projects.forEach((p) => {
      loadProjectAgents(p.id)
      loadProjectConfig(p.id)
    })
  }, [projects, loadProjectAgents, loadProjectConfig])

  useEffect(() => {
    if (!pendingSettingsProjectId) return
    openEditProject(pendingSettingsProjectId)
    clearPendingSettingsProject()
  }, [pendingSettingsProjectId, openEditProject, clearPendingSettingsProject])

  const chatCountFor = (projectId: string) =>
    conversations.filter((c) => c.project_id === projectId).length

  const handleRename = async (id: string) => {
    const name = renameTitle.trim()
    if (name) await renameProject(id, name)
    setRenamingId(null)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 h-9 border-b border-gray-100 dark:border-gray-800">
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

      <div className="flex-1 overflow-y-auto mr-1.5 p-2 space-y-0.5">
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
              className={`group relative flex items-center gap-2 rounded-lg cursor-pointer overflow-hidden transition-colors ${
                isActive
                  ? `${colors.bg} ring-1 ${colors.ring}`
                  : isDragTarget
                    ? 'bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-300 dark:ring-blue-600'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
              }`}
              onDragOver={(e) => {
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
              onClick={() => !isRenaming && selectProject(project.id)}
            >
              {/* Left color accent bar */}
              <div className={`w-1 self-stretch shrink-0 ${colors.dot}`} />

              {/* Folder icon */}
              {isActive
                ? <FolderOpen className="w-3.5 h-3.5 text-gray-500 dark:text-gray-300 shrink-0" />
                : <Folder className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              }

              {/* Project name + subtitle */}
              <div className="flex-1 min-w-0 py-2">
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
                    className="w-full text-xs bg-white dark:bg-gray-700 border border-blue-400 rounded px-1 py-0.5 focus:outline-none"
                  />
                ) : (
                  <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">{project.name}</p>
                )}
                <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                  {members.length === 0 ? 'No agents' : `${members.length} agent${members.length !== 1 ? 's' : ''}`}
                  {' · '}
                  {count === 0 ? 'No chats' : `${count} chat${count !== 1 ? 's' : ''}`}
                </p>
              </div>

              {/* Agent avatar stack */}
              <AgentAvatarStack members={members} />

              {/* Hover actions */}
              <div className="invisible group-hover:visible flex items-center gap-0.5 pr-2 shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    openEditProject(project.id)
                  }}
                  className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
                  title="Project settings"
                  aria-label="Edit project settings"
                >
                  <Settings className="w-3 h-3" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setPendingDeleteProject({ id: project.id, name: project.name }) }}
                  className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                  title="Delete project"
                  aria-label="Delete project"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          )
        })}

        {projects.length === 0 && (
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
  const setHistoryAgentId = useAppStore((s) => s.setHistoryAgentId)
  const openEditAgent = useAppStore((s) => s.openEditAgent)
  const openCreateAgent = useAppStore((s) => s.openCreateAgent)
  const importAgent = useAppStore((s) => s.importAgent)
  const deleteAgent = useAppStore((s) => s.deleteAgent)
  const selectAgent = useAppStore((s) => s.selectAgent)
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
      <div className="p-2 space-y-0.5">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-9 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 h-9 border-b border-gray-100 dark:border-gray-800">
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

      <div className="flex-1 overflow-y-auto mr-1.5 p-2 space-y-0.5">
        {/* No Agent option */}
        <div
          onClick={() => selectAgent(null)}
          className={`flex items-center gap-2 rounded-lg px-2 py-2 cursor-pointer transition-colors ${
            activeAgentId === null
              ? 'bg-gray-100 dark:bg-gray-800'
              : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-200">No Agent</p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500">Direct Copilot chat</p>
          </div>
        </div>

        {agents.length === 0 ? (
          <p className="text-center text-xs text-gray-400 dark:text-gray-500 pt-8 italic">
            No agents configured — create one to get started
          </p>
        ) : agents.map((agent: AgentConfig) => {
          const isActive = activeAgentId === agent.id
          const isPopoverOpen = addToProjectAgentId === agent.id
          return (
            <div key={agent.id} className="relative">
              <div
                data-agent-id={agent.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('agent-id', agent.id)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => setHistoryAgentId(agent.id)}
                className={`group flex items-center gap-2 rounded-lg px-2 py-2 cursor-grab active:cursor-grabbing transition-colors ${
                  isActive
                    ? 'bg-gray-100 dark:bg-gray-800'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
                }`}
                title="Drag onto a project to add this agent to its team"
              >
                <span className="text-base leading-none shrink-0">{agent.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">{agent.name}</p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                    uses your model setting
                  </p>
                </div>
                {/* Hover actions */}
                <div className={`flex items-center gap-0.5 shrink-0 ${isPopoverOpen ? 'visible' : 'invisible group-hover:visible'}`}>
                  <button
                    onClick={(e) => { e.stopPropagation(); openEditAgent(agent.id) }}
                    className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
                    title="Edit agent"
                    aria-label={`Edit ${agent.name}`}
                  >
                    <Settings className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setAddToProjectAgentId(isPopoverOpen ? null : agent.id)
                    }}
                    className="p-1 rounded text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                    title="Add to project"
                    aria-label={`Add ${agent.name} to project`}
                  >
                    <FolderPlus className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteAgent(agent.id) }}
                    className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    title="Delete agent"
                    aria-label={`Delete ${agent.name}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
              {/* Add-to-project popover */}
              {isPopoverOpen && (
                <div
                  ref={addToProjectPopoverRef}
                  className="absolute right-0 top-full mt-1 z-20 w-48 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl py-1"
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
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent history sub-pane
// ─────────────────────────────────────────────────────────────────────────────

function AgentHistoryPane() {
  const conversations = useAppStore((s) => s.conversations)
  const currentConversationId = useAppStore((s) => s.currentConversationId)
  const historyAgentId = useAppStore((s) => s.historyAgentId)
  const agents = useAppStore((s) => s.agents)
  const projects = useAppStore((s) => s.projects)
  const selectConversation = useAppStore((s) => s.selectConversation)
  const deleteConversation = useAppStore((s) => s.deleteConversation)
  const newChat = useAppStore((s) => s.newChat)
  const unreadConversationIds = useAppStore((s) => s.unreadConversationIds)
  const [query, setQuery] = useState('')
  const [pendingDeleteConv, setPendingDeleteConv] = useState<{ id: string; title: string } | null>(null)

  const agent = historyAgentId ? agents.find((a) => a.id === historyAgentId) : null

  const filtered = conversations
    .filter((c) => c.agent_id === historyAgentId)
    .filter((c) =>
      query
        ? c.title.toLowerCase().includes(query.toLowerCase()) ||
          (c.project_id ? (projects.find((p) => p.id === c.project_id)?.name ?? '').toLowerCase().includes(query.toLowerCase()) : false)
        : true
    )

  const pinned = filtered.filter(isPinned)
  const unpinned = filtered.filter((c) => !isPinned(c))
  const groups = groupByDate(unpinned)

  const renderConv = (conv: Conversation) => {
    const isActive = currentConversationId === conv.id
    const project = conv.project_id ? projects.find((p) => p.id === conv.project_id) : null
    const isUnread = unreadConversationIds.includes(conv.id)
    return (
      <div
        key={conv.id}
        onClick={() => selectConversation(conv.id)}
        className={`group flex items-start gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
          isActive ? 'bg-gray-200 dark:bg-gray-700' : 'hover:bg-gray-100 dark:hover:bg-gray-800'
        }`}
      >
        {isPinned(conv) && <Pin className="w-3 h-3 text-gray-400 shrink-0 mt-0.5" />}
        {isUnread && <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shrink-0 mt-1.5" />}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">{conv.title}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[10px] text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-full">
              {project ? project.name : 'No project'}
            </span>
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
      <div className="flex items-center gap-2 px-3 h-9 border-b border-gray-100 dark:border-gray-800">
        <div className="flex-1 flex items-center gap-1.5 bg-gray-100 dark:bg-gray-800 rounded-lg px-2 py-0.5">
          <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats…"
            className="flex-1 text-xs bg-transparent focus:outline-none text-gray-700 dark:text-gray-200 placeholder-gray-400"
            aria-label="Search agent chats"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <button
          onClick={() => newChat({ agentId: historyAgentId ?? undefined })}
          className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
          aria-label="New chat with this agent"
        >
          <Plus className="w-3.5 h-3.5" />
          New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto mr-1.5 p-2 space-y-4">
        {filtered.length === 0 && (
          <p className="text-center text-xs text-gray-400 dark:text-gray-500 pt-8 italic">
            {query ? 'No matching conversations' : `No chats with ${agent?.name ?? 'this agent'} yet`}
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
  const unreadConversationIds = useAppStore((s) => s.unreadConversationIds)
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
    const isUnread = unreadConversationIds.includes(conv.id)

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
        {isUnread && <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shrink-0 mt-1.5" />}
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
      <div className="flex items-center gap-2 px-3 h-9 border-b border-gray-100 dark:border-gray-800">
        <div className="flex-1 flex items-center gap-1.5 bg-gray-100 dark:bg-gray-800 rounded-lg px-2 py-0.5">
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
          onClick={() => newChat()}
          className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
          aria-label="New chat"
        >
          <Plus className="w-3.5 h-3.5" />
          New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto mr-1.5 p-2 space-y-4">
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
// Project history sub-pane
// ─────────────────────────────────────────────────────────────────────────────

function ProjectHistoryPane() {
  const conversations = useAppStore((s) => s.conversations)
  const currentConversationId = useAppStore((s) => s.currentConversationId)
  const historyProjectId = useAppStore((s) => s.historyProjectId)
  const agents = useAppStore((s) => s.agents)
  const selectConversation = useAppStore((s) => s.selectConversation)
  const deleteConversation = useAppStore((s) => s.deleteConversation)
  const newChat = useAppStore((s) => s.newChat)
  const unreadConversationIds = useAppStore((s) => s.unreadConversationIds)
  const [query, setQuery] = useState('')
  const [pendingDeleteConv, setPendingDeleteConv] = useState<{ id: string; title: string } | null>(null)

  const filtered = conversations
    .filter((c) =>
      historyProjectId === '__none__' ? !c.project_id : c.project_id === historyProjectId
    )
    .filter((c) =>
      query ? c.title.toLowerCase().includes(query.toLowerCase()) : true
    )

  const pinned = filtered.filter(isPinned)
  const unpinned = filtered.filter((c) => !isPinned(c))
  const groups = groupByDate(unpinned)

  const renderConv = (conv: Conversation) => {
    const isActive = currentConversationId === conv.id
    const agent = conv.agent_id ? agents.find((a) => a.id === conv.agent_id) : null
    const isUnread = unreadConversationIds.includes(conv.id)
    return (
      <div
        key={conv.id}
        onClick={() => selectConversation(conv.id)}
        className={`group flex items-start gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
          isActive ? 'bg-gray-200 dark:bg-gray-700' : 'hover:bg-gray-100 dark:hover:bg-gray-800'
        }`}
      >
        {isPinned(conv) && <Pin className="w-3 h-3 text-gray-400 shrink-0 mt-0.5" />}
        {isUnread && <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shrink-0 mt-1.5" />}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">{conv.title}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {agent && (
              <span className="text-[10px] text-gray-400 dark:text-gray-500">
                {agent.icon} {agent.name}
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
      {/* Search + New Chat */}
      <div className="flex items-center gap-2 px-3 h-9 border-b border-gray-100 dark:border-gray-800">
        <div className="flex-1 flex items-center gap-1.5 bg-gray-100 dark:bg-gray-800 rounded-lg px-2 py-0.5">
          <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats…"
            className="flex-1 text-xs bg-transparent focus:outline-none text-gray-700 dark:text-gray-200 placeholder-gray-400"
            aria-label="Search project chats"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <button
          onClick={() => newChat({ projectId: historyProjectId === '__none__' ? null : historyProjectId })}
          className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
          aria-label="New chat"
        >
          <Plus className="w-3.5 h-3.5" />
          New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto mr-1.5 p-2 space-y-4">
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
  const setHistoryProjectId = useAppStore((s) => s.setHistoryProjectId)
  const historyProjectId = useAppStore((s) => s.historyProjectId)
  const historyAgentId = useAppStore((s) => s.historyAgentId)
  const setHistoryAgentId = useAppStore((s) => s.setHistoryAgentId)
  const projects = useAppStore((s) => s.projects)
  const agents = useAppStore((s) => s.agents)
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(320)

  const getMaxSize = useCallback(() => Math.min(PANE_MAX, Math.floor(window.innerWidth * 0.32)), [])

  const handleSetSize = useCallback((size: number) => {
    setWidth(Math.max(PANE_MIN, Math.min(getMaxSize(), size)))
  }, [getMaxSize])

  const showingProjectHistory = section === 'projects' && historyProjectId !== null
  const historyProjectName = historyProjectId === '__none__'
    ? 'No project'
    : projects.find((p) => p.id === historyProjectId)?.name ?? 'Project'

  const showingAgentHistory = section === 'agents' && historyAgentId !== null
  const historyAgent = historyAgentId ? agents.find((a) => a.id === historyAgentId) : null
  const historyAgentName = historyAgent ? `${historyAgent.icon} ${historyAgent.name}` : 'Agent'

  const headerTitle = showingProjectHistory
    ? historyProjectName
    : showingAgentHistory
      ? historyAgentName
      : SECTION_LABELS[section]

  return (
    <div
      ref={containerRef}
      style={{ width }}
      className="relative flex flex-col min-h-0 shrink-0 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700"
      aria-label={`${SECTION_LABELS[section]} panel`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-9 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {showingProjectHistory && (
            <button
              onClick={() => setHistoryProjectId(null)}
              className="p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0"
              aria-label="Back to projects"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          {showingAgentHistory && (
            <button
              onClick={() => setHistoryAgentId(null)}
              className="p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0"
              aria-label="Back to agents"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
            {headerTitle}
          </h2>
        </div>
        <button
          onClick={() => setSectionPane(section)}
          className="p-0.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label={`Close ${SECTION_LABELS[section]} panel`}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {section === 'projects' && !showingProjectHistory && <ProjectsPane />}
        {section === 'projects' && showingProjectHistory && <ProjectHistoryPane />}
        {section === 'agents' && !showingAgentHistory && <AgentsPane />}
        {section === 'agents' && showingAgentHistory && <AgentHistoryPane />}
        {section === 'chats' && <ChatsPane />}
      </div>

      {/* Resize handle on the right edge */}
      <ResizeHandle
        direction="horizontal"
        containerRef={containerRef as React.RefObject<HTMLElement>}
        onSetSize={handleSetSize}
        align="end"
        minSize={PANE_MIN}
        maxSize={getMaxSize}
      />
    </div>
  )
}
