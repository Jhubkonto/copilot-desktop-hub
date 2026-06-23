import { useCallback, useEffect, useRef, useState } from 'react'

// Characters revealed per animation frame (~16ms at 60fps).
// At 60fps this gives ~3600 chars/sec — fast enough to feel instant
// for normal responses while still being smooth and non-sprinting.
const CHARS_PER_FRAME = 60

interface UseStreamingQueueReturn {
  /** The smoothly drained display string — use this instead of raw streamingContent */
  displayedContent: string
  /** True while there are still queued chars that haven't been displayed yet */
  isDraining: boolean
  /** Push new raw chunk into the queue */
  enqueue: (chunk: string) => void
  /** Flush remaining queue instantly (e.g. on error cleanup) */
  flush: () => void
  /** Reset everything — call when starting a new stream or switching conversations */
  reset: () => void
}

export function useStreamingQueue(): UseStreamingQueueReturn {
  const [displayedContent, setDisplayedContent] = useState('')
  const [isDraining, setIsDraining] = useState(false)

  const queueRef = useRef('')
  const rafRef = useRef<number | null>(null)
  const displayedRef = useRef('')

  const drain = useCallback(() => {
    if (queueRef.current.length === 0) {
      setIsDraining(false)
      rafRef.current = null
      return
    }

    const slice = queueRef.current.slice(0, CHARS_PER_FRAME)
    queueRef.current = queueRef.current.slice(CHARS_PER_FRAME)
    displayedRef.current += slice
    setDisplayedContent(displayedRef.current)

    rafRef.current = requestAnimationFrame(drain)
  }, [])

  const enqueue = useCallback((chunk: string) => {
    queueRef.current += chunk
    setIsDraining(true)
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(drain)
    }
  }, [drain])

  const flush = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    displayedRef.current += queueRef.current
    queueRef.current = ''
    setDisplayedContent(displayedRef.current)
    setIsDraining(false)
  }, [])

  const reset = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    queueRef.current = ''
    displayedRef.current = ''
    setDisplayedContent('')
    setIsDraining(false)
  }, [])

  // Cancel RAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return { displayedContent, isDraining, enqueue, flush, reset }
}
