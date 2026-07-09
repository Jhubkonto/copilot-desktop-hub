import { spawn } from 'child_process'
import type { BrowserWindow } from 'electron'
import type { CliAgentAdapter, CliAdapterRequest } from './types'
import { resolveCliPath, killProcess } from './utils'

type ClaudeContentBlock =
  | { type: 'text'; text?: string }
  | { type: 'thinking'; thinking?: string; text?: string }
  | { type: 'tool_use'; id: string; name: string; input?: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id?: string; content?: unknown; is_error?: boolean }
  | { type: string; text?: string; content?: unknown; tool_use_id?: string; is_error?: boolean }

function textFromClaudeContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((block) => {
      if (
        typeof block === 'object' &&
        block !== null &&
        (block as Record<string, unknown>).type === 'text' &&
        typeof (block as Record<string, unknown>).text === 'string'
      ) {
        return [(block as { text: string }).text]
      }
      return []
    })
    .join('')
}

function buildConversationText(req: CliAdapterRequest): string {
  const parts: string[] = []
  for (const msg of req.messages) {
    const role = msg.role === 'user' ? '[User]' : '[Assistant]'
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    parts.push(`${role}: ${content}`)
  }
  return parts.join('\n\n')
}

function buildConversationJson(req: CliAdapterRequest): string {
  const lines: string[] = []

  for (let i = 0; i < req.messages.length; i++) {
    const msg = req.messages[i]
    if (msg.role === 'system') continue
    const role = msg.role === 'user' ? 'user' : 'assistant'
    const isLast = i === req.messages.length - 1

    const textContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)

    const contentBlocks: unknown[] = [{ type: 'text', text: textContent }]

    // Attach images to the last user message
    if (isLast && role === 'user' && req.images && req.images.length > 0) {
      for (const img of req.images) {
        const mediaType = img.dataUrl.startsWith('data:image/png') ? 'image/png'
          : img.dataUrl.startsWith('data:image/webp') ? 'image/webp'
          : img.dataUrl.startsWith('data:image/gif') ? 'image/gif'
          : 'image/jpeg'
        const comma = img.dataUrl.indexOf(',')
        if (comma === -1) continue
        contentBlocks.push({
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: img.dataUrl.slice(comma + 1) },
        })
      }
    }

    lines.push(JSON.stringify({ type: role, message: { role, content: contentBlocks } }))
  }

  return lines.join('\n')
}

export const ClaudeAdapter: CliAgentAdapter = {
  name: 'claude-cli',

  isAvailable(): boolean {
    return resolveCliPath('claude') !== null
  },

  send(
    _window: BrowserWindow,
    req: CliAdapterRequest,
    onChunk: (chunk: string) => void,
    onEvent?: Parameters<CliAgentAdapter['send']>[3],
    signal?: AbortSignal
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const claudePath = resolveCliPath('claude')
      if (!claudePath) {
        reject(new Error('claude CLI not found'))
        return
      }

      const hasImages = (req.images?.length ?? 0) > 0
      const useJsonInput = hasImages
      // Always pass --strict-mcp-config so the CLI ignores any MCP servers registered
      // in the user's global ~/.claude.json. We control exactly which servers are
      // available via --mcp-config (or none at all when no servers are permitted).
      const args = ['--output-format', 'stream-json', '--print', '--verbose', '--strict-mcp-config']
      if (req.systemPrompt) {
        args.push('--system-prompt', req.systemPrompt)
      }
      if (req.model && req.model !== 'default') {
        args.push('--model', req.model)
      }
      if (req.thinkingEffort && req.thinkingEffort !== 'disabled') {
        const effortMap: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', max: 'max' }
        const cliEffort = effortMap[req.thinkingEffort]
        if (cliEffort) args.push('--effort', cliEffort)
      }
      if (req.mcpServers && req.mcpServers.length > 0) {
        const mcpConfig = {
          mcpServers: Object.fromEntries(req.mcpServers.map((server) => {
            const config: Record<string, unknown> = {
              command: server.command,
              args: server.args,
            }
            if (server.env && Object.keys(server.env).length > 0) config.env = server.env
            if (server.cwd) config.cwd = server.cwd
            return [server.key, config]
          })),
        }
        args.push('--mcp-config', JSON.stringify(mcpConfig))
      }
      if (req.allowedTools && req.allowedTools.length > 0) {
        args.push('--allowedTools', req.allowedTools.join(','))
      }
      if (req.skipPermissions === true) {
        args.push('--dangerously-skip-permissions')
        console.warn(`[WARN] Agent is running with --dangerously-skip-permissions. All file and shell operations will execute without confirmation.`)
      }
      if (useJsonInput) {
        args.push('--input-format', 'stream-json')
      }

      // --verbose is required when combining --output-format stream-json with --print
      const proc = spawn(claudePath, args, {
        cwd: req.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      })

      const stdinContent = useJsonInput ? buildConversationJson(req) : buildConversationText(req)
      proc.stdin.end(stdinContent, 'utf8')

      if (signal) {
        signal.addEventListener('abort', () => { killProcess(proc) }, { once: true })
      }

      let fullText = ''
      let buffer = ''
      let stderrText = ''
      // Track whether we received per-token delta events. When true, the final
      // `assistant` message carries the same text and must not be re-emitted.
      let receivedDeltas = false
      // Same duplication risk as text: streamed thinking_delta events and the final
      // consolidated `assistant` message's thinking block both carry the same content.
      let receivedThinkingDeltas = false
      const openToolIds = new Set<string>()
      // The Anthropic content-block index resets to 0 for every new `assistant` message,
      // and one CLI turn can emit several such messages as it works through tool calls —
      // so a later, unrelated reasoning burst that happens to land at index 0 again would
      // otherwise collide with an earlier one under the same blockId (`thinking-0`) and
      // silently merge into it. Track reasoning as an "open block" instead: it's reused
      // across consecutive thinking events, but any other event in between (text, a tool
      // call) or an explicit end closes it, so the next reasoning burst gets a fresh id.
      let thinkingBlockSeq = 0
      let openReasoningBlockId: string | null = null
      const nextReasoningBlockId = (): string => {
        if (!openReasoningBlockId) openReasoningBlockId = `thinking-${thinkingBlockSeq++}`
        return openReasoningBlockId
      }
      const interruptReasoning = () => { openReasoningBlockId = null }

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrText += chunk.toString('utf8')
      })

      const parseLine = (line: string) => {
        if (!line.trim()) return
        try {
          const obj = JSON.parse(line) as Record<string, unknown>
          // Claude CLI stream-json: complete assistant message.
          // Only emit chunks here when no content_block_delta events arrived
          // (i.e. CLI is operating in batch mode). When deltas are streaming
          // this event duplicates the same text so we skip the onChunk call
          // but still fire tool_start events from it.
          if (obj.type === 'assistant' && obj.message) {
            const content = ((obj.message as { content?: ClaudeContentBlock[] }).content ?? []) as ClaudeContentBlock[]
            for (let i = 0; i < content.length; i++) {
              const block = content[i]
              if (block.type === 'thinking') {
                // Only emit here when no thinking_delta events streamed this burst already
                // (batch mode) — otherwise this consolidated block duplicates the same text.
                if (!receivedThinkingDeltas) {
                  const blockId = nextReasoningBlockId()
                  const thinkingText = (block as { type: 'thinking'; thinking?: string; text?: string }).thinking ?? block.text ?? ''
                  // Emit chunk before end — no async boundary between them (H6).
                  if (thinkingText) onEvent?.({ type: 'thinking_chunk', blockId, chunk: thinkingText })
                  onEvent?.({ type: 'thinking_end', blockId })
                }
                // This block resolved atomically (chunk + end emitted together above), so
                // any further thinking — even later in this same message — is a new burst.
                interruptReasoning()
              }
              if (block.type === 'text' && block.text) {
                if (!receivedDeltas) {
                  onChunk(block.text)
                  fullText += block.text
                }
                interruptReasoning()
              }
              if (block.type === 'tool_use' && 'id' in block && 'name' in block) {
                openToolIds.add(block.id)
                onEvent?.({
                  type: 'tool_start',
                  id: block.id,
                  name: block.name,
                  input: 'input' in block ? (block.input ?? {}) : {},
                })
                interruptReasoning()
              }
            }
          }
          if (obj.type === 'user' && obj.message) {
            const content = ((obj.message as { content?: ClaudeContentBlock[] }).content ?? []) as ClaudeContentBlock[]
            for (const block of content) {
              if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue
              openToolIds.delete(block.tool_use_id)
              onEvent?.({
                type: 'tool_end',
                id: block.tool_use_id,
                content: textFromClaudeContent(block.content),
                isError: !!block.is_error,
              })
              interruptReasoning()
            }
          }
          if (obj.type === 'tool_result') {
            if (typeof obj.tool_use_id === 'string') {
              openToolIds.delete(obj.tool_use_id)
              onEvent?.({
                type: 'tool_end',
                id: obj.tool_use_id,
                content: textFromClaudeContent(obj.content),
                isError: !!obj.is_error,
              })
              interruptReasoning()
            }
          }
          if (obj.type === 'result') {
            const usage = typeof obj.usage === 'object' && obj.usage !== null
              ? (obj.usage as Record<string, unknown>)
              : null
            onEvent?.({
              type: 'cost',
              totalCostUsd: typeof obj.total_cost_usd === 'number' ? obj.total_cost_usd : 0,
              inputTokens: typeof usage?.input_tokens === 'number' ? usage.input_tokens : 0,
              outputTokens: typeof usage?.output_tokens === 'number' ? usage.output_tokens : 0,
            })
          }
          // Per-token streaming delta format (used when --verbose outputs raw API events)
          if (obj.type === 'content_block_delta' && obj.delta) {
            const delta = obj.delta as Record<string, unknown>
            if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
              receivedThinkingDeltas = true
              const blockId = nextReasoningBlockId()
              onEvent?.({ type: 'thinking_chunk', blockId, chunk: delta.thinking })
            } else if (typeof delta.text === 'string') {
              receivedDeltas = true
              onChunk(delta.text)
              fullText += delta.text
              interruptReasoning()
            }
          }
          if (obj.type === 'content_block_stop') {
            // Only fires thinking_end when a reasoning block is actually open — the old
            // index-based lookup fired a (harmless but spurious) thinking_end for every
            // content block's stop event, including text/tool blocks that never opened one.
            if (openReasoningBlockId) {
              onEvent?.({ type: 'thinking_end', blockId: openReasoningBlockId })
              interruptReasoning()
            }
          }
        } catch {
          // non-JSON lines — ignore
        }
      }

      proc.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) parseLine(line)
      })

      proc.on('error', reject)
      proc.on('close', (code) => {
        if (buffer.trim()) {
          const trimmed = buffer.trim()
          try {
            JSON.parse(trimmed)
            parseLine(trimmed)
          } catch {
            // Unterminated non-JSON line — emit as raw text fallback (M1).
            onChunk(trimmed)
            fullText += trimmed
          }
        }
        if (openReasoningBlockId) {
          onEvent?.({ type: 'thinking_end', blockId: openReasoningBlockId })
          openReasoningBlockId = null
        }
        for (const id of openToolIds) {
          onEvent?.({
            type: 'tool_end',
            id,
            content: '',
            isError: code !== 0,
          })
        }
        openToolIds.clear()
        if (fullText === '') {
          const detail = stderrText.trim() ? `: ${stderrText.trim()}` : ''
          const codeNote = code !== 0 ? ` (exit ${code})` : ''
          reject(new Error(`claude returned an empty response${codeNote}${detail}`))
        } else {
          resolve(fullText)
        }
      })
    })
  },
}
