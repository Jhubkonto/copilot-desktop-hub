import { useEffect, useState } from 'react'

interface UseTimersParams {
  isGenerating: boolean
  generationStartedAt: number | null
}

export function useTimers({ isGenerating, generationStartedAt }: UseTimersParams) {
  const [generationElapsedSec, setGenerationElapsedSec] = useState(0)
  const [rateLimitRemainingSec, setRateLimitRemainingSec] = useState(0)

  useEffect(() => {
    if (!isGenerating || !generationStartedAt) {
      setGenerationElapsedSec(0)
      return
    }

    const id = window.setInterval(() => {
      setGenerationElapsedSec(
        Math.max(0, Math.floor((Date.now() - generationStartedAt) / 1000)),
      )
    }, 250)

    return () => {
      window.clearInterval(id)
    }
  }, [isGenerating, generationStartedAt])

  useEffect(() => {
    if (rateLimitRemainingSec <= 0) return

    const id = window.setInterval(() => {
      setRateLimitRemainingSec((prev) => Math.max(0, prev - 1))
    }, 1000)

    return () => {
      window.clearInterval(id)
    }
  }, [rateLimitRemainingSec])

  return {
    generationElapsedSec,
    rateLimitRemainingSec,
    setRateLimitRemainingSec,
  }
}
