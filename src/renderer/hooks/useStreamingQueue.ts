import { useCallback, useEffect, useRef, useState } from 'react'
import { revealFrameSize } from '../../shared/chat-animation'
import { ChatAnimationDiagnostics } from '../../shared/chat-animation-diagnostics'

export const streamingQueueDiagnostics = new ChatAnimationDiagnostics()

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
  /** Restore authoritative text as already revealed (navigation/reconnect policy). */
  snap: (text: string) => void
}

export function useStreamingQueue(): UseStreamingQueueReturn {
  const [displayedContent, setDisplayedContent] = useState('')
  const [isDraining, setIsDraining] = useState(false)

  const queueRef = useRef('')
  const rafRef = useRef<number | null>(null)
  const displayedRef = useRef('')
  const oldestPendingAtRef = useRef<number | null>(null)

  const drain = useCallback(() => {
    if (queueRef.current.length === 0) {
      oldestPendingAtRef.current = null
      streamingQueueDiagnostics.recordBacklog(0)
      setIsDraining(false)
      rafRef.current = null
      return
    }

    const frameSize = revealFrameSize(queueRef.current.length)
    const slice = queueRef.current.slice(0, frameSize)
    queueRef.current = queueRef.current.slice(frameSize)
    streamingQueueDiagnostics.recordBacklog(
      queueRef.current.length,
      oldestPendingAtRef.current ?? undefined,
    )
    displayedRef.current += slice
    setDisplayedContent(displayedRef.current)

    rafRef.current = requestAnimationFrame(drain)
  }, [])

  const enqueue = useCallback((chunk: string) => {
    if (queueRef.current.length === 0) oldestPendingAtRef.current = Date.now()
    queueRef.current += chunk
    streamingQueueDiagnostics.recordBacklog(
      queueRef.current.length,
      oldestPendingAtRef.current ?? undefined,
    )
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      displayedRef.current += queueRef.current
      queueRef.current = ''
      oldestPendingAtRef.current = null
      streamingQueueDiagnostics.recordBacklog(0)
      setDisplayedContent(displayedRef.current)
      setIsDraining(false)
      return
    }
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
    oldestPendingAtRef.current = null
    streamingQueueDiagnostics.recordBacklog(0)
    setDisplayedContent(displayedRef.current)
    setIsDraining(false)
  }, [])

  const reset = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    queueRef.current = ''
    oldestPendingAtRef.current = null
    streamingQueueDiagnostics.recordBacklog(0)
    displayedRef.current = ''
    setDisplayedContent('')
    setIsDraining(false)
  }, [])

  const snap = useCallback((text: string) => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    queueRef.current = ''
    oldestPendingAtRef.current = null
    streamingQueueDiagnostics.recordSnapshotRecovery()
    streamingQueueDiagnostics.recordBacklog(0)
    displayedRef.current = text
    setDisplayedContent(text)
    setIsDraining(false)
  }, [])

  // Cancel RAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return { displayedContent, isDraining, enqueue, flush, reset, snap }
}
