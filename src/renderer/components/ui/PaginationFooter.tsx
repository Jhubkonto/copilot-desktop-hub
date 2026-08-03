interface PaginationFooterProps {
  loadedCount: number
  totalCount: number
  hasMore: boolean
  isLoading: boolean
  error: string | null
  onLoadMore: () => void
  onRetry: () => void
}

export function PaginationFooter(props: PaginationFooterProps) {
  if (props.totalCount === 0 && !props.isLoading && !props.error) return null
  return (
    <div className="flex flex-col items-center gap-1 px-3 py-3 text-[10px] text-nexy-muted" role="status">
      <span>{Math.min(props.loadedCount, props.totalCount)} of {props.totalCount}</span>
      {props.error ? (
        <button className="text-nexy-error hover:underline" onClick={props.onRetry}>Retry</button>
      ) : props.hasMore ? (
        <button
          className="rounded-nexy-sm border border-nexy-border bg-nexy-surface px-3 py-1 text-nexy-text hover:bg-nexy-recessed disabled:opacity-50"
          disabled={props.isLoading}
          onClick={props.onLoadMore}
        >
          {props.isLoading ? 'Loading…' : 'Load more'}
        </button>
      ) : props.isLoading ? <span>Loading…</span> : null}
    </div>
  )
}
