import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
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
import type { ProviderMessage } from './provider-core-types'
import type { SkillGeneratorMessage, SkillGeneratorSpec } from '../shared/types'
import { getDatabase } from './database'

const SPEC_OPEN_TAG = '<skill-spec>'
const SPEC_CLOSE_TAG = '</skill-spec>'

const SKILL_GENERATOR_SYSTEM_PROMPT = `You are an expert skill configuration assistant for Nexy, an AI-powered desktop application.

Your job is to help the user create a reusable skill. A skill is a portable capability preset that can be attached to one or more agents. It can add instructions, enable built-in tools, provide tool-specific instructions, and describe useful knowledge.

## Conversation style
- Ask focused questions only when needed: task type, boundaries, tools, approval level, and agents that may use it
- Be concise
- When enough context is available, emit the skill spec

## Tool guidance
- fileEdit: true only when the skill should change files
- terminal: true only when commands, builds, tests, or scripts are part of the workflow
- webFetch: true only when live web research or URL reading is needed
- Use "always-ask" approval for risky file/terminal skills unless the user explicitly asks for automatic execution

## Skill instructions
Write instructions in second person, as reusable behavior guidance. Include:
1. When to use this skill
2. What process to follow
3. What to avoid
4. Expected output shape when helpful

When ready, emit a brief summary followed immediately by JSON wrapped in <skill-spec>…</skill-spec> tags. The JSON must match:

{
  "name": "Skill Name",
  "icon": "✨",
  "description": "Short summary",
  "instructions": "Reusable instructions...",
  "tools": { "fileEdit": false, "terminal": false, "webFetch": false },
  "toolInstructions": { "fileEdit": "", "terminal": "", "webFetch": "" },
  "approval": { "fileEdit": "always-ask", "terminal": "always-ask", "webFetch": "always-ask" },
  "mcpServers": [],
  "tags": [],
  "knowledge": [{ "title": "Optional note", "content": "..." }],
  "suggestedAgents": []
}`

let _skillGeneratorModel: string | null = null

export function getSkillGeneratorModel(): string {
  if (_skillGeneratorModel) return _skillGeneratorModel
  const db = getDatabase()
  const row = db.prepare("SELECT value FROM settings WHERE key = 'default_model'").get() as { value: string } | undefined
  const savedModel = row?.value && row.value !== 'default' ? row.value : DEFAULT_PROVIDER_MODEL
  const savedProvider = getProviderForAgent(savedModel)
  if (isProviderConfigured(savedProvider.provider)) return savedModel

  const fallbackProvider = PROVIDERS.find((p) => isProviderConfigured(p.name) && p.models.length > 0)
  if (fallbackProvider?.models[0]) {
    return fallbackProvider.name === 'openai'
      ? fallbackProvider.models[0]
      : `${fallbackProvider.name}:${fallbackProvider.models[0]}`
  }
  const openRouterModel = isProviderConfigured('openrouter') ? getOpenRouterModels()[0] : undefined
  return openRouterModel ? `openrouter:${openRouterModel}` : savedModel
}

function buildProviderMessages(messages: SkillGeneratorMessage[]): ProviderMessage[] {
  const filtered = messages[0]?.role === 'assistant' ? messages.slice(1) : messages
  return [
    { role: 'system', content: SKILL_GENERATOR_SYSTEM_PROMPT },
    ...filtered.map((m): ProviderMessage => ({ role: m.role, content: m.content })),
  ]
}

function extractSpec(text: string): SkillGeneratorSpec | null {
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

const TOOL_KEYS = ['fileEdit', 'terminal', 'webFetch'] as const
const VALID_APPROVALS = new Set(['auto', 'always-ask', 'disabled'])

function normalizeSpec(raw: Record<string, unknown>): SkillGeneratorSpec {
  const rawTools = (raw.tools && typeof raw.tools === 'object' ? raw.tools : {}) as Record<string, unknown>
  const rawToolInstructions = (raw.toolInstructions && typeof raw.toolInstructions === 'object' ? raw.toolInstructions : {}) as Record<string, unknown>
  const rawApproval = (raw.approval && typeof raw.approval === 'object' ? raw.approval : {}) as Record<string, unknown>
  const toolInstructions: SkillGeneratorSpec['toolInstructions'] = {}
  const approval: SkillGeneratorSpec['approval'] = {}

  for (const key of TOOL_KEYS) {
    if (typeof rawToolInstructions[key] === 'string') toolInstructions[key] = rawToolInstructions[key] as string
    approval[key] = VALID_APPROVALS.has(String(rawApproval[key]))
      ? rawApproval[key] as 'auto' | 'always-ask' | 'disabled'
      : 'always-ask'
  }

  return {
    name: String(raw.name || 'New Skill').trim().slice(0, 100),
    icon: typeof raw.icon === 'string' && raw.icon.trim() ? raw.icon.trim().slice(0, 8) : '✨',
    description: typeof raw.description === 'string' ? raw.description : '',
    instructions: typeof raw.instructions === 'string' ? raw.instructions : '',
    tools: {
      fileEdit: rawTools.fileEdit === true,
      terminal: rawTools.terminal === true,
      webFetch: rawTools.webFetch === true,
    },
    toolInstructions,
    approval,
    mcpServers: Array.isArray(raw.mcpServers) ? raw.mcpServers.filter((v): v is string => typeof v === 'string') : [],
    tags: Array.isArray(raw.tags) ? raw.tags.filter((v): v is string => typeof v === 'string') : [],
    knowledge: Array.isArray(raw.knowledge) ? raw.knowledge.filter(isKnowledgeEntry) : [],
    suggestedAgents: Array.isArray(raw.suggestedAgents) ? raw.suggestedAgents.filter((v): v is string => typeof v === 'string') : [],
  }
}

function isKnowledgeEntry(value: unknown): value is { title: string; content: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).title === 'string' &&
    typeof (value as Record<string, unknown>).content === 'string'
  )
}

async function runSkillGeneratorProviderChat(
  win: BrowserWindow,
  providerMessages: ProviderMessage[],
  sessionId: string,
  webContents: Electron.WebContents,
  sendChunk: (chunk: string) => void,
  modelOverride?: string,
): Promise<string> {
  const selectedModel = modelOverride ?? getSkillGeneratorModel()

  if (selectedModel.includes(':')) {
    const colonIdx = selectedModel.indexOf(':')
    const prefix = selectedModel.slice(0, colonIdx)
    const cliModel = selectedModel.slice(colonIdx + 1)
    if (prefix === 'claude-cli' || prefix === 'codex-cli') {
      const adapter = getAdapter(prefix)
      if (!adapter?.isAvailable()) throw new Error(`${prefix} is not available`)
      const systemMsg = typeof providerMessages[0]?.content === 'string' && providerMessages[0].role === 'system'
        ? providerMessages[0].content
        : SKILL_GENERATOR_SYSTEM_PROMPT
      const conversationMessages = providerMessages.filter((m) => m.role !== 'system')
      return adapter.send(
        win,
        { systemPrompt: systemMsg, messages: conversationMessages, cwd: process.cwd(), model: cliModel, conversationId: sessionId },
        sendChunk,
      )
    }
  }

  const { provider, model } = getProviderForAgent(selectedModel)
  const apiKey = getApiKey(provider)
  const systemPrompt = typeof providerMessages[0]?.content === 'string'
    ? providerMessages[0].content
    : SKILL_GENERATOR_SYSTEM_PROMPT

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

export async function runSkillGeneratorChat(
  win: BrowserWindow,
  messages: SkillGeneratorMessage[],
  modelOverride?: string,
): Promise<void> {
  const providerMessages = buildProviderMessages(messages)
  const sessionId = `skill-gen-${randomUUID()}`
  let accumulated = ''

  const fullText = await runSkillGeneratorProviderChat(
    win,
    providerMessages,
    sessionId,
    win.webContents,
    (chunk) => {
      accumulated += chunk
      if (!win.isDestroyed()) win.webContents.send('skill-generator:token', chunk)
    },
    modelOverride,
  )

  accumulated = fullText || accumulated
  if (!accumulated.trim()) {
    throw new Error(`Skill generator returned no response from ${modelOverride ?? getSkillGeneratorModel()}. Check the selected model/provider or choose a different model.`)
  }

  const spec = extractSpec(accumulated)
  if (!win.isDestroyed()) {
    if (spec) win.webContents.send('skill-generator:spec-ready', spec)
    win.webContents.send('skill-generator:done', { hasSpec: spec !== null })
  }
}

export function registerSkillGeneratorHandlers(win?: BrowserWindow): void {
  safeHandle('skill-generator:chat', async (_event, messages: SkillGeneratorMessage[], modelOverride?: string) => {
    if (!win) throw new Error('No main window available')
    await runSkillGeneratorChat(win, messages, modelOverride)
    return { started: true }
  })

  safeHandle('skill-generator:get-model', () => getSkillGeneratorModel())

  safeHandle('skill-generator:set-model', (_event, modelId: string) => {
    _skillGeneratorModel = modelId || null
    return undefined
  })
}
