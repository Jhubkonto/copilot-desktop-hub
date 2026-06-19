import { useEffect, useState } from 'react'

export function useGenerationTimer(isGenerating: boolean, generationStartedAt: number | null): number {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!isGenerating || !generationStartedAt) { setElapsed(0); return }
    const id = window.setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - generationStartedAt) / 1000)))
    }, 250)
    return () => window.clearInterval(id)
  }, [isGenerating, generationStartedAt])
  return elapsed
}
