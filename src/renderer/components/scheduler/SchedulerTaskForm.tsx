import { useState } from 'react'
import { X } from 'lucide-react'
import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskUpdateInput,
  ScheduleType,
  SchedulerNotificationPref,
} from '../../../shared/types'
import { isApiError } from '../../../shared/types'
import { useAppStore } from '../../store/app-store'

const SCHEDULE_TYPES: { value: ScheduleType; label: string }[] = [
  { value: 'one-time', label: 'One-time' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays (Mon–Fri)' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
]

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const NOTIFICATION_PREFS: { value: SchedulerNotificationPref; label: string }[] = [
  { value: 'always', label: 'Always' },
  { value: 'failures_only', label: 'Failures only' },
  { value: 'off', label: 'Off' },
]

interface Props {
  initial: ScheduledTask | null
  onSave: (task: ScheduledTask) => void
  onCancel: () => void
}

export function SchedulerTaskForm({ initial, onSave, onCancel }: Props) {
  const agents = useAppStore((s) => s.agents)
  const projects = useAppStore((s) => s.projects)

  const [name, setName] = useState(initial?.name ?? '')
  const [prompt, setPrompt] = useState(initial?.prompt ?? '')
  const [scheduleType, setScheduleType] = useState<ScheduleType>(initial?.scheduleType ?? 'daily')
  const [localTime, setLocalTime] = useState(initial?.localTime ?? '09:00')
  const [weekday, setWeekday] = useState<number>(initial?.weekday ?? 1)
  const [monthDay, setMonthDay] = useState<number>(initial?.monthDay ?? 1)
  const [timezone, setTimezone] = useState(initial?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [agentId, setAgentId] = useState<string>(initial?.agentId ?? '')
  const [projectId, setProjectId] = useState<string>(initial?.projectId ?? '')
  const [model, setModel] = useState(initial?.model ?? '')
  const [notificationPref, setNotificationPref] = useState<SchedulerNotificationPref>(initial?.notificationPref ?? 'failures_only')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    if (!prompt.trim()) { setError('Prompt is required'); return }
    setError(null)
    setSaving(true)
    try {
      if (initial) {
        const input: ScheduledTaskUpdateInput = {
          name: name.trim(),
          prompt: prompt.trim(),
          scheduleType,
          localTime,
          weekday: scheduleType === 'weekly' ? weekday : null,
          monthDay: scheduleType === 'monthly' ? monthDay : null,
          timezone,
          agentId: agentId || null,
          projectId: projectId || null,
          model: model || null,
          notificationPref,
        }
        const result = await window.api.schedulerUpdate(initial.id, input)
        if (isApiError(result)) { setError(result.error); return }
        if (result.warnings?.length) setError(`Saved with warnings: ${result.warnings.join('; ')}`)
        onSave(result.task)
      } else {
        const input: ScheduledTaskCreateInput = {
          name: name.trim(),
          prompt: prompt.trim(),
          scheduleType,
          localTime,
          weekday: scheduleType === 'weekly' ? weekday : null,
          monthDay: scheduleType === 'monthly' ? monthDay : null,
          timezone,
          agentId: agentId || null,
          projectId: projectId || null,
          model: model || null,
          notificationPref,
          enabled: true,
        }
        const result = await window.api.schedulerCreate(input)
        if (isApiError(result)) { setError(result.error); return }
        if (result.warnings?.length) setError(`Saved with warnings: ${result.warnings.join('; ')}`)
        onSave(result.task)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 top-9 z-50 flex" role="dialog" aria-modal="true" aria-label={initial ? 'Edit scheduled task' : 'Create scheduled task'}>
      <div className="flex-1 bg-black/30" onClick={onCancel} aria-hidden="true" />
      <div className="relative w-[440px] max-w-[92vw] bg-white dark:bg-gray-900 shadow-xl flex flex-col border-l border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <h2 className="text-sm font-medium text-gray-800 dark:text-gray-100">
          {initial ? 'Edit Scheduled Task' : 'Create Scheduled Task'}
        </h2>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="Close scheduler task panel"
          >
            <X className="w-4 h-4" />
          </button>
      </div>

      {/* Form */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 mr-1.5">
        {error && (
          <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded px-2 py-1">{error}</p>
        )}

        <section className="space-y-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Task</p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Daily standup summary"
            className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should the agent do?"
            rows={6}
            className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
          />
        </section>

        <section className="space-y-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Schedule</p>
          <select
            value={scheduleType}
            onChange={(e) => setScheduleType(e.target.value as ScheduleType)}
            className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          >
            {SCHEDULE_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>

        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Time</label>
            <input
              type="time"
              value={localTime}
              onChange={(e) => setLocalTime(e.target.value)}
              className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </div>

          {scheduleType === 'weekly' && (
            <div className="flex-1">
              <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Day of week</label>
              <select
                value={weekday}
                onChange={(e) => setWeekday(Number(e.target.value))}
                className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              >
                {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </div>
          )}

          {scheduleType === 'monthly' && (
            <div className="flex-1">
              <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Day of month</label>
              <input
                type="number"
                min={1}
                max={31}
                value={monthDay}
                onChange={(e) => setMonthDay(Number(e.target.value))}
                className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
          )}
        </div>

          <input
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="e.g. America/New_York"
            className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            aria-label="Timezone"
          />
        </section>

        <section className="space-y-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Context</p>
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            aria-label="Agent"
          >
            <option value="">Default agent</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
          </select>

          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            aria-label="Project"
          >
            <option value="">No project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. claude-sonnet-4-6"
            className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
        </section>

        <section className="space-y-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Notifications</p>
          <select
            value={notificationPref}
            onChange={(e) => setNotificationPref(e.target.value as SchedulerNotificationPref)}
            className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          >
            {NOTIFICATION_PREFS.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
          </select>
        </section>
      </div>

      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700 shrink-0">
        <button
          onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-xs px-4 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving...' : initial ? 'Save' : 'Create'}
        </button>
      </div>
        </div>
      </div>
  )
}
