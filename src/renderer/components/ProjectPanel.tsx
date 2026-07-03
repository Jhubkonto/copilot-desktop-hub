import { useRef, useState, useCallback } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '../store/app-store'
import type { ProjectConfig } from '../store/types'
import { ResizeHandle } from './ResizeHandle'
import { ProjectSettingsPanel, type DraftTeamSelection } from './ProjectSettingsPanel'
import { DeleteProjectDialog } from './DeleteProjectDialog'

const PANEL_MIN = 360
const PANEL_MAX = 700

export function ProjectPanel() {
  const panelRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(480)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const showNewProjectForm = useAppStore((s) => s.showNewProjectForm)
  const editingProjectId = useAppStore((s) => s.editingProjectId)
  const projects = useAppStore((s) => s.projects)
  const createProject = useAppStore((s) => s.createProject)
  const updateProjectConfig = useAppStore((s) => s.updateProjectConfig)
  const addAgentToProject = useAppStore((s) => s.addAgentToProject)
  const setProjectPrimaryAgent = useAppStore((s) => s.setProjectPrimaryAgent)
  const deleteProject = useAppStore((s) => s.deleteProject)
  const duplicateProject = useAppStore((s) => s.duplicateProject)
  const exportProject = useAppStore((s) => s.exportProject)
  const setShowNewProjectForm = useAppStore((s) => s.setShowNewProjectForm)
  const closeEditProject = useAppStore((s) => s.closeEditProject)
  const addToast = useAppStore((s) => s.addToast)
  const newlyCreatedProjectId = useAppStore((s) => s.newlyCreatedProjectId)
  const clearNewlyCreatedProjectId = useAppStore((s) => s.clearNewlyCreatedProjectId)
  const pendingCodeChangesProjectId = useAppStore((s) => s.pendingCodeChangesProjectId)
  const setPendingCodeChangesProjectId = useAppStore((s) => s.setPendingCodeChangesProjectId)

  const handleSetSize = useCallback((size: number) => {
    setWidth(Math.max(PANEL_MIN, Math.min(PANEL_MAX, size)))
  }, [])

  const handleClose = () => {
    if (showNewProjectForm) {
      setShowNewProjectForm(false)
    } else {
      closeEditProject()
    }
  }

  const handleConfirm = async (name: string, color: string, config: Partial<ProjectConfig>, team: DraftTeamSelection) => {
    try {
      await createProject(name, color)
      const newProject = useAppStore.getState().projects.find((p) => p.name === name)
      if (newProject && Object.keys(config).some((k) => config[k as keyof typeof config] !== undefined)) {
        await updateProjectConfig(newProject.id, config)
      }
      if (newProject) {
        for (const agentId of team.agentIds) {
          await addAgentToProject(newProject.id, agentId)
        }
        if (team.primaryAgentId) {
          await setProjectPrimaryAgent(newProject.id, team.primaryAgentId)
        }
      }
      setShowNewProjectForm(false)
    } catch {
      addToast('Failed to create project', 'error')
    }
  }

  const handleDelete = async () => {
    if (!editingProjectId) return
    await deleteProject(editingProjectId)
    closeEditProject()
    setShowDeleteConfirm(false)
  }

  const editingProject = editingProjectId ? projects.find((p) => p.id === editingProjectId) : null
  const title = showNewProjectForm ? 'New Project' : `Project Settings${editingProject ? `: ${editingProject.name}` : ''}`
  const ariaLabel = showNewProjectForm ? 'Create new project' : 'Edit project settings'

  return (
    <div
      className="fixed inset-0 top-9 z-40 flex"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div className="flex-1 bg-black/20" onClick={handleClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="relative bg-white dark:bg-gray-900 shadow-xl flex flex-col border-l border-gray-200 dark:border-gray-700"
        style={{ width }}
      >
        <ResizeHandle
          direction="horizontal"
          align="start"
          containerRef={panelRef}
          onSetSize={handleSetSize}
          minSize={PANEL_MIN}
          maxSize={PANEL_MAX}
        />

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h2 className="text-sm font-medium text-gray-800 dark:text-gray-100">{title}</h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="Close project panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {showNewProjectForm ? (
            <ProjectSettingsPanel
              draft
              onClose={handleClose}
              onConfirm={handleConfirm}
            />
          ) : editingProjectId ? (
            <ProjectSettingsPanel
              projectId={editingProjectId}
              onClose={handleClose}
              initialTab={
                pendingCodeChangesProjectId === editingProjectId
                  ? 'code-changes'
                  : newlyCreatedProjectId === editingProjectId
                    ? 'team'
                    : undefined
              }
              onMount={() => {
                if (pendingCodeChangesProjectId === editingProjectId) setPendingCodeChangesProjectId(null)
                if (newlyCreatedProjectId === editingProjectId) clearNewlyCreatedProjectId()
              }}
              flashTeam={newlyCreatedProjectId === editingProjectId}
            />
          ) : null}
        </div>

        {/* Footer — edit mode only */}
        {!showNewProjectForm && editingProjectId && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700 shrink-0">
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="text-xs px-3 py-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              aria-label="Delete project"
            >
              Delete
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => duplicateProject(editingProjectId)}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                Duplicate
              </button>
              <button
                onClick={() => exportProject(editingProjectId)}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                Export
              </button>
              <button
                onClick={handleClose}
                className="text-xs px-4 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>

      {showDeleteConfirm && editingProject && (
        <DeleteProjectDialog
          projectName={editingProject.name}
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  )
}
