import { Sparkles } from 'lucide-react'
import { useAppStore } from '../store/app-store'
import { ModalShell } from './ui/primitives'
import { FeatureGeneratorTab } from './settings/FeatureGeneratorTab'

export function FeatureGeneratorPanel() {
  const visible = useAppStore((s) => s.showFeatureGeneratorPanel)
  const setShowFeatureGeneratorPanel = useAppStore((s) => s.setShowFeatureGeneratorPanel)

  if (!visible) return null

  return (
    <ModalShell
      title="Feature Generator"
      description="Discover, spec, plan, stage, verify, and commit a new feature end to end."
      icon={<Sparkles className="w-3.5 h-3.5" />}
      maxWidth="max-w-7xl"
      onClose={() => setShowFeatureGeneratorPanel(false)}
    >
      <FeatureGeneratorTab />
    </ModalShell>
  )
}
