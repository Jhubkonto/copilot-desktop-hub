import { randomUUID } from 'crypto'
import { app, type BrowserWindow } from 'electron'
import { safeHandle } from './safe-handle'
import {
  DEFAULT_PROVIDER_MODEL,
  PROVIDERS,
  getOpenRouterModels,
  getProviderForAgent,
  getApiKey,
  isProviderConfigured,
} from './providers'
import { dispatchToProvider } from './chat-provider-dispatch'
import { getAdapter } from './cli-adapters/registry'
import { ClaudeAdapter } from './cli-adapters/claude'
import { CodexAdapter } from './cli-adapters/codex'
import { getCliModels } from './cli-detection'
import type { ProviderMessage } from './provider-core-types'
import type { ScheduleGeneratorMessage, ScheduleGeneratorSpec, ScheduleType } from '../shared/types'
import { getDatabase } from './database'
import { broadcastToMobile } from './ws-server'
import { startActivity, endActivity } from './activity-tracker'
import { dbCreateTask, schedulerEngine } from './scheduler-engine'

export const SPEC_OPEN_TAG = '<schedule-spec>'
export const SPEC_CLOSE_TAG = '</schedule-spec>'

const VALID_SCHEDULE_TYPES = new Set<ScheduleType>(['one-time', 'daily', 'weekdays', 'weekly', 'monthly'])
const VALID_NOTIFICATION_PREFS = new Set(['always', 'failures_only', 'off'])

const SCHEDULE_GENERATOR_SYSTEM_PROMPT = `You are an expert schedule configuration assistant for Nexy.

Your job is to help the user create a scheduled AI task. Ask focused questions only when needed, then emit a schedule spec.

Gather:
- task name
- prompt text that will be sent when the task runs
- schedule type: one-time, daily, weekdays, weekly, or monthly
- local time in HH:MM 24-hour format
- timezone
- weekday for weekly tasks, 0-6 where 0 is Sunday
- monthDay for monthly tasks, 1-31
- optional agentId
- optional projectId
- notificationPref: always, failures_only, or off

When ready, emit a short summary followed immediately by JSON wrapped in <schedule-spec>...</schedule-spec> tags. The JSON must match:

{
  "name": "Task name",
  "prompt": "Prompt to run",
  "scheduleType": "daily",
  "localTime": "09:00",
  "weekday": 1,
  "monthDay": 1,
  "timezone": "Europe/Berlin",
  "agentId": null,
  "projectId": null,
  "notificationPref": "always"
}`

let _scheduleGeneratorModel: string | null = null

export function getScheduleGeneratorModel(): string {
  if (_scheduleGeneratorModel) return _scheduleGeneratorModel
  const db = getDatabase()
  const row = db.prepare("SELECT value FROM settings WHERE key = 'default_model'").get() as { value: string } | undefined
  const savedModel = row?.value && row.value !== 'default' ? row.value : DEFAULT_PROVIDER_MODEL
  const savedProvider = getProviderForAgent(savedModel)
  if (isProviderConfigured(savedProvider.provider)) return savedModel

  if (ClaudeAdapter.isAvailable() && getCliModels('claude-cli').some((m) => m.id === savedModel)) {
    return `claude-cli:${savedModel}`
  }
  if (CodexAdapter.isAvailable() && getCliModels('codex-cli').some((m) => m.id === savedModel)) {
    return `codex-cli:${savedModel}`
  }

  const fallbackProvider = PROVIDERS.find((p) => isProviderConfigured(p.name) && p.models.length > 0)
  if (fallbackProvider?.models[0]) {
    return fallbackProvider.name === 'openai'
      ? fallbackProvider.models[0]
      : `${fallbackProvider.name}:${fallbackProvider.models[0]}`
  }
  const openRouterModel = isProviderConfigured('openrouter') ? getOpenRouterModels()[0] : undefined
  if (openRouterModel) return `openrouter:${openRouterModel}`
  throw new Error('No provider is configured. Add an API key in Settings or select a specific model.')
}

export function setScheduleGeneratorModel(modelId: string | null): void {
  _scheduleGeneratorModel = modelId || null
}

function buildProviderMessages(messages: ScheduleGeneratorMessage[]): ProviderMessage[] {
  const filtered = messages[0]?.role === 'assistant' ? messages.slice(1) : messages
  return [
    { role: 'system', content: SCHEDULE_GENERATOR_SYSTEM_PROMPT },
    ...filtered.map((m): ProviderMessage => ({ role: m.role, content: m.content })),
  ]
}

export function extractSpec(text: string): ScheduleGeneratorSpec | null {
  const openIdx = text.lastIndexOf(SPEC_OPEN_TAG)
  if (openIdx === -1) return null
  const closeIdx = text.lastIndexOf(SPEC_CLOSE_TAG)
  if (closeIdx === -1 || closeIdx <= openIdx) return null
  const json = text.slice(openIdx + SPEC_OPEN_TAG.length, closeIdx).trim()
  try {
    return normalizeSpec(JSON.parse(json) as Record<string, unknown>)
  } catch {
    return null
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalBoundedInt(value: unknown, min: number, max: number): number | undefined {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(num) || num < min || num > max) return undefined
  return num
}

export function normalizeSpec(raw: Record<string, unknown>): ScheduleGeneratorSpec {
  const scheduleType = VALID_SCHEDULE_TYPES.has(raw.scheduleType as ScheduleType)
    ? raw.scheduleType as ScheduleType
    : 'daily'
  const localTime = typeof raw.localTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw.localTime)
    ? raw.localTime
    : '09:00'
  const notificationPref = VALID_NOTIFICATION_PREFS.has(String(raw.notificationPref))
    ? raw.notificationPref as ScheduleGeneratorSpec['notificationPref']
    : 'always'

  const spec: ScheduleGeneratorSpec = {
    name: String(raw.name || 'Scheduled task').trim().slice(0, 100),
    prompt: String(raw.prompt || '').trim(),
    scheduleType,
    localTime,
    timezone: optionalString(raw.timezone) ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
    notificationPref,
  }

  const weekday = optionalBoundedInt(raw.weekday, 0, 6)
  if (weekday !== undefined) spec.weekday = weekday
  const monthDay = optionalBoundedInt(raw.monthDay, 1, 31)
  if (monthDay !== undefined) spec.monthDay = monthDay
  const agentId = optionalString(raw.agentId)
  if (agentId) spec.agentId = agentId
  const projectId = optionalString(raw.projectId)
  if (projectId) spec.projectId = projectId

  if (!spec.name) spec.name = 'Scheduled task'
  if (!spec.prompt) throw new Error('Schedule prompt is required')
  if (scheduleType === 'weekly' && spec.weekday === undefined) spec.weekday = 1
  if (scheduleType === 'monthly' && spec.monthDay === undefined) spec.monthDay = 1

  return spec
}

async function runScheduleGeneratorProviderChat(
  win: BrowserWindow,
  providerMessages: ProviderMessage[],
  sessionId: string,
  webContents: Electron.WebContents,
  sendChunk: (chunk: string) => void,
  modelOverride?: string,
): Promise<string> {
  const selectedModel = modelOverride ?? getScheduleGeneratorModel()

  let cliBackend: 'claude-cli' | 'codex-cli' | undefined
  let cliModel = selectedModel
  if (selectedModel.includes(':')) {
    const colonIdx = selectedModel.indexOf(':')
    const prefix = selectedModel.slice(0, colonIdx)
    if (prefix === 'claude-cli' || prefix === 'codex-cli') {
      cliBackend = prefix
      cliModel = selectedModel.slice(colonIdx + 1)
    }
  } else if (ClaudeAdapter.isAvailable() && getCliModels('claude-cli').some((m) => m.id === selectedModel)) {
    cliBackend = 'claude-cli'
  } else if (CodexAdapter.isAvailable() && getCliModels('codex-cli').some((m) => m.id === selectedModel)) {
    cliBackend = 'codex-cli'
  }
  if (cliBackend) {
    const adapter = getAdapter(cliBackend)
    if (!adapter?.isAvailable()) throw new Error(`${cliBackend} is not available`)
    const systemMsg = typeof providerMessages[0]?.content === 'string' && providerMessages[0].role === 'system'
      ? providerMessages[0].content
      : SCHEDULE_GENERATOR_SYSTEM_PROMPT
    const conversationMessages = providerMessages.filter((m) => m.role !== 'system')
    return adapter.send(
      win,
      { systemPrompt: systemMsg, messages: conversationMessages, cwd: app.getPath('temp'), model: cliModel, conversationId: sessionId },
      sendChunk,
    )
  }

  const { provider, model } = getProviderForAgent(selectedModel)
  const apiKey = getApiKey(provider)
  const systemPrompt = typeof providerMessages[0]?.content === 'string'
    ? providerMessages[0].content
    : SCHEDULE_GENERATOR_SYSTEM_PROMPT

  return dispatchToProvider({
    providerName: provider,
    providerModel: model,
    byokKey: apiKey ?? '',
    chatMessages: providerMessages,
    toolDefs: [],
    toolMap: new Map(),
    effectiveAgentId: null,
    agenticMode: false,
    wikiInlineHandlers: new Map(),
    toolDirective: '',
    generationOptions: { maxTokens: 4096, temperature: 0.7 },
    conversationId: sessionId,
    webContents,
    sendChunk,
    sendActivity: () => {},
    systemPrompt,
  })
}

export async function runScheduleGeneratorChat(
  win: BrowserWindow,
  messages: ScheduleGeneratorMessage[],
  modelOverride?: string,
): Promise<void> {
  const providerMessages = buildProviderMessages(messages)
  const sessionId = `schedule-gen-${randomUUID()}`
  let accumulated = ''

  startActivity({ id: 'scheduler-generator', kind: 'scheduler-generator', label: 'Generating scheduled task…' })
  try {
    const fullText = await runScheduleGeneratorProviderChat(
      win,
      providerMessages,
      sessionId,
      win.webContents,
      (chunk) => {
        accumulated += chunk
        if (!win.isDestroyed()) win.webContents.send('scheduler-generator:token', chunk)
      },
      modelOverride,
    )

    accumulated = fullText || accumulated
    if (!accumulated.trim()) {
      throw new Error(`Schedule generator returned no response from ${modelOverride ?? getScheduleGeneratorModel()}. Check the selected model/provider or choose a different model.`)
    }

    const spec = extractSpec(accumulated)
    if (!win.isDestroyed()) {
      if (spec) win.webContents.send('scheduler-generator:spec-ready', spec)
      win.webContents.send('scheduler-generator:done', { hasSpec: spec !== null })
    }
  } catch (error) {
    if (!win.isDestroyed()) {
      win.webContents.send('scheduler-generator:error', {
        message: error instanceof Error ? error.message : String(error),
      })
    }
    throw error
  } finally {
    endActivity('scheduler-generator')
  }
}

export async function runScheduleGeneratorChatForAndroid(
  messages: ScheduleGeneratorMessage[],
  sessionId = `schedule-gen-android-${randomUUID()}`,
  modelOverride?: string,
): Promise<void> {
  const providerMessages = buildProviderMessages(messages)
  const fakeWin = { isDestroyed: () => false, webContents: { send: () => {}, isDestroyed: () => false } } as unknown as BrowserWindow
  let accumulated = ''

  startActivity({ id: 'scheduler-generator', kind: 'scheduler-generator', label: 'Generating scheduled task…' })
  try {
    const fullText = await runScheduleGeneratorProviderChat(
      fakeWin,
      providerMessages,
      sessionId,
      fakeWin.webContents,
      (chunk) => {
        accumulated += chunk
        broadcastToMobile({ event: 'scheduler-generator:token', data: { sessionId, chunk } })
      },
      modelOverride,
    )

    accumulated = fullText || accumulated
    if (!accumulated.trim()) {
      broadcastToMobile({ event: 'scheduler-generator:error', data: { sessionId, message: 'Schedule generator returned no response. Check the selected model/provider.' } })
      return
    }

    const spec = extractSpec(accumulated)
    const assistantText = accumulated.replace(/<schedule-spec>[\s\S]*?<\/schedule-spec>/g, '').trim()
    broadcastToMobile({ event: 'scheduler-generator:turn-complete', data: { sessionId, content: assistantText, hasSpec: spec !== null } })
    if (spec) {
      broadcastToMobile({ event: 'scheduler-generator:spec-ready', data: { sessionId, spec } })
    }
  } finally {
    endActivity('scheduler-generator')
  }
}

export async function createScheduleFromSpec(spec: ScheduleGeneratorSpec): Promise<{ taskId: string; name: string }> {
  const task = dbCreateTask({
    name: spec.name,
    prompt: spec.prompt,
    enabled: true,
    agentId: spec.agentId ?? null,
    projectId: spec.projectId ?? null,
    scheduleType: spec.scheduleType,
    localTime: spec.localTime,
    weekday: spec.weekday ?? null,
    monthDay: spec.monthDay ?? null,
    timezone: spec.timezone,
    notificationPref: spec.notificationPref,
  })
  schedulerEngine.scheduleTask(task)
  broadcastToMobile({ event: 'scheduler:task-updated', data: task })
  return { taskId: task.id, name: task.name }
}

export function registerScheduleGeneratorHandlers(win?: BrowserWindow): void {
  safeHandle('scheduler-generator:chat', async (_event, messages: ScheduleGeneratorMessage[], modelOverride?: string) => {
    if (!win) throw new Error('No main window available')
    await runScheduleGeneratorChat(win, messages, modelOverride)
    return { started: true }
  })

  safeHandle('scheduler-generator:get-model', () => getScheduleGeneratorModel())

  safeHandle('scheduler-generator:set-model', (_event, modelId: string) => {
    setScheduleGeneratorModel(modelId)
    return undefined
  })
}
