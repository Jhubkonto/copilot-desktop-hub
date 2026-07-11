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
import type { AutomatedWorkflowGeneratorMessage, AutomatedWorkflowSpec, ProjectConfig } from '../shared/types'
import { getDatabase } from './database'
import { broadcastToMobile } from './ws-server'
import { parseProjectConfig } from './project-handlers'
import { startActivity, endActivity } from './activity-tracker'

export const AUTOMATED_WORKFLOW_SPEC_OPEN_TAG = '<automated-workflow-spec>'
export const AUTOMATED_WORKFLOW_SPEC_CLOSE_TAG = '</automated-workflow-spec>'

const AUTOMATED_WORKFLOW_GENERATOR_SYSTEM_PROMPT = `You are an expert workflow planner for Nexy.

Your job is to turn a goal into an automated delegation workflow: a sequence of steps that the user can execute
either one step at a time with a review checkpoint after each step, or all the way through automatically.

Requirements:
- Produce a short assistant response that explains the plan.
- Then emit JSON wrapped in <automated-workflow-spec>...</automated-workflow-spec> tags.
- Each step should be a bounded, self-contained task that can be completed in one turn.
- Prefer 2-6 steps.
- Every step must include:
  - id
  - title
  - summary
  - prompt
  - expectedOutput
- Each step is fulfilled by EITHER an agent OR a model directly — never both, never neither:
  - If the project context lists a matching agent, prefer assigning that step to an agent: include agentId and
    agentName. That agent's own configured skills apply automatically — you never need to think about skills.
  - Otherwise (no project, or no suitable agent), include a "model" field naming a specific model instead of
    agentId/agentName. A model-only step runs as a plain, capable assistant with no skill augmentation — that is
    expected and fine, not a limitation to work around.
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
    },
    {
      "id": "step-2",
      "title": "Draft the announcement",
      "summary": "No suitable agent for this step, so it runs via a bare model",
      "model": "optional-model-id",
      "prompt": "Prompt text to send",
      "expectedOutput": "What the step should produce"
    }
  ]
}`

let _automatedWorkflowGeneratorModel: string | null = null

interface ProjectWorkflowContext {
  projectId: string | null
  projectName: string
  config: ProjectConfig | null
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

export function getAutomatedWorkflowGeneratorModel(): string {
  return _automatedWorkflowGeneratorModel ?? getFallbackGeneratorModel()
}

export function setAutomatedWorkflowGeneratorModel(modelId: string | null): void {
  _automatedWorkflowGeneratorModel = modelId || null
}

function loadProjectWorkflowContext(projectId: string | null): ProjectWorkflowContext {
  // A project-less plan has no project/agents context at all — no project_agents row can exist
  // for a project that doesn't exist, so this naturally (and correctly) biases the generator
  // toward model-mode steps, without any special-casing in the prompt itself.
  if (!projectId) {
    return { projectId: null, projectName: '(no project)', config: null, agents: [] }
  }

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
  if (!project.config) {
    return [
      'This workflow has no project — it is a self-contained, standalone plan.',
      'No project agents are available. Assign every step a "model" field instead of agentId/agentName.',
    ].join('\n')
  }

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
    ...(agentLines.length > 0 ? agentLines.map((line) => `- ${line}`) : ['- (no project agents assigned — assign steps a "model" field instead)']),
    `Scope:`,
    ...(scopeLines.length > 0 ? scopeLines.map((line) => `- ${line}`) : ['- (no scope rules)']),
    `Milestones:`,
    ...(milestoneLines.length > 0 ? milestoneLines.map((line) => `- ${line}`) : ['- (no milestones)']),
  ].join('\n')
}

function buildProviderMessages(projectId: string | null, messages: AutomatedWorkflowGeneratorMessage[]): { providerMessages: ProviderMessage[]; cwd: string } {
  const project = loadProjectWorkflowContext(projectId)
  const filtered = messages[0]?.role === 'assistant' ? messages.slice(1) : messages
  const providerMessages: ProviderMessage[] = [
    { role: 'system', content: `${AUTOMATED_WORKFLOW_GENERATOR_SYSTEM_PROMPT}\n\nContext:\n${buildProjectContextBlock(project)}` },
    ...filtered.map((message): ProviderMessage => ({
      role: message.role,
      content: project.config ? substituteVariables(message.content, project.config.variables) : message.content,
    })),
  ]
  const cwd = project.config?.rootDirectory?.trim() || app.getPath('temp')
  return { providerMessages, cwd }
}

export function normalizeAutomatedWorkflowSpec(raw: Record<string, unknown>): AutomatedWorkflowSpec {
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
        model: optionalString(value.model),
        prompt,
        expectedOutput,
        dependsOnStepIds: dependsOnStepIds && dependsOnStepIds.length > 0 ? dependsOnStepIds : undefined,
      }
    })
    .filter((step): step is NonNullable<typeof step> => step !== null)

  if (steps.length === 0) throw new Error('Automated workflow requires at least one step')

  return {
    title: optionalString(raw.title) ?? 'Automated workflow',
    goalSummary: optionalString(raw.goalSummary) ?? '',
    assumptions: Array.isArray(raw.assumptions)
      ? raw.assumptions.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [],
    steps,
  }
}

export function extractAutomatedWorkflowSpec(text: string): AutomatedWorkflowSpec | null {
  const openIdx = text.lastIndexOf(AUTOMATED_WORKFLOW_SPEC_OPEN_TAG)
  if (openIdx === -1) return null
  const closeIdx = text.lastIndexOf(AUTOMATED_WORKFLOW_SPEC_CLOSE_TAG)
  if (closeIdx === -1 || closeIdx <= openIdx) return null
  const json = text.slice(openIdx + AUTOMATED_WORKFLOW_SPEC_OPEN_TAG.length, closeIdx).trim()
  try {
    return normalizeAutomatedWorkflowSpec(JSON.parse(json) as Record<string, unknown>)
  } catch {
    return null
  }
}

export async function runAutomatedWorkflowProviderChat(
  win: BrowserWindow,
  providerMessages: ProviderMessage[],
  sessionId: string,
  sendChunk: (chunk: string) => void,
  cwd: string,
  modelOverride?: string,
): Promise<string> {
  const selectedModel = modelOverride ?? getAutomatedWorkflowGeneratorModel()

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
      : AUTOMATED_WORKFLOW_GENERATOR_SYSTEM_PROMPT
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
    : AUTOMATED_WORKFLOW_GENERATOR_SYSTEM_PROMPT

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

export async function runAutomatedWorkflowGeneratorChat(
  win: BrowserWindow,
  projectId: string | null,
  messages: AutomatedWorkflowGeneratorMessage[],
  modelOverride?: string,
): Promise<void> {
  const { providerMessages, cwd } = buildProviderMessages(projectId, messages)
  const sessionId = `automated-workflow-gen-${randomUUID()}`
  let accumulated = ''

  const activityId = `automated-workflow-generator:${projectId ?? 'global'}`
  startActivity({ id: activityId, kind: 'automated-workflow-generator', projectId: projectId ?? undefined, label: 'Generating workflow…' })
  try {
    const fullText = await runAutomatedWorkflowProviderChat(
      win,
      providerMessages,
      sessionId,
      (chunk) => {
        accumulated += chunk
        if (!win.isDestroyed()) win.webContents.send('automated-workflow-generator:token', chunk)
      },
      cwd,
      modelOverride,
    )

    accumulated = fullText || accumulated
    if (!accumulated.trim()) {
      throw new Error(`Automated workflow generator returned no response from ${modelOverride ?? getAutomatedWorkflowGeneratorModel()}. Check the selected model/provider or choose a different model.`)
    }

    const spec = extractAutomatedWorkflowSpec(accumulated)
    if (!win.isDestroyed()) {
      if (spec) win.webContents.send('automated-workflow-generator:spec-ready', spec)
      win.webContents.send('automated-workflow-generator:done', { hasSpec: spec !== null })
    }
  } catch (error) {
    if (!win.isDestroyed()) {
      win.webContents.send('automated-workflow-generator:error', {
        message: error instanceof Error ? error.message : String(error),
      })
    }
    throw error
  } finally {
    endActivity(activityId)
  }
}

export async function runAutomatedWorkflowGeneratorChatForAndroid(
  projectId: string | null,
  messages: AutomatedWorkflowGeneratorMessage[],
  sessionId = `automated-workflow-gen-android-${randomUUID()}`,
  modelOverride?: string,
): Promise<void> {
  const { providerMessages, cwd } = buildProviderMessages(projectId, messages)
  const fakeWin = { isDestroyed: () => false, webContents: { send: () => {}, isDestroyed: () => false } } as unknown as BrowserWindow
  let accumulated = ''

  const activityId = `automated-workflow-generator:${projectId ?? 'global'}`
  startActivity({ id: activityId, kind: 'automated-workflow-generator', projectId: projectId ?? undefined, label: 'Generating workflow…' })
  try {
    const fullText = await runAutomatedWorkflowProviderChat(
      fakeWin,
      providerMessages,
      sessionId,
      (chunk) => {
        accumulated += chunk
        broadcastToMobile({ event: 'automated-workflow-generator:token', data: { sessionId, chunk } })
      },
      cwd,
      modelOverride,
    )

    accumulated = fullText || accumulated
    if (!accumulated.trim()) {
      broadcastToMobile({
        event: 'automated-workflow-generator:error',
        data: { sessionId, message: 'Automated workflow generator returned no response. Check the selected model/provider.' },
      })
      return
    }

    const spec = extractAutomatedWorkflowSpec(accumulated)
    const assistantText = accumulated.replace(/<automated-workflow-spec>[\s\S]*?<\/automated-workflow-spec>/g, '').trim()
    broadcastToMobile({ event: 'automated-workflow-generator:turn-complete', data: { sessionId, content: assistantText, hasSpec: spec !== null } })
    if (spec) {
      broadcastToMobile({ event: 'automated-workflow-generator:spec-ready', data: { sessionId, spec } })
    }
  } finally {
    endActivity(activityId)
  }
}

export function registerAutomatedWorkflowGeneratorHandlers(win?: BrowserWindow): void {
  safeHandle('automated-workflow-generator:chat', async (_event, projectId: string | null, messages: AutomatedWorkflowGeneratorMessage[], modelOverride?: string) => {
    if (!win) throw new Error('No main window available')
    await runAutomatedWorkflowGeneratorChat(win, projectId, messages, modelOverride)
    return { started: true }
  })

  safeHandle('automated-workflow-generator:get-model', () => getAutomatedWorkflowGeneratorModel())

  safeHandle('automated-workflow-generator:set-model', (_event, modelId: string) => {
    setAutomatedWorkflowGeneratorModel(modelId)
    return undefined
  })
}
