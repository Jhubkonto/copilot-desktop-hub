import { useEffect, useState } from 'react'

export const SEARCH_DEBOUNCE_MS = 250

/** Debounce non-empty searches while making clear actions take effect immediately. */
export function useDebouncedSearchQuery(query: string) {
  const [debouncedQuery, setDebouncedQuery] = useState(query)

  useEffect(() => {
    if (!query.trim()) {
      setDebouncedQuery(query)
      return
    }

    const timer = window.setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query])

  return debouncedQuery
}
