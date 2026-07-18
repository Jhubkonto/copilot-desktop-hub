import { useCallback, useEffect, useRef, useState } from 'react'
import { shouldFollowAnimatedGrowth } from '../chat-scroll-policy'

// Single threshold for "is the view at the bottom", shared by scrollToBottom's corrective-jump
// check and handleScrollContainerScroll's at-bottom classification. They must agree, or a manual
// scroll/click can land just inside one check's "at bottom" zone while still outside the other's
// narrower epsilon, producing a visible pause-then-jump right as the user reaches the end.
const SCROLL_BOTTOM_THRESHOLD = 80

export interface UseAutoScrollOptions {
  /** True while new content is actively being generated/streamed in. */
  isGenerating: boolean
  /** Any value that changes whenever content that might grow the scroll height changes
   *  (e.g. combine message count + streaming text length into one derived value). */
  contentSignal: unknown
  /** Remounts scroll state when this changes (e.g. switching conversations). */
  resetKey?: unknown
  /** Fired when new content arrives while the user is scrolled away from the bottom. */
  onNewContentWhileScrolledUp?: () => void
  /** Fired whenever the user reaches (true) or leaves (false) the bottom. */
  onAtBottomChange?: (atBottom: boolean) => void
}

export interface UseAutoScrollResult {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  contentContainerRef: React.RefObject<HTMLDivElement | null>
  isUserScrolledUp: boolean
  hasUnreadBelow: boolean
  scrollToBottom: (behavior?: ScrollBehavior) => void
  handleScrollContainerScroll: () => void
  isNearBottom: () => boolean
  /** Suppresses the generation auto-follow effects for `ms` so a manual "scroll to X" jump
   *  isn't immediately dragged back to the bottom. */
  suppressAutoFollow: (ms?: number) => void
  clearUnread: () => void
}

/**
 * Sticky-scroll behavior shared by the main chat window and the generator modals/screens:
 * auto-follows the bottom of a growing content column while the user is at the bottom, stops
 * following once they scroll away, and tracks unread content while scrolled up. Extracted from
 * ChatWindow.tsx so generator surfaces get the same behavior instead of an unconditional
 * scrollIntoView on every update.
 */
export function useAutoScroll({
  isGenerating,
  contentSignal,
  resetKey,
  onNewContentWhileScrolledUp,
  onAtBottomChange,
}: UseAutoScrollOptions): UseAutoScrollResult {
  const [hasUnreadBelow, setHasUnreadBelow] = useState(false)
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false)

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  // The scrollable container itself never changes size (overflow-y-auto, fixed height), so a
  // ResizeObserver on it wouldn't see content growth — observe the inner content column instead.
  const contentContainerRef = useRef<HTMLDivElement>(null)
  const isUserScrolledUpRef = useRef(false)
  // Set immediately before a programmatic scroll and cleared a frame later — content growing
  // taller between the scrollTo() call and the resulting scroll event can otherwise misclassify
  // as the user having scrolled up.
  const isProgrammaticScrollRef = useRef(false)
  const suppressAutoFollowUntilRef = useRef(0)
  const prevContentSignalRef = useRef(contentSignal)

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollContainerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom > SCROLL_BOTTOM_THRESHOLD) {
      isProgrammaticScrollRef.current = true
      el.scrollTo({ top: el.scrollHeight, behavior })
      requestAnimationFrame(() => {
        isProgrammaticScrollRef.current = false
      })
    }
    isUserScrolledUpRef.current = false
    setIsUserScrolledUp(false)
    setHasUnreadBelow(false)
    onAtBottomChange?.(true)
  }, [onAtBottomChange])

  const handleScrollContainerScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    if (isProgrammaticScrollRef.current) return
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_BOTTOM_THRESHOLD
    isUserScrolledUpRef.current = !atBottom
    setIsUserScrolledUp(!atBottom)
    if (atBottom) {
      setHasUnreadBelow(false)
      onAtBottomChange?.(true)
    }
  }, [onAtBottomChange])

  const isNearBottom = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return true
    return el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_BOTTOM_THRESHOLD
  }, [])

  const suppressAutoFollow = useCallback((ms = 2000) => {
    suppressAutoFollowUntilRef.current = Date.now() + ms
  }, [])

  const clearUnread = useCallback(() => setHasUnreadBelow(false), [])

  // Auto-scroll only when the user is at the bottom, driven by a ResizeObserver on the content
  // column rather than guessing how many animation frames a given change takes to land in layout.
  useEffect(() => {
    const content = contentContainerRef.current
    if (!content) return
    const observer = new ResizeObserver(() => {
      if (isUserScrolledUpRef.current) return
      if (Date.now() < suppressAutoFollowUntilRef.current) return
      if (shouldFollowAnimatedGrowth(isUserScrolledUpRef.current)) scrollToBottom('auto')
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [scrollToBottom])

  // Track new content arriving while user is scrolled up → mark unread.
  useEffect(() => {
    if (contentSignal !== prevContentSignalRef.current && isUserScrolledUpRef.current) {
      setHasUnreadBelow(true)
      onNewContentWhileScrolledUp?.()
    }
    prevContentSignalRef.current = contentSignal
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentSignal])

  // Follow to bottom when generation begins — but only if the user is already there.
  // Unconditional here (no isUserScrolledUpRef check) used to mean *any* turn starting —
  // including a background/remote-initiated one (e.g. from the mobile companion) while the
  // user was mid-scroll reading earlier history in this exact conversation — yanked them
  // back down regardless, and since isGenerating can flip true independently of anything
  // the viewing user did, this was the main way "auto-scroll always wins, can't scroll up"
  // reproduced. Sending your own message already leaves the view at the bottom (that's
  // where the composer is), so gating this doesn't lose the "snap to bottom on send" feel.
  // Double rAF: a single rAF can still read scrollHeight from before the content change has
  // actually been painted.
  useEffect(() => {
    if (!isGenerating) return
    if (isUserScrolledUpRef.current) return
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!isUserScrolledUpRef.current) scrollToBottom('auto')
      })
    })
    return () => cancelAnimationFrame(raf1)
  }, [isGenerating, scrollToBottom])

  // Safety net when generation ends: content is now stable, so a fresh measurement is
  // trustworthy in a way it isn't mid-stream. Skips entirely if the user is genuinely
  // scrolled away reading history.
  useEffect(() => {
    if (isGenerating) return
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (isNearBottom()) scrollToBottom('auto')
      })
    })
    return () => cancelAnimationFrame(raf1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGenerating])

  // Reset scroll state when resetKey changes (e.g. switching conversations).
  useEffect(() => {
    isUserScrolledUpRef.current = false
    setIsUserScrolledUp(false)
    setHasUnreadBelow(false)
    requestAnimationFrame(() => scrollToBottom('auto'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  return {
    scrollContainerRef,
    contentContainerRef,
    isUserScrolledUp,
    hasUnreadBelow,
    scrollToBottom,
    handleScrollContainerScroll,
    isNearBottom,
    suppressAutoFollow,
    clearUnread,
  }
}
