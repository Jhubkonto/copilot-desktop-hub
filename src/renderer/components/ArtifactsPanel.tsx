import { Package } from 'lucide-react'
import { useAppStore } from '../store/app-store'
import { ModalShell } from './ui/primitives'
import { ArtifactsBrowser } from './artifacts/ArtifactsBrowser'

export function ArtifactsPanel() {
  const visible = useAppStore((s) => s.showArtifactsPanel)
  const setShowArtifactsPanel = useAppStore((s) => s.setShowArtifactsPanel)

  if (!visible) return null

  return (
    <ModalShell
      title="Artifacts"
      description="Browse, version, and export generated artifacts across all projects."
      icon={<Package className="w-3.5 h-3.5" />}
      maxWidth="max-w-7xl"
      onClose={() => setShowArtifactsPanel(false)}
    >
      <ArtifactsBrowser />
    </ModalShell>
  )
}
