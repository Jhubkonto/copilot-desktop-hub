import { useRef, useState, useCallback } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '../store/app-store'
import type { ProjectConfig } from '../store/types'
import { ResizeHandle } from './ResizeHandle'
import { ProjectSettingsPanel } from './ProjectSettingsPanel'

const PANEL_MIN = 360
const PANEL_MAX = 700

export function CreateProjectPanel() {
  const panelRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(480)

  const createProject = useAppStore((s) => s.createProject)
  const updateProjectConfig = useAppStore((s) => s.updateProjectConfig)
  const setShowNewProjectForm = useAppStore((s) => s.setShowNewProjectForm)
  const addToast = useAppStore((s) => s.addToast)

  const handleSetSize = useCallback((size: number) => {
    setWidth(Math.max(PANEL_MIN, Math.min(PANEL_MAX, size)))
  }, [])

  const handleClose = () => setShowNewProjectForm(false)

  const handleConfirm = async (name: string, color: string, config: Partial<ProjectConfig>) => {
    try {
      await createProject(name, color)
      const newProject = useAppStore.getState().projects.find((p) => p.name === name)
      if (newProject && Object.keys(config).some((k) => config[k as keyof typeof config] !== undefined)) {
        await updateProjectConfig(newProject.id, config)
      }
      setShowNewProjectForm(false)
    } catch {
      addToast('Failed to create project', 'error')
    }
  }

  return (
    <div
      className="fixed inset-0 top-9 z-40 flex"
      role="dialog"
      aria-modal="true"
      aria-label="Create new project"
    >
      <div className="flex-1 bg-black/20" onClick={handleClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="relative bg-white dark:bg-gray-900 shadow-xl flex flex-col border-l border-gray-200 dark:border-gray-700"
        style={{ width }}
      >
        <ResizeHandle direction="horizontal" align="start" containerRef={panelRef} onSetSize={handleSetSize} />

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h2 className="text-sm font-medium text-gray-800 dark:text-gray-100">New Project</h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="Close new project panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <ProjectSettingsPanel
            draft
            onClose={handleClose}
            onConfirm={handleConfirm}
          />
        </div>
      </div>
    </div>
  )
}
