import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react'
import { NexyIcon } from './ui/icons'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Clear a caught error when the surrounding view changes (for example, chat navigation). */
  resetKey?: string | null
}

interface ErrorBoundaryState {
  error: Error | null
  stack: string
  retryKey: number
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
    stack: '',
    retryKey: 0,
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      error,
      stack: '',
      retryKey: 0,
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ error, stack: info.componentStack ?? '' })
  }

  componentDidUpdate(previousProps: ErrorBoundaryProps): void {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState((state) => ({
        error: null,
        stack: '',
        retryKey: state.retryKey + 1,
      }))
    }
  }

  render() {
    if (!this.state.error) {
      return <Fragment key={this.state.retryKey}>{this.props.children}</Fragment>
    }

    const title = this.state.error.message || 'Renderer error'
    const description = [this.state.error.stack, this.state.stack].filter(Boolean).join('\n\n')

    return (
      <div className="h-full w-full bg-nexy-background text-nexy-text flex items-center justify-center p-6">
        <div className="w-full max-w-2xl border-2 border-nexy-error bg-nexy-error/10 p-5 shadow-nexy">
          <h1 className="nexy-font-title flex items-center gap-2 text-base font-semibold"><NexyIcon name="error" />Something went wrong</h1>
          <p className="mt-2 text-sm text-nexy-muted break-words">{title}</p>
          {description && (
            <pre className="mt-4 max-h-64 overflow-auto border-2 border-nexy-border bg-nexy-recessed p-3 text-xs text-nexy-muted">
              {description}
            </pre>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="flex items-center gap-1.5 border-2 border-nexy-border bg-nexy-raised px-3 py-1.5 text-xs font-medium text-nexy-text shadow-nexy hover:bg-nexy-recessed"
              onClick={() => this.setState((state) => ({
                error: null,
                stack: '',
                retryKey: state.retryKey + 1,
              }))}
            >
              <NexyIcon name="refresh" size={12} />Try again
            </button>
          </div>
        </div>
      </div>
    )
  }
}
