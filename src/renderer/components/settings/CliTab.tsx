import { RefreshCw } from 'lucide-react'
import { TabHeader } from './TabHeader'

interface InstalledClis {
  claude: boolean
  codex: boolean
}

interface Props {
  installedClis: InstalledClis
  cliRefreshing: boolean
  onRefresh: () => Promise<void>
}

export function CliTab({ installedClis, cliRefreshing, onRefresh }: Props) {
  return (
    <>
      <TabHeader title="CLI Tools" description="Install CLI tools to chat without an API key. Each tool authenticates with its own provider." />

      {/* Claude CLI */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-800 dark:text-gray-100">Claude CLI</span>
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
              installedClis.claude
                ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-500'
            }`}>
              {installedClis.claude ? '✓ Installed' : 'Not installed'}
            </span>
          </div>
          <button
            disabled={cliRefreshing}
            onClick={onRefresh}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${cliRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500">Install</p>
          <pre className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-3 py-2 font-mono overflow-x-auto select-all">npm install -g @anthropic-ai/claude-code</pre>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500">Authenticate (run once)</p>
          <pre className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-3 py-2 font-mono overflow-x-auto select-all">claude</pre>
        </div>
      </div>

      {/* Codex CLI */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-800 dark:text-gray-100">Codex CLI</span>
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
              installedClis.codex
                ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-500'
            }`}>
              {installedClis.codex ? '✓ Installed' : 'Not installed'}
            </span>
          </div>
          <button
            disabled={cliRefreshing}
            onClick={onRefresh}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${cliRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500">Install</p>
          <pre className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-3 py-2 font-mono overflow-x-auto select-all">npm install -g @openai/codex</pre>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500">Authenticate (run once)</p>
          <pre className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-3 py-2 font-mono overflow-x-auto select-all">codex login</pre>
        </div>
      </div>
    </>
  )
}
