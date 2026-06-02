import { spawn } from 'child_process'
import type { BrowserWindow } from 'electron'
import type { CliAgentAdapter, CliAdapterRequest } from './types'
import { resolveCliPath } from './utils'

type ClaudeContentBlock =
  | { type: 'text'; text?: string }
  | { type: 'tool_use'; id: string; name: string; input?: Record<string, unknown> }
  | { type: string; text?: string }

function buildConversationText(req: CliAdapterRequest): string {
  const parts: string[] = []
  if (req.systemPrompt) {
    parts.push(`[System]: ${req.systemPrompt}`)
  }
  for (const msg of req.messages) {
    const role = msg.role === 'user' ? '[User]' : '[Assistant]'
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    parts.push(`${role}: ${content}`)
  }
  return parts.join('\n\n')
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
    onEvent?: Parameters<CliAgentAdapter['send']>[3]
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const claudePath = resolveCliPath('claude')
      if (!claudePath) {
        reject(new Error('claude CLI not found'))
        return
      }

      const args = ['--output-format', 'stream-json', '--print', '--verbose']
      if (req.model && req.model !== 'default') {
        args.push('--model', req.model)
      }

      // --verbose is required when combining --output-format stream-json with --print
      const proc = spawn(claudePath, args, {
        cwd: req.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      })

      proc.stdin.end(buildConversationText(req), 'utf8')

      let fullText = ''
      let buffer = ''
      let stderrText = ''
      // Track whether we received per-token delta events. When true, the final
      // `assistant` message carries the same text and must not be re-emitted.
      let receivedDeltas = false

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
            for (const block of content) {
              if (block.type === 'text' && block.text) {
                if (!receivedDeltas) {
                  onChunk(block.text)
                  fullText += block.text
                }
              }
              if (block.type === 'tool_use' && 'id' in block && 'name' in block) {
                onEvent?.({
                  type: 'tool_start',
                  id: block.id,
                  name: block.name,
                  input: 'input' in block ? (block.input ?? {}) : {},
                })
              }
            }
          }
          if (obj.type === 'tool_result') {
            const content = Array.isArray(obj.content)
              ? obj.content
              : []
            const resultText = content
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

            if (typeof obj.tool_use_id === 'string') {
              onEvent?.({
                type: 'tool_end',
                id: obj.tool_use_id,
                content: resultText,
                isError: !!obj.is_error,
              })
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
          if (
            obj.type === 'content_block_delta' &&
            obj.delta &&
            typeof (obj.delta as Record<string, unknown>).text === 'string'
          ) {
            const text = (obj.delta as { text: string }).text
            receivedDeltas = true
            onChunk(text)
            fullText += text
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
        if (buffer.trim()) parseLine(buffer)
        if (code !== 0 && fullText === '') {
          const detail = stderrText.trim() ? `: ${stderrText.trim()}` : ''
          reject(new Error(`claude exited with code ${code}${detail}`))
        } else {
          resolve(fullText)
        }
      })
    })
  },
}
