import { NexyIcon } from '../ui/icons/NexyIcon'
import { TabHeader } from './TabHeader'

interface InstalledClis {
  claude: boolean
  codex: boolean
  hermes?: boolean
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
      <div className="rounded-none border-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 p-4 space-y-3 shadow-nexy">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-800 dark:text-gray-100">Claude CLI</span>
            <span className={`text-xs px-1.5 py-0.5 rounded-none border font-medium ${
              installedClis.claude
                ? 'border-nexy-success bg-nexy-success/10 text-nexy-success'
                : 'border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-500'
            }`}>
              {installedClis.claude ? '✓ Installed' : 'Not installed'}
            </span>
          </div>
          <button
            disabled={cliRefreshing}
            onClick={onRefresh}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1 disabled:opacity-50"
          >
            <NexyIcon name={cliRefreshing ? 'busy' : 'refresh'} size={12} />
            Refresh
          </button>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500">Install</p>
          <pre className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-none border border-gray-300 dark:border-gray-600 px-3 py-2 font-mono overflow-x-auto select-all">npm install -g @anthropic-ai/claude-code</pre>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500">Authenticate (run once)</p>
          <pre className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-none border border-gray-300 dark:border-gray-600 px-3 py-2 font-mono overflow-x-auto select-all">claude</pre>
        </div>
      </div>

      {/* Codex CLI */}
      <div className="rounded-none border-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 p-4 space-y-3 shadow-nexy">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-800 dark:text-gray-100">Codex CLI</span>
            <span className={`text-xs px-1.5 py-0.5 rounded-none border font-medium ${
              installedClis.codex
                ? 'border-nexy-success bg-nexy-success/10 text-nexy-success'
                : 'border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-500'
            }`}>
              {installedClis.codex ? '✓ Installed' : 'Not installed'}
            </span>
          </div>
          <button
            disabled={cliRefreshing}
            onClick={onRefresh}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1 disabled:opacity-50"
          >
            <NexyIcon name={cliRefreshing ? 'busy' : 'refresh'} size={12} />
            Refresh
          </button>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500">Install</p>
          <pre className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-none border border-gray-300 dark:border-gray-600 px-3 py-2 font-mono overflow-x-auto select-all">npm install -g @openai/codex</pre>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500">Authenticate (run once)</p>
          <pre className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-none border border-gray-300 dark:border-gray-600 px-3 py-2 font-mono overflow-x-auto select-all">codex login</pre>
        </div>
      </div>

      {/* Hermes Agent */}
      <div className="rounded-none border-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 p-4 space-y-3 shadow-nexy">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-800 dark:text-gray-100">Hermes Agent</span>
            <span className={`text-xs px-1.5 py-0.5 rounded-none border font-medium ${
              installedClis.hermes
                ? 'border-nexy-success bg-nexy-success/10 text-nexy-success'
                : 'border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-500'
            }`}>
              {installedClis.hermes ? '✓ Installed' : 'Not installed'}
            </span>
          </div>
          <button
            disabled={cliRefreshing}
            onClick={onRefresh}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1 disabled:opacity-50"
          >
            <NexyIcon name={cliRefreshing ? 'busy' : 'refresh'} size={12} />
            Refresh
          </button>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500">Install</p>
          <pre className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-none border border-gray-300 dark:border-gray-600 px-3 py-2 font-mono overflow-x-auto select-all">curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash</pre>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500">Authenticate (run once)</p>
          <pre className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-none border border-gray-300 dark:border-gray-600 px-3 py-2 font-mono overflow-x-auto select-all">hermes setup</pre>
        </div>
      </div>
    </>
  )
}
