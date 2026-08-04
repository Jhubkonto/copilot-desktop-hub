function errorDetails(value: unknown): { message: string; stack: string | null } {
  if (value instanceof Error) return { message: value.message, stack: value.stack ?? null }
  if (typeof value === 'string') return { message: value, stack: null }
  try {
    return { message: JSON.stringify(value), stack: null }
  } catch {
    return { message: String(value), stack: null }
  }
}

function report(value: unknown, context: string): void {
  const details = errorDetails(value)
  void window.api?.recordRendererError?.({
    message: `${context}: ${details.message || 'Unknown error'}`,
    stack: details.stack,
  }).catch(() => {})
}

export function installGlobalErrorHandlers(): () => void {
  const onError = (event: ErrorEvent) => report(event.error ?? event.message, 'Uncaught renderer error')
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    report(event.reason, 'Unhandled renderer rejection')
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onUnhandledRejection)
  }
}
