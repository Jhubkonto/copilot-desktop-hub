interface ToolApprovalRequest {
  requestId: string
  tool: string
  args: Record<string, unknown>
  description: string
}

interface ToolApprovalProps {
  requests: ToolApprovalRequest[]
  onRespond: (requestId: string, approved: boolean, remember: boolean) => void
}

const TOOL_ICONS: Record<string, string> = {
  fileRead: '📄',
  fileWrite: '✏️',
  shellExec: '🖥️',
  webFetch: '🌐'
}

function formatArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([key, value]) => {
      const strValue = typeof value === 'string' ? value : JSON.stringify(value)
      const truncated = strValue.length > 120 ? strValue.slice(0, 120) + '...' : strValue
      return `${key}: ${truncated}`
    })
    .join('\n')
}

export function ToolApproval({ requests, onRespond }: ToolApprovalProps) {
  if (requests.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-40 space-y-2 max-w-sm">
      {requests.map((req) => (
        <div
          key={req.requestId}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4 animate-in slide-in-from-right"
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">{TOOL_ICONS[req.tool] || '🔧'}</span>
            <div>
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                Tool Request
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {req.description}
              </p>
            </div>
          </div>

          <pre className="text-xs bg-gray-50 dark:bg-gray-900 rounded-lg p-2 mb-3 text-gray-700 dark:text-gray-300 overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap">
            {formatArgs(req.args)}
          </pre>

          <div className="flex gap-2">
            <button
              onClick={() => onRespond(req.requestId, true, false)}
              className="flex-1 text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors font-medium"
            >
              Approve
            </button>
            <button
              onClick={() => onRespond(req.requestId, false, false)}
              className="flex-1 text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors font-medium"
            >
              Deny
            </button>
            <button
              onClick={() => onRespond(req.requestId, true, true)}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title="Approve and remember for this tool"
            >
              Always
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
