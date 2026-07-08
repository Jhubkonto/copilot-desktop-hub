import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import { app } from 'electron'
import { safeHandle } from './safe-handle'
import {
  DEFAULT_PROVIDER_MODEL,
  NO_PROVIDER_CONFIGURED_MESSAGE,
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
import type { ManualWorkflowGeneratorMessage, ManualWorkflowSpec, ProjectConfig } from '../shared/types'
import { getDatabase } from './database'
import { broadcastToMobile } from './ws-server'
import { parseProjectConfig } from './project-handlers'

export const MANUAL_WORKFLOW_SPEC_OPEN_TAG = '<manual-workflow-spec>'
export const MANUAL_WORKFLOW_SPEC_CLOSE_TAG = '</manual-workflow-spec>'

const MANUAL_WORKFLOW_GENERATOR_SYSTEM_PROMPT = `You are an expert workflow planner for Nexy.

Your job is to turn a project goal into a manual delegation workflow the user can execute step by step with agents.

Requirements:
- Produce a short assistant response that explains the plan.
- Then emit JSON wrapped in <manual-workflow-spec>...</manual-workflow-spec> tags.
- Keep the workflow executable by a human manually copying prompts into chats.
- Prefer 2-6 steps.
- Every step must include:
  - id
  - title
  - summary
  - prompt
  - expectedOutput
- Include agentId only when the provided project context contains a matching agent id.
- Include agentName when you assign a step to a project agent.
- dependsOnStepIds is optional.
- assumptions should be short and concrete.

JSON shape:
{
  "title": "Workflow title",
  "goalSummary": "Short summary of the user goal",
  "assumptions": ["Assumption 1"],
  "steps": [
    {
      "id": "step-1",
      "title": "Plan the work",
      "summary": "Clarify the work breakdown",
      "agentId": "optional-agent-id",
      "agentName": "optional-agent-name",
      "prompt": "Prompt text to send",
      "expectedOutput": "What the step should produce",
      "dependsOnStepIds": []
    }
  ]
}`

let _manualWorkflowGeneratorModel: string | null = null

interface ProjectWorkflowContext {
  projectId: string
  projectName: string
  config: ProjectConfig
  agents: Array<{
    agentId: string
    agentName: string
    agentIcon: string
    isPrimary: boolean
  }>
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function getFallbackGeneratorModel(): string {
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

export function getManualWorkflowGeneratorModel(): string {
  return _manualWorkflowGeneratorModel ?? getFallbackGeneratorModel()
}

export function setManualWorkflowGeneratorModel(modelId: string | null): void {
  _manualWorkflowGeneratorModel = modelId || null
}

function loadProjectWorkflowContext(projectId: string): ProjectWorkflowContext {
  const db = getDatabase()
  const projectRow = db.prepare('SELECT id, name, config_json FROM projects WHERE id = ?').get(projectId) as {
    id: string
    name: string
    config_json: string | null
  } | undefined
  if (!projectRow) throw new Error('Project not found')

  const config = parseProjectConfig(projectRow.config_json)
  const agents = db.prepare(`
    SELECT pa.agent_id, pa.is_primary, a.config_json
    FROM project_agents pa
    JOIN agents a ON a.id = pa.agent_id
    WHERE pa.project_id = ?
    ORDER BY pa.is_primary DESC, pa.sort_order ASC, pa.added_at ASC
  `).all(projectId) as Array<{
    agent_id: string
    is_primary: number
    config_json: string
  }>

  return {
    projectId: projectRow.id,
    projectName: projectRow.name,
    config,
    agents: agents.map((row) => {
      const cfg = JSON.parse(row.config_json) as { name?: string; icon?: string }
      return {
        agentId: row.agent_id,
        agentName: cfg.name ?? 'Unnamed agent',
        agentIcon: cfg.icon ?? '🤖',
        isPrimary: row.is_primary === 1,
      }
    }),
  }
}

function substituteVariables(text: string, variables: ProjectConfig['variables']): string {
  let result = text
  for (const { key, value } of variables) {
    result = result.replaceAll(`{{${key}}}`, value)
  }
  return result
}

function buildProjectContextBlock(project: ProjectWorkflowContext): string {
  const scopeLines = [
    ...project.config.inScope.map((rule) => `IN: ${rule.description}${rule.pathGlob ? ` (${rule.pathGlob})` : ''}`),
    ...project.config.outOfScope.map((rule) => `OUT: ${rule.description}${rule.pathGlob ? ` (${rule.pathGlob})` : ''}`),
  ]
  const milestoneLines = project.config.milestones.map((m) => `${m.status.toUpperCase()}: ${m.title}${m.description ? ` - ${m.description}` : ''}`)
  const agentLines = project.agents.map((agent) => `${agent.agentId} | ${agent.agentName}${agent.isPrimary ? ' [primary]' : ''}`)
  const instructions = substituteVariables(project.config.instructions || '', project.config.variables)

  return [
    `Project: ${project.projectName}`,
    `Project ID: ${project.projectId}`,
    `Workflow mode: ${project.config.workflowMode}`,
    `Root directory: ${project.config.rootDirectory || '(not set)'}`,
    `Project instructions: ${instructions || '(none)'}`,
    `Agents:`,
    ...(agentLines.length > 0 ? agentLines.map((line) => `- ${line}`) : ['- (no project agents assigned)']),
    `Scope:`,
    ...(scopeLines.length > 0 ? scopeLines.map((line) => `- ${line}`) : ['- (no scope rules)']),
    `Milestones:`,
    ...(milestoneLines.length > 0 ? milestoneLines.map((line) => `- ${line}`) : ['- (no milestones)']),
  ].join('\n')
}

function buildProviderMessages(projectId: string, messages: ManualWorkflowGeneratorMessage[]): { providerMessages: ProviderMessage[]; cwd: string } {
  const project = loadProjectWorkflowContext(projectId)
  const filtered = messages[0]?.role === 'assistant' ? messages.slice(1) : messages
  const providerMessages: ProviderMessage[] = [
    { role: 'system', content: `${MANUAL_WORKFLOW_GENERATOR_SYSTEM_PROMPT}\n\nProject context:\n${buildProjectContextBlock(project)}` },
    ...filtered.map((message): ProviderMessage => ({
      role: message.role,
      content: substituteVariables(message.content, project.config.variables),
    })),
  ]
  const cwd = project.config.rootDirectory?.trim() || app.getPath('temp')
  return { providerMessages, cwd }
}

export function normalizeManualWorkflowSpec(raw: Record<string, unknown>): ManualWorkflowSpec {
  const stepsRaw = Array.isArray(raw.steps) ? raw.steps : []
  const steps = stepsRaw
    .map((step, index) => {
      const value = typeof step === 'object' && step !== null ? step as Record<string, unknown> : {}
      const id = optionalString(value.id) ?? `step-${index + 1}`
      const title = optionalString(value.title) ?? `Step ${index + 1}`
      const summary = optionalString(value.summary) ?? ''
      const prompt = optionalString(value.prompt) ?? ''
      const expectedOutput = optionalString(value.expectedOutput) ?? ''
      if (!prompt) return null
      const dependsOnStepIds = Array.isArray(value.dependsOnStepIds)
        ? value.dependsOnStepIds.filter((dep): dep is string => typeof dep === 'string' && dep.trim().length > 0)
        : undefined
      return {
        id,
        title,
        summary,
        agentId: optionalString(value.agentId),
        agentName: optionalString(value.agentName),
        prompt,
        expectedOutput,
        dependsOnStepIds: dependsOnStepIds && dependsOnStepIds.length > 0 ? dependsOnStepIds : undefined,
      }
    })
    .filter((step): step is NonNullable<typeof step> => step !== null)

  if (steps.length === 0) throw new Error('Manual workflow requires at least one step')

  return {
    title: optionalString(raw.title) ?? 'Manual workflow',
    goalSummary: optionalString(raw.goalSummary) ?? '',
    assumptions: Array.isArray(raw.assumptions)
      ? raw.assumptions.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [],
    steps,
  }
}

export function extractManualWorkflowSpec(text: string): ManualWorkflowSpec | null {
  const openIdx = text.lastIndexOf(MANUAL_WORKFLOW_SPEC_OPEN_TAG)
  if (openIdx === -1) return null
  const closeIdx = text.lastIndexOf(MANUAL_WORKFLOW_SPEC_CLOSE_TAG)
  if (closeIdx === -1 || closeIdx <= openIdx) return null
  const json = text.slice(openIdx + MANUAL_WORKFLOW_SPEC_OPEN_TAG.length, closeIdx).trim()
  try {
    return normalizeManualWorkflowSpec(JSON.parse(json) as Record<string, unknown>)
  } catch {
    return null
  }
}

export async function runManualWorkflowProviderChat(
  win: BrowserWindow,
  providerMessages: ProviderMessage[],
  sessionId: string,
  sendChunk: (chunk: string) => void,
  cwd: string,
  modelOverride?: string,
): Promise<string> {
  const selectedModel = modelOverride ?? getManualWorkflowGeneratorModel()

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
      : MANUAL_WORKFLOW_GENERATOR_SYSTEM_PROMPT
    const conversationMessages = providerMessages.filter((message) => message.role !== 'system')
    return adapter.send(
      win,
      { systemPrompt: systemMsg, messages: conversationMessages, cwd, model: cliModel, conversationId: sessionId },
      sendChunk,
    )
  }

  const { provider, model } = getProviderForAgent(selectedModel)
  const apiKey = getApiKey(provider)
  if (!apiKey) {
    throw new Error(NO_PROVIDER_CONFIGURED_MESSAGE)
  }
  const systemPrompt = typeof providerMessages[0]?.content === 'string'
    ? providerMessages[0].content
    : MANUAL_WORKFLOW_GENERATOR_SYSTEM_PROMPT

  return dispatchToProvider({
    providerName: provider,
    providerModel: model,
    byokKey: apiKey,
    chatMessages: providerMessages,
    toolDefs: [],
    toolMap: new Map(),
    effectiveAgentId: null,
    agenticMode: false,
    wikiInlineHandlers: new Map(),
    toolDirective: '',
    generationOptions: { maxTokens: 4096, temperature: 0.5 },
    conversationId: sessionId,
    webContents: win.webContents,
    sendChunk,
    sendActivity: () => {},
    systemPrompt,
  })
}

export async function runManualWorkflowGeneratorChat(
  win: BrowserWindow,
  projectId: string,
  messages: ManualWorkflowGeneratorMessage[],
  modelOverride?: string,
): Promise<void> {
  const { providerMessages, cwd } = buildProviderMessages(projectId, messages)
  const sessionId = `manual-workflow-gen-${randomUUID()}`
  let accumulated = ''

  try {
    const fullText = await runManualWorkflowProviderChat(
      win,
      providerMessages,
      sessionId,
      (chunk) => {
        accumulated += chunk
        if (!win.isDestroyed()) win.webContents.send('manual-workflow-generator:token', chunk)
      },
      cwd,
      modelOverride,
    )

    accumulated = fullText || accumulated
    if (!accumulated.trim()) {
      throw new Error(`Manual workflow generator returned no response from ${modelOverride ?? getManualWorkflowGeneratorModel()}. Check the selected model/provider or choose a different model.`)
    }

    const spec = extractManualWorkflowSpec(accumulated)
    if (!win.isDestroyed()) {
      if (spec) win.webContents.send('manual-workflow-generator:spec-ready', spec)
      win.webContents.send('manual-workflow-generator:done', { hasSpec: spec !== null })
    }
  } catch (error) {
    if (!win.isDestroyed()) {
      win.webContents.send('manual-workflow-generator:error', {
        message: error instanceof Error ? error.message : String(error),
      })
    }
    throw error
  }
}

export async function runManualWorkflowGeneratorChatForAndroid(
  projectId: string,
  messages: ManualWorkflowGeneratorMessage[],
  sessionId = `manual-workflow-gen-android-${randomUUID()}`,
  modelOverride?: string,
): Promise<void> {
  const { providerMessages, cwd } = buildProviderMessages(projectId, messages)
  const fakeWin = { isDestroyed: () => false, webContents: { send: () => {}, isDestroyed: () => false } } as unknown as BrowserWindow
  let accumulated = ''

  const fullText = await runManualWorkflowProviderChat(
    fakeWin,
    providerMessages,
    sessionId,
    (chunk) => {
      accumulated += chunk
      broadcastToMobile({ event: 'manual-workflow-generator:token', data: { sessionId, chunk } })
    },
    cwd,
    modelOverride,
  )

  accumulated = fullText || accumulated
  if (!accumulated.trim()) {
    broadcastToMobile({
      event: 'manual-workflow-generator:error',
      data: { sessionId, message: 'Manual workflow generator returned no response. Check the selected model/provider.' },
    })
    return
  }

  const spec = extractManualWorkflowSpec(accumulated)
  const assistantText = accumulated.replace(/<manual-workflow-spec>[\s\S]*?<\/manual-workflow-spec>/g, '').trim()
  broadcastToMobile({ event: 'manual-workflow-generator:turn-complete', data: { sessionId, content: assistantText, hasSpec: spec !== null } })
  if (spec) {
    broadcastToMobile({ event: 'manual-workflow-generator:spec-ready', data: { sessionId, spec } })
  }
}

export function registerManualWorkflowGeneratorHandlers(win?: BrowserWindow): void {
  safeHandle('manual-workflow-generator:chat', async (_event, projectId: string, messages: ManualWorkflowGeneratorMessage[], modelOverride?: string) => {
    if (!win) throw new Error('No main window available')
    await runManualWorkflowGeneratorChat(win, projectId, messages, modelOverride)
    return { started: true }
  })

  safeHandle('manual-workflow-generator:get-model', () => getManualWorkflowGeneratorModel())

  safeHandle('manual-workflow-generator:set-model', (_event, modelId: string) => {
    setManualWorkflowGeneratorModel(modelId)
    return undefined
  })
}
