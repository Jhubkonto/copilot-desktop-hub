import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type {
  AutomatedWorkflowRunSummary,
  AutomatedWorkflowSpec,
  McpTool,
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskTargetType,
  ScheduledTaskUpdateInput,
  ScheduleType,
  SchedulerNotificationPref,
} from '../../../shared/types'
import { isApiError } from '../../../shared/types'
import { useAppStore } from '../../store/app-store'
import { Button } from '../ui/primitives'

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

  // Tool policy: a scheduled run is headless, so tool-loop.ts blocks any tool not pre-approved
  // here (there's no human to approve a pause). Without this a tool-using agent silently can't
  // call any of its tools when the task fires.
  const [preApproved, setPreApproved] = useState<string[]>(initial?.toolPolicy?.preApproved ?? [])
  const [availableTools, setAvailableTools] = useState<McpTool[]>([])
  const [toolsLoading, setToolsLoading] = useState(false)

  const toggleTool = (name: string) =>
    setPreApproved((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))

  // Target: a plain chat prompt (default, unchanged behavior) or one attached Automated Workflow
  // run (see src/roadmap-new/ — schedules can target a saved workflow instead of a chat message).
  const [targetType, setTargetType] = useState<ScheduledTaskTargetType>(initial?.targetType ?? 'chat')
  const [workflowOptions, setWorkflowOptions] = useState<AutomatedWorkflowRunSummary[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initial?.workflowSpecs[0]?.sourceRunId ?? null)
  const [selectedRunSpec, setSelectedRunSpec] = useState<AutomatedWorkflowSpec | null>(null)

  // Fetch candidates + repopulate the frozen spec for an already-attached run lazily — only once
  // the user actually looks at this section, not on every form open.
  useEffect(() => {
    if (targetType !== 'automated_workflow' || workflowOptions.length > 0) return
    window.api.schedulerListWorkflowTemplates().then((result) => {
      if (!isApiError(result)) setWorkflowOptions(result)
    }).catch(() => {})
  }, [targetType, workflowOptions.length])

  useEffect(() => {
    if (!selectedRunId || selectedRunSpec) return
    window.api.getAutomatedWorkflowRun(selectedRunId).then((detail) => {
      if (detail && !isApiError(detail)) {
        setSelectedRunSpec({
          title: detail.title,
          goalSummary: detail.goalSummary,
          assumptions: detail.assumptions,
          steps: detail.steps.map((s) => ({
            id: s.id,
            title: s.title,
            summary: s.summary,
            agentId: s.agentId,
            agentName: s.agentName,
            model: s.model,
            prompt: s.prompt,
            expectedOutput: s.expectedOutput,
            dependsOnStepIds: s.dependsOnStepIds,
          })),
        })
      }
    }).catch(() => {})
  }, [selectedRunId, selectedRunSpec])

  const handleSelectWorkflow = (runId: string) => {
    setSelectedRunId(runId || null)
    setSelectedRunSpec(null)
  }

  // Load the selected agent's available MCP tools so they can be pre-approved. Only meaningful for
  // a chat-target task; a workflow's own steps carry their own agents/tools.
  useEffect(() => {
    if (targetType !== 'chat' || !agentId) {
      setAvailableTools([])
      return
    }
    let cancelled = false
    setToolsLoading(true)
    window.api.listMcpToolsForAgent(agentId)
      .then((tools) => {
        if (cancelled) return
        setAvailableTools(Array.isArray(tools) ? tools : [])
      })
      .catch(() => { if (!cancelled) setAvailableTools([]) })
      .finally(() => { if (!cancelled) setToolsLoading(false) })
    return () => { cancelled = true }
  }, [agentId, targetType])

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    if (targetType === 'chat' && !prompt.trim()) { setError('Prompt is required'); return }
    if (targetType === 'automated_workflow' && (!selectedRunId || !selectedRunSpec)) { setError('Choose a workflow to attach'); return }
    setError(null)
    setSaving(true)
    try {
      const workflowSpecs = targetType === 'automated_workflow' && selectedRunSpec
        ? [{ workflowSpecJson: JSON.stringify(selectedRunSpec), sourceRunId: selectedRunId, confirmationMode: 'auto' as const }]
        : undefined
      if (initial) {
        const input: ScheduledTaskUpdateInput = {
          name: name.trim(),
          prompt: targetType === 'chat' ? prompt.trim() : '',
          scheduleType,
          localTime,
          weekday: scheduleType === 'weekly' ? weekday : null,
          monthDay: scheduleType === 'monthly' ? monthDay : null,
          timezone,
          agentId: agentId || null,
          projectId: projectId || null,
          model: model || null,
          notificationPref,
          toolPolicy: { preApproved },
          targetType,
          workflowSpecs,
        }
        const result = await window.api.schedulerUpdate(initial.id, input)
        if (isApiError(result)) { setError(result.error); return }
        if (result.warnings?.length) setError(`Saved with warnings: ${result.warnings.join('; ')}`)
        onSave(result.task)
      } else {
        const input: ScheduledTaskCreateInput = {
          name: name.trim(),
          prompt: targetType === 'chat' ? prompt.trim() : '',
          scheduleType,
          localTime,
          weekday: scheduleType === 'weekly' ? weekday : null,
          monthDay: scheduleType === 'monthly' ? monthDay : null,
          timezone,
          agentId: agentId || null,
          projectId: projectId || null,
          model: model || null,
          notificationPref,
          toolPolicy: { preApproved },
          enabled: true,
          targetType,
          workflowSpecs,
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

          <div className="inline-flex rounded-md overflow-hidden border border-gray-200 dark:border-gray-700 text-[10px]">
            {(['chat', 'automated_workflow'] as ScheduledTaskTargetType[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTargetType(value)}
                aria-pressed={targetType === value}
                className={`px-2 py-1 font-medium transition-colors ${
                  targetType === value
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                {value === 'chat' ? 'Standalone task' : 'Automated Workflow'}
              </button>
            ))}
          </div>

          {targetType === 'chat' ? (
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What should the agent do?"
              rows={6}
              className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
            />
          ) : (
            <div className="space-y-1.5">
              <select
                value={selectedRunId ?? ''}
                onChange={(e) => handleSelectWorkflow(e.target.value)}
                className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                aria-label="Automated workflow to attach"
              >
                <option value="">Select a saved workflow…</option>
                {workflowOptions.map((run) => (
                  <option key={run.id} value={run.id}>{run.title}{run.goalSummary ? ` — ${run.goalSummary}` : ''}</option>
                ))}
              </select>
              <p className="text-[10px] text-gray-400 dark:text-gray-500">
                Attaches a copy of that workflow's current steps — later edits to the original plan won't affect this schedule. Each firing runs the plan through automatically (no per-step review).
              </p>
            </div>
          )}
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
          <p className="text-[10px] text-gray-400 dark:text-gray-500">
            With Run in background enabled, tasks continue while Nexy is in the desktop tray. The computer must stay awake and signed in; missed runs catch up the next time Nexy starts.
          </p>
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

        {targetType === 'chat' && (
          <section className="space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Allowed tools</p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500">
              Scheduled tasks run unattended, so the agent can only call tools you pre-approve here — everything else is blocked when the task fires.
            </p>
            {!agentId ? (
              <p className="text-[11px] text-gray-500 dark:text-gray-400">Select an agent to choose which of its tools may run.</p>
            ) : toolsLoading ? (
              <p className="text-[11px] text-gray-400 dark:text-gray-500">Loading tools…</p>
            ) : availableTools.length === 0 ? (
              <p className="text-[11px] text-gray-500 dark:text-gray-400">This agent has no MCP tools available.</p>
            ) : (
              <div className="space-y-1 max-h-44 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 p-2">
                {availableTools.map((tool) => (
                  <label key={`${tool.serverId}:${tool.name}`} className="flex items-start gap-2 text-[11px] text-gray-700 dark:text-gray-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={preApproved.includes(tool.name)}
                      onChange={() => toggleTool(tool.name)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="font-medium">{tool.name}</span>
                      <span className="text-gray-400 dark:text-gray-500"> · {tool.serverName}</span>
                      {tool.description && <span className="block text-gray-400 dark:text-gray-500 truncate">{tool.description}</span>}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {/* Preserve pre-approved names that aren't in the currently-loaded tool list (e.g. a
                server that's momentarily disconnected) so editing doesn't silently drop them. */}
            {preApproved.filter((n) => !availableTools.some((t) => t.name === n)).map((name) => (
              <label key={`extra-${name}`} className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                <input type="checkbox" checked onChange={() => toggleTool(name)} />
                <span className="italic">{name} (unavailable)</span>
              </label>
            ))}
          </section>
        )}

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
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : initial ? 'Save' : 'Create'}
        </Button>
      </div>
        </div>
      </div>
  )
}
