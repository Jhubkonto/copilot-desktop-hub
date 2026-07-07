import { Loader2 } from 'lucide-react'
import { useAppStore } from '../store/app-store'

export function BackgroundActivityDock() {
  const activities = useAppStore((s) => s.backgroundActivities)
  const openBackgroundActivity = useAppStore((s) => s.openBackgroundActivity)

  if (activities.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-30 flex flex-col gap-2 pointer-events-none">
      {activities.map((activity) => (
        <button
          key={activity.id}
          type="button"
          onClick={() => openBackgroundActivity(activity)}
          className="pointer-events-auto flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-left text-xs text-gray-700 shadow-lg transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
          aria-label={`Open ${activity.label}`}
          title="Open active generator"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
          <span className="max-w-52 truncate">{activity.label}</span>
          {activity.detail && (
            <span className="max-w-32 truncate text-[10px] text-gray-400 dark:text-gray-500">
              {activity.detail}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
