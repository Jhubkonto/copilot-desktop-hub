import { useEffect, useState } from 'react'
import { Plus, Settings, Folder, FolderOpen, Trash2 } from 'lucide-react'
import { useAppStore } from '../../store/app-store'
import type { ProjectAgent } from '../../store/types'
import { DeleteProjectDialog } from '../DeleteProjectDialog'
import { PROJECT_COLOR_MAP, AgentAvatarStack } from './shared'

export function ProjectsPane() {
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
  const setShowProjectGenerator = useAppStore((s) => s.setShowProjectGenerator)
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
      <div className="flex items-center justify-between px-4 h-9 border-b border-gray-100 dark:border-gray-800">
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {projects.length} project{projects.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={() => setShowProjectGenerator(true)}
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
              <div className={`w-1 self-stretch shrink-0 ${colors.dot}`} />

              {isActive
                ? <FolderOpen className="w-3.5 h-3.5 text-gray-500 dark:text-gray-300 shrink-0" />
                : <Folder className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              }

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

              <AgentAvatarStack members={members} />

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
