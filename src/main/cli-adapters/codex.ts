import { spawn } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir, homedir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import type { CliAgentAdapter, CliAdapterRequest } from './types'
import { resolveCliPath } from './utils'

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}

type TextResult = { text: string; isDelta: boolean }

function extractText(line: string): TextResult | null {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>

    // Streaming text delta (Responses API style)
    if (obj.type === 'response.content_part.delta') {
      const delta = obj.delta as Record<string, unknown> | undefined
      if (delta?.type === 'text' && typeof delta.text === 'string') {
        return { text: delta.text, isDelta: true }
      }
    }
    if (obj.type === 'response.output_text.delta' && typeof obj.delta === 'string') {
      return { text: obj.delta, isDelta: true }
    }

    // Complete assistant message (Responses API style)
    if (obj.type === 'response.output_item.done') {
      const item = obj.item as Record<string, unknown> | undefined
      if (item?.role === 'assistant' && Array.isArray(item.content)) {
        const text = (item.content as Array<{ type: string; text?: string }>)
          .filter((b) => b.type === 'text' && b.text)
          .map((b) => b.text!)
          .join('')
        if (text) return { text, isDelta: false }
      }
    }

    // Codex exec JSONL: agent_message_delta
    if (obj.type === 'agent_message_delta') {
      const delta = obj.delta as Record<string, unknown> | undefined
      if (typeof delta?.text === 'string' && delta.text) {
        return { text: delta.text, isDelta: true }
      }
    }

    // Codex exec JSONL: final agent_message
    if (obj.type === 'agent_message') {
      const msg = obj.message as Record<string, unknown> | undefined
      if (Array.isArray(msg?.content)) {
        const text = (msg!.content as Array<{ type: string; text?: string }>)
          .filter((b) => b.type === 'text' && b.text)
          .map((b) => b.text!)
          .join('')
        if (text) return { text, isDelta: false }
      }
      if (typeof msg?.text === 'string' && msg.text) return { text: msg.text, isDelta: false }
    }

    // Codex exec JSONL: item.completed with an agent_message payload.
    if (obj.type === 'item.completed') {
      const item = obj.item as Record<string, unknown> | undefined
      if (item?.type === 'agent_message' && typeof item.text === 'string' && item.text) {
        return { text: item.text, isDelta: false }
      }
      if (item?.role === 'assistant' && Array.isArray(item.content)) {
        const text = (item.content as Array<{ type: string; text?: string }>)
          .filter((b) => b.type === 'text' && b.text)
          .map((b) => b.text!)
          .join('')
        if (text) return { text, isDelta: false }
      }
    }

    // Generic: any object with role=assistant
    if (obj.role === 'assistant') {
      if (typeof obj.text === 'string' && obj.text) return { text: obj.text, isDelta: false }
      if (Array.isArray(obj.content)) {
        const text = (obj.content as Array<{ type: string; text?: string }>)
          .filter((b) => b.type === 'text' && b.text)
          .map((b) => b.text!)
          .join('')
        if (text) return { text, isDelta: false }
      }
    }
  } catch {
    // not JSON
  }
  return null
}

function extractError(line: string): string | null {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>
    if (obj.type === 'turn.failed') {
      const err = obj.error as Record<string, unknown> | undefined
      return typeof err?.message === 'string' ? normalizeErrorMessage(err.message) : 'Codex turn failed'
    }
    if (obj.type === 'error' && typeof obj.message === 'string') {
      return normalizeErrorMessage(obj.message)
    }
  } catch { /* non-JSON line — skip */ }
  return null
}

function normalizeErrorMessage(message: string): string {
  try {
    const parsed = JSON.parse(message) as Record<string, unknown>
    const nestedError = parsed.error as Record<string, unknown> | undefined
    if (typeof nestedError?.message === 'string') return nestedError.message
    if (typeof parsed.message === 'string') return parsed.message
  } catch { /* not nested JSON */ }
  return message
}

function extractCost(line: string): { inputTokens: number; outputTokens: number } | null {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>
    if (obj.type === 'response.done') {
      const response = obj.response as Record<string, unknown> | undefined
      const usage = response?.usage as Record<string, unknown> | undefined
      if (usage) {
        return {
          inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
          outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
        }
      }
    }
    if (obj.type === 'turn.completed') {
      const usage = obj.usage as Record<string, unknown> | undefined
      if (usage) {
        return {
          inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
          outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
        }
      }
    }
  } catch { /* non-JSON line — skip */ }
  return null
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlString).join(', ')}]`
}

function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key)
    ? key
    : tomlString(key)
}

function buildCodexMcpConfigArgs(req: CliAdapterRequest): string[] {
  if (!req.mcpServers || req.mcpServers.length === 0) return []

  const args: string[] = []
  for (const server of req.mcpServers) {
    const prefix = `mcp_servers.${tomlKey(server.key)}`
    args.push('-c', `${prefix}.command=${tomlString(server.command)}`)
    if (server.args.length > 0) {
      args.push('-c', `${prefix}.args=${tomlStringArray(server.args)}`)
    }
    if (server.cwd) {
      args.push('-c', `${prefix}.cwd=${tomlString(server.cwd)}`)
    }
    if (server.env && Object.keys(server.env).length > 0) {
      for (const [key, value] of Object.entries(server.env)) {
        args.push('-c', `${prefix}.env.${tomlKey(key)}=${tomlString(value)}`)
      }
    }

    const enabledTools = (req.allowedTools ?? [])
      .flatMap((toolName) => {
        const mcpPrefix = `mcp__${server.key}__`
        return toolName.startsWith(mcpPrefix) ? [toolName.slice(mcpPrefix.length)] : []
      })
    if (enabledTools.length > 0) {
      args.push('-c', `${prefix}.enabled_tools=${tomlStringArray(enabledTools)}`)
    }
  }

  return args
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function textFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map(textFromUnknown).filter(Boolean).join('\n')
  }
  const record = asRecord(value)
  if (!record) return ''
  if (typeof record.text === 'string') return record.text
  if (typeof record.content === 'string') return record.content
  if (typeof record.output === 'string') return record.output
  if (typeof record.result === 'string') return record.result
  return JSON.stringify(value)
}

function objectFromUnknown(value: unknown): Record<string, unknown> {
  const record = asRecord(value)
  if (record) return record
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      return asRecord(parsed) ?? { value }
    } catch {
      return { value }
    }
  }
  return {}
}

function extractToolEvent(line: string):
  | { phase: 'start'; id: string; name: string; input: Record<string, unknown> }
  | { phase: 'end'; id: string; content: string; isError: boolean }
  | null {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>
    if (obj.type !== 'item.started' && obj.type !== 'item.completed') return null

    const item = asRecord(obj.item)
    if (!item) return null
    const itemType = typeof item.type === 'string' ? item.type : ''
    if (!/mcp|tool/.test(itemType) || itemType === 'agent_message') return null

    const id = typeof item.id === 'string' ? item.id : `${itemType}-${Date.now()}`
    if (obj.type === 'item.started') {
      const name =
        typeof item.name === 'string' ? item.name
          : typeof item.tool_name === 'string' ? item.tool_name
          : typeof item.tool === 'string' ? item.tool
          : itemType
      return {
        phase: 'start',
        id,
        name,
        input: objectFromUnknown(item.arguments ?? item.input ?? item.args),
      }
    }

    return {
      phase: 'end',
      id,
      content: textFromUnknown(item.output ?? item.result ?? item.content ?? item.error ?? ''),
      isError: item.status === 'failed' || item.status === 'error' || Boolean(item.error),
    }
  } catch {
    return null
  }
}

/** Read the configured model from ~/.codex/config.toml if present. */
export function readCodexConfigModel(): string | null {
  try {
    const { readFileSync } = require('fs') as typeof import('fs')
    const tomlPath = join(homedir(), '.codex', 'config.toml')
    const content = readFileSync(tomlPath, 'utf8')
    const match = /^\s*model\s*=\s*["']?([^"'\s\n]+)["']?/m.exec(content)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

export const CODEX_DEFAULT_MODELS: { id: string; label: string }[] = [
  { id: 'codex-mini-latest', label: 'Codex Mini (latest)' },
  { id: 'o4-mini', label: 'o4-mini' },
  { id: 'o3', label: 'o3' },
  { id: 'gpt-4.1', label: 'GPT-4.1' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
]

export const CodexAdapter: CliAgentAdapter = {
  name: 'codex-cli',

  isAvailable(): boolean {
    return resolveCliPath('codex') !== null
  },

  send(
    _window: BrowserWindow,
    req: CliAdapterRequest,
    onChunk: (chunk: string) => void,
    onEvent?: Parameters<CliAgentAdapter['send']>[3]
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!CodexAdapter.isAvailable()) {
        reject(new Error('codex CLI not found'))
        return
      }

      // Write images to temp files; codex accepts -i <filepath>
      const tempFiles: string[] = []
      const imageArgs: string[] = []

      if (req.images && req.images.length > 0) {
        for (const img of req.images) {
          const ext = img.dataUrl.startsWith('data:image/png') ? 'png'
            : img.dataUrl.startsWith('data:image/webp') ? 'webp'
            : img.dataUrl.startsWith('data:image/gif') ? 'gif'
            : 'jpg'
          const comma = img.dataUrl.indexOf(',')
          if (comma === -1) continue
          try {
            const tempPath = join(tmpdir(), `codex-img-${randomUUID()}.${ext}`)
            writeFileSync(tempPath, Buffer.from(img.dataUrl.slice(comma + 1), 'base64'))
            tempFiles.push(tempPath)
            imageArgs.push('-i', tempPath)
          } catch {
            // skip image if write fails
          }
        }
      }

      const cleanup = () => {
        for (const f of tempFiles) {
          try { unlinkSync(f) } catch { /* best-effort cleanup */ }
        }
      }

      const lastMsg = req.messages[req.messages.length - 1]
      let prompt = typeof lastMsg?.content === 'string'
        ? lastMsg.content
        : JSON.stringify(lastMsg?.content ?? '')

      // Embed system prompt as a text prefix to avoid CLI flag escaping issues
      if (req.systemPrompt) {
        prompt = `[System]: ${req.systemPrompt}\n\n${prompt}`
      }

      // codex exec: non-interactive subcommand with JSONL output. The prompt is
      // written to stdin below so multi-line chat history never crosses cmd.exe.
      const execArgs = [
        'exec',
        '--json',
        '--ephemeral',
        '--skip-git-repo-check',
        ...buildCodexMcpConfigArgs(req),
        '-C',
        req.cwd,
        ...imageArgs,
      ]
      if (req.model && req.model !== 'default') {
        execArgs.push('--model', req.model)
      }

      // On Windows, npm global CLIs (.cmd) can't be spawned directly with shell:false.
      // Explicitly invoke cmd.exe so each arg is passed as a proper argv element,
      // and pass the large prompt through stdin to avoid command-line parsing.
      const isWin = process.platform === 'win32'
      const [executable, spawnArgs] = isWin
        ? [process.env.ComSpec || 'cmd.exe', ['/c', 'codex', ...execArgs]]
        : [resolveCliPath('codex') ?? 'codex', execArgs]

      const proc = spawn(executable, spawnArgs, {
        cwd: req.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        env: process.env,
      })
      proc.stdin?.end(prompt, 'utf8')

      let fullText = ''
      let rawStdout = ''
      let buffer = ''
      let stderrText = ''
      let parsedAnyJson = false
      let receivedDeltas = false
      let turnError: string | null = null

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrText += chunk.toString('utf8')
      })

      const parseLine = (line: string) => {
        if (!line.trim()) return

        const errMsg = extractError(line)
        if (errMsg) {
          turnError = errMsg
          return
        }

        const costData = extractCost(line)
        if (costData) {
          onEvent?.({ type: 'cost', totalCostUsd: 0, ...costData })
          return
        }

        const toolEvent = extractToolEvent(line)
        if (toolEvent) {
          if (toolEvent.phase === 'start') {
            onEvent?.({
              type: 'tool_start',
              id: toolEvent.id,
              name: toolEvent.name,
              input: toolEvent.input,
            })
          } else {
            onEvent?.({
              type: 'tool_end',
              id: toolEvent.id,
              content: toolEvent.content,
              isError: toolEvent.isError,
            })
          }
          return
        }

        const result = extractText(line)
        if (result !== null) {
          parsedAnyJson = true
          turnError = null
          if (result.isDelta) {
            receivedDeltas = true
            onChunk(result.text)
            fullText += result.text
          } else if (!receivedDeltas) {
            onChunk(result.text)
            fullText += result.text
          }
        }
      }

      proc.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8')
        rawStdout += text
        buffer += text
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) parseLine(line)
      })

      proc.on('error', (err) => {
        cleanup()
        reject(err)
      })

      proc.on('close', (code) => {
        if (buffer.trim()) parseLine(buffer)
        cleanup()

        if (!parsedAnyJson && !turnError && rawStdout.trim()) {
          const cleaned = stripAnsi(rawStdout).trim()
          if (cleaned) {
            onChunk(cleaned)
            fullText = cleaned
          }
        }

        if (fullText) {
          resolve(fullText)
        } else if (turnError) {
          reject(new Error(`Codex error: ${turnError}`))
        } else if (code !== 0) {
          const detail = stderrText.trim() ? `: ${stderrText.trim()}` : ''
          reject(new Error(`codex exited with code ${code}${detail}`))
        } else {
          resolve(fullText)
        }
      })
    })
  },
}
