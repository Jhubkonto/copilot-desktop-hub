import { Loader2, Zap } from 'lucide-react'
import { useAppStore } from '../store/app-store'
import { ModalShell } from './ui/primitives'

function timeAgo(ts: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

export function ActivityFeedModal() {
  const activities = useAppStore((s) => s.backgroundActivities)
  const openBackgroundActivity = useAppStore((s) => s.openBackgroundActivity)
  const setShowActivityFeed = useAppStore((s) => s.setShowActivityFeed)

  const sorted = [...activities].sort((a, b) => b.startedAt - a.startedAt)

  return (
    <ModalShell
      title="Activity"
      description="Ongoing work across this app and connected devices"
      icon={<Zap className="w-4 h-4 text-blue-500" />}
      maxWidth="max-w-md"
      height="max-h-[70vh]"
      bodyClassName="flex-1 min-h-0 overflow-y-auto p-2"
      onClose={() => setShowActivityFeed(false)}
    >
      {sorted.length === 0 ? (
        <p className="text-center text-xs text-gray-400 dark:text-gray-500 py-8">Nothing in progress right now.</p>
      ) : (
        <div className="space-y-0.5">
          {sorted.map((activity) => (
            <button
              key={activity.id}
              type="button"
              onClick={() => {
                openBackgroundActivity(activity)
                setShowActivityFeed(false)
              }}
              className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 dark:text-gray-200 truncate">{activity.label}</p>
                {activity.detail && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{activity.detail}</p>
                )}
              </div>
              <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">{timeAgo(activity.startedAt)}</span>
            </button>
          ))}
        </div>
      )}
    </ModalShell>
  )
}
