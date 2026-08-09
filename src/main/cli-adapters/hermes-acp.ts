import type { BrowserWindow } from 'electron'
import { AcpStdioConnection } from './acp-stdio'
import type { CliAdapterRequest, CliAgentAdapter, CliStreamEvent } from './types'
import { buildCliChildEnv, createOpenBlockTracker, resolveCliPath } from './utils'
import { debugLog } from '../debug-mode'
import { recordErrorLogEntry } from '../error-log-handlers'
import { listHermesProfiles } from '../cli-detection'

// Local-model Hermes profiles run vision/aux capability probes against the configured endpoint
// during session bootstrap, so `session/new` legitimately takes tens of seconds (observed ~28s
// against a local vLLM). The stdio default of 30s is far too tight for that and produces spurious
// "Hermes ACP request timed out: session/new" failures. Give bootstrap a generous ceiling; the
// actual turn (`session/prompt`) keeps its own 10-minute budget below.
const HERMES_INITIALIZE_TIMEOUT_MS = 60 * 1000
const HERMES_SESSION_NEW_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Always-on persistent diagnostic for the Hermes ACP lifecycle. Unlike {@link debugLog} (gated
 * behind debug mode and lost on restart), this writes to the `error_log` table so a user reporting
 * "Hermes does nothing" has a durable, retention-pruned trail of spawn/handshake/timeout events —
 * on desktop and, via the relayed error message, visible on the Android companion too.
 */
function logHermes(level: 'info' | 'error', message: string): void {
  debugLog('cli', message)
  recordErrorLogEntry({ source: 'main', level, message: `[hermes-acp] ${message}` })
}

type Session = {
  id: string
  cwd: string
  model: string
  profile: string
  connection: AcpStdioConnection
  onChunk?: (chunk: string, blockId?: string) => void
  onEvent?: (event: CliStreamEvent) => void
  chunks: string[]
  lastTextBlockId?: string
  lastThinkingBlockId?: string
}
type ContentBlock = { type?: string; text?: string; data?: string; mimeType?: string }

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(textFromContent).join('')
  if (content && typeof content === 'object') {
    const block = content as ContentBlock
    return block.type === 'text' && typeof block.text === 'string' ? block.text : ''
  }
  return ''
}

function imageContent(dataUrl: string): ContentBlock | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  return match ? { type: 'image', mimeType: match[1], data: match[2] } : null
}

export class HermesAcpAdapter implements CliAgentAdapter {
  readonly name = 'hermes-cli'
  private readonly sessions = new Map<string, Session>()

  isAvailable(): boolean { return resolveCliPath('hermes') !== null }

  async send(
    _window: BrowserWindow,
    req: CliAdapterRequest,
    onChunk: (chunk: string, blockId?: string) => void,
    onEvent?: (event: CliStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const executable = resolveCliPath('hermes')
    if (!executable) throw new Error('hermes CLI not found')
    const requestedProfile = req.hermesProfile?.trim()
    let profile = requestedProfile || 'default'
    // 4.1 — Graceful unknown profile: if a specific profile was requested but no longer
    // exists on disk (deleted/renamed in the Hermes CLI after it was set on the agent),
    // warn and fall back to `default` rather than letting the ACP spawn fail with a raw,
    // unexplained error. `default` is always synthesized by listHermesProfiles().
    if (requestedProfile && requestedProfile !== 'default') {
      const known = listHermesProfiles().some((p) => p.name === requestedProfile)
      if (!known) {
        onEvent?.({ type: 'activity', label: `Hermes profile "${requestedProfile}" not found — using default` })
        debugLog('cli', `hermes ACP: profile "${requestedProfile}" not found on disk, falling back to default`)
        profile = 'default'
      }
    }
    const useProfileFlag = profile !== 'default'
    const key = `${req.conversationId}:${profile}:${req.cwd}:${req.model}`
    let session = this.sessions.get(key)
    if (!session) {
      const args = useProfileFlag ? ['--profile', profile, 'acp'] : ['acp']
      logHermes('info', `spawn ${executable} ${args.join(' ')} (profile=${profile}, cwd=${req.cwd})`)
      // Assigned once at line ~91 after `session` exists, but captured by the
      // notification callback below (which only fires later) — so it must be a
      // forward-declared `let`; the const suggestion is unfollowable here.
      // eslint-disable-next-line prefer-const
      let activeSession: Session | undefined
      const connection = new AcpStdioConnection(
        executable,
        args,
        req.cwd,
        (message) => this.handleNotification(message, activeSession),
        (message) => this.handleRequest(message, req),
        buildCliChildEnv({ HERMES_ACP_SKIP_CONFIGURED_MCP: '1' }),
      )
      const bootstrapStartedAt = Date.now()
      try {
        const init = await connection.request('initialize', {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: 'nexy', title: 'Nexy', version: '1.0.0' },
        }, HERMES_INITIALIZE_TIMEOUT_MS) as { protocolVersion?: number }
        if (init.protocolVersion !== 1) {
          throw new Error(`Hermes ACP protocol version ${init.protocolVersion ?? 'unknown'} is unsupported`)
        }
        const mcpServers = (req.mcpServers ?? []).map((server) => ({
          name: server.key || server.id,
          command: server.command,
          args: server.args,
          env: Object.entries(server.env ?? {}).map(([name, value]) => ({ name, value })),
        }))
        const created = await connection.request('session/new', {
          cwd: req.cwd,
          mcpServers,
          ...(req.extraAllowedDirs?.length ? { additionalDirectories: req.extraAllowedDirs } : {}),
        }, HERMES_SESSION_NEW_TIMEOUT_MS) as { sessionId?: string }
        if (!created.sessionId) {
          throw new Error('Hermes ACP did not return a session ID')
        }
        logHermes('info', `session/new ok in ${Date.now() - bootstrapStartedAt}ms (profile=${profile}, id=${created.sessionId})`)
        session = { id: created.sessionId, cwd: req.cwd, model: req.model, profile, connection, chunks: [] }
        activeSession = session
        this.sessions.set(key, session)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        const stderr = connection.recentStderr()
        logHermes('error', `session bootstrap failed after ${Date.now() - bootstrapStartedAt}ms (profile=${profile}): ${detail}${stderr ? ` | stderr: ${stderr.slice(-1500)}` : ''}`)
        connection.close()
        throw error
      }
    }

    const text = this.promptText(req)
    const prompt: ContentBlock[] = [{ type: 'text', text }]
    if (req.images) for (const image of req.images) {
      const content = imageContent(image.dataUrl)
      if (content) prompt.push(content)
    }
    session.onChunk = onChunk
    session.onEvent = onEvent
    session.chunks = []
    const sessionConnection = session.connection
    const abort = () => sessionConnection.notify('session/cancel', { sessionId: session!.id })
    if (signal?.aborted) throw new Error('Hermes ACP turn cancelled')
    signal?.addEventListener('abort', abort, { once: true })
    try {
      await sessionConnection.request('session/prompt', { sessionId: session.id, prompt }, 10 * 60 * 1000)
      if (session.lastTextBlockId) session.onEvent?.({ type: 'text_end', blockId: session.lastTextBlockId })
      if (session.lastThinkingBlockId) session.onEvent?.({ type: 'thinking_end', blockId: session.lastThinkingBlockId })
      return session.chunks.join('')
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      const stderr = session.connection.recentStderr()
      logHermes('error', `session/prompt failed (profile=${profile}): ${detail}${stderr ? ` | stderr: ${stderr.slice(-1500)}` : ''}`)
      this.sessions.delete(key)
      session.connection.close()
      throw error
    } finally {
      signal?.removeEventListener('abort', abort)
      session.onChunk = undefined
      session.onEvent = undefined
    }
  }

  closeAll(): void {
    for (const session of this.sessions.values()) session.connection.close()
    this.sessions.clear()
  }

  private promptText(req: CliAdapterRequest): string {
    const last = req.messages[req.messages.length - 1]
    const prompt = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? '')
    return req.systemPrompt ? `[System]: ${req.systemPrompt}\n\n${prompt}` : prompt
  }

  private handleNotification(
    message: { method?: string; params?: Record<string, unknown> },
    session: Session | undefined,
  ): void {
    if (message.method !== 'session/update') return
    const update = message.params?.update as Record<string, unknown> | undefined
    if (!update) return
    const kind = update.sessionUpdate
    const tracker = this.getTracker(update)
    if (kind === 'agent_message_chunk') {
      const text = textFromContent(update.content)
      if (text && session?.onChunk) {
        const blockId = tracker.next()
        session.chunks.push(text)
        session.lastTextBlockId = blockId
        session.onChunk(text, blockId)
      }
    } else if (kind === 'agent_thought_chunk') {
      const text = textFromContent(update.content)
      if (text && session) {
        const blockId = tracker.next()
        session.lastThinkingBlockId = blockId
        session.onEvent?.({ type: 'thinking_chunk', blockId, chunk: text })
      }
    } else if (kind === 'tool_call') {
      tracker.interrupt()
      session?.onEvent?.({ type: 'tool_start', id: String(update.toolCallId ?? `tool-${Date.now()}`), name: String(update.title ?? 'Hermes tool'), input: (update.rawInput as Record<string, unknown>) ?? {} })
    } else if (kind === 'tool_call_update') {
      const content = textFromContent(update.content)
      const status = String(update.status ?? '')
      if (content) session?.onEvent?.({ type: 'activity', label: content.slice(-500) })
      if (status === 'completed' || status === 'failed') session?.onEvent?.({ type: 'tool_end', id: String(update.toolCallId ?? ''), content, isError: status === 'failed' })
    } else if (kind === 'usage_update') {
      const cost = update.cost as { amount?: number; currency?: string } | undefined
      if (cost?.currency === 'USD' && typeof cost.amount === 'number') session?.onEvent?.({ type: 'cost', totalCostUsd: cost.amount, inputTokens: Number(update.used ?? 0), outputTokens: 0 })
    }
  }

  private readonly trackers = new Map<string, ReturnType<typeof createOpenBlockTracker>>()
  private getTracker(update: Record<string, unknown>) {
    const id = String(update.messageId ?? update.toolCallId ?? 'turn')
    let tracker = this.trackers.get(id)
    if (!tracker) { tracker = createOpenBlockTracker(`hermes-${id}`); this.trackers.set(id, tracker) }
    return tracker
  }

  private async handleRequest(message: { method?: string; params?: Record<string, unknown> }, req: CliAdapterRequest): Promise<unknown> {
    if (message.method !== 'session/request_permission') throw new Error(`Unsupported Hermes ACP request: ${message.method ?? 'unknown'}`)
    const params = message.params ?? {}
    const toolCall = (params.toolCall ?? {}) as Record<string, unknown>
    const options = Array.isArray(params.options) ? params.options as Array<Record<string, unknown>> : []
    const allow = options.find((option) => String(option.kind ?? '').startsWith('allow_'))
    const input = (toolCall.rawInput ?? toolCall.input ?? {}) as Record<string, unknown>
    const allowed = req.skipPermissions
      ? true
      : req.requestPermission ? await req.requestPermission(String(toolCall.title ?? 'Hermes tool'), input) : false
    return { outcome: allowed && allow ? { outcome: 'selected', optionId: String(allow.optionId) } : { outcome: 'cancelled' } }
  }
}

export const HermesAcpAdapterInstance = new HermesAcpAdapter()
