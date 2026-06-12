import type { ProjectAgent, Conversation } from '../../store/types'
export type { Conversation } from '../../store/types'

export const PANE_MIN = 220
export const PANE_MAX = 500

export const PROJECT_COLOR_MAP: Record<string, { bg: string; dot: string; ring: string }> = {
  blue:   { bg: 'bg-blue-50 dark:bg-blue-900/20',     dot: 'bg-blue-500',   ring: 'ring-blue-300 dark:ring-blue-700' },
  green:  { bg: 'bg-green-50 dark:bg-green-900/20',   dot: 'bg-green-500',  ring: 'ring-green-300 dark:ring-green-700' },
  red:    { bg: 'bg-red-50 dark:bg-red-900/20',       dot: 'bg-red-500',    ring: 'ring-red-300 dark:ring-red-700' },
  purple: { bg: 'bg-purple-50 dark:bg-purple-900/20', dot: 'bg-purple-500', ring: 'ring-purple-300 dark:ring-purple-700' },
  orange: { bg: 'bg-orange-50 dark:bg-orange-900/20', dot: 'bg-orange-500', ring: 'ring-orange-300 dark:ring-orange-700' },
  pink:   { bg: 'bg-pink-50 dark:bg-pink-900/20',     dot: 'bg-pink-500',   ring: 'ring-pink-300 dark:ring-pink-700' },
  yellow: { bg: 'bg-yellow-50 dark:bg-yellow-900/20', dot: 'bg-yellow-500', ring: 'ring-yellow-300 dark:ring-yellow-700' },
  gray:   { bg: 'bg-gray-50 dark:bg-gray-800',        dot: 'bg-gray-400',   ring: 'ring-gray-300 dark:ring-gray-700' },
}
export const COLOR_OPTIONS = Object.keys(PROJECT_COLOR_MAP)

export function AgentAvatarStack({ members }: { members: ProjectAgent[] }) {
  if (members.length === 0) return null
  const visible = members.slice(0, 3)
  const overflow = members.length - visible.length
  return (
    <div className="flex items-center -space-x-1 shrink-0">
      {visible.map((m) => (
        <span
          key={m.agentId}
          className="w-5 h-5 rounded-full bg-gray-100 dark:bg-gray-700 border border-white dark:border-gray-800 flex items-center justify-center text-[10px] leading-none"
          title={m.agentName}
        >
          {m.agentIcon}
        </span>
      ))}
      {overflow > 0 && (
        <span className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-600 border border-white dark:border-gray-800 flex items-center justify-center text-[9px] font-medium text-gray-500 dark:text-gray-400 leading-none">
          +{overflow}
        </span>
      )}
    </div>
  )
}

export function isPinned(c: Conversation) { return c.pinned === 1 }

export function groupByDate(conversations: Conversation[]) {
  const todayStart = new Date().setHours(0, 0, 0, 0)
  const yesterdayStart = todayStart - 86400000
  const weekStart = todayStart - 7 * 86400000

  const groups: { label: string; items: Conversation[] }[] = []
  const add = (label: string, items: Conversation[]) => { if (items.length) groups.push({ label, items }) }
  add('Today',     conversations.filter((c) => c.updated_at >= todayStart))
  add('Yesterday', conversations.filter((c) => c.updated_at >= yesterdayStart && c.updated_at < todayStart))
  add('This Week', conversations.filter((c) => c.updated_at >= weekStart && c.updated_at < yesterdayStart))
  add('Older',     conversations.filter((c) => c.updated_at < weekStart))
  return groups
}
