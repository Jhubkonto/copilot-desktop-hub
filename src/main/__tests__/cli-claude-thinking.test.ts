import { describe, it, expect, vi } from 'vitest'

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))
vi.mock('child_process', () => ({ spawn: spawnMock, exec: vi.fn(), execFile: vi.fn(), execSync: vi.fn(), spawnSync: vi.fn() }))
vi.mock('../cli-adapters/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../cli-adapters/utils')>()),
  resolveCliPath: () => '/usr/local/bin/claude',
  killProcess: vi.fn(),
}))

import { ClaudeAdapter } from '../cli-adapters/claude'
import { EventEmitter } from 'events'

function makeProc() {
  const stdout = new EventEmitter() as EventEmitter & { setEncoding?: () => void }
  const stderr = new EventEmitter() as EventEmitter & { setEncoding?: () => void }
  const proc = new EventEmitter() as EventEmitter & {
    stdout: typeof stdout
    stderr: typeof stderr
    stdin: { end: ReturnType<typeof vi.fn> }
  }
  proc.stdout = stdout
  proc.stderr = stderr
  proc.stdin = { end: vi.fn() }
  return proc
}

describe('ClaudeAdapter — batch-mode thinking emit order', () => {
  it('emits thinking_chunk before thinking_end for each thinking block', async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)

    const events: { type: string; blockId?: string }[] = []
    const onEvent = vi.fn((e: { type: string; blockId?: string }) => { events.push(e) })

    // Simulate a batch-mode assistant message with one thinking block and one text block
    const assistantLine = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'Let me reason about this.' },
          { type: 'text', text: 'The answer is 42.' },
        ],
      },
    })
    const resultLine = JSON.stringify({
      type: 'result',
      total_cost_usd: 0,
      usage: { input_tokens: 10, output_tokens: 20 },
    })

    const promise = ClaudeAdapter.send(
      {} as never,
      { messages: [{ role: 'user', content: 'What is the answer?' }], cwd: '/tmp', model: 'default', conversationId: 'test-1' },
      vi.fn(),
      onEvent,
    )

    proc.stdout.emit('data', Buffer.from(assistantLine + '\n' + resultLine + '\n'))
    proc.emit('close', 0)

    await promise

    // Find the sequence for thinking-0
    const thinkingChunkIdx = events.findIndex((e) => e.type === 'thinking_chunk' && e.blockId === 'thinking-0')
    const thinkingEndIdx = events.findIndex((e) => e.type === 'thinking_end' && e.blockId === 'thinking-0')

    expect(thinkingChunkIdx).toBeGreaterThanOrEqual(0)
    expect(thinkingEndIdx).toBeGreaterThanOrEqual(0)
    // chunk must arrive strictly before end
    expect(thinkingChunkIdx).toBeLessThan(thinkingEndIdx)
  })

  it('emits thinking_end even for empty thinking blocks', async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)

    const events: { type: string; blockId?: string }[] = []
    const onEvent = vi.fn((e: { type: string; blockId?: string }) => { events.push(e) })

    const assistantLine = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: '' },
          { type: 'text', text: 'Response.' },
        ],
      },
    })

    const promise = ClaudeAdapter.send(
      {} as never,
      { messages: [{ role: 'user', content: 'hi' }], cwd: '/tmp', model: 'default', conversationId: 'test-2' },
      vi.fn(),
      onEvent,
    )

    proc.stdout.emit('data', Buffer.from(assistantLine + '\n'))
    proc.emit('close', 0)

    await promise

    // thinking_end must fire (even for empty block) but thinking_chunk must NOT (empty text)
    expect(events.find((e) => e.type === 'thinking_end' && e.blockId === 'thinking-0')).toBeDefined()
    expect(events.find((e) => e.type === 'thinking_chunk' && e.blockId === 'thinking-0')).toBeUndefined()
  })
})
