import { useState, useEffect, useCallback } from 'react'
import type { NexyIconName } from './ui/icons'
import { NexyIcon } from './ui/icons'
import { useAppStore } from '../store/app-store'
import { Button } from './ui/primitives'

const TOOL_ICONS: Record<string, NexyIconName> = {
  fileRead: 'artifact',
  fileWrite: 'edit',
  shellExec: 'prompt',
  webFetch: 'external'
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

function CountdownBar({
  requestId,
  onExpire,
  planDecision = false,
}: {
  requestId: string
  onExpire: (id: string) => void
  planDecision?: boolean
}) {
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
      <div className="mb-1 flex justify-between text-xs text-nexy-muted">
        <span>{planDecision ? 'Auto-cancel' : 'Auto-deny'} in {remaining}s</span>
        <span>{remaining}s</span>
      </div>
      <div className="h-1 overflow-hidden border border-nexy-border bg-nexy-recessed">
        <div
          className="h-full bg-gray-400 transition-[width] duration-1000 ease-linear dark:bg-gray-500"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={remaining}
          aria-valuemin={0}
          aria-valuemax={AUTO_DENY_SECONDS}
          aria-label={`${planDecision ? 'Auto-cancel' : 'Auto-deny'} countdown: ${remaining} seconds remaining`}
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
        const isPlanDecision = req.tool === 'exit_plan_mode'
        const iconName: NexyIconName = isPlanDecision ? 'milestone' : TOOL_ICONS[req.tool] || 'tool'
        return (
          <div
            key={req.requestId}
            className="rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised p-4 text-nexy-text shadow-nexy"
          >
            <div className="flex items-center gap-2 mb-2">
              <NexyIcon name={iconName} className="h-4 w-4 text-nexy-accent" />
              <div>
                <p className="nexy-font-panel text-sm text-nexy-text">
                  {isPlanDecision ? 'Plan ready' : 'Tool Request'}
                </p>
                <p className="text-xs text-nexy-muted">
                  {isPlanDecision
                    ? 'Choose whether Codex should implement this plan or continue planning.'
                    : req.description}
                </p>
              </div>
            </div>

            <pre className="mb-3 max-h-32 overflow-x-auto overflow-y-auto whitespace-pre-wrap rounded-nexy-sm border border-nexy-border bg-nexy-recessed p-2 text-xs text-nexy-text">
              {formatArgs(req.args)}
            </pre>

            {isPlanDecision ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  onClick={() => respondToToolApproval(req.requestId, true, false)}
                  className="flex-1 justify-center min-w-32"
                >
                  Implement plan
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    void respondToToolApproval(req.requestId, false, false)
                    window.dispatchEvent(new CustomEvent('nexy:focus-chat-composer'))
                  }}
                  className="flex-1 justify-center min-w-32"
                >
                  Keep planning
                </Button>
                <Button
                  variant="danger"
                  onClick={() => respondToToolApproval(req.requestId, false, false)}
                  className="justify-center border border-gray-200 dark:border-gray-700"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  onClick={() => respondToToolApproval(req.requestId, true, false)}
                  className="flex-1 justify-center"
                >
                  Approve
                </Button>
                <Button
                  variant="danger"
                  onClick={() => respondToToolApproval(req.requestId, false, false)}
                  className="flex-1 justify-center border border-gray-200 dark:border-gray-700"
                >
                  Deny
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => respondToToolApproval(req.requestId, true, true)}
                  title="Approve and remember for this tool"
                >
                  Always
                </Button>
              </div>
            )}

            <CountdownBar requestId={req.requestId} onExpire={handleExpire} planDecision={isPlanDecision} />
          </div>
        )
      })}
    </div>
  )
}
