import type { RemoteEditHistoryEntry } from '@shared/types'
import { Button } from './ui/primitives'

interface CodeChangeHistorySectionProps {
  history: RemoteEditHistoryEntry[]
  refreshing: boolean
  onRefresh: () => void
}

export function CodeChangeHistorySection({
  history,
  refreshing,
  onRefresh,
}: CodeChangeHistorySectionProps) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
        <div>
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Code Changes history</p>
          <p className="text-[11px] text-gray-500">Audit trail of investigations, patches, verification, and git actions.</p>
        </div>
        <Button
          variant="secondary"
          onClick={onRefresh}
          disabled={refreshing}
          className="text-[11px] px-2 py-1"
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>
      <div className="max-h-[28rem] overflow-y-auto">
        {history.length === 0 ? (
          <p className="p-3 text-xs text-gray-400">No Code Changes history yet.</p>
        ) : (
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800/70">
              <tr className="border-b border-gray-100 dark:border-gray-800">
                <th className="px-3 py-1.5 text-left font-medium text-gray-500">Request</th>
                <th className="px-2 py-1.5 text-left font-medium text-gray-500">Status</th>
                <th className="px-2 py-1.5 text-left font-medium text-gray-500">Model</th>
                <th className="px-2 py-1.5 text-left font-medium text-gray-500">Steps</th>
                <th className="px-2 py-1.5 text-left font-medium text-gray-500">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {history.map((entry) => (
                <tr key={entry.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                  <td className="px-3 py-1.5 max-w-[140px]">
                    <span className="block truncate text-gray-700 dark:text-gray-300 font-medium">{entry.reportTitle || entry.reportId.slice(0, 8)}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                      entry.status === 'reloaded' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' :
                      entry.status === 'rolled-back' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' :
                      entry.status === 'failed' || entry.status === 'verify-failed' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' :
                      entry.status === 'verified' || entry.status === 'committed' || entry.status === 'pushed' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' :
                      'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                    }`}>{entry.status}</span>
                  </td>
                  <td className="px-2 py-1.5 text-gray-500 font-mono max-w-[100px]">
                    <span className="block truncate">{entry.investigationModel ?? '—'}</span>
                  </td>
                  <td className="px-2 py-1.5 text-gray-400">
                    <span className="flex gap-1">
                      {entry.verificationPassed && <span title="Verified">✓V</span>}
                      {entry.committed && <span title="Committed">✓C</span>}
                      {entry.pushed && <span title="Pushed">✓P</span>}
                      {entry.reloaded && <span title="Reloaded">✓R</span>}
                      {entry.rolledBack && <span title="Rolled back">↩</span>}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-gray-400 whitespace-nowrap">
                    {new Date(entry.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
