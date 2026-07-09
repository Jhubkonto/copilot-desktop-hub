import { useEffect, useRef, useState } from 'react'

/**
 * Returns a trailing-throttled snapshot of `value`, updating at most once per
 * `intervalMs` while `active` is true. Always tracks `value` exactly (no throttling)
 * once `active` is false, so a finalized/settled value is never stuck on a stale
 * mid-throttle snapshot.
 */
export function useThrottledValue<T>(value: T, intervalMs: number, active: boolean): T {
  const [throttled, setThrottled] = useState(value)
  const latestValueRef = useRef(value)
  latestValueRef.current = value
  const lastFlushRef = useRef(0)
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!active) {
      if (pendingTimeoutRef.current) {
        clearTimeout(pendingTimeoutRef.current)
        pendingTimeoutRef.current = null
      }
      lastFlushRef.current = Date.now()
      setThrottled(value)
      return
    }

    const now = Date.now()
    const elapsed = now - lastFlushRef.current
    if (elapsed >= intervalMs) {
      lastFlushRef.current = now
      setThrottled(value)
      return
    }
    if (pendingTimeoutRef.current) return
    pendingTimeoutRef.current = setTimeout(() => {
      pendingTimeoutRef.current = null
      lastFlushRef.current = Date.now()
      setThrottled(latestValueRef.current)
    }, intervalMs - elapsed)
  }, [value, active, intervalMs])

  useEffect(() => () => {
    if (pendingTimeoutRef.current) clearTimeout(pendingTimeoutRef.current)
  }, [])

  return active ? throttled : value
}
