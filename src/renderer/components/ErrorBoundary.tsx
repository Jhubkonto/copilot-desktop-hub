import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  onReportBug: (draft: { title: string; description: string }) => void
  onCreateRemoteEditReport: (draft: { title: string; description: string }) => Promise<string>
  onOpenRemoteEditReport: (reportId: string) => void
}

interface ErrorBoundaryState {
  error: Error | null
  stack: string
  remoteEditReportId: string | null
  remoteEditError: string | null
  creatingRemoteEditReport: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
    stack: '',
    remoteEditReportId: null,
    remoteEditError: null,
    creatingRemoteEditReport: false,
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      error,
      stack: '',
      remoteEditReportId: null,
      remoteEditError: null,
      creatingRemoteEditReport: false,
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ error, stack: info.componentStack ?? '' })
  }

  private getDraft() {
    const title = this.state.error?.message || 'Renderer error'
    const description = [this.state.error?.stack, this.state.stack].filter(Boolean).join('\n\n')
    return { title, description }
  }

  private async createRemoteEditReport(): Promise<void> {
    const draft = this.getDraft()
    this.setState({ creatingRemoteEditReport: true, remoteEditError: null })
    try {
      const reportId = await this.props.onCreateRemoteEditReport(draft)
      this.setState({ remoteEditReportId: reportId })
    } catch (error) {
      this.setState({ remoteEditError: error instanceof Error ? error.message : String(error) })
    } finally {
      this.setState({ creatingRemoteEditReport: false })
    }
  }

  private resetAndOpenRemoteEdit(reportId: string): void {
    this.setState({
      error: null,
      stack: '',
      remoteEditReportId: null,
      remoteEditError: null,
      creatingRemoteEditReport: false,
    })
    this.props.onOpenRemoteEditReport(reportId)
  }

  render() {
    if (!this.state.error) return this.props.children

    const { title, description } = this.getDraft()

    return (
      <div className="h-full w-full bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100 flex items-center justify-center p-6">
        <div className="w-full max-w-2xl rounded-lg border border-red-200 bg-red-50 p-5 dark:border-red-900/60 dark:bg-red-950/30">
          <h1 className="text-base font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 break-words">{title}</p>
          {description && (
            <pre className="mt-4 max-h-64 overflow-auto rounded-lg bg-white/70 p-3 text-xs text-gray-700 dark:bg-gray-950/50 dark:text-gray-300">
              {description}
            </pre>
          )}
          {this.state.remoteEditError && (
            <p className="mt-3 rounded-lg bg-red-100 p-3 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300">
              {this.state.remoteEditError}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
              disabled={this.state.creatingRemoteEditReport}
              onClick={() => void this.createRemoteEditReport()}
            >
              {this.state.creatingRemoteEditReport ? 'Creating Self-Heal report...' : 'Create Self-Heal report'}
            </button>
            {this.state.remoteEditReportId && (
              <button
                type="button"
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                onClick={() => this.resetAndOpenRemoteEdit(this.state.remoteEditReportId!)}
              >
                Open Remote Edit
              </button>
            )}
            <button
              type="button"
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
              onClick={() => this.setState({ error: null, stack: '', remoteEditError: null })}
            >
              Try again
            </button>
            <button
              type="button"
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
              onClick={() => this.props.onReportBug({ title, description })}
            >
              Report manually
            </button>
          </div>
        </div>
      </div>
    )
  }
}
