import { useCallback, useEffect, useRef, useState } from 'react'

export interface CursorPage<T> {
  items: T[]
  totalCount: number
  nextCursor: string | null
  hasMore: boolean
}

export function useCursorPagination<T extends { id: string }>(options: {
  resetKey: string
  loadPage: (cursor: string | null, requestId: string) => Promise<CursorPage<T>>
}) {
  const loadPageRef = useRef(options.loadPage)
  loadPageRef.current = options.loadPage
  const generation = useRef(0)
  const [items, setItems] = useState<T[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasLoaded, setHasLoaded] = useState(false)

  const request = useCallback(async (cursor: string | null, append: boolean) => {
    const currentGeneration = generation.current
    const requestId = crypto.randomUUID()
    setIsLoading(true)
    setError(null)
    try {
      const page = await loadPageRef.current(cursor, requestId)
      if (generation.current !== currentGeneration) return
      setItems((existing) => {
        if (!append) return page.items
        const merged = new Map(existing.map((item) => [item.id, item]))
        page.items.forEach((item) => merged.set(item.id, item))
        return [...merged.values()]
      })
      setTotalCount(page.totalCount)
      setNextCursor(page.nextCursor)
      setHasMore(page.hasMore)
      setHasLoaded(true)
    } catch (cause) {
      if (generation.current === currentGeneration) {
        setError(cause instanceof Error ? cause.message : 'Failed to load items')
      }
    } finally {
      if (generation.current === currentGeneration) setIsLoading(false)
    }
  }, [])

  const refresh = useCallback(() => {
    generation.current += 1
    setIsLoading(false)
    setError(null)
    setHasLoaded(false)
    queueMicrotask(() => { void request(null, false) })
  }, [request])

  useEffect(() => {
    refresh()
  // resetKey deliberately represents all query inputs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.resetKey])

  return {
    items,
    totalCount,
    hasMore,
    isLoading,
    error,
    hasLoaded,
    refresh,
    loadMore: () => request(nextCursor, true),
  }
}
