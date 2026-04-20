import { useState, useEffect, useCallback } from 'react'
import { FileText, FilePen, Terminal, Globe, Wrench } from 'lucide-react'
import { useAppStore, type ToolApprovalRequest } from '../store/app-store'

const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  fileRead: FileText,
  fileWrite: FilePen,
  shellExec: Terminal,
  webFetch: Globe
}

const AUTO_DENY_SECONDS = 60

function formatArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([key, value]) => {
      const strValue = typeof value === 'string' ? value : JSON.stringify(value)
      const truncated = strValue.length > 120 ? strValue.slice(0, 120) + '...' : strValue
      return `${key}: ${truncated}`
    })
    .join('\n')
}

function CountdownBar({ requestId, onExpire }: { requestId: string; onExpire: (id: string) => void }) {
  const [remaining, setRemaining] = useState(AUTO_DENY_SECONDS)

  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          onExpire(requestId)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [requestId, onExpire])

  const pct = (remaining / AUTO_DENY_SECONDS) * 100

  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>Auto-deny in {remaining}s</span>
        <span>{remaining}s</span>
      </div>
      <div className="h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-1000 ease-linear bg-gray-400 dark:bg-gray-500"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={remaining}
          aria-valuemin={0}
          aria-valuemax={AUTO_DENY_SECONDS}
          aria-label={`Auto-deny countdown: ${remaining} seconds remaining`}
        />
      </div>
    </div>
  )
}

export function ToolApproval() {
  const requests = useAppStore((s) => s.toolApprovalRequests)
  const respondToToolApproval = useAppStore((s) => s.respondToToolApproval)

  const handleExpire = useCallback(
    (requestId: string) => {
      respondToToolApproval(requestId, false, false)
    },
    [respondToToolApproval]
  )

  if (requests.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-40 space-y-2 max-w-sm">
      {requests.map((req) => {
        const IconComponent = TOOL_ICONS[req.tool] || Wrench
        return (
          <div
            key={req.requestId}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4 animate-in slide-in-from-right"
          >
            <div className="flex items-center gap-2 mb-2">
              <IconComponent className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              <div>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
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
                onClick={() => respondToToolApproval(req.requestId, true, false)}
                className="flex-1 text-xs px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors font-medium"
              >
                Approve
              </button>
              <button
                onClick={() => respondToToolApproval(req.requestId, false, false)}
                className="flex-1 text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium"
              >
                Deny
              </button>
              <button
                onClick={() => respondToToolApproval(req.requestId, true, true)}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                title="Approve and remember for this tool"
              >
                Always
              </button>
            </div>

            <CountdownBar requestId={req.requestId} onExpire={handleExpire} />
          </div>
        )
      })}
    </div>
  )
}
