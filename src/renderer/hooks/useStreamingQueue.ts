import { useCallback, useState } from 'react'

interface UseStreamingQueueReturn {
  /** The authoritative text displayed immediately. */
  displayedContent: string
  /** True while there are still queued chars that haven't been displayed yet */
  isDraining: boolean
  /** Push new raw chunk into the queue */
  enqueue: (chunk: string) => void
  /** Flush remaining queue instantly (e.g. on error cleanup) */
  flush: () => void
  /** Reset everything — call when starting a new stream or switching conversations */
  reset: () => void
  /** Restore authoritative text as already revealed (navigation/reconnect policy). */
  snap: (text: string) => void
}

export function useStreamingQueue(): UseStreamingQueueReturn {
  const [displayedContent, setDisplayedContent] = useState('')

  const enqueue = useCallback((chunk: string) => {
    setDisplayedContent((current) => current + chunk)
  }, [])

  const flush = useCallback(() => {}, [])

  const reset = useCallback(() => {
    setDisplayedContent('')
  }, [])

  const snap = useCallback((text: string) => {
    setDisplayedContent(text)
  }, [])

  return { displayedContent, isDraining: false, enqueue, flush, reset, snap }
}
