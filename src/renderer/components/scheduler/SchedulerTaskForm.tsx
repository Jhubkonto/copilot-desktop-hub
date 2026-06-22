import { useState } from 'react'
import { ArrowLeft, Save } from 'lucide-react'
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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 dark:border-gray-800 shrink-0">
        <button
          onClick={onCancel}
          className="p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 flex-1">
          {initial ? 'Edit Task' : 'New Task'}
        </h3>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1 px-2 py-1 rounded bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-medium"
        >
          <Save className="w-3 h-3" />
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* Form */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {error && (
          <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded px-2 py-1">{error}</p>
        )}

        <div>
          <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Daily standup summary"
            className="w-full text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should the agent do?"
            rows={4}
            className="w-full text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500 resize-none"
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Schedule</label>
          <select
            value={scheduleType}
            onChange={(e) => setScheduleType(e.target.value as ScheduleType)}
            className="w-full text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500"
          >
            {SCHEDULE_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Time</label>
            <input
              type="time"
              value={localTime}
              onChange={(e) => setLocalTime(e.target.value)}
              className="w-full text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>

          {scheduleType === 'weekly' && (
            <div className="flex-1">
              <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Day of week</label>
              <select
                value={weekday}
                onChange={(e) => setWeekday(Number(e.target.value))}
                className="w-full text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500"
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
                className="w-full text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
            </div>
          )}
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Timezone</label>
          <input
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="e.g. America/New_York"
            className="w-full text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Agent (optional)</label>
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="w-full text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500"
          >
            <option value="">Default agent</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Project (optional)</label>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500"
          >
            <option value="">No project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Model override (optional)</label>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. claude-sonnet-4-6"
            className="w-full text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Notifications</label>
          <select
            value={notificationPref}
            onChange={(e) => setNotificationPref(e.target.value as SchedulerNotificationPref)}
            className="w-full text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500"
          >
            {NOTIFICATION_PREFS.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
          </select>
        </div>
      </div>
    </div>
  )
}
