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
  { name: '/context', usage: '/context', description: 'Show context snapshot of the last sent message' }
]

function hasIpcError(result: unknown): result is { error: string } {
  return typeof result === 'object' && result !== null && 'error' in result
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


export interface SlashCommandContext {
  conversationId: string | null
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
}

export async function executeSlashCommand(
  rawInput: string,
  ctx: SlashCommandContext
): Promise<boolean> {
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
      return true
    }
    case '/version': {
      try {
        const version = await window.api.getVersion()
        ctx.pushSystemMessage(`Nexy v${version}`)
      } catch {
        ctx.pushSystemMessage('Unable to read app version.')
      }
      return true
    }
    case '/logout': {
      await ctx.logout()
      ctx.pushSystemMessage('Signed out.')
      return true
    }
    case '/cwd': {
      const cwd = await window.api.getWorkingDirectory()
      ctx.pushSystemMessage(`Current working directory:\n${cwd}`)
      return true
    }
    case '/cd': {
      if (!argText) {
        ctx.pushSystemMessage('Usage: /cd <directory>')
        return true
      }
      try {
        await window.api.setWorkingDirectory(argText)
        ctx.pushSystemMessage(`Working directory set to:\n${argText}`)
      } catch {
        ctx.pushSystemMessage(`Failed to set working directory:\n${argText}`)
      }
      return true
    }
    case '/add-dir': {
      if (!argText) {
        ctx.pushSystemMessage('Usage: /add-dir <directory>')
        return true
      }
      if (!ctx.activeAgent) {
        ctx.pushSystemMessage('No active agent selected. Select an agent first.')
        return true
      }
      const nextDirs = Array.from(new Set([...(ctx.activeAgent.contextDirectories ?? []), argText]))
      await window.api.updateAgent(ctx.activeAgent.id, {
        ...ctx.activeAgent,
        contextDirectories: nextDirs
      })
      await ctx.loadAgents()
      ctx.pushSystemMessage(`Added directory to ${ctx.activeAgent.name} context:\n${argText}`)
      return true
    }
    case '/list-dirs': {
      if (!ctx.activeAgent) {
        ctx.pushSystemMessage('No active agent selected.')
        return true
      }
      const dirs = ctx.activeAgent.contextDirectories ?? []
      if (dirs.length === 0) {
        ctx.pushSystemMessage(`${ctx.activeAgent.name} has no context directories.`)
      } else {
        ctx.pushSystemMessage(
          `${ctx.activeAgent.name} context directories:\n${dirs.map((d) => `- ${d}`).join('\n')}`
        )
      }
      return true
    }
    case '/copy': {
      const lastAssistant = [...ctx.messages].reverse().find((m) => m.role === 'assistant')
      if (!lastAssistant) {
        ctx.pushSystemMessage('No assistant message to copy.')
        return true
      }
      await navigator.clipboard.writeText(lastAssistant.content)
      ctx.pushSystemMessage('Copied last assistant response to clipboard.')
      return true
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
      return true
    }
    case '/model': {
      if (!argText) {
        ctx.pushSystemMessage(`Current model: ${ctx.effectiveModelLabel}`)
        return true
      }
      const modelIds = getAvailableModelIds(ctx.catalogModels, ctx.conversationModel)
      if (!modelIds.includes(argText)) {
        ctx.pushSystemMessage(`Unknown model: ${argText}. Use /models to list available models.`)
        return true
      }
      if (!ctx.conversationId) {
        ctx.pushSystemMessage('No active conversation. Start a chat before setting a model.')
        return true
      }
      const value = argText === 'default' ? null : argText
      const result = await window.api.setConversationModel(ctx.conversationId, value)
      if (hasIpcError(result)) {
        ctx.pushSystemMessage(`Failed to set model: ${result.error}`)
        return true
      }
      await ctx.loadConversations()
      ctx.pushSystemMessage(`Model set to ${getModelLabel(argText, ctx.catalogModels)}.`)
      return true
    }
    case '/models': {
      const current = ctx.conversationModel ?? 'default'
      const modelIds = getAvailableModelIds(ctx.catalogModels, ctx.conversationModel)
      const text = ['Available models:']
      for (const model of modelIds) {
        const mark = model === current ? '*' : '-'
        text.push(`${mark} ${getModelLabel(model, ctx.catalogModels)}`)
      }
      ctx.pushSystemMessage(text.join('\n'))
      return true
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
      return true
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
      return true
    }
    case '/theme': {
      if (!argText) {
        ctx.pushSystemMessage(`Current theme: ${ctx.theme}`)
        return true
      }
      if (argText !== 'dark' && argText !== 'light') {
        ctx.pushSystemMessage('Usage: /theme [dark|light]')
        return true
      }
      ctx.setTheme(argText)
      await window.api.setTheme(argText)
      ctx.pushSystemMessage(`Theme set to ${argText}.`)
      return true
    }
    case '/clear': {
      if (ctx.conversationId) {
        await ctx.deleteMessagesAfter(ctx.conversationId, 0)
      }
      ctx.setMessages([])
      ctx.pushSystemMessage('Conversation cleared.')
      return true
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
      return true
    }
    case '/exit': {
      ctx.newChat()
      ctx.setMessages([])
      return true
    }
    case '/undo': {
      const index = ctx.messages.length - 1
      if (index < 1) {
        ctx.pushSystemMessage('Nothing to undo.')
        return true
      }
      const last = ctx.messages[index]
      const prev = ctx.messages[index - 1]
      if (last.role !== 'assistant' || prev.role !== 'user') {
        ctx.pushSystemMessage('Undo only supports the last user/assistant exchange.')
        return true
      }
      ctx.lastUndoneUserMessageRef.current = prev.content
      ctx.setMessages((curr) => curr.slice(0, -2))
      if (ctx.conversationId) {
        await ctx.deleteMessagesAfter(ctx.conversationId, prev.timestamp)
      }
      ctx.pushSystemMessage('Last exchange removed. Use /redo to resend.')
      return true
    }
    case '/redo': {
      const redoContent = ctx.lastUndoneUserMessageRef.current
      if (!redoContent) {
        ctx.pushSystemMessage('Nothing to redo.')
        return true
      }
      ctx.setInput(redoContent)
      ctx.pushSystemMessage('Redo restored the previous user message to input.')
      return true
    }
    case '/compact': {
      const trimmed = ctx.messages.filter((m) => m.role !== 'system').slice(-8)
      ctx.setMessages(trimmed)
      ctx.pushSystemMessage('Compacted to recent context.')
      return true
    }
    case '/context': {
      const lastUserMsg = [...ctx.messages].reverse().find((m) => m.role === 'user')
      if (!lastUserMsg?.contextSnapshot) {
        ctx.pushSystemMessage('No context snapshot available. Send a message first.')
        return true
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
      return true
    }
    default: {
      const customCmd = (ctx.activeAgent?.customCommands ?? []).find((c) => c.name === command)
      if (customCmd) {
        ctx.setInput(customCmd.prompt)
        return true
      }
      return false
    }
  }
}
