import { useEffect } from 'react'
import { useAppStore } from '../../store/app-store'
import { DEFAULT_PROJECT_CONFIG } from '../../store/types'
import { CodeChangesScreen } from '../CodeChangesScreen'

export function ProjectCodeChangesPane() {
  const codeChangesProjectId = useAppStore((s) => s.codeChangesProjectId)
  const projectConfigs = useAppStore((s) => s.projectConfigs)
  const loadProjectConfig = useAppStore((s) => s.loadProjectConfig)
  const openEditProject = useAppStore((s) => s.openEditProject)

  useEffect(() => {
    if (codeChangesProjectId) void loadProjectConfig(codeChangesProjectId)
  }, [codeChangesProjectId, loadProjectConfig])

  if (!codeChangesProjectId) return null

  const projectConfig = projectConfigs[codeChangesProjectId] ?? DEFAULT_PROJECT_CONFIG

  return (
    <CodeChangesScreen
      projectId={codeChangesProjectId}
      projectConfig={projectConfig}
      onOpenGeneralSettings={() => openEditProject(codeChangesProjectId)}
    />
  )
}
