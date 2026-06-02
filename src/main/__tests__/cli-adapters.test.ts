import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecSync, mockSpawnSync, mockSpawn } = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
  mockSpawnSync: vi.fn(),
  mockSpawn: vi.fn(),
}))

vi.mock('child_process', () => ({
  execSync: mockExecSync,
  spawnSync: mockSpawnSync,
  spawn: mockSpawn,
}))

import { ClaudeAdapter } from '../cli-adapters/claude'
import { GhCopilotAdapter } from '../cli-adapters/gh-copilot'

describe('CLI adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // resolveCliPath calls execSync('where.exe <name>') — return a dummy path by default
    mockExecSync.mockImplementation((cmd: string) => {
      if (String(cmd).includes('where') || String(cmd).includes('which')) {
        return String(cmd).includes('gh') ? 'C:\\gh.exe\n' : 'C:\\claude.exe\n'
      }
      return ''
    })
  })

  function makeProc() {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      stdin: { end: ReturnType<typeof vi.fn> }
    }
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.stdin = { end: vi.fn() }
    return proc
  }

  it('ClaudeAdapter parses text and emits Claude stream events', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const chunks: string[] = []
    const onEvent = vi.fn()
    const sendPromise = ClaudeAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'hello' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
      systemPrompt: 'system'
    }, (chunk: string) => chunks.push(chunk), onEvent)

    const line1 = JSON.stringify({ type: 'system', subtype: 'init' })
    const line2 = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Hello world' },
          { type: 'tool_use', id: 'toolu_abc', name: 'Read', input: { file_path: 'src/main.ts' } },
        ],
      },
    })
    const line3 = JSON.stringify({
      type: 'tool_result',
      tool_use_id: 'toolu_abc',
      content: [{ type: 'text', text: 'file contents here...' }],
      is_error: false,
    })
    const line4 = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'Hello world',
      total_cost_usd: 0.0123,
      usage: { input_tokens: 1500, output_tokens: 300 },
    })
    proc.stdout.emit('data', Buffer.from(`${line1}\n${line2}\n${line3}\n${line4}\n`))
    proc.emit('close', 0)

    await expect(sendPromise).resolves.toBe('Hello world')
    expect(chunks).toEqual(['Hello world'])
    expect(onEvent).toHaveBeenNthCalledWith(1, {
      type: 'tool_start',
      id: 'toolu_abc',
      name: 'Read',
      input: { file_path: 'src/main.ts' },
    })
    expect(onEvent).toHaveBeenNthCalledWith(2, {
      type: 'tool_end',
      id: 'toolu_abc',
      content: 'file contents here...',
      isError: false,
    })
    expect(onEvent).toHaveBeenNthCalledWith(3, {
      type: 'cost',
      totalCostUsd: 0.0123,
      inputTokens: 1500,
      outputTokens: 300,
    })
    expect(mockSpawn).toHaveBeenCalledWith(
      'C:\\claude.exe',
      ['--output-format', 'stream-json', '--print', '--verbose'],
      expect.objectContaining({ cwd: 'C:\\workspace' })
    )
    expect(proc.stdin.end).toHaveBeenCalledWith('[System]: system\n\n[User]: hello', 'utf8')
  })

  it('ClaudeAdapter falls back to content_block_delta format', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const chunks: string[] = []
    const sendPromise = ClaudeAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'hello' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
    }, (chunk: string) => chunks.push(chunk))

    proc.stdout.emit('data', Buffer.from('{"type":"content_block_delta","delta":{"text":"Hello"}}\nnot-json\n'))
    proc.stdout.emit('data', Buffer.from('{"type":"content_block_delta","delta":{"text":" world"}}'))
    proc.emit('close', 0)

    await expect(sendPromise).resolves.toBe('Hello world')
    expect(chunks).toEqual(['Hello', ' world'])
  })

  it('ClaudeAdapter includes stderr in error message', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const sendPromise = ClaudeAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'hello' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
    }, () => {})

    proc.stderr.emit('data', Buffer.from('Error: not authenticated'))
    proc.emit('close', 1)

    await expect(sendPromise).rejects.toThrow('Error: not authenticated')
  })

  it('ClaudeAdapter reports availability from execSync', () => {
    mockExecSync.mockReturnValue('C:\\claude.exe\n')
    expect(ClaudeAdapter.isAvailable()).toBe(true)
    mockExecSync.mockImplementation(() => { throw new Error('missing') })
    expect(ClaudeAdapter.isAvailable()).toBe(false)
  })

  it('GhCopilotAdapter strips ANSI output', async () => {
    mockSpawnSync.mockReturnValue({ stdout: '\u001b[31mecho hi\u001b[0m', error: undefined })

    const chunks: string[] = []
    await expect(GhCopilotAdapter.send({} as never, {
      messages: [{ role: 'assistant', content: 'ignore' }, { role: 'user', content: 'say hi' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
    }, (chunk: string) => {
      chunks.push(chunk)
    })).resolves.toBe('echo hi')

    expect(chunks).toEqual(['echo hi'])
    expect(mockSpawnSync).toHaveBeenCalledWith(expect.stringContaining('gh'), ['copilot', 'suggest', '-t', 'shell', 'say hi'], expect.objectContaining({ cwd: 'C:\\workspace' }))
  })

  it('GhCopilotAdapter rejects spawn errors', async () => {
    mockSpawnSync.mockReturnValue({ stdout: '', error: new Error('boom') })

    await expect(GhCopilotAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'say hi' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
    }, () => {})).rejects.toThrow('boom')
  })
})
