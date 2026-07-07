import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { getAvailableModelIds, getModelLabel } from '../shared/models'
import type { AgentConfig, CatalogModel } from '../shared/types'

interface Attachment {
  id: string
  name: string
  path: string
  size: number
}

interface PastedImage {
  id: string
  dataUrl: string
  name: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  model?: string | null
  attachments?: Attachment[]
  images?: PastedImage[]
  isEdited?: boolean
  isError?: boolean
  errorType?: string
  retryable?: boolean
  isStopped?: boolean
  contextSnapshot?: string
}

interface ContextSnapshot {
  systemPrompt?: string
  contextRefs?: Array<{ token: string }>
  attachments?: Array<{ name: string }>
  historyLength: number
  estimatedTokens: number
}

export interface SlashCommandDef {
  name: string
  usage: string
  description: string
}

export const SLASH_COMMANDS: SlashCommandDef[] = [
  { name: '/clear', usage: '/clear', description: 'Clear current conversation messages' },
  { name: '/new', usage: '/new [prompt]', description: 'Start a new chat' },
  { name: '/undo', usage: '/undo', description: 'Remove the last user/assistant exchange' },
  { name: '/redo', usage: '/redo', description: 'Resend the last undone user message' },
  { name: '/compact', usage: '/compact', description: 'Compact visible chat to recent context' },
  { name: '/exit', usage: '/exit', description: 'Exit current conversation view' },
  { name: '/help', usage: '/help', description: 'Show slash command help' },
  { name: '/version', usage: '/version', description: 'Show app version' },
  { name: '/logout', usage: '/logout', description: 'Clear provider mode' },
  { name: '/cwd', usage: '/cwd', description: 'Show working directory' },
  { name: '/cd', usage: '/cd <dir>', description: 'Change working directory' },
  { name: '/add-dir', usage: '/add-dir <dir>', description: 'Add directory to active agent context' },
  { name: '/list-dirs', usage: '/list-dirs', description: 'List active agent context directories' },
  { name: '/share', usage: '/share [file]', description: 'Share conversation as markdown' },
  { name: '/copy', usage: '/copy', description: 'Copy last assistant response' },
  { name: '/model', usage: '/model [name]', description: 'Show or set conversation model' },
  { name: '/models', usage: '/models', description: 'List available models' },
  { name: '/usage', usage: '/usage', description: 'Show session usage stats' },
  { name: '/config', usage: '/config', description: 'Show current chat configuration' },
  { name: '/theme', usage: '/theme [dark|light]', description: 'Show or set theme' },
  { name: '/explain', usage: '/explain [text]', description: 'Explain code or request' },
  { name: '/fix', usage: '/fix [text]', description: 'Fix code issues' },
  { name: '/tests', usage: '/tests [text]', description: 'Generate tests' },
  { name: '/refactor', usage: '/refactor [text]', description: 'Refactor code' },
  { name: '/docs', usage: '/docs [text]', description: 'Generate documentation' },
  { name: '/review', usage: '/review [text]', description: 'Review code for issues' },
  { name: '/context', usage: '/context', description: 'Show context snapshot of the last sent message' },
  { name: '/debrief', usage: '/debrief [model]', description: 'Generate a session debrief as a re-runnable artifact' },
  { name: '/quiz', usage: '/quiz [model]', description: 'Quiz yourself on this session (generates a debrief first if needed)' },
  { name: '/complete', usage: '/complete', description: 'Mark this conversation complete' },
  { name: '/incomplete', usage: '/incomplete', description: 'Mark this conversation incomplete' },
  { name: '/code-change', usage: '/code-change <description>', description: 'Create a code change request from this chat' },
]

function hasIpcError(result: unknown): result is { error: string } {
  return typeof result === 'object' && result !== null && 'error' in result
}

const INVALID_MODEL = Symbol('invalid-model')

/**
 * Resolves the model a /debrief or /quiz run should use: an explicit trailing arg (validated
 * against the catalog, matching /model's own validation), or the conversation's current model
 * ("whatever model is selected in the chat") when no arg is given.
 */
function resolveSlashGenerationModel(argText: string, ctx: Pick<SlashCommandContext, 'catalogModels' | 'conversationModel' | 'pushSystemMessage'>): string | null | typeof INVALID_MODEL {
  if (!argText) return ctx.conversationModel
  const modelIds = getAvailableModelIds(ctx.catalogModels, ctx.conversationModel)
  const hasCatalog = (ctx.catalogModels?.length ?? 0) > 0
  if (hasCatalog && !modelIds.includes(argText)) {
    ctx.pushSystemMessage(`Unknown model: ${argText}. Use /models to list available models.`)
    return INVALID_MODEL
  }
  return argText
}

export function transformCodeSlashCommand(input: string): string | null {
  const [command, ...rest] = input.split(/\s+/)
  const argText = rest.join(' ').trim()
  const content = argText || 'Use the attached context and provide the best possible result.'

  const map: Record<string, string> = {
    '/explain': 'Explain this code clearly and concisely.',
    '/fix': 'Fix bugs and issues in this code.',
    '/tests': 'Generate robust tests for this code.',
    '/refactor': 'Refactor this code for readability and maintainability.',
    '/docs': 'Write documentation and inline doc comments for this code.',
    '/review': 'Review this code for bugs, edge cases, and security issues.'
  }

  const instruction = map[command]
  if (!instruction) return null
  return `${instruction}\n\n${content}`
}

export function buildUsageBar(used: number, limit: number, width = 20): string {
  const pct = Math.min(1, used / limit)
  const filled = Math.round(pct * width)
  const empty = width - filled
  const bar = '█'.repeat(filled) + '░'.repeat(empty)
  return `[${bar}] ${Math.round(pct * 100)}%`
}

export function formatContextUsage(estimatedTokens: number, model: string | null): string {
  // Approximate context window sizes for known Copilot models
  const CONTEXT_LIMITS: Record<string, number> = {
    'gpt-4o':          128_000,
    'gpt-4o-mini':     128_000,
    'gpt-4-turbo':     128_000,
    'gpt-4':            32_768,
    'gpt-3.5-turbo':   16_384,
    'claude-3-5-sonnet': 200_000,
    'claude-3-haiku':  200_000,
    'o1':              200_000,
    'o1-mini':         128_000,
  }

  const key = Object.keys(CONTEXT_LIMITS).find((k) => model?.toLowerCase().includes(k))
  const limit = key ? CONTEXT_LIMITS[key] : 128_000
  const bar = buildUsageBar(estimatedTokens, limit)
  return `Context window (${model ?? 'default'}):\n${bar} (~${estimatedTokens.toLocaleString()} / ${(limit / 1000).toFixed(0)}k tokens)`
}


/** A slash command either fully handles itself ('handled'), expands into the composer for
 * the user to review/send ('expanded'), or is unrecognized (false) and falls through. */
export type SlashCommandOutcome = 'handled' | 'expanded' | false

export interface SlashGenerationResult {
  artifactId: string
  versionId: string
}

export interface SlashCommandContext {
  conversationId: string | null
  chatProjectId: string | null
  messages: ChatMessage[]
  activeAgent: AgentConfig | null
  effectiveModelLabel: string
  conversationModel: string | null
  catalogModels?: CatalogModel[]
  theme: 'light' | 'dark'
  pushSystemMessage: (text: string) => void
  newChat: (opts?: { projectId?: string | null; agentId?: string | null }) => void
  logout: () => Promise<void>
  setInput: (value: string) => void
  setTheme: (t: 'light' | 'dark') => void
  loadAgents: () => Promise<void>
  loadConversations: () => Promise<void>
  buildConversationMarkdown: () => string
  deleteMessagesAfter: (convId: string, ts: number) => Promise<void>
  lastUndoneUserMessageRef: MutableRefObject<string | null>
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>
  /** Marks the current conversation complete/incomplete (mirrors the "..." menu action). */
  markComplete: () => Promise<void>
  markIncomplete: () => Promise<void>
  /** Runs a fixed generation+parsing flow (debrief/quiz) against the given/conversation model,
   * persisting the result as a versioned artifact. */
  runSlashGeneration: (kind: 'debrief' | 'quiz', opts?: { model?: string }) => Promise<SlashGenerationResult | { error: string }>
  /** Attaches a durable, specially-rendered artifact reference message to the transcript. */
  attachArtifactMessage: (artifactId: string, versionId?: string) => Promise<void>
  /** Creates (or reuses an existing non-terminal) Code Changes request for this conversation
   * and attaches a durable, live-updating card message to the transcript. */
  startCodeChange: (opts: { description: string }) => Promise<{ reportId: string } | { error: string }>
}

export async function executeSlashCommand(
  rawInput: string,
  ctx: SlashCommandContext
): Promise<SlashCommandOutcome> {
  if (!rawInput.trim() || !rawInput.startsWith('/')) return false

  const [command, ...rest] = rawInput.split(/\s+/)
  const argText = rest.join(' ').trim()

  switch (command) {
    case '/help': {
      const helpText = [
        'Available slash commands:',
        ...SLASH_COMMANDS.map((c) => `- ${c.usage}: ${c.description}`)
      ].join('\n')
      ctx.pushSystemMessage(helpText)
      return 'handled'
    }
    case '/version': {
      try {
        const version = await window.api.getVersion()
        ctx.pushSystemMessage(`Nexy v${version}`)
      } catch {
        ctx.pushSystemMessage('Unable to read app version.')
      }
      return 'handled'
    }
    case '/logout': {
      await ctx.logout()
      ctx.pushSystemMessage('Signed out.')
      return 'handled'
    }
    case '/cwd': {
      const cwd = await window.api.getWorkingDirectory()
      ctx.pushSystemMessage(`Current working directory:\n${cwd}`)
      return 'handled'
    }
    case '/cd': {
      if (!argText) {
        ctx.pushSystemMessage('Usage: /cd <directory>')
        return 'handled'
      }
      try {
        await window.api.setWorkingDirectory(argText)
        ctx.pushSystemMessage(`Working directory set to:\n${argText}`)
      } catch {
        ctx.pushSystemMessage(`Failed to set working directory:\n${argText}`)
      }
      return 'handled'
    }
    case '/add-dir': {
      if (!argText) {
        ctx.pushSystemMessage('Usage: /add-dir <directory>')
        return 'handled'
      }
      if (!ctx.activeAgent) {
        ctx.pushSystemMessage('No active agent selected. Select an agent first.')
        return 'handled'
      }
      const nextDirs = Array.from(new Set([...(ctx.activeAgent.contextDirectories ?? []), argText]))
      await window.api.updateAgent(ctx.activeAgent.id, {
        ...ctx.activeAgent,
        contextDirectories: nextDirs
      })
      await ctx.loadAgents()
      ctx.pushSystemMessage(`Added directory to ${ctx.activeAgent.name} context:\n${argText}`)
      return 'handled'
    }
    case '/list-dirs': {
      if (!ctx.activeAgent) {
        ctx.pushSystemMessage('No active agent selected.')
        return 'handled'
      }
      const dirs = ctx.activeAgent.contextDirectories ?? []
      if (dirs.length === 0) {
        ctx.pushSystemMessage(`${ctx.activeAgent.name} has no context directories.`)
      } else {
        ctx.pushSystemMessage(
          `${ctx.activeAgent.name} context directories:\n${dirs.map((d) => `- ${d}`).join('\n')}`
        )
      }
      return 'handled'
    }
    case '/copy': {
      const lastAssistant = [...ctx.messages].reverse().find((m) => m.role === 'assistant')
      if (!lastAssistant) {
        ctx.pushSystemMessage('No assistant message to copy.')
        return 'handled'
      }
      await navigator.clipboard.writeText(lastAssistant.content)
      ctx.pushSystemMessage('Copied last assistant response to clipboard.')
      return 'handled'
    }
    case '/share': {
      const markdown = ctx.buildConversationMarkdown()
      if (argText.toLowerCase() === 'file') {
        const savedPath = await window.api.saveTextFile('conversation.md', markdown)
        if (savedPath) {
          ctx.pushSystemMessage(`Conversation saved to:\n${savedPath}`)
        } else {
          ctx.pushSystemMessage('Save canceled.')
        }
      } else if (argText.toLowerCase() === 'gist') {
        try {
          const gistUrl = await window.api.createGist(
            'conversation.md',
            markdown,
            'Shared from Nexy'
          )
          ctx.pushSystemMessage(`Created secret gist:\n${gistUrl}`)
        } catch {
          ctx.pushSystemMessage('Failed to create gist. Make sure you are signed in to GitHub.')
        }
      } else {
        await navigator.clipboard.writeText(markdown)
        ctx.pushSystemMessage('Conversation markdown copied to clipboard.')
      }
      return 'handled'
    }
    case '/model': {
      if (!argText) {
        ctx.pushSystemMessage(`Current model: ${ctx.effectiveModelLabel}`)
        return 'handled'
      }
      const modelIds = getAvailableModelIds(ctx.catalogModels, ctx.conversationModel)
      // When no catalog is available (CLI / offline), allow any non-empty model ID
      const hasCatalog = (ctx.catalogModels?.length ?? 0) > 0
      if (hasCatalog && !modelIds.includes(argText)) {
        ctx.pushSystemMessage(`Unknown model: ${argText}. Use /models to list available models.`)
        return 'handled'
      }
      if (!ctx.conversationId) {
        ctx.pushSystemMessage('No active conversation. Start a chat before setting a model.')
        return 'handled'
      }
      const value = argText === 'default' ? null : argText
      const result = await window.api.setConversationModel(ctx.conversationId, value)
      if (hasIpcError(result)) {
        ctx.pushSystemMessage(`Failed to set model: ${result.error}`)
        return 'handled'
      }
      await ctx.loadConversations()
      ctx.pushSystemMessage(`Model set to ${getModelLabel(argText, ctx.catalogModels)}.`)
      return 'handled'
    }
    case '/models': {
      const current = ctx.conversationModel ?? 'default'
      const hasCatalog = (ctx.catalogModels?.length ?? 0) > 0
      const backend = ctx.activeAgent?.backend
      if (!hasCatalog && (backend === 'codex-cli' || backend === 'claude-cli')) {
        const cliModels = await window.api.getCliModels(backend)
        const header = backend === 'codex-cli' ? 'Available Codex CLI models:' : 'Available Claude CLI models:'
        const text = [header]
        for (const m of cliModels) {
          const mark = m.id === current ? '*' : '-'
          text.push(`${mark} ${m.label} (${m.id})`)
        }
        text.push('\nUse /model <id> to switch.')
        ctx.pushSystemMessage(text.join('\n'))
        return 'handled'
      }
      const modelIds = getAvailableModelIds(ctx.catalogModels, ctx.conversationModel)
      const text = ['Available models:']
      for (const model of modelIds) {
        const mark = model === current ? '*' : '-'
        text.push(`${mark} ${getModelLabel(model, ctx.catalogModels)}`)
      }
      ctx.pushSystemMessage(text.join('\n'))
      return 'handled'
    }
    case '/usage': {
      const userCount = ctx.messages.filter((m) => m.role === 'user').length
      const assistantCount = ctx.messages.filter((m) => m.role === 'assistant').length
      const systemCount = ctx.messages.filter((m) => m.role === 'system').length
      const charCount = ctx.messages.reduce((sum, m) => sum + m.content.length, 0)
      const estimatedTokens = Math.ceil(charCount / 4)
      const contextLine = formatContextUsage(estimatedTokens, ctx.conversationModel)
      const lines = [
        '**Session usage**',
        `- Messages: ${ctx.messages.length} (👤 ${userCount} user / 🤖 ${assistantCount} assistant / ⚙ ${systemCount} system)`,
        `- Estimated tokens in context: ~${estimatedTokens.toLocaleString()}`,
        '',
        contextLine,
        '',
        '_Note: Session usage is estimated locally and does not include provider-side quota data._',
      ]
      ctx.pushSystemMessage(lines.join('\n'))
      return 'handled'
    }
    case '/config': {
      const configLines = [
        'Current config:',
        `- Conversation model: ${getModelLabel(ctx.conversationModel ?? 'default', ctx.catalogModels)}`,
        `- Effective model: ${ctx.effectiveModelLabel}`,
        `- Theme: ${ctx.theme}`,
        `- Active agent: ${ctx.activeAgent ? ctx.activeAgent.name : 'none'}`
      ]
      if (ctx.activeAgent) {
        configLines.push(`- Agent temperature: ${ctx.activeAgent.temperature}`)
        configLines.push(`- Agent max tokens: ${ctx.activeAgent.maxTokens}`)
      }
      ctx.pushSystemMessage(configLines.join('\n'))
      return 'handled'
    }
    case '/theme': {
      if (!argText) {
        ctx.pushSystemMessage(`Current theme: ${ctx.theme}`)
        return 'handled'
      }
      if (argText !== 'dark' && argText !== 'light') {
        ctx.pushSystemMessage('Usage: /theme [dark|light]')
        return 'handled'
      }
      ctx.setTheme(argText)
      await window.api.setTheme(argText)
      ctx.pushSystemMessage(`Theme set to ${argText}.`)
      return 'handled'
    }
    case '/clear': {
      if (ctx.conversationId) {
        await ctx.deleteMessagesAfter(ctx.conversationId, 0)
      }
      ctx.setMessages([])
      ctx.pushSystemMessage('Conversation cleared.')
      return 'handled'
    }
    case '/new': {
      ctx.newChat()
      ctx.setMessages([])
      if (argText) {
        ctx.setInput(argText)
        ctx.pushSystemMessage('Started new chat. Prompt inserted in input.')
      } else {
        ctx.pushSystemMessage('Started new chat.')
      }
      return 'handled'
    }
    case '/exit': {
      ctx.newChat()
      ctx.setMessages([])
      return 'handled'
    }
    case '/undo': {
      const index = ctx.messages.length - 1
      if (index < 1) {
        ctx.pushSystemMessage('Nothing to undo.')
        return 'handled'
      }
      const last = ctx.messages[index]
      const prev = ctx.messages[index - 1]
      if (last.role !== 'assistant' || prev.role !== 'user') {
        ctx.pushSystemMessage('Undo only supports the last user/assistant exchange.')
        return 'handled'
      }
      ctx.lastUndoneUserMessageRef.current = prev.content
      ctx.setMessages((curr) => curr.slice(0, -2))
      if (ctx.conversationId) {
        await ctx.deleteMessagesAfter(ctx.conversationId, prev.timestamp)
      }
      ctx.pushSystemMessage('Last exchange removed. Use /redo to resend.')
      return 'handled'
    }
    case '/redo': {
      const redoContent = ctx.lastUndoneUserMessageRef.current
      if (!redoContent) {
        ctx.pushSystemMessage('Nothing to redo.')
        return 'handled'
      }
      ctx.setInput(redoContent)
      ctx.pushSystemMessage('Redo restored the previous user message to input.')
      return 'handled'
    }
    case '/compact': {
      const trimmed = ctx.messages.filter((m) => m.role !== 'system').slice(-8)
      ctx.setMessages(trimmed)
      ctx.pushSystemMessage('Compacted to recent context.')
      return 'handled'
    }
    case '/context': {
      const lastUserMsg = [...ctx.messages].reverse().find((m) => m.role === 'user')
      if (!lastUserMsg?.contextSnapshot) {
        ctx.pushSystemMessage('No context snapshot available. Send a message first.')
        return 'handled'
      }
      try {
        const snap: ContextSnapshot = JSON.parse(lastUserMsg.contextSnapshot)
        const lines = ['**Last Message Context Snapshot**']
        if (snap.systemPrompt) lines.push(`\n**System Prompt:** ${snap.systemPrompt.length} chars`)
        if (snap.contextRefs?.length) lines.push(`**@refs:** ${snap.contextRefs.map((r) => r.token).join(', ')}`)
        if (snap.attachments?.length) lines.push(`**Attachments:** ${snap.attachments.map((a) => a.name).join(', ')}`)
        lines.push(`**History messages included:** ${snap.historyLength}`)
        lines.push(`**Estimated tokens:** ${snap.estimatedTokens}`)
        ctx.pushSystemMessage(lines.join('\n'))
      } catch {
        ctx.pushSystemMessage('Could not parse context snapshot.')
      }
      return 'handled'
    }
    case '/debrief': {
      if (!ctx.conversationId) {
        ctx.pushSystemMessage('No active conversation. Start a chat before generating a debrief.')
        return 'handled'
      }
      const model = resolveSlashGenerationModel(argText, ctx)
      if (model === INVALID_MODEL) return 'handled'
      ctx.pushSystemMessage('Generating debrief…')
      const result = await ctx.runSlashGeneration('debrief', { model: model ?? undefined })
      if ('error' in result) {
        ctx.pushSystemMessage(`Failed to generate debrief: ${result.error}`)
        return 'handled'
      }
      await ctx.attachArtifactMessage(result.artifactId, result.versionId)
      return 'handled'
    }
    case '/quiz': {
      if (!ctx.conversationId) {
        ctx.pushSystemMessage('No active conversation. Start a chat before generating a quiz.')
        return 'handled'
      }
      const model = resolveSlashGenerationModel(argText, ctx)
      if (model === INVALID_MODEL) return 'handled'
      ctx.pushSystemMessage('Generating quiz…')
      const result = await ctx.runSlashGeneration('quiz', { model: model ?? undefined })
      if ('error' in result) {
        ctx.pushSystemMessage(`Failed to generate quiz: ${result.error}`)
        return 'handled'
      }
      await ctx.attachArtifactMessage(result.artifactId, result.versionId)
      return 'handled'
    }
    case '/complete': {
      if (!ctx.conversationId) {
        ctx.pushSystemMessage('No active conversation.')
        return 'handled'
      }
      await ctx.markComplete()
      ctx.pushSystemMessage('Conversation marked complete.')
      return 'handled'
    }
    case '/incomplete': {
      if (!ctx.conversationId) {
        ctx.pushSystemMessage('No active conversation.')
        return 'handled'
      }
      await ctx.markIncomplete()
      ctx.pushSystemMessage('Conversation marked incomplete.')
      return 'handled'
    }
    case '/code-change': {
      if (!ctx.conversationId) {
        ctx.pushSystemMessage('No active conversation.')
        return 'handled'
      }
      if (!argText) {
        ctx.pushSystemMessage('Usage: /code-change <description of the change you want>')
        return 'handled'
      }
      const result = await ctx.startCodeChange({ description: argText })
      if ('error' in result) {
        ctx.pushSystemMessage(`Failed to create code change: ${result.error}`)
      }
      return 'handled'
    }
    default: {
      const customCmd = (ctx.activeAgent?.customCommands ?? []).find((c) => c.name === command)
      if (customCmd) {
        ctx.setInput(customCmd.prompt)
        return 'expanded'
      }
      return false
    }
  }
}
